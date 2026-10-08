export type TradeDirection = 'LONG' | 'SHORT';
export type AllowedDirection = 'BOTH' | 'LONG_ONLY' | 'SHORT_ONLY';
export type TradingMode = 'real' | 'testnet' | 'paper';

export interface WalletProfile {
  id: string;
  name: string;
  isTestnet: boolean;
  isValidated: boolean;
  createdAt: number;
}

export interface BinanceCredentials {
  id?: string;
  walletName?: string;
  isTestnet: boolean;
  isValidated: boolean;
  isServerConfigured?: boolean;
}

export interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
  notifyOnOpen: boolean;
  notifyOnClose: boolean;
  notifyOnTakeProfit: boolean;
  notifyOnStopLoss: boolean;
  notifyOnReconciliationError: boolean;
  notifyOnUptimeMilestone: boolean;
  notifyOnCircuitBreaker: boolean;
}

export type MarketRegime =
  | 'TRENDING_BULL'
  | 'TRENDING_BEAR'
  | 'RANGING_CONSOLIDATION'
  | 'VOLATILITY_BREAKOUT'
  | 'HIGH_NOISE';

export interface BotSettings {
  // Position & Risk Sizing
  maxConcurrentPositions: number; // e.g. 1 to 10
  riskPerTradePercent: number; // e.g. 1.0% to 2.5% of account equity
  positionSizeUsd: number; // Fallback or fixed reference USD amount (e.g. $2.5, $10, $50)
  useRiskBasedSizing: boolean; // Calculate size dynamically: (Equity * Risk%) / SL Distance
  leverage: number; // 1x to 125x
  allowedDirection: AllowedDirection; // BOTH, LONG_ONLY, SHORT_ONLY
  marginType: 'ISOLATED' | 'CROSSED';

  // Portfolio & Hard Limits
  maxOpenRiskPercent: number; // Max aggregate risk allowed across all positions (e.g. 6.0%)
  maxNotionalExposureUsd: number; // Max total notional exposure across positions
  maxAllocatedCapitalUsd: number; // Max margin allocated to bot
  enableCapitalLimit: boolean;

  // Circuit Breakers & Cooldowns
  maxDailyDrawdownPercent: number; // e.g. 3.0% daily circuit breaker
  maxDailyLossUsd: number; // Max absolute USD loss per day
  maxConsecutiveLosses: number; // e.g. 3 consecutive losses
  lossCooldownMinutes: number; // Cooldown period after hitting max consecutive losses

  // Trade Execution & Targets
  takeProfitPercent: number; // e.g. 2.5%
  stopLossPercent: number; // e.g. 1.2%
  trailingStopPercent: number; // e.g. 0.8%
  useTrailingStop: boolean;
  aiDynamicTargets: boolean; // Sizing targets via volatility & ATR
  multiTargetTrailing: boolean; // Moves SL to TP1, then TP2
  unlimitedHoldTime: boolean;
  maxTradeDurationHours: number; // Expiry duration if unlimitedHoldTime is false

  // Market Filters
  minAiConfidence: number; // e.g. 75%
  maxSpreadPercent: number; // e.g. 0.15%
  maxDataAgeSeconds: number; // Stale data cutoff (e.g. 15s)
  minVolume24hUsd: number; // e.g. 5,000,000 USDT minimum volume

  // Autonomous Operation & Sessions
  autoTradingEnabled: boolean;
  scanIntervalSeconds: number;
  enableToastAlerts: boolean;
  maxSessionDurationHours: number; // 0 = disabled (unlimited until manual stop), e.g. 5 for 5-hour limit
  killSwitchActive: boolean; // Emergency stop switch
  killSwitchPolicy: 'HOLD_PROTECTED' | 'CLOSE_ALL';
  productionConfirmed: boolean; // Explicit confirmation flag before real trading
  capitalProfile: CapitalProfile; // Configurable Capital & Risk Profile
}

export interface AccountBalance {
  totalWalletBalance: number;
  availableBalance: number;
  totalUnrealizedProfit: number;
  totalMarginBalance: number;
  totalInitialMargin: number;
  totalMaintMargin: number;
}

export type ProtectiveOrderStatus = 'UNSUBMITTED' | 'SUBMITTED' | 'ACTIVE' | 'FILLED' | 'REJECTED' | 'CANCELED';
export type ReconciliationStatus = 'IN_SYNC' | 'DESYNC_DETECTED' | 'RECONCILING' | 'ERROR';

