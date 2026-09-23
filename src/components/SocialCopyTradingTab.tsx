import React, { useState } from 'react';
import { useTrading } from '../context/TradingContext';
import {
  Award,
  Check,
  Flame,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { CopyTradingMaster } from '../types/trading';

const MASTER_TRADERS: CopyTradingMaster[] = [
  {
    id: 'master-1',
    name: 'Satoshi Momentum Alpha',
    tagline: 'High-frequency 15m scalp bot utilizing volume breakouts and orderbook absorption',
    avatar: '⚡',
    roi30d: 148.6,
    winRate: 91.4,
    totalTrades: 428,
    maxDrawdown: 4.2,
    copiersCount: 3840,
    riskScore: 'Low',
    strategyDescription: 'Focuses on high-liquidity Binance Futures pairs (BTC, ETH, SOL) with dynamic trailing stop-loss protection.',
    preferredPairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  },
  {
    id: 'master-2',
    name: 'Titan Neural Scalper',
    tagline: 'Multi-pair AI breakout algorithm hunting micro-divergences',
    avatar: '🧠',
    roi30d: 112.4,
    winRate: 88.9,
    totalTrades: 614,
    maxDrawdown: 5.8,
    copiersCount: 2490,
    riskScore: 'Medium',
    strategyDescription: 'Scans all Binance USDT-M pairs. Trades rapid 15m-1h momentum bursts with 20x leverage.',
    preferredPairs: ['PEPEUSDT', 'DOGEUSDT', 'NEARUSDT', 'SUIUSDT'],
  },
  {
    id: 'master-3',
    name: 'Quantum Reversal Quant',
    tagline: 'Mean reversion strategy exploiting extreme RSI conditions and liquidity sweeps',
    avatar: '💎',
    roi30d: 89.2,
    winRate: 86.5,
    totalTrades: 312,
    maxDrawdown: 3.5,
    copiersCount: 1820,
    riskScore: 'Low',
    strategyDescription: 'Strict capital preservation model with 1.1% stop loss and 2.5% take profit.',
    preferredPairs: ['BTCUSDT', 'BNBUSDT', 'XRPUSDT'],
  },
];

export const SocialCopyTradingTab: React.FC = () => {
  const { t, language, updateSettings } = useTrading();
  const [copiedId, setCopiedId] = useState<string | null>('master-1');
  const isArabic = language === 'ar';

  const handleCopy = (master: CopyTradingMaster) => {
    setCopiedId(master.id);
    // Automatically apply ideal master risk parameters to user's bot settings
    if (master.id === 'master-1') {
      updateSettings({
        leverage: 20,
        takeProfitPercent: 2.4,
        stopLossPercent: 1.1,
        maxTradeDurationHours: 1,
        useTrailingStop: true,
      });
    } else if (master.id === 'master-2') {
      updateSettings({
        leverage: 25,
        takeProfitPercent: 3.0,
        stopLossPercent: 1.2,
        maxTradeDurationHours: 0.25,
        useTrailingStop: true,
      });
    } else {
      updateSettings({
        leverage: 15,
        takeProfitPercent: 2.0,
        stopLossPercent: 1.0,
        maxTradeDurationHours: 4,
        useTrailingStop: true,
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#121824] border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-bold text-white">
            {t.copyTradingTitle}
          </h2>
        </div>
        <p className="text-xs text-slate-400">
          {t.copyTradingDesc}
        </p>
      </div>

      {/* Grid of Master Traders */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {MASTER_TRADERS.map((master) => {
          const isCopied = copiedId === master.id;

          return (
            <div
              key={master.id}
              className={`bg-[#121824] border rounded-2xl p-4 sm:p-5 transition shadow-lg flex flex-col justify-between ${
                isCopied
                  ? 'border-emerald-500/50 ring-1 ring-emerald-500/20 shadow-emerald-500/5'
                  : 'border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div>
                {/* Master Info */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-xl shadow">
                      {master.avatar}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">
                        {master.name}
                      </h3>
                      <div className="flex items-center gap-1 text-[11px] text-slate-400">
                        <Users className="w-3 h-3 text-slate-500" />
                        <span>{master.copiersCount.toLocaleString()} {t.copiers}</span>
                      </div>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      master.riskScore === 'Low'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}
                  >
                    {master.riskScore} Risk
                  </span>
                </div>

                <p className="mt-3 text-xs text-slate-300 leading-relaxed font-sans">
                  {master.tagline}
                </p>

                {/* Key Metrics */}
                <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-center font-mono">
                  <div className="bg-slate-900/80 rounded-xl p-2">
                    <div className="text-[10px] text-slate-500">{t.roi30d}</div>
                    <div className="text-sm font-bold text-emerald-400">
                      +{master.roi30d}%
                    </div>
                  </div>
                  <div className="bg-slate-900/80 rounded-xl p-2">
                    <div className="text-[10px] text-slate-500">{t.winRate}</div>
                    <div className="text-sm font-bold text-amber-400">
                      {master.winRate}%
                    </div>
                  </div>
                  <div className="bg-slate-900/80 rounded-xl p-2">
                    <div className="text-[10px] text-slate-500">Max DD</div>
                    <div className="text-sm font-bold text-rose-400">
                      {master.maxDrawdown}%
                    </div>
                  </div>
                </div>

                {/* Preferred Pairs */}
                <div className="mt-3 flex flex-wrap items-center gap-1">
                  {master.preferredPairs.map((pair) => (
                    <span
                      key={pair}
                      className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300"
                    >
                      {pair}
                    </span>
                  ))}
                </div>
              </div>

              {/* Copy Button */}
              <div className="mt-5">
                <button
                  onClick={() => handleCopy(master)}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    isCopied
                      ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                      : 'bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/10'
                  }`}
                >
                  {isCopied ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{t.copiedActive}</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 fill-black" />
                      <span>{t.copyStrategy}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
