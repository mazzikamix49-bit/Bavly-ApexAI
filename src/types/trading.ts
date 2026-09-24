export type TradeDirection = 'LONG' | 'SHORT';
export type AllowedDirection = 'BOTH' | 'LONG_ONLY' | 'SHORT_ONLY';
export type TradingMode = 'real' | 'paper';

export interface WalletProfile {
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
  isTestnet: boolean;
  isValidated: boolean;
  createdAt: number;
}

export interface BinanceCredentials {
  id?: string;
  walletName?: string;
  apiKey: string;
  apiSecret: string;
  isTestnet: boolean;
  isValidated: boolean;
}

export interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
  notifyOnOpen: boolean;
  notifyOnClose: boolean;
  notifyOnTakeProfit: boolean;
  notifyOnStopLoss: boolean;
}

export interface BotSettings {
  maxConcurrentPositions: number; // e.g. 1 to 10
  positionSizeUsd: number; // e.g. $0.50, $1, $5, $10, $50, $100
  leverage: number; // 1x to 125x
  allowedDirection: AllowedDirection; // BOTH, LONG_ONLY, SHORT_ONLY
  maxTradeDurationHours: number; // e.g. 0.25 (15m), 1 (1h), 4 (4h), 24 (24h)
  takeProfitPercent: number; // e.g. 2.5%
  stopLossPercent: number; // e.g. 1.2%
  trailingStopPercent: number; // e.g. 0.8%
  useTrailingStop: boolean;
  maxDailyDrawdownPercent: number; // e.g. 5%
  marginType: 'ISOLATED' | 'CROSSED';
  minAiConfidence: number; // e.g. 80%
  autoTradingEnabled: boolean;
  scanIntervalSeconds: number; // e.g. 10s
  aiDynamicTargets: boolean; // AI autonomously calculates dynamic TP & SL
  multiTargetTrailing: boolean; // Moves SL to TP1 when TP1 is hit, then to TP2 when TP2 is hit
  unlimitedHoldTime: boolean; // No forced early time-based exit for winning trades
  enableToastAlerts: boolean; // Toggle on/off popup notifications on screen
  enableCapitalLimit?: boolean; // Protect remaining Binance wallet balance
  maxAllocatedCapitalUsd?: number; // Maximum margin the bot is allowed to use from wallet (e.g. $5 out of $10)
}

export interface AccountBalance {
  totalWalletBalance: number;
  availableBalance: number;
  totalUnrealizedProfit: number;
  totalMarginBalance: number;
  totalInitialMargin: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: TradeDirection;
  entryPrice: number;
  markPrice: number;
  quantity: number;
  amountUsd: number;
  leverage: number;
  liquidationPrice: number;
  unrealizedProfit: number;
  pnlPercentage: number;
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
  openedAt: number;
  maxDurationMs: number;
  aiConfidence: number;
  rationale: string;
  isRealOrder?: boolean;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  amountUsd: number;
  leverage: number;
  pnl: number;
  pnlPercentage: number;
  openedAt: number;
  closedAt: number;
  durationMs: number;
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'TIME_EXPIRED' | 'MANUAL_CLOSE' | 'LIQUIDATION';
  aiConfidence: number;
  wasWinning: boolean;
  tpLevelReached?: number;
  securedProfitUsd?: number;
}

export interface FuturesSymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  minQty: number;
  stepSize: number;
  tickSize: number;
  minNotional: number;
  price: number;
  priceChangePercent: number;
  volume24h: number;
  quoteVolume24h: number;
  high24h: number;
  low24h: number;
  rsi14: number;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  aiScore: number; // 0 to 100
  aiRecommendedSignal: 'BUY_LONG' | 'SELL_SHORT' | 'HOLD';
  orderbookRatio?: number;
}

export interface AILearningState {
  trainingGeneration: number;
  trainingIterations: number;
  accuracyRate: number; // e.g. 88.4%
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
  evolutionHistory: Array<{
    iteration: number;
    winRate: number;
    lossPenalty: number;
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
  netProfit: number;
  netProfitPercent: number;
  maxDrawdown: number;
  profitFactor: number;
  trades: Array<{
    entryTime: number;
    exitTime: number;
    side: TradeDirection;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    reason: string;
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
  type: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_WIN' | 'CLOSE_LOSS' | 'INFO';
  title: string;
  message: string;
  symbol?: string;
  side?: TradeDirection;
  pnl?: number;
  pnlPercentage?: number;
  timestamp: number;
}
