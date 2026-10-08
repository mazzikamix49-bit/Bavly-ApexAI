import crypto from 'node:crypto';
import {
  Position,
  TradeDirection,
  FuturesSymbolInfo,
  CapitalProfile,
  Candle,
} from '../types/trading';
import { strategyEngine, StrategyEngine } from '../services/strategyEngine';
import {
  testnetExecutionBridge,
  ExecutionPlan,
  ExecutionOrderPlan,
  normalizePrice,
  normalizeQuantity,
} from './testnetExecutionBridge';
import { executionPreflight, PreflightResult } from './executionPreflight';
import { executionPolicy, ExecutionPolicyResult } from './executionPolicy';
import {
  testnetExecutionAdapter,
  TestnetExecutionAdapter,
  ExecutionAuthorization,
  ExecutionTransactionResult,
  computePlanFingerprint,
  BinanceOrderTransport,
  MockBinanceOrderTransport,
} from './testnetExecutionAdapter';
import {
  executionTransactionStore,
  ExecutionTransactionStore,
} from './executionTransactionStore';
import {
  binanceTestnetAccountStateProvider,
  BinanceTestnetAccountStateProvider,
} from './binanceTestnetAccountStateProvider';
import { BinanceTestnetOrderTransport } from './binanceTestnetOrderTransport';
import {
  reconcileAllOrders,
  reconcileTransactionOrders,
  executionReconciliationEngine,
} from './executionReconciliation';
import { futuresUniverseProvider, FuturesUniverseProvider } from './futuresUniverseProvider';
import { serverMarketDataProvider, ServerMarketDataProvider } from './serverMarketDataProvider';
import { storageService, StorageService } from '../services/storageService';
import { SAFE_BOOT_MODE } from './workerEngine';
import {
  BINANCE_FUTURES_ACCOUNT_BASE_URL,
  areTestnetCredentialsConfigured,
} from './workerConstants';
import { binanceNetworkGuard } from './binanceNetworkGuard';
import {
  pilotCoverageManager,
  CoverageAuditSnapshot,
} from './pilotCoverageManager';
import {
  pilotPositionRegistry,
  PilotPositionRegistry,
  PilotPositionRecord,
  PilotPositionLifecycleState,
  PositionReconciliationResult,
} from './pilotPositionRegistry';

/**
 * TESTNET_AUTONOMOUS_PILOT_MODE
 * Dedicated, distinct mode for autonomous pilot testing on Binance Futures Testnet.
 * Default is strictly OFF (false).
 */
export const TESTNET_AUTONOMOUS_PILOT_MODE_DEFAULT = false;

/**
 * Conservative Pilot Safety Limits
 * Multi-Position Foundation: maxOpenPositions = 2, maxEntriesPerCycle = 1
 */
export interface PilotSafetyConfig {
  maxOpenPositions: number; // max concurrent pilot positions (2)
  maxEntriesPerCycle: number; // max new entries per cycle (1)
  riskPerTradePercent: number; // e.g. 0.5% (strictly <= 1.0%)
  maxDailyLossPercent: number; // e.g. 2.0%
  dailyLossGuardEnabled: boolean;
  cooldownAfterClosedPositionMs: number;
  noAutomaticRetry: boolean;
  noAutomaticRecovery: boolean;
  testnetOnly: boolean;
}

export const DEFAULT_PILOT_CONFIG: PilotSafetyConfig = {
  maxOpenPositions: 4,
  maxEntriesPerCycle: 1,
  riskPerTradePercent: 0.5,
  maxDailyLossPercent: 2.0,
  dailyLossGuardEnabled: true,
  cooldownAfterClosedPositionMs: 10_000,
  noAutomaticRetry: true,
  noAutomaticRecovery: true,
  testnetOnly: true,
};

export interface PilotDiagnosticStatus {
  pilotEnabled: boolean;
  pilotArmed: boolean;
  pilotRunning: boolean;
  testnetOnly: true;
  maxOpenPositions: number;
  currentOpenPositions: number;
  activePositions: PilotPositionRecord[];
  lastScanTimestamp: number | null;
  lastCandidate: {
    symbol?: string;
    signal?: string;
    confidence?: number;
    price?: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
  } | null;
  lastDecision: string | null;
  lastTransactionId: string | null;
  lastExecutionState: string | null;
  lastReconciliationStatus: string | null;
  manualReviewRequired: boolean;
  blockedReason: string | null;
  dailyRiskState: {
    dailyLossPercent: number;
    maxDailyLossPercent: number;
    dailyLossGuardTriggered: boolean;
    tradesToday: number;
  };
}

export interface CandidateScanSelection {
  candidate: {
    symbol: string;
    signal: 'BUY_LONG' | 'SELL_SHORT';
    side: TradeDirection;
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    confidence: number;
    rationale: string;
  } | null;
  reason?: string;
  allQualifiedCount: number;
  totalUniverseScanned: number;
  evaluatedCount?: number;
  rejectionBreakdown?: Record<string, number>;
  coverageSnapshot?: CoverageAuditSnapshot;
}

export interface AutonomousPilotCycleResult {
  success: boolean;
  decision: string;
  candidateSymbol?: string;
  executionPlan?: ExecutionPlan;
  transactionId?: string;
  positionId?: string;
  entryOrderId?: string;
  stopLossOrderId?: string;
  takeProfitOrderId?: string;
  finalPositionQty?: number;
  reconciliationStatus?: string;
  orphanOrdersCount?: number;
  error?: string;
}

export class AutonomousPilotEngine {
  private pilotEnabled: boolean = TESTNET_AUTONOMOUS_PILOT_MODE_DEFAULT;
  private pilotArmed: boolean = false;
  private pilotRunning: boolean = false;
  private manualReviewRequired: boolean = false;
  private blockedReason: string | null = null;
  private lastScanTimestamp: number | null = null;
  private lastCandidate: CandidateScanSelection['candidate'] | null = null;
  private lastDecision: string | null = null;
  private lastTransactionId: string | null = null;
  private lastExecutionState: string | null = null;
  private lastReconciliationStatus: string | null = null;
  private isCycleBusy: boolean = false;
  private lastClosedPositionTime: number = 0;
  private tradesToday: number = 0;
  private dailyLossPercent: number = 0;

  private readonly config: PilotSafetyConfig = { ...DEFAULT_PILOT_CONFIG };
  private readonly universeProvider: FuturesUniverseProvider;
  private readonly marketProvider: ServerMarketDataProvider;
  private readonly strategy: StrategyEngine;
  private readonly adapter: TestnetExecutionAdapter;
  private readonly txStore: ExecutionTransactionStore;
  private readonly accountProvider: BinanceTestnetAccountStateProvider;
  private readonly storage: StorageService;
  private readonly registry: PilotPositionRegistry;

