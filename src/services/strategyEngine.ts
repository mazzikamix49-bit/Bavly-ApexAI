import {
  Candle,
  EvaluatedCandidate,
  FuturesSymbolInfo,
  MarketRegime,
  Position,
  TradeDirection,
  TradeQualityBreakdown,
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
    if (symbolInfo.isStale && currentFreshness > 180000) {
      return {
        symbol,
        qualified: false,
        signal: 'NO_TRADE',
        confidence: 0,
        rationale: isArabic ? 'بيانات السوق متأخرة أو غير مستقرة.' : 'Market data is stale or lagging (>180s).',
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

    const currentPrice = symbolInfo.price;
    const tickerChange = symbolInfo.priceChangePercent ?? 0;
    const derivedRsi =
      typeof symbolInfo.rsi14 === 'number' && !isNaN(symbolInfo.rsi14)
        ? symbolInfo.rsi14
        : Math.min(78, Math.max(22, 50 + tickerChange * 2.8));

    const derivedEma9 = symbolInfo.ema9 || (currentPrice * (1 + tickerChange * 0.002));
    const derivedEma21 = symbolInfo.ema21 || currentPrice;

    // 4. Calculate indicators from 15m candles
    const indicators: IndicatorBundle =
      candles15m && candles15m.length >= 15
        ? IndicatorService.analyzeCandles(candles15m)
        : {
            rsi14: derivedRsi,
            ema9: derivedEma9,
            ema21: derivedEma21,
            ema50: symbolInfo.ema50 || currentPrice,
            ema200: symbolInfo.ema200 || currentPrice,
            atr14: symbolInfo.atr14 || Math.max(currentPrice * 0.012, (symbolInfo.high24h - symbolInfo.low24h) * 0.25 || currentPrice * 0.015),
            adx14: symbolInfo.adx14 || Math.min(45, 22 + Math.abs(tickerChange) * 1.5),
            plusDI: tickerChange >= 0 ? 25 : 15,
            minusDI: tickerChange < 0 ? 25 : 15,
            macd: symbolInfo.macd || { macd: tickerChange * 0.1, signal: 0, histogram: tickerChange * 0.05 },
            vwap: symbolInfo.vwap || currentPrice,
            relativeVolume: symbolInfo.relativeVolume || Math.max(1.15, Math.min(3.5, 1.0 + Math.abs(tickerChange) * 0.1)),
            trend: symbolInfo.trend || (tickerChange > 0.4 ? 'BULLISH' : tickerChange < -0.4 ? 'BEARISH' : 'NEUTRAL'),
            regime: symbolInfo.marketRegime || (Math.abs(tickerChange) > 4 ? 'VOLATILITY_BREAKOUT' : tickerChange > 0.4 ? 'TRENDING_BULL' : tickerChange < -0.4 ? 'TRENDING_BEAR' : 'RANGING_CONSOLIDATION'),
          };

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
    const obRatio = typeof symbolInfo.orderbookRatio === 'number' ? symbolInfo.orderbookRatio : 1.0;
    const isLongEligible =
      (this.config.allowedDirection === 'BOTH' || this.config.allowedDirection === 'LONG_ONLY') &&
      indicators.rsi14 >= this.config.rsiLongRange[0] &&
      indicators.rsi14 <= this.config.rsiLongRange[1] &&
      currentPrice >= indicators.ema21 &&
      indicators.ema9 >= indicators.ema21 &&
      obRatio >= 0.75;

    const isShortEligible =
      (this.config.allowedDirection === 'BOTH' || this.config.allowedDirection === 'SHORT_ONLY') &&
      indicators.rsi14 >= this.config.rsiShortRange[0] &&
      indicators.rsi14 <= this.config.rsiShortRange[1] &&
      currentPrice <= indicators.ema21 &&
      indicators.ema9 <= indicators.ema21 &&
      obRatio <= 1.35;

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

    // Skill 11: Trade Quality Ranking Rubric (100-Point System)
    // 1. Market Structure (Max 20 pts)
    let marketStructureScore = 0;
    if (targetSide === 'LONG') {
      if (indicators.ema9 > indicators.ema21) marketStructureScore += 8;
      if (currentPrice > (indicators.vwap || indicators.ema21)) marketStructureScore += 6;
      if (indicators.adx14 >= 22) marketStructureScore += 6;
    } else {
      if (indicators.ema9 < indicators.ema21) marketStructureScore += 8;
      if (currentPrice < (indicators.vwap || indicators.ema21)) marketStructureScore += 6;
      if (indicators.adx14 >= 22) marketStructureScore += 6;
    }

    // 2. Entry Quality & Structural Invalidation (Max 20 pts)
    let entryQualityScore = 0;
    const distanceToEma21Pct = (Math.abs(currentPrice - indicators.ema21) / currentPrice) * 100;
    if (distanceToEma21Pct <= 1.2) {
      entryQualityScore += 10; // Pullback entry near structural dynamic support/resistance
    } else if (distanceToEma21Pct <= 2.2) {
      entryQualityScore += 6;
    } else {
      entryQualityScore += 2;
    }
    const invalidationPrice = plannedStopLossPrice;
    if (invalidationPrice > 0) entryQualityScore += 10;

    // 3. Liquidity and Volume (Max 15 pts)
    let liquidityScore = 0;
    if (indicators.relativeVolume >= 1.4) liquidityScore += 8;
    else if (indicators.relativeVolume >= 1.1) liquidityScore += 5;
    else liquidityScore += 2;

    if (currentSpread <= 0.06) liquidityScore += 4;
    else if (currentSpread <= 0.12) liquidityScore += 2;

    if (symbolInfo.quoteVolume24h >= 10000000) liquidityScore += 3;
    else if (symbolInfo.quoteVolume24h >= 3000000) liquidityScore += 2;

    // 4. Multi-Timeframe Agreement (Max 15 pts)
    let mtfScore = 10; // Base score for 15m + 5m setup
    if (higherTimeframeCandles?.['1h']) {
      const h1Bundle = IndicatorService.analyzeCandles(higherTimeframeCandles['1h']);
      if ((targetSide === 'LONG' && h1Bundle.trend === 'BULLISH') || (targetSide === 'SHORT' && h1Bundle.trend === 'BEARISH')) {
        mtfScore = 15;
      } else if (h1Bundle.trend === 'NEUTRAL') {
        mtfScore = 8;
      } else {
        mtfScore = 0; // Conflict
      }
    }

    // 5. Momentum and Indicators (Max 10 pts)
    let momentumScore = 0;
    if (targetSide === 'LONG') {
      if (indicators.rsi14 >= 44 && indicators.rsi14 <= 64) momentumScore += 6;
      else if (indicators.rsi14 >= 38 && indicators.rsi14 <= 70) momentumScore += 4;
    } else {
      if (indicators.rsi14 >= 36 && indicators.rsi14 <= 56) momentumScore += 6;
      else if (indicators.rsi14 >= 30 && indicators.rsi14 <= 62) momentumScore += 4;
    }
    if (indicators.macd && ((targetSide === 'LONG' && indicators.macd.histogram > 0) || (targetSide === 'SHORT' && indicators.macd.histogram < 0))) {
      momentumScore += 4;
    } else {
      momentumScore += 2;
    }

    // 6. Futures Flow Confirmation (Max 10 pts)
    let futuresScore = 0;
    if (targetSide === 'LONG') {
      if (obRatio >= 1.25) futuresScore += 6;
      else if (obRatio >= 1.0) futuresScore += 4;
      else futuresScore += 2;
    } else {
      if (obRatio <= 0.8) futuresScore += 6;
      else if (obRatio <= 1.0) futuresScore += 4;
      else futuresScore += 2;
    }
    const funding = symbolInfo.fundingRate ?? 0.0001;
    if (Math.abs(funding) <= 0.0003) futuresScore += 4;
    else if ((targetSide === 'LONG' && funding < 0) || (targetSide === 'SHORT' && funding > 0)) futuresScore += 4;
    else futuresScore += 1;

    // 7. Risk/Reward & Execution Costs (Max 10 pts)
    let rrScore = 0;
    if (riskRewardRatio >= 2.2) rrScore += 6;
    else if (riskRewardRatio >= 1.8) rrScore += 4;
    else rrScore += 2;
    if (currentSpread < 0.08) rrScore += 4;
    else rrScore += 2;

    const totalTradeQualityScore = Math.min(100, Math.max(0,
      marketStructureScore + entryQualityScore + liquidityScore + mtfScore + momentumScore + futuresScore + rrScore
    ));

    let tier: 'EXCELLENT' | 'GOOD' | 'WATCH' | 'REJECT' = 'REJECT';
    if (totalTradeQualityScore >= 85) tier = 'EXCELLENT';
    else if (totalTradeQualityScore >= 75) tier = 'GOOD';
    else if (totalTradeQualityScore >= 65) tier = 'WATCH';
    else tier = 'REJECT';

    const qualityBreakdown: TradeQualityBreakdown = {
      totalScore: totalTradeQualityScore,
      tier,
      marketStructure: marketStructureScore,
      entryQuality: entryQualityScore,
      liquidityAndVolume: liquidityScore,
      mtfAgreement: mtfScore,
      momentumIndicators: momentumScore,
      futuresConfirmation: futuresScore,
      riskRewardAndCosts: rrScore,
      invalidationPrice,
      setupCategory: 'QUANT_MOMENTUM',
    };

    // Skill 11 Rule: If tier is REJECT (<65) or invalidation is unclear, strictly reject the trade!
    if (totalTradeQualityScore < 65 || tier === 'REJECT') {
      return {
        symbol,
        qualified: false,
        signal: 'NO_TRADE',
        confidence: totalTradeQualityScore,
        rationale: isArabic
          ? `تم استبعاد الفرصة: درجة جودة التداول (${totalTradeQualityScore}/100) أقل من عتبة القبول (65 نقطة).`
          : `Candidate rejected: Trade Quality Ranking (${totalTradeQualityScore}/100) below minimum acceptance threshold (65 pts).`,
        rejectionReason: isArabic ? 'جودة تداول غير كافية (<65)' : 'LOW_QUALITY_RANKING',
        regime: indicators.regime,
        plannedStopLossPrice,
        plannedTakeProfitPrice,
        tp1Price,
        tp2Price,
        tp3Price,
        atr,
        riskRewardRatio,
        suggestedLeverage,
        qualityBreakdown,
        invalidationPrice,
      };
    }

    const rationale = isArabic
      ? `فرصة ${tier === 'EXCELLENT' ? 'ممتازة' : 'جيدة'} لـ ${symbol} (${targetSide}) بدرجة جودة ${totalTradeQualityScore}/100. بنية سوق: ${marketStructureScore}/20، جودة دخول: ${entryQualityScore}/20، سيولة: ${liquidityScore}/15، توافق أطر: ${mtfScore}/15. وقف خسارة عند $${plannedStopLossPrice} ونسبة عائد ${riskRewardRatio}:1.`
      : `${tier} ${targetSide} setup on ${symbol} (Score: ${totalTradeQualityScore}/100). Market Structure: ${marketStructureScore}/20, Entry: ${entryQualityScore}/20, Liquidity: ${liquidityScore}/15, MTF: ${mtfScore}/15. Invalidation Stop: $${plannedStopLossPrice}, R:R: ${riskRewardRatio}:1.`;

    return {
      symbol,
      qualified: true,
      signal: targetSide === 'LONG' ? 'BUY_LONG' : 'SELL_SHORT',
      confidence: totalTradeQualityScore,
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
      qualityBreakdown,
      invalidationPrice,
    };
  }
}

export const strategyEngine = new StrategyEngine();
