import React from 'react';
import { useTrading } from '../context/TradingContext';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  DollarSign,
  Percent,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';

export const MetricCards: React.FC = () => {
  const {
    t,
    performanceMetrics,
    positions,
    balance,
    portfolioExposure,
    settings,
  } = useTrading();

  const isRiskSafe = portfolioExposure.totalRiskToStopUsd <= portfolioExposure.availableRiskBudgetUsd * 1.5;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 sm:gap-3">
      {/* 1. Net PnL */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">{t.netProfit}</span>
          <DollarSign className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        </div>
        <div
          className={`text-lg sm:text-xl font-bold font-mono tracking-tight ${
            performanceMetrics.netProfitUsd > 0
              ? 'text-emerald-400'
              : performanceMetrics.netProfitUsd < 0
              ? 'text-rose-400'
              : 'text-white'
          }`}
        >
          {performanceMetrics.netProfitUsd >= 0 ? '+' : ''}${performanceMetrics.netProfitUsd.toFixed(2)}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
          Gross: ${performanceMetrics.grossProfitUsd.toFixed(1)}
        </div>
      </div>

      {/* 2. Unrealized PnL (Live) */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">{t.unrealizedPnl}</span>
          <TrendingUp className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        </div>
        <div
          className={`text-lg sm:text-xl font-bold font-mono tracking-tight ${
            balance.totalUnrealizedProfit > 0
              ? 'text-emerald-400'
              : balance.totalUnrealizedProfit < 0
              ? 'text-rose-400'
              : 'text-slate-300'
          }`}
        >
          {balance.totalUnrealizedProfit >= 0 ? '+' : ''}${balance.totalUnrealizedProfit.toFixed(2)}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {positions.length} {t.activePositionsCount}
        </div>
      </div>

      {/* 3. Profit Factor */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">{t.profitFactor}</span>
          <Activity className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        </div>
        <div className="text-lg sm:text-xl font-bold font-mono text-white">
          {performanceMetrics.profitFactor > 0 ? performanceMetrics.profitFactor.toFixed(2) : '—'}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          Win Rate: {performanceMetrics.winRatePercent}%
        </div>
      </div>

      {/* 4. Expectancy per Trade */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">{t.expectancy}</span>
          <BarChart3 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
        </div>
        <div
          className={`text-lg sm:text-xl font-bold font-mono ${
            performanceMetrics.expectancyUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {performanceMetrics.expectancyUsd >= 0 ? '+' : ''}${performanceMetrics.expectancyUsd.toFixed(2)}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          Avg Win: ${performanceMetrics.averageWinUsd}
        </div>
      </div>

      {/* 5. Max Drawdown */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">{t.maxDrawdown}</span>
          <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
        </div>
        <div className="text-lg sm:text-xl font-bold font-mono text-rose-400">
          -${performanceMetrics.maxDrawdownUsd.toFixed(1)}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {performanceMetrics.maxDrawdownPercent.toFixed(1)}% of peak
        </div>
      </div>

      {/* 6. Commissions & Fees */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">{t.totalCommissions}</span>
          <Receipt className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        </div>
        <div className="text-lg sm:text-xl font-bold font-mono text-slate-200">
          ${(performanceMetrics.totalCommissionsUsd + performanceMetrics.totalSlippageUsd).toFixed(2)}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          Taker + Slippage
        </div>
      </div>

      {/* 7. Total Open Notional Exposure */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="truncate">Open Notional</span>
          <Percent className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        </div>
        <div className="text-lg sm:text-xl font-bold font-mono text-white">
          ${portfolioExposure.totalOpenNotionalUsd.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          Margin: ${portfolioExposure.totalInitialMarginUsd.toFixed(1)}
        </div>
      </div>

      {/* 8. Portfolio Risk Status */}
      <div
        className={`border rounded-xl p-3 shadow-md transition ${
          settings.killSwitchActive
            ? 'bg-rose-950/40 border-rose-500/50'
            : isRiskSafe
            ? 'bg-emerald-950/20 border-emerald-500/30'
            : 'bg-amber-950/20 border-amber-500/30'
        }`}
      >
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="truncate text-slate-400">{t.riskStatus}</span>
          {settings.killSwitchActive ? (
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : (
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          )}
        </div>
        <div
          className={`text-lg sm:text-xl font-bold font-mono ${
            settings.killSwitchActive
              ? 'text-rose-400'
              : isRiskSafe
              ? 'text-emerald-400'
              : 'text-amber-400'
          }`}
        >
          {settings.killSwitchActive ? 'HALTED' : isRiskSafe ? 'NORMAL' : 'ELEVATED'}
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5 truncate font-mono">
          Risk/Stop: ${portfolioExposure.totalRiskToStopUsd.toFixed(1)}
        </div>
      </div>
    </div>
  );
};
