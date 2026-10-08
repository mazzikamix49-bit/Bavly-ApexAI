import React, { useState, useEffect } from 'react';
import { useTrading } from '../context/TradingContext';
import {
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Key,
  Layers,
  Loader2,
  Percent,
  Plus,
  Send,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
  X,
  Zap,
  Coins,
  AlertCircle,
  Server,
  RefreshCw,
} from 'lucide-react';
import { BinanceService } from '../services/binanceService';
import { TelegramService } from '../services/telegramService';
import { RiskManagementService } from '../services/riskManagementService';
import { AllowedDirection, CapitalProfile, DEFAULT_CAPITAL_PROFILE } from '../types/trading';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const {
    t,
    language,
    credentials,
    updateCredentials,
    validateCredentials,
    isValidatingApi,
    apiStatus,
    apiErrorMessage,
    wallets,
    activeWallet,
    activeWalletId,
    switchWallet,
    saveWalletProfile,
    deleteWalletProfile,
    setCustomWalletName,
    settings,
    updateSettings,
    telegramSettings,
    updateTelegramSettings,
    clearTradeHistory,
    balance,
    positions,
  } = useTrading();

  const isArabic = language === 'ar';
  const [activeTab, setActiveTab] = useState<'strategy' | 'api' | 'notifications' | 'reset'>('strategy');

  // Local state for credentials & wallet profiles
  const [walletName, setWalletName] = useState(activeWallet?.name || 'محفظة بافلي بينانس (Bavly Futures)');
  const [isTestnet, setIsTestnet] = useState(credentials.isTestnet);
  const [serverConfig, setServerConfig] = useState<{
    testnetConfigured: boolean;
    prodConfigured: boolean;
  }>({ testnetConfigured: false, prodConfigured: false });

  // New wallet profile creation modal state
  const [isAddingNewWallet, setIsAddingNewWallet] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletIsTestnet, setNewWalletIsTestnet] = useState(false);

  useEffect(() => {
    if (isOpen) {
      BinanceService.checkServerConfigStatus(isTestnet).then((status) => {
        setServerConfig({
          testnetConfigured: status.testnetConfigured,
          prodConfigured: status.prodConfigured,
        });
      });
    }
  }, [isOpen, isTestnet]);

  useEffect(() => {
    if (activeWallet) {
      setWalletName(activeWallet.name);
      setIsTestnet(activeWallet.isTestnet);
    }
  }, [activeWalletId]);

  // Local state for strategy
  const [maxConcurrent, setMaxConcurrent] = useState(settings.maxConcurrentPositions);
  const [positionSize, setPositionSize] = useState(settings.positionSizeUsd);
  const [leverage, setLeverage] = useState(settings.leverage);
  const [direction, setDirection] = useState<AllowedDirection>(settings.allowedDirection);
  const [maxDurationHours, setMaxDurationHours] = useState(settings.maxTradeDurationHours);
  const [takeProfit, setTakeProfit] = useState(settings.takeProfitPercent);
  const [stopLoss, setStopLoss] = useState(settings.stopLossPercent);
  const [trailingStop, setTrailingStop] = useState(settings.trailingStopPercent);
  const [useTrailing, setUseTrailing] = useState(settings.useTrailingStop);
  const [dailyDrawdown, setDailyDrawdown] = useState(settings.maxDailyDrawdownPercent);
  const [minConfidence, setMinConfidence] = useState(settings.minAiConfidence);
  const [aiDynamicTargets, setAiDynamicTargets] = useState(settings.aiDynamicTargets ?? true);
  const [multiTargetTrailing, setMultiTargetTrailing] = useState(settings.multiTargetTrailing ?? true);
  const [unlimitedHoldTime, setUnlimitedHoldTime] = useState(settings.unlimitedHoldTime ?? true);
  const [enableToastAlerts, setEnableToastAlerts] = useState(settings.enableToastAlerts ?? true);

  // Capital Allocation Limit (Wallet Protection)
  const [enableCapitalLimit, setEnableCapitalLimit] = useState(settings.enableCapitalLimit ?? true);
  const [maxAllocatedCapital, setMaxAllocatedCapital] = useState(settings.maxAllocatedCapitalUsd ?? 5.0);

  // Capital Profile state (Default: Capital=$20, Risk=1%, DailyLoss=5%, Positions=2)
  const initialCap = settings.capitalProfile || DEFAULT_CAPITAL_PROFILE;
  const [capitalUsd, setCapitalUsd] = useState(initialCap.capitalUsd ?? 20);
  const [riskPerTradePercent, setRiskPerTradePercent] = useState(initialCap.riskPerTradePercent ?? 1);
  const [maxDailyLossPercent, setMaxDailyLossPercent] = useState(initialCap.maxDailyLossPercent ?? 5);
  const [maxOpenPositions, setMaxOpenPositions] = useState(initialCap.maxOpenPositions ?? 2);
  const [capitalProfileError, setCapitalProfileError] = useState<string | null>(null);

  // Reset confirmation state
  const [hasReset, setHasReset] = useState(false);

  // Telegram test state
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramStatusMsg, setTelegramStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Saved notification toast
  const [showSavedToast, setShowSavedToast] = useState(false);

  if (!isOpen) return null;

  const handleSaveApi = () => {
    setCustomWalletName(walletName);
    updateCredentials({
      walletName,
      isTestnet,
    });
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 2500);
  };

  const handleAddNewWallet = () => {
    if (!newWalletName.trim()) {
      return;
    }
    saveWalletProfile({
      name: newWalletName.trim(),
      isTestnet: newWalletIsTestnet,
      isValidated: false,
    });
    setIsAddingNewWallet(false);
    setNewWalletName('');
    setNewWalletIsTestnet(false);
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 2500);
  };

  const handleSaveStrategy = () => {
    const profileValidation = RiskManagementService.validateCapitalProfile({
      capitalUsd,
      riskPerTradePercent,
      maxDailyLossPercent,
      maxOpenPositions,
    });
    if (!profileValidation.isValid) {
      setCapitalProfileError(profileValidation.error || 'Invalid Capital Profile settings');
      return;
    }
    setCapitalProfileError(null);

    updateSettings({
      capitalProfile: {
        capitalUsd,
        riskPerTradePercent,
        maxDailyLossPercent,
        maxOpenPositions,
      },
      maxConcurrentPositions: maxOpenPositions,
      riskPerTradePercent,
      positionSizeUsd: positionSize,
      leverage,
      allowedDirection: direction,
      maxTradeDurationHours: maxDurationHours,
      takeProfitPercent: takeProfit,
      stopLossPercent: stopLoss,
      trailingStopPercent: trailingStop,
      useTrailingStop: useTrailing,
      maxDailyDrawdownPercent: dailyDrawdown,
      minAiConfidence: minConfidence,
      aiDynamicTargets,
      multiTargetTrailing,
      unlimitedHoldTime,
      enableToastAlerts,
      enableCapitalLimit,
      maxAllocatedCapitalUsd: maxAllocatedCapital,
    });
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 2500);
  };

  const handleResetHistory = () => {
    clearTradeHistory();
    setHasReset(true);
    setTimeout(() => setHasReset(false), 3000);
  };

  const handleTestTelegram = async () => {
    setIsTestingTelegram(true);
    setTelegramStatusMsg(null);
    const testText = isArabic
      ? '🔔 <b>إشعار تجريبي من بوت Bavly ApexAI</b>\n\nتهانينا! تم ربط إشعارات تلجرام بنجاح. ستصلك هنا تنبيهات فورية بكل الصفقات المفتوحة والمغلقة وأهداف الأرباح ووقف الخسارة.'
      : '🔔 <b>Bavly ApexAI Telegram Test Alert</b>\n\nCongratulations! Your Telegram notifications are successfully connected. You will receive live trade execution and profit alerts here.';

    const success = await TelegramService.sendMessage(telegramSettings.botToken, telegramSettings.chatId, testText);
    setIsTestingTelegram(false);
    if (success) {
      setTelegramStatusMsg({ text: t.telegramSentSuccess, ok: true });
    } else {
      setTelegramStatusMsg({ text: t.telegramFailed, ok: false });
    }
  };

  const leveragePresets = [5, 10, 20, 50, 75, 100, 125, 150];
  const sizePresets = [0.5, 1, 5, 10, 25, 50, 100, 250];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#121824] border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {t.settingsTitle}
              </h2>
              <p className="text-xs text-slate-400">
                {language === 'ar' ? 'تخصيص استراتيجية التداول، مفاتيح باينانس، وإشعارات تلجرام' : 'Configure strategy parameters, Binance API, and alerts'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Navigation Tabs: 4-Item Grid ensuring all tabs are 100% visible on all devices */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-2.5 bg-slate-950/90 border-b border-slate-800 text-xs font-semibold shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('strategy')}
            className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition text-center ${
              activeTab === 'strategy'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Zap className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span className="truncate">{isArabic ? 'الاستراتيجية والمخاطر' : 'Strategy & Risk'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('api')}
            className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition text-center ${
              activeTab === 'api'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Key className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span className="truncate">{isArabic ? 'مفاتيح API بينانس' : 'Binance API'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition text-center ${
              activeTab === 'notifications'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Bell className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span className="truncate">{isArabic ? 'الإشعارات وتلجرام' : 'Telegram Alerts'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reset')}
            className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition text-center ${
              activeTab === 'reset'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm font-bold'
                : 'text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0 text-rose-400" />
            <span className="truncate">{isArabic ? 'تصفير السجل' : 'Reset Data'}</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs">
          {/* TAB 1: STRATEGY & RISK */}
          {activeTab === 'strategy' && (
            <div className="space-y-4">
              {/* Primary Capital Profile Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-cyan-500/15 via-slate-900/90 to-slate-900 border border-cyan-500/35 space-y-3.5 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                    <Coins className="w-4 h-4" />
                    <span>{isArabic ? 'ملف رأس المال وحساب المخاطر (Capital Profile)' : 'Authoritative Capital & Risk Profile'}</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono font-bold border border-cyan-500/30">
                    Capital: {capitalUsd === 0 ? 'AUTO' : `$${capitalUsd}`} • {riskPerTradePercent === 0 ? (isArabic ? 'التداول معطل' : 'Trading Disabled') : `${riskPerTradePercent}% Risk`}
                  </span>
                </div>

                <div className="text-[11px] text-slate-300 leading-relaxed">
                  {isArabic
                    ? 'يتحكم في رأس المال المعتمد لحساب أحجام الصفقات بدقة. يمكنك إدخال 0 لتفعيل الخيارات التلقائية أو تعطيل ميزات محددة وفق القواعد الموضحة أدناه.'
                    : 'Governs the authoritative capital base for position sizing. You can enter 0 for special behaviors (AUTO capital, disabling trading, or disabling limits) as detailed below.'}
                </div>

                {capitalProfileError && (
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[11px]">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{capitalProfileError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Capital Usd (0 = AUTO) */}
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-300 font-medium text-[11px]">
                        {isArabic ? 'رأس المال (0 = تلقائي AUTO):' : 'Capital Base (0 = AUTO):'}
                      </label>
                      <span className="text-cyan-400 font-mono font-bold text-xs bg-slate-900 px-2 py-0.5 rounded border border-cyan-500/30">
                        {capitalUsd === 0 ? 'AUTO' : `$${capitalUsd}`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[0, 20, 50, 100, 250].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setCapitalUsd(preset)}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition ${
                            capitalUsd === preset
                              ? 'bg-cyan-500 text-slate-950 font-bold'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {preset === 0 ? 'AUTO' : `$${preset}`}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={capitalUsd}
                      onChange={(e) => setCapitalUsd(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:border-cyan-500 outline-none"
                    />
                    <div className="text-[10px] text-slate-400">
                      {isArabic ? '💡 0 = AUTO: يعتمد رصيد الحساب الفعلي (Equity) من المنصة/المحاكاة' : '💡 0 = AUTO: Uses live/simulated account equity'}
                    </div>
                  </div>

                  {/* Risk Per Trade % (0 = Disable Trading) */}
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-300 font-medium text-[11px]">
                        {isArabic ? 'المخاطرة لكل صفقة (0 = إيقاف التداول):' : 'Risk Per Trade (0 = Disable Trading):'}
                      </label>
                      <span className="text-amber-400 font-mono font-bold text-xs bg-slate-900 px-2 py-0.5 rounded border border-amber-500/30">
                        {riskPerTradePercent === 0 ? (isArabic ? 'معطل (0%)' : '0% (Disabled)') : `${riskPerTradePercent}%`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[0, 0.5, 1.0, 1.5, 2.0].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setRiskPerTradePercent(preset)}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition ${
                            riskPerTradePercent === preset
                              ? 'bg-amber-500 text-slate-950 font-bold'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {preset === 0 ? '0% (Off)' : `${preset}%`}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="5.0"
                      step="0.1"
                      value={riskPerTradePercent}
                      onChange={(e) => setRiskPerTradePercent(Math.min(5.0, Math.max(0, parseFloat(e.target.value) || 0)))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:border-amber-500 outline-none"
                    />
                    <div className="text-[10px] text-slate-400">
                      {isArabic ? '💡 0 = Disable Trading: يمنع فتح أي صفقات جديدة نهائياً' : '💡 0 = Disable Trading: Rejects all new entries (NO TRADING)'}
                    </div>
                  </div>

                  {/* Max Daily Loss % (0 = Disabled) */}
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-300 font-medium text-[11px]">
                        {isArabic ? 'سقف الخسارة اليومية (0 = معطل):' : 'Max Daily Loss (0 = Disabled):'}
                      </label>
                      <span className="text-rose-400 font-mono font-bold text-xs bg-slate-900 px-2 py-0.5 rounded border border-rose-500/30">
                        {maxDailyLossPercent === 0 ? (isArabic ? 'معطل' : 'Disabled') : `${maxDailyLossPercent}%`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[0, 3, 5, 8, 10].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setMaxDailyLossPercent(preset)}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition ${
                            maxDailyLossPercent === preset
                              ? 'bg-rose-500 text-slate-950 font-bold'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {preset === 0 ? 'Disabled' : `${preset}%`}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      step="0.5"
                      value={maxDailyLossPercent}
                      onChange={(e) => setMaxDailyLossPercent(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:border-rose-500 outline-none"
                    />
                    <div className="text-[10px] text-slate-400">
                      {isArabic ? '💡 0 = Disabled: تعطيل قاطع الدائرة اليومي' : '💡 0 = Disabled: Daily loss circuit breaker is off'}
                    </div>
                  </div>

                  {/* Max Open Positions (0 = Disable New Positions) */}
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-300 font-medium text-[11px]">
                        {isArabic ? 'أقصى صفقات متزامنة (0 = إيقاف الصفقات):' : 'Max Open Positions (0 = Disable New Positions):'}
                      </label>
                      <span className="text-emerald-400 font-mono font-bold text-xs bg-slate-900 px-2 py-0.5 rounded border border-emerald-500/30">
                        {maxOpenPositions === 0 ? (isArabic ? 'معطل (0)' : 'Disabled (0)') : maxOpenPositions}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[0, 1, 2, 3, 4].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setMaxOpenPositions(preset)}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition ${
                            maxOpenPositions === preset
                              ? 'bg-emerald-500 text-slate-950 font-bold'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {preset === 0 ? '0 (Off)' : preset}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      step="1"
                      value={maxOpenPositions}
                      onChange={(e) => setMaxOpenPositions(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:border-emerald-500 outline-none"
                    />
                    <div className="text-[10px] text-slate-400">
                      {isArabic ? '💡 0 = Disable New Positions: يمنع فتح أي صفقات جديدة' : '💡 0 = Disable New Positions: Blocks new entries'}
                    </div>
                  </div>
                </div>

                {/* Live Sizing & $20 Compatibility Callout Box */}
                <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-1.5 text-[11px]">
                  <div className="flex justify-between text-slate-400">
                    <span>{isArabic ? 'رأس المال المعتمد:' : 'Capital:'}</span>
                    <span className="text-cyan-400 font-mono font-bold">
                      {capitalUsd === 0 ? 'Capital: AUTO' : `$${capitalUsd} USDT`}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>{isArabic ? 'الميزانية المخططة للمخاطرة:' : 'Risk per Trade:'}</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {riskPerTradePercent === 0
                        ? (isArabic ? 'Trading disabled: risk per trade is 0%.' : 'Trading disabled: risk per trade is 0%.')
                        : capitalUsd === 0
                        ? `${riskPerTradePercent}% of Live Equity`
                        : `$${(capitalUsd * (riskPerTradePercent / 100)).toFixed(2)} USDT`}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>{isArabic ? 'سقف وقف الخسارة اليومي:' : 'Daily Loss Limit:'}</span>
                    <span className="text-rose-400 font-mono font-bold">
                      {maxDailyLossPercent === 0
                        ? 'Daily Loss Limit: Disabled'
                        : capitalUsd === 0
                        ? `${maxDailyLossPercent}% of Live Equity`
                        : `-$${(capitalUsd * (maxDailyLossPercent / 100)).toFixed(2)} USDT`}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>{isArabic ? 'حالة الصفقات الجديدة:' : 'New Positions Status:'}</span>
                    <span className="text-emerald-400 font-mono font-bold">
                      {maxOpenPositions === 0 ? 'New positions disabled.' : `${maxOpenPositions} max active`}
                    </span>
                  </div>
                  <div className="text-[10px] text-amber-300/90 border-t border-slate-800/80 pt-1.5 leading-relaxed">
                    🛡️ {isArabic
                      ? 'قواعد الأمان: عند اختيار AUTO (0)، يقرأ النظام الرصيد الفعلي من بينانس أو رصيد المحاكاة. وإذا كان الرصيد غير متوفر أو مساوياً لصفر، يرفض محرك المخاطر الصفقة تلقائياً دون أي fallback خفي.'
                      : 'Safety Guarantee: In AUTO mode (0), the system strictly queries actual live/simulated account equity. If equity is unavailable or zero, trades are cleanly rejected with zero hidden fallbacks.'}
                  </div>
                </div>
              </div>

              {/* Highlighted Capital Allocation & Binance Reserve Protection Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/15 via-slate-900/90 to-slate-900 border border-emerald-500/35 space-y-3.5 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
                    <ShieldCheck className="w-4 h-4" />
                    <span>{isArabic ? 'سقف رأس المال المخصص للبوت (حماية رصيد بينانس)' : 'Bot Capital Allocation & Wallet Protection'}</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold border border-emerald-500/30">
                    {enableCapitalLimit ? (isArabic ? 'الحماية مفعلة ✓' : 'PROTECTION ACTIVE') : (isArabic ? 'معطل' : 'DISABLED')}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div>
                    <div className="font-semibold text-white">
                      {isArabic ? 'تفعيل سقف رأس المال المخصص للتداول' : 'Enforce Capital Allocation Cap'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      {isArabic
                        ? 'مثال: لو رصيدك في بينانس 10$ وحددت 5$، سيتداول البوت بـ 5$ كحد أقصى ولن يقترب من الـ 5$ الأخرى إطلاقاً لحمايتها.'
                        : 'E.g., if your wallet has $10 and you specify $5, the bot only uses up to $5, preserving the other $5 completely untouched.'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={enableCapitalLimit}
                    onChange={(e) => setEnableCapitalLimit(e.target.checked)}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer shrink-0"
                  />
                </div>

                {enableCapitalLimit && (
                  <div className="space-y-3 pt-1">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-slate-300 font-medium">
                          {isArabic ? 'الحد الأقصى المخصص للبوت (USDT):' : 'Max Allowed Bot Capital (USDT):'}
                        </label>
                        <span className="text-emerald-400 font-mono font-bold text-sm bg-slate-950 px-2 py-0.5 rounded border border-emerald-500/30">
                          ${maxAllocatedCapital.toFixed(2)} USDT
                        </span>
                      </div>

                      {/* Quick Presets */}
                      <div className="flex flex-wrap gap-1.5 mb-2.5">
                        {[2, 5, 10, 20, 50, 100].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setMaxAllocatedCapital(preset)}
                            className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold transition ${
                              maxAllocatedCapital === preset
                                ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            ${preset}
                          </button>
                        ))}
                      </div>

                      <div className="relative">
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          value={maxAllocatedCapital}
                          onChange={(e) => setMaxAllocatedCapital(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                          placeholder="5.0"
                        />
                        <span className="absolute right-3 top-2 text-slate-500 font-mono">USDT</span>
                      </div>
                    </div>

                    {/* Live Protection Visualizer Bar */}
                    <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-[11px]">
                      <div className="flex justify-between text-slate-400">
                        <span>{isArabic ? 'رصيد محفظة بينانس الكلي:' : 'Total Binance Wallet:'}</span>
                        <span className="text-white font-mono font-bold">${balance.totalWalletBalance.toFixed(2)} USDT</span>
                      </div>
                      <div className="flex justify-between text-emerald-400">
                        <span>{isArabic ? 'سقف البوت المسموح به للتداول:' : 'Bot Allowed Capital Allocation:'}</span>
                        <span className="font-mono font-bold">${maxAllocatedCapital.toFixed(2)} USDT</span>
                      </div>
                      <div className="flex justify-between text-cyan-400 font-semibold border-t border-slate-800/80 pt-1.5">
                        <span>🛡️ {isArabic ? 'الرصيد المحمي المحجوز (لن يمسه البوت نهائياً):' : 'Protected Reserve (Untouched by Bot):'}</span>
                        <span className="font-mono font-bold text-cyan-300">
                          ${Math.max(0, balance.totalWalletBalance - maxAllocatedCapital).toFixed(2)} USDT ({balance.totalWalletBalance > 0 ? Math.round((Math.max(0, balance.totalWalletBalance - maxAllocatedCapital) / balance.totalWalletBalance) * 100) : 0}%)
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Highlighted AI Dynamic TP/SL & Multi-Target System Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 space-y-3.5 shadow-lg">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                  <Sparkles className="w-4 h-4" />
                  <span>{language === 'ar' ? 'نظام الذكاء الاصطناعي للأهداف المتعددة وتأمين الأرباح' : 'AI Autonomous Multi-Target & Profit Lock System'}</span>
                </div>

                {/* AI Dynamic TP/SL Toggle */}
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div>
                    <div className="font-semibold text-white">
                      {language === 'ar' ? 'تحكم الذكاء الاصطناعي الذاتي في جني الأرباح ووقف الخسارة' : 'Autonomous AI TP/SL Determination'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      {language === 'ar'
                        ? 'يقوم البوت تلقائياً بحساب 3 أهداف ربح (TP1, TP2, TP3) ومستوى وقف الخسارة الدقيق بناءً على تقلبات وتحليل العملة'
                        : 'Bot dynamically computes TP1, TP2, TP3 targets and volatility-anchored stop loss'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={aiDynamicTargets}
                    onChange={(e) => setAiDynamicTargets(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer shrink-0"
                  />
                </div>

                {/* Multi-Target Progressive Trailing Stop Toggle */}
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div>
                    <div className="font-semibold text-white">
                      {language === 'ar' ? 'نظام حجز الأرباح ونقل الوقف للهدف المحقق (TP1 ➔ TP2 ➔ TP3)' : 'Multi-Target Progressive Profit Lock'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      {language === 'ar'
                        ? 'عند تحقيق الهدف الأول (TP1)، ينقل البوت وقف الخسارة فوراً لمكان الهدف الأول لحجز الربح؛ وعند تحقيق TP2 ينقله للهدف الثاني، حتى تحقيق TP3!'
                        : 'When TP1 is reached, SL shifts to TP1 to guarantee profit. When TP2 is reached, SL shifts to TP2.'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={multiTargetTrailing}
                    onChange={(e) => setMultiTargetTrailing(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer shrink-0"
                  />
                </div>

                {/* Unlimited Hold Time Toggle (No Forced Early Expiry) */}
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div>
                    <div className="font-semibold text-white">
                      {language === 'ar' ? 'إبقاء الصفقات الرابحة دون حد زمني تعسفي' : 'Unlimited Hold Duration (Let Profits Run)'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      {language === 'ar'
                        ? 'لا يتم إغلاق الصفقة بعد 15 دقيقة أو ساعة بالإجبار طالما الصفقة واعدة وتسير نحو الأهداف مع حماية الوقف المتحرك'
                        : 'Trades are not forcibly closed on arbitrary time expiry; trailing stop protects capital.'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={unlimitedHoldTime}
                    onChange={(e) => setUnlimitedHoldTime(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer shrink-0"
                  />
                </div>
              </div>
              {/* Max Concurrent Positions */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-amber-400" />
                    <span>{t.concurrentPositionsLabel}</span>
                  </label>
                  <span className="font-mono font-bold text-amber-400 px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                    {maxConcurrent} {language === 'ar' ? 'صفقات في وقت واحد' : 'positions'}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={15}
                  value={maxConcurrent}
                  onChange={(e) => setMaxConcurrent(parseInt(e.target.value, 10))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>1 ({language === 'ar' ? 'حذر جداً' : 'Conservative'})</span>
                  <span>5 ({language === 'ar' ? 'متوازن' : 'Balanced'})</span>
                  <span>15 ({language === 'ar' ? 'نشط جداً' : 'Aggressive'})</span>
                </div>
              </div>

              {/* Position Size ($ USD) */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="font-semibold text-slate-200">
                    {t.positionSizeLabel}
                  </label>
                  <span className="font-mono font-bold text-white text-sm">
                    ${positionSize.toFixed(2)} USDT
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {sizePresets.map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setPositionSize(sz)}
                      className={`px-2 py-1 rounded-lg font-mono text-[11px] transition ${
                        positionSize === sz
                          ? 'bg-amber-500 text-black font-bold'
                          : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      ${sz}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  step={0.5}
                  min={0.5}
                  max={5000}
                  value={positionSize}
                  onChange={(e) => setPositionSize(parseFloat(e.target.value) || 1)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Leverage (1x to 150x) */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="font-semibold text-slate-200">
                    {t.leverageLabel}
                  </label>
                  <span className="font-mono font-bold text-amber-400 text-sm">
                    {leverage}x
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {leveragePresets.map((lev) => (
                    <button
                      key={lev}
                      type="button"
                      onClick={() => setLeverage(lev)}
                      className={`px-2.5 py-1 rounded-lg font-mono text-[11px] transition ${
                        leverage === lev
                          ? 'bg-amber-500 text-black font-bold'
                          : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {lev}x
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={1}
                  max={150}
                  value={leverage}
                  onChange={(e) => setLeverage(parseInt(e.target.value, 10))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
                <p className="text-[11px] text-amber-500/80 mt-1">
                  {t.leverageWarning}
                </p>
              </div>

              {/* Allowed Trade Direction */}
              <div>
                <label className="block font-semibold text-slate-200 mb-1.5">
                  {t.directionLabel}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setDirection('BOTH')}
                    className={`py-2 px-3 rounded-xl font-medium border text-center transition ${
                      direction === 'BOTH'
                        ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.directionBoth}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection('LONG_ONLY')}
                    className={`py-2 px-3 rounded-xl font-medium border text-center transition ${
                      direction === 'LONG_ONLY'
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.directionLongOnly}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection('SHORT_ONLY')}
                    className={`py-2 px-3 rounded-xl font-medium border text-center transition ${
                      direction === 'SHORT_ONLY'
                        ? 'bg-rose-500/20 border-rose-400 text-rose-300 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.directionShortOnly}
                  </button>
                </div>
              </div>

              {/* Max Trade Duration (Scalp focus) */}
              <div>
                <label className="block font-semibold text-slate-200 mb-1.5">
                  {t.maxDurationLabel}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { val: 0.25, label: t.fifteenMin },
                    { val: 1, label: t.oneHour },
                    { val: 4, label: t.fourHours },
                    { val: 24, label: t.twentyFourHours },
                  ].map((dur) => (
                    <button
                      key={dur.val}
                      type="button"
                      onClick={() => setMaxDurationHours(dur.val)}
                      className={`p-2 rounded-xl border text-center transition ${
                        maxDurationHours === dur.val
                          ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {dur.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Risk Controls: TP / SL / Trailing */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">
                    {t.takeProfitLabel}
                  </label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.5}
                    max={20}
                    value={takeProfit}
                    onChange={(e) => setTakeProfit(parseFloat(e.target.value) || 2)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">
                    {t.stopLossLabel}
                  </label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.2}
                    max={10}
                    value={stopLoss}
                    onChange={(e) => setStopLoss(parseFloat(e.target.value) || 1)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">
                    {t.dailyDrawdownLabel}
                  </label>
                  <input
                    type="number"
                    step={0.5}
                    min={1}
                    max={25}
                    value={dailyDrawdown}
                    onChange={(e) => setDailyDrawdown(parseFloat(e.target.value) || 5)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Trailing Stop Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <div>
                  <div className="font-semibold text-white">
                    {t.trailingStopLabel}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {language === 'ar' ? 'يحرك وقف الخسارة تلقائياً لتأمين الأرباح مع صعود السعر' : 'Dynamically locks in profits as the market moves favorably'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={useTrailing}
                  onChange={(e) => setUseTrailing(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                />
              </div>

              <button
                onClick={handleSaveStrategy}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{t.saveSettings}</span>
              </button>
            </div>
          )}

          {/* TAB 2: BINANCE API CREDENTIALS & MULTI-WALLET PROFILES */}
          {/* TAB 2: BINANCE API CREDENTIALS & MULTI-WALLET PROFILES (SERVER-SIDE SECURE) */}
          {activeTab === 'api' && (
            <div className="space-y-4">
              {/* Institutional Architecture & Security Banner */}
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 leading-relaxed space-y-1.5">
                <div className="font-bold flex items-center gap-1.5 text-emerald-400">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>
                    {language === 'ar'
                      ? '🔒 حماية معمارية مشددة: المفاتيح مقروءة حصرياً على الخادم (Server-Side Secrets)'
                      : '🔒 Institutional Security: Binance Keys Loaded Server-Side Only'}
                  </span>
                </div>
                <p className="text-[11px] text-emerald-200/90 leading-normal">
                  {language === 'ar'
                    ? 'لحماية حسابك ضد تسريب بيانات الاعتماد، تم إلغاء أي إدخال أو تخزين لـ API Secret داخل المتصفح أو localStorage. يتم تمرير المفاتيح وتوقيع الطلبات HMAC-SHA256 حصرياً عبر بيئة الخادم (.env).'
                    : 'To guarantee absolute credential protection, Binance API secrets are never stored in browser memory/localStorage or sent by the client. Keys are loaded and HMAC signatures are computed server-side via environment variables.'}
                </p>
              </div>

              {/* SERVER ENVIRONMENT CREDENTIALS STATUS */}
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <Server className="w-4 h-4 text-amber-400" />
                    <span>
                      {language === 'ar'
                        ? 'حالة تكوين المفاتيح على الخادم (.env Status)'
                        : 'Server Environment Credentials Status'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      BinanceService.checkServerConfigStatus(isTestnet).then((status) => {
                        setServerConfig({
                          testnetConfigured: status.testnetConfigured,
                          prodConfigured: status.prodConfigured,
                        });
                      });
                    }}
                    className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{language === 'ar' ? 'تحديث الفحص' : 'Refresh'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                    <div className="text-[11px] text-slate-400 flex items-center justify-between">
                      <span className="font-semibold text-slate-300">Testnet (Futures):</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          serverConfig.testnetConfigured
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {serverConfig.testnetConfigured ? '✓ Configured' : '○ Not Set'}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-slate-500 truncate">
                      BINANCE_TESTNET_API_KEY
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                    <div className="text-[11px] text-slate-400 flex items-center justify-between">
                      <span className="font-semibold text-slate-300">Production (Live):</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          serverConfig.prodConfigured
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-700/50 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {serverConfig.prodConfigured ? '✓ Configured' : '○ Locked / Not Set'}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-slate-500 truncate">
                      BINANCE_API_KEY
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION: MULTI-WALLET PROFILES MANAGER */}
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-amber-400" />
                    <span className="font-bold text-white text-xs">
                      {language === 'ar' ? 'إدارة محافظ بينانس وتخصيص الاسم' : 'Binance Wallet Profiles'}
                    </span>
                  </div>

                  <button
                    onClick={() => setIsAddingNewWallet(!isAddingNewWallet)}
                    className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[11px] font-bold transition flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{language === 'ar' ? 'إضافة محفظة ثانية' : 'Add Another Wallet'}</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-400 leading-normal">
                  {language === 'ar'
                    ? 'يمكنك تسمية وتنظيم المحافظ لمتابعة التداول في الشريط العلوي.'
                    : 'Manage named wallet profiles. Profile names appear at the top header alongside the Binance badge.'}
                </p>

                {/* Wallets List / Switcher */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {wallets.map((w) => {
                    const isActive = w.id === activeWalletId;
                    return (
                      <div
                        key={w.id}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 transition ${
                          isActive
                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 shadow-sm'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isActive ? 'bg-amber-400 ring-2 ring-amber-400/30' : 'bg-slate-600'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{w.name}</div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                              <span>Binance</span>
                              {w.isTestnet && <span className="text-amber-400">(Testnet)</span>}
                              {w.isValidated ? (
                                <span className="text-emerald-400">✓ {language === 'ar' ? 'متصل' : 'Connected'}</span>
                              ) : (
                                <span className="text-slate-500">○ {language === 'ar' ? 'غير متصل' : 'Offline'}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {!isActive && (
                            <button
                              onClick={() => switchWallet(w.id)}
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-200 transition cursor-pointer"
                            >
                              {language === 'ar' ? 'تفعيل' : 'Switch'}
                            </button>
                          )}
                          {wallets.length > 1 && (
                            <button
                              onClick={() => deleteWalletProfile(w.id)}
                              className="p-1 rounded text-slate-500 hover:text-rose-400 transition cursor-pointer"
                              title="Delete Wallet"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Form to add a new wallet */}
                {isAddingNewWallet && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/30 space-y-2.5 mt-2 animate-fadeIn">
                    <div className="font-bold text-xs text-amber-300 flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" />
                      <span>{language === 'ar' ? 'إضافة اسم محفظة جديد:' : 'Add New Wallet Profile:'}</span>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        {language === 'ar' ? 'اسم المحفظة (مثلاً: محفظة التداول السريع):' : 'Wallet Name:'}
                      </label>
                      <input
                        type="text"
                        value={newWalletName}
                        onChange={(e) => setNewWalletName(e.target.value)}
                        placeholder="e.g. My Second Binance Profile"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="new-testnet-check"
                        checked={newWalletIsTestnet}
                        onChange={(e) => setNewWalletIsTestnet(e.target.checked)}
                        className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer"
                      />
                      <label htmlFor="new-testnet-check" className="text-[11px] text-slate-300 cursor-pointer">
                        {t.isTestnetLabel}
                      </label>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleAddNewWallet}
                        disabled={!newWalletName.trim()}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition disabled:opacity-40 cursor-pointer"
                      >
                        {language === 'ar' ? 'حفظ وإضافة المحفظة' : 'Save & Add Wallet'}
                      </button>
                      <button
                        onClick={() => setIsAddingNewWallet(false)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition cursor-pointer"
                      >
                        {language === 'ar' ? 'إلغاء' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* CURRENT ACTIVE WALLET CONFIGURATION */}
              <div className="space-y-3 pt-1">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-semibold text-slate-200">
                      {language === 'ar' ? 'اسم المحفظة المخصص (يظهر في الأعلى):' : 'Custom Wallet Display Name:'}
                    </label>
                    <span className="text-[10px] text-amber-400 font-medium">
                      {language === 'ar' ? 'يظهر بجانب باينانس' : 'Displayed next to Binance badge'}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={walletName}
                    onChange={(e) => setWalletName(e.target.value)}
                    placeholder="مثال: محفظة بافلي الأساسية"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-amber-400"
                  />
                  {/* Visual Preview */}
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
                    <span>{language === 'ar' ? 'معاينة في الشريط العلوي:' : 'Top Bar Preview:'}</span>
                    <span className="inline-flex items-center gap-1 font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                      <Wallet className="w-3 h-3 text-amber-400" />
                      <span>{walletName || (language === 'ar' ? 'محفظة بافلي' : 'Bavly Wallet')}</span>
                      <span className="text-[9px] bg-amber-400/20 text-amber-300 px-1 rounded">
                        {language === 'ar' ? 'من باينانس' : 'Binance'}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <input
                    type="checkbox"
                    id="testnet-check"
                    checked={isTestnet}
                    onChange={(e) => setIsTestnet(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                  <label htmlFor="testnet-check" className="text-slate-300 cursor-pointer text-xs">
                    {t.isTestnetLabel}
                  </label>
                </div>
              </div>

              {/* Status / Error feedback */}
              {apiStatus === 'connected' && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{t.apiValidSuccess}</span>
                </div>
              )}

              {apiStatus === 'error' && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
                  <div className="font-bold">{t.apiValidFailed}</div>
                  <div className="text-[11px] mt-1 font-mono text-rose-300">
                    {apiErrorMessage}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={handleSaveApi}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition cursor-pointer"
                >
                  {language === 'ar' ? 'حفظ إعدادات المحفظة' : 'Save Profile Settings'}
                </button>

                <button
                  onClick={async () => {
                    handleSaveApi();
                    await validateCredentials({
                      id: activeWalletId,
                      walletName,
                      isTestnet,
                      isValidated: false,
                    });
                  }}
                  disabled={isValidatingApi}
                  className="py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10 disabled:opacity-40 cursor-pointer"
                >
                  {isValidatingApi ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{language === 'ar' ? 'جارٍ الفحص...' : 'Checking...'}</span>
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4" />
                      <span>{language === 'ar' ? 'فحص والتحقق من اتصال الخادم' : 'Verify Server Connection'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: NOTIFICATIONS & TELEGRAM ALERTS */}
          {activeTab === 'notifications' && (
            <div className="space-y-4">
              {/* Screen Toast Alerts Switch (Solves user complaint about notifications blocking UI) */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-white text-xs flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-amber-400" />
                      <span>{language === 'ar' ? 'التنبيهات المنبثقة اللحظية على الشاشة (Toast Alerts)' : 'Real-Time Screen Toast Notifications'}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      {language === 'ar'
                        ? 'يمكنك إلغاء تفعيل هذا الخيار لإخفاء كافة الإشعارات المنبثقة نهائياً من على الشاشة حتى لا تحجب الجداول والموقع.'
                        : 'Toggle off to completely mute on-screen popup alerts and keep the workspace unobstructed.'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={enableToastAlerts}
                    onChange={(e) => setEnableToastAlerts(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer shrink-0"
                  />
                </div>
              </div>

              {/* Telegram Alerts Setup */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <div className="text-xs text-slate-300 leading-relaxed font-sans">
                  {language === 'ar'
                    ? 'احصل على إشعارات فورية على هاتفك عبر تطبيق تلجرام عند قيام البوت بفتح أو إغلاق الصفقات أو تحقيق الأهداف.'
                    : 'Receive instant push alerts on your phone via Telegram when the bot enters or exits any futures position.'}
                </div>

                {/* Enable Telegram Switch */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <label className="font-semibold text-white cursor-pointer">
                    {t.telegramEnable}
                  </label>
                  <input
                    type="checkbox"
                    checked={telegramSettings.enabled}
                    onChange={(e) => updateTelegramSettings({ enabled: e.target.checked })}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </div>

                {/* Bot Token */}
                <div>
                  <label className="block font-semibold text-slate-200 mb-1">
                    {t.telegramBotToken}
                  </label>
                  <input
                    type="text"
                    value={telegramSettings.botToken}
                    onChange={(e) => updateTelegramSettings({ botToken: e.target.value })}
                    placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                {/* Chat ID */}
                <div>
                  <label className="block font-semibold text-slate-200 mb-1">
                    {t.telegramChatId}
                  </label>
                  <input
                    type="text"
                    value={telegramSettings.chatId}
                    onChange={(e) => updateTelegramSettings({ chatId: e.target.value })}
                    placeholder="e.g. 987654321 or @your_channel"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                {/* Status message */}
                {telegramStatusMsg && (
                  <div
                    className={`p-3 rounded-xl border text-xs font-medium ${
                      telegramStatusMsg.ok
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                    }`}
                  >
                    {telegramStatusMsg.text}
                  </div>
                )}

                {/* Test Button */}
                <button
                  onClick={handleTestTelegram}
                  disabled={isTestingTelegram || !telegramSettings.botToken || !telegramSettings.chatId}
                  className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-40"
                >
                  {isTestingTelegram ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Sending test...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>{t.testTelegram}</span>
                    </>
                  )}
                </button>
              </div>

              {/* Save Notifications Button */}
              <button
                onClick={handleSaveStrategy}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{language === 'ar' ? 'حفظ إعدادات التنبيهات' : 'Save Notification Settings'}</span>
              </button>
            </div>
          )}

          {/* TAB 4: RESET HISTORY & BALANCE */}
          {activeTab === 'reset' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-3">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                  <Clock className="w-4 h-4" />
                  <span>{language === 'ar' ? 'تصفير وإعادة تعيين سجل الصفقات القديمة' : 'Clear Old Trade History & Start Fresh'}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {language === 'ar'
                    ? 'إذا كان لديك صفقات قديمة خاسرة سجلها البوت قبل تفعيل الاستراتيجية المطورة (TP1/TP2/TP3)، يمكنك مسح كافة الصفقات السابقة وإعادة تعيين الرصيد التجريبي إلى $1,000 لبدء تقييم جديد بنسبة نجاح نقية.'
                    : 'If you have prior losing trades logged before the Multi-Target algorithm was activated, you can wipe trade history and restart with a clean slate.'}
                </p>

                {hasReset && (
                  <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold text-center">
                    ✓ {language === 'ar' ? 'تم تصفير وإعادة ضبط سجل الصفقات بنجاح!' : 'Trade history and simulation balance reset successfully!'}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleResetHistory}
                  className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-rose-600/20"
                >
                  <X className="w-4 h-4" />
                  <span>{language === 'ar' ? 'تصفير السجل وإعادة تعيين الرصيد الآن' : 'Clear History & Reset Balance Now'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer / Toast */}
        {showSavedToast && (
          <div className="bg-emerald-500 text-black font-bold text-xs py-2 px-4 text-center animate-in slide-in-from-bottom">
            {t.settingsSaved}
          </div>
        )}
      </div>
    </div>
  );
};
