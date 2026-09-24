import React, { useMemo } from 'react';
import { useTrading } from '../context/TradingContext';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  DollarSign,
  HelpCircle,
  Info,
  Lock,
  Percent,
  PieChart,
  Scale,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Unlock,
  Zap,
} from 'lucide-react';

interface GlobalRiskExposureGaugeProps {
  compact?: boolean;
}

export const GlobalRiskExposureGauge: React.FC<GlobalRiskExposureGaugeProps> = ({ compact = false }) => {
  const { balance, positions, settings, closeAllPositions, language } = useTrading();
  const isArabic = language === 'ar';

  // 1. Calculate Core Margin & Capital Metrics
  const metrics = useMemo(() => {
    // Total Equity (totalMarginBalance = wallet balance + unrealized PnL)
    const totalEquity = Math.max(1, balance.totalMarginBalance);

    // Initial Margin locked in active positions (collateral committed)
    const lockedMargin = positions.reduce((acc, p) => acc + p.amountUsd, 0);

    // Free Margin available for new trades
    const freeMargin = Math.max(0, balance.availableBalance);

    // Total Leveraged Notional Exposure (aggregate face value of contracts)
    const notionalExposure = positions.reduce(
      (acc, p) => acc + p.amountUsd * p.leverage,
      0
    );

    // Locked Capital Percentage (0% to 100%)
    const lockedPercentage = Math.min(
      100,
      Math.max(0, Number(((lockedMargin / totalEquity) * 100).toFixed(1)))
    );

    // Free Margin Percentage
    const freePercentage = Math.max(0, Number((100 - lockedPercentage).toFixed(1)));

    // Effective Account Gearing (Notional Exposure / Equity)
    const effectiveLeverage = Number((notionalExposure / totalEquity).toFixed(1));

    // Risk Level Classification
    let riskLevel: 'SAFE' | 'BALANCED' | 'ELEVATED' | 'CRITICAL' = 'SAFE';
    let riskColor = '#10b981'; // emerald-500
    let riskBg = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    let riskLabel = isArabic ? 'مستوى مخاطرة آمن' : 'Safe Exposure';
    let riskDescription = isArabic
      ? 'هامش أمان ممتاز مع سيولة حرة كافية لحماية المحفظة من تقلبات السوق المفاجئة.'
      : 'Optimal capital protection with substantial free margin cushion against market volatility.';

    if (lockedPercentage > 75) {
      riskLevel = 'CRITICAL';
      riskColor = '#f43f5e'; // rose-500
      riskBg = 'bg-rose-500/15 text-rose-400 border-rose-500/30';
      riskLabel = isArabic ? 'مستوى حرج (خطر التصفية)' : 'Critical Overexposure';
      riskDescription = isArabic
        ? 'تحذير شديد: رأس المال مستنزف بنسبة تفوق 75%! أي هبوط طفيف قد يؤدي لنقص الهامش والتصفية (Margin Call).'
        : 'High Margin Call Threat! Over 75% of capital is locked. High risk of liquidation on sharp counter-moves.';
    } else if (lockedPercentage > 50) {
      riskLevel = 'ELEVATED';
      riskColor = '#f59e0b'; // amber-500
      riskBg = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      riskLabel = isArabic ? 'مستوى مرتفع (حذر)' : 'Elevated Exposure';
      riskDescription = isArabic
        ? 'استهلاك أكثر من نصف رأس المال في صفقات نشطة. يُنصح بعدم فتح صفقات إضافية وتفعيل وقف الخسارة.'
        : 'More than 50% of margin committed. Recommended to pause new entries and monitor stop-losses closely.';
    } else if (lockedPercentage > 25) {
      riskLevel = 'BALANCED';
      riskColor = '#06b6d4'; // cyan-500
      riskBg = 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
      riskLabel = isArabic ? 'مستوى معتدل ومدروس' : 'Moderate & Balanced';
      riskDescription = isArabic
        ? 'توزيع استثماري نشط مع الاحتفاظ بنصف رأس المال كصمام أمان حر لتغطية تقلبات التداول.'
        : 'Balanced capital deployment with plenty of free margin for flexible position management.';
    }

    return {
      totalEquity,
      lockedMargin,
      freeMargin,
      notionalExposure,
      lockedPercentage,
      freePercentage,
      effectiveLeverage,
      riskLevel,
      riskColor,
      riskBg,
      riskLabel,
      riskDescription,
    };
  }, [balance, positions, isArabic]);

  // Gauge needle angle (-90 deg at 0% to +90 deg at 100%)
  const needleRotation = -90 + (metrics.lockedPercentage / 100) * 180;

  // Arc length calculations for semi-circle SVG (radius = 75, circumference = 235.6)
  const radius = 75;
  const arcLength = Math.PI * radius; // ~235.6
  const strokeDashoffset = arcLength - (metrics.lockedPercentage / 100) * arcLength;

  return (
    <div className="bg-[#121824] border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-xl relative overflow-hidden">
      {/* Background glow corresponding to risk level */}
      <div
        className="absolute -top-24 -right-24 w-60 h-60 rounded-full blur-3xl opacity-15 pointer-events-none transition-colors duration-700"
        style={{ backgroundColor: metrics.riskColor }}
      />

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center border transition-colors duration-300"
            style={{
              backgroundColor: `${metrics.riskColor}15`,
              borderColor: `${metrics.riskColor}30`,
              color: metrics.riskColor,
            }}
          >
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>{isArabic ? 'مقياس التعرض للمخاطر العامة' : 'Global Risk Exposure Gauge'}</span>
              </h3>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${metrics.riskBg}`}>
                {metrics.riskLabel}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {isArabic
                ? 'نسبة رأس المال المحجوز في الصفقات النشطة مقابل الهامش الحر لحماية المحفظة'
                : 'Ratio of active locked capital vs free available margin to prevent liquidation'}
            </p>
          </div>
        </div>

        {/* Quick Safety Indicator */}
        <div className="flex items-center gap-2 self-start sm:self-center">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-400">{isArabic ? 'الرافعة الفعالة:' : 'Effective Gearing:'}</span>
            <span className="font-mono font-bold text-white">{metrics.effectiveLeverage}x</span>
          </div>

          {metrics.lockedPercentage > 70 && positions.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm(isArabic ? 'هل تريد إغلاق الصفقات لتقليل المخاطر فوراً؟' : 'Close positions to immediately reduce risk exposure?')) {
                  closeAllPositions();
                }
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-bold transition animate-pulse"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{isArabic ? 'تقليص المخاطر فوراً' : 'De-Risk Now'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Visual Display: Dial Gauge + KPI Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
        {/* Semi-Circular SVG Speedometer Gauge (5 Columns on Desktop) */}
        <div className="md:col-span-5 flex flex-col items-center justify-center p-3 bg-slate-900/50 border border-slate-800/80 rounded-xl relative">
          <div className="relative w-56 h-32 flex items-end justify-center overflow-visible">
            <svg viewBox="0 0 200 115" className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="35%" stopColor="#06b6d4" />
                  <stop offset="70%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#f43f5e" />
                </linearGradient>

                <filter id="gaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Background Track Arc (Semi-circle from 15,100 to 185,100) */}
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="#1e293b"
                strokeWidth="14"
                strokeLinecap="round"
              />

              {/* Dynamic Progress Arc */}
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="url(#gaugeGradient)"
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray="251.3"
                strokeDashoffset={251.3 - (metrics.lockedPercentage / 100) * 251.3}
                style={{
                  transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                filter="url(#gaugeGlow)"
              />

              {/* Gauge Scale Labels */}
              <text x="20" y="112" fill="#64748b" fontSize="8" fontWeight="bold" textAnchor="middle">0%</text>
              <text x="60" y="42" fill="#64748b" fontSize="8" fontWeight="bold" textAnchor="middle">25%</text>
              <text x="100" y="16" fill="#64748b" fontSize="8" fontWeight="bold" textAnchor="middle">50%</text>
              <text x="140" y="42" fill="#64748b" fontSize="8" fontWeight="bold" textAnchor="middle">75%</text>
              <text x="180" y="112" fill="#64748b" fontSize="8" fontWeight="bold" textAnchor="middle">100%</text>

              {/* Pointer Needle */}
              <g
                transform={`rotate(${needleRotation}, 100, 100)`}
                style={{
                  transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  transformOrigin: '100px 100px',
                }}
              >
                <line
                  x1="100"
                  y1="100"
                  x2="100"
                  y2="28"
                  stroke="#ffffff"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <circle cx="100" cy="26" r="3.5" fill={metrics.riskColor} />
              </g>

              {/* Center Pivot Point */}
              <circle cx="100" cy="100" r="8" fill="#0f172a" stroke="#475569" strokeWidth="2.5" />
              <circle cx="100" cy="100" r="3.5" fill={metrics.riskColor} />
            </svg>
          </div>

          {/* Central Live Metric Readout */}
          <div className="text-center mt-1">
            <div className="flex items-baseline justify-center gap-1">
              <span
                className="text-3xl font-black font-mono tracking-tight transition-colors duration-500"
                style={{ color: metrics.riskColor }}
              >
                {metrics.lockedPercentage}%
              </span>
              <span className="text-xs font-semibold text-slate-400">
                {isArabic ? 'رأس مال محجوز' : 'Locked Capital'}
              </span>
            </div>
            <div className="text-[11px] font-medium text-slate-400 mt-0.5">
              {isArabic ? 'الهامش الحر المتبقي:' : 'Remaining Free Margin:'}{' '}
              <span className="text-emerald-400 font-mono font-bold">{metrics.freePercentage}%</span>
            </div>
          </div>
        </div>

        {/* Detailed Risk Breakdown & Balances (7 Columns on Desktop) */}
        <div className="md:col-span-7 space-y-3">
          {/* Capital Allocation & Protected Reserve Badge */}
          {settings.enableCapitalLimit && (settings.maxAllocatedCapitalUsd ?? 0) > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300">
              <div className="flex items-center gap-1.5 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>
                  {isArabic
                    ? `سقف البوت النشط: $${(settings.maxAllocatedCapitalUsd ?? 5).toFixed(2)} USDT`
                    : `Active Bot Capital Cap: $${(settings.maxAllocatedCapitalUsd ?? 5).toFixed(2)} USDT`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs">
                <span className="text-slate-400 text-[10px]">
                  {isArabic ? 'الرصيد المحمي المحجوز:' : 'Protected Reserve:'}
                </span>
                <span className="text-cyan-300 font-bold bg-slate-950/80 px-2 py-0.5 rounded border border-cyan-500/30">
                  ${Math.max(0, balance.totalWalletBalance - (settings.maxAllocatedCapitalUsd ?? 5)).toFixed(2)} USDT
                </span>
              </div>
            </div>
          )}

          {/* Comparative Progress Bar */}
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-3">
            <div className="flex items-center justify-between text-xs mb-2">
              <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>{isArabic ? 'رأس المال المحجوز (Locked)' : 'Locked Capital'}</span>
                <span className="font-mono text-amber-400 font-bold">
                  ${metrics.lockedMargin.toFixed(2)} ({metrics.lockedPercentage}%)
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isArabic ? 'الهامش الحر (Free)' : 'Free Margin'}</span>
                <span className="font-mono text-emerald-400 font-bold">
                  ${metrics.freeMargin.toFixed(2)} ({metrics.freePercentage}%)
                </span>
              </div>
            </div>

            {/* Split Bar */}
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden flex p-0.5 gap-0.5">
              <div
                className="h-full rounded-l-full transition-all duration-700 relative"
                style={{
                  width: `${Math.max(2, metrics.lockedPercentage)}%`,
                  backgroundColor: metrics.riskColor,
                }}
              />
              <div
                className="h-full bg-emerald-500/80 rounded-r-full transition-all duration-700"
                style={{
                  width: `${Math.max(2, metrics.freePercentage)}%`,
                }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1 font-mono">
              <span>{isArabic ? 'الصفقات المفتوحة:' : 'Active Positions:'} {positions.length} / {settings.maxConcurrentPositions}</span>
              <span>{isArabic ? 'إجمالي حقوق الملكية:' : 'Total Equity:'} ${metrics.totalEquity.toFixed(2)}</span>
            </div>
          </div>

          {/* Key Metric Highlights Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {/* 1. Locked Margin */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5">
              <div className="text-[10px] text-slate-400 flex items-center justify-between mb-0.5">
                <span>{isArabic ? 'الهامش المحجوز' : 'Locked Collateral'}</span>
                <Lock className="w-3 h-3 text-amber-400" />
              </div>
              <div className="text-sm font-bold font-mono text-amber-400">
                ${metrics.lockedMargin.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {metrics.lockedPercentage}% {isArabic ? 'من المحفظة' : 'of Equity'}
              </div>
            </div>

            {/* 2. Free Available Margin */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5">
              <div className="text-[10px] text-slate-400 flex items-center justify-between mb-0.5">
                <span>{isArabic ? 'الهامش المتاح الحر' : 'Free Available Margin'}</span>
                <Unlock className="w-3 h-3 text-emerald-400" />
              </div>
              <div className="text-sm font-bold font-mono text-emerald-400">
                ${metrics.freeMargin.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {metrics.freePercentage}% {isArabic ? 'سيولة أمان' : 'Available Buffer'}
              </div>
            </div>

            {/* 3. Leveraged Market Value */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5 col-span-2 sm:col-span-1">
              <div className="text-[10px] text-slate-400 flex items-center justify-between mb-0.5">
                <span>{isArabic ? 'القيمة السوقية للصفقات' : 'Notional Value'}</span>
                <TrendingUp className="w-3 h-3 text-cyan-400" />
              </div>
              <div className="text-sm font-bold font-mono text-cyan-400">
                ${metrics.notionalExposure.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {metrics.effectiveLeverage}x {isArabic ? 'قوة التداول' : 'Leverage Factor'}
              </div>
            </div>
          </div>

          {/* Dynamic AI Risk Advice */}
          <div
            className="rounded-xl p-2.5 border text-xs flex items-start gap-2.5 transition-colors duration-300"
            style={{
              backgroundColor: `${metrics.riskColor}10`,
              borderColor: `${metrics.riskColor}25`,
            }}
          >
            {metrics.lockedPercentage > 75 ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            ) : metrics.lockedPercentage > 50 ? (
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="text-slate-200 leading-relaxed text-[11px] sm:text-xs">
                {metrics.riskDescription}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
