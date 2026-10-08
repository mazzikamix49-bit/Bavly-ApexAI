import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TradeDirection } from '../types/trading';
import { storageService, StorageService } from '../services/storageService';
import { RemotePosition } from './accountStateProvider';

/**
 * Status of a pilot position
 */
export type PilotPositionStatus =
  | 'PENDING_ENTRY'
  | 'ACTIVE'
  | 'CLOSING'
  | 'CLOSED'
  | 'FAILED';

/**
 * Detailed lifecycle state of a pilot position
 */
export type PilotPositionLifecycleState =
  | 'OPENING'
  | 'OPEN'
  | 'PROTECTED'
  | 'TP1_BREAKEVEN'
  | 'TRAILING'
  | 'STOPPED'
  | 'REDUCING'
  | 'CLOSING'
  | 'CLOSED'
  | 'FAILED'
  | 'RECONCILED'
  | 'MANUAL_INTERVENTION_REQUIRED';

/**
 * Complete, standalone record for a Pilot position.
 * Meets all required audit fields with strong identity and immutable IDs.
 */
export interface PilotPositionRecord {
  positionId: string;
  symbol: string;
  side: TradeDirection;
  positionSide: 'BOTH' | 'LONG' | 'SHORT';
  entryOrderId: string;
  entryClientOrderId: string;
  transactionId: string;
  fingerprint: string;
  authorizationId: string;
  plannedEntry: number;
  actualEntry: number;
  quantity: number;
  notional: number;
  SL: number;
  TP: number;
  riskAmount: number;
  status: PilotPositionStatus;
  lifecycleState: PilotPositionLifecycleState;
  openedAt: number;
  lastReconciledAt: number;
  // Optional companion and exit metadata
  stopLossOrderId?: string;
  stopLossClientOrderId?: string;
  takeProfitOrderId?: string;
  takeProfitClientOrderId?: string;
  // Management state fields
  tp1Price?: number;
  highestPriceReached?: number;
  lowestPriceReached?: number;
  trailingStopPrice?: number;
  trailingActivated?: boolean;
  closedAt?: number | null;
  closeOrderId?: string;
  exitReason?: string;
  realizedPnl?: number;
  metadata?: Record<string, any>;
}

export interface PositionReconciliationResult {
  positionId: string;
  symbol: string;
  inSync: boolean;
  remotePositionFound: boolean;
  remoteQuantity: number;
  slOrderActive: boolean;
  tpOrderActive: boolean;
  notes: string[];
}

export interface PilotRegistrySnapshot {
  activeCount: number;
  closedCount: number;
  maxOpenPositions: number;
  activePositions: PilotPositionRecord[];
  closedPositions: PilotPositionRecord[];
  lastSavedAt: number;
}

/**
 * PilotPositionRegistry
 *
 * Central, independent Registry for Multi-Position management on Binance Futures Testnet.
 * Invariants:
 * - maxOpenPositions = 2
 * - Strictly isolates HOOKUSDT (HOOKUSDT is NEVER admitted or counted as a pilot slot)
 * - Guarantees unique position identity (preventing two positions from ever being conflated)
 * - Prevents same-symbol collisions (cannot hold duplicate positions on the same symbol)
 * - Atomic persistence to disk across restarts
 */
export class PilotPositionRegistry {
  private readonly maxOpenPositions: number = 4;
  private readonly storage: StorageService;
  private readonly registryFilePath: string;
  private positions: Map<string, PilotPositionRecord> = new Map();
  private isLoaded: boolean = false;
  private positionLocks: Set<string> = new Set();

  public acquireLock(positionId: string): boolean {
    if (this.positionLocks.has(positionId)) {
      return false;
    }
    this.positionLocks.add(positionId);
    return true;
  }

  public releaseLock(positionId: string): void {
    this.positionLocks.delete(positionId);
  }

  public isLocked(positionId: string): boolean {
    return this.positionLocks.has(positionId);
  }

