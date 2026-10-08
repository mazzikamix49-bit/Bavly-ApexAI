import {
  Candle,
  EvaluatedCandidate,
  FuturesSymbolInfo,
  MarketRegime,
  Position,
  TradeDirection,
} from '../types/trading';
import { IndicatorBundle, IndicatorService } from './indicatorService';

export interface StrategyConfig {
  minRiskRewardRatio: number; // e.g. 1.8
  minRelativeVolume: number; // e.g. 1.15
  maxSpreadPercent: number; // e.g. 0.15%
  minAdxTrendStrength: number; // e.g. 20.0
  rsiLongRange: [number, number]; // e.g. [42, 68]
  rsiShortRange: [number, number]; // e.g. [32, 58]
  atrStopMultiplier: number; // e.g. 1.8
  atrTp1Multiplier: number; // e.g. 2.4
  atrTp2Multiplier: number; // e.g. 4.0
  atrTp3Multiplier: number; // e.g. 6.0
  allowedDirection: 'BOTH' | 'LONG_ONLY' | 'SHORT_ONLY';
  requireVolumeConfirmation: boolean;
  requireMultiTimeframeAlignment: boolean;
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  minRiskRewardRatio: 1.6,
  minRelativeVolume: 1.1,
  maxSpreadPercent: 0.18,
  minAdxTrendStrength: 20.0,
  rsiLongRange: [40, 68],
  rsiShortRange: [32, 60],
  atrStopMultiplier: 1.8,
  atrTp1Multiplier: 2.5,
  atrTp2Multiplier: 4.2,
  atrTp3Multiplier: 6.5,
  allowedDirection: 'BOTH',
  requireVolumeConfirmation: true,
  requireMultiTimeframeAlignment: false,
};

export class StrategyEngine {
  private config: StrategyConfig;

