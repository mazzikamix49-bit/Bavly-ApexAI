import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTrading } from '../context/TradingContext';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  DollarSign,
  Flame,
  Info,
  Layers,
  Maximize2,
  PieChart,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';

export const EquityChart: React.FC = () => {
  const { balance, closedTrades, positions, t, language } = useTrading();
  const [chartType, setChartType] = useState<'equity' | 'pnl'>('equity');
  const [showSmartMarkers, setShowSmartMarkers] = useState<boolean>(true);
  const isArabic = language === 'ar';

  // Build sequential data points for equity and trade-by-trade PnL with Smart Trailing markers
  const chartData = useMemo(() => {
    // Sort closed trades chronologically
    const sortedTrades = [...closedTrades].sort((a, b) => a.closedAt - b.closedAt);

    // Initial base equity
    const baseInitial = 1000.0;
    let runningEquity = baseInitial;

    const points = [
      {
        index: 0,
        time: isArabic ? 'البداية' : 'Start',
        equity: baseInitial,
        pnl: 0,
        symbol: 'BASE',
        win: true,
        isSmartTrailing: false,
        trailingType: null as 'BREAKEVEN' | 'TP1_LOCKED' | 'TP2_LOCKED' | null,
        trailingTitle: '',
        trailingDetail: '',
      },
    ];

    sortedTrades.forEach((tr, i) => {
      runningEquity += tr.pnl;
      const dateStr = new Date(tr.closedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      const isSmartTrailing = tr.exitReason === 'TRAILING_STOP';
      const tpLevel =
        tr.tpLevelReached ||
        (isSmartTrailing
          ? Math.abs(tr.pnl) < 1.0
            ? 1
            : tr.pnlPercentage < 4.0
            ? 2
            : 3
          : 0);

      let trailingType: 'BREAKEVEN' | 'TP1_LOCKED' | 'TP2_LOCKED' | null = null;
      let trailingTitle = '';
      let trailingDetail = '';

      if (isSmartTrailing || tpLevel >= 1) {
        if (tpLevel === 1 || Math.abs(tr.pnl) < 1.0) {
          trailingType = 'BREAKEVEN';
          trailingTitle = isArabic
            ? 'نقل وقف الخسارة لسعر الدخول (Breakeven)'
            : 'Stop-Loss to Entry (Breakeven Secured)';
          trailingDetail = isArabic
            ? `عند تحقيق الهدف الأول (TP1)، تم نقل الوقف آلياً إلى سعر الدخول ($${tr.entryPrice}) لتأمين رأس المال وتصفير المخاطرة بالكامل.`
            : `Upon hitting Target 1, Stop-Loss automatically shifted to entry ($${tr.entryPrice}) for guaranteed zero-risk.`;
        } else if (tpLevel === 2 || tr.pnlPercentage < 4.0) {
          trailingType = 'TP1_LOCKED';
          trailingTitle = isArabic
            ? 'حجز أرباح الهدف الأول (TP1 Trailed)'
            : 'Target 1 Profit Locked (TP1 Trailed)';
          trailingDetail = isArabic
            ? `عند تحقيق الهدف الثاني (TP2)، تم رفع وقف الخسارة لمستوى TP1 وحجز أرباح مؤكدة قدرها +$${tr.pnl.toFixed(2)}.`
            : `Upon hitting Target 2, Stop-Loss trailed to Target 1 level, locking in +$${tr.pnl.toFixed(2)} profit.`;
        } else {
          trailingType = 'TP2_LOCKED';
          trailingTitle = isArabic
            ? 'حجز أرباح الهدف الثاني (TP2 Trailed)'
            : 'Target 2 Profit Locked (TP2 Trailed)';
          trailingDetail = isArabic
            ? `عند تحقيق الهدف الثالث (TP3)، تم رفع وقف الخسارة لمستوى TP2 وتأمين أعلى ربح محقق (+${tr.pnlPercentage.toFixed(1)}%).`
            : `Upon hitting Target 3, Stop-Loss trailed to Target 2 level, locking in maximum gains (+${tr.pnlPercentage.toFixed(1)}%).`;
        }
      }

      points.push({
        index: i + 1,
        time: `${tr.symbol} (${dateStr})`,
        equity: Number(runningEquity.toFixed(2)),
        pnl: Number(tr.pnl.toFixed(2)),
        symbol: tr.symbol,
        win: tr.pnl >= 0,
        isSmartTrailing,
        trailingType,
        trailingTitle,
        trailingDetail,
      });
    });

    // Add current live point with active positions unrealized PnL
    const liveUnrealized = positions.reduce((acc, p) => acc + p.unrealizedProfit, 0);
    const currentLiveEquity = Number((runningEquity + liveUnrealized).toFixed(2));

    points.push({
      index: points.length,
      time: isArabic ? 'الآن (مباشر)' : 'Now (Live)',
      equity: currentLiveEquity,
      pnl: Number(liveUnrealized.toFixed(2)),
      symbol: isArabic ? 'صفقات نشطة' : 'Active Open',
      win: liveUnrealized >= 0,
      isSmartTrailing: false,
      trailingType: null,
      trailingTitle: '',
      trailingDetail: '',
    });

    return points;
  }, [closedTrades, positions, isArabic]);

  // Key performance calculations for chart header
  const initialEquity = chartData[0]?.equity || 1000;
  const currentEquity = chartData[chartData.length - 1]?.equity || 1000;
  const netGrowth = Number((currentEquity - initialEquity).toFixed(2));
  const netGrowthPercent = Number(((netGrowth / initialEquity) * 100).toFixed(2));
  const peakEquity = Math.max(...chartData.map((d) => d.equity));
  const smartTrailingPoints = chartData.filter((d) => d.isSmartTrailing);

  return (
    <div className="bg-[#121824] border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
      {/* Chart Top Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white">
                {isArabic ? 'مخطط نمو رأس المال وإشارات الخروج الذكي' : 'Equity Trajectory & Smart Trailing Markers'}
              </h3>
              <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                LIVE RECHARTS
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {isArabic
                ? 'رسم بياني تفاعلي يوضح تدرج نمو المحفظة ونقاط تفعيل الوقف المتحرك وحجز الأرباح بشفافية كاملة'
                : 'Real-time equity curve highlighting where Smart Trailing moved Stop-Loss to Breakeven or locked profit targets'}
            </p>
          </div>
        </div>

        {/* Action Controls: Smart Trailing Markers Toggle + View Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Smart Trailing Markers Toggle Button */}
          <button
            onClick={() => setShowSmartMarkers(!showSmartMarkers)}
            className={`px-3 py-1.5 rounded-xl border transition text-xs font-semibold flex items-center gap-1.5 ${
              showSmartMarkers
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm shadow-emerald-950'
                : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title={
              isArabic
                ? 'إظهار / إخفاء علامات الخروج بالوقف المتحرك الذكي'
                : 'Toggle Smart Trailing Exit markers on chart'
            }
          >
            <ShieldCheck className={`w-4 h-4 ${showSmartMarkers ? 'text-emerald-400' : 'text-slate-400'}`} />
            <span>{isArabic ? 'علامات الوقف الذكي' : 'Smart Trailing Markers'}</span>
            <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/30 text-emerald-300 font-mono text-[10px] font-bold">
              {smartTrailingPoints.length}
            </span>
          </button>

          {/* View Switcher: Equity vs Trade PnL */}
          <div className="flex items-center rounded-xl bg-slate-900 border border-slate-800 p-1 text-xs">
            <button
              onClick={() => setChartType('equity')}
              className={`px-3 py-1.5 rounded-lg transition font-medium flex items-center gap-1.5 ${
                chartType === 'equity'
                  ? 'bg-cyan-500 text-black font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>{isArabic ? 'منحنى الرصيد' : 'Equity'}</span>
            </button>
            <button
              onClick={() => setChartType('pnl')}
              className={`px-3 py-1.5 rounded-lg transition font-medium flex items-center gap-1.5 ${
                chartType === 'pnl'
                  ? 'bg-amber-500 text-black font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>{isArabic ? 'عائد الصفقات' : 'PnL'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Summary KPI Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5">
          <div className="text-[10px] text-slate-400 mb-0.5">
            {isArabic ? 'إجمالي نمو المحفظة' : 'Total Equity Growth'}
          </div>
          <div
            className={`text-base font-bold font-mono ${
              netGrowth >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {netGrowth >= 0 ? '+' : ''}${netGrowth} ({netGrowth >= 0 ? '+' : ''}{netGrowthPercent}%)
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5">
          <div className="text-[10px] text-slate-400 mb-0.5">
            {isArabic ? 'أعلى قمة وصل لها الرصيد' : 'Peak Equity'}
          </div>
          <div className="text-base font-bold font-mono text-cyan-400">
            ${peakEquity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5">
          <div className="text-[10px] text-slate-400 mb-0.5">
            {isArabic ? 'حماية الوقف الذكي المفعلة' : 'Smart Trailing Protections'}
          </div>
          <div className="text-base font-bold font-mono text-emerald-400 flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{smartTrailingPoints.length} {isArabic ? 'صفقة مؤمنة' : 'Protected'}</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5">
          <div className="text-[10px] text-slate-400 mb-0.5">
            {isArabic ? 'الرصيد المباشر الحالي' : 'Current Live Equity'}
          </div>
          <div className="text-base font-bold font-mono text-white">
            ${currentEquity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-64 sm:h-72 w-full pt-1">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'equity' ? (
            <AreaChart data={chartData} margin={{ top: 15, right: 15, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="equityStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="50%" stopColor="#06b6d4" />
                  <stop offset="100%" stopColor="#38bdf8" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="#64748b"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
              />
              <YAxis
                stroke="#64748b"
                fontSize={10}
                domain={['auto', 'auto']}
                tickFormatter={(val) => `$${Math.round(val)}`}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-[#0f141f] border border-cyan-500/40 rounded-xl p-3 shadow-2xl text-xs font-mono max-w-[280px]">
                        <div className="text-slate-400 text-[10px] mb-1">{data.time}</div>
                        <div className="font-bold text-white text-sm">
                          ${data.equity?.toLocaleString()}
                        </div>
                        {data.pnl !== 0 && (
                          <div
                            className={`text-[11px] font-bold mt-0.5 ${
                              data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            PnL: {data.pnl >= 0 ? '+' : ''}${data.pnl}
                          </div>
                        )}

                        {/* Smart Trailing Exit Callout in Tooltip */}
                        {data.isSmartTrailing && (
                          <div className="mt-2.5 p-2 rounded-lg bg-emerald-950/80 border border-emerald-500/50 space-y-1">
                            <div className="flex items-center gap-1.5 font-bold text-emerald-300 text-[11px]">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span>{data.trailingTitle}</span>
                            </div>
                            <div className="text-[10px] text-slate-300 font-sans leading-tight">
                              {data.trailingDetail}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine y={initialEquity} stroke="#475569" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="url(#equityStroke)"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#equityGrad)"
                dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  if (!showSmartMarkers || !payload?.isSmartTrailing) return null;

                  const isBreakeven = payload.trailingType === 'BREAKEVEN';
                  const isTp1 = payload.trailingType === 'TP1_LOCKED';
                  const strokeColor = isBreakeven ? '#38bdf8' : isTp1 ? '#10b981' : '#f59e0b';
                  const fillColor = isBreakeven ? '#0284c7' : isTp1 ? '#059669' : '#d97706';

                  return (
                    <g key={`marker-${payload.index}`} className="cursor-pointer">
                      {/* Pulsing Outer Glow */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={9}
                        fill={strokeColor}
                        fillOpacity={0.3}
                        stroke={strokeColor}
                        strokeWidth={1.5}
                      />
                      {/* Solid Center Core */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={4}
                        fill={fillColor}
                        stroke="#ffffff"
                        strokeWidth={1.5}
                      />
                    </g>
                  );
                }}
              />
            </AreaChart>
          ) : (
            <BarChart data={chartData.filter((d) => d.index > 0)} margin={{ top: 15, right: 15, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="#64748b"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
              />
              <YAxis
                stroke="#64748b"
                fontSize={10}
                tickFormatter={(val) => `$${val}`}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    const isPositive = data.pnl >= 0;
                    return (
                      <div className="bg-[#0f141f] border border-slate-700 rounded-xl p-3 shadow-xl text-xs font-mono max-w-[280px]">
                        <div className="text-slate-400 text-[10px] mb-1">{data.time}</div>
                        <div
                          className={`font-bold text-sm ${
                            isPositive ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isPositive ? '+' : ''}${data.pnl}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {data.symbol}
                        </div>

                        {data.isSmartTrailing && (
                          <div className="mt-2.5 p-2 rounded-lg bg-emerald-950/80 border border-emerald-500/50 space-y-1">
                            <div className="flex items-center gap-1.5 font-bold text-emerald-300 text-[11px]">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span>{data.trailingTitle}</span>
                            </div>
                            <div className="text-[10px] text-slate-300 font-sans leading-tight">
                              {data.trailingDetail}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine y={0} stroke="#475569" />
              <Bar
                dataKey="pnl"
                shape={(props: any) => {
                  const { x, y, width, height, value, payload } = props;
                  const isPositive = value >= 0;
                  const isTrailing = payload?.isSmartTrailing;
                  return (
                    <g key={`bar-${x}-${y}`}>
                      <rect
                        x={x}
                        y={isPositive ? y : y}
                        width={width}
                        height={Math.max(2, Math.abs(height))}
                        fill={isTrailing ? '#10b981' : isPositive ? '#06b6d4' : '#f43f5e'}
                        stroke={isTrailing ? '#38bdf8' : 'none'}
                        strokeWidth={isTrailing ? 1.5 : 0}
                        rx={3}
                      />
                    </g>
                  );
                }}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Transparent Explanatory Legend for Smart Trailing Levels */}
      <div className="pt-2 border-t border-slate-800/60 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
          <span className="w-3 h-3 rounded-full bg-cyan-400 ring-2 ring-cyan-400/30 shrink-0"></span>
          <div>
            <div className="font-bold text-cyan-300 text-[11px]">
              {isArabic ? '🛡️ نقطة الدخول (Breakeven)' : '🛡️ Entry (Breakeven)'}
            </div>
            <div className="text-[10px] text-slate-400 leading-tight font-sans">
              {isArabic ? 'نقل الوقف لسعر الدخول فور تحقيق TP1' : 'SL moved to entry at Target 1'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
          <span className="w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-emerald-400/30 shrink-0"></span>
          <div>
            <div className="font-bold text-emerald-300 text-[11px]">
              {isArabic ? '🔥 حجز أرباح الهدف الأول (TP1)' : '🔥 Target 1 Locked'}
            </div>
            <div className="text-[10px] text-slate-400 leading-tight font-sans">
              {isArabic ? 'رفع الوقف لمستوى TP1 عند وصول TP2' : 'SL trailed to TP1 level at Target 2'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
          <span className="w-3 h-3 rounded-full bg-amber-400 ring-2 ring-amber-400/30 shrink-0"></span>
          <div>
            <div className="font-bold text-amber-300 text-[11px]">
              {isArabic ? '🏆 حجز أرباح الهدف الثاني (TP2)' : '🏆 Target 2 Locked'}
            </div>
            <div className="text-[10px] text-slate-400 leading-tight font-sans">
              {isArabic ? 'رفع الوقف لمستوى TP2 لتحقيق أعلى عائد' : 'SL trailed to TP2 level at Target 3'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

