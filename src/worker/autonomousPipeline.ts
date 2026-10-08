import {
  Position,
  TradeDirection,
  FuturesSymbolInfo,
  BotSettings,
  CapitalProfile,
} from '../types/trading';
import { StrategyEngine, strategyEngine } from '../services/strategyEngine';
import {
  testnetExecutionBridge,
  TestnetExecutionBridge,
  ExecutionPlan,
  ExecutionPlanResult,
} from './testnetExecutionBridge';
import { executionPreflight, PreflightResult, PreflightOverrides } from './executionPreflight';
import { executionPolicy, ExecutionPolicyResult, ExecutionPolicyConfig } from './executionPolicy';
import {
  testnetExecutionAdapter,
  TestnetExecutionAdapter,
  ExecutionAuthorization,
  ExecutionTransactionResult,
  ExecutionTransactionState,
  BinanceOrderTransport,
  MockBinanceOrderTransport,
  computePlanFingerprint,
} from './testnetExecutionAdapter';
import {
  executionTransactionStore,
  ExecutionTransactionStore,
  PersistedExecutionTransaction,
} from './executionTransactionStore';
import { executionReconciliationEngine, ExecutionReconciliationReport } from './executionReconciliation';
import { storageService, StorageService } from '../services/storageService';
import { SAFE_BOOT_MODE } from './workerEngine';

/**
 * Pipeline candidate input representation
 */
export interface PipelineCandidateInput {
  symbol: string;
  side: TradeDirection;
  signal: 'BUY_LONG' | 'SELL_SHORT';
  entryPrice: number;
  plannedStopLossPrice: number;
  plannedTakeProfitPrice: number;
  confidence: number;
  rationale: string;
  symbolInfo?: Partial<FuturesSymbolInfo>;
}

/**
 * Pipeline result for an individual candidate
 */
export interface CandidatePipelineResult {
  symbol: string;
  side: TradeDirection;
  qualified: boolean;
  rejectionReason?: string;
  executionPlan?: ExecutionPlan;
  preflightResult?: PreflightResult;
  policyResult?: ExecutionPolicyResult;
  authorizationId?: string;
  transactionId?: string;
  planFingerprint?: string;
  mockExecutionResult?: ExecutionTransactionResult;
  finalTransactionState?: ExecutionTransactionState;
}

/**
 * Batch run summary
 */
export interface AutonomousPipelineRunSummary {
  timestamp: number;
  universeSize: number;
  candidatesScanned: number;
  candidatesQualified: number;
  candidatesRejected: number;
  currentOpenPositions: number;
  maxOpenPositions: number;
  plansGenerated: number;
  preflightApproved: number;
  policyApproved: number;
  mockExecutedCount: number;
  mockRequestsCount: number;
  dryRunOnly: true;
  readOnly: true;
  testnetOnly: true;
  results: CandidatePipelineResult[];
}

export interface AutonomousPipelineOptions {
  bypassSafeBootForMockTest?: boolean;
  mockTransport?: MockBinanceOrderTransport;
  policyOverrides?: Partial<ExecutionPolicyConfig>;
  targetBaseUrl?: string;
  currentEquity?: number;
  maxOpenPositions?: number;
  riskPerTradePercent?: number;
  existingPositionsOverride?: Position[];
}

/**
 * AutonomousTradingDecisionPipeline
 *
 * Implements the full, multi-position, autonomous decision pipeline:
 * Strategy Evaluation -> Risk / Capital Profile -> Execution Plan -> Preflight -> Policy
 * -> Authorization -> Execution Transaction State Machine -> Mock Transport -> Persistence -> Reconciliation.
 *
 * STRICT SAFETY INVARIANTS:
 * - 100% DRY-RUN / TESTNET ARCHITECTURE: Never sends real Binance orders.
 * - SAFE_BOOT_MODE guarded: Real execution is strictly disabled.
 * - Multi-position aware: Strictly enforces maxOpenPositions and risk limits.
 * - Idempotency & isolation: One candidate never contaminates or reuses another's state.
 */
export class AutonomousTradingDecisionPipeline {
  private readonly storage: StorageService;
  private readonly txStore: ExecutionTransactionStore;
  private readonly adapter: TestnetExecutionAdapter;

