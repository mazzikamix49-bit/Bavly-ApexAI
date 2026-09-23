import React from 'react';
import { useTrading } from '../context/TradingContext';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  DollarSign,
  Percent,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';

export const MetricCards: React.FC = () => {
  const {
    t,
    totalTradesCount,
    winningTradesCount,
    losingTradesCount,
    winRatePercent,
    totalProfitUsd,
    totalLossUsd,
    netProfitUsd,
    positions,
    settings,
    balance,
  } = useTrading();

  const totalEquity = Math.max(1, balance.totalMarginBalance);
  const lockedMargin = positions.reduce((acc, p) => acc + p.amountUsd, 0);
  const lockedExposurePercent = Math.min(100, Math.max(0, Number(((lockedMargin / totalEquity) * 100).toFixed(1))));

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5 sm:gap-3">
      {/* 1. Total Trades */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">{t.totalTrades}</span>
          <BarChart3 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        </div>
        <div className="text-xl font-bold font-mono text-white">
          {totalTradesCount}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {positions.length} {t.activePositionsCount}
        </div>
      </div>

      {/* 2. Winning Trades */}
      <div className="bg-[#121824] border border-emerald-950/60 rounded-xl p-3 shadow-md hover:border-emerald-800/60 transition">
        <div className="flex items-center justify-between text-emerald-400 text-xs mb-1">
          <span className="truncate">{t.winningTrades}</span>
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        </div>
        <div className="text-xl font-bold font-mono text-emerald-400">
          {winningTradesCount}
        </div>
        <div className="text-[10px] text-emerald-500/80 mt-0.5 flex items-center gap-0.5">
          <ArrowUpRight className="w-2.5 h-2.5" />
          <span>{winRatePercent}%</span>
        </div>
      </div>

      {/* 3. Losing Trades */}
      <div className="bg-[#121824] border border-rose-950/60 rounded-xl p-3 shadow-md hover:border-rose-800/60 transition">
        <div className="flex items-center justify-between text-rose-400 text-xs mb-1">
          <span className="truncate">{t.losingTrades}</span>
          <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
        </div>
        <div className="text-xl font-bold font-mono text-rose-400">
          {losingTradesCount}
        </div>
        <div className="text-[10px] text-rose-500/80 mt-0.5 flex items-center gap-0.5">
          <ArrowDownRight className="w-2.5 h-2.5" />
          <span>{totalTradesCount > 0 ? (100 - winRatePercent).toFixed(1) : 0}%</span>
        </div>
      </div>

      {/* 4. Win Rate % */}
      <div className="bg-[#121824] border border-amber-950/60 rounded-xl p-3 shadow-md hover:border-amber-800/60 transition">
        <div className="flex items-center justify-between text-amber-400 text-xs mb-1">
          <span className="truncate">{t.winRate}</span>
          <Percent className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        </div>
        <div className="text-xl font-bold font-mono text-amber-400">
          {winRatePercent}%
        </div>
        <div className="w-full bg-slate-800 rounded-full h-1.5 mt-1.5 overflow-hidden">
          <div
            className="bg-amber-400 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(5, winRatePercent))}%` }}
          ></div>
        </div>
      </div>

      {/* 5. Total Profit */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">{t.totalProfit}</span>
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        </div>
        <div className="text-xl font-bold font-mono text-emerald-400">
          +${totalProfitUsd.toFixed(2)}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          Gross Profit
        </div>
      </div>

      {/* 6. Total Loss */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">{t.totalLoss}</span>
          <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
        </div>
        <div className="text-xl font-bold font-mono text-rose-400">
          -${totalLossUsd.toFixed(2)}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          Gross Loss
        </div>
      </div>

      {/* 7. Net PnL */}
      <div className="bg-[#121824] border border-cyan-950/60 rounded-xl p-3 shadow-md hover:border-cyan-800/60 transition">
        <div className="flex items-center justify-between text-cyan-400 text-xs mb-1">
          <span className="truncate">{t.netProfit}</span>
          <DollarSign className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        </div>
        <div
          className={`text-xl font-bold font-mono ${
            netProfitUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {netProfitUsd >= 0 ? '+' : ''}${netProfitUsd.toFixed(2)}
        </div>
        <div className="text-[10px] text-cyan-500/80 mt-0.5">
          Net Closed Return
        </div>
      </div>

      {/* 8. Active Positions & Risk Exposure */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">{t.activePositionsCount}</span>
          <span
            className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${
              lockedExposurePercent > 75
                ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                : lockedExposurePercent > 50
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
            }`}
          >
            {lockedExposurePercent}% Risk
          </span>
        </div>
        <div className="text-xl font-bold font-mono text-white flex items-baseline gap-1">
          <span>{positions.length}</span>
          <span className="text-slate-500 text-xs">/ {settings.maxConcurrentPositions}</span>
        </div>
        <div className="w-full bg-slate-800 rounded-full h-1.5 mt-1.5 overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${
              lockedExposurePercent > 75
                ? 'bg-rose-500'
                : lockedExposurePercent > 50
                ? 'bg-amber-500'
                : 'bg-emerald-500'
            }`}
            style={{
              width: `${Math.max(4, lockedExposurePercent)}%`,
            }}
          ></div>
        </div>
      </div>
    </div>
  );
};
