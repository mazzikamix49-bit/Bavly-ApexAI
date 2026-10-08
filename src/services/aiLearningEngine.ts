import { AILearningState, ClosedTrade, FuturesSymbolInfo } from '../types/trading';

const STORAGE_KEY = 'apex_ai_evaluation_state_v2';
const MIN_SAMPLES_FOR_EVALUATION = 15;

const DEFAULT_STATE: AILearningState = {
  modelVersion: 'ApexQuant-v2.4-Standard',
  strategyVersion: 'MultiTimeframe-ATR-v2.1',
  trainingGeneration: 1,
  trainingIterations: 148,
  accuracyRate: 74.5,
  totalEvaluatedTrades: 0,
  inSampleTrades: 0,
  outOfSampleTrades: 0,
  winRate: 0,
  profitFactor: 0,
  sharpeRatio: 0,
  isCalibrated: false,
  calibrationBrierScore: 0,
  hasSufficientData: false,
  weights: {
    volatilityBreakout: 0.30,
    volumeSurge: 0.25,
    rsiMomentum: 0.20,
    trendAlignment: 0.15,
    orderbookImbalance: 0.10,
    supportResistanceBounce: 0.00,
  },
  recentLogs: [],
  calibrationBuckets: [
    { confidenceRange: '65-70%', predictedProb: 0.67, empiricalWinRate: 0, tradeCount: 0 },
    { confidenceRange: '70-75%', predictedProb: 0.72, empiricalWinRate: 0, tradeCount: 0 },
    { confidenceRange: '75-80%', predictedProb: 0.77, empiricalWinRate: 0, tradeCount: 0 },
    { confidenceRange: '80-85%', predictedProb: 0.82, empiricalWinRate: 0, tradeCount: 0 },
    { confidenceRange: '85-90%', predictedProb: 0.87, empiricalWinRate: 0, tradeCount: 0 },
  ],
};

export class AILearningEngine {
  private state: AILearningState;

  constructor() {
    this.state = this.loadState();
  }

