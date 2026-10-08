import React, { useState } from 'react';
import { useTrading } from '../context/TradingContext';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';

export const ActivePositionsTable: React.FC = () => {
  const { positions, closePosition, closeAllPositions, t, language, runReconciliation } = useTrading();
  const [closingId, setClosingId] = useState<string | null>(null);
  const [isClosingAll, setIsClosingAll] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
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

  const handleManualReconcile = async () => {
    setIsReconciling(true);
    await runReconciliation();
    setIsReconciling(false);
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

        <div className="flex items-center gap-2">
          {positions.length > 0 && (
            <>
              <button
                onClick={handleManualReconcile}
                disabled={isReconciling}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1.5"
                title={t.reconcileNow}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>{t.reconcileNow}</span>
              </button>

              <button
                onClick={handleCloseAll}
                disabled={isClosingAll}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 transition flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                <span>{isClosingAll ? t.closing : isArabic ? 'إغلاق الكل فوراً' : 'Close All'}</span>
              </button>
            </>
          )}
        </div>
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
            {isArabic
              ? 'محرك المخاطر والماسح الآلي يراقبان السوق لدخول الصفقات المطابقة فقط'
              : 'Quantitative Risk Engine & Scanner monitoring for strictly qualified setups'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-[11px] font-mono border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">{t.pair}</th>
                <th className="py-3 px-3">{t.side}</th>
                <th className="py-3 px-3">Margin / Size</th>
                <th className="py-3 px-3">{t.entryPrice}</th>
                <th className="py-3 px-3">{t.markPrice}</th>
                <th className="py-3 px-3">{t.liqPrice}</th>
                <th className="py-3 px-3">Stop Loss Status</th>
                <th className="py-3 px-3">Take Profit Status</th>
                <th className="py-3 px-3">{t.pnl}</th>
                <th className="py-3 px-3">Fees & Sync</th>
                <th className="py-3 px-4 text-right">{t.action}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {positions.map((pos, idx) => {
                const isLong = pos.side === 'LONG';
                const currentPrice = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;
                const isProfit = pos.unrealizedProfit >= 0;

                return (
                  <tr key={`${pos.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                    {/* Pair */}
                    <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                      <span>{pos.symbol}</span>
                      {pos.isRealOrder ? (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          REAL
                        </span>
                      ) : (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          PAPER
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
                        {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        <span>{isLong ? t.long : t.short}</span>
                      </span>
                    </td>

                    {/* Margin & Notional Exposure */}
                    <td className="py-3.5 px-3 text-slate-300">
                      <div className="font-semibold text-white">
                        ${pos.amountUsd.toFixed(2)} <span className="text-[10px] text-amber-400 font-mono font-normal">({pos.leverage}x)</span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        ${(pos.quantity * currentPrice).toFixed(1)} notional ({pos.quantity} units)
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

                    {/* Stop Loss Status: Planned vs Confirmed */}
                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-1 font-semibold text-rose-400">
                        <span>${pos.stopLossPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="text-[10px] flex items-center gap-1 mt-0.5">
                        {pos.stopLossOrderStatus === 'ACTIVE' ? (
                          <span className="text-emerald-400 flex items-center gap-0.5">
                            <ShieldCheck className="w-2.5 h-2.5" /> Exchange Active
                          </span>
                        ) : (
                          <span className="text-amber-400 flex items-center gap-0.5">
                            <ShieldAlert className="w-2.5 h-2.5" /> Client Monitored
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Take Profit Status */}
                    <td className="py-3.5 px-3">
                      <div className="font-semibold text-emerald-400">
                        ${pos.takeProfitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {pos.tpLevelReached && pos.tpLevelReached > 0 ? (
                          <span className="text-cyan-400">TP{pos.tpLevelReached} Hit (Trailed)</span>
                        ) : (
                          <span>Target 2: ${pos.tp2Price || pos.takeProfitPrice}</span>
                        )}
                      </div>
                    </td>

                    {/* Unrealized Live PnL */}
                    <td className="py-3.5 px-3">
                      <div className={`font-bold flex items-center gap-1 text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        <span>{isProfit ? '+' : ''}${pos.unrealizedProfit.toFixed(2)}</span>
                      </div>
                      <div className={`text-[10px] font-semibold ${isProfit ? 'text-emerald-500/90' : 'text-rose-500/90'}`}>
                        {isProfit ? '+' : ''}{pos.pnlPercentage.toFixed(2)}%
                      </div>
                    </td>

                    {/* Fees & Reconciliation */}
                    <td className="py-3.5 px-3 text-slate-400">
                      <div className="text-[11px]">
                        Fee: ~${(pos.estimatedCommissionUsd || 0.02).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" /> {formatAge(pos.openedAt)}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => handleClose(pos.id)}
                        disabled={closingId === pos.id}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 transition"
                      >
                        {closingId === pos.id ? t.closing : t.closePosition}
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
