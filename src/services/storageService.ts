import fs from 'node:fs';
import path from 'node:path';
import type { BotSettings, Position, AccountBalance, BotSessionState } from '../types/trading';

/**
 * Schema for persistent server/worker state.
 * Stored safely in data/state.json without exposing credentials or API secrets.
 */
export interface PersistentBotState {
  version: number;
  updatedAt: number;
  botRunning: boolean;
  settings: Partial<BotSettings> | null;
  session: BotSessionState | null;
  trackedPositions: Position[];
  lastKnownAccountState: Partial<AccountBalance> | null;
  lastReconciliationTimestamp: number | null;
  metadata?: Record<string, unknown>;
}

export const DEFAULT_PERSISTENT_STATE: PersistentBotState = {
  version: 1,
  updatedAt: 0,
  botRunning: false,
  settings: null,
  session: null,
  trackedPositions: [],
  lastKnownAccountState: null,
  lastReconciliationTimestamp: null,
};

/**
 * StorageService provides an abstraction for the persistent background worker
 * replacing client-side localStorage with atomic file-system persistence.
 *
 * Designed to write atomically (temp file -> rename) to avoid state corruption.
 */
export class StorageService {
  private stateFilePath: string;
  private stateDir: string;
  private cachedState: PersistentBotState;

  constructor(customFilePath?: string) {
    try {
      const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
      this.stateDir = path.resolve(cwd, 'data');
      this.stateFilePath = customFilePath || path.resolve(this.stateDir, 'state.json');
    } catch {
      this.stateDir = './data';
      this.stateFilePath = customFilePath || './data/state.json';
    }

    this.cachedState = { ...DEFAULT_PERSISTENT_STATE };
  }

  /**
   * Loads state from persistent storage or returns cached/default state.
   */
  public async loadState(): Promise<PersistentBotState> {
    try {
      if (!fs.existsSync(this.stateFilePath)) {
        return { ...this.cachedState };
      }

      const raw = fs.readFileSync(this.stateFilePath, 'utf8');
      if (!raw || !raw.trim()) {
        return { ...this.cachedState };
      }

      const parsed = JSON.parse(raw);
      this.cachedState = {
        ...DEFAULT_PERSISTENT_STATE,
        ...parsed,
        trackedPositions: Array.isArray(parsed.trackedPositions) ? parsed.trackedPositions : [],
      };
      return { ...this.cachedState };
    } catch (err) {
      console.warn('[StorageService] Error reading state.json, falling back to cache:', err);
      return { ...this.cachedState };
    }
  }

  /**
   * Atomically saves state to data/state.json using a temp file + rename strategy.
   */
  public async saveState(partial: Partial<PersistentBotState>): Promise<PersistentBotState> {
    this.cachedState = {
      ...this.cachedState,
      ...partial,
      updatedAt: Date.now(),
    };

    try {
      const targetDir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const tempPath = `${this.stateFilePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
      const dataString = JSON.stringify(this.cachedState, null, 2);

      // Write to temp file then atomic rename to prevent corruption on crash
      fs.writeFileSync(tempPath, dataString, 'utf8');
      fs.renameSync(tempPath, this.stateFilePath);
    } catch (err) {
      console.error('[StorageService] Failed to persist state to disk:', err);
    }

    return { ...this.cachedState };
  }

  public getStateSync(): PersistentBotState {
    return { ...this.cachedState };
  }

  public getBotRunning(): boolean {
    return this.cachedState.botRunning;
  }

  public async setBotRunning(running: boolean): Promise<void> {
    await this.saveState({ botRunning: running });
  }

  public getSettings(): Partial<BotSettings> | null {
    return this.cachedState.settings;
  }

  public async setSettings(settings: Partial<BotSettings>): Promise<void> {
    await this.saveState({ settings });
  }

  public getSession(): BotSessionState | null {
    return this.cachedState.session;
  }

  public async setSession(session: BotSessionState | null): Promise<void> {
    await this.saveState({ session });
  }

  public getTrackedPositions(): Position[] {
    return [...this.cachedState.trackedPositions];
  }

  public async setTrackedPositions(positions: Position[]): Promise<void> {
    await this.saveState({ trackedPositions: positions });
  }

  public getLastKnownAccountState(): Partial<AccountBalance> | null {
    return this.cachedState.lastKnownAccountState;
  }

  public async setLastKnownAccountState(account: Partial<AccountBalance>): Promise<void> {
    await this.saveState({ lastKnownAccountState: account });
  }

  public getLastReconciliationTimestamp(): number | null {
    return this.cachedState.lastReconciliationTimestamp;
  }

  public async setLastReconciliationTimestamp(ts: number): Promise<void> {
    await this.saveState({ lastReconciliationTimestamp: ts });
  }

  public async clearTrackedPositions(): Promise<void> {
    await this.saveState({ trackedPositions: [] });
  }

  public async resetState(): Promise<void> {
    await this.saveState({ ...DEFAULT_PERSISTENT_STATE });
  }
}

export const storageService = new StorageService();
