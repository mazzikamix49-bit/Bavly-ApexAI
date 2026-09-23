import React, { useState } from 'react';
import { useTrading } from '../context/TradingContext';
import { BacktestingService } from '../services/backtestingService';
import { BacktestResult } from '../types/trading';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  Calendar,
  CheckCircle,
  Clock,
  History,
  Loader2,
  Play,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

export const BacktestingTab: React.FC = () => {
  const { t, language, settings, marketPairs } = useTrading();
  const isArabic = language === 'ar';

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('15m');
  const [candleCount, setCandleCount] = useState(150);
  const [leverage, setLeverage] = useState(settings.leverage || 20);
  const [tpPercent, setTpPercent] = useState(settings.takeProfitPercent || 2.2);
  const [slPercent, setSlPercent] = useState(settings.stopLossPercent || 1.1);

  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState('');

  const handleRunBacktest = async () => {
    setIsRunning(true);
    setError('');
    try {
      const res = await BacktestingService.runBacktest(
        symbol,
        interval,
        candleCount,
        leverage,
        tpPercent,
        slPercent,
        1000,
        100
      );
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Backtest failed');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Configuration Header */}
      <div className="bg-[#121824] border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <History className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-bold text-white">
            {t.backtestTitle}
          </h2>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
          {t.backtestDesc}
        </p>

        {/* Form Controls */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Symbol */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-medium">
              {t.selectPair}
            </label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-amber-400 focus:outline-none"
            >
              <option value="BTCUSDT">BTCUSDT</option>
              <option value="ETHUSDT">ETHUSDT</option>
              <option value="SOLUSDT">SOLUSDT</option>
              <option value="BNBUSDT">BNBUSDT</option>
              <option value="DOGEUSDT">DOGEUSDT</option>
              <option value="PEPEUSDT">PEPEUSDT</option>
              <option value="XRPUSDT">XRPUSDT</option>
              <option value="NEARUSDT">NEARUSDT</option>
            </select>
          </div>

          {/* Timeframe */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-medium">
              {t.timeframe}
            </label>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-amber-400 focus:outline-none"
            >
              <option value="15m">15m ({isArabic ? 'سريع' : 'Scalp'})</option>
              <option value="1h">1h ({isArabic ? 'ساعة' : '1 Hour'})</option>
              <option value="4h">4h ({isArabic ? '4 ساعات' : '4 Hours'})</option>
              <option value="1d">1d ({isArabic ? 'يومي' : 'Daily'})</option>
            </select>
          </div>

          {/* Candle Count */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-medium">
              {t.candleCount}
            </label>
            <input
              type="number"
              min={50}
              max={500}
              step={50}
              value={candleCount}
              onChange={(e) => setCandleCount(parseInt(e.target.value, 10))}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-amber-400 focus:outline-none"
            />
          </div>

          {/* Leverage */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-medium">
              {t.leverage} ({leverage}x)
            </label>
            <input
              type="number"
              min={1}
              max={125}
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value, 10))}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-amber-400 focus:outline-none"
            />
          </div>

          {/* Take Profit % */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-medium">
              TP (%)
            </label>
            <input
              type="number"
              step={0.1}
              min={0.5}
              max={20}
              value={tpPercent}
              onChange={(e) => setTpPercent(parseFloat(e.target.value))}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-amber-400 focus:outline-none"
            />
          </div>

          {/* Stop Loss % */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-medium">
              SL (%)
            </label>
            <input
              type="number"
              step={0.1}
              min={0.2}
              max={10}
              value={slPercent}
              onChange={(e) => setSlPercent(parseFloat(e.target.value))}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-amber-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Action Button */}
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={handleRunBacktest}
            disabled={isRunning}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition flex items-center gap-2 shadow-lg shadow-amber-500/10 disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t.backtestingRunning}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-black" />
                <span>{t.runBacktest}</span>
              </>
            )}
          </button>

          {error && <span className="text-xs text-rose-400">{error}</span>}
        </div>
      </div>

      {/* Results Section */}
      {result && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-[#121824] border border-slate-800 rounded-xl p-3">
              <div className="text-slate-400 text-xs mb-1">{t.winRate}</div>
              <div className="text-xl font-bold font-mono text-emerald-400">
                {result.winRate}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {result.winningTrades} W / {result.losingTrades} L
              </div>
            </div>

            <div className="bg-[#121824] border border-slate-800 rounded-xl p-3">
              <div className="text-slate-400 text-xs mb-1">{t.netProfit}</div>
              <div
                className={`text-xl font-bold font-mono ${
                  result.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {result.netProfit >= 0 ? '+' : ''}${result.netProfit}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                ({result.netProfitPercent}%)
              </div>
            </div>

            <div className="bg-[#121824] border border-slate-800 rounded-xl p-3">
              <div className="text-slate-400 text-xs mb-1">{t.profitFactor}</div>
              <div className="text-xl font-bold font-mono text-amber-400">
                {result.profitFactor}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Gross Win / Gross Loss
              </div>
            </div>

            <div className="bg-[#121824] border border-slate-800 rounded-xl p-3">
              <div className="text-slate-400 text-xs mb-1">{t.maxDrawdown}</div>
              <div className="text-xl font-bold font-mono text-rose-400">
                {result.maxDrawdown}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Peak to trough
              </div>
            </div>

            <div className="bg-[#121824] border border-slate-800 rounded-xl p-3">
              <div className="text-slate-400 text-xs mb-1">{t.totalTrades}</div>
              <div className="text-xl font-bold font-mono text-white">
                {result.totalTrades}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Simulated orders
              </div>
            </div>

            <div className="bg-[#121824] border border-slate-800 rounded-xl p-3">
              <div className="text-slate-400 text-xs mb-1">Final Capital</div>
              <div className="text-xl font-bold font-mono text-cyan-400">
                ${result.finalCapital}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Start: ${result.initialCapital}
              </div>
            </div>
          </div>

          {/* Historical Simulated Trades List */}
          <div className="bg-[#121824] border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
            <h3 className="font-bold text-white text-sm mb-3 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-amber-400" />
              <span>{t.simulatedTrades}</span>
            </h3>

            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] border-b border-slate-800 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Direction</th>
                    <th className="py-2.5 px-3">Entry Price</th>
                    <th className="py-2.5 px-3">Exit Price</th>
                    <th className="py-2.5 px-3">PnL ($)</th>
                    <th className="py-2.5 px-3">PnL (%)</th>
                    <th className="py-2.5 px-3">Exit Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {result.trades.map((tr, i) => {
                    const isWin = tr.pnl > 0;
                    return (
                      <tr key={i} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              tr.side === 'LONG'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {tr.side}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          ${tr.entryPrice.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-white">
                          ${tr.exitPrice.toLocaleString()}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-bold ${
                            isWin ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isWin ? '+' : ''}${tr.pnl.toFixed(2)}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-bold ${
                            isWin ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isWin ? '+' : ''}{tr.pnlPercent.toFixed(2)}%
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px] font-sans">
                          {tr.reason}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
