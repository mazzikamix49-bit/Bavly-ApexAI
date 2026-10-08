import fs from 'node:fs';
import path from 'node:path';
import { storageService, PersistentBotState } from '../services/storageService';
import { tradingLoopEngine } from './tradingLoopEngine';
import { accountReconciliationService, ReconciliationResult } from './accountReconciliation';
import { areTestnetCredentialsConfigured } from './workerConstants';
import { executionTransactionStore } from './executionTransactionStore';

/**
 * Strict Safe Boot Flag:
 * When true, strictly forbids:
 * - Scanner / Market Scans
 * - Entry orders
 * - Exit orders
 * - Order cancellations on exchange
 * - Opening / closing positions
 * - Any live or testnet Binance trade execution requests
 */
export const SAFE_BOOT_MODE = true;

export class WorkerEngine {
  private isRunning: boolean = false;
  private persistentState: PersistentBotState | null = null;
  private lockFilePath: string;
  private hasLock: boolean = false;
  private activeTimers: NodeJS.Timeout[] = [];
  private lastReconciliationResult: ReconciliationResult | null = null;

  constructor() {
    const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
    this.lockFilePath = path.resolve(cwd, 'data', 'worker.lock');
  }

  /**
   * Acquire a file lock to prevent duplicate worker instances.
   */
  private acquireLock(): void {
    const dir = path.dirname(this.lockFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.lockFilePath)) {
      try {
        const existingPidStr = fs.readFileSync(this.lockFilePath, 'utf8').trim();
        const existingPid = parseInt(existingPidStr, 10);

        if (!isNaN(existingPid)) {
          // Check if process is still alive
          try {
            process.kill(existingPid, 0);
            // Process responded, instance is already actively running
            console.error(`[WORKER] Error: Another worker instance is already running (PID: ${existingPid})`);
            process.exit(1);
          } catch (e: any) {
            // ESRCH means process does not exist -> stale lockfile
            if (e.code === 'ESRCH') {
              fs.unlinkSync(this.lockFilePath);
            } else {
              throw e;
            }
          }
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn('[WORKER] Warning inspecting existing lockfile:', err.message);
        }
      }
    }