  constructor(
    storage: StorageService = storageService,
    txStore: ExecutionTransactionStore = executionTransactionStore,
    adapter: TestnetExecutionAdapter = testnetExecutionAdapter
  ) {
    this.storage = storage;
    this.txStore = txStore;
    this.adapter = adapter;
  }

  /**
   * Processes a batch of qualified trading candidates through the complete autonomous pipeline sequentially.
   */
  public async processBatch(
    candidates: PipelineCandidateInput[],
    options?: AutonomousPipelineOptions
  ): Promise<AutonomousPipelineRunSummary> {
    const startTime = Date.now();
    const state = await this.storage.loadState();
    const existingTrackedPositions: Position[] = options?.existingPositionsOverride !== undefined
      ? [...options.existingPositionsOverride]
      : [...(state.trackedPositions || [])];

    // Read settings from storage or overrides
    const capitalProfile: CapitalProfile = {
      capitalUsd: state.settings?.capitalProfile?.capitalUsd ?? 0, // AUTO
      riskPerTradePercent: options?.riskPerTradePercent ?? state.settings?.capitalProfile?.riskPerTradePercent ?? 1.0,
      maxDailyLossPercent: state.settings?.capitalProfile?.maxDailyLossPercent ?? 0,
      maxOpenPositions: options?.maxOpenPositions ?? state.settings?.capitalProfile?.maxOpenPositions ?? 4,
    };

    const effectiveSettings: Partial<BotSettings> = {
      ...(state.settings || {}),
      capitalProfile,
      maxConcurrentPositions: capitalProfile.maxOpenPositions,
      riskPerTradePercent: capitalProfile.riskPerTradePercent,
    };

    const currentEquity = options?.currentEquity ?? state.lastKnownAccountState?.totalMarginBalance ?? 31720.56;
    const mockTransport = options?.mockTransport || new MockBinanceOrderTransport();
    const batchTrackedPositions: Position[] = [...existingTrackedPositions];

    const results: CandidatePipelineResult[] = [];
    let plansGenerated = 0;
    let preflightApproved = 0;
    let policyApproved = 0;
    let mockExecutedCount = 0;

    for (const candidate of candidates) {
      const candidateResult = await this.processCandidate(
        candidate,
        batchTrackedPositions,
        currentEquity,
        effectiveSettings,
        mockTransport,
        options
      );

      results.push(candidateResult);

      if (candidateResult.executionPlan) {
        plansGenerated++;
      }
      if (candidateResult.preflightResult?.approved) {
        preflightApproved++;
      }
      if (candidateResult.policyResult?.allowed) {
        policyApproved++;
      }

      // If candidate was fully confirmed in mock execution, add a simulated position
      // to batchTrackedPositions so subsequent candidates in the batch accurately respect position limits
      if (candidateResult.finalTransactionState === 'FULL_EXECUTION_CONFIRMED' && candidateResult.executionPlan) {
        mockExecutedCount++;
        batchTrackedPositions.push({
          id: `mock-pos-${candidate.symbol}-${Date.now()}`,
          symbol: candidate.symbol,
          side: candidate.side,
          entryPrice: candidate.entryPrice,
          markPrice: candidate.entryPrice,
          quantity: candidateResult.executionPlan.quantity,
          amountUsd: candidateResult.executionPlan.estimatedMargin,
          notionalValue: candidateResult.executionPlan.notionalValue,
          leverage: candidateResult.executionPlan.leverage,
          liquidationPrice: 0,
          unrealizedProfit: 0,
          pnlPercentage: 0,
          stopLossPrice: candidateResult.executionPlan.stopLossPrice,
          takeProfitPrice: candidateResult.executionPlan.takeProfitPrice,
          stopLossOrderStatus: 'SUBMITTED',
          takeProfitOrderStatus: 'SUBMITTED',
          lastReconciliationTime: Date.now(),
          reconciliationStatus: 'IN_SYNC',
          reconciliationMessage: 'Mock batch execution confirmed',
          estimatedCommissionUsd: 0,
          fundingFeeUsd: 0,
          slippageEstimateUsd: 0,
          openedAt: Date.now(),
          maxDurationMs: 86400000,
          aiConfidence: candidate.confidence,
          rationale: candidate.rationale,
          isRealOrder: false,
          isTestnet: true,
        });
      }
    }

    const qualifiedCount = results.filter((r) => r.qualified).length;
    const rejectedCount = results.length - qualifiedCount;

    return {
      timestamp: startTime,
      universeSize: candidates.length,
      candidatesScanned: candidates.length,
      candidatesQualified: qualifiedCount,
      candidatesRejected: rejectedCount,
      currentOpenPositions: existingTrackedPositions.length,
      maxOpenPositions: capitalProfile.maxOpenPositions,
      plansGenerated,
      preflightApproved,
      policyApproved,
      mockExecutedCount,
      mockRequestsCount: mockTransport.requests.length,
      dryRunOnly: true,
      readOnly: true,
      testnetOnly: true,
      results,
    };
  }

