import React, { useState } from 'react';
import { useTrading } from '../context/TradingContext';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { Position } from '../types/trading';

export const ActivePositionsTable: React.FC = () => {
  const { positions, closePosition, closeAllPositions, t, language } = useTrading();
  const [closingId, setClosingId] = useState<string | null>(null);
  const [isClosingAll, setIsClosingAll] = useState(false);
  const isArabic = language === 'ar';

  const handleClose = async (posId: string) => {
    setClosingId(posId);
    await closePosition(posId, 'MANUAL_CLOSE');
    setClosingId(null);
  };

  const handleCloseAll = async () => {
    if (confirm(t.confirmClose)) {
      setIsClosingAll(true);
      await closeAllPositions();
      setIsClosingAll(false);
    }
  };

  const formatAge = (openedAt: number) => {
    const elapsedMinutes = Math.floor((Date.now() - openedAt) / 60000);
    if (elapsedMinutes < 1) return '< 1m';
    if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
    const hours = Math.floor(elapsedMinutes / 60);
    const mins = elapsedMinutes % 60;
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="bg-[#121824] border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden">
      {/* Table Header / Action Bar */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <span>{t.activePositionsTitle}</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {positions.length}
              </span>
            </h2>
          </div>
        </div>

        {positions.length > 0 && (
          <button
            onClick={handleCloseAll}
            disabled={isClosingAll}
            className="self-start sm:self-auto px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 transition flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" />
            <span>{isClosingAll ? t.closing : language === 'ar' ? 'إغلاق كافة الصفقات فورا' : 'Close All Positions'}</span>
          </button>
        )}
      </div>

      {/* Content */}
      {positions.length === 0 ? (
        <div className="p-10 sm:p-14 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/50 border border-slate-700/50 mx-auto flex items-center justify-center text-slate-500 mb-3">
            <Zap className="w-7 h-7 text-amber-400/60 animate-pulse" />
          </div>
          <p className="text-sm font-medium text-slate-300 max-w-md mx-auto">
            {t.noActivePositions}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {language === 'ar'
              ? 'البوت يفحص كافة أزواج منصة بينانس ويدخل فور توافر أفضل شروط الربح'
              : 'Autonomous bot scanning all Binance pairs 24/7 for optimal risk-reward entries'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-[11px] font-mono border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">{t.pair}</th>
                <th className="py-3 px-3">{t.side}</th>
                <th className="py-3 px-3">{t.leverage}</th>
                <th className="py-3 px-3">{t.size}</th>
                <th className="py-3 px-3">{t.entryPrice}</th>
                <th className="py-3 px-3">{t.markPrice}</th>
                <th className="py-3 px-3">{t.liqPrice}</th>
                {/* Dynamically Parsed Live PnL (Entry vs Current) */}
                <th className="py-3 px-3">
                  <div className="flex flex-col">
                    <span>{t.pnl}</span>
                    <span className="text-[9px] text-slate-500 normal-case font-sans">
                      {isArabic ? '(الربح العائم اللحظي)' : '(Mark-to-Market)'}
                    </span>
                  </div>
                </th>
                {/* Explicit Realized Profit/Loss per Individual Trade Row */}
                <th className="py-3 px-3">
                  <div className="flex flex-col">
                    <span className="text-emerald-400 font-bold">{t.realizedPnl}</span>
                    <span className="text-[9px] text-emerald-500/80 normal-case font-sans">
                      {isArabic ? '(المحقق بالوقف الذكي)' : '(Smart Trailed / Locked)'}
                    </span>
                  </div>
                </th>
                <th className="py-3 px-3">{t.duration}</th>
                <th className="py-3 px-3">{t.aiConfidence}</th>
                <th className="py-3 px-4 text-right">{t.action}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {positions.map((pos, idx) => {
                const isLong = pos.side === 'LONG';
                const currentPrice = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;

                // 1. Explicit calculation of profit percentage and currency amount based on entry price vs current market price
                const priceSpread = isLong
                  ? currentPrice - pos.entryPrice
                  : pos.entryPrice - currentPrice;
                const priceChangePercent = pos.entryPrice > 0 ? (priceSpread / pos.entryPrice) * 100 : 0;
                const calculatedPnlPercentage = Number((priceChangePercent * pos.leverage).toFixed(2));
                const calculatedPnlCurrencyUsd = Number((pos.amountUsd * (calculatedPnlPercentage / 100)).toFixed(2));
                const isProfit = calculatedPnlCurrencyUsd >= 0;

                // 2. Explicit calculation and display of 'Realized Profit/Loss' per individual trade row
                let realizedPnlCurrencyUsd = 0;
                let realizedPnlPercentage = 0;
                let realizedStage: 'PENDING' | 'BREAKEVEN' | 'TP1_LOCKED' | 'TP2_LOCKED' = 'PENDING';

                const tpLevel = pos.tpLevelReached || 0;
                if (tpLevel === 1) {
                  // Level 1: Stop-loss automatically moved to entry (Breakeven) -> Risk is eliminated, 0% capital loss guaranteed
                  realizedStage = 'BREAKEVEN';
                  realizedPnlCurrencyUsd = 0.00;
                  realizedPnlPercentage = 0.00;
                } else if (tpLevel === 2) {
                  // Level 2: Stop-loss trailed to TP1 price level -> Guaranteed TP1 profit locked in
                  realizedStage = 'TP1_LOCKED';
                  if (pos.tp1Price && pos.entryPrice) {
                    const tp1Spread = isLong ? pos.tp1Price - pos.entryPrice : pos.entryPrice - pos.tp1Price;
                    realizedPnlPercentage = Number(((tp1Spread / pos.entryPrice) * pos.leverage * 100).toFixed(2));
                    realizedPnlCurrencyUsd = Number((pos.amountUsd * (realizedPnlPercentage / 100)).toFixed(2));
                  } else {
                    realizedPnlCurrencyUsd = Number((pos.securedProfitUsd || (pos.amountUsd * 0.015 * pos.leverage)).toFixed(2));
                    realizedPnlPercentage = Number(((realizedPnlCurrencyUsd / pos.amountUsd) * 100).toFixed(2));
                  }
                } else if (tpLevel >= 3) {
                  // Level 3: Stop-loss trailed to TP2 price level -> Guaranteed TP2 profit locked in
                  realizedStage = 'TP2_LOCKED';
                  if (pos.tp2Price && pos.entryPrice) {
                    const tp2Spread = isLong ? pos.tp2Price - pos.entryPrice : pos.entryPrice - pos.tp2Price;
                    realizedPnlPercentage = Number(((tp2Spread / pos.entryPrice) * pos.leverage * 100).toFixed(2));
                    realizedPnlCurrencyUsd = Number((pos.amountUsd * (realizedPnlPercentage / 100)).toFixed(2));
                  } else {
                    realizedPnlCurrencyUsd = Number((pos.securedProfitUsd || (pos.amountUsd * 0.035 * pos.leverage)).toFixed(2));
                    realizedPnlPercentage = Number(((realizedPnlCurrencyUsd / pos.amountUsd) * 100).toFixed(2));
                  }
                }

                return (
                  <tr
                    key={`${pos.id || 'pos'}-${idx}`}
                    className="hover:bg-slate-800/30 transition-colors"
                  >
                    {/* Pair */}
                    <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                      <span>{pos.symbol}</span>
                      {pos.isRealOrder && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          REAL
                        </span>
                      )}
                    </td>

                    {/* Side */}
                    <td className="py-3.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                          isLong
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {isLong ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        <span>{isLong ? t.long : t.short}</span>
                      </span>
                    </td>

                    {/* Leverage */}
                    <td className="py-3.5 px-3 text-slate-300">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-semibold border border-amber-400/20">
                        {pos.leverage}x
                      </span>
                    </td>

                    {/* Size */}
                    <td className="py-3.5 px-3 text-slate-300">
                      <div className="font-semibold text-white">
                        ${pos.amountUsd.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {pos.quantity} {pos.symbol.replace('USDT', '')}
                      </div>
                    </td>

                    {/* Entry Price */}
                    <td className="py-3.5 px-3 text-slate-300">
                      ${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>

                    {/* Mark Price */}
                    <td className="py-3.5 px-3 font-semibold text-white">
                      ${pos.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>

                    {/* Liquidation Price */}
                    <td className="py-3.5 px-3 text-amber-500/80">
                      ${pos.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>

                    {/* 1. Unrealized Live Profit/Loss (Parsed Entry vs Current Market Price) */}
                    <td className="py-3.5 px-3">
                      <div
                        className={`font-bold flex items-center gap-1 text-sm ${
                          isProfit ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        <span>
                          {isProfit ? '+' : ''}${calculatedPnlCurrencyUsd.toFixed(2)}
                        </span>
                        <span className="text-[10px] font-semibold">
                          ({isProfit ? '+' : ''}{calculatedPnlPercentage.toFixed(2)}%)
                        </span>
                      </div>

                      {/* Explicit mathematical parse details */}
                      <div className="text-[10px] text-slate-500 mt-0.5 font-sans leading-tight">
                        Δ {isLong ? '+' : '-'}${Math.abs(priceSpread).toFixed(2)} ({priceChangePercent.toFixed(2)}% × {pos.leverage}x)
                      </div>

                      {/* Multi-Target Progression Badges */}
                      {pos.tp1Price && (
                        <div className="mt-1 flex items-center gap-1 text-[9px] font-mono">
                          <span
                            className={`px-1 py-0.2 rounded font-bold ${
                              tpLevel >= 1
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            TP1: ${pos.tp1Price}
                          </span>
                          <span
                            className={`px-1 py-0.2 rounded font-bold ${
                              tpLevel >= 2
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            TP2: ${pos.tp2Price}
                          </span>
                          <span className="px-1 py-0.2 rounded bg-slate-800 text-amber-300">
                            TP3: ${pos.tp3Price || pos.takeProfitPrice}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* 2. Explicit Realized Profit/Loss Column (Locked Profit via Smart Trailing) */}
                    <td className="py-3.5 px-3">
                      {realizedStage === 'PENDING' && (
                        <div>
                          <div className="text-slate-400 font-bold text-xs">$0.00</div>
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-sans mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-600"></span>
                            <span>{isArabic ? 'قيد الوصول لـ TP1' : 'Pending TP1'}</span>
                          </span>
                        </div>
                      )}

                      {realizedStage === 'BREAKEVEN' && (
                        <div>
                          <div className="text-cyan-400 font-bold text-xs">$0.00 (0.0%)</div>
                          <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300 font-sans mt-0.5 px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30">
                            <ShieldCheck className="w-3 h-3 text-cyan-400" />
                            <span>{isArabic ? 'مؤمن لسعر الدخول' : 'Breakeven Secured'}</span>
                          </span>
                        </div>
                      )}

                      {realizedStage === 'TP1_LOCKED' && (
                        <div>
                          <div className="text-emerald-400 font-bold text-xs">
                            +${realizedPnlCurrencyUsd.toFixed(2)} (+{realizedPnlPercentage.toFixed(1)}%)
                          </div>
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 font-sans mt-0.5 px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40">
                            <Flame className="w-3 h-3 text-emerald-400" />
                            <span>{isArabic ? 'أرباح TP1 محجوزة' : 'TP1 Locked'}</span>
                          </span>
                        </div>
                      )}

                      {realizedStage === 'TP2_LOCKED' && (
                        <div>
                          <div className="text-amber-300 font-bold text-xs">
                            +${realizedPnlCurrencyUsd.toFixed(2)} (+{realizedPnlPercentage.toFixed(1)}%)
                          </div>
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-300 font-sans mt-0.5 px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-500/40">
                            <Trophy className="w-3 h-3 text-amber-400" />
                            <span>{isArabic ? 'أرباح TP2 محجوزة' : 'TP2 Locked'}</span>
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Age / Duration */}
                    <td className="py-3.5 px-3 text-slate-400">
                      <span className="flex items-center gap-1 text-[11px]">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {formatAge(pos.openedAt)}
                      </span>
                    </td>

                    {/* AI Score */}
                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-1 text-cyan-300 font-semibold text-[11px]">
                        <Sparkles className="w-3 h-3 text-cyan-400" />
                        <span>{pos.aiConfidence}%</span>
                      </div>
                      <div className="text-[9px] text-slate-500 truncate max-w-[120px]" title={pos.rationale}>
                        {pos.rationale}
                      </div>
                    </td>

                    {/* Action: 1-Click Close */}
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => handleClose(pos.id)}
                        disabled={closingId === pos.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 hover:border-rose-400 transition flex items-center gap-1 ml-auto"
                        title={t.closePosition}
                      >
                        <X className="w-3 h-3" />
                        <span>{closingId === pos.id ? t.closing : language === 'ar' ? 'إغلاق' : 'Close'}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