export interface Position {
  id: string;
  symbol: string;
  side: TradeDirection;
  entryPrice: number;
  markPrice: number;
  quantity: number;
  amountUsd: number; // Margin allocated
  notionalValue: number; // quantity * markPrice
  leverage: number;
  liquidationPrice: number;
  unrealizedProfit: number;
  pnlPercentage: number;

  // Planned & Confirmed Exchange Protective Orders
  stopLossPrice: number;
  takeProfitPrice: number;
  tp1Price?: number;
  tp2Price?: number;
  tp3Price?: number;
  tpLevelReached?: 0 | 1 | 2 | 3;
  securedProfitUsd?: number;
  initialStopLossPrice?: number;
  highestPriceReached?: number;
  lowestPriceReached?: number;

  // Exchange Order Tracking
  exchangeEntryOrderId?: string;
  exchangeStopLossOrderId?: string;
  exchangeTakeProfitOrderId?: string;
  stopLossOrderStatus: ProtectiveOrderStatus;
  takeProfitOrderStatus: ProtectiveOrderStatus;
  lastReconciliationTime: number;
  reconciliationStatus: ReconciliationStatus;
  reconciliationMessage?: string;

  // Realized & Estimated Cost Tracking
  estimatedCommissionUsd: number;
  fundingFeeUsd: number;
  slippageEstimateUsd: number;

  // Execution Meta
  openedAt: number;
  maxDurationMs: number;
  aiConfidence: number;
  rationale: string;
  isRealOrder?: boolean;
  isTestnet?: boolean;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  amountUsd: number;
  notionalValue: number;
  leverage: number;
  pnl: number; // net realized PnL alias for backward-compatible UI bindings
  grossPnl: number;
  commissionPaid: number;
  fundingFeePaid: number;
  slippageEstimated: number;
  netPnl: number;
  pnlPercentage: number;
  openedAt: number;
  closedAt: number;
  durationMs: number;
  exitReason:
    | 'TAKE_PROFIT'
    | 'STOP_LOSS'
    | 'TRAILING_STOP'
    | 'TIME_EXPIRED'
    | 'MANUAL_CLOSE'
    | 'KILL_SWITCH'
    | 'LIQUIDATION'
    | 'RECONCILIATION_DESYNC';
  aiConfidence: number;
  wasWinning: boolean;
  tpLevelReached?: number;
  securedProfitUsd?: number;
  marketRegime?: MarketRegime;
  strategyVersion: string;
  modelVersion: string;
  indicatorsAtEntry?: {
    rsi14: number;
    ema9: number;
    ema21: number;
    atr14: number;
    adx14: number;
    orderbookRatio: number;
  };
  maxAdverseExcursionPercent: number; // MAE
  maxFavorableExcursionPercent: number; // MFE
  isRealOrder?: boolean;
}

export interface FuturesSymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  minQty: number;
  maxQty?: number;
  marketMaxQty?: number;
  stepSize: number;
  tickSize: number;
  minNotional: number;
  price: number;
  markPrice?: number;
  priceChangePercent: number;
  volume24h: number;
  quoteVolume24h: number;
  high24h: number;
  low24h: number;
  fundingRate?: number;
  openInterest?: number;

  // Real Mathematically Derived Indicators
  rsi14: number;
  ema9?: number;
  ema21?: number;
  ema50?: number;
  ema200?: number;
  atr14?: number;
  adx14?: number;
  macd?: { macd: number; signal: number; histogram: number };
  vwap?: number;
  relativeVolume?: number;
  spreadPercent?: number;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  marketRegime?: MarketRegime;

  // Real Orderbook Imbalance
  orderbookRatio: number; // Real bid/ask depth volume ratio
  bidDepthUsd?: number;
  askDepthUsd?: number;

  // Signal & Rejection Reason
  aiScore: number; // 0 to 100
  aiRecommendedSignal: 'BUY_LONG' | 'SELL_SHORT' | 'HOLD';
  candidateRejectionReason?: string;
  dataFreshnessMs?: number;
  isStale?: boolean;
  timeframe?: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  tradesCount: number;
}

export interface MultiTimeframeCandles {
  '5m': Candle[];
  '15m': Candle[];
  '1h': Candle[];
  '4h': Candle[];
}

export interface EvaluatedCandidate {
  symbol: string;
  qualified: boolean;
  signal: 'BUY_LONG' | 'SELL_SHORT' | 'NO_TRADE';
  confidence: number;
  rationale: string;
  rejectionReason?: string;
  regime: MarketRegime;
  plannedStopLossPrice: number;
  plannedTakeProfitPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  atr: number;
  riskRewardRatio: number;
  suggestedLeverage: number;
}