  constructor(customConfig?: Partial<StrategyConfig>) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...customConfig };
  }

  public updateConfig(newConfig: Partial<StrategyConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): StrategyConfig {
    return { ...this.config };
  }

  /**
   * Evaluates a single cryptocurrency perpetual market using quantitative rules
   */
  public evaluateCandidate(
    symbolInfo: FuturesSymbolInfo,
    candles15m: Candle[],
    activePositions: Position[],
    higherTimeframeCandles?: { '1h'?: Candle[]; '4h'?: Candle[] },
    language: 'ar' | 'en' = 'en'
  ): EvaluatedCandidate {
    const symbol = symbolInfo.symbol;
    const isArabic = language === 'ar';

    // 1. Guard against duplicate positions
    if (activePositions.some((p) => p.symbol === symbol)) {
      return {
        symbol,
        qualified: false,
        signal: 'NO_TRADE',
        confidence: 0,
        rationale: isArabic ? 'الصفقة مفتوحة بالفعل في المحفظة.' : 'Position already active in portfolio.',
        rejectionReason: isArabic ? 'صفقة مكررة' : 'DUPLICATE_POSITION',
        regime: symbolInfo.marketRegime || 'RANGING_CONSOLIDATION',
        plannedStopLossPrice: 0,
        plannedTakeProfitPrice: 0,
        tp1Price: 0,
        tp2Price: 0,
        tp3Price: 0,
        atr: 0,
        riskRewardRatio: 0,
        suggestedLeverage: 10,
      };
    }

    // 2. Spread filter
    const currentSpread = symbolInfo.spreadPercent ?? 0.04;
    if (currentSpread > this.config.maxSpreadPercent) {
      return {
        symbol,
        qualified: false,
        signal: 'NO_TRADE',
        confidence: 0,
        rationale: isArabic
          ? `فارق السعر (Spread) مرتفع جداً (${currentSpread.toFixed(3)}% > ${this.config.maxSpreadPercent}%).`
          : `Market spread (${currentSpread.toFixed(3)}%) exceeds threshold (${this.config.maxSpreadPercent}%).`,
        rejectionReason: isArabic ? 'فارق سعر مرتفع' : 'SPREAD_TOO_HIGH',
        regime: 'HIGH_NOISE',
        plannedStopLossPrice: 0,
        plannedTakeProfitPrice: 0,
        tp1Price: 0,
        tp2Price: 0,
        tp3Price: 0,
        atr: 0,
        riskRewardRatio: 0,
        suggestedLeverage: 10,
      };
    }

    // 3. Stale data check
    const currentFreshness = symbolInfo.dataFreshnessMs ?? 0;
    if (symbolInfo.isStale || currentFreshness > 45000) {
      return {
        symbol,
        qualified: false,
        signal: 'NO_TRADE',
        confidence: 0,
        rationale: isArabic ? 'بيانات السوق متأخرة أو غير مستقرة.' : 'Market data is stale or lagging (>45s).',
        rejectionReason: isArabic ? 'بيانات قديمة' : 'STALE_MARKET_DATA',
        regime: 'HIGH_NOISE',
        plannedStopLossPrice: 0,
        plannedTakeProfitPrice: 0,
        tp1Price: 0,
        tp2Price: 0,
        tp3Price: 0,
        atr: 0,
        riskRewardRatio: 0,
        suggestedLeverage: 10,
      };
    }

    // 4. Calculate indicators from 15m candles
    const indicators: IndicatorBundle =
      candles15m && candles15m.length >= 15
        ? IndicatorService.analyzeCandles(candles15m)
        : {
            rsi14: symbolInfo.rsi14,
            ema9: symbolInfo.ema9 || symbolInfo.price,
            ema21: symbolInfo.ema21 || symbolInfo.price,
            ema50: symbolInfo.ema50 || symbolInfo.price,
            ema200: symbolInfo.ema200 || symbolInfo.price,
            atr14: symbolInfo.atr14 || symbolInfo.price * 0.015,
            adx14: symbolInfo.adx14 || 22,
            plusDI: 20,
            minusDI: 20,
            macd: symbolInfo.macd || { macd: 0, signal: 0, histogram: 0 },
            vwap: symbolInfo.vwap || symbolInfo.price,
            relativeVolume: symbolInfo.relativeVolume || 1.1,
            trend: symbolInfo.trend,
            regime: symbolInfo.marketRegime || 'RANGING_CONSOLIDATION',
          };

    const currentPrice = symbolInfo.price;
    const atr = Math.max(indicators.atr14, currentPrice * 0.005);

    // 5. Volume check
    if (this.config.requireVolumeConfirmation && indicators.relativeVolume < this.config.minRelativeVolume) {
      return {
        symbol,
        qualified: false,
        signal: 'NO_TRADE',
        confidence: 0,
        rationale: isArabic
          ? `حجم التداول النسبي (${indicators.relativeVolume}x) أقل من الحد الأدنى (${this.config.minRelativeVolume}x).`
          : `Relative volume (${indicators.relativeVolume}x) is below required ${this.config.minRelativeVolume}x.`,
        rejectionReason: isArabic ? 'سيولة ضعيفة' : 'INSUFFICIENT_VOLUME',
        regime: indicators.regime,
        plannedStopLossPrice: 0,
        plannedTakeProfitPrice: 0,
        tp1Price: 0,
        tp2Price: 0,
        tp3Price: 0,
        atr,
        riskRewardRatio: 0,
        suggestedLeverage: 10,
      };
    }

    // 6. Trend strength check (ADX)
    if (indicators.adx14 < this.config.minAdxTrendStrength && indicators.regime !== 'VOLATILITY_BREAKOUT') {
      return {
        symbol,
        qualified: false,
        signal: 'NO_TRADE',
        confidence: 0,
        rationale: isArabic
          ? `قوة الاتجاه ضعيفة (ADX: ${indicators.adx14} < ${this.config.minAdxTrendStrength}) - حركة عرضية غير ملائمة.`
          : `Weak directional trend (ADX: ${indicators.adx14} < ${this.config.minAdxTrendStrength}) - chop market.`,
        rejectionReason: isArabic ? 'سوق متذبذب بلا اتجاه' : 'CHOP_MARKET_LOW_ADX',
        regime: indicators.regime,
        plannedStopLossPrice: 0,
        plannedTakeProfitPrice: 0,
        tp1Price: 0,
        tp2Price: 0,
        tp3Price: 0,
        atr,
        riskRewardRatio: 0,
        suggestedLeverage: 10,
      };
    }

    // 7. Higher timeframe alignment check (1h / 4h if provided)
    if (this.config.requireMultiTimeframeAlignment && higherTimeframeCandles?.['1h']) {
      const h1Bundle = IndicatorService.analyzeCandles(higherTimeframeCandles['1h']);
      if (h1Bundle.trend === 'BEARISH' && indicators.trend === 'BULLISH') {
        return {
          symbol,
          qualified: false,
          signal: 'NO_TRADE',
          confidence: 0,
          rationale: isArabic
            ? 'تعارض إشارة الـ 15 دقيقة مع الاتجاه الهابط على إطار الساعة (1h Trend Conflict).'
            : '15m signal conflicts with 1h higher timeframe bearish trend.',
          rejectionReason: isArabic ? 'تعارض مع اتجاه الساعة' : 'HTF_TREND_CONFLICT',
          regime: indicators.regime,
          plannedStopLossPrice: 0,
          plannedTakeProfitPrice: 0,
          tp1Price: 0,
          tp2Price: 0,
          tp3Price: 0,
          atr,
          riskRewardRatio: 0,
          suggestedLeverage: 10,
        };
      }
    }

    // 8. Long vs Short Setup Validation
    const isLongEligible =
      (this.config.allowedDirection === 'BOTH' || this.config.allowedDirection === 'LONG_ONLY') &&
      indicators.rsi14 >= this.config.rsiLongRange[0] &&
      indicators.rsi14 <= this.config.rsiLongRange[1] &&
      currentPrice > indicators.ema21 &&
      indicators.ema9 >= indicators.ema21 &&
      symbolInfo.orderbookRatio >= 0.85;

    const isShortEligible =
      (this.config.allowedDirection === 'BOTH' || this.config.allowedDirection === 'SHORT_ONLY') &&
      indicators.rsi14 >= this.config.rsiShortRange[0] &&
      indicators.rsi14 <= this.config.rsiShortRange[1] &&
      currentPrice < indicators.ema21 &&
      indicators.ema9 <= indicators.ema21 &&
      symbolInfo.orderbookRatio <= 1.25;

    let targetSide: TradeDirection | null = null;
    if (isLongEligible && !isShortEligible) {
      targetSide = 'LONG';
    } else if (isShortEligible && !isLongEligible) {
      targetSide = 'SHORT';
    } else {
      return {
        symbol,
        qualified: false,
        signal: 'NO_TRADE',
        confidence: 0,
        rationale: isArabic
          ? `مؤشرات RSI (${indicators.rsi14}) أو ترتيب المتوسطات لا تحقق شروط الدخول الصارمة.`
          : `RSI (${indicators.rsi14}) or moving averages do not fulfill strict entry parameters.`,
        rejectionReason: isArabic ? 'عدم استيفاء شروط الزخم' : 'MOMENTUM_CRITERIA_UNMET',
        regime: indicators.regime,
        plannedStopLossPrice: 0,
        plannedTakeProfitPrice: 0,
        tp1Price: 0,
        tp2Price: 0,
        tp3Price: 0,
        atr,
        riskRewardRatio: 0,
        suggestedLeverage: 10,
      };
    }

    // 9. Calculate Dynamic ATR-Anchored Stop Loss & Multi-Targets
    const precision = symbolInfo.pricePrecision || 2;
    const roundPrice = (p: number) => Number(p.toFixed(precision));

    const slDistance = atr * this.config.atrStopMultiplier;
    const tp1Distance = atr * this.config.atrTp1Multiplier;
    const tp2Distance = atr * this.config.atrTp2Multiplier;
    const tp3Distance = atr * this.config.atrTp3Multiplier;

    const plannedStopLossPrice =
      targetSide === 'LONG' ? roundPrice(currentPrice - slDistance) : roundPrice(currentPrice + slDistance);

    const tp1Price =
      targetSide === 'LONG' ? roundPrice(currentPrice + tp1Distance) : roundPrice(currentPrice - tp1Distance);

    const tp2Price =
      targetSide === 'LONG' ? roundPrice(currentPrice + tp2Distance) : roundPrice(currentPrice - tp2Distance);

    const tp3Price =
      targetSide === 'LONG' ? roundPrice(currentPrice + tp3Distance) : roundPrice(currentPrice - tp3Distance);

    const plannedTakeProfitPrice = tp2Price; // Primary reference TP
    const riskRewardRatio = Number((tp2Distance / slDistance).toFixed(2));

    if (riskRewardRatio < this.config.minRiskRewardRatio) {
      return {
        symbol,
        qualified: false,
        signal: 'NO_TRADE',
        confidence: 0,
        rationale: isArabic
          ? `نسبة العائد للمخاطرة (${riskRewardRatio}:1) أقل من المطلوب (${this.config.minRiskRewardRatio}:1).`
          : `Risk-to-reward ratio (${riskRewardRatio}:1) below minimum threshold (${this.config.minRiskRewardRatio}:1).`,
        rejectionReason: isArabic ? 'عائد إلى مخاطرة غير كافٍ' : 'UNFAVORABLE_RISK_REWARD',
        regime: indicators.regime,
        plannedStopLossPrice,
        plannedTakeProfitPrice,
        tp1Price,
        tp2Price,
        tp3Price,
        atr,
        riskRewardRatio,
        suggestedLeverage: 10,
      };
    }

    // 10. Suggested conservative leverage based on volatility
    const volatilityPct = (atr / currentPrice) * 100;
    let suggestedLeverage = 15;
    if (volatilityPct > 3.0) suggestedLeverage = 8;
    else if (volatilityPct > 1.8) suggestedLeverage = 12;
    else suggestedLeverage = 20;

    // Algorithmic heuristic confidence score (65 to 88)
    const confidence = Math.min(
      88,
      Math.max(
        68,
        Math.round(
          65 +
            Math.min(10, (indicators.relativeVolume - 1) * 8) +
            Math.min(8, (indicators.adx14 - 20) * 0.4) +
            (symbolInfo.orderbookRatio > 1.2 ? 5 : 0)
        )
      )
    );

    const rationale = isArabic
      ? `فرصة كمية متكاملة لـ ${symbol} (${targetSide}): توافق EMA 9/21 مع RSI (${indicators.rsi14}) وسيولة نسبية ${indicators.relativeVolume}x. وقف خسارة ATR عند $${plannedStopLossPrice} ونسبة عائد ${riskRewardRatio}:1.`
      : `Qualified ${targetSide} setup on ${symbol}: EMA 9/21 alignment, RSI at ${indicators.rsi14}, RVOL ${indicators.relativeVolume}x, ATR-anchored stop at $${plannedStopLossPrice} with ${riskRewardRatio}:1 R:R.`;

    return {
      symbol,
      qualified: true,
      signal: targetSide === 'LONG' ? 'BUY_LONG' : 'SELL_SHORT',
      confidence,
      rationale,
      regime: indicators.regime,
      plannedStopLossPrice,
      plannedTakeProfitPrice,
      tp1Price,
      tp2Price,
      tp3Price,
      atr,
      riskRewardRatio,
      suggestedLeverage,
    };
  }
}

export const strategyEngine = new StrategyEngine();
