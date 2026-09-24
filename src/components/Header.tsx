import React from 'react';
import { useTrading } from '../context/TradingContext';
import {
  Activity,
  Bot,
  Check,
  Globe,
  Pause,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  TrendingUp,
  Wallet,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';

interface HeaderProps {
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSettings }) => {
  const {
    language,
    setLanguage,
    t,
    tradingMode,
    setTradingMode,
    botRunning,
    toggleBot,
    balance,
    apiStatus,
    credentials,
    settings,
    wallets,
    activeWallet,
    switchWallet,
    activeWalletId,
    wsStatus,
    wsStatusDetails,
    reconnectWs,
  } = useTrading();

  const isArabic = language === 'ar';

  return (
    <header className="border-b border-slate-800 bg-[#0f141f]/95 backdrop-blur sticky top-0 z-30 shadow-lg shadow-black/40">
      {/* Top Banner */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          
          {/* Brand & Bot Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-amber-400 to-yellow-300 flex items-center justify-center shadow-lg shadow-amber-500/20 text-black font-black text-xl">
                  <Zap className="w-6 h-6 fill-black" />
                </div>
                {botRunning && (
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 ring-2 ring-[#0f141f]"></span>
                  </span>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
                    <span className="text-amber-400">Bavly</span>
                    <span>ApexAI</span>
                    <span className="text-amber-400 font-mono text-xs px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/20">
                      BINANCE FUTURES
                    </span>
                  </h1>
                </div>
                <p className="text-xs text-slate-400 font-medium">
                  {t.tagline}
                </p>
              </div>
            </div>

            {/* Mobile Controls */}
            <div className="flex md:hidden items-center gap-2">
              <button
                onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                className="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-200 hover:text-white"
                title="Switch Language"
              >
                <Globe className="w-4 h-4" />
              </button>
              <button
                onClick={onOpenSettings}
                className="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-200 hover:text-white"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Control Center */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* 24/7 Bot State Toggle */}
            <button
              onClick={toggleBot}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all shadow-md ${
                botRunning
                  ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 shadow-emerald-500/10'
                  : 'bg-rose-500/15 border border-rose-500/40 text-rose-400 hover:bg-rose-500/25 shadow-rose-500/10'
              }`}
            >
              {botRunning ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>{t.botRunning}</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>{t.botPaused}</span>
                </>
              )}
            </button>

            {/* Trading Mode Switch (Real vs Paper) */}
            <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs">
              <button
                onClick={() => setTradingMode('paper')}
                className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                  tradingMode === 'paper'
                    ? 'bg-amber-500 text-black font-bold shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.paperMode}
              </button>
              <button
                onClick={() => setTradingMode('real')}
                className={`px-2.5 py-1 rounded-md transition-all font-medium flex items-center gap-1.5 ${
                  tradingMode === 'real'
                    ? 'bg-emerald-500 text-black font-bold shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{t.realMode}</span>
                {credentials.isValidated && (
                  <span className="w-1.5 h-1.5 rounded-full bg-black"></span>
                )}
              </button>
            </div>

            {/* Custom Binance Wallet Profile Badge */}
            <div className="relative group">
              <button
                onClick={onOpenSettings}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 transition-all shadow-sm"
                title={language === 'ar' ? 'إدارة وتخصيص محافظ باينانس' : 'Manage Binance Wallets'}
              >
                <Wallet className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-bold max-w-[120px] truncate">
                  {activeWallet?.name || (language === 'ar' ? 'محفظة بافلي' : 'Bavly Wallet')}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30 font-semibold">
                  {language === 'ar' ? 'من باينانس' : 'Binance'}
                </span>
                {wallets.length > 1 && (
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 rounded-full font-mono">
                    {wallets.length}
                  </span>
                )}
              </button>

              {/* Quick switch dropdown if multiple wallets exist */}
              {wallets.length > 1 && (
                <div className="absolute left-0 mt-1 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1 z-50 hidden group-hover:block transition-all">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {language === 'ar' ? 'تبديل محفظة باينانس:' : 'Switch Binance Wallet:'}
                  </div>
                  {wallets.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => switchWallet(w.id)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition ${
                        w.id === activeWalletId
                          ? 'bg-amber-500/20 text-amber-300 font-bold'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">{w.name}</span>
                      {w.id === activeWalletId && <Check className="w-3.5 h-3.5 text-amber-400" />}
                    </button>
                  ))}
                  <button
                    onClick={onOpenSettings}
                    className="w-full text-center mt-1 pt-1 border-t border-slate-800 text-[11px] text-amber-400 hover:underline py-1"
                  >
                    {language === 'ar' ? '+ إضافة / تعديل المحافظ' : '+ Manage Wallets'}
                  </button>
                </div>
              )}
            </div>

            {/* Real-time Binance WebSocket Stream Status Indicator */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                wsStatus === 'connected'
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                  : wsStatus === 'connecting' || wsStatus === 'reconnecting'
                  ? 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                  : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
              }`}
              title={wsStatusDetails || 'WebSocket Stream'}
            >
              {wsStatus === 'connected' ? (
                <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              ) : wsStatus === 'connecting' || wsStatus === 'reconnecting' ? (
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-rose-400" />
              )}
              <span className="hidden lg:inline font-mono">
                {wsStatus === 'connected'
                  ? t.wsLiveStream
                  : wsStatus === 'reconnecting'
                  ? t.wsReconnecting
                  : wsStatus === 'connecting'
                  ? t.wsConnecting
                  : t.wsDisconnected}
              </span>
              {wsStatus !== 'connected' && (
                <button
                  onClick={reconnectWs}
                  className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-bold border border-amber-500/40 transition flex items-center gap-1"
                  title={t.wsReconnectBtn}
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>{isArabic ? 'إعادة وصل' : 'Reconnect'}</span>
                </button>
              )}
            </div>

            {/* Binance API Connection Status */}
            <button
              onClick={onOpenSettings}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                apiStatus === 'connected'
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:border-emerald-500/50'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <ShieldCheck
                className={`w-3.5 h-3.5 ${
                  apiStatus === 'connected' ? 'text-emerald-400' : 'text-slate-500'
                }`}
              />
              <span>
                {apiStatus === 'connected' ? t.apiConnected : t.apiDisconnected}
              </span>
              {credentials.isTestnet && (
                <span className="bg-amber-400/20 text-amber-300 text-[10px] px-1 rounded">
                  Testnet
                </span>
              )}
            </button>

            {/* Language Switcher */}
            <button
              onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition"
              title="Toggle Arabic / English"
            >
              <Globe className="w-3.5 h-3.5 text-amber-400" />
              <span>{language === 'ar' ? 'English' : 'العربية'}</span>
            </button>

            {/* Settings Button */}
            <button
              onClick={onOpenSettings}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition"
            >
              <Settings className="w-3.5 h-3.5 text-slate-400" />
              <span>{t.tabSettings}</span>
            </button>
          </div>
        </div>

        {/* Live Balance Dashboard Banner */}
        <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          {/* Total Wallet Balance */}
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-2.5 sm:p-3">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="flex items-center gap-1">
                <Wallet className="w-3.5 h-3.5 text-amber-400" />
                {t.walletBalance}
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                USDT
              </span>
            </div>
            <div className="text-base sm:text-xl font-bold font-mono text-white tracking-tight">
              ${balance.totalWalletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* Available Margin */}
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-2.5 sm:p-3">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                {t.availableMargin}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {settings.leverage}x
              </span>
            </div>
            <div className="text-base sm:text-xl font-bold font-mono text-emerald-400 tracking-tight">
              ${balance.availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* Unrealized PnL */}
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-2.5 sm:p-3">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                {t.unrealizedPnl}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                Live
              </span>
            </div>
            <div
              className={`text-base sm:text-xl font-bold font-mono tracking-tight ${
                balance.totalUnrealizedProfit > 0
                  ? 'text-emerald-400'
                  : balance.totalUnrealizedProfit < 0
                  ? 'text-rose-400'
                  : 'text-slate-300'
              }`}
            >
              {balance.totalUnrealizedProfit >= 0 ? '+' : ''}
              ${balance.totalUnrealizedProfit.toFixed(2)}
            </div>
          </div>

          {/* Margin Balance / Risk Health */}
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-2.5 sm:p-3">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                {t.marginBalance}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                Safe Margin
              </span>
            </div>
            <div className="text-base sm:text-xl font-bold font-mono text-slate-200 tracking-tight">
              ${balance.totalMarginBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

      </div>
    </header>
  );
};