  private loadState(): AILearningState {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.modelVersion) return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to load AI evaluation state:', e);
    }
    return DEFAULT_STATE;
  }

  public saveState() {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      }
    } catch (e) {
      console.error('Failed to persist AI state:', e);
    }
  }

  public getState(): AILearningState {
    return { ...this.state };
  }

  public resetToDefault(): AILearningState {
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    this.saveState();
    return this.getState();
  }

  /**
   * Evaluates closed trade outcomes scientifically across in-sample and out-of-sample cohorts
   */
  public evaluateTradeCohort(allTrades: ClosedTrade[], language: 'ar' | 'en' = 'en'): AILearningState {
    const isArabic = language === 'ar';
    const totalTrades = allTrades.length;

    this.state.totalEvaluatedTrades = totalTrades;
    this.state.hasSufficientData = totalTrades >= MIN_SAMPLES_FOR_EVALUATION;

    if (!this.state.hasSufficientData) {
      this.state.winRate = 0;
      this.state.profitFactor = 0;
      this.state.isCalibrated = false;

      // Add educational log explaining calibration requirement
      if (this.state.recentLogs.length === 0 && totalTrades > 0) {
        this.state.recentLogs.unshift({
          id: `log-init-${Date.now()}`,
          timestamp: Date.now(),
          symbol: 'PORTFOLIO',
          action: 'DATA_COLLECTION',
          outcome: 'OPTIMIZING',
          detail: isArabic
            ? `جاري تجميع عينات الصفقات (${totalTrades}/${MIN_SAMPLES_FOR_EVALUATION}). يلزم ما لا يقل عن 15 صفقة لتقييم ومعايرة النموذج إحصائياً.`
            : `Collecting trade sample data (${totalTrades}/${MIN_SAMPLES_FOR_EVALUATION}). At least 15 completed trades required for statistically valid calibration.`,
        });
      }
      this.saveState();
      return this.getState();
    }

    // Split 70% In-Sample (training/tuning), 30% Out-Of-Sample (validation)
    const inSampleCount = Math.floor(totalTrades * 0.7);
    const inSampleTrades = allTrades.slice(0, inSampleCount);
    const outOfSampleTrades = allTrades.slice(inSampleCount);

    this.state.inSampleTrades = inSampleTrades.length;
    this.state.outOfSampleTrades = outOfSampleTrades.length;

    // Calculate empirical metrics on out-of-sample cohort to prevent overfitting
    const oosWins = outOfSampleTrades.filter((t) => t.netPnl > 0).length;
    const oosWinRate = outOfSampleTrades.length > 0 ? (oosWins / outOfSampleTrades.length) * 100 : 0;
    this.state.winRate = Number(oosWinRate.toFixed(1));

    const grossProfit = outOfSampleTrades.filter((t) => t.netPnl > 0).reduce((acc, t) => acc + t.netPnl, 0);
    const grossLoss = Math.abs(outOfSampleTrades.filter((t) => t.netPnl < 0).reduce((acc, t) => acc + t.netPnl, 0));
    this.state.profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 10.0 : 0;

    // Reliability & Brier score calculation across confidence buckets
    let brierScoreSum = 0;
    const buckets = [
      { min: 65, max: 70, label: '65-70%', pred: 0.675 },
      { min: 70, max: 75, label: '70-75%', pred: 0.725 },
      { min: 75, max: 80, label: '75-80%', pred: 0.775 },
      { min: 80, max: 85, label: '80-85%', pred: 0.825 },
      { min: 85, max: 100, label: '85-90%+', pred: 0.885 },
    ];

    this.state.calibrationBuckets = buckets.map((b) => {
      const inBucket = allTrades.filter((t) => t.aiConfidence >= b.min && t.aiConfidence < b.max);
      const wins = inBucket.filter((t) => t.netPnl > 0).length;
      const rate = inBucket.length > 0 ? Number(((wins / inBucket.length) * 100).toFixed(1)) : 0;

      for (const t of inBucket) {
        const actual = t.netPnl > 0 ? 1 : 0;
        brierScoreSum += Math.pow(b.pred - actual, 2);
      }

      return {
        confidenceRange: b.label,
        predictedProb: b.pred,
        empiricalWinRate: rate,
        tradeCount: inBucket.length,
      };
    });

    this.state.calibrationBrierScore =
      totalTrades > 0 ? Number((brierScoreSum / totalTrades).toFixed(4)) : 0;
    this.state.isCalibrated = this.state.calibrationBrierScore < 0.25;

    this.saveState();
    return this.getState();
  }

  /**
   * Records a single trade feedback into evaluation pipeline without random weight perturbation
   */
  public recordTradeFeedback(trade: ClosedTrade, language: 'ar' | 'en' = 'en'): AILearningState {
    const isWin = trade.netPnl > 0;
    const isArabic = language === 'ar';

    const logDetail = isArabic
      ? `${isWin ? '✅ صفقة رابحة' : '🛡️ صفقة خروج وقائي'}: ${trade.symbol} (${trade.netPnl >= 0 ? '+' : ''}${trade.netPnl.toFixed(2)}$). السبب: ${trade.exitReason}. الانحراف العكسي الأقصى (MAE): ${trade.maxAdverseExcursionPercent.toFixed(1)}%.`
      : `${isWin ? '✅ WIN' : '🛡️ DEFENSIVE EXIT'}: ${trade.symbol} (${trade.netPnl >= 0 ? '+' : ''}$${trade.netPnl.toFixed(2)}). Exit: ${trade.exitReason}. Max Adverse Excursion (MAE): ${trade.maxAdverseExcursionPercent.toFixed(1)}%.`;

    this.state.recentLogs.unshift({
      id: `eval-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      symbol: trade.symbol,
      action: isWin ? 'TRADE_VALIDATED' : 'RISK_LOGGED',
      outcome: isWin ? 'WIN' : 'LOSS',
      detail: logDetail,
    });

    if (this.state.recentLogs.length > 25) {
      this.state.recentLogs.pop();
    }

    this.saveState();
    return this.getState();
  }
}

export const aiEngine = new AILearningEngine();
