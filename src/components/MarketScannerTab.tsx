import React, { useMemo, useState } from 'react';
import { useTrading } from '../context/TradingContext';
import {
  ArrowDown,
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  Flame,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
  ShieldAlert,
} from 'lucide-react';
import { FuturesSymbolInfo, TradeDirection } from '../types/trading';

export const MarketScannerTab: React.FC = () => {
  const {
    marketPairs,
    isLoadingMarket,
    refreshMarketData,
    openPosition,
    settings,
    positions,
    t,
    language,
  } = useTrading();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'gainers' | 'losers' | 'aiScore'>('aiScore');
  const [executingSymbol, setExecutingSymbol] = useState<string | null>(null);
  const [aiAnalyzingSymbol, setAiAnalyzingSymbol] = useState<string | null>(null);
  const [aiDeepAnalysis, setAiDeepAnalysis] = useState<any>(null);

  // Filter & Sort
  const filteredPairs = useMemo(() => {
    let result = [...marketPairs];

    if (searchTerm.trim()) {
      const q = searchTerm.toUpperCase();
      result = result.filter((p) => p.symbol.includes(q) || p.baseAsset.includes(q));
    }

    switch (filterType) {
      case 'gainers':
        return result.sort((a, b) => b.priceChangePercent - a.priceChangePercent);
      case 'losers':
        return result.sort((a, b) => a.priceChangePercent - b.priceChangePercent);
      case 'aiScore':
      default:
        return result.sort((a, b) => b.aiScore - a.aiScore);
    }
  }, [marketPairs, searchTerm, filterType]);

  const handleQuickTrade = async (
    pair: FuturesSymbolInfo,
    side: TradeDirection,
    overrideLimits = false,
    customLeverage?: number
  ) => {
    setExecutingSymbol(pair.symbol);
    const rationale =
      language === 'ar'
        ? overrideLimits
          ? `⚡ تنفيذ فوري استثنائي بناءً على تقرير الذكاء الاصطناعي (ثقة ${pair.aiScore}%): تجاوز سقف الصفقات ورأس المال بطلبك المباشر.`
          : `دخول يدوي سريع بناءً على توصية الذكاء الاصطناعي (ثقة ${pair.aiScore}%): RSI عند ${pair.rsi14}.`
        : overrideLimits
        ? `⚡ Direct Priority Override: Executed from AI Deep Analysis, bypassing concurrent & capital limits.`
        : `Manual 1-click execution: AI confidence ${pair.aiScore}%, RSI ${pair.rsi14}.`;

    await openPosition(pair.symbol, side, rationale, customLeverage, { overrideLimits });
    setExecutingSymbol(null);
  };

  const handleDeepAIAnalyze = async (pair: FuturesSymbolInfo) => {
    setAiAnalyzingSymbol(pair.symbol);
    setAiDeepAnalysis(null);

    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: pair.symbol,
          price: pair.price,
          change24h: pair.priceChangePercent,
          rsi: pair.rsi14,
          volume: pair.quoteVolume24h,
          trend: pair.trend,
          orderbookRatio: pair.orderbookRatio || 1.1,
          language,
        }),
      });

      const data = await res.json();
      if (data.success && data.analysis) {
        setAiDeepAnalysis({
          symbol: pair.symbol,
          ...data.analysis,
        });
      }
    } catch (e) {
      console.error('Deep AI analysis failed:', e);
    } finally {
      setAiAnalyzingSymbol(null);
    }
  };

  const isPositionOpen = (symbol: string) => positions.some((p) => p.symbol === symbol);

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="bg-[#121824] border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span>{t.scannerTitle}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20 font-mono">
                {marketPairs.length} {language === 'ar' ? 'عقد مباشر' : 'Active Contracts'}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {t.scannerDesc}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Refresh */}
            <button
              onClick={refreshMarketData}
              disabled={isLoadingMarket}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition"
              title="Refresh Market Data"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingMarket ? 'animate-spin text-amber-400' : ''}`} />
            </button>

            {/* Filter buttons */}
            <div className="flex items-center rounded-xl bg-slate-900 border border-slate-800 p-1 text-xs">
              <button
                onClick={() => setFilterType('aiScore')}
                className={`px-3 py-1.5 rounded-lg transition font-medium flex items-center gap-1.5 ${
                  filterType === 'aiScore'
                    ? 'bg-amber-500 text-black font-bold shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>{t.highAiScore}</span>
              </button>
              <button
                onClick={() => setFilterType('gainers')}
                className={`px-3 py-1.5 rounded-lg transition font-medium flex items-center gap-1.5 ${
                  filterType === 'gainers'
                    ? 'bg-emerald-500 text-black font-bold shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ArrowUp className="w-3.5 h-3.5" />
                <span>{t.topGainers}</span>
              </button>
              <button
                onClick={() => setFilterType('losers')}
                className={`px-3 py-1.5 rounded-lg transition font-medium flex items-center gap-1.5 ${
                  filterType === 'losers'
                    ? 'bg-rose-500 text-black font-bold shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ArrowDown className="w-3.5 h-3.5" />
                <span>{t.topLosers}</span>
              </button>
              <button
                onClick={() => setFilterType('all')}
                className={`px-3 py-1.5 rounded-lg transition font-medium ${
                  filterType === 'all'
                    ? 'bg-slate-700 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.allPairs}
              </button>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mt-4 relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.searchPair}
            className="w-full bg-slate-900/90 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 font-mono transition"
          />
        </div>
      </div>

      {/* AI Deep Analysis Popover / Banner */}
      {aiDeepAnalysis && (
        <div className="bg-gradient-to-r from-cyan-950/40 via-slate-900 to-indigo-950/40 border border-cyan-500/40 rounded-2xl p-4 shadow-xl">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">
                {language === 'ar' ? 'تقرير الذكاء الاصطناعي العميق لـ' : 'Gemini AI Quant Report for'} {aiDeepAnalysis.symbol}
              </h3>
            </div>
            <button
              onClick={() => setAiDeepAnalysis(null)}
              className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-200 leading-relaxed font-sans">
            {aiDeepAnalysis.rationale}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Signal: {aiDeepAnalysis.signal}
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Confidence: {aiDeepAnalysis.confidence}%
            </span>
            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              Rec Leverage: {aiDeepAnalysis.recommendedLeverage}x
            </span>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 font-sans bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/30">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                <span>{language === 'ar' ? 'تجاوز تلقائي للقيود وسقف الصفقات' : 'Bypasses Max Limit & Capital Caps'}</span>
              </span>

              <button
                onClick={() => {
                  const targetPair = marketPairs.find((p) => p.symbol === aiDeepAnalysis.symbol);
                  if (targetPair) {
                    handleQuickTrade(
                      targetPair,
                      aiDeepAnalysis.signal === 'SELL_SHORT' ? 'SHORT' : 'LONG',
                      true, // overrideLimits = true!
                      aiDeepAnalysis.recommendedLeverage
                    );
                  }
                }}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 active:scale-95 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 fill-black" />
                <span>{language === 'ar' ? 'تنفيذ التوصية فوراً (تجاوز القيود)' : 'Execute AI Signal Now (Bypass Limits)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pairs Grid */}
      {filteredPairs.length === 0 ? (
        <div className="bg-[#121824] border border-slate-800 rounded-2xl p-10 text-center">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin mx-auto mb-3" />
          <h3 className="text-white font-bold text-sm">
            {language === 'ar' ? 'جاري مزامنة عقود بينانس الحية والربط بالبث المباشر...' : 'Connecting to Binance Live Stream & Fetching Contracts...'}
          </h3>
          <p className="text-slate-400 text-xs mt-1">
            {language === 'ar'
              ? 'يتم فحص وتحليل كافة أزواج USDT-M اللحظية مباشرة من بينانس بدون تأخير'
              : 'Streaming sub-second live prices directly from Binance Futures WebSocket'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredPairs.slice(0, 36).map((pair) => {
          const isBullish = pair.priceChangePercent >= 0;
          const alreadyOpen = isPositionOpen(pair.symbol);
          const isBusy = executingSymbol === pair.symbol || aiAnalyzingSymbol === pair.symbol;

          return (
            <div
              key={pair.symbol}
              className="bg-[#121824] border border-slate-800/80 hover:border-slate-700/80 rounded-2xl p-4 transition shadow-md group relative overflow-hidden"
            >
              {/* Top Row: Symbol & AI Badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-amber-400 text-xs font-mono">
                    {pair.baseAsset.substring(0, 3)}
                  </div>
                  <div>
                    <div className="font-bold text-white text-sm flex items-center gap-1.5">
                      <span>{pair.symbol}</span>
                      {alreadyOpen && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      24h Vol: ${(pair.quoteVolume24h / 1000000).toFixed(1)}M
                    </div>
                  </div>
                </div>

                {/* AI Win Probability Score */}
                <div className="text-right">
                  <div className="flex items-center gap-1 justify-end">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-sm font-bold font-mono text-amber-400">
                      {pair.aiScore}%
                    </span>
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">
                    AI Probability
                  </div>
                </div>
              </div>

              {/* Price & 24h Change & RSI */}
              <div className="mt-3.5 pt-3 border-t border-slate-800/60 grid grid-cols-3 gap-2 text-xs font-mono">
                <div>
                  <div className="text-[10px] text-slate-500">Price</div>
                  <div className="font-bold text-white">
                    ${pair.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">24h Chg</div>
                  <div
                    className={`font-bold flex items-center gap-0.5 ${
                      isBullish ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {isBullish ? '+' : ''}{pair.priceChangePercent.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">RSI (14)</div>
                  <div
                    className={`font-bold ${
                      pair.rsi14 < 30
                        ? 'text-cyan-400'
                        : pair.rsi14 > 70
                        ? 'text-amber-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {pair.rsi14}
                  </div>
                </div>
              </div>

              {/* Recommended Direction Badge & AI deep button */}
              <div className="mt-3 flex items-center justify-between text-xs">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    pair.aiRecommendedSignal === 'BUY_LONG'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : pair.aiRecommendedSignal === 'SELL_SHORT'
                      ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {pair.aiRecommendedSignal === 'BUY_LONG'
                    ? t.strongLong
                    : pair.aiRecommendedSignal === 'SELL_SHORT'
                    ? t.strongShort
                    : t.holdNeutral}
                </span>

                <button
                  onClick={() => handleDeepAIAnalyze(pair)}
                  disabled={isBusy}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition"
                >
                  {aiAnalyzingSymbol === pair.symbol ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Brain className="w-3 h-3" />
                  )}
                  <span>{language === 'ar' ? 'تحليل عميق' : 'AI Reasoning'}</span>
                </button>
              </div>

              {/* Action Buttons */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleQuickTrade(pair, 'LONG', true)}
                  disabled={isBusy || alreadyOpen}
                  className="py-1.5 px-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-bold text-xs transition flex items-center justify-center gap-1 disabled:opacity-40"
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>LONG</span>
                </button>
                <button
                  onClick={() => handleQuickTrade(pair, 'SHORT', true)}
                  disabled={isBusy || alreadyOpen}
                  className="py-1.5 px-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 font-bold text-xs transition flex items-center justify-center gap-1 disabled:opacity-40"
                >
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>SHORT</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
};