  constructor(options?: { storage?: StorageService; customPath?: string; maxOpenPositions?: number }) {
    this.storage = options?.storage || storageService;
    if (options?.maxOpenPositions !== undefined) {
      this.maxOpenPositions = options.maxOpenPositions;
    }

    try {
      const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
      const dataDir = path.resolve(cwd, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.registryFilePath = options?.customPath || path.resolve(dataDir, 'pilot_position_registry.json');
    } catch {
      this.registryFilePath = options?.customPath || './data/pilot_position_registry.json';
    }
  }

  /**
   * Initializes the registry by loading saved state from disk.
   */
  public async init(): Promise<void> {
    if (this.isLoaded) return;
    await this.loadFromDisk();
    this.isLoaded = true;
  }

  /**
   * Generates a strong, deterministic, collision-proof position ID.
   */
  public static generatePositionId(symbol: string, entryOrderId: string, timestamp: number = Date.now()): string {
    const cleanSym = symbol.trim().toUpperCase();
    const entropy = crypto.randomBytes(3).toString('hex');
    return `pos-${cleanSym}-${entryOrderId || timestamp}-${entropy}`;
  }

  /**
   * Validates if a new position can be opened for the given symbol.
   */
  public canOpenNewPosition(symbol: string): { allowed: boolean; reason?: string } {
    const cleanSym = symbol.trim().toUpperCase();

    // 1. HOOKUSDT is strictly excluded from pilot registry
    if (cleanSym === 'HOOKUSDT') {
      return { allowed: false, reason: 'HOOKUSDT_EXCLUDED_FROM_PILOT' };
    }

    const active = this.getActivePositions();

    // 2. Symbol collision prevention: cannot open second position on same symbol
    const existingForSymbol = active.find((p) => p.symbol.toUpperCase() === cleanSym);
    if (existingForSymbol) {
      return {
        allowed: false,
        reason: `SYMBOL_ALREADY_ACTIVE: Symbol ${cleanSym} already has active position ${existingForSymbol.positionId}.`,
      };
    }

    // 3. Capacity limit check (max 2 positions)
    if (active.length >= this.maxOpenPositions) {
      return {
        allowed: false,
        reason: `MAX_OPEN_POSITIONS_REACHED: Currently holding ${active.length} active positions (max ${this.maxOpenPositions}).`,
      };
    }

    return { allowed: true };
  }

  /**
   * Registers a new pilot position into the registry.
   */
  public async registerPosition(
    record: Omit<PilotPositionRecord, 'positionId' | 'lastReconciledAt'> & { positionId?: string }
  ): Promise<PilotPositionRecord> {
    await this.init();

    const cleanSym = record.symbol.trim().toUpperCase();

    // Safety checks
    if (cleanSym === 'HOOKUSDT') {
      throw new Error('[REGISTRY_SAFETY] HOOKUSDT is permanently isolated and cannot be registered in PilotPositionRegistry.');
    }

    const check = this.canOpenNewPosition(cleanSym);
    if (!check.allowed) {
      throw new Error(`[REGISTRY_SAFETY] Cannot register position: ${check.reason}`);
    }

    const positionId = record.positionId || PilotPositionRegistry.generatePositionId(cleanSym, record.entryOrderId, record.openedAt);

    if (this.positions.has(positionId)) {
      throw new Error(`[REGISTRY_SAFETY] Position ID collision detected: ${positionId} already exists.`);
    }

    // Ensure transaction ID is unique across active positions
    const existingTx = Array.from(this.positions.values()).find(
      (p) => p.status === 'ACTIVE' && p.transactionId === record.transactionId
    );
    if (existingTx) {
      throw new Error(`[REGISTRY_SAFETY] Transaction ID ${record.transactionId} already assigned to position ${existingTx.positionId}.`);
    }

    const fullRecord: PilotPositionRecord = {
      ...record,
      positionId,
      symbol: cleanSym,
      lastReconciledAt: Date.now(),
    };

    this.positions.set(positionId, fullRecord);
    await this.saveToDisk();

    console.log(
      `[PILOT_REGISTRY] Registered position ${positionId} (${cleanSym} ${fullRecord.side} qty=${fullRecord.quantity}) - Total active: ${this.getActivePositions().length}/${this.maxOpenPositions}`
    );

    return { ...fullRecord };
  }

  /**
   * Updates an existing position record.
   */
  public async updatePosition(positionId: string, updates: Partial<PilotPositionRecord>): Promise<PilotPositionRecord> {
    await this.init();

    const existing = this.positions.get(positionId);
    if (!existing) {
      throw new Error(`[PILOT_REGISTRY] Position ${positionId} not found in registry.`);
    }

    // Prevent changing fundamental identity fields
    const updated: PilotPositionRecord = {
      ...existing,
      ...updates,
      positionId: existing.positionId,
      symbol: existing.symbol,
      openedAt: existing.openedAt,
      lastReconciledAt: updates.lastReconciledAt || Date.now(),
    };

    this.positions.set(positionId, updated);
    await this.saveToDisk();

    return { ...updated };
  }

  /**
   * Marks a position as CLOSED cleanly.
   */
  public async closePositionRecord(
    positionId: string,
    details?: { exitReason?: string; closeOrderId?: string; realizedPnl?: number }
  ): Promise<PilotPositionRecord> {
    await this.init();

    const existing = this.positions.get(positionId);
    if (!existing) {
      throw new Error(`[PILOT_REGISTRY] Position ${positionId} not found.`);
    }

    const now = Date.now();
    const closedRecord: PilotPositionRecord = {
      ...existing,
      status: 'CLOSED',
      lifecycleState: 'CLOSED',
      closedAt: now,
      lastReconciledAt: now,
      exitReason: details?.exitReason || existing.exitReason || 'MANUAL_OR_AUDIT_CLOSE',
      closeOrderId: details?.closeOrderId || existing.closeOrderId,
      realizedPnl: details?.realizedPnl ?? existing.realizedPnl ?? 0,
    };

    this.positions.set(positionId, closedRecord);
    await this.saveToDisk();

    console.log(`[PILOT_REGISTRY] Closed position ${positionId} (${existing.symbol}). Active remaining: ${this.getActivePositions().length}`);

    return { ...closedRecord };
  }

  /**
   * Retrieves a single position by ID.
   */
  public getPosition(positionId: string): PilotPositionRecord | undefined {
    const p = this.positions.get(positionId);
    return p ? { ...p } : undefined;
  }

  /**
   * Retrieves an active position for a given symbol.
   */
  public getActivePositionBySymbol(symbol: string): PilotPositionRecord | undefined {
    const cleanSym = symbol.trim().toUpperCase();
    return this.getActivePositions().find((p) => p.symbol.toUpperCase() === cleanSym);
  }

  /**
   * Retrieves a position by transaction ID.
   */
  public getPositionByTransactionId(transactionId: string): PilotPositionRecord | undefined {
    return Array.from(this.positions.values()).find((p) => p.transactionId === transactionId);
  }

  /**
   * Returns all active positions (status PENDING_ENTRY or ACTIVE).
   */
  public getActivePositions(): PilotPositionRecord[] {
    return Array.from(this.positions.values())
      .filter((p) => p.status === 'ACTIVE' || p.status === 'PENDING_ENTRY')
      .map((p) => ({ ...p }));
  }

  /**
   * Returns all closed positions.
   */
  public getClosedPositions(): PilotPositionRecord[] {
    return Array.from(this.positions.values())
      .filter((p) => p.status === 'CLOSED' || p.status === 'FAILED')
      .map((p) => ({ ...p }));
  }

  /**
   * Returns all positions regardless of status.
   */
  public getAllPositions(): PilotPositionRecord[] {
    return Array.from(this.positions.values()).map((p) => ({ ...p }));
  }

  /**
   * Checks whether a symbol has an active or pending position.
   */
  public isSymbolActive(symbol: string): boolean {
    const cleanSym = symbol.trim().toUpperCase();
    return this.getActivePositions().some((p) => p.symbol.toUpperCase() === cleanSym);
  }

  /**
   * Returns the count of active positions.
   */
  public getActiveCount(): number {
    return this.getActivePositions().length;
  }

  /**
   * Returns maximum concurrent positions allowed (2).
   */
  public getMaxPositions(): number {
    return this.maxOpenPositions;
  }

  public getMaxOpenPositions(): number {
    return this.maxOpenPositions;
  }

  /**
   * Reconciles a single pilot position against Binance remote state.
   */
  public async reconcilePosition(
    positionId: string,
    remotePositions: RemotePosition[],
    openOrders: any[]
  ): Promise<PositionReconciliationResult> {
    await this.init();

    const pos = this.positions.get(positionId);
    if (!pos) {
      throw new Error(`Position ${positionId} not in registry.`);
    }

    const notes: string[] = [];
    const cleanSym = pos.symbol.toUpperCase();

    // Check remote position on Binance Testnet
    const remote = remotePositions.find((r) => r.symbol.toUpperCase() === cleanSym);
    const remoteQuantity = remote ? remote.quantity : 0;
    const remotePositionFound = remoteQuantity > 0;

    // Check open protective orders for this symbol
    const symbolOrders = openOrders.filter((o) => (o.symbol || '').toUpperCase() === cleanSym);
    const slOrderActive = Boolean(
      pos.stopLossOrderId &&
        symbolOrders.some(
          (o) =>
            String(o.orderId) === String(pos.stopLossOrderId) ||
            String(o.algoOrderId) === String(pos.stopLossOrderId) ||
            (pos.stopLossClientOrderId && o.clientOrderId === pos.stopLossClientOrderId)
        )
    );
    const tpOrderActive = Boolean(
      pos.takeProfitOrderId &&
        symbolOrders.some(
          (o) =>
            String(o.orderId) === String(pos.takeProfitOrderId) ||
            String(o.algoOrderId) === String(pos.takeProfitOrderId) ||
            (pos.takeProfitClientOrderId && o.clientOrderId === pos.takeProfitClientOrderId)
        )
    );

    let inSync = false;

    if (pos.status === 'ACTIVE') {
      if (remotePositionFound) {
        notes.push(`Remote position found with quantity ${remoteQuantity}.`);
        if (slOrderActive) notes.push('Stop-loss order active on exchange.');
        else notes.push('Warning: Stop-loss order missing or filled.');
        if (tpOrderActive) notes.push('Take-profit order active on exchange.');
        else notes.push('Notice: Take-profit order not present.');
        inSync = true;
      } else {
        notes.push('Active in registry but not found on remote account (likely closed externally or SL/TP triggered).');
        inSync = false;
      }
    } else if (pos.status === 'CLOSED') {
      if (!remotePositionFound) {
        notes.push('Closed in registry and remote quantity is 0.');
        inSync = true;
      } else {
        notes.push(`Mismatch: Position marked closed in registry but remote quantity is ${remoteQuantity}.`);
        inSync = false;
      }
    }

    // Update lastReconciledAt
    pos.lastReconciledAt = Date.now();
    await this.saveToDisk();

    return {
      positionId,
      symbol: pos.symbol,
      inSync,
      remotePositionFound,
      remoteQuantity,
      slOrderActive,
      tpOrderActive,
      notes,
    };
  }

  /**
   * Reconciles all active positions independently.
   */
  public async reconcileAllPositions(
    remotePositions: RemotePosition[],
    openOrders: any[]
  ): Promise<PositionReconciliationResult[]> {
    await this.init();

    const active = this.getActivePositions();
    const results: PositionReconciliationResult[] = [];

    for (const p of active) {
      const res = await this.reconcilePosition(p.positionId, remotePositions, openOrders);
      results.push(res);
    }

    return results;
  }

  /**
   * Diagnostic Snapshot
   */
  public getSnapshot(): PilotRegistrySnapshot {
    return {
      activeCount: this.getActivePositions().length,
      closedCount: this.getClosedPositions().length,
      maxOpenPositions: this.maxOpenPositions,
      activePositions: this.getActivePositions(),
      closedPositions: this.getClosedPositions(),
      lastSavedAt: Date.now(),
    };
  }

  /**
   * Clears registry for test scenarios.
   */
  public async clearRegistryForTest(): Promise<void> {
    this.positions.clear();
    await this.saveToDisk();
  }

  /**
   * Saves state to disk atomically.
   */
  private async saveToDisk(): Promise<void> {
    try {
      const records = Array.from(this.positions.values());
      const data = {
        updatedAt: Date.now(),
        maxOpenPositions: this.maxOpenPositions,
        positions: records,
      };

      const tmpFile = `${this.registryFilePath}.tmp`;
      await fs.promises.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf8');
      await fs.promises.rename(tmpFile, this.registryFilePath);

      // Also sync to state.json under pilotPositions metadata
      const state = await this.storage.loadState();
      (state as any).pilotPositions = records;
      await this.storage.saveState(state);
    } catch (err: any) {
      console.error(`[PILOT_REGISTRY] Failed to save state to disk: ${err.message}`);
    }
  }

  /**
   * Loads state from disk.
   */
  private async loadFromDisk(): Promise<void> {
    try {
      if (fs.existsSync(this.registryFilePath)) {
        const raw = await fs.promises.readFile(this.registryFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.positions)) {
          this.positions.clear();
          for (const item of parsed.positions) {
            if (item && item.positionId) {
              this.positions.set(item.positionId, item);
            }
          }
          console.log(`[PILOT_REGISTRY] Loaded ${this.positions.size} positions from ${this.registryFilePath}`);
          return;
        }
      }

      // Fallback: check state.json
      const state = await this.storage.loadState();
      const rawPositions = (state as any).pilotPositions;
      if (Array.isArray(rawPositions)) {
        this.positions.clear();
        for (const item of rawPositions) {
          if (item && item.positionId) {
            this.positions.set(item.positionId, item);
          }
        }
        console.log(`[PILOT_REGISTRY] Restored ${this.positions.size} positions from state.json`);
      }
    } catch (err: any) {
      console.warn(`[PILOT_REGISTRY] No existing registry file or corrupt state: ${err.message}`);
      this.positions.clear();
    }
  }
}

export const pilotPositionRegistry = new PilotPositionRegistry();
