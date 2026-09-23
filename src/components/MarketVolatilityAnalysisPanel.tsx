import React, { useMemo, useState } from 'react';
import { useTrading } from '../context/TradingContext';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  CheckCircle2,
  Filter,
  Flame,
  Gauge,
  HelpCircle,
  Info,
  Layers,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import { FuturesSymbolInfo } from '../types/trading';

export const MarketVolatilityAnalysisPanel: React.FC = () => {
  const { marketPairs, language, t } = useTrading();
  const isArabic = language === 'ar';
  const [filterMode, setFilterMode] = useState<'ALL' | 'QUALIFIED' | 'REJECTED'>('ALL');

  // Compute market volatility metrics
  const analysis = useMemo(() => {
    if (!marketPairs || marketPairs.length === 0) {
      return {
        avgSpread: 4.2,
        marketState: 'OPTIMAL',
        medianVolume: 45000000,
        totalPairs: 0,
        qualifiedCount: 0,
        chopRejectedCount: 0,
        exhaustedRejectedCount: 0,
        volumeRejectedCount: 0,
        pairsWithAnalysis: [],
      };
    }

    let totalSpread = 0;
    let validPairsCount = 0;

    const pairsWithAnalysis = marketPairs.map((pair) => {
      const spread =
        pair.high24h > 0 && pair.low24h > 0 && pair.price > 0
          ? ((pair.high24h - pair.low24h) / pair.price) * 100
          : 3.5;

      totalSpread += spread;
      validPairsCount++;

      // Check criteria
      const hasVolume = pair.quoteVolume24h >= 15000000;
      const isHealthyVolatility = spread >= 2.2 && spread <= 16.0;
      const isTooChopy = spread < 2.2;
      const isTooVolatile = spread > 16.0;

      const isLongBreakout =
        pair.aiRecommendedSignal === 'BUY_LONG' &&
        pair.rsi14 >= 52 &&
        pair.rsi14 <= 68 &&
        pair.priceChangePercent >= 0.2;

      const isShortBreakdown =
        pair.aiRecommendedSignal === 'SELL_SHORT' &&
        pair.rsi14 >= 32 &&
        pair.rsi14 <= 48 &&
        pair.priceChangePercent <= -0.2;

      const isExhausted = pair.rsi14 > 70 || pair.rsi14 < 30;
      const meetsAiScore = pair.aiScore >= 85;

      const isQualified = hasVolume && isHealthyVolatility && meetsAiScore && (isLongBreakout || isShortBreakdown);

      let rejectionReason: string | null = null;
      if (!isQualified) {
        if (!hasVolume) {
          rejectionReason = isArabic ? 'سيولة غير كافية (< $15M)' : 'Low 24h Volume (< $15M)';
        } else if (isTooChopy) {
          rejectionReason = isArabic ? 'تذبذب ميت وضعيف (< 2.2% Chop)' : 'Flat Low-Volatility Chop (< 2.2%)';
        } else if (isTooVolatile) {
          rejectionReason = isArabic ? 'تذبذب فوضوي حاد (> 16%)' : 'Erratic High Volatility (> 16%)';
        } else if (isExhausted) {
          rejectionReason = isArabic ? 'تشبع سعري استنزافي (RSI > 70 أو < 30)' : 'Exhausted Top/Bottom (RSI >70 or <30)';
        } else if (!meetsAiScore) {
          rejectionReason = isArabic ? 'ثقة الذكاء الاصطناعي أقل من 85%' : 'AI Score below 85% confidence';
        } else {
          rejectionReason = isArabic ? 'غياب الزخم الكافي للكسر السعري' : 'Lacks decisive breakout velocity';
        }
      }

      // Compute Volatility-Adjusted Breakout Score
      const volumeMultiplier = Math.min(1.5, Math.log10(Math.max(1000, pair.quoteVolume24h)) / 7.5);
      const volatilityFactor = Math.min(1.2, spread / 4.0);
      const rsiDistance = Math.abs(pair.rsi14 - 50) / 18;
      const breakoutScore = Number(
        (pair.aiScore * 0.5 + volumeMultiplier * 20 + volatilityFactor * 15 + rsiDistance * 15).toFixed(1)
      );

      return {
        ...pair,
        spread: Number(spread.toFixed(2)),
        isQualified,
        rejectionReason,
        breakoutScore,
        isLongBreakout,
        isShortBreakdown,
        isTooChopy,
      };
    });

    const avgSpread = validPairsCount > 0 ? Number((totalSpread / validPairsCount).toFixed(2)) : 3.8;

    let marketState: 'LOW_CHOP' | 'OPTIMAL' | 'ELEVATED' = 'OPTIMAL';
    if (avgSpread < 2.4) marketState = 'LOW_CHOP';
    else if (avgSpread > 6.5) marketState = 'ELEVATED';

    const qualifiedCount = pairsWithAnalysis.filter((p) => p.isQualified).length;
    const chopRejectedCount = pairsWithAnalysis.filter((p) => p.isTooChopy).length;
    const exhaustedRejectedCount = pairsWithAnalysis.filter((p) => p.rsi14 > 70 || p.rsi14 < 30).length;
    const volumeRejectedCount = pairsWithAnalysis.filter((p) => p.quoteVolume24h < 15000000).length;

    // Sort: qualified first by breakoutScore, then remaining
    pairsWithAnalysis.sort((a, b) => {
      if (a.isQualified && !b.isQualified) return -1;
      if (!a.isQualified && b.isQualified) return 1;
      return b.breakoutScore - a.breakoutScore;
    });

    return {
      avgSpread,
      marketState,
      totalPairs: pairsWithAnalysis.length,
      qualifiedCount,
      chopRejectedCount,
      exhaustedRejectedCount,
      volumeRejectedCount,
      pairsWithAnalysis,
    };
  }, [marketPairs, isArabic]);

  const filteredPairs = useMemo(() => {
    if (filterMode === 'QUALIFIED') {
      return analysis.pairsWithAnalysis.filter((p) => p.isQualified);
    }
    if (filterMode === 'REJECTED') {
      return analysis.pairsWithAnalysis.filter((p) => !p.isQualified);
    }
    return analysis.pairsWithAnalysis;
  }, [analysis.pairsWithAnalysis, filterMode]);

  return (
    <div className="bg-[#121824] border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
            <Gauge className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white">
                {isArabic ? 'تحليل تذبذب السوق وتبرير اختيار الصفقات' : 'Market Volatility Analysis & Breakout Justification'}
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                VOLATILITY-ADJUSTED
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isArabic
                ? 'كيف يبرر الذكاء الاصطناعي استبعاد الصفقات الضعيفة واختيار الاختراقات السعرية عالية الاحتمالية'
                : 'Real-time telemetry showing how the AI filters out low-confidence chop to enter only prime breakouts'}
            </p>
          </div>
        </div>

        {/* Global Market State Badge */}
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 self-start sm:self-auto">
          <Activity className="w-4 h-4 text-cyan-400" />
          <div className="text-xs">
            <span className="text-slate-400">{isArabic ? 'متوسط تذبذب السوق: ' : 'Avg 24h Spread: '}</span>
            <span className="font-mono font-bold text-white">{analysis.avgSpread}%</span>{' '}
            <span
              className={`font-semibold text-[11px] ${
                analysis.marketState === 'OPTIMAL'
                  ? 'text-emerald-400'
                  : analysis.marketState === 'LOW_CHOP'
                  ? 'text-amber-400'
                  : 'text-indigo-400'
              }`}
            >
              ({analysis.marketState === 'OPTIMAL'
                ? isArabic ? 'نطاق كسر مثالي' : 'Prime Breakout Zone'
                : analysis.marketState === 'LOW_CHOP'
                ? isArabic ? 'تذبذب عرضي خامل' : 'Low Volatility Chop'
                : isArabic ? 'زخم متسارع' : 'High Momentum'})
            </span>
          </div>
        </div>
      </div>

      {/* 4 Quantitative Breakdown KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Prime Breakouts Approved */}
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold">
            <span>{isArabic ? 'فرص كسر مؤكدة' : 'Breakouts Qualified'}</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {analysis.qualifiedCount} <span className="text-xs font-sans text-slate-400 font-normal">/ {analysis.totalPairs}</span>
          </div>
          <div className="text-[10px] text-emerald-300">
            {isArabic ? 'مستوفية لمعايير RSI والسيولة والتذبذب' : 'Passed RSI, Volume & Volatility thresholds'}
          </div>
        </div>

        {/* Card 2: Low-Volatility Chop Filtered Out */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between text-xs text-amber-400 font-semibold">
            <span>{isArabic ? 'مستبعدة (تذبذب ميت Chop)' : 'Chop Filtered Out'}</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400">
            {analysis.chopRejectedCount} <span className="text-xs font-sans text-slate-400 font-normal">{isArabic ? 'عملة' : 'pairs'}</span>
          </div>
          <div className="text-[10px] text-slate-400">
            {isArabic ? 'أقل من 2.2% نطاق (منع الدخول العشوائي)' : 'Spread < 2.2% (Eliminated false whipsaws)'}
          </div>
        </div>

        {/* Card 3: Exhausted Top/Bottom Rejections */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between text-xs text-rose-400 font-semibold">
            <span>{isArabic ? 'مستبعدة (تشبع استنزافي)' : 'Exhausted Rejections'}</span>
            <XCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-400">
            {analysis.exhaustedRejectedCount} <span className="text-xs font-sans text-slate-400 font-normal">{isArabic ? 'عملة' : 'pairs'}</span>
          </div>
          <div className="text-[10px] text-slate-400">
            {isArabic ? 'مؤشر RSI > 70 أو < 30 (خطر الانعكاس)' : 'RSI > 70 or < 30 (Mean-reversion danger)'}
          </div>
        </div>

        {/* Card 4: Insufficient Volume Rejections */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between text-xs text-indigo-400 font-semibold">
            <span>{isArabic ? 'مستبعدة (سيولة ضعيفة)' : 'Thin Liquidity'}</span>
            <Filter className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-indigo-300">
            {analysis.volumeRejectedCount} <span className="text-xs font-sans text-slate-400 font-normal">{isArabic ? 'عملة' : 'pairs'}</span>
          </div>
          <div className="text-[10px] text-slate-400">
            {isArabic ? 'حجم تداول < $15M (حماية من الانزلاق)' : '24h Quote Vol < $15M (Protected from slippage)'}
          </div>
        </div>
      </div>

      {/* AI Decision Justification Banner */}
      <div className="bg-gradient-to-r from-cyan-950/40 via-slate-900 to-indigo-950/40 border border-cyan-500/30 rounded-xl p-4 text-xs space-y-2">
        <div className="flex items-center gap-2 font-bold text-white">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span>{isArabic ? 'تبرير الذكاء الاصطناعي: لماذا تفوق صفقات الكسر على التداول الترددي؟' : 'AI Thesis: Why Volatility-Adjusted Breakouts Beat High-Frequency Scalping'}</span>
        </div>
        <p className="text-slate-300 leading-relaxed font-sans">
          {isArabic
            ? 'التداول الترددي في مناطق التذبذب الميت (Chop) يؤدي إلى استنزاف الرصيد في رسوم التداول وإشارات كاذبة متكررة. لذلك يقوم نموذج التعلّم الذاتي بتطبيق فلتر مزدوج للتذبذب والسيولة: لا يتم فتح أي صفقة إلا عندما يخرج السعر من نطاق التماسك بكسر حقيقي مدعوم بارتفاع RSI بين 52 و 68 للاتجاه الصاعد، وسيولة مؤسسية نشطة تفوق 15 مليون دولار.'
            : 'Frequent scalping inside dead low-volatility chop produces false signals and fee drag. The autonomous self-learning module enforces a dynamic dual volatility-volume threshold: positions are executed strictly when price expands with genuine breakout velocity backed by RSI sweet spot (52-68 Long / 32-48 Short) and $15M+ institutional liquidity.'}
        </p>
      </div>

      {/* Interactive Table of Evaluated Pairs */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-xs font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" />
            <span>{isArabic ? 'فحص العملات اللحظي وتقييم الكسر السعري' : 'Live Pair Breakout & Volatility Telemetry'}</span>
            <span className="text-slate-500 text-[11px] font-normal">({filteredPairs.length} {isArabic ? 'عملة معروضة' : 'pairs'})</span>
          </div>

          {/* Table Filter Buttons */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setFilterMode('ALL')}
              className={`px-2.5 py-1 rounded transition text-[11px] font-medium ${
                filterMode === 'ALL' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isArabic ? 'الكل' : 'All'}
            </button>
            <button
              onClick={() => setFilterMode('QUALIFIED')}
              className={`px-2.5 py-1 rounded transition text-[11px] font-medium flex items-center gap-1 ${
                filterMode === 'QUALIFIED' ? 'bg-emerald-500 text-black font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>{isArabic ? 'المقبولة فقط' : 'Qualified'}</span>
            </button>
            <button
              onClick={() => setFilterMode('REJECTED')}
              className={`px-2.5 py-1 rounded transition text-[11px] font-medium flex items-center gap-1 ${
                filterMode === 'REJECTED' ? 'bg-rose-500/20 text-rose-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <XCircle className="w-3 h-3" />
              <span>{isArabic ? 'المستبعدة' : 'Rejected'}</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/90 text-slate-400 text-[10px] uppercase border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">{t.pair}</th>
                <th className="py-2.5 px-3">{isArabic ? 'نطاق التذبذب 24h' : '24h Volatility Spread'}</th>
                <th className="py-2.5 px-3">{isArabic ? 'السيولة 24h' : '24h Quote Vol'}</th>
                <th className="py-2.5 px-3">{isArabic ? 'مؤشر RSI' : 'RSI (14)'}</th>
                <th className="py-2.5 px-3">{isArabic ? 'نقاط الكسر AI' : 'Breakout Score'}</th>
                <th className="py-2.5 px-3 text-right">{isArabic ? 'قرار البوت وتبريره' : 'AI Bot Action & Justification'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {filteredPairs.slice(0, 15).map((p, idx) => {
                const volMillions = (p.quoteVolume24h / 1000000).toFixed(1);
                return (
                  <tr key={`${p.symbol}-${idx}`} className="hover:bg-slate-800/30 transition">
                    {/* Pair & Price */}
                    <td className="py-2.5 px-3 font-bold text-white flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      <span>{p.symbol}</span>
                      <span className="text-[10px] text-slate-400 font-normal">${p.price.toLocaleString()}</span>
                    </td>

                    {/* Volatility Spread */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-bold ${
                            p.spread >= 2.2 && p.spread <= 16.0 ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {p.spread}%
                        </span>
                        <span className="text-[9px] text-slate-500">
                          {p.spread < 2.2 ? (isArabic ? '(خامل Chop)' : '(Chop)') : (isArabic ? '(مثالي)' : '(Optimal)')}
                        </span>
                      </div>
                    </td>

                    {/* 24h Volume */}
                    <td className="py-2.5 px-3">
                      <span className={p.quoteVolume24h >= 15000000 ? 'text-white' : 'text-rose-400'}>
                        ${volMillions}M
                      </span>
                    </td>

                    {/* RSI */}
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          (p.rsi14 >= 52 && p.rsi14 <= 68) || (p.rsi14 >= 32 && p.rsi14 <= 48)
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {p.rsi14}
                      </span>
                    </td>

                    {/* Breakout Score */}
                    <td className="py-2.5 px-3">
                      <span className="font-bold text-cyan-300">{p.breakoutScore}</span>
                      <span className="text-[9px] text-slate-500 ml-1">pts</span>
                    </td>

                    {/* Bot Action & Justification */}
                    <td className="py-2.5 px-3 text-right">
                      {p.isQualified ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold text-[10px]">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{isArabic ? 'معتمد للكسر السعري ✅' : 'Breakout Approved ✅'}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/60 text-[10px]">
                          <XCircle className="w-3 h-3 text-rose-400/80" />
                          <span className="truncate max-w-[180px]" title={p.rejectionReason || ''}>
                            {p.rejectionReason}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
