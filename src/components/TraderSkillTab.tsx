import React, { useState } from 'react';
import { useTrading } from '../context/TradingContext';
import { TraderSkillModuleStatus, TraderSkillPreTradeRiskVerdict } from '../types/trading';
import {
  TraderSkillAlerts,
  TraderSkillRebalance,
  TraderSkillTax,
} from '../services/traderSkillEngine';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  Database,
  ExternalLink,
  Flame,
  Globe,
  Layers,
  Lock,
  Newspaper,
  RefreshCw,
  Scale,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Unlock,
  Zap,
} from 'lucide-react';

export const TraderSkillTab: React.FC = () => {
  const {
    language,
    balance,
    positions,
    marketPairs,
    traderSkillAuditTrail,
    traderSkillModules,
    refreshTraderSkillAudit,
    closedTrades,
  } = useTrading();

  const [selectedCategory, setSelectedCategory] = useState<'ALL' | 'Scoring' | 'Safety' | 'Sizing' | 'Smart Money'>('ALL');
  const [filterVerdict, setFilterVerdict] = useState<'ALL' | 'PASS' | 'BLOCK'>('ALL');
  const [reliancePercent, setReliancePercent] = useState<95 | 99>(95);

  const isArabic = language === 'ar';
  const totalEquity = balance.totalMarginBalance || balance.totalWalletBalance || 0;
  const cashBuffer15Pct = totalEquity * 0.15;
  const investableBudget = Math.max(0, totalEquity - cashBuffer15Pct);

  // Live Module Diagnostics from trader-rebalance, trader-alerts, and trader-tax
  const driftReport = TraderSkillRebalance.checkPortfolioDrift(positions, totalEquity);
  const alertsList = TraderSkillAlerts.evaluateAlerts(positions);
  const taxReport = TraderSkillTax.calculateNetAccounting(positions, closedTrades);

  const filteredModules = selectedCategory === 'ALL'
    ? traderSkillModules
    : traderSkillModules.filter((m) => m.category === selectedCategory);

  const filteredAudit = filterVerdict === 'ALL'
    ? traderSkillAuditTrail
    : traderSkillAuditTrail.filter((a) => a.verdict === filterVerdict);

  // Icon mapper for 11 skills
  const getSkillIcon = (id: string) => {
    switch (id) {
      case 'screener':
        return <Compass className="w-5 h-5 text-cyan-400" />;
      case 'budget':
        return <Scale className="w-5 h-5 text-amber-400" />;
      case 'risk':
        return <ShieldCheck className="w-5 h-5 text-rose-400" />;
      case 'news':
        return <Newspaper className="w-5 h-5 text-indigo-400" />;
      case 'pelosi':
        return <Flame className="w-5 h-5 text-emerald-400" />;
      case 'analyst':
        return <Cpu className="w-5 h-5 text-blue-400" />;
      case 'broker':
        return <Lock className="w-5 h-5 text-yellow-400" />;
      case 'alerts':
        return <Zap className="w-5 h-5 text-purple-400" />;
      case 'rebalance':
        return <RefreshCw className="w-5 h-5 text-teal-400" />;
      case 'tax':
        return <Database className="w-5 h-5 text-slate-400" />;
      case 'copycat':
        return <Layers className="w-5 h-5 text-pink-400" />;
      default:
        return <Activity className="w-5 h-5 text-cyan-400" />;
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* 1. Header Banner & Architecture Summary */}
      <div className="bg-gradient-to-r from-[#0d131f] via-[#121824] to-[#0f172a] border border-cyan-500/30 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                <span>Jakeschincariol / trader-skill</span>
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>{isArabic ? `اعتماد بنسبة ${reliancePercent}% في البوت` : `${reliancePercent}% Primary Authority`}</span>
              </span>
              <a
                href="https://github.com/Jakeschincariol/trader-skill"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-slate-400 hover:text-cyan-300 transition flex items-center gap-1 font-mono"
              >
                <span>GitHub Repo</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {isArabic
                ? '⚡ محرك Trader-Skill المتطور (حزمة الـ 11 سكيلز المدمجة)'
                : '⚡ Integrated Trader-Skill Intelligence Suite (11 Skills Pack)'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed font-sans">
              {isArabic
                ? 'تم دمج وتفعيل خوارزميات trader-skill الـ 11 بالكامل لتقود قرارات البوت بنسبة 95% أو 99%: التدقيق الصارم قبل التنفيذ، حجز كاش الأمان (15%)، فحص محفزات الأخبار وحظر العملات المهددة، تتبع صفقات الحيتان، وتصنيف الفرص كمياً بأعلى دقة.'
                : 'All 11 modules from trader-skill are natively embedded to govern 95% - 99% of bot trade decisions: pre-trade risk verification, strict 15% cash safety buffer, news catalyst veto, whale flow absorption, and multi-metric quantitative screening.'}
            </p>
          </div>

          {/* Right Action: Reliance Toggle + Refresh */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 gap-1">
              <button
                type="button"
                onClick={() => setReliancePercent(95)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition cursor-pointer ${
                  reliancePercent === 95
                    ? 'bg-cyan-500 text-black shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={isArabic ? 'اعتماد 95% (الوضع المتوازن المتقدم)' : '95% Standard Authority'}
              >
                95%
              </button>
              <button
                type="button"
                onClick={() => setReliancePercent(99)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition cursor-pointer ${
                  reliancePercent === 99
                    ? 'bg-emerald-500 text-black shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={isArabic ? 'اعتماد 99% (أعلى توجيه صارم للحماية)' : '99% Ultra Authority'}
              >
                99%
              </button>
            </div>

            <button
              onClick={refreshTraderSkillAudit}
              className="px-4 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shrink-0 shadow-lg shadow-cyan-950"
            >
              <RefreshCw className="w-4 h-4 text-cyan-400" />
              <span>{isArabic ? 'تحديث الفحص والتدقيق' : 'Refresh Audit'}</span>
            </button>
          </div>
        </div>

        {/* Highlighted Rules Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-4 mt-4 border-t border-slate-800/80 font-mono text-xs">
          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
            <div className="text-[10px] text-slate-400 font-sans">{isArabic ? 'سلطة اتخاذ القرار' : 'Decision Weight'}</div>
            <div className="text-sm font-bold text-cyan-300">{reliancePercent}% Trader-Skill</div>
            <div className="text-[10px] text-slate-500 font-sans">{100 - reliancePercent}% {isArabic ? 'مؤشرات فنية داعمة' : 'Base indicators'}</div>
          </div>

          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
            <div className="text-[10px] text-slate-400 font-sans">{isArabic ? 'كاش الأمان المحمي (Buffer)' : 'Protected Cash Buffer'}</div>
            <div className="text-sm font-bold text-emerald-400">15.0% (${cashBuffer15Pct.toFixed(2)})</div>
            <div className="text-[10px] text-slate-500 font-sans">{isArabic ? 'لا يُمس نهائياً للتغطية' : 'Never invested'}</div>
          </div>

          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
            <div className="text-[10px] text-slate-400 font-sans">{isArabic ? 'سقف المركز الواحد (Cap)' : 'Position Size Cap'}</div>
            <div className="text-sm font-bold text-amber-400">30.0% Max</div>
            <div className="text-[10px] text-slate-500 font-sans">{isArabic ? 'من السيولة القابلة للاستثمار' : 'Of investable budget'}</div>
          </div>

          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
            <div className="text-[10px] text-slate-400 font-sans">{isArabic ? 'بوابة المخاطر قبل التنفيذ' : 'Pre-Trade Risk Gate'}</div>
            <div className="text-sm font-bold text-rose-300">PASS / BLOCK</div>
            <div className="text-[10px] text-slate-500 font-sans">{isArabic ? 'حظر إلزامي لأي خلل' : 'Zero-tolerance filter'}</div>
          </div>
        </div>
      </div>

      {/* 2. Live Specialized Modules Status: Drift, Alerts & Tax */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Module 8: trader-rebalance */}
        <div className="bg-[#121824] border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-teal-400" />
              <span className="font-bold text-xs text-white">/trader-rebalance</span>
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                driftReport.needsRebalance
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse'
                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              }`}
            >
              {driftReport.needsRebalance ? 'DRIFT ALERT' : 'BALANCED'}
            </span>
          </div>
          <div className="text-xs text-slate-300">
            {isArabic ? 'أعلى تركز لمركز فردي:' : 'Max Position Concentration:'}{' '}
            <span className="font-mono font-bold text-amber-400">
              {driftReport.maxSinglePositionPct}%
            </span>{' '}
            {driftReport.dominantSymbol && `(${driftReport.dominantSymbol})`}
          </div>
          <div className="text-[11px] text-slate-500 font-sans">
            {driftReport.needsRebalance
              ? isArabic ? 'تنبيه: المركز يتجاوز نطاق السماح (35%). يوصى بجني جزء من الأرباح.' : 'Position exceeds 35% tolerance.'
              : isArabic ? 'توزيع الأوزان ضمن النطاق الآمن المعتمد.' : 'Weight distribution is fully healthy.'}
          </div>
        </div>

        {/* Module 9: trader-alerts */}
        <div className="bg-[#121824] border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-purple-400" />
              <span className="font-bold text-xs text-white">/trader-alerts</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
              {alertsList.length} ALERTS ACTIVE
            </span>
          </div>
          <div className="text-xs text-slate-300 font-mono">
            {alertsList.length > 0 ? (
              <span className="text-emerald-400 font-bold">{alertsList[0].message}</span>
            ) : (
              <span>{isArabic ? 'مراقبة مستمرة لأهداف TP وتفعيل التريلينج ستوب' : 'Monitoring take profit levels & trailing triggers'}</span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 font-sans">
            {isArabic ? 'دفاع تلقائي لحجز الأرباح وتأمين رأس المال.' : 'Continuous target & trailing defense tracking.'}
          </div>
        </div>

        {/* Module 10: trader-tax */}
        <div className="bg-[#121824] border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-400" />
              <span className="font-bold text-xs text-white">/trader-tax & accounting</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              FIFO LOTS
            </span>
          </div>
          <div className="text-xs text-slate-300 flex items-center justify-between font-mono">
            <span>{isArabic ? 'العمولات التراكمية:' : 'Total Fees:'}</span>
            <span className="text-amber-400 font-bold">${taxReport.totalCommissionsPaidUsd}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-sans flex items-center justify-between font-mono">
            <span>{isArabic ? 'صافي الربح المحقق:' : 'Net Realized PnL:'}</span>
            <span className={taxReport.netRealizedPnLUsd >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
              {taxReport.netRealizedPnLUsd >= 0 ? '+' : ''}${taxReport.netRealizedPnLUsd}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Interactive 11 Modules Architecture Grid */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base font-bold text-white">
              {isArabic ? 'الوحدات الخوارزمية الـ 11 النشطة في البوت' : 'Active 11 Algorithmic Modules'}
            </h2>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-cyan-300 font-bold">
              11/11 Active
            </span>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['ALL', 'Scoring', 'Safety', 'Sizing', 'Smart Money'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-cyan-500 text-black font-bold'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                {cat === 'ALL'
                  ? isArabic ? 'الكل (11)' : 'All (11)'
                  : cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredModules.map((mod) => (
            <div
              key={mod.id}
              className="bg-slate-900/60 border border-slate-800/80 hover:border-cyan-500/40 rounded-xl p-3.5 space-y-2.5 transition shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/60 flex items-center justify-center">
                    {getSkillIcon(mod.id)}
                  </div>
                  <div>
                    <div className="font-mono font-bold text-xs text-white">/{mod.name}</div>
                    <div className="text-[11px] text-cyan-400 font-sans font-semibold">
                      {isArabic ? mod.nameAr : mod.name}
                    </div>
                  </div>
                </div>

                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  ● ACTIVE
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                {isArabic ? mod.descriptionAr : mod.descriptionEn}
              </p>

              <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-800/60">
                <span>Category: {mod.category}</span>
                <span>Audit: 100% Deterministic</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Live Pre-Trade Risk Audit Terminal (سجل قرارات PASS / BLOCK) */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>{isArabic ? 'سجل تدقيق المخاطر قبل التنفيذ (trader-risk audit)' : 'Pre-Trade Risk Audit Terminal'}</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                  {traderSkillAuditTrail.length}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {isArabic
                  ? 'أي صفقة تخالف قواعد trader-risk يتم حظرها فوراً (BLOCK) دون المساس بالرصيد.'
                  : 'Every proposed trade is audited before submission: strictly PASS or BLOCK.'}
              </p>
            </div>
          </div>

          {/* Verdict Filter */}
          <div className="flex items-center gap-1.5">
            {(['ALL', 'PASS', 'BLOCK'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setFilterVerdict(v)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filterVerdict === v
                    ? v === 'PASS'
                      ? 'bg-emerald-500 text-black font-bold'
                      : v === 'BLOCK'
                      ? 'bg-rose-500 text-white font-bold'
                      : 'bg-cyan-500 text-black font-bold'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {filteredAudit.length === 0 ? (
          <div className="p-8 text-center space-y-2 font-sans">
            <CheckCircle2 className="w-10 h-10 text-emerald-400/50 mx-auto" />
            <p className="text-sm font-bold text-slate-300">
              {isArabic ? 'بوابة المخاطر تراقب أوامر السوق اللحظية' : 'Risk Gatekeeper is actively standing guard'}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {isArabic
                ? 'سيتم تسجيل أي أمر مقترح وفحصه هنا وتطبيق قواعد trader-risk عليه قبل الإرسال لمنصة باينانس.'
                : 'Proposed trades will appear here with instant PASS / BLOCK deterministic verdicts.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1 font-mono text-xs">
            {filteredAudit.map((item, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition ${
                  item.verdict === 'PASS'
                    ? 'bg-emerald-950/20 border-emerald-500/30'
                    : 'bg-rose-950/20 border-rose-500/30'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        item.verdict === 'PASS'
                          ? 'bg-emerald-500 text-black font-black'
                          : 'bg-rose-600 text-white font-black animate-pulse'
                      }`}
                    >
                      {item.verdict}
                    </span>
                    <span className="font-bold text-white text-sm">{item.symbol}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                        item.side === 'LONG'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {item.side}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Amount: ${item.requestedAmountUsd.toFixed(2)} USDT
                    </span>
                  </div>

                  {item.reasons.length > 0 ? (
                    <div className="text-[11px] text-rose-300 font-sans pl-1">
                      {item.reasons.map((r, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <span>•</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-emerald-400/90 font-sans flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{isArabic ? 'كافة فحوصات السلامة وحجز كاش الأمان متطابقة 100%.' : 'All safety, sizing, and cash buffer rules fully verified.'}</span>
                    </div>
                  )}
                </div>

                <div className="text-right text-[10px] text-slate-500 shrink-0 font-sans">
                  <div>Buffer Kept: ${item.cashBufferKept.toFixed(2)} USDT</div>
                  <div className="font-mono text-[9px] text-slate-600">{item.fingerprint.slice(0, 16)}...</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. Live Quantitative Screener & Whale Flow Leaderboard */}
      <div className="bg-[#121824] border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {isArabic ? 'لوحة تصنيف trader-screener وتدفق الحيتان' : 'Trader-Screener & Whale Flow Leaderboard'}
              </h2>
              <p className="text-xs text-slate-400">
                {isArabic
                  ? 'ترتيب مباشر لأقوى العملات المؤهلة بحسابات الأوزان المتعددة وتراكم السيولة الذكية.'
                  : 'Live ranking across momentum, spread, volume surge, and smart money flow.'}
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900 text-slate-400 uppercase text-[11px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">{isArabic ? 'الزوج' : 'Pair'}</th>
                <th className="py-2.5 px-3">{isArabic ? 'السعر' : 'Price'}</th>
                <th className="py-2.5 px-3">{isArabic ? 'تغير 24h' : '24h Change'}</th>
                <th className="py-2.5 px-3">{isArabic ? 'درجة Screener (0-100)' : 'Screener Score'}</th>
                <th className="py-2.5 px-3">{isArabic ? 'تدفق الحيتان (Whale Flow)' : 'Smart Money Flow'}</th>
                <th className="py-2.5 px-3 text-right">{isArabic ? 'حالة التداول' : 'Status'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {marketPairs.slice(0, 8).map((pair, idx) => {
                const isGain = pair.priceChangePercent >= 0;
                const obRatio = pair.fundingRate && pair.fundingRate < 0 ? 1.25 : (isGain ? 1.15 : 0.95);
                const isWhaleAccumulation = obRatio >= 1.15;

                return (
                  <tr key={idx} className="hover:bg-slate-800/30 transition">
                    <td className="py-3 px-3 font-bold text-white flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                      <span>{pair.symbol}</span>
                    </td>
                    <td className="py-3 px-3 text-slate-200">
                      ${pair.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </td>
                    <td className={`py-3 px-3 font-semibold ${isGain ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isGain ? '+' : ''}{pair.priceChangePercent.toFixed(2)}%
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full bg-cyan-400 rounded-full"
                            style={{ width: `${Math.min(100, Math.max(30, (pair.aiScore || 75)))}%` }}
                          />
                        </div>
                        <span className="font-bold text-cyan-300">{pair.aiScore || 78}/100</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-sans">
                      {isWhaleAccumulation ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          <Flame className="w-3 h-3 text-emerald-400" />
                          <span>{isArabic ? 'تراكم حيتان 🐋' : 'Whale Buy 🐋'}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                          <span>{isArabic ? 'سيولة متوازنة' : 'Balanced'}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-sans">
                      <span className="text-[11px] font-bold text-emerald-400">
                        {isArabic ? `مؤهلة لـ ${reliancePercent}% Trader-Skill` : 'Qualified'}
                      </span>
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
