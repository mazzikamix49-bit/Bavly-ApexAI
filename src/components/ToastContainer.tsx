import React from 'react';
import { ToastAlert } from '../types/trading';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';

interface ToastContainerProps {
  toasts: ToastAlert[];
  onDismiss: (id: string) => void;
  onClearAll?: () => void;
  isArabic: boolean;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss, onClearAll, isArabic }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className={`fixed bottom-4 z-50 flex flex-col gap-2 max-w-xs sm:max-w-sm w-full pointer-events-none p-3 ${
        isArabic ? 'left-0 sm:left-4 items-start' : 'right-0 sm:right-4 items-end'
      }`}
    >
      {toasts.length > 1 && onClearAll && (
        <button
          onClick={onClearAll}
          className="pointer-events-auto self-end px-2.5 py-1 rounded-md bg-slate-900/90 hover:bg-slate-800 text-[11px] font-medium text-slate-400 hover:text-slate-200 border border-slate-700/60 shadow-lg backdrop-blur-sm transition flex items-center gap-1 mb-1"
        >
          <X className="w-3 h-3" />
          <span>{isArabic ? 'إغلاق الكل' : 'Clear All'}</span>
        </button>
      )}

      {toasts.map((toast, idx) => {
        const isOpenLong = toast.type === 'OPEN_LONG';
        const isOpenShort = toast.type === 'OPEN_SHORT';
        const isWin = toast.type === 'CLOSE_WIN';
        const isLoss = toast.type === 'CLOSE_LOSS';

        let borderClass = 'border-slate-800';
        let bgClass = 'bg-[#121824]/95';
        let iconBg = 'bg-slate-800 text-slate-300';
        let IconComponent = AlertCircle;

        if (isOpenLong) {
          borderClass = 'border-emerald-500/40 shadow-emerald-500/10';
          bgClass = 'bg-[#0d1c17]/95';
          iconBg = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
          IconComponent = TrendingUp;
        } else if (isOpenShort) {
          borderClass = 'border-rose-500/40 shadow-rose-500/10';
          bgClass = 'bg-[#1c0f13]/95';
          iconBg = 'bg-rose-500/20 text-rose-400 border border-rose-500/30';
          IconComponent = TrendingDown;
        } else if (isWin) {
          borderClass = 'border-amber-400/50 shadow-amber-400/15';
          bgClass = 'bg-[#1a170c]/95';
          iconBg = 'bg-amber-400/20 text-amber-300 border border-amber-400/30';
          IconComponent = ArrowUpRight;
        } else if (isLoss) {
          borderClass = 'border-rose-600/40 shadow-rose-600/10';
          bgClass = 'bg-[#180d10]/95';
          iconBg = 'bg-rose-500/20 text-rose-400 border border-rose-500/30';
          IconComponent = ArrowDownRight;
        }

        return (
          <div
            key={`${toast.id || 'toast'}-${idx}`}
            className={`pointer-events-auto w-full border rounded-xl p-3 shadow-xl backdrop-blur-md transition-all duration-300 flex items-start gap-2.5 relative overflow-hidden ${bgClass} ${borderClass}`}
          >
            {/* Pulsating Indicator */}
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
              <IconComponent className="w-4 h-4" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pr-2">
              <div className="flex items-center justify-between gap-1">
                <h4 className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5 truncate">
                  <span>{toast.title}</span>
                  {toast.symbol && (
                    <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-amber-400 border border-slate-700">
                      {toast.symbol}
                    </span>
                  )}
                </h4>
              </div>

              <p className="text-[11px] text-slate-300 mt-0.5 leading-snug font-sans">
                {toast.message}
              </p>

              {/* Extra PnL Pill for closed trades */}
              {toast.pnl !== undefined && (
                <div className="mt-1.5 flex items-center gap-2 text-xs font-mono font-bold">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] ${
                      toast.pnl >= 0
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {toast.pnl >= 0 ? '+' : ''}${toast.pnl.toFixed(2)}
                    {toast.pnlPercentage !== undefined && (
                      <span className="text-[9px] ml-1">
                        ({toast.pnl >= 0 ? '+' : ''}{toast.pnlPercentage.toFixed(2)}%)
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* Dismiss Button */}
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/10 transition shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            {/* Subtle bottom accent line */}
            <div
              className={`absolute bottom-0 left-0 right-0 h-0.5 ${
                isOpenLong
                  ? 'bg-emerald-500'
                  : isOpenShort
                  ? 'bg-rose-500'
                  : isWin
                  ? 'bg-amber-400'
                  : 'bg-rose-500'
              }`}
            />
          </div>
        );
      })}
    </div>
  );
};
