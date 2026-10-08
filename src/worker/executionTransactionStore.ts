import { TradeDirection } from '../types/trading';
import { ExecutionPlan } from './testnetExecutionBridge';
import { ExecutionTransactionState } from './testnetExecutionAdapter';
import { storageService, StorageService } from '../services/storageService';

/**
 * Status indicating whether a transaction requires reconciliation
 * and the outcome of any read-only reconciliation inspection.
 */
export type TransactionReconciliationStatus =
  | 'NOT_REQUIRED'
  | 'REQUIRES_RECONCILIATION'
  | 'RECONCILED_NO_POSITION'
  | 'RECONCILED_POSITION_PRESENT'
  | 'REQUIRES_MANUAL_REVIEW'
  | 'INSUFFICIENT_INFORMATION';

/**
 * PersistedExecutionTransaction
 *
 * Persisted schema for execution transactions.
 * STRICT NON-SECRET POLICY:
 * Contains ONLY non-sensitive operational metadata.
 * NEVER stores API secrets, API keys, private signatures, or auth tokens.
 */
export interface PersistedExecutionTransaction {
  transactionId: string;
  planFingerprint: string;
  authorizationId: string;
  symbol: string;
  side: TradeDirection;
  requestedQuantity: number;
  state: ExecutionTransactionState;
  entryOrderId?: string | null;
  stopLossOrderId?: string | null;
  takeProfitOrderId?: string | null;
  entryClientOrderId?: string | null;
  stopLossClientOrderId?: string | null;
  takeProfitClientOrderId?: string | null;
  executedQuantity?: number | null;
  executedPrice?: number | null;
  failureCode?: string | null;
  failureReason?: string | null;
  startedAt: number;
  completedAt?: number | null;
  lastUpdatedAt: number;
  dryRunOnly: boolean;
  testnetOnly: boolean;
  reconciliationStatus: TransactionReconciliationStatus;
  reconciliationNotes?: string | null;
}

/**
 * ExecutionTransactionStore
 *
 * Provides persistent, atomic storage for execution transactions using
 * the existing storageService (data/state.json).
 * Guarantees zero credential leakage and restart safety.
 */
export class ExecutionTransactionStore {
  private readonly storage: StorageService;
  private readonly maxStoredTransactions: number = 100;

  constructor(storage: StorageService = storageService) {
    this.storage = storage;
  }

  /**
   * Loads all persisted execution transactions.
   */
  public async loadAll(): Promise<PersistedExecutionTransaction[]> {
    const state = await this.storage.loadState();
    const raw = (state as any).executionTransactions;
    if (Array.isArray(raw)) {
      return raw;
    }
    return [];
  }

  /**
   * Retrieves a single persisted transaction by ID.
   */
  public async getTransaction(transactionId: string): Promise<PersistedExecutionTransaction | null> {
    const all = await this.loadAll();
    const found = all.find((t) => t.transactionId === transactionId);
    return found ? { ...found } : null;
  }

  /**
   * Directly creates or upserts a transaction record.
   */
  public async createTransaction(record: PersistedExecutionTransaction): Promise<void> {
    await this.upsertTransaction(record);
  }

  /**
   * Records the initial ENTRY_SENT transition atomically before transport dispatch.
   */
  public async recordTransactionStart(
    plan: ExecutionPlan,
    authorizationId: string,
    planFingerprint: string,
    transactionId: string,
    clientOrderIds?: {
      entryClientOrderId?: string;
      stopLossClientOrderId?: string;
      takeProfitClientOrderId?: string;
    }
  ): Promise<PersistedExecutionTransaction> {
    const now = Date.now();
    const record: PersistedExecutionTransaction = {
      transactionId,
      planFingerprint,
      authorizationId,
      symbol: plan.symbol.toUpperCase().trim(),
      side: plan.side,
      requestedQuantity: plan.quantity,
      state: 'ENTRY_SENT',
      entryOrderId: null,
      stopLossOrderId: null,
      takeProfitOrderId: null,
      entryClientOrderId: clientOrderIds?.entryClientOrderId || null,
      stopLossClientOrderId: clientOrderIds?.stopLossClientOrderId || null,
      takeProfitClientOrderId: clientOrderIds?.takeProfitClientOrderId || null,
      executedQuantity: null,
      executedPrice: null,
      failureCode: null,
      failureReason: null,
      startedAt: now,
      completedAt: null,
      lastUpdatedAt: now,
      dryRunOnly: true,
      testnetOnly: true,
      reconciliationStatus: 'NOT_REQUIRED',
      reconciliationNotes: null,
    };

    await this.upsertTransaction(record);
    return { ...record };
  }