    // Write current PID to lockfile
    fs.writeFileSync(this.lockFilePath, String(process.pid), 'utf8');
    this.hasLock = true;
  }

  /**
   * Release the file lock on shutdown.
   */
  private releaseLock(): void {
    if (this.hasLock && fs.existsSync(this.lockFilePath)) {
      try {
        fs.unlinkSync(this.lockFilePath);
        this.hasLock = false;
      } catch (err: any) {
        console.warn('[WORKER] Failed to remove worker lockfile:', err.message);
      }
    }
  }

  /**
   * Worker Startup Lifecycle:
   * start() -> loadPersistentState() -> initializeServices() -> safeBootCheck() -> READY
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[WORKER] Worker is already running.');
      return;
    }

    // 1. Acquire single instance lock
    this.acquireLock();

    // 2. Startup logs
    console.log('[WORKER] Starting...');
    console.log('[WORKER] Loading persistent state...');

    // 3. Load state from data/state.json via storageService
    this.persistentState = await storageService.loadState();
    console.log('[WORKER] Persistent state loaded.');

    // 3b. Recover non-terminal execution transactions after restart (Read-Only Safety)
    try {
      const recoveryResult = await executionTransactionStore.recoverNonTerminalTransactions();
      if (recoveryResult.recoveredCount > 0) {
        console.log(`[WORKER] Interrupted execution transactions recovered: ${recoveryResult.recoveredCount} flagged for manual review.`);
      }
    } catch (err) {
      console.warn('[WORKER] Failed to recover non-terminal transactions on startup:', err);
    }

    const botState = this.persistentState.botRunning ? 'RUNNING' : 'STOPPED';
    console.log(`[WORKER] Bot state: ${botState}`);

    // 4. Safe Boot Guard check
    if (SAFE_BOOT_MODE) {
      console.log('[WORKER] SAFE BOOT MODE: ENABLED');
      console.log('[WORKER] Trading loop: DISABLED');
      console.log('[WORKER] Binance orders: DISABLED');

      if (this.persistentState.botRunning) {
        console.log('[WORKER] Worker started in SAFE BOOT MODE.');
        console.log('[WORKER] Trading loop is NOT active.');
        console.log('[WORKER] No Binance orders will be submitted.');
      }
    }

    this.isRunning = true;
    console.log('[WORKER] Worker ready.');
  }

  /**
   * Placeholder hook for starting trading loop in future phases.
   * Strictly guarded by SAFE_BOOT_MODE via tradingLoopEngine.
   */
  public async startTradingLoop(): Promise<void> {
    tradingLoopEngine.start();
  }

  /**
   * Placeholder hook for stopping trading loop.
   */
  public async stopTradingLoop(): Promise<void> {
    tradingLoopEngine.stop();
  }

  /**
   * Placeholder hook for Binance reconciliation in future phases.
   * Strictly guarded by SAFE_BOOT_MODE.
   */
  public async reconcileWithBinance(): Promise<void> {
    if (SAFE_BOOT_MODE) {
      console.log('[WORKER] Binance reconciliation skipped: SAFE_BOOT_MODE is active.');
      return;
    }
  }

  /**
   * Placeholder hook for Account Equity refresh in future phases.
   * Strictly guarded by SAFE_BOOT_MODE.
   */
  public async refreshAccountEquity(): Promise<void> {
    if (SAFE_BOOT_MODE) {
      console.log('[WORKER] Account equity refresh skipped: SAFE_BOOT_MODE is active.');
      return;
    }
  }

  /**
   * Graceful Shutdown Handler:
   * Handles SIGINT and SIGTERM without issuing close orders or closing positions.
   */
  public async stop(): Promise<void> {
    console.log('[WORKER] Worker shutdown requested.');

    // Stop trading loop if running
    tradingLoopEngine.stop();

    // Clear any timers
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers = [];

    // Save final state safely using storageService
    if (this.persistentState) {
      await storageService.saveState({
        updatedAt: Date.now(),
      });
    }

    // Release lockfile
    this.releaseLock();

    this.isRunning = false;

    console.log('[WORKER] Worker stopped safely.');
  }

  private workerStartedAt: number = Date.now();

  /**
   * Returns current worker status reading directly from persistent state & memory.
   */
  public async getStatusAsync(): Promise<{
    workerRunning: boolean;
    botRunning: boolean;
    safeBootMode: boolean;
    tradingLoopActive: boolean;
    uptimeSeconds: number;
    reconciliationStatus?: ReconciliationResult['status'];
    lastReconciliationTimestamp?: number | null;
    accountStateAvailable?: boolean;
    credentialsConfigured?: boolean;
  }> {
    const state = await storageService.loadState();
    this.persistentState = state;
    const now = Date.now();
    const uptimeSeconds = Math.max(0, Math.floor((now - this.workerStartedAt) / 1000));

    return {
      workerRunning: this.isRunning,
      botRunning: Boolean(state.botRunning),
      safeBootMode: SAFE_BOOT_MODE,
      tradingLoopActive: tradingLoopEngine.isRunning(),
      uptimeSeconds,
      credentialsConfigured: areTestnetCredentialsConfigured(),
      reconciliationStatus: this.lastReconciliationResult?.status || 'UNAVAILABLE',
      lastReconciliationTimestamp: this.lastReconciliationResult?.timestamp || state.lastReconciliationTimestamp || null,
      accountStateAvailable: this.lastReconciliationResult?.accountStateAvailable || false,
    };
  }

  /**
   * Returns persistent bot state loaded directly from disk.
   */
  public async getPersistentState(): Promise<PersistentBotState> {
    const state = await storageService.loadState();
    this.persistentState = state;
    return state;
  }

  /**
   * Executes READ-ONLY account reconciliation between persistent state and remote account.
   */
  public async reconcileAccountState(): Promise<ReconciliationResult> {
    const result = await accountReconciliationService.reconcile();
    this.lastReconciliationResult = result;
    return result;
  }

  /**
   * Returns last recorded reconciliation result.
   */
  public getLastReconciliationResult(): ReconciliationResult | null {
    return this.lastReconciliationResult;
  }

  /**
   * Request bot start via Control API.
   * Strictly guarded by SAFE_BOOT_MODE: updates state in storage, but does NOT start trading.
   */
  public async requestBotStart(): Promise<{
    success: boolean;
    workerRunning: boolean;
    botRunning: boolean;
    safeBootMode: boolean;
    tradingLoopActive: boolean;
    message: string;
  }> {
    console.log('[WORKER] Bot start requested via Control API.');
    await storageService.setBotRunning(true);
    if (this.persistentState) {
      this.persistentState.botRunning = true;
    }

    // Attempt start on tradingLoopEngine (which will be refused by SAFE_BOOT_MODE guard)
    tradingLoopEngine.start();

    if (SAFE_BOOT_MODE) {
      console.log('[WORKER] SAFE BOOT MODE is ACTIVE. Trading loop remains DISABLED.');
      console.log('[WORKER] No Binance orders will be submitted.');
    }

    return {
      success: true,
      workerRunning: this.isRunning,
      botRunning: true,
      safeBootMode: SAFE_BOOT_MODE,
      tradingLoopActive: tradingLoopEngine.isRunning(),
      message: 'Worker start requested. SAFE_BOOT_MODE prevents trading.',
    };
  }

  /**
   * Request bot stop via Control API.
   * Updates state in storageService, clears worker timers, marks bot STOPPED.
   */
  public async requestBotStop(): Promise<{
    success: boolean;
    workerRunning: boolean;
    botRunning: boolean;
    safeBootMode: boolean;
    tradingLoopActive: boolean;
    message: string;
  }> {
    console.log('[WORKER] Bot stop requested via Control API.');
    await storageService.setBotRunning(false);
    if (this.persistentState) {
      this.persistentState.botRunning = false;
    }

    // Stop tradingLoopEngine
    tradingLoopEngine.stop();

    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers = [];

    console.log('[WORKER] Bot state is now STOPPED.');

    return {
      success: true,
      workerRunning: this.isRunning,
      botRunning: false,
      safeBootMode: SAFE_BOOT_MODE,
      tradingLoopActive: tradingLoopEngine.isRunning(),
      message: 'Worker stopped. Bot state is STOPPED.',
    };
  }

  public getStatus(): { isRunning: boolean; isTradingLoopActive: boolean; safeBoot: boolean } {
    return {
      isRunning: this.isRunning,
      isTradingLoopActive: tradingLoopEngine.isRunning(),
      safeBoot: SAFE_BOOT_MODE,
    };
  }
}

export const workerEngine = new WorkerEngine();
