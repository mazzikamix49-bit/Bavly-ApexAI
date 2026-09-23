import React, { useState } from 'react';
import { useTrading } from '../context/TradingContext';
import { CheckCircle2, Clock, History, RotateCcw, Trash2, TrendingDown, TrendingUp, X } from 'lucide-react';

interface ClosedTradesHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ClosedTradesHistoryModal: React.FC<ClosedTradesHistoryModalProps> = ({ isOpen, onClose }) => {
  const { closedTrades, clearTradeHistory, t, language } = useTrading();
  const [confirmReset, setConfirmReset] = useState(false);
  const [justReset, setJustReset] = useState(false);

  if (!isOpen) return null;

  const isArabic = language === 'ar';

  const handleClear = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 5000);
      return;
    }

    clearTradeHistory();
    setConfirmReset(false);
    setJustReset(true);
    setTimeout(() => setJustReset(false), 3000);
  };

  const getExitReasonLabel = (reason: string) => {
    switch (reason) {
      case 'TAKE_PROFIT':
        return t.tpReason;
      case 'STOP_LOSS':
        return t.slReason;
      case 'TRAILING_STOP':
        return t.trailingReason;
      case 'TIME_EXPIRED':
        return t.timeReason;
      case 'MANUAL_CLOSE':
      default:
        return t.manualReason;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#121824] border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>{t.tradeHistoryTitle}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {closedTrades.length}
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Direct Clear All History Button */}
            {closedTrades.length > 0 && (
              <button
                type="button"
                data-testid="clear-all-history-button"
                onClick={handleClear}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 shadow-sm ${
                  confirmReset
                    ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                    : 'bg-rose-500/15 text-rose-300 border-rose-500/30 hover:bg-rose-500/25 hover:text-white'
                }`}
                title={
                  isArabic
                    ? 'مسح كافة الصفقات السابقة وإعادة تعيين الرصيد إلى 1000$'
                    : 'Wipe all closed trades and reset paper balance to $1,000'
                }
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {confirmReset
                    ? isArabic
                      ? '⚠️ تأكيد مسح كافة الصفقات وتصفير الرصيد؟'
                      : '⚠️ Confirm Clear All History?'
                    : isArabic
                    ? 'مسح كافة السجل (Clear All History)'
                    : 'Clear All History'}
                </span>
              </button>
            )}

            {justReset && (
              <span className="text-emerald-400 text-xs font-bold flex items-center gap-1 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{isArabic ? 'تم تصفير السجل بنجاح ✓' : 'History Cleared ✓'}</span>
              </span>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* List Table */}
        <div className="flex-1 overflow-y-auto p-4">
          {closedTrades.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400 mx-auto">
                <RotateCcw className="w-6 h-6 text-slate-500" />
              </div>
              <div className="text-slate-300 text-sm font-bold">
                {isArabic ? 'سجل الصفقات فارغ ونظيف تماماً' : 'Trade History is Clean & Empty'}
              </div>
              <p className="text-slate-500 text-xs max-w-sm mx-auto">
                {isArabic
                  ? 'تم تصفير جميع الصفقات بنجاح. سيبدأ البوت الآن بتسجيل الصفقات الجديدة وفق شروط الكسر السعري عالية الدقة ونظام الأهداف المتعددة (TP1 / TP2 / TP3).'
                  : 'All historical trades have been cleared. The bot will now log fresh trades using high-probability breakout filters and Smart Trailing.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] border-b border-slate-800 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">{t.pair}</th>
                    <th className="py-2.5 px-3">{t.side}</th>
                    <th className="py-2.5 px-3">{t.entryPrice}</th>
                    <th className="py-2.5 px-3">{t.exitPrice}</th>
                    <th className="py-2.5 px-3">{t.pnl}</th>
                    <th className="py-2.5 px-3">{t.duration}</th>
                    <th className="py-2.5 px-3">{t.reason}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {closedTrades.map((trade, idx) => {
                    const isWin = trade.wasWinning;
                    const durationMins = Math.round(trade.durationMs / 60000);

                    return (
                      <tr key={`${trade.id || 'trade'}-${idx}`} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 font-bold text-white">
                          {trade.symbol}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              trade.side === 'LONG'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {trade.side}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          ${trade.entryPrice.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-white">
                          ${trade.exitPrice.toLocaleString()}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-bold ${
                            isWin ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isWin ? '+' : ''}${trade.pnl.toFixed(2)} ({isWin ? '+' : ''}{trade.pnlPercentage.toFixed(2)}%)
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {durationMins < 1 ? '<1m' : `${durationMins}m`}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 font-sans text-[11px]">
                          {getExitReasonLabel(trade.exitReason)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer with Clear All History action */}
        {closedTrades.length > 0 && (
          <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3 text-slate-400 font-sans">
              <span>
                {isArabic ? 'إجمالي الصفقات المسجلة:' : 'Total Logged:'}{' '}
                <strong className="text-white font-mono">{closedTrades.length}</strong>
              </span>
              <span className="text-slate-700">|</span>
              <span>
                {isArabic ? 'صافي الربح الإجمالي:' : 'Net Profit:'}{' '}
                <strong
                  className={`font-mono ${
                    closedTrades.reduce((acc, t) => acc + t.pnl, 0) >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {closedTrades.reduce((acc, t) => acc + t.pnl, 0) >= 0 ? '+' : ''}$
                  {closedTrades.reduce((acc, t) => acc + t.pnl, 0).toFixed(2)}
                </strong>
              </span>
            </div>

            <button
              type="button"
              onClick={handleClear}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 ${
                confirmReset
                  ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                  : 'bg-rose-500/10 text-rose-300 border-rose-500/20 hover:bg-rose-500/20'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>
                {confirmReset
                  ? isArabic
                    ? '⚠️ تأكيد مسح كافة الصفقات؟'
                    : '⚠️ Confirm Clear All History?'
                  : isArabic
                  ? 'مسح كافة السجل (Clear All History)'
                  : 'Clear All History'}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
