import React, { useState } from 'react';
import { useTrading } from '../context/TradingContext';
import { AIDiagnosisReport, Position } from '../types/trading';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Flame,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';

export const ActivePositionsTable: React.FC = () => {
  const {
    positions,
    closePosition,
    closeAllPositions,
    runAIDoctorDiagnosis,
    executeMaxPrioritySwap,
    t,
    language,
    runReconciliation,
    botRunning,
    toggleBot,
  } = useTrading();

  const [closingId, setClosingId] = useState<string | null>(null);
  const [isClosingAll, setIsClosingAll] = useState(false);
  const [showCloseAllModal, setShowCloseAllModal] = useState(false);
  const [positionToClose, setPositionToClose] = useState<Position | null>(null);

  const [isReconciling, setIsReconciling] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isSwappingPriority, setIsSwappingPriority] = useState(false);
  const [diagnosisReportModal, setDiagnosisReportModal] = useState<AIDiagnosisReport | null>(null);

  const isArabic = language === 'ar';

  const handleExecuteSingleClose = async () => {
    if (!positionToClose) return;
    const posId = positionToClose.id;
    setClosingId(posId);
    try {
      await closePosition(posId, 'MANUAL_CLOSE');
      setPositionToClose(null);
    } finally {
      setClosingId(null);
    }
  };

  const handleExecuteCloseAll = async () => {
    setIsClosingAll(true);
    try {
      await closeAllPositions();
      setShowCloseAllModal(false);
    } finally {
      setIsClosingAll(false);
    }
  };

  const handleRunAIDoctor = async () => {
    setIsDiagnosing(true);
    try {
      const report = await runAIDoctorDiagnosis();
      if (report && report.scanned > 0) {
        setDiagnosisReportModal(report);
      }
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleMaxPrioritySwap = async () => {
    setIsSwappingPriority(true);
    try {
      await executeMaxPrioritySwap();
    } finally {
      setIsSwappingPriority(false);
    }
  };

  const handleManualReconcile = async () => {
    setIsReconciling(true);
    try {
      await runReconciliation(true);
    } finally {
      setIsReconciling(false);
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

  const totalUnrealizedPnL = positions.reduce((acc, p) => acc + (p.unrealizedProfit || 0), 0);
  const totalAllocatedMargin = positions.reduce((acc, p) => acc + (p.amountUsd || 0), 0);

  return (
    <div className="bg-[#121824] border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden relative">
      {/* Table Header / Action Bar */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <span>{t.activePositionsTitle}</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-bold">
                {positions.length}
              </span>
            </h2>
          </div>
        </div>

        {/* Action Buttons: AI Doctor + Max Priority + Reconcile + Close All */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 1. AI Doctor Manage Positions Button */}
          <button
            onClick={handleRunAIDoctor}
            disabled={isDiagnosing}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-cyan-500/15 border border-cyan-500/30 hover:bg-cyan-500/25 text-cyan-300 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm shadow-cyan-950"
            title={isArabic ? 'تشخيص وإدارة الصفقات بالذكاء الاصطناعي (قطع وقائي / تعادل / تعزيز)' : 'AI Doctor: Diagnose & Manage Positions'}
          >
            {isDiagnosing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span>
              {isDiagnosing
                ? (isArabic ? 'جارٍ الفحص...' : 'Managing...')
                : (isArabic ? 'إدارة الصفقات' : 'Manage Positions')}
            </span>
          </button>

          {/* 2. Max Priority Trade Opportunity Swapper */}
          <button
            onClick={handleMaxPrioritySwap}
            disabled={isSwappingPriority}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/40 text-amber-300 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm shadow-amber-950"
            title={isArabic ? 'اقتناص أقوى فرصة في السوق أو استبدال أضعف صفقة مفتوحة بها' : 'Max Priority: Capture top market runner or swap weakest position'}
          >
            {isSwappingPriority ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            ) : (
              <Flame className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            )}
            <span>
              {isSwappingPriority
                ? (isArabic ? 'جارٍ الفحص...' : 'Reallocating...')
                : (isArabic ? 'الأولوية القصوى' : 'Max Priority')}
            </span>
          </button>

          {/* 3. Binance Reconciliation */}
          <button
            onClick={handleManualReconcile}
            disabled={isReconciling}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-500/15 border border-indigo-500/30 hover:bg-indigo-500/25 text-indigo-300 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title={t.reconcileNow}
          >
            {isReconciling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            )}
            <span>{isReconciling ? (isArabic ? 'جارٍ الفحص...' : 'Reconciling...') : (isArabic ? 'مطابقة باينانس' : 'Reconcile')}</span>
          </button>

          {/* 4. Safe Close All Positions (With Explicit Confirmation Modal) */}
          {positions.length > 0 && (
            <button
              onClick={() => setShowCloseAllModal(true)}
              disabled={isClosingAll}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 hover:text-rose-200 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title={isArabic ? 'إغلاق كافة الصفقات النشطة مع طلب تأكيد' : 'Close all active positions with confirmation'}
            >
              <X className="w-3.5 h-3.5 text-rose-400" />
              <span>{isArabic ? 'إغلاق الكل فوراً' : 'Close All'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {positions.length === 0 ? (
        <div className="p-8 sm:p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/50 border border-slate-700/50 mx-auto flex items-center justify-center text-slate-500">
            <Zap className="w-7 h-7 text-amber-400/60 animate-pulse" />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-bold text-slate-200">
              {t.noActivePositions}
            </p>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              {botRunning
                ? isArabic
                  ? '🟢 البوت يعمل 24/7 ويفحص السوق آلياً في باينانس لدخول أفضل الصفقات المؤهلة وإدارتها بالذكاء الاصطناعي.'
                  : '🟢 Bot is actively scanning Binance 24/7 for qualified AI opportunities.'
                : isArabic
                ? 'البوت متوقف حالياً. اضغط على زر التشغيل لبدء فحص السوق والتداول التلقائي 24/7.'
                : 'Bot is currently stopped. Click the button below to start 24/7 scanning & execution.'}
            </p>
          </div>

          {!botRunning && (
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={toggleBot}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition cursor-pointer"
              >
                <Play className="w-4 h-4 fill-black" />
                <span>{isArabic ? '▶️ تشغيل البوت 24/7 الآن' : 'Start 24/7 Bot Now'}</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Desktop High-Density View (6 Compact Columns - Fits 100% Width without Horizontal Scrollbar) */}
          <div className="hidden lg:block w-full overflow-hidden">
            <table className="w-full text-left text-xs table-fixed">
              <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[11px] font-mono border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3.5 w-[20%]">{isArabic ? 'الزوج والاتجاه' : 'Pair & Direction'}</th>
                  <th className="py-3 px-3 w-[16%]">{isArabic ? 'الهامش والقيمة' : 'Margin & Notional'}</th>
                  <th className="py-3 px-3 w-[18%]">{isArabic ? 'الأسعار (دخول / سوق)' : 'Prices (Entry / Mark)'}</th>
                  <th className="py-3 px-3 w-[18%]">{isArabic ? 'الأهداف والوقف' : 'Targets (SL / TP)'}</th>
                  <th className="py-3 px-3 w-[16%]">{isArabic ? 'الأرباح وصحة الصفقة' : 'PnL & AI Health'}</th>
                  <th className="py-3 px-3.5 w-[12%] text-right">{t.action}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {positions.map((pos, idx) => {
                  const isLong = pos.side === 'LONG';
                  const isProfit = pos.unrealizedProfit >= 0;
                  const leveragedNotional = pos.amountUsd * (pos.leverage || 1);
                  const priceDiff = pos.markPrice > 0 && pos.entryPrice > 0
                    ? (((pos.markPrice - pos.entryPrice) / pos.entryPrice) * 100) * (isLong ? 1 : -1)
                    : 0;

                  return (
                    <tr key={`${pos.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                      {/* 1. Pair & Direction */}
                      <td className="py-3 px-3.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-white text-xs">{pos.symbol}</span>
                          <span
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isLong
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {isLong ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                            <span>{isLong ? t.long : t.short}</span>
                          </span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                            {pos.leverage}x
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 font-sans">
                          {pos.isRealOrder && !pos.isTestnet ? (
                            <span className="text-emerald-400 font-bold font-mono">● LIVE</span>
                          ) : (
                            <span className="text-amber-400 font-bold font-mono">● DEMO</span>
                          )}
                          <span className="text-slate-500 flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> {formatAge(pos.openedAt)}
                          </span>
                        </div>
                      </td>

                      {/* 2. Margin & Notional */}
                      <td className="py-3 px-3">
                        <div className="font-bold text-white text-xs">
                          ${pos.amountUsd.toFixed(2)} <span className="text-[10px] text-slate-400 font-normal">USDT</span>
                        </div>
                        <div className="text-[10px] text-amber-300 font-sans mt-0.5">
                          {isArabic ? 'القيمة: ' : 'Val: '}${leveragedNotional.toFixed(1)}
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono truncate">
                          {pos.quantity} {pos.symbol.replace('USDT', '')}
                        </div>
                      </td>

                      {/* 3. Prices (Entry, Mark, Liq) */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-400 text-[10px]">{isArabic ? 'دخول:' : 'Entry:'}</span>
                          <span className="font-bold text-slate-200">${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs mt-0.5">
                          <span className="text-slate-400 text-[10px]">{isArabic ? 'سوق:' : 'Mark:'}</span>
                          <span className={`font-semibold ${priceDiff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ${pos.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                          </span>
                          <span className={`text-[10px] ${priceDiff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ({priceDiff >= 0 ? '+' : ''}{priceDiff.toFixed(2)}%)
                          </span>
                        </div>
                        {pos.liquidationPrice > 0 && (
                          <div className="text-[9px] text-amber-500/90 font-mono mt-0.5">
                            {isArabic ? 'تصفية: ' : 'Liq: '}${pos.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                          </div>
                        )}
                      </td>

                      {/* 4. Targets (SL / TP) */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-rose-400 text-[10px] font-bold">SL:</span>
                          <span className="font-semibold text-rose-300 font-mono">${pos.stopLossPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          {pos.stopLossOrderStatus === 'ACTIVE' ? (
                            <span title="Exchange Active"><ShieldCheck className="w-3 h-3 text-emerald-400" /></span>
                          ) : (
                            <span title="Client Monitored"><ShieldAlert className="w-3 h-3 text-amber-400" /></span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs mt-0.5">
                          <span className="text-emerald-400 text-[10px] font-bold">TP:</span>
                          <span className="font-semibold text-emerald-300 font-mono">${pos.takeProfitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          {pos.tpLevelReached && pos.tpLevelReached > 0 && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                              TP{pos.tpLevelReached}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 5. PnL & AI Health */}
                      <td className="py-3 px-3">
                        <div className={`font-bold text-xs flex items-center gap-1 ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                          <span>{isProfit ? '+' : ''}${pos.unrealizedProfit.toFixed(2)}</span>
                          <span className="text-[10px] font-semibold">({isProfit ? '+' : ''}{pos.pnlPercentage.toFixed(1)}%)</span>
                        </div>
                        {pos.aiDiagnosis ? (
                          <div className="mt-1 flex items-center gap-1 flex-wrap">
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-bold font-sans border ${
                                pos.aiDiagnosis.recommendation === 'AI_EARLY_CUT'
                                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                                  : pos.aiDiagnosis.recommendation === 'AI_EARLY_PROFIT_TAKE'
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : 'bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                              title={isArabic ? pos.aiDiagnosis.reasoningAr : pos.aiDiagnosis.reasoningEn}
                            >
                              {isArabic ? pos.aiDiagnosis.labelAr : pos.aiDiagnosis.labelEn}
                            </span>
                            <span className="text-[9px] text-slate-400 font-mono">
                              {pos.aiDiagnosis.recoveryProbability}%
                            </span>
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Sparkles className="w-2.5 h-2.5 text-amber-400/70" />
                            <span>{isArabic ? 'نشطة' : 'Active'}</span>
                          </div>
                        )}
                      </td>

                      {/* 6. Action Button (Opens Single Close Confirmation Modal) */}
                      <td className="py-3 px-3.5 text-right">
                        <button
                          onClick={() => setPositionToClose(pos)}
                          disabled={closingId === pos.id}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-rose-500/25 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 transition cursor-pointer"
                        >
                          {closingId === pos.id ? (
                            <span className="flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>{t.closing}</span>
                            </span>
                          ) : (
                            <span>{t.closePosition}</span>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile / Tablet Responsive Cards Layout (Zero Horizontal Scrollbar on Any Phone or Tablet) */}
          <div className="block lg:hidden p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {positions.map((pos, idx) => {
              const isLong = pos.side === 'LONG';
              const isProfit = pos.unrealizedProfit >= 0;
              const leveragedNotional = pos.amountUsd * (pos.leverage || 1);
              const priceDiff = pos.markPrice > 0 && pos.entryPrice > 0
                ? (((pos.markPrice - pos.entryPrice) / pos.entryPrice) * 100) * (isLong ? 1 : -1)
                : 0;

              return (
                <div
                  key={`card-${pos.id}-${idx}`}
                  className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3 shadow-md"
                >
                  {/* Top Row: Symbol, Side, Leverage, PnL */}
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white text-sm">{pos.symbol}</span>
                      <span
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isLong
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {isLong ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                        <span>{isLong ? t.long : t.short}</span>
                      </span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 font-mono">
                        {pos.leverage}x
                      </span>
                    </div>

                    <div className={`text-right font-bold font-mono text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                      <div>{isProfit ? '+' : ''}${pos.unrealizedProfit.toFixed(2)}</div>
                      <div className="text-[10px] font-medium">({isProfit ? '+' : ''}{pos.pnlPercentage.toFixed(1)}%)</div>
                    </div>
                  </div>

                  {/* Middle Row: Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800/50">
                      <div className="text-[10px] text-slate-400 font-sans">{isArabic ? 'الهامش / القيمة' : 'Margin / Notional'}</div>
                      <div className="font-bold text-slate-200">${pos.amountUsd.toFixed(2)} USDT</div>
                      <div className="text-[9px] text-amber-300/90 font-sans">${leveragedNotional.toFixed(1)} Notional</div>
                    </div>

                    <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800/50">
                      <div className="text-[10px] text-slate-400 font-sans">{isArabic ? 'سعر الدخول / السوق' : 'Entry / Mark'}</div>
                      <div className="font-bold text-slate-200">${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</div>
                      <div className={`text-[10px] font-semibold ${priceDiff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        ${pos.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </div>
                    </div>

                    <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800/50">
                      <div className="text-[10px] text-rose-400 font-sans font-bold flex items-center justify-between">
                        <span>Stop Loss (SL)</span>
                        {pos.stopLossOrderStatus === 'ACTIVE' ? (
                          <ShieldCheck className="w-2.5 h-2.5 text-emerald-400" />
                        ) : (
                          <ShieldAlert className="w-2.5 h-2.5 text-amber-400" />
                        )}
                      </div>
                      <div className="font-bold text-rose-300">${pos.stopLossPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    </div>

                    <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800/50">
                      <div className="text-[10px] text-emerald-400 font-sans font-bold">Take Profit (TP)</div>
                      <div className="font-bold text-emerald-300">${pos.takeProfitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    </div>
                  </div>

                  {/* Bottom Row: AI Diagnosis & Close Button */}
                  <div className="flex items-center justify-between pt-1 gap-2">
                    <div className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>{formatAge(pos.openedAt)}</span>
                      </span>
                      {pos.aiDiagnosis && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-sans font-bold border border-slate-700">
                          {isArabic ? pos.aiDiagnosis.labelAr : pos.aiDiagnosis.labelEn}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => setPositionToClose(pos)}
                      disabled={closingId === pos.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition cursor-pointer"
                    >
                      {closingId === pos.id ? (
                        <span className="flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>{t.closing}</span>
                        </span>
                      ) : (
                        <span>{t.closePosition}</span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 1. Modal: Single Position Close Confirmation */}
      {positionToClose && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#0f141f] border border-rose-500/40 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {isArabic ? 'تأكيد إغلاق الصفقة الآن' : 'Confirm Close Position'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {isArabic ? 'منع الإغلاق الخاطئ وتأكيد أمر الإغلاق الفوري' : 'Prevent accidental execution'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPositionToClose(null)}
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Position Details Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3 font-mono">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <span className="font-bold text-sm text-white flex items-center gap-2">
                  <span>{positionToClose.symbol}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                      positionToClose.side === 'LONG'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/20 text-rose-400'
                    }`}
                  >
                    {positionToClose.side} {positionToClose.leverage}x
                  </span>
                </span>
                <span
                  className={`text-sm font-bold ${
                    positionToClose.unrealizedProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {positionToClose.unrealizedProfit >= 0 ? '+' : ''}${positionToClose.unrealizedProfit.toFixed(2)} ({positionToClose.unrealizedProfit >= 0 ? '+' : ''}{positionToClose.pnlPercentage.toFixed(2)}%)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400 font-sans block text-[10px]">{isArabic ? 'سعر الدخول:' : 'Entry Price:'}</span>
                  <span className="font-bold text-slate-200">${positionToClose.entryPrice}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-sans block text-[10px]">{isArabic ? 'السعر الحالي:' : 'Current Mark:'}</span>
                  <span className="font-bold text-slate-200">${positionToClose.markPrice}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-sans block text-[10px]">{isArabic ? 'الهامش المسترد للرصيد:' : 'Margin Released:'}</span>
                  <span className="font-bold text-emerald-400">${positionToClose.amountUsd.toFixed(2)} USDT</span>
                </div>
                <div>
                  <span className="text-slate-400 font-sans block text-[10px]">{isArabic ? 'مدة الصفقة:' : 'Duration:'}</span>
                  <span className="font-bold text-slate-200">{formatAge(positionToClose.openedAt)}</span>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed font-sans bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl">
              {isArabic
                ? '⚠️ سيتم إغلاق الصفقة فوراً بأمر سوق (Market Order) على منصة باينانس وإلغاء كافة أوامر وقف الخسارة وجني الأرباح المعلقة المرتبطة بها.'
                : '⚠️ This position will be closed immediately via a market order on Binance, and any protective stop orders will be cancelled.'}
            </p>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setPositionToClose(null)}
                disabled={closingId !== null}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                {isArabic ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleExecuteSingleClose}
                disabled={closingId !== null}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-lg shadow-rose-950"
              >
                {closingId ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{isArabic ? 'جارٍ الإغلاق...' : 'Closing...'}</span>
                  </>
                ) : (
                  <>
                    <X className="w-3.5 h-3.5" />
                    <span>{isArabic ? 'تأكيد إغلاق الصفقة الآن' : 'Confirm Close Now'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Modal: Close All Positions Confirmation */}
      {showCloseAllModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#0f141f] border border-rose-500/50 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                  <AlertTriangle className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {isArabic ? '⚠️ تأكيد إغلاق كافة الصفقات المفتوحة' : '⚠️ Confirm Close All Positions'}
                  </h3>
                  <p className="text-xs text-rose-300/80">
                    {isArabic ? 'إجراء جماعي لإغلاق جميع الصفقات فوراً' : 'Mass liquidation of open positions'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCloseAllModal(false)}
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Aggregated Overview */}
            <div className="grid grid-cols-3 gap-2 text-center font-mono">
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl">
                <div className="text-[10px] text-slate-400 font-sans mb-0.5">{isArabic ? 'عدد الصفقات' : 'Positions'}</div>
                <div className="text-base font-bold text-white">{positions.length}</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl">
                <div className="text-[10px] text-slate-400 font-sans mb-0.5">{isArabic ? 'الأرباح الحالية' : 'Total PnL'}</div>
                <div className={`text-base font-bold ${totalUnrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {totalUnrealizedPnL >= 0 ? '+' : ''}${totalUnrealizedPnL.toFixed(2)}
                </div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl">
                <div className="text-[10px] text-slate-400 font-sans mb-0.5">{isArabic ? 'الهامش المحرر' : 'Margin Released'}</div>
                <div className="text-base font-bold text-emerald-400">${totalAllocatedMargin.toFixed(2)}</div>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed font-sans bg-rose-500/10 border border-rose-500/30 p-3 rounded-xl">
              {isArabic
                ? `هل أنت متأكد من رغبتك في إغلاق جميع الصفقات المفتوحة (${positions.length} صفقات) فوراً بسعر السوق على منصة باينانس وإعادة الهامش إلى المحفظة؟`
                : `Are you sure you want to close all ${positions.length} open positions immediately at market price on Binance and release allocated margin?`}
            </p>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowCloseAllModal(false)}
                disabled={isClosingAll}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                {isArabic ? 'إلغاء والتراجع' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleExecuteCloseAll}
                disabled={isClosingAll}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-lg shadow-rose-950"
              >
                {isClosingAll ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{isArabic ? 'جارٍ إغلاق الكل...' : 'Closing All...'}</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                    <span>{isArabic ? 'نعم، إغلاق جميع الصفقات فوراً' : 'Yes, Close All Now'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Trade Doctor Diagnosis Report Modal */}
      {diagnosisReportModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-[#0f141f] border border-cyan-500/40 rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[88vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>{isArabic ? '🩺 تقرير إدارة الصفقات والتشخيص الذكي' : '🩺 AI Trade Doctor Diagnostic Report'}</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    {isArabic
                      ? 'تحليل فوري لعمق السوق، الزخم، واحتمالية التعافي لحماية رأس المال'
                      : 'Live momentum, orderbook pressure, and recovery probability assessment'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDiagnosisReportModal(null)}
                className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                <div className="text-[10px] text-slate-400 mb-0.5">{isArabic ? 'تم فحصها' : 'Scanned'}</div>
                <div className="text-sm font-bold font-mono text-cyan-400">{diagnosisReportModal.scanned}</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                <div className="text-[10px] text-slate-400 mb-0.5">{isArabic ? 'قطع وقائي' : 'Early Cuts'}</div>
                <div className="text-sm font-bold font-mono text-rose-400">{diagnosisReportModal.closedEarly}</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                <div className="text-[10px] text-slate-400 mb-0.5">{isArabic ? 'تعادل $0' : 'Breakeven'}</div>
                <div className="text-sm font-bold font-mono text-cyan-300">{diagnosisReportModal.closedBreakeven}</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                <div className="text-[10px] text-slate-400 mb-0.5">{isArabic ? 'حجز أرباح' : 'Profit Locked'}</div>
                <div className="text-sm font-bold font-mono text-emerald-400">{diagnosisReportModal.profitLocked}</div>
              </div>
              <div className="col-span-2 sm:col-span-1 bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                <div className="text-[10px] text-slate-400 mb-0.5">{isArabic ? 'مستمرة بأمان' : 'Held Healthy'}</div>
                <div className="text-sm font-bold font-mono text-emerald-400">{diagnosisReportModal.held}</div>
              </div>
            </div>

            {/* Scanned Coin Details List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {diagnosisReportModal.items.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">{item.symbol}</span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                          item.side === 'LONG'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-rose-500/20 text-rose-400'
                        }`}
                      >
                        {item.side}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold font-mono ${
                          item.pnlPercentage >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {item.pnlPercentage >= 0 ? '+' : ''}{item.pnlPercentage.toFixed(2)}%
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-bold border ${
                          item.actionType === 'AI_EARLY_CUT'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : item.actionType === 'AI_BREAKEVEN_EXIT'
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : item.actionType === 'AI_EARLY_PROFIT_TAKE'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : item.actionType === 'AI_DCA_REINFORCE'
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        {item.action}
                      </span>
                    </div>
                  </div>

                  {/* Recovery Probability Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">{isArabic ? 'مؤشر احتمالية التعافي والاستمرار:' : 'Recovery Probability:'}</span>
                      <span
                        className={`font-bold font-mono ${
                          item.recoveryProbability >= 65
                            ? 'text-emerald-400'
                            : item.recoveryProbability <= 30
                            ? 'text-rose-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {item.recoveryProbability}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          item.recoveryProbability >= 65
                            ? 'bg-emerald-400'
                            : item.recoveryProbability <= 30
                            ? 'bg-rose-500'
                            : 'bg-amber-400'
                        }`}
                        style={{ width: `${item.recoveryProbability}%` }}
                      />
                    </div>
                  </div>

                  {/* Diagnostic Rationale */}
                  <p className="text-xs text-slate-300 bg-slate-950/50 p-2 rounded-lg border border-slate-800/60 leading-relaxed font-sans">
                    {item.reason}
                  </p>
                </div>
              ))}
            </div>

            {/* Modal Bottom Close */}
            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setDiagnosisReportModal(null)}
                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs transition cursor-pointer"
              >
                {isArabic ? 'إغلاق التقرير ومتابعة التداول' : 'Close Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