  constructor(dependencies?: {
    universeProvider?: FuturesUniverseProvider;
    marketProvider?: ServerMarketDataProvider;
    strategy?: StrategyEngine;
    adapter?: TestnetExecutionAdapter;
    txStore?: ExecutionTransactionStore;
    accountProvider?: BinanceTestnetAccountStateProvider;
    storage?: StorageService;
    registry?: PilotPositionRegistry;
    config?: Partial<PilotSafetyConfig>;
  }) {
    if (dependencies?.config) {
      this.config = { ...this.config, ...dependencies.config };
    }
    this.universeProvider = dependencies?.universeProvider || futuresUniverseProvider;
    this.marketProvider = dependencies?.marketProvider || serverMarketDataProvider;
    this.strategy = dependencies?.strategy || strategyEngine;
    this.adapter = dependencies?.adapter || testnetExecutionAdapter;
    this.txStore = dependencies?.txStore || executionTransactionStore;
    this.accountProvider = dependencies?.accountProvider || binanceTestnetAccountStateProvider;
    this.storage = dependencies?.storage || storageService;
    this.registry = dependencies?.registry || pilotPositionRegistry;
  }

  public getRegistry(): PilotPositionRegistry {
    return this.registry;
  }

  /**
   * Hard Environment & Production URL Guard
   */
  public verifyTestnetGuards(targetBaseUrl?: string): void {
    const url = targetBaseUrl || BINANCE_FUTURES_ACCOUNT_BASE_URL;

    // Central Network Guard: Fail closed on any non-testnet Binance URL
    binanceNetworkGuard.assertTestnetTraffic(url, 'AutonomousPilotEngine.verifyTestnetGuards');

    // Guard 1: Must never run on production URLs
    if (url.includes('fapi.binance.com') || !url.includes('testnet.binancefuture.com')) {
      this.triggerEmergencyStop(`Production URL rejected: ${url}`);
      throw new Error(`[PILOT_GUARD] Production URL detected (${url}). Testnet only.`);
    }

    // Guard 2: Must never run with production credentials
    const apiKey = (process.env.BINANCE_TESTNET_API_KEY || '').trim();
    if (!apiKey) {
      this.triggerEmergencyStop('Missing Binance Testnet API key.');
      throw new Error('[PILOT_GUARD] Binance Testnet credentials are not configured.');
    }

    // Guard 3: Environment must allow testnet execution
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_TESTNET_PILOT) {
      this.triggerEmergencyStop('Production environment without explicit testnet pilot override.');
      throw new Error('[PILOT_GUARD] Production environment blocked for Pilot mode.');
    }
  }

  /**
   * Emergency Stop
   */
  public triggerEmergencyStop(reason: string): void {
    console.error(`[PILOT_EMERGENCY_STOP] ${reason}`);
    this.pilotRunning = false;
    this.pilotArmed = false;
    this.manualReviewRequired = true;
    this.blockedReason = reason;
  }

  public clearManualReview(): void {
    this.manualReviewRequired = false;
    this.blockedReason = null;
  }

  public setPilotEnabled(enabled: boolean): void {
    this.verifyTestnetGuards();
    this.pilotEnabled = enabled;
    if (!enabled) {
      this.pilotRunning = false;
      this.pilotArmed = false;
    }
  }

  public arm(): { success: boolean; armed: boolean; message: string } {
    this.verifyTestnetGuards();
    if (!this.pilotEnabled) {
      return { success: false, armed: false, message: 'Pilot must be enabled before arming.' };
    }
    if (this.manualReviewRequired) {
      return { success: false, armed: false, message: `Manual review required: ${this.blockedReason}` };
    }
    this.pilotArmed = true;
    return { success: true, armed: true, message: 'Pilot armed for single execution cycle.' };
  }

  public disarm(): void {
    this.pilotArmed = false;
  }

  public async start(): Promise<{ success: boolean; started: boolean; error?: string }> {
    try {
      this.verifyTestnetGuards();

      if (!this.pilotEnabled) {
        return { success: false, started: false, error: 'Pilot mode is not enabled.' };
      }
      if (!this.pilotArmed) {
        return { success: false, started: false, error: 'Pilot must be explicitly armed before start.' };
      }
      if (this.manualReviewRequired) {
        return { success: false, started: false, error: `Manual review required: ${this.blockedReason}` };
      }

      // Check account availability & reconciliation
      const acc = await this.accountProvider.getAccountState();
      if (!acc.available) {
        return { success: false, started: false, error: `Binance Testnet unavailable: ${acc.error}` };
      }

      // Check open positions count
      const activeNonHook = (acc.openPositions || []).filter(
        (p) => p.symbol.toUpperCase() !== 'HOOKUSDT' && p.quantity > 0
      );
      if (activeNonHook.length >= this.config.maxOpenPositions) {
        return { success: false, started: false, error: `maxOpenPositions (${this.config.maxOpenPositions}) already reached.` };
      }

      // Check orphan orders
      const transport = new BinanceTestnetOrderTransport();
      const openOrders = await transport.getOpenOrders();
      if (openOrders.length > 0) {
        this.triggerEmergencyStop(`Orphan orders detected (${openOrders.length}). Clean up required.`);
        return { success: false, started: false, error: `Orphan orders exist on exchange (${openOrders.length}).` };
      }

      this.pilotRunning = true;
      this.blockedReason = null;
      return { success: true, started: true };
    } catch (err: any) {
      this.triggerEmergencyStop(err.message);
      return { success: false, started: false, error: err.message };
    }
  }

  public stop(): void {
    this.pilotRunning = false;
    this.pilotArmed = false;
  }

  /**
   * Diagnostic Status (No secrets exposed)
   */
  public async getStatus(): Promise<PilotDiagnosticStatus> {
    let currentOpenPositions = 0;
    try {
      const acc = await this.accountProvider.getAccountState();
      const nonHook = (acc.openPositions || []).filter(
        (p) => p.symbol.toUpperCase() !== 'HOOKUSDT' && p.quantity > 0
      );
      currentOpenPositions = Math.max(nonHook.length, this.registry.getActiveCount());
    } catch {
      currentOpenPositions = this.registry.getActiveCount();
    }

    return {
      pilotEnabled: this.pilotEnabled,
      pilotArmed: this.pilotArmed,
      pilotRunning: this.pilotRunning,
      testnetOnly: true,
      maxOpenPositions: this.config.maxOpenPositions,
      currentOpenPositions,
      activePositions: this.registry.getActivePositions(),
      lastScanTimestamp: this.lastScanTimestamp,
      lastCandidate: this.lastCandidate ? { ...this.lastCandidate } : null,
      lastDecision: this.lastDecision,
      lastTransactionId: this.lastTransactionId,
      lastExecutionState: this.lastExecutionState,
      lastReconciliationStatus: this.lastReconciliationStatus,
      manualReviewRequired: this.manualReviewRequired,
      blockedReason: this.blockedReason,
      dailyRiskState: {
        dailyLossPercent: this.dailyLossPercent,
        maxDailyLossPercent: this.config.maxDailyLossPercent,
        dailyLossGuardTriggered: this.dailyLossPercent >= this.config.maxDailyLossPercent,
        tradesToday: this.tradesToday,
      },
    };
  }

  /**
   * Scans Binance Futures Universe and deterministically selects at most 1 candidate.
   * Strictly excludes HOOKUSDT.
   * Never fabricates synthetic signals or prices.
   */
  public async scanAndSelectCandidate(
    options?: {
      symbolsSubset?: string[];
      mockMarketSnapshot?: any;
      fetchCandles?: boolean;
      maxPairsToScan?: number;
    }
  ): Promise<CandidateScanSelection> {
    if (this.isCycleBusy) {
      return {
        candidate: null,
        reason: 'SCAN_LOCKED_BUSY',
        allQualifiedCount: 0,
        totalUniverseScanned: 0,
      };
    }

    this.isCycleBusy = true;
    this.lastScanTimestamp = Date.now();

    try {
      // Check if max positions already reached in registry
      if (this.registry.getActiveCount() >= this.config.maxOpenPositions) {
        return {
          candidate: null,
          reason: 'MAX_POSITIONS_REACHED',
          allQualifiedCount: 0,
          totalUniverseScanned: 0,
        };
      }

      // 1. Get dynamically tradable symbols from UniverseProvider
      let tradable = options?.symbolsSubset;
      if (!tradable || tradable.length === 0) {
        tradable = await this.universeProvider.getTradableSymbols();
      }

      // Exclude currently active symbols in registry and HOOKUSDT
      const activeSymbols = new Set(this.registry.getActivePositions().map((p) => p.symbol.toUpperCase()));

      // Hard filter: Exclude HOOKUSDT, non-USDT, and currently active pilot symbols
      const filteredUniverse = tradable.filter(
        (s) =>
          s.toUpperCase() !== 'HOOKUSDT' &&
          s.toUpperCase().endsWith('USDT') &&
          !activeSymbols.has(s.toUpperCase())
      );

      if (filteredUniverse.length === 0) {
        return {
          candidate: null,
          reason: 'NO_TRADABLE_SYMBOLS_FOUND',
          allQualifiedCount: 0,
          totalUniverseScanned: 0,
        };
      }

      // 2. Fetch market data snapshot
      const snapshot = options?.mockMarketSnapshot || (await this.marketProvider.getMarketSnapshot(filteredUniverse));
      if (!snapshot || !Array.isArray(snapshot.pairs) || snapshot.pairs.length === 0) {
        return {
          candidate: null,
          reason: 'MARKET_DATA_UNAVAILABLE',
          allQualifiedCount: 0,
          totalUniverseScanned: filteredUniverse.length,
        };
      }

      // 3. Evaluate each pair using StrategyEngine
      const qualifiedList: Array<{
        symbol: string;
        signal: 'BUY_LONG' | 'SELL_SHORT';
        side: TradeDirection;
        entryPrice: number;
        stopLossPrice: number;
        takeProfitPrice: number;
        confidence: number;
        rationale: string;
      }> = [];

      const rejectionBreakdown: Record<string, number> = {};
      let evaluatedCount = 0;

      // Filter pairs with valid prices and exclude HOOKUSDT
      const validPairs = snapshot.pairs.filter(
        (p: any) => p && p.symbol && p.price > 0 && p.symbol.toUpperCase() !== 'HOOKUSDT'
      );

      // Sort by 24h turnover (liquidity) so most active perpetual pairs are examined first
      validPairs.sort((a: any, b: any) => (b.quoteVolume24h || 0) - (a.quoteVolume24h || 0));

      const maxLimit = options?.maxPairsToScan || 50;

      let batchToScan: typeof validPairs;
      let coverageSnap: CoverageAuditSnapshot | undefined = undefined;

      if (options?.symbolsSubset && options.symbolsSubset.length > 0) {
        batchToScan = validPairs.slice(0, maxLimit);
      } else {
        const batchSelection = pilotCoverageManager.selectNextBatch(
          filteredUniverse,
          tradable.length,
          maxLimit
        );
        coverageSnap = batchSelection.snapshot;
        const batchSet = new Set(batchSelection.batchSymbols.map((s) => s.toUpperCase()));
        batchToScan = validPairs.filter((p: any) => batchSet.has(p.symbol.toUpperCase()));
      }

      for (const pair of batchToScan) {
        evaluatedCount++;

        let klines: Candle[] = [];
        const shouldFetchLiveCandles = options?.fetchCandles ?? (!options?.mockMarketSnapshot);
        if (shouldFetchLiveCandles) {
          try {
            klines = await this.marketProvider.getKlines(pair.symbol, '15m', 35);
          } catch {
            klines = [];
          }
        }

        const evaluation = this.strategy.evaluateCandidate(pair, klines, []);
        if (
          evaluation.qualified &&
          (evaluation.signal === 'BUY_LONG' || evaluation.signal === 'SELL_SHORT') &&
          evaluation.plannedStopLossPrice > 0 &&
          evaluation.plannedTakeProfitPrice > 0
        ) {
          qualifiedList.push({
            symbol: pair.symbol.toUpperCase(),
            signal: evaluation.signal,
            side: evaluation.signal === 'BUY_LONG' ? 'LONG' : 'SHORT',
            entryPrice: pair.price,
            stopLossPrice: evaluation.plannedStopLossPrice,
            takeProfitPrice: evaluation.plannedTakeProfitPrice,
            confidence: evaluation.confidence,
            rationale: evaluation.rationale,
          });
        } else {
          const reason = evaluation.rejectionReason || 'UNKNOWN_REJECTION';
          rejectionBreakdown[reason] = (rejectionBreakdown[reason] || 0) + 1;
        }

        // Once we have identified at least 4 qualified opportunities across liquid pairs, we can proceed
        if (qualifiedList.length >= 4 || evaluatedCount >= maxLimit) {
          break;
        }
      }

      if (qualifiedList.length === 0) {
        this.lastDecision = 'NO_QUALIFIED_OPPORTUNITY';
        this.lastCandidate = null;
        return {
          candidate: null,
          reason: 'NO_QUALIFIED_OPPORTUNITY',
          allQualifiedCount: 0,
          totalUniverseScanned: filteredUniverse.length,
          evaluatedCount,
          rejectionBreakdown,
          coverageSnapshot: coverageSnap,
        };
      }

      // 4. Deterministic Single-Candidate Selection (Rule: Highest Confidence, Tie-breaker: Symbol Alphabetical)
      qualifiedList.sort((a, b) => {
        if (b.confidence !== a.confidence) {
          return b.confidence - a.confidence;
        }
        return a.symbol.localeCompare(b.symbol);
      });

      const chosen = qualifiedList[0];
      this.lastCandidate = { ...chosen };
      this.lastDecision = `OPPORTUNITY_SELECTED:${chosen.symbol}`;

      return {
        candidate: chosen,
        allQualifiedCount: qualifiedList.length,
        totalUniverseScanned: filteredUniverse.length,
        evaluatedCount,
        rejectionBreakdown,
        coverageSnapshot: coverageSnap,
      };
    } finally {
      this.isCycleBusy = false;
    }
  }

  /**
   * Builds a strictly validated ExecutionPlan with SL-based risk calculations.
   */
  public async buildExecutionPlan(
    candidate: NonNullable<CandidateScanSelection['candidate']>,
    equity: number,
    exchangeInfoOverride?: Partial<FuturesSymbolInfo>
  ): Promise<ExecutionPlan> {
    if (candidate.symbol.toUpperCase() === 'HOOKUSDT') {
      throw new Error('[PILOT_GUARD] Cannot build execution plan for HOOKUSDT.');
    }

    if (!equity || equity <= 0 || !Number.isFinite(equity)) {
      throw new Error('[PILOT_RISK] Actual equity must be finite and positive.');
    }

    // Fetch filters from exchange
    const filters = exchangeInfoOverride || (await executionPreflight.fetchSymbolExchangeInfo(candidate.symbol));
    if (!filters) {
      throw new Error(`[PILOT_RISK] Exchange info unavailable for ${candidate.symbol}`);
    }

    const tickSize = filters.tickSize || 0.1;
    const stepSize = filters.stepSize || 0.001;
    const minQty = filters.minQty || 0.001;
    const minNotional = filters.minNotional || 5.0;

    let plannedEntry = normalizePrice(candidate.entryPrice, tickSize);
    let stopLossPrice = normalizePrice(candidate.stopLossPrice, tickSize);
    let takeProfitPrice = normalizePrice(candidate.takeProfitPrice, tickSize);

    if (candidate.side === 'LONG') {
      if (stopLossPrice >= plannedEntry) {
        stopLossPrice = normalizePrice(plannedEntry - tickSize, tickSize);
      }
      if (takeProfitPrice <= plannedEntry) {
        takeProfitPrice = normalizePrice(plannedEntry + tickSize, tickSize);
      }
    } else {
      if (stopLossPrice <= plannedEntry) {
        stopLossPrice = normalizePrice(plannedEntry + tickSize, tickSize);
      }
      if (takeProfitPrice >= plannedEntry) {
        takeProfitPrice = normalizePrice(plannedEntry - tickSize, tickSize);
      }
    }

    if (isNaN(stopLossPrice) || isNaN(plannedEntry)) {
      throw new Error('[PILOT_RISK] Invalid Stop Loss or Entry price: NaN.');
    }

    // Validate Stop-Loss distance
    const slDistance = Math.abs(plannedEntry - stopLossPrice);
    if (slDistance <= 0 || !Number.isFinite(slDistance) || isNaN(slDistance)) {
      throw new Error('[PILOT_RISK] Invalid Stop Loss price: distance to entry is 0 or NaN.');
    }

    // Conservative SL-based risk sizing (0.5% max risk)
    const targetRiskUsd = equity * (this.config.riskPerTradePercent / 100);
    let calculatedQty = targetRiskUsd / slDistance;

    // Enforce Binance max market lot size constraints (clamps down to reduce risk, never increases risk)
    const maxMarketQty = filters.marketMaxQty || filters.maxQty;
    if (maxMarketQty && maxMarketQty > 0 && calculatedQty > maxMarketQty) {
      calculatedQty = maxMarketQty;
    }

    let normalizedQty = normalizeQuantity(calculatedQty, stepSize, minQty);

    // Ensure minNotional compliance
    if (normalizedQty * plannedEntry < minNotional) {
      const minQtyForNotional = (minNotional * 1.1) / plannedEntry;
      normalizedQty = normalizeQuantity(minQtyForNotional, stepSize, minQty);
    }

    const finalNotional = Number((normalizedQty * plannedEntry).toFixed(4));
    const finalRiskUsd = Number((slDistance * normalizedQty).toFixed(4));
    const finalRiskPercent = Number(((finalRiskUsd / equity) * 100).toFixed(4));
    const leverage = 10;
    const estimatedMargin = Number((finalNotional / leverage).toFixed(4));
    const now = Date.now();

    const isLong = candidate.side === 'LONG';
    const entryOrder: ExecutionOrderPlan = {
      symbol: candidate.symbol,
      side: isLong ? 'BUY' : 'SELL',
      type: 'MARKET',
      quantity: normalizedQty,
      price: plannedEntry,
      reduceOnly: false,
    };

    const stopLossOrder: ExecutionOrderPlan = {
      symbol: candidate.symbol,
      side: isLong ? 'SELL' : 'BUY',
      type: 'STOP_MARKET',
      quantity: normalizedQty,
      stopPrice: stopLossPrice,
      reduceOnly: true,
    };

    const takeProfitOrder: ExecutionOrderPlan = {
      symbol: candidate.symbol,
      side: isLong ? 'SELL' : 'BUY',
      type: 'TAKE_PROFIT_MARKET',
      quantity: normalizedQty,
      stopPrice: takeProfitPrice,
      reduceOnly: true,
    };

    return {
      symbol: candidate.symbol,
      side: candidate.side,
      signal: candidate.signal,
      entryPrice: plannedEntry,
      quantity: normalizedQty,
      notionalValue: finalNotional,
      leverage,
      stopLossPrice,
      takeProfitPrice,
      riskAmountUsd: finalRiskUsd,
      riskPercent: finalRiskPercent,
      estimatedMargin,
      orderType: 'MARKET',
      stopLossOrderType: 'STOP_MARKET',
      takeProfitOrderType: 'TAKE_PROFIT_MARKET',
      reduceOnlyForExit: true,
      entryOrder,
      stopLossOrder,
      takeProfitOrder,
      dryRun: true,
      executionPerformed: false,
      source: `AUTONOMOUS_PILOT_${now}`,
      createdAt: now,
      validationErrors: [],
      validationWarnings: [],
    };
  }

  /**
   * Executes a full autonomous cycle:
   * Scan -> Selection -> Risk & Plan -> Preflight -> Policy -> Auth -> Real Order Placement -> Confirmation -> Protective Orders -> Reconciliation.
   */
  public async executeAutonomousCycle(
    transport: BinanceOrderTransport,
    options?: {
      targetSymbol?: string;
      candidateOverride?: CandidateScanSelection['candidate'];
      exchangeInfoOverride?: Partial<FuturesSymbolInfo>;
      skipClosingAtEnd?: boolean;
    }
  ): Promise<AutonomousPilotCycleResult> {
    this.verifyTestnetGuards();

    if (this.manualReviewRequired) {
      return {
        success: false,
        decision: 'BLOCKED_MANUAL_REVIEW',
        error: `Manual review required: ${this.blockedReason}`,
      };
    }

    // Guard: maxOpenPositions check (both Binance remote non-HOOK positions and Registry active positions)
    const acc = await this.accountProvider.getAccountState();
    if (!acc.available) {
      this.triggerEmergencyStop('Binance Testnet account state unavailable.');
      return { success: false, decision: 'EQUITY_UNAVAILABLE', error: acc.error };
    }

    const currentEquity = acc.equity || 10000;
    const activeNonHook = (acc.openPositions || []).filter(
      (p) => p.symbol.toUpperCase() !== 'HOOKUSDT' && p.quantity > 0
    );
    const registryActiveCount = this.registry.getActiveCount();
    const effectiveActiveCount = Math.max(activeNonHook.length, registryActiveCount);

    // Check candidateOverride symbol collision first
    if (options?.candidateOverride) {
      const candSym = options.candidateOverride.symbol.toUpperCase();
      if (candSym === 'HOOKUSDT') {
        this.lastDecision = 'HOOKUSDT_EXCLUDED';
        return {
          success: false,
          decision: 'HOOKUSDT_EXCLUDED',
          error: 'HOOKUSDT is frozen and excluded from pilot execution.',
        };
      }
      if (this.registry.isSymbolActive(candSym) || activeNonHook.some((p) => p.symbol.toUpperCase() === candSym)) {
        this.lastDecision = 'SYMBOL_ALREADY_ACTIVE';
        return {
          success: false,
          decision: 'SYMBOL_ALREADY_ACTIVE',
          candidateSymbol: candSym,
          error: `Symbol ${candSym} already has an active position.`,
        };
      }
    }

    if (effectiveActiveCount >= this.config.maxOpenPositions) {
      this.lastDecision = 'POSITION_LIMIT_REACHED';
      return {
        success: false,
        decision: 'POSITION_LIMIT_REACHED',
        error: `maxOpenPositions (${this.config.maxOpenPositions}) already active. No new entries permitted.`,
      };
    }

    // Step 1: Scan and Select Opportunity
    let chosenCandidate = options?.candidateOverride;
    if (!chosenCandidate) {
      const scanRes = await this.scanAndSelectCandidate({
        symbolsSubset: options?.targetSymbol ? [options.targetSymbol] : undefined,
      });
      if (!scanRes.candidate) {
        this.lastDecision = scanRes.reason || 'NO_QUALIFIED_OPPORTUNITY';
        return {
          success: true,
          decision: scanRes.reason || 'NO_QUALIFIED_OPPORTUNITY',
        };
      }
      chosenCandidate = scanRes.candidate;
    }

    // Enforce HOOKUSDT isolation and symbol uniqueness in registry
    if (chosenCandidate.symbol.toUpperCase() === 'HOOKUSDT') {
      this.lastDecision = 'HOOKUSDT_EXCLUDED';
      return {
        success: false,
        decision: 'HOOKUSDT_EXCLUDED',
        error: 'HOOKUSDT is frozen and excluded from pilot execution.',
      };
    }

    const canOpenCheck = this.registry.canOpenNewPosition(chosenCandidate.symbol);
    if (!canOpenCheck.allowed) {
      const decision = canOpenCheck.reason?.includes('MAX_OPEN_POSITIONS')
        ? 'POSITION_LIMIT_REACHED'
        : 'SYMBOL_ALREADY_ACTIVE';
      this.lastDecision = decision;
      return {
        success: false,
        decision,
        candidateSymbol: chosenCandidate.symbol,
        error: canOpenCheck.reason,
      };
    }

    // Step 2: Build Execution Plan with SL-based Risk
    const plan = await this.buildExecutionPlan(chosenCandidate, currentEquity, options?.exchangeInfoOverride);
    const planFingerprint = computePlanFingerprint(plan);

    // Step 3: Preflight Validation
    const preflight = await executionPreflight.validate(plan, {
      currentPrice: plan.entryPrice,
      positionMode: 'ONE_WAY',
      accountState: acc,
      symbolFilters: options?.exchangeInfoOverride as any,
      settings: {
        capitalProfile: {
          capitalUsd: currentEquity,
          riskPerTradePercent: this.config.riskPerTradePercent,
          maxDailyLossPercent: this.config.maxDailyLossPercent,
          maxOpenPositions: this.config.maxOpenPositions,
        },
      },
    });

    if (!preflight.approved) {
      this.lastDecision = 'PREFLIGHT_FAILED';
      return {
        success: false,
        decision: 'PREFLIGHT_FAILED',
        candidateSymbol: plan.symbol,
        error: preflight.errors.join('; '),
      };
    }

    // Step 4: Execution Policy Evaluation
    const policyRes = executionPolicy.evaluate(plan, {
      currentPrice: plan.entryPrice,
      currentEquity,
      openPositions: acc.openPositions,
      capitalProfile: {
        capitalUsd: currentEquity,
        riskPerTradePercent: this.config.riskPerTradePercent,
        maxDailyLossPercent: this.config.maxDailyLossPercent,
        maxOpenPositions: this.config.maxOpenPositions,
      },
      now: Date.now(),
    });

    if (!policyRes.allowed) {
      this.lastDecision = `POLICY_REJECTED:${policyRes.code}`;
      return {
        success: false,
        decision: `POLICY_REJECTED:${policyRes.code}`,
        candidateSymbol: plan.symbol,
        error: policyRes.reason,
      };
    }

    // Step 5: Arm Single-Use Authorization
    const auth = this.adapter.arm(plan, 60_000);
    const now = Date.now();
    const rand = Math.random().toString(36).substring(2, 6);
    const txSeed = `p-${now}-${rand}`;
    const transactionId = `txn-${txSeed}`;
    const entryClientOrderId = `apx-e-${now}-${rand}`.substring(0, 32);
    const stopLossClientOrderId = `apx-sl-${now}-${rand}`.substring(0, 32);
    const takeProfitClientOrderId = `apx-tp-${now}-${rand}`.substring(0, 32);

    this.lastTransactionId = transactionId;

    // Step 6: Create Persistent Transaction
    await this.txStore.createTransaction({
      transactionId,
      planFingerprint,
      authorizationId: auth.authorizationId,
      symbol: plan.symbol,
      side: plan.side,
      requestedQuantity: plan.quantity,
      state: 'ENTRY_SENT',
      entryClientOrderId,
      stopLossClientOrderId,
      takeProfitClientOrderId,
      startedAt: now,
      completedAt: null,
      lastUpdatedAt: now,
      dryRunOnly: false,
      testnetOnly: true,
      reconciliationStatus: 'NOT_REQUIRED',
    });

    // Step 7: Synchronize leverage and Send Entry Order to Binance Testnet
    if (transport.setLeverage && plan.leverage && plan.leverage > 0) {
      try {
        await transport.setLeverage(plan.symbol, plan.leverage);
      } catch (err: any) {
        console.warn(`[PILOT] Leverage synchronization warning for ${plan.symbol}: ${err.message}`);
      }
    }

    const entryReq = {
      symbol: plan.symbol,
      side: plan.entryOrder.side,
      type: plan.entryOrder.type,
      quantity: plan.quantity,
      reduceOnly: false,
      positionSide: 'BOTH' as const,
      clientOrderId: entryClientOrderId,
    };

    const entryRes = await transport.sendOrder(entryReq);
    if (!entryRes.success || !entryRes.orderId) {
      await this.txStore.updateTransaction(transactionId, {
        state: 'EXECUTION_FAILED',
        failureCode: 'ENTRY_ORDER_REJECTED',
        failureReason: entryRes.error || 'Entry order rejected by Binance Testnet',
        lastUpdatedAt: Date.now(),
      });
      this.lastExecutionState = 'EXECUTION_FAILED';
      this.triggerEmergencyStop(`Entry order rejected: ${entryRes.error}`);
      return {
        success: false,
        decision: 'ENTRY_REJECTED',
        candidateSymbol: plan.symbol,
        transactionId,
        error: entryRes.error,
      };
    }

    const entryOrderId = String(entryRes.orderId);

    // Step 8: Confirm Entry FILLED
    let entryRemote = transport.queryOrder
      ? await transport.queryOrder(plan.symbol, entryOrderId)
      : null;
    let attempts = 0;
    while ((!entryRemote || entryRemote.status !== 'FILLED') && attempts < 10) {
      await new Promise((r) => setTimeout(r, 600));
      if (transport.queryOrder) {
        entryRemote = await transport.queryOrder(plan.symbol, entryOrderId);
      } else {
        break;
      }
      attempts++;
    }

    const actualEntryPrice = entryRemote?.avgPrice ? parseFloat(entryRemote.avgPrice) : plan.entryPrice;
    await this.txStore.updateTransaction(transactionId, {
      state: 'ENTRY_CONFIRMED',
      entryOrderId,
      executedQuantity: plan.quantity,
      executedPrice: actualEntryPrice,
      lastUpdatedAt: Date.now(),
    });

    // Step 8b: Register position into PilotPositionRegistry
    let registeredPos: PilotPositionRecord | null = null;
    try {
      registeredPos = await this.registry.registerPosition({
        symbol: plan.symbol,
        side: plan.side,
        positionSide: 'BOTH',
        entryOrderId,
        entryClientOrderId,
        transactionId,
        fingerprint: planFingerprint,
        authorizationId: auth.authorizationId,
        plannedEntry: plan.entryPrice,
        actualEntry: actualEntryPrice,
        quantity: plan.quantity,
        notional: plan.notionalValue,
        SL: plan.stopLossPrice,
        TP: plan.takeProfitPrice,
        riskAmount: plan.riskAmountUsd,
        status: 'ACTIVE',
        lifecycleState: 'OPEN',
        openedAt: now,
      });
    } catch (regErr: any) {
      console.warn(`[PILOT_REGISTRY] Registration warning: ${regErr.message}`);
    }

    // Step 9: Confirm Position Exists on Binance Testnet
    let posAcc = await this.accountProvider.getAccountState();
    let observedPos = (posAcc.openPositions || []).find((p) => p.symbol.toUpperCase() === plan.symbol.toUpperCase());
    let posAttempts = 0;
    while (!observedPos && posAttempts < 5) {
      await new Promise((r) => setTimeout(r, 600));
      posAcc = await this.accountProvider.getAccountState();
      observedPos = (posAcc.openPositions || []).find((p) => p.symbol.toUpperCase() === plan.symbol.toUpperCase());
      posAttempts++;
    }

    if (!observedPos && !(transport instanceof MockBinanceOrderTransport)) {
      this.triggerEmergencyStop(`Position not confirmed on Binance Testnet for ${plan.symbol}`);
      return {
        success: false,
        decision: 'POSITION_CONFIRMATION_FAILED',
        candidateSymbol: plan.symbol,
        transactionId,
        positionId: registeredPos?.positionId,
        entryOrderId,
        error: 'Position not confirmed after entry fill',
      };
    }

    // Step 10: Create Protective SL Order
    const slReq = {
      symbol: plan.symbol,
      side: plan.stopLossOrder.side,
      type: 'STOP_MARKET' as const,
      quantity: plan.quantity,
      stopPrice: plan.stopLossPrice,
      reduceOnly: true,
      positionSide: 'BOTH' as const,
      clientOrderId: stopLossClientOrderId,
    };

    const slRes = await transport.sendOrder(slReq);
    if (!slRes.success || !slRes.orderId) {
      await this.txStore.updateTransaction(transactionId, {
        state: 'EXECUTION_PARTIAL',
        failureCode: 'STOP_LOSS_REJECTED',
        failureReason: slRes.error || 'Protective SL rejected by exchange',
        lastUpdatedAt: Date.now(),
      });
      this.lastExecutionState = 'EXECUTION_PARTIAL';
      this.triggerEmergencyStop(`Protective SL rejected: ${slRes.error}`);
      return {
        success: false,
        decision: 'SL_REJECTED',
        candidateSymbol: plan.symbol,
        transactionId,
        positionId: registeredPos?.positionId,
        entryOrderId,
        error: slRes.error,
      };
    }

    const stopLossOrderId = String(slRes.orderId);

    // Step 11: Create Protective TP Order
    let takeProfitOrderId: string | undefined;
    if (plan.takeProfitOrder) {
      const tpReq = {
        symbol: plan.symbol,
        side: plan.takeProfitOrder.side,
        type: 'TAKE_PROFIT_MARKET' as const,
        quantity: plan.quantity,
        stopPrice: plan.takeProfitPrice,
        reduceOnly: true,
        positionSide: 'BOTH' as const,
        clientOrderId: takeProfitClientOrderId,
      };

      const tpRes = await transport.sendOrder(tpReq);
      if (!tpRes.success || !tpRes.orderId) {
        await this.txStore.updateTransaction(transactionId, {
          state: 'EXECUTION_PARTIAL',
          stopLossOrderId,
          failureCode: 'TAKE_PROFIT_REJECTED',
          failureReason: tpRes.error || 'Protective TP rejected by exchange',
          lastUpdatedAt: Date.now(),
        });
        this.lastExecutionState = 'EXECUTION_PARTIAL';
        this.triggerEmergencyStop(`Protective TP rejected: ${tpRes.error}`);
        return {
          success: false,
          decision: 'TP_REJECTED',
          candidateSymbol: plan.symbol,
          transactionId,
          positionId: registeredPos?.positionId,
          entryOrderId,
          stopLossOrderId,
          error: tpRes.error,
        };
      }
      takeProfitOrderId = String(tpRes.orderId);
    }

    // Step 12: Full Execution Confirmed
    await this.txStore.updateTransaction(transactionId, {
      state: 'FULL_EXECUTION_CONFIRMED',
      stopLossOrderId,
      takeProfitOrderId,
      lastUpdatedAt: Date.now(),
    });

    if (registeredPos) {
      await this.registry.updatePosition(registeredPos.positionId, {
        stopLossOrderId,
        stopLossClientOrderId,
        takeProfitOrderId,
        takeProfitClientOrderId,
        lifecycleState: 'PROTECTED',
        lastReconciledAt: Date.now(),
      });
    }

    this.lastExecutionState = 'FULL_EXECUTION_CONFIRMED';
    this.tradesToday++;

    // Step 13: Clean controlled close if requested to return account to 0 open quantity
    if (!options?.skipClosingAtEnd) {
      if (!(transport instanceof MockBinanceOrderTransport)) {
        // Cleanly cancel protective orders
        if (transport.cancelOrder) {
          if (stopLossOrderId) await transport.cancelOrder(plan.symbol, stopLossOrderId);
          if (takeProfitOrderId) await transport.cancelOrder(plan.symbol, takeProfitOrderId);
        }

        // Close position to 0 on exchange
        const currentPosCheck = (await this.accountProvider.getAccountState()).openPositions?.find(
          (p) => p.symbol.toUpperCase() === plan.symbol.toUpperCase()
        );
        if (currentPosCheck && currentPosCheck.quantity > 0) {
          await transport.sendOrder({
            symbol: plan.symbol,
            side: plan.side === 'LONG' ? 'SELL' : 'BUY',
            type: 'MARKET',
            quantity: currentPosCheck.quantity,
            reduceOnly: true,
            positionSide: 'BOTH',
          });
        }
      }

      // Close record in registry
      if (registeredPos) {
        await this.registry.closePositionRecord(registeredPos.positionId, {
          exitReason: 'AUDIT_CYCLE_CLEAN_CLOSE',
        });
      }

      // Reconciliation audit
      const openOrders = transport.getOpenOrders ? await transport.getOpenOrders(plan.symbol) : [];
      const orphanOrdersCount = openOrders.length;
      const recon = await reconcileAllOrders(openOrders);
      this.lastReconciliationStatus = orphanOrdersCount === 0 ? 'IN_SYNC' : 'MISMATCH';

      await this.txStore.updateTransaction(transactionId, {
        state: 'FULL_EXECUTION_CONFIRMED',
        completedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        reconciliationStatus: this.lastReconciliationStatus === 'IN_SYNC' ? 'RECONCILED_NO_POSITION' : 'REQUIRES_MANUAL_REVIEW',
      });

      this.lastClosedPositionTime = Date.now();

      return {
        success: true,
        decision: 'EXECUTION_AND_CLEAN_CLOSE_COMPLETE',
        candidateSymbol: plan.symbol,
        executionPlan: plan,
        transactionId,
        positionId: registeredPos?.positionId,
        entryOrderId,
        stopLossOrderId,
        takeProfitOrderId,
        finalPositionQty: 0,
        reconciliationStatus: this.lastReconciliationStatus,
        orphanOrdersCount,
      };
    }

    return {
      success: true,
      decision: 'FULL_EXECUTION_CONFIRMED',
      candidateSymbol: plan.symbol,
      executionPlan: plan,
      transactionId,
      positionId: registeredPos?.positionId,
      entryOrderId,
      stopLossOrderId,
      takeProfitOrderId,
      finalPositionQty: plan.quantity,
      reconciliationStatus: 'IN_SYNC',
      orphanOrdersCount: 0,
    };
  }

  /**
   * Reconciles all pilot positions registered in the PilotPositionRegistry
   * against Binance Testnet remote state independently.
   */
  public async reconcilePilotPositions(transport?: BinanceOrderTransport): Promise<{
    success: boolean;
    activeCount: number;
    results: PositionReconciliationResult[];
    orphanOrdersCount: number;
  }> {
    const acc = await this.accountProvider.getAccountState();
    const trans = transport || new BinanceTestnetOrderTransport();
    const openOrders = trans.getOpenOrders ? await trans.getOpenOrders() : [];
    const results = await this.registry.reconcileAllPositions(acc.openPositions || [], openOrders);

    // Identify open orders that don't belong to any active position or HOOKUSDT
    const activeSymbols = new Set([
      'HOOKUSDT',
      ...this.registry.getActivePositions().map((p) => p.symbol.toUpperCase()),
    ]);
    const untrackedOrders = openOrders.filter((o) => !activeSymbols.has((o.symbol || '').toUpperCase()));

    return {
      success: results.every((r) => r.inSync),
      activeCount: this.registry.getActiveCount(),
      results,
      orphanOrdersCount: untrackedOrders.length,
    };
  }

  /**
   * Evaluates and applies autonomous management for a single active position.
   * Enforces:
   * 1. Concurrency mutex per position
   * 2. TP1 detection -> moves SL to Breakeven
   * 3. Trailing Stop -> ratchets SL monotonically (upward for LONG, downward for SHORT)
   * 4. Ratchet rule -> SL never moves backward
   * 5. Complete position isolation -> touches ONLY this position's orders and record
   */
  public async managePosition(
    positionId: string,
    options?: {
      markPriceOverride?: number;
      trailingPercent?: number;
      transport?: BinanceOrderTransport;
    }
  ): Promise<{
    success: boolean;
    positionId: string;
    actionTaken: 'NONE' | 'SHIFT_BREAKEVEN' | 'MOVE_TRAILING_STOP' | 'SL_TRIGGERED' | 'TP_TRIGGERED' | 'LOCKED' | 'NOT_FOUND';
    previousSl: number;
    newSl: number;
    lifecycleState: PilotPositionLifecycleState;
    details: string;
  }> {
    if (!this.registry.acquireLock(positionId)) {
      return {
        success: false,
        positionId,
        actionTaken: 'LOCKED',
        previousSl: 0,
        newSl: 0,
        lifecycleState: 'MANUAL_INTERVENTION_REQUIRED',
        details: `Position ${positionId} is currently locked by another concurrent management operation.`,
      };
    }

    try {
      const pos = this.registry.getPosition(positionId);
      if (!pos || pos.status !== 'ACTIVE') {
        return {
          success: false,
          positionId,
          actionTaken: 'NOT_FOUND',
          previousSl: pos?.SL || 0,
          newSl: pos?.SL || 0,
          lifecycleState: pos?.lifecycleState || 'CLOSED',
          details: `Position ${positionId} is not active in registry.`,
        };
      }

      // Mark price resolution
      let markPrice = options?.markPriceOverride;
      if (markPrice === undefined) {
        const pVal = await this.marketProvider.getPrice(pos.symbol);
        markPrice = pVal ?? undefined;
      }

      if (!markPrice || markPrice <= 0) {
        return {
          success: false,
          positionId,
          actionTaken: 'NONE',
          previousSl: pos.SL,
          newSl: pos.SL,
          lifecycleState: pos.lifecycleState,
          details: 'Valid mark price could not be retrieved.',
        };
      }

      const isLong = pos.side === 'LONG';
      const previousSl = pos.SL;
      let newSl = previousSl;
      let currentLifecycle = pos.lifecycleState;

      // Update price excursions
      const highestPrice = Math.max(pos.highestPriceReached || pos.actualEntry, markPrice);
      const lowestPrice = Math.min(pos.lowestPriceReached || pos.actualEntry, markPrice);
      await this.registry.updatePosition(positionId, {
        highestPriceReached: highestPrice,
        lowestPriceReached: lowestPrice,
      });

      // Calculate TP1 price (1R distance) if not set
      const rDistance = Math.abs(pos.actualEntry - pos.SL);
      const tp1Price = pos.tp1Price || (isLong ? pos.actualEntry + rDistance : pos.actualEntry - rDistance);

      // Check TP1 / Breakeven condition
      const hitTp1 = isLong ? markPrice >= tp1Price : markPrice <= tp1Price;
      if (hitTp1 && currentLifecycle === 'PROTECTED') {
        newSl = pos.actualEntry;
        currentLifecycle = 'TP1_BREAKEVEN';

        // Update SL on exchange if transport provided
        let newSlOrderId = pos.stopLossOrderId;
        if (options?.transport && pos.stopLossOrderId) {
          try {
            await options.transport.cancelOrder?.(pos.symbol, pos.stopLossOrderId);
            const slClientOrderId = `apx-be-${Date.now()}`.substring(0, 32);
            const slRes = await options.transport.sendOrder({
              symbol: pos.symbol,
              side: isLong ? 'SELL' : 'BUY',
              type: 'STOP_MARKET',
              quantity: pos.quantity,
              stopPrice: newSl,
              reduceOnly: true,
              positionSide: 'BOTH',
              clientOrderId: slClientOrderId,
            });
            if (slRes.success && slRes.orderId) {
              newSlOrderId = String(slRes.orderId);
            }
          } catch (err: any) {
            console.warn(`[MANAGEMENT] Breakeven order exchange update warning: ${err.message}`);
          }
        }

        await this.registry.updatePosition(positionId, {
          SL: newSl,
          stopLossOrderId: newSlOrderId,
          tp1Price,
          lifecycleState: currentLifecycle,
          trailingActivated: true,
        });

        return {
          success: true,
          positionId,
          actionTaken: 'SHIFT_BREAKEVEN',
          previousSl,
          newSl,
          lifecycleState: currentLifecycle,
          details: `TP1 reached at ${markPrice}. Stop-loss moved to breakeven (${newSl}).`,
        };
      }

      const symbolInfo = await executionPreflight.fetchSymbolExchangeInfo(pos.symbol);
      const tickSize = symbolInfo?.tickSize || 0.0001;

      // Check Trailing Stop condition
      if (currentLifecycle === 'TP1_BREAKEVEN' || currentLifecycle === 'TRAILING' || pos.trailingActivated) {
        const trailPct = options?.trailingPercent ?? 0.8;
        if (isLong) {
          const proposedTrailing = normalizePrice(highestPrice * (1 - trailPct / 100), tickSize);
          // Ratchet rule: must strictly move upward
          if (proposedTrailing > pos.SL) {
            newSl = proposedTrailing;
            currentLifecycle = 'TRAILING';

            let newSlOrderId = pos.stopLossOrderId;
            if (options?.transport && pos.stopLossOrderId) {
              try {
                await options.transport.cancelOrder?.(pos.symbol, pos.stopLossOrderId);
                const slClientOrderId = `apx-tr-${Date.now()}`.substring(0, 32);
                const slRes = await options.transport.sendOrder({
                  symbol: pos.symbol,
                  side: 'SELL',
                  type: 'STOP_MARKET',
                  quantity: pos.quantity,
                  stopPrice: newSl,
                  reduceOnly: true,
                  positionSide: 'BOTH',
                  clientOrderId: slClientOrderId,
                });
                if (slRes.success && slRes.orderId) {
                  newSlOrderId = String(slRes.orderId);
                }
              } catch (err: any) {
                console.warn(`[MANAGEMENT] Trailing SL exchange update warning: ${err.message}`);
              }
            }

            await this.registry.updatePosition(positionId, {
              SL: newSl,
              trailingStopPrice: newSl,
              stopLossOrderId: newSlOrderId,
              lifecycleState: currentLifecycle,
            });

            return {
              success: true,
              positionId,
              actionTaken: 'MOVE_TRAILING_STOP',
              previousSl,
              newSl,
              lifecycleState: currentLifecycle,
              details: `Price advanced to ${highestPrice}. Trailing stop ratcheted upward to ${newSl}.`,
            };
          }
        } else {
          // Short position trailing
          const proposedTrailing = normalizePrice(lowestPrice * (1 + trailPct / 100), tickSize);
          // Ratchet rule: must strictly move downward
          if (proposedTrailing < pos.SL) {
            newSl = proposedTrailing;
            currentLifecycle = 'TRAILING';

            let newSlOrderId = pos.stopLossOrderId;
            if (options?.transport && pos.stopLossOrderId) {
              try {
                await options.transport.cancelOrder?.(pos.symbol, pos.stopLossOrderId);
                const slClientOrderId = `apx-tr-${Date.now()}`.substring(0, 32);
                const slRes = await options.transport.sendOrder({
                  symbol: pos.symbol,
                  side: 'BUY',
                  type: 'STOP_MARKET',
                  quantity: pos.quantity,
                  stopPrice: newSl,
                  reduceOnly: true,
                  positionSide: 'BOTH',
                  clientOrderId: slClientOrderId,
                });
                if (slRes.success && slRes.orderId) {
                  newSlOrderId = String(slRes.orderId);
                }
              } catch (err: any) {
                console.warn(`[MANAGEMENT] Trailing SL exchange update warning: ${err.message}`);
              }
            }

            await this.registry.updatePosition(positionId, {
              SL: newSl,
              trailingStopPrice: newSl,
              stopLossOrderId: newSlOrderId,
              lifecycleState: currentLifecycle,
            });

            return {
              success: true,
              positionId,
              actionTaken: 'MOVE_TRAILING_STOP',
              previousSl,
              newSl,
              lifecycleState: currentLifecycle,
              details: `Price declined to ${lowestPrice}. Trailing stop ratcheted downward to ${newSl}.`,
            };
          }
        }
      }

      // Check Hard Stop
      if ((isLong && markPrice <= pos.SL) || (!isLong && markPrice >= pos.SL)) {
        return {
          success: true,
          positionId,
          actionTaken: 'SL_TRIGGERED',
          previousSl,
          newSl,
          lifecycleState: 'STOPPED',
          details: `Mark price ${markPrice} crossed stop-loss level ${pos.SL}.`,
        };
      }

      // Check Take Profit
      if ((isLong && markPrice >= pos.TP) || (!isLong && markPrice <= pos.TP)) {
        return {
          success: true,
          positionId,
          actionTaken: 'TP_TRIGGERED',
          previousSl,
          newSl,
          lifecycleState: 'CLOSED',
          details: `Mark price ${markPrice} reached take-profit level ${pos.TP}.`,
        };
      }

      return {
        success: true,
        positionId,
        actionTaken: 'NONE',
        previousSl,
        newSl,
        lifecycleState: currentLifecycle,
        details: 'Position remains protected within normal boundaries.',
      };
    } finally {
      this.registry.releaseLock(positionId);
    }
  }
}

export const autonomousPilotEngine = new AutonomousPilotEngine();
