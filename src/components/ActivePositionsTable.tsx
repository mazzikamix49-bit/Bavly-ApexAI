import React, { useRef, useState } from 'react';
import { useTrading } from '../context/TradingContext';
import { AIDiagnosisReport } from '../types/trading';
import {
  Activity,
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
    tradingMode,
    botRunning,
    toggleBot,
    openPosition,
    marketPairs,
  } = useTrading();
  const [closingId, setClosingId] = useState<string | null>(null);
  const [isClosingAll, setIsClosingAll] = useState(false);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isSwappingPriority, setIsSwappingPriority] = useState(false);
  const [diagnosisReportModal, setDiagnosisReportModal] = useState<AIDiagnosisReport | null>(null);
  const [isExecutingQuickTest, setIsExecutingQuickTest] = useState(false);
  const confirmTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isArabic = language === 'ar';

  const handleQuickTestTrade = async () => {
    if (marketPairs.length === 0) return;
    setIsExecutingQuickTest(true);
    // Prefer top candidate or BTCUSDT
    const candidate = marketPairs.find((p) => p.symbol === 'BTCUSDT') || marketPairs[0];
    const side = candidate.trend === 'BEARISH' ? 'SHORT' : 'LONG';
    await openPosition(
      candidate.symbol,
      side,
      isArabic
        ? '⚡ صفقة اختبار تجريبية فورية للتحقق من عمل النظام والمحاكاة'
        : '⚡ Instant paper test trade for system verification'
    );
    setIsExecutingQuickTest(false);
  };

  const handleClose = async (posId: string) => {
    setClosingId(posId);
    await closePosition(posId, 'MANUAL_CLOSE');
    setClosingId(null);
  };

  const handleCloseAllClick = () => {
    if (!showCloseAllConfirm) {
      setShowCloseAllConfirm(true);
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = setTimeout(() => {
        setShowCloseAllConfirm(false);
      }, 6000);
    } else {
      handleExecuteCloseAll();
    }
  };

  const handleExecuteCloseAll = async () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setShowCloseAllConfirm(false);
    setIsClosingAll(true);
    try {
      await closeAllPositions();
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

  return (
    <div className="bg-[#121824] border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden relative">
      {/* Table Header / Action Bar */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
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

        {/* Action Buttons: AI Doctor + Max Priority + Reconcile + Close All */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 1. AI Doctor Manage Positions Button */}
          <button
            onClick={handleRunAIDoctor}
            disabled={isDiagnosing}
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-cyan-500/15 border border-cyan-500/30 hover:bg-cyan-500/25 text-cyan-300 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm shadow-cyan-950"
            title={isArabic ? 'تشخيص وإدارة الصفقات بالذكاء الاصطناعي (قطع وقائي / تعادل / تعزيز)' : 'AI Doctor: Diagnose & Manage Positions'}
          >
            {isDiagnosing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span>
              {isDiagnosing
                ? (isArabic ? 'جارٍ إدارة الصفقات...' : 'Managing...')
                : (isArabic ? 'إدارة الصفقات' : 'Manage Positions')}
            </span>
          </button>

          {/* 2. Max Priority Trade Opportunity Swapper */}
          <button
            onClick={handleMaxPrioritySwap}
            disabled={isSwappingPriority}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/40 text-amber-300 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm shadow-amber-950"
            title={isArabic ? 'اقتناص أقوى فرصة في السوق أو استبدال أضعف صفقة مفتوحة بها' : 'Max Priority: Capture top market runner or swap weakest position'}
          >
            {isSwappingPriority ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            ) : (
              <Flame className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            )}
            <span>
              {isSwappingPriority
                ? (isArabic ? 'جارٍ فحص واقتناص...' : 'Reallocating...')
                : (isArabic ? 'الأولوية القصوى' : 'Max Priority')}
            </span>
          </button>

          {/* 3. Binance Reconciliation */}
          <button
            onClick={handleManualReconcile}
            disabled={isReconciling}
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-500/15 border border-indigo-500/30 hover:bg-indigo-500/25 text-indigo-300 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title={t.reconcileNow}
          >
            {isReconciling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            )}
            <span>{isReconciling ? (isArabic ? 'جارٍ فحص المطابقة...' : 'Reconciling...') : (isArabic ? 'فحص المطابقة مع باينانس' : 'Binance Reconciliation')}</span>
          </button>

          {/* 4. Safe Close All Positions (No window.confirm, interactive 2-step button) */}
          {positions.length > 0 && (
            <div className="flex items-center gap-1.5">
              {showCloseAllConfirm ? (
                <div className="flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-200">
                  <button
                    onClick={handleExecuteCloseAll}
                    disabled={isClosingAll}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-900/50 transition flex items-center gap-1.5 cursor-pointer animate-pulse"
                  >
                    {isClosingAll ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                    )}
                    <span>
                      {isClosingAll
                        ? (isArabic ? 'جارٍ الإغلاق...' : 'Closing...')
                        : (isArabic ? `⚠️ تأكيد إغلاق (${positions.length}) صفقات؟` : `⚠️ Confirm Close All (${positions.length})?`)}
                    </span>
                  </button>
                  <button
                    onClick={() => setShowCloseAllConfirm(false)}
                    className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                    title={isArabic ? 'إلغاء' : 'Cancel'}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleCloseAllClick}
                  disabled={isClosingAll}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title={isArabic ? 'إغلاق كافة الصفقات النشطة فوراً' : 'Close all active positions immediately'}
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{isArabic ? 'إغلاق الكل فوراً' : 'Close All'}</span>
                </button>
              )}
            </div>
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

          {/* Action Buttons in Empty State */}
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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-[11px] font-mono border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">{t.pair}</th>
                <th className="py-3 px-3">{t.side}</th>
                <th className="py-3 px-3">{isArabic ? 'حجم الصفقة (الهامش)' : 'Position Size (Margin)'}</th>
                <th className="py-3 px-3">{isArabic ? 'سعر الدخول' : 'Entry Price'}</th>
                <th className="py-3 px-3">{isArabic ? 'القيمة بعد الرافعة' : 'Leveraged Value'}</th>
                <th className="py-3 px-3">{t.markPrice}</th>
                <th className="py-3 px-3">{t.liqPrice}</th>
                <th className="py-3 px-3">{isArabic ? 'وقف الخسارة' : 'Stop Loss'}</th>
                <th className="py-3 px-3">{isArabic ? 'جني الأرباح' : 'Take Profit'}</th>
                <th className="py-3 px-3">{isArabic ? 'تشخيص الذكاء الاصطناعي' : 'AI Doctor'}</th>
                <th className="py-3 px-3">{t.pnl}</th>
                <th className="py-3 px-3">{isArabic ? 'العمولة / التوقيت' : 'Fees & Age'}</th>
                <th className="py-3 px-4 text-right">{t.action}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {positions.map((pos, idx) => {
                const isLong = pos.side === 'LONG';
                const currentPrice = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;
                const isProfit = pos.unrealizedProfit >= 0;
                const leveragedNotional = pos.amountUsd * (pos.leverage || 1);

                return (
                  <tr key={`${pos.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                    {/* Pair */}
                    <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                      <span>{pos.symbol}</span>
                      {pos.isRealOrder && !pos.isTestnet ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-sans font-bold">
                          LIVE
                        </span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-sans font-bold">
                          DEMO
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

                    {/* 1. حجم الصفقة (الهامش الفعلي المدفوع) */}
                    <td className="py-3.5 px-3">
                      <div className="font-bold text-white text-xs">
                        ${pos.amountUsd.toFixed(2)} USDT
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {pos.quantity} {pos.symbol.replace('USDT', '')}
                      </div>
                    </td>

                    {/* 2. سعر الدخول الأساسي */}
                    <td className="py-3.5 px-3 text-slate-200">
                      <div className="font-bold text-white text-xs">
                        ${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans">
                        {isArabic ? 'سعر الافتتاح' : 'Entry Price'}
                      </div>
                    </td>

                    {/* 3. القيمة الإجمالية بعد الرافعة المالية */}
                    <td className="py-3.5 px-3">
                      <div className="font-bold text-amber-300 text-xs flex items-center gap-1">
                        <span>${leveragedNotional.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</span>
                      </div>
                      <div className="text-[10px] text-amber-400 font-mono flex items-center gap-1 mt-0.5">
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                          {pos.leverage}x
                        </span>
                        <span className="text-slate-400 font-sans">
                          {isArabic ? 'قوة الشراء' : 'Leveraged'}
                        </span>
                      </div>
                    </td>

                    {/* Mark Price */}
                    <td className="py-3.5 px-3 font-semibold text-white">
                      <div className="text-xs font-mono">
                        ${pos.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </div>
                      <div className={`text-[10px] font-mono ${pos.markPrice >= pos.entryPrice ? (isLong ? 'text-emerald-400' : 'text-rose-400') : (isLong ? 'text-rose-400' : 'text-emerald-400')}`}>
                        {pos.markPrice >= pos.entryPrice ? '▲' : '▼'} {(((pos.markPrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100).toFixed(2)}%
                      </div>
                    </td>

                    {/* Liquidation Price */}
                    <td className="py-3.5 px-3 text-amber-500/80">
                      ${pos.liquidationPrice > 0 ? pos.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}
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

                    {/* AI Trade Doctor Diagnosis */}
                    <td className="py-3.5 px-3">
                      {pos.aiDiagnosis ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {pos.aiDiagnosis.healthStatus && (
                              <span
                                className={`text-[9px] px-1.5 py-0.5 rounded font-bold font-mono ${
                                  pos.aiDiagnosis.healthStatus === 'HEALTHY'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : pos.aiDiagnosis.healthStatus === 'WEAKENING'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    : pos.aiDiagnosis.healthStatus === 'INVALIDATED'
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                                    : 'bg-red-600/30 text-red-200 border border-red-500/60'
                                }`}
                              >
                                {isArabic
                                  ? pos.aiDiagnosis.healthStatus === 'HEALTHY'
                                    ? '🛡️ سليمة'
                                    : pos.aiDiagnosis.healthStatus === 'WEAKENING'
                                    ? '⚠️ ضعف'
                                    : pos.aiDiagnosis.healthStatus === 'INVALIDATED'
                                    ? '❌ مُبطلة'
                                    : '🚨 طوارئ'
                                  : pos.aiDiagnosis.healthStatus}
                              </span>
                            )}
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                                pos.aiDiagnosis.recommendation === 'AI_EARLY_CUT'
                                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                                  : pos.aiDiagnosis.recommendation === 'AI_EARLY_PROFIT_TAKE'
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : pos.aiDiagnosis.recommendation === 'AI_BREAKEVEN_EXIT'
                                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                  : pos.aiDiagnosis.recommendation === 'AI_DCA_REINFORCE'
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              }`}
                              title={isArabic ? pos.aiDiagnosis.reasoningAr : pos.aiDiagnosis.reasoningEn}
                            >
                              {isArabic ? pos.aiDiagnosis.labelAr : pos.aiDiagnosis.labelEn}
                            </span>
                            {pos.dcaCount && pos.dcaCount > 0 ? (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                                DCA 1x
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1 text-[10px]">
                            <span className="text-slate-400">{isArabic ? 'احتمالية التعافي:' : 'Recovery:'}</span>
                            <span
                              className={`font-bold ${
                                pos.aiDiagnosis.recoveryProbability >= 65
                                  ? 'text-emerald-400'
                                  : pos.aiDiagnosis.recoveryProbability <= 30
                                  ? 'text-rose-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {pos.aiDiagnosis.recoveryProbability}%
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-amber-400/70 animate-pulse" />
                          <span>{isArabic ? 'جارٍ التحليل...' : 'Analyzing...'}</span>
                        </div>
                      )}
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
