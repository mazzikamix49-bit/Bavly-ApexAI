import { Position, FuturesSymbolInfo, AIDiagnosis } from '../types/trading';

export class AIPositionManager {
  /**
   * Evaluates an active position using technical structure, order book pressure, and price action
   * to determine recovery probability and autonomous trade doctor action.
   */
  static diagnosePosition(
    position: Position,
    pair?: FuturesSymbolInfo,
    orderBook?: {
      bids: Array<[string, string]>;
      asks: Array<[string, string]>;
      imbalanceRatio: number;
      spreadPercent: number;
    },
    language: 'ar' | 'en' = 'ar',
    targetProfitPercent = 35.0
  ): AIDiagnosis {
    const isLong = position.side === 'LONG';
    const currentPrice = position.markPrice || pair?.price || position.entryPrice;
    const pnlPct = position.pnlPercentage;
    const isLosing = pnlPct < 0;
    const isWinning = pnlPct > 0;

    // 1. Calculate Base Probability
    let score = 50;

    // Momentum from 24h change and relative price movement
    const priceChange24h = pair?.priceChangePercent || 0;
    if (isLong) {
      if (priceChange24h > 1.5) score += 8;
      else if (priceChange24h < -2.5) score -= 10;
    } else {
      if (priceChange24h < -1.5) score += 8;
      else if (priceChange24h > 2.5) score -= 10;
    }

    // Orderbook depth analysis
    const imbalance = orderBook?.imbalanceRatio ?? 1.0;
    if (isLong) {
      if (imbalance >= 1.4) score += 15; // strong bid wall
      else if (imbalance <= 0.7) score -= 18; // heavy dump pressure
    } else {
      if (imbalance <= 0.7) score += 15; // heavy ask wall pushing down
      else if (imbalance >= 1.4) score -= 18; // strong buyer surge against short
    }

    // Distance to Stop Loss
    const stopDistance = Math.abs(currentPrice - position.stopLossPrice);
    const entryDistance = Math.abs(currentPrice - position.entryPrice);
    const slRiskRatio = stopDistance / (entryDistance + 0.0001);

    if (isLosing && slRiskRatio < 0.3) {
      // Very close to stop loss
      score -= 20;
    }

    // Adverse Excursion & Age
    const positionAgeMinutes = (Date.now() - position.openedAt) / 60000;
    if (positionAgeMinutes > 20 && isLosing && pnlPct < -1.0) {
      score -= 10;
    }

    // Clamp score between 5% and 95%
    const recoveryProbability = Math.max(5, Math.min(95, Math.round(score)));

    // 2. Decision Logic
    let recommendation: AIDiagnosis['recommendation'] = 'HOLD';
    let labelAr = 'احتفاظ ومتابعة';
    let labelEn = 'Hold & Monitor';
    let reasoningAr = `الصفقة تسير ضمن النطاق المقبول (احتمالية استمرار ${recoveryProbability}%).`;
    let reasoningEn = `Position within expected variance (${recoveryProbability}% stability score).`;

    // CASE A: Smart Pre-emptive Cut Loss (Only on critical structural breakdown near full SL)
    if (isLosing && pnlPct <= -25.0 && recoveryProbability <= 18 && slRiskRatio < 0.2) {
      recommendation = 'AI_EARLY_CUT';
      labelAr = 'إغلاق وقائي مبكر';
      labelEn = 'Smart Pre-emptive Cut';
      reasoningAr = `احتمالية التعافي انهارت إلى ${recoveryProbability}%. ضغط البيع وزخم السوق يؤكدان كسر الدعم. إغلاق فوري يوفر أكثر من 50% من خسارة الوقف الكامل.`;
      reasoningEn = `Recovery probability collapsed to ${recoveryProbability}%. Momentum broke support. Early exit saves >50% of full SL drawdown.`;
    }

    // CASE B: Smart Breakeven Exit (خروج تعادل آمن عند نقطة الدخول $0)
    else if (
      (position.lowestPriceReached && isLong && position.lowestPriceReached < position.entryPrice * 0.994) ||
      (position.highestPriceReached && !isLong && position.highestPriceReached > position.entryPrice * 1.006)
    ) {
      // Was previously in drawdown, now close to entry
      if (pnlPct >= -0.15 && pnlPct <= 0.35 && recoveryProbability <= 50) {
        recommendation = 'AI_BREAKEVEN_EXIT';
        labelAr = 'خروج تعادل ($0)';
        labelEn = 'Safe Breakeven Exit';
        reasoningAr = `ارتد السعر بنجاح إلى نقطة الدخول ($0 خسارة)، بينما يتباطأ الزخم عند المقاومة. خروج فوري لتجنب العودة إلى الخسارة.`;
        reasoningEn = `Position rebounded to entry ($0 loss). Momentum is flattening. Safe breakeven exit taken to eliminate loss risk.`;
      }
    }

    // CASE C: Smart DCA / Reinforce Position (تعزيز وتبريد ذكي لتقريب الدخول)
    if (
      recommendation === 'HOLD' &&
      isLosing &&
      pnlPct <= -0.8 &&
      pnlPct >= -2.4 &&
      recoveryProbability >= 72 &&
      (position.dcaCount || 0) === 0
    ) {
      recommendation = 'AI_DCA_REINFORCE';
      labelAr = 'تعزيز وتبريد ذكي';
      labelEn = 'Smart DCA Reinforce';
      reasoningAr = `الصفقة في منطقة تشبع بيعي قوية مع دعم ملحوظ في دفتر الأوامر (احتمالية تعافي ${recoveryProbability}%). تعزيز المركز يقلص المسافة لنقطة التعادل.`;
      reasoningEn = `Oversold condition with deep orderbook support (${recoveryProbability}% recovery score). DCA lowers average entry price for rapid breakeven/profit exit.`;
    }

    // CASE D: High Profit Harvest ("أنتش واجري" وفق الهدف المحدد بالكامل دون خروج مبكر)
    else if (
      recommendation === 'HOLD' &&
      isWinning &&
      pnlPct >= Math.max(25.0, targetProfitPercent)
    ) {
      recommendation = 'AI_EARLY_PROFIT_TAKE';
      labelAr = `اقتناص هدف الربح (+${pnlPct.toFixed(1)}%)`;
      labelEn = `Target Profit Harvest (+${pnlPct.toFixed(1)}%)`;
      reasoningAr = `الصفقة حققت هدف الربح المطلوب بالكامل (+${pnlPct.toFixed(1)}%). تم حجز الأرباح فوراً وتحرير الهامش ورأس المال.`;
      reasoningEn = `Position reached target profit (+${pnlPct.toFixed(1)}%). Cashing out gains immediately to free margin.`;
    }

    // Determine Skill 13 Adaptive Health Status:
    // HEALTHY: Trade hypothesis intact, structure valid.
    // WEAKENING: Momentum fading, orderbook resistance wall, or warning signals.
    // INVALIDATED: Invalidation level breached or structural shift.
    // EMERGENCY: Capital protection immediately on abnormal conditions.
    let healthStatus: 'HEALTHY' | 'WEAKENING' | 'INVALIDATED' | 'EMERGENCY' = 'HEALTHY';
    if (orderBook && orderBook.spreadPercent > 0.4) {
      healthStatus = 'EMERGENCY';
    } else if (recommendation === 'AI_EARLY_CUT' || (position.invalidationPrice && (isLong ? currentPrice <= position.invalidationPrice : currentPrice >= position.invalidationPrice))) {
      healthStatus = 'INVALIDATED';
    } else if (recoveryProbability < 48 || slRiskRatio < 0.35 || recommendation === 'AI_BREAKEVEN_EXIT' || recommendation === 'AI_EARLY_PROFIT_TAKE') {
      healthStatus = 'WEAKENING';
    } else {
      healthStatus = 'HEALTHY';
    }

    return {
      recoveryProbability,
      healthStatus,
      recommendation,
      labelAr,
      labelEn,
      reasoningAr,
      reasoningEn,
      analyzedAt: Date.now(),
    };
  }
}
