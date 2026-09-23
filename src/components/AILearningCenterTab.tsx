import React from 'react';
import { useTrading } from '../context/TradingContext';
import {
  Activity,
  Award,
  Brain,
  CheckCircle2,
  Cpu,
  Flame,
  LineChart,
  RefreshCw,
  Sparkles,
  Zap,
} from 'lucide-react';
import { MarketVolatilityAnalysisPanel } from './MarketVolatilityAnalysisPanel';

export const AILearningCenterTab: React.FC = () => {
  const { aiState, t, language } = useTrading();
  const isArabic = language === 'ar';

  const weightsList = [
    { label: t.volatilityWeight, value: aiState.weights.volatilityBreakout, color: 'bg-emerald-500' },
    { label: t.volumeSurgeWeight, value: aiState.weights.volumeSurge, color: 'bg-amber-500' },
    { label: t.rsiMomentumWeight, value: aiState.weights.rsiMomentum, color: 'bg-cyan-500' },
    { label: t.trendAlignmentWeight, value: aiState.weights.trendAlignment, color: 'bg-indigo-500' },
    { label: t.orderbookWeight, value: aiState.weights.orderbookImbalance, color: 'bg-purple-500' },
  ];

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="bg-gradient-to-r from-indigo-950/50 via-slate-900 to-amber-950/40 border border-indigo-500/30 rounded-2xl p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <Brain className="w-7 h-7 animate-pulse text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-white">
                  {t.aiLearningTitle}
                </h2>
                <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  24/7 ACTIVE LEARNING
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                {t.aiLearningDesc}
              </p>
            </div>
          </div>
        </div>

        {/* 3 Metric Pills */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <div className="text-slate-400 text-xs flex items-center justify-between mb-1">
              <span>{t.trainingGeneration}</span>
              <Cpu className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-white">
              Gen #{aiState.trainingGeneration}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Continuous weight adaptation
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <div className="text-slate-400 text-xs flex items-center justify-between mb-1">
              <span>{t.trainingIterations}</span>
              <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
            </div>
            <div className="text-2xl font-bold font-mono text-cyan-400">
              {aiState.trainingIterations.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Backprop & Reinforcement cycles
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <div className="text-slate-400 text-xs flex items-center justify-between mb-1">
              <span>{t.modelAccuracy}</span>
              <Award className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-amber-400">
              {aiState.accuracyRate}%
            </div>
            <div className="text-[10px] text-emerald-400 mt-0.5 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>{isArabic ? 'محسّنة بناءً على نتائج الصفقات' : 'Tuned by trade outcomes'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Market Volatility Analysis & Breakout Justification Panel */}
      <MarketVolatilityAnalysisPanel />

      {/* Grid: Neural Weights + Live Decision Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Dynamic Weights Visualizer */}
        <div className="bg-[#121824] border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-white text-sm">
                {t.neuralWeights}
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Normalized Weights (Sum: 1.0)
            </span>
          </div>

          <div className="space-y-4">
            {weightsList.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300 font-medium">{item.label}</span>
                  <span className="font-mono font-bold text-white">
                    {(item.value * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${item.color}`}
                    style={{ width: `${Math.min(100, item.value * 100 * 2.5)}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          {/* AI Architecture Note */}
          <div className="mt-5 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 leading-relaxed font-sans">
            <span className="font-bold text-slate-200">
              {isArabic ? '💡 كيف يعمل التعلم الذاتي 24/7؟' : '💡 How 24/7 Self-Learning Operates:'}
            </span>{' '}
            {isArabic
              ? 'يقوم البوت تلقائياً بحساب دالة المكافأة (Reward Function) بعد كل صفقة رابحة لتعزيز إشارات الزخم، بينما يُفعّل مرشحات تقليل المخاطر الوقائية عند وصول أي صفقة لوقف الخسارة دون الحاجة لأي تدخل منك.'
              : 'The bot continuously computes a reinforcement reward function upon winning trades to strengthen successful indicators, while auto-tightening defense parameters when stop-losses are triggered.'}
          </div>
        </div>

        {/* Real-time Training Feed */}
        <div className="bg-[#121824] border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-cyan-400" />
              <h3 className="font-bold text-white text-sm">
                {t.aiDecisionLog}
              </h3>
            </div>
            <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Live Feed
            </span>
          </div>

          <div className="space-y-2.5 overflow-y-auto max-h-[340px] pr-1">
            {aiState.recentLogs.map((log) => (
              <div
                key={log.id}
                className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 hover:border-slate-700 transition text-xs font-mono"
              >
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        log.outcome === 'WIN'
                          ? 'bg-emerald-400'
                          : log.outcome === 'LOSS'
                          ? 'bg-rose-400'
                          : 'bg-cyan-400'
                      }`}
                    ></span>
                    <span className="font-bold text-white">{log.symbol}</span>
                    <span className="text-slate-500">[{log.action}]</span>
                  </div>
                  <span className="text-slate-500 text-[10px]">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-slate-300 font-sans text-[11px] leading-relaxed">
                  {log.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
