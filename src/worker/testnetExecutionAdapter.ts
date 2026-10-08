import crypto from 'node:crypto';
import {
  TradeDirection,
  BotSettings,
  Position,
  CapitalProfile,
} from '../types/trading';
import { ExecutionPlan } from './testnetExecutionBridge';
import { executionPreflight, PreflightResult, PreflightOverrides } from './executionPreflight';
import { SAFE_BOOT_MODE } from './workerEngine';
import { BINANCE_FUTURES_ACCOUNT_BASE_URL } from './workerConstants';
import { storageService, StorageService } from '../services/storageService';
import { executionPolicy, ExecutionPolicyConfig, ExecutionPolicyResult } from './executionPolicy';
import { executionTransactionStore, ExecutionTransactionStore } from './executionTransactionStore';

/**
 * Hard Safety Default: Execution is disabled by default.
 * Cannot be toggled on automatically.
 */
export const EXECUTION_ENABLED_DEFAULT = false;

/**
 * Execution Transaction State Machine States
 */
export type ExecutionTransactionState =
  | 'ENTRY_NOT_SENT'
  | 'ENTRY_SENT'
  | 'ENTRY_CONFIRMED'
  | 'PROTECTIVE_ORDERS_SENT'
  | 'FULL_EXECUTION_CONFIRMED'
  | 'EXECUTION_PARTIAL'
  | 'EXECUTION_FAILED';

// Retained for backward-compatibility with earlier interfaces
export type ExecutionStepStatus = ExecutionTransactionState;

export interface ExecutionAuthorization {
  authorizationId: string;
  createdAt: number;
  expiresAt: number;
  planFingerprint: string;
  authorizedSymbol: string;
  authorizedSide: TradeDirection;
  authorizedQuantity: number;
  authorizedEntryPrice: number;
  testnetOnly: true;
  singleUse: true;
  consumed: boolean;
}

export interface BinanceOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
  positionSide?: 'BOTH' | 'LONG' | 'SHORT';
  clientOrderId?: string;
}

export interface BinanceOrderResponse {
  success: boolean;
  orderId?: string | number;
  symbol?: string;
  status?: string;
  clientOrderId?: string;
  avgPrice?: string;
  executedQty?: string;
  error?: string;
}

/**
 * ExecutionTransactionResult
 * Detailed, typed transaction outcome representing all state transitions.
 */
export interface ExecutionTransactionResult {
  transactionId: string;
  planFingerprint: string;
  authorizationId: string;
  state: ExecutionTransactionState;
  status: ExecutionTransactionState; // backward-compatibility alias
  success: boolean;
  entryResult: BinanceOrderResponse | null;
  stopResult: BinanceOrderResponse | null;
  takeProfitResult: BinanceOrderResponse | null;
  executionPerformed: boolean;
  fullyConfirmed: boolean;
  partialExecution: boolean;
  failureCode: string | null;
  failureReason: string | null;
  rejectionCode?: string; // backward-compatibility alias
  rejectionReason?: string; // backward-compatibility alias
  startedAt: number;
  completedAt: number | null;
  timestamp: number; // backward-compatibility alias
  dryRunOnly: boolean;
  requestsCount: number;
  executedQuantity?: number;
  executedPrice?: number;
  entryOrderId?: string;
  stopLossOrderId?: string;
  takeProfitOrderId?: string;
  entryClientOrderId?: string;
  stopLossClientOrderId?: string;
  takeProfitClientOrderId?: string;
}

// Backward-compatibility alias
export type ExecutionResultPayload = ExecutionTransactionResult;

export interface BinanceOrderTransport {
  sendOrder(request: BinanceOrderRequest): Promise<BinanceOrderResponse>;
  queryOrder?(symbol: string, orderId?: string | number, clientOrderId?: string): Promise<any>;
  cancelOrder?(symbol: string, orderId?: string | number, clientOrderId?: string): Promise<boolean>;
  getOpenOrders?(symbol?: string): Promise<any[]>;
  setLeverage?(symbol: string, leverage: number): Promise<{ success: boolean; leverage?: number; maxNotionalValue?: string; error?: string }>;
}