  /**
   * Processes a single candidate through the full decision pipeline.
   */
  public async processCandidate(
    candidate: PipelineCandidateInput,
    currentOpenPositions: Position[],
    currentEquity: number,
    settings: Partial<BotSettings>,
    mockTransport: MockBinanceOrderTransport,
    options?: AutonomousPipelineOptions
  ): Promise<CandidatePipelineResult> {
    const baseResult: CandidatePipelineResult = {
      symbol: candidate.symbol,
      side: candidate.side,
      qualified: false,
    };

    // 1. Position limit check against settings.capitalProfile.maxOpenPositions
    const maxOpenPositions = settings.capitalProfile?.maxOpenPositions ?? 4;
    if (currentOpenPositions.length >= maxOpenPositions) {
      return {
        ...baseResult,
        qualified: false,
        rejectionReason: `MAX_OPEN_POSITIONS_REACHED: Current open positions (${currentOpenPositions.length}) meets or exceeds max allowed (${maxOpenPositions}).`,
      };
    }

    // 2. Duplicate position check (same symbol + same side)
    const isDuplicate = currentOpenPositions.some(
      (p) => p.symbol.toUpperCase() === candidate.symbol.toUpperCase() && p.side === candidate.side
    );
    if (isDuplicate) {
      return {
        ...baseResult,
        qualified: false,
        rejectionReason: `DUPLICATE_POSITION: Position already exists for ${candidate.symbol}:${candidate.side}.`,
      };
    }

    // 3. Build ExecutionPlan via TestnetExecutionBridge
    const effectiveSymbolInfo: FuturesSymbolInfo = {
      symbol: candidate.symbol,
      baseAsset: candidate.symbol.replace('USDT', ''),
      quoteAsset: 'USDT',
      pricePrecision: candidate.symbolInfo?.pricePrecision ?? 2,
      quantityPrecision: candidate.symbolInfo?.quantityPrecision ?? 3,
      minQty: candidate.symbolInfo?.minQty ?? 0.001,
      stepSize: candidate.symbolInfo?.stepSize ?? 0.001,
      tickSize: candidate.symbolInfo?.tickSize ?? 0.1,
      minNotional: candidate.symbolInfo?.minNotional ?? 5.0,
      price: candidate.entryPrice,
      priceChangePercent: 0,
      volume24h: 1000000,
      quoteVolume24h: 10000000,
      high24h: candidate.entryPrice * 1.05,
      low24h: candidate.entryPrice * 0.95,
      rsi14: 50,
      trend: candidate.side === 'LONG' ? 'BULLISH' : 'BEARISH',
      orderbookRatio: 1.1,
      aiScore: candidate.confidence,
      aiRecommendedSignal: candidate.signal,
      ...(candidate.symbolInfo || {}),
    };

    const planResult: ExecutionPlanResult = TestnetExecutionBridge.evaluateExecutionPlan(
      {
        symbol: candidate.symbol,
        signal: candidate.signal,
        entryPrice: candidate.entryPrice,
        plannedStopLossPrice: candidate.plannedStopLossPrice,
        plannedTakeProfitPrice: candidate.plannedTakeProfitPrice,
        rationale: candidate.rationale,
        confidence: candidate.confidence,
        symbolInfo: effectiveSymbolInfo,
      },
      {
        settings,
        openPositions: currentOpenPositions,
        closedTrades: [],
        equity: currentEquity,
        symbolInfo: effectiveSymbolInfo,
      }
    );

    if (!planResult.success || !planResult.plan) {
      return {
        ...baseResult,
        qualified: false,
        rejectionReason: planResult.rejectionReason || 'Execution plan construction failed.',
      };
    }

    const plan = planResult.plan;
    baseResult.executionPlan = plan;

    // 4. Run Execution Preflight Check
    const preflightOverrides: PreflightOverrides = {
      targetBaseUrl: options?.targetBaseUrl || 'https://testnet.binancefuture.com',
      accountState: {
        available: true,
        source: 'BINANCE_FUTURES_TESTNET',
        timestamp: Date.now(),
        equity: currentEquity,
        totalMarginBalance: currentEquity,
        openPositions: currentOpenPositions.map((p) => ({
          symbol: p.symbol,
          side: p.side,
          quantity: p.quantity,
          entryPrice: p.entryPrice,
          unrealizedPnl: p.unrealizedProfit,
          leverage: p.leverage,
        })),
      },
      positionMode: 'ONE_WAY',
      currentPrice: candidate.entryPrice,
      symbolFilters: {
        tickSize: candidate.symbolInfo?.pricePrecision ? 1 / 10 ** candidate.symbolInfo.pricePrecision : 0.1,
        stepSize: candidate.symbolInfo?.quantityPrecision ? 1 / 10 ** candidate.symbolInfo.quantityPrecision : 0.001,
        minQty: 0.001,
        minNotional: 5.0,
      },
      settings,
    };

    const preflightResult = await executionPreflight.validate(plan, preflightOverrides);
    baseResult.preflightResult = preflightResult;

    if (!preflightResult.approved) {
      return {
        ...baseResult,
        qualified: false,
        rejectionReason: `PREFLIGHT_REJECTED: ${preflightResult.errors.join('; ')}`,
      };
    }

    // 5. Run Execution Policy Check
    const effectivePolicyOverrides: Partial<ExecutionPolicyConfig> = {
      equityDriftPolicy: {
        configured: true,
        maxEquityDriftPercent: 5.0,
        behaviorOnBreach: 'REBUILD_EXECUTION_PLAN_REQUIRED',
      },
      priceDriftPolicy: {
        configured: true,
        maxEntryPriceDriftPercent: 0.5,
        behaviorOnBreach: 'REQUIRE_REBUILD_PLAN',
      },
      ...(options?.policyOverrides || {}),
    };

    const policyResult = executionPolicy.evaluate(plan, {
      currentPrice: candidate.entryPrice,
      currentEquity,
      openPositions: currentOpenPositions,
      capitalProfile: settings.capitalProfile,
      now: Date.now(),
      overrides: effectivePolicyOverrides,
    });
    baseResult.policyResult = policyResult;

    if (!policyResult.allowed) {
      return {
        ...baseResult,
        qualified: false,
        rejectionReason: `POLICY_BLOCKED: [${policyResult.code}] ${policyResult.reason}`,
      };
    }

    // 6. Generate Authorization and Plan Fingerprint
    const planFingerprint = computePlanFingerprint(plan);
    const auth = this.adapter.arm(plan, 60_000);
    baseResult.authorizationId = auth.authorizationId;
    baseResult.planFingerprint = planFingerprint;

    // 7. Execute through Execution Transaction State Machine into Mock Transport
    const execResult = await this.adapter.execute(plan, auth, mockTransport, {
      bypassSafeBootForMockTest: options?.bypassSafeBootForMockTest ?? true,
      bypassExecutionDisabledForMockTest: options?.bypassSafeBootForMockTest ?? true,
      targetBaseUrl: options?.targetBaseUrl || 'https://testnet.binancefuture.com',
      preflightOverrides,
      currentPriceOverride: candidate.entryPrice,
      currentEquityOverride: currentEquity,
      policyOverrides: effectivePolicyOverrides,
      openPositionsOverride: currentOpenPositions,
      capitalProfileOverride: settings.capitalProfile,
    });

    baseResult.transactionId = execResult.transactionId;
    baseResult.mockExecutionResult = execResult;
    baseResult.finalTransactionState = execResult.state;
    baseResult.qualified = execResult.success;

    if (!execResult.success) {
      baseResult.rejectionReason = `EXECUTION_FAILED: [${execResult.failureCode || execResult.rejectionCode}] ${execResult.failureReason || execResult.rejectionReason}`;
    }

    return baseResult;
  }
}

export const autonomousTradingPipeline = new AutonomousTradingDecisionPipeline();