  /**
   * Records an atomic transition update for an active or completed transaction.
   */
  public async recordTransition(
    transactionId: string,
    patch: Partial<PersistedExecutionTransaction>
  ): Promise<PersistedExecutionTransaction | null> {
    const all = await this.loadAll();
    const index = all.findIndex((t) => t.transactionId === transactionId);
    const now = Date.now();

    if (index === -1) {
      console.warn(`[ExecutionTransactionStore] Cannot update missing transaction ${transactionId}`);
      return null;
    }

    const updated: PersistedExecutionTransaction = {
      ...all[index],
      ...patch,
      lastUpdatedAt: now,
    };

    all[index] = updated;
    await this.persistTransactions(all);
    return { ...updated };
  }

  public async updateTransaction(
    transactionId: string,
    patch: Partial<PersistedExecutionTransaction>
  ): Promise<PersistedExecutionTransaction | null> {
    return this.recordTransition(transactionId, patch);
  }

  /**
   * Retrieves set of consumed authorization IDs from persisted state.
   * Ensures idempotency survives worker restart.
   */
  public async getConsumedAuthIds(): Promise<Set<string>> {
    const all = await this.loadAll();
    const set = new Set<string>();
    for (const t of all) {
      if (t.authorizationId) {
        set.add(t.authorizationId);
      }
    }
    return set;
  }

  /**
   * Retrieves set of consumed plan fingerprints from persisted state.
   * Ensures duplicate execution is blocked even across restarts.
   */
  public async getConsumedFingerprints(): Promise<Set<string>> {
    const all = await this.loadAll();
    const set = new Set<string>();
    for (const t of all) {
      if (t.planFingerprint) {
        set.add(t.planFingerprint);
      }
    }
    return set;
  }

  /**
   * Identifies non-terminal transactions interrupted by a worker restart
   * and marks them as requiring reconciliation.
   *
   * STRICT SAFETY INVARIANTS:
   * - NEVER marks them FULL_EXECUTION_CONFIRMED.
   * - NEVER sends any automatic recovery order.
   */
  public async recoverNonTerminalTransactions(): Promise<{
    recoveredCount: number;
    transactions: PersistedExecutionTransaction[];
  }> {
    const all = await this.loadAll();
    let modified = false;
    const recovered: PersistedExecutionTransaction[] = [];

    for (let i = 0; i < all.length; i++) {
      const tx = all[i];

      // Terminal states that do NOT need restart reconciliation
      if (tx.state === 'FULL_EXECUTION_CONFIRMED') {
        continue;
      }

      // If already marked with manual review or terminal failure with no entry
      if (tx.state === 'EXECUTION_FAILED' && tx.reconciliationStatus !== 'REQUIRES_MANUAL_REVIEW') {
        continue;
      }

      // Incomplete states interrupted by restart
      if (tx.state === 'ENTRY_SENT') {
        tx.reconciliationStatus = 'REQUIRES_MANUAL_REVIEW';
        tx.reconciliationNotes = 'Process restarted while entry order was in-flight. Remote exchange state unknown.';
        tx.lastUpdatedAt = Date.now();
        modified = true;
        recovered.push({ ...tx });
      } else if (tx.state === 'ENTRY_CONFIRMED' || tx.state === 'PROTECTIVE_ORDERS_SENT') {
        tx.state = 'EXECUTION_PARTIAL';
        tx.reconciliationStatus = 'REQUIRES_MANUAL_REVIEW';
        tx.reconciliationNotes = 'Process restarted after entry confirmation but before full protective orders were confirmed.';
        tx.lastUpdatedAt = Date.now();
        modified = true;
        recovered.push({ ...tx });
      } else if (tx.state === 'EXECUTION_PARTIAL') {
        tx.reconciliationStatus = 'REQUIRES_MANUAL_REVIEW';
        if (!tx.reconciliationNotes) {
          tx.reconciliationNotes = 'Partial execution requires position reconciliation.';
        }
        tx.lastUpdatedAt = Date.now();
        modified = true;
        recovered.push({ ...tx });
      }
    }

    if (modified) {
      await this.persistTransactions(all);
    }

    return {
      recoveredCount: recovered.length,
      transactions: recovered,
    };
  }

  private async upsertTransaction(record: PersistedExecutionTransaction): Promise<void> {
    const all = await this.loadAll();
    const existingIndex = all.findIndex((t) => t.transactionId === record.transactionId);

    if (existingIndex >= 0) {
      all[existingIndex] = record;
    } else {
      all.unshift(record); // newest first
    }

    // Cap stored transactions to prevent unbounded growth
    if (all.length > this.maxStoredTransactions) {
      all.length = this.maxStoredTransactions;
    }

    await this.persistTransactions(all);
  }

  private async persistTransactions(transactions: PersistedExecutionTransaction[]): Promise<void> {
    await this.storage.saveState({
      executionTransactions: transactions,
    } as any);
  }
}

export const executionTransactionStore = new ExecutionTransactionStore();