export interface MockTransportBehavior {
  failEntry?: boolean;
  failStop?: boolean;
  failTakeProfit?: boolean;
  simulateTimeout?: boolean;
  simulateMalformed?: boolean;
  entryError?: string;
  stopError?: string;
  takeProfitError?: string;
}

/**
 * Mock Binance Order Transport
 * Strictly isolated in-memory transport. Never sends network requests.
 * Records all requests for deterministic auditing.
 */
export class MockBinanceOrderTransport implements BinanceOrderTransport {
  public requests: BinanceOrderRequest[] = [];
  public behavior: MockTransportBehavior = {};

  constructor(behavior?: MockTransportBehavior) {
    if (behavior) {
      this.behavior = { ...behavior };
    }
  }

  public get shouldFail(): boolean {
    return Boolean(this.behavior.failEntry);
  }
  public set shouldFail(val: boolean) {
    this.behavior.failEntry = val;
  }
  public get failureError(): string {
    return this.behavior.entryError || 'Simulated transport failure';
  }
  public set failureError(val: string) {
    this.behavior.entryError = val;
  }

  public setBehavior(behavior: MockTransportBehavior): void {
    this.behavior = { ...behavior };
  }

  public async sendOrder(request: BinanceOrderRequest): Promise<BinanceOrderResponse> {
    this.requests.push({ ...request });

    if (this.behavior.simulateTimeout) {
      throw new Error('ETIMEDOUT: Connection to Binance Testnet timed out');
    }

    if (this.behavior.simulateMalformed) {
      return {
        success: false,
        error: 'MALFORMED_RESPONSE: Missing orderId or corrupt exchange payload',
      };
    }

    // Determine order category
    if (!request.reduceOnly) {
      // Main entry order
      if (this.behavior.failEntry) {
        return {
          success: false,
          error: this.behavior.entryError || 'Simulated entry order failure',
        };
      }
    } else if (request.reduceOnly === true) {
      if (request.type === 'STOP_MARKET') {
        if (this.behavior.failStop) {
          return {
            success: false,
            error: this.behavior.stopError || 'Simulated stop-loss rejection',
          };
        }
      } else if (request.type === 'TAKE_PROFIT_MARKET') {
        if (this.behavior.failTakeProfit) {
          return {
            success: false,
            error: this.behavior.takeProfitError || 'Simulated take-profit rejection',
          };
        }
      }
    }

    return {
      success: true,
      orderId: `mock-order-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      symbol: request.symbol,
      status: 'NEW',
      clientOrderId: request.clientOrderId || `mock-client-${Date.now()}`,
      avgPrice: request.price ? request.price.toString() : '0',
      executedQty: request.quantity.toString(),
    };
  }

  public clear(): void {
    this.requests = [];
    this.behavior = {};
  }
}

/**
 * Computes a deterministic SHA-256 fingerprint of an ExecutionPlan.
 * Detects any mutation to symbol, side, prices, quantity, leverage, or protective orders.
 */
export function computePlanFingerprint(plan: ExecutionPlan): string {
  const payload = {
    symbol: plan.symbol.toUpperCase().trim(),
    side: plan.side,
    quantity: plan.quantity,
    entryPrice: plan.entryPrice,
    stopLossPrice: plan.stopLossPrice,
    takeProfitPrice: plan.takeProfitPrice,
    leverage: plan.leverage,
    orderType: plan.orderType,
    stopLossOrderType: plan.stopLossOrderType,
    takeProfitOrderType: plan.takeProfitOrderType,
    reduceOnlyForExit: plan.reduceOnlyForExit,
    entryOrder: {
      symbol: plan.entryOrder.symbol,
      side: plan.entryOrder.side,
      type: plan.entryOrder.type,
      quantity: plan.entryOrder.quantity,
      price: plan.entryOrder.price,
      reduceOnly: plan.entryOrder.reduceOnly,
    },
    stopLossOrder: {
      symbol: plan.stopLossOrder.symbol,
      side: plan.stopLossOrder.side,
      type: plan.stopLossOrder.type,
      quantity: plan.stopLossOrder.quantity,
      stopPrice: plan.stopLossOrder.stopPrice,
      reduceOnly: plan.stopLossOrder.reduceOnly,
    },
    takeProfitOrder: plan.takeProfitOrder
      ? {
          symbol: plan.takeProfitOrder.symbol,
          side: plan.takeProfitOrder.side,
          type: plan.takeProfitOrder.type,
          quantity: plan.takeProfitOrder.quantity,
          stopPrice: plan.takeProfitOrder.stopPrice,
          reduceOnly: plan.takeProfitOrder.reduceOnly,
        }
      : null,
  };

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export interface ExecutionAdapterOverrides {
  bypassSafeBootForMockTest?: boolean;
  bypassExecutionDisabledForMockTest?: boolean;
  targetBaseUrl?: string;
  preflightOverrides?: PreflightOverrides;
  currentPriceOverride?: number;
  currentEquityOverride?: number;
  policyOverrides?: Partial<ExecutionPolicyConfig>;
  openPositionsOverride?: Position[];
  capitalProfileOverride?: CapitalProfile;
  positionModeOverride?: 'ONE_WAY' | 'HEDGE';
  entryClientOrderIdOverride?: string;
  stopLossClientOrderIdOverride?: string;
  takeProfitClientOrderIdOverride?: string;
}

/**
 * TestnetExecutionAdapter
 *
 * Implements strict transaction state machine for Binance Futures Testnet.
 * All order execution is disabled by default.
 */
export class TestnetExecutionAdapter {
  private executionEnabled: boolean = EXECUTION_ENABLED_DEFAULT;
  private activeAuthorization: ExecutionAuthorization | null = null;
  private consumedAuthIds: Set<string> = new Set();
  private consumedFingerprints: Set<string> = new Set();
  private lastResult: ExecutionTransactionResult | null = null;
  private readonly defaultTtlMs: number = 60_000; // 60 seconds TTL
  private readonly storage: StorageService;
  private readonly txStore: ExecutionTransactionStore;

  constructor(
    storage: StorageService = storageService,
    txStore: ExecutionTransactionStore = executionTransactionStore
  ) {
    this.storage = storage;
    this.txStore = txStore;
  }

  public isEnabled(): boolean {
    return this.executionEnabled;
  }

  public isArmed(): boolean {
    if (!this.activeAuthorization) return false;
    if (this.activeAuthorization.consumed) return false;
    if (Date.now() > this.activeAuthorization.expiresAt) return false;
    return true;
  }

  public getAuthorization(): ExecutionAuthorization | null {
    if (!this.activeAuthorization) return null;
    return { ...this.activeAuthorization };
  }

  public getActiveAuthorization(): ExecutionAuthorization | null {
    return this.getAuthorization();
  }

  public getLastResult(): ExecutionTransactionResult | null {
    return this.lastResult ? { ...this.lastResult } : null;
  }

  public arm(plan: ExecutionPlan, ttlMs: number = this.defaultTtlMs): ExecutionAuthorization {
    const now = Date.now();
    const fingerprint = computePlanFingerprint(plan);
    const authId = `auth-${now}-${crypto.randomBytes(4).toString('hex')}`;

    const auth: ExecutionAuthorization = {
      authorizationId: authId,
      createdAt: now,
      expiresAt: now + ttlMs,
      planFingerprint: fingerprint,
      authorizedSymbol: plan.symbol.toUpperCase().trim(),
      authorizedSide: plan.side,
      authorizedQuantity: plan.quantity,
      authorizedEntryPrice: plan.entryPrice,
      testnetOnly: true,
      singleUse: true,
      consumed: false,
    };

    this.activeAuthorization = auth;
    return { ...auth };
  }

  public disarm(): void {
    if (this.activeAuthorization) {
      this.activeAuthorization.consumed = true;
    }
    this.activeAuthorization = null;
  }

  /**
   * Executes an authorized ExecutionPlan through the strict transaction state machine.
   */
  public async execute(
    plan: ExecutionPlan,
    authorization: ExecutionAuthorization | null,
    orderTransport: BinanceOrderTransport,
    overrides?: ExecutionAdapterOverrides
  ): Promise<ExecutionTransactionResult> {
    const now = Date.now();
    const transactionId = `txn-${now}-${Math.random().toString(36).substring(2, 8)}`;
    const currentFingerprint = computePlanFingerprint(plan);
    const auth = authorization || this.activeAuthorization;

    // Guard 1: Hard Safety Default - Execution Disabled
    if (!this.executionEnabled && !overrides?.bypassExecutionDisabledForMockTest) {
      return this.recordFailure(
        transactionId,
        auth?.authorizationId || 'none',
        currentFingerprint,
        'EXECUTION_DISABLED',
        'Execution is strictly disabled by default. No Binance orders can be sent.',
        now
      );
    }

    // Guard 2: SAFE_BOOT_MODE Block
    if (SAFE_BOOT_MODE && !overrides?.bypassSafeBootForMockTest) {
      return this.recordFailure(
        transactionId,
        auth?.authorizationId || 'none',
        currentFingerprint,
        'EXECUTION_BLOCKED_SAFE_BOOT',
        'Execution is strictly blocked while SAFE_BOOT_MODE is active. No Binance orders can be sent.',
        now
      );
    }

    // Guard 3: Target Base URL MUST be Binance Futures Testnet
    const targetUrl = overrides?.targetBaseUrl || BINANCE_FUTURES_ACCOUNT_BASE_URL;
    if (targetUrl.includes('fapi.binance.com') || !targetUrl.includes('testnet.binancefuture.com')) {
      return this.recordFailure(
        transactionId,
        auth?.authorizationId || 'none',
        currentFingerprint,
        'EXECUTION_BLOCKED_PRODUCTION_FORBIDDEN',
        `Production URL detected (${targetUrl}). Only Binance Futures Testnet is allowed. Execution aborted.`,
        now
      );
    }

    // Guard 4: Explicit Authorization Required
    if (!auth) {
      return this.recordFailure(
        transactionId,
        'none',
        currentFingerprint,
        'EXECUTION_AUTHORIZATION_MISSING',
        'No valid ExecutionAuthorization provided. Single-use explicit authorization is mandatory.',
        now
      );
    }

    // Guard 5: Testnet-Only Flag on Authorization
    if (auth.testnetOnly !== true) {
      return this.recordFailure(
        transactionId,
        auth.authorizationId,
        currentFingerprint,
        'EXECUTION_AUTHORIZATION_INVALID',
        'Authorization is not strictly flagged as testnetOnly.',
        now
      );
    }

    // Guard 6: Expiration Check
    if (now > auth.expiresAt) {
      return this.recordFailure(
        transactionId,
        auth.authorizationId,
        currentFingerprint,
        'EXECUTION_AUTHORIZATION_EXPIRED',
        `Execution authorization expired at ${auth.expiresAt} (current time: ${now}). Plan execution blocked.`,
        now
      );
    }

    // Guard 7: Single-Use and Idempotency Check (In-memory + Persisted)
    const persistedAuths = await this.txStore.getConsumedAuthIds();
    const persistedFps = await this.txStore.getConsumedFingerprints();

    if (auth.consumed || this.consumedAuthIds.has(auth.authorizationId) || persistedAuths.has(auth.authorizationId)) {
      return this.recordFailure(
        transactionId,
        auth.authorizationId,
        currentFingerprint,
        'EXECUTION_AUTHORIZATION_ALREADY_CONSUMED',
        `Authorization ${auth.authorizationId} has already been consumed. Replay is strictly forbidden.`,
        now
      );
    }

    if (this.consumedFingerprints.has(currentFingerprint) || persistedFps.has(currentFingerprint)) {
      return this.recordFailure(
        transactionId,
        auth.authorizationId,
        currentFingerprint,
        'EXECUTION_IDEMPOTENCY_BLOCKED',
        'An identical plan fingerprint has already been executed. Replay is strictly blocked.',
        now
      );
    }

    // Guard 8: Plan Fingerprint Matching
    if (auth.planFingerprint !== currentFingerprint) {
      return this.recordFailure(
        transactionId,
        auth.authorizationId,
        currentFingerprint,
        'PLAN_FINGERPRINT_MISMATCH',
        `Plan fingerprint (${currentFingerprint}) does not match authorized fingerprint (${auth.planFingerprint}). Execution aborted.`,
        now
      );
    }

    // Guard 9: Fresh Pre-Execution Preflight Revalidation
    const preflight = await executionPreflight.validate(plan, overrides?.preflightOverrides);
    if (!preflight.approved) {
      const errorMsg = preflight.errors.join('; ') || 'Preflight validation failed.';
      return this.recordFailure(
        transactionId,
        auth.authorizationId,
        currentFingerprint,
        'PREFLIGHT_VALIDATION_FAILED',
        `Fresh preflight check failed prior to order request: ${errorMsg}`,
        now
      );
    }

    // Guard 10: Execution Policy Evaluation Layer
    const currentPrice = overrides?.currentPriceOverride ?? preflight.currentPrice;
    const currentEquity = overrides?.currentEquityOverride ?? preflight.currentEquity;
    const state = await this.storage.loadState();
    const openPositions = overrides?.openPositionsOverride ?? state.trackedPositions ?? [];
    const capitalProfile = overrides?.capitalProfileOverride ?? state.settings?.capitalProfile;

    const policyResult = executionPolicy.evaluate(plan, {
      currentPrice,
      currentEquity,
      openPositions,
      capitalProfile,
      now,
      overrides: overrides?.policyOverrides,
    });

    if (!policyResult.allowed) {
      return this.recordFailure(
        transactionId,
        auth.authorizationId,
        currentFingerprint,
        policyResult.code,
        policyResult.reason,
        now
      );
    }

    // Mark Authorization and Fingerprint as Consumed
    auth.consumed = true;
    this.consumedAuthIds.add(auth.authorizationId);
    this.consumedFingerprints.add(currentFingerprint);
    if (this.activeAuthorization?.authorizationId === auth.authorizationId) {
      this.activeAuthorization.consumed = true;
    }

    const positionMode = overrides?.positionModeOverride || overrides?.preflightOverrides?.positionMode || 'ONE_WAY';
    const positionSide = positionMode === 'HEDGE'
      ? (plan.side === 'LONG' ? 'LONG' : 'SHORT')
      : 'BOTH';

    const txPrefix = transactionId.replace(/^txn-/, '');
    const entryClientOrderId = overrides?.entryClientOrderIdOverride || `apex-entry-${txPrefix}`;
    const stopLossClientOrderId = overrides?.stopLossClientOrderIdOverride || `apex-sl-${txPrefix}`;
    const takeProfitClientOrderId = plan.takeProfitOrder
      ? (overrides?.takeProfitClientOrderIdOverride || `apex-tp-${txPrefix}`)
      : undefined;

    // STATE TRANSITION: ENTRY_SENT (Persisted atomically before transport dispatch)
    await this.txStore.recordTransactionStart(
      plan,
      auth.authorizationId,
      currentFingerprint,
      transactionId,
      {
        entryClientOrderId,
        stopLossClientOrderId,
        takeProfitClientOrderId,
      }
    );

    const entryReq: BinanceOrderRequest = {
      symbol: plan.symbol,
      side: plan.entryOrder.side,
      type: plan.entryOrder.type,
      quantity: plan.entryOrder.quantity,
      price: plan.entryOrder.price,
      reduceOnly: false,
      positionSide,
      clientOrderId: entryClientOrderId,
    };

    // Synchronize leverage on Binance Testnet if transport supports it
    if (orderTransport.setLeverage && plan.leverage && plan.leverage > 0) {
      try {
        await orderTransport.setLeverage(plan.symbol, plan.leverage);
      } catch {
        // Non-blocking: proceed with order execution
      }
    }

    let entryRes: BinanceOrderResponse;
    try {
      entryRes = await orderTransport.sendOrder(entryReq);
    } catch (err: any) {
      entryRes = {
        success: false,
        error: `TRANSPORT_ERROR: ${err.message || String(err)}`,
      };
    }

    // STATE TRANSITION: If Entry Fails -> EXECUTION_FAILED
    if (!entryRes.success || !entryRes.orderId) {
      const isTimeout = Boolean(
        entryRes.error?.toLowerCase().includes('timeout') ||
        entryRes.error?.includes('ETIMEDOUT')
      );
      const failureCode = isTimeout ? 'TRANSPORT_TIMEOUT_UNKNOWN_STATUS' : 'ENTRY_SUBMISSION_REJECTED';
      const failureReason = isTimeout
        ? `Network timeout while submitting entry order: ${entryRes.error}. Remote status unknown.`
        : (entryRes.error || 'Entry order submission rejected by transport.');

      await this.txStore.recordTransition(transactionId, {
        state: 'EXECUTION_FAILED',
        failureCode,
        failureReason,
        completedAt: Date.now(),
        reconciliationStatus: isTimeout ? 'REQUIRES_MANUAL_REVIEW' : 'NOT_REQUIRED',
        reconciliationNotes: isTimeout ? 'Entry timed out. Position may or may not exist on exchange.' : null,
      });

      const failedResult: ExecutionTransactionResult = {
        transactionId,
        planFingerprint: currentFingerprint,
        authorizationId: auth.authorizationId,
        state: 'EXECUTION_FAILED',
        status: 'EXECUTION_FAILED',
        success: false,
        entryResult: entryRes,
        stopResult: null,
        takeProfitResult: null,
        executionPerformed: true,
        fullyConfirmed: false,
        partialExecution: false,
        failureCode,
        failureReason,
        rejectionCode: failureCode,
        rejectionReason: failureReason,
        startedAt: now,
        completedAt: Date.now(),
        timestamp: now,
        dryRunOnly: true,
        requestsCount: 1,
        entryOrderId: entryRes?.orderId ? String(entryRes.orderId) : undefined,
        entryClientOrderId,
        stopLossClientOrderId,
        takeProfitClientOrderId,
      };
      return this.recordResult(failedResult);
    }

    // STATE TRANSITION: ENTRY_CONFIRMED (Persisted atomically)
    const entryOrderId = String(entryRes.orderId);
    await this.txStore.recordTransition(transactionId, {
      state: 'ENTRY_CONFIRMED',
      entryOrderId,
      executedQuantity: plan.quantity,
      executedPrice: plan.entryPrice,
    });

    // Send Protective Stop-Loss Order
    const slReq: BinanceOrderRequest = {
      symbol: plan.symbol,
      side: plan.stopLossOrder.side,
      type: plan.stopLossOrder.type,
      quantity: plan.stopLossOrder.quantity,
      stopPrice: plan.stopLossOrder.stopPrice,
      reduceOnly: true,
      positionSide,
      clientOrderId: stopLossClientOrderId,
    };

    let slRes: BinanceOrderResponse;
    try {
      slRes = await orderTransport.sendOrder(slReq);
    } catch (err: any) {
      slRes = {
        success: false,
        error: `TRANSPORT_ERROR: ${err.message || String(err)}`,
      };
    }

    // If Stop Loss fails: Entry was confirmed, but position is UNPROTECTED -> EXECUTION_PARTIAL
    if (!slRes.success || !slRes.orderId) {
      await this.txStore.recordTransition(transactionId, {
        state: 'EXECUTION_PARTIAL',
        stopLossOrderId: null,
        failureCode: 'PARTIAL_EXECUTION_REQUIRES_RECONCILIATION',
        failureReason: `Entry order ${entryOrderId} confirmed, but protective Stop-Loss order failed (${slRes.error || 'rejected'}). Reconciliation required.`,
        reconciliationStatus: 'REQUIRES_MANUAL_REVIEW',
        reconciliationNotes: 'Entry order confirmed, but protective Stop-Loss order failed. Position is unprotected.',
        completedAt: Date.now(),
      });

      const partialStopFailedResult: ExecutionTransactionResult = {
        transactionId,
        planFingerprint: currentFingerprint,
        authorizationId: auth.authorizationId,
        state: 'EXECUTION_PARTIAL',
        status: 'EXECUTION_PARTIAL',
        success: false,
        entryResult: entryRes,
        stopResult: slRes,
        takeProfitResult: null,
        executionPerformed: true,
        fullyConfirmed: false,
        partialExecution: true,
        failureCode: 'PARTIAL_EXECUTION_REQUIRES_RECONCILIATION',
        failureReason: `Entry order ${entryOrderId} confirmed, but protective Stop-Loss order failed (${slRes.error || 'rejected'}). Reconciliation required.`,
        rejectionCode: 'PARTIAL_EXECUTION_REQUIRES_RECONCILIATION',
        rejectionReason: `Entry order ${entryOrderId} confirmed, but protective Stop-Loss order failed (${slRes.error || 'rejected'}). Reconciliation required.`,
        startedAt: now,
        completedAt: Date.now(),
        timestamp: now,
        dryRunOnly: true,
        requestsCount: 2,
        executedQuantity: plan.quantity,
        executedPrice: plan.entryPrice,
        entryOrderId,
        stopLossOrderId: slRes?.orderId ? String(slRes.orderId) : undefined,
        entryClientOrderId,
        stopLossClientOrderId,
        takeProfitClientOrderId,
      };
      return this.recordResult(partialStopFailedResult);
    }

    const stopLossOrderId = String(slRes.orderId);
    await this.txStore.recordTransition(transactionId, {
      stopLossOrderId,
    });

    // Send Take-Profit Order if configured
    let takeProfitOrderId: string | undefined;
    let tpRes: BinanceOrderResponse | null = null;
    let tpFailed = false;

    if (plan.takeProfitOrder && plan.takeProfitOrder.stopPrice && plan.takeProfitOrder.stopPrice > 0) {
      const tpReq: BinanceOrderRequest = {
        symbol: plan.symbol,
        side: plan.takeProfitOrder.side,
        type: plan.takeProfitOrder.type,
        quantity: plan.takeProfitOrder.quantity,
        stopPrice: plan.takeProfitOrder.stopPrice,
        reduceOnly: true,
        positionSide,
        clientOrderId: takeProfitClientOrderId || `apex-tp-${now}-${Math.random().toString(36).substring(2, 8)}`,
      };

      try {
        tpRes = await orderTransport.sendOrder(tpReq);
      } catch (err: any) {
        tpRes = {
          success: false,
          error: `TRANSPORT_ERROR: ${err.message || String(err)}`,
        };
      }

      if (!tpRes.success || !tpRes.orderId) {
        tpFailed = true;
      } else {
        takeProfitOrderId = String(tpRes.orderId);
      }
    }

    // STATE TRANSITION: If Take Profit fails -> EXECUTION_PARTIAL
    if (tpFailed) {
      await this.txStore.recordTransition(transactionId, {
        state: 'EXECUTION_PARTIAL',
        takeProfitOrderId: null,
        failureCode: 'PARTIAL_EXECUTION_TP_FAILED',
        failureReason: `Entry order ${entryOrderId} and Stop-Loss ${stopLossOrderId} confirmed, but Take-Profit order failed (${tpRes?.error || 'rejected'}).`,
        reconciliationStatus: 'REQUIRES_MANUAL_REVIEW',
        reconciliationNotes: 'Entry and Stop-Loss confirmed, but Take-Profit failed.',
        completedAt: Date.now(),
      });

      const partialTpFailedResult: ExecutionTransactionResult = {
        transactionId,
        planFingerprint: currentFingerprint,
        authorizationId: auth.authorizationId,
        state: 'EXECUTION_PARTIAL',
        status: 'EXECUTION_PARTIAL',
        success: false,
        entryResult: entryRes,
        stopResult: slRes,
        takeProfitResult: tpRes,
        executionPerformed: true,
        fullyConfirmed: false,
        partialExecution: true,
        failureCode: 'PARTIAL_EXECUTION_TP_FAILED',
        failureReason: `Entry order ${entryOrderId} and Stop-Loss ${stopLossOrderId} confirmed, but Take-Profit order failed (${tpRes?.error || 'rejected'}).`,
        rejectionCode: 'PARTIAL_EXECUTION_TP_FAILED',
        rejectionReason: `Entry order ${entryOrderId} and Stop-Loss ${stopLossOrderId} confirmed, but Take-Profit order failed (${tpRes?.error || 'rejected'}).`,
        startedAt: now,
        completedAt: Date.now(),
        timestamp: now,
        dryRunOnly: true,
        requestsCount: 3,
        executedQuantity: plan.quantity,
        executedPrice: plan.entryPrice,
        entryOrderId,
        stopLossOrderId,
        takeProfitOrderId: tpRes?.orderId ? String(tpRes.orderId) : undefined,
        entryClientOrderId,
        stopLossClientOrderId,
        takeProfitClientOrderId,
      };
      return this.recordResult(partialTpFailedResult);
    }

    // STATE TRANSITION: All required orders succeeded -> FULL_EXECUTION_CONFIRMED
    await this.txStore.recordTransition(transactionId, {
      state: 'FULL_EXECUTION_CONFIRMED',
      takeProfitOrderId: takeProfitOrderId || null,
      reconciliationStatus: 'NOT_REQUIRED',
      completedAt: Date.now(),
    });

    const fullConfirmedResult: ExecutionTransactionResult = {
      transactionId,
      planFingerprint: currentFingerprint,
      authorizationId: auth.authorizationId,
      state: 'FULL_EXECUTION_CONFIRMED',
      status: 'FULL_EXECUTION_CONFIRMED',
      success: true,
      entryResult: entryRes,
      stopResult: slRes,
      takeProfitResult: tpRes,
      executionPerformed: true,
      fullyConfirmed: true,
      partialExecution: false,
      failureCode: null,
      failureReason: null,
      startedAt: now,
      completedAt: Date.now(),
      timestamp: now,
      dryRunOnly: true,
      requestsCount: 2 + (tpRes ? 1 : 0),
      executedQuantity: plan.quantity,
      executedPrice: plan.entryPrice,
      entryOrderId,
      stopLossOrderId,
      takeProfitOrderId,
      entryClientOrderId,
      stopLossClientOrderId,
      takeProfitClientOrderId,
    };

    return this.recordResult(fullConfirmedResult);
  }

  private recordFailure(
    transactionId: string,
    authId: string,
    fingerprint: string,
    code: string,
    reason: string,
    startedAt: number
  ): ExecutionTransactionResult {
    const result: ExecutionTransactionResult = {
      transactionId,
      planFingerprint: fingerprint,
      authorizationId: authId,
      state: 'ENTRY_NOT_SENT',
      status: 'ENTRY_NOT_SENT',
      success: false,
      entryResult: null,
      stopResult: null,
      takeProfitResult: null,
      executionPerformed: false,
      fullyConfirmed: false,
      partialExecution: false,
      failureCode: code,
      failureReason: reason,
      rejectionCode: code,
      rejectionReason: reason,
      startedAt,
      completedAt: Date.now(),
      timestamp: startedAt,
      dryRunOnly: true,
      requestsCount: 0,
    };
    this.lastResult = result;
    return result;
  }

  private recordResult(res: ExecutionTransactionResult): ExecutionTransactionResult {
    this.lastResult = res;
    return res;
  }
}

export const testnetExecutionAdapter = new TestnetExecutionAdapter();