export interface CapitalProfile {
  capitalUsd: number; // 0 = AUTO (Live Account Equity), or fixed dollar amount (e.g. $20.00)
  riskPerTradePercent: number; // 0 = NO TRADING (Trading disabled), or % of equity (e.g. 1.0%)
  maxDailyLossPercent: number; // 0 = DISABLED (Daily loss circuit breaker off), or % (e.g. 5.0%)
  maxOpenPositions: number; // 0 = NO TRADING (New positions disabled), or max open positions (e.g. 2)
}

export const DEFAULT_CAPITAL_PROFILE: CapitalProfile = {
  capitalUsd: 20,
  riskPerTradePercent: 1,
  maxDailyLossPercent: 5,
  maxOpenPositions: 4,
};

export interface BotSession {
  sessionId: string;
  status: 'RUNNING' | 'STOPPED';
  startedAt: number | null;
  stoppedAt: number | null;
  uptimeSeconds: number;
  formattedDuration: string; // HH:MM:SS
  isServerBacked?: boolean;
}

export interface BotSessionState {
  sessionId: string;
  status: 'RUNNING' | 'STOPPED';
  startedAt: number | null;
  stoppedAt: number | null;
  uptimeSeconds: number;
  startTime: number;
  elapsedSeconds: number;
  formattedDuration: string; // HH:MM:SS (e.g. 05:00:00)
  fiveHourNotified: boolean;
  isServerBacked: boolean;
  lastHeartbeat: number;
  maxDurationReached?: boolean;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  netProfitUsd: number;
  totalCommissionsUsd: number;
  totalFundingFeesUsd: number;
  totalSlippageUsd: number;
  profitFactor: number;
  expectancyUsd: number;
  averageWinUsd: number;
  averageLossUsd: number;
  maxDrawdownUsd: number;
  maxDrawdownPercent: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  averageHoldingTimeMinutes: number;
  longPerformance: { trades: number; winRate: number; netPnl: number };
  shortPerformance: { trades: number; winRate: number; netPnl: number };
  measurementPeriodDays: number;
}

export interface AILearningState {
  modelVersion: string;
  strategyVersion: string;
  trainingGeneration: number;
  trainingIterations: number;
  accuracyRate: number;
  totalEvaluatedTrades: number;
  inSampleTrades: number;
  outOfSampleTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  isCalibrated: boolean;
  calibrationBrierScore: number;
  hasSufficientData: boolean; // Requires >= 15 completed trades
  weights: {
    rsiMomentum: number;
    volumeSurge: number;
    volatilityBreakout: number;
    trendAlignment: number;
    orderbookImbalance: number;
    supportResistanceBounce: number;
  };
  recentLogs: Array<{
    id: string;
    timestamp: number;
    symbol: string;
    action: string;
    outcome?: 'WIN' | 'LOSS' | 'OPTIMIZING';
    detail: string;
  }>;
  calibrationBuckets: Array<{
    confidenceRange: string;
    predictedProb: number;
    empiricalWinRate: number;
    tradeCount: number;
  }>;
}

export interface BacktestResult {
  symbol: string;
  interval: string;
  periodDays: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  initialCapital: number;
  finalCapital: number;
  grossProfit: number;
  totalCommissions: number;
  totalFundingCosts: number;
  totalSlippage: number;
  netProfit: number;
  netProfitPercent: number;
  maxDrawdown: number;
  profitFactor: number;
  expectancyPerTrade: number;
  assumptions: {
    takerFeePercent: number;
    makerFeePercent: number;
    slippagePercent: number;
    fundingRateEstimated: number;
    barExecutionRule: string;
  };
  trades: Array<{
    entryTime: number;
    exitTime: number;
    side: TradeDirection;
    entryPrice: number;
    exitPrice: number;
    grossPnl: number;
    commission: number;
    netPnl: number;
    netPnlPercent: number;
    pnl: number;
    pnlPercent: number;
    reason: string;
    marketRegime: string;
  }>;
}

export interface CopyTradingMaster {
  id: string;
  name: string;
  tagline: string;
  avatar: string;
  roi30d: number;
  winRate: number;
  totalTrades: number;
  maxDrawdown: number;
  copiersCount: number;
  riskScore: 'Low' | 'Medium' | 'High';
  strategyDescription: string;
  preferredPairs: string[];
}

export interface ToastAlert {
  id: string;
  type: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_WIN' | 'CLOSE_LOSS' | 'INFO' | 'WARNING' | 'ERROR';
  title: string;
  message: string;
  symbol?: string;
  side?: TradeDirection;
  pnl?: number;
  pnlPercentage?: number;
  timestamp: number;
}
