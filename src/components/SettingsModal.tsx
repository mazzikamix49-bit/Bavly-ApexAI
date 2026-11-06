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
  Eye,
  EyeOff,
} from 'lucide-react';
import { BinanceService } from '../services/binanceService';
import { TelegramService } from '../services/telegramService';
import { RiskManagementService } from '../services/riskManagementService';
import { EncryptedStorageService } from '../services/encryptedStorageService';
import { AllowedDirection, CapitalProfile, DEFAULT_CAPITAL_PROFILE, PositionSizingMode } from '../types/trading';

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
    cleanAllCacheAndReset,
    balance,
    positions,
    clearAllToasts,
  } = useTrading();

  const isArabic = language === 'ar';
  const [activeTab, setActiveTab] = useState<'strategy' | 'api' | 'notifications' | 'reset'>('strategy');

  // Local state for credentials & wallet profiles
  const [walletName, setWalletName] = useState(activeWallet?.name || 'محفظة بافلي بينانس (Bavly Futures)');
  const [isTestnet, setIsTestnet] = useState(credentials.isTestnet);
  const [apiKey, setApiKey] = useState(credentials.apiKey || '');
  const [apiSecret, setApiSecret] = useState(credentials.apiSecret || '');
  const [showSecret, setShowSecret] = useState(false);
  const [hasCleanedCache, setHasCleanedCache] = useState(false);
  const [isCleaningCache, setIsCleaningCache] = useState(false);
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
      setApiKey(activeWallet.apiKey || credentials.apiKey || '');
      setApiSecret(activeWallet.apiSecret || credentials.apiSecret || '');
    }
  }, [activeWalletId, credentials.id, credentials.apiKey, credentials.apiSecret]);

  // Local state for strategy
  const [maxConcurrent, setMaxConcurrent] = useState(settings.maxConcurrentPositions);
  const [positionSize, setPositionSize] = useState(settings.positionSizeUsd);
  const [positionSizingMode, setPositionSizingMode] = useState<PositionSizingMode>(
    settings.positionSizingMode || 'RISK_PORTFOLIO_DYNAMIC'
  );
  const [leverage, setLeverage] = useState(settings.leverage);
  const [direction, setDirection] = useState<AllowedDirection>(settings.allowedDirection);
  const [maxDurationHours, setMaxDurationHours] = useState(settings.maxTradeDurationHours);
  const [trailingStop, setTrailingStop] = useState(settings.trailingStopPercent);
  const [useTrailing, setUseTrailing] = useState(settings.useTrailingStop);
  const [minConfidence, setMinConfidence] = useState(settings.minAiConfidence);
  const [multiTargetTrailing, setMultiTargetTrailing] = useState(settings.multiTargetTrailing ?? true);
  const [unlimitedHoldTime, setUnlimitedHoldTime] = useState(settings.unlimitedHoldTime ?? true);
  const [scalpingMode, setScalpingMode] = useState(settings.scalpingMode ?? false);
  const [scalpingDurationMinutes, setScalpingDurationMinutes] = useState(settings.scalpingDurationMinutes || 15);
  const [scalpingProfitLockPercent, setScalpingProfitLockPercent] = useState(settings.scalpingProfitLockPercent || 25);
  const [enableToastAlerts, setEnableToastAlerts] = useState(settings.enableToastAlerts ?? true);

  // Reset confirmation state
  const [hasReset, setHasReset] = useState(false);

  // Telegram test state
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramStatusMsg, setTelegramStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Saved notification toast
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [savedToastText, setSavedToastText] = useState('');
  const [isSavingApi, setIsSavingApi] = useState(false);

  if (!isOpen) return null;

  const handleSaveApi = async () => {
    setIsSavingApi(true);
    setCustomWalletName(walletName);
    const trimmedKey = apiKey.trim();
    const trimmedSecret = apiSecret.trim();

    updateCredentials({
      walletName,
      isTestnet,
      apiKey: trimmedKey,
      apiSecret: trimmedSecret,
    });
    saveWalletProfile({
      id: activeWalletId,
      name: walletName,
      isTestnet,
      apiKey: trimmedKey,
      apiSecret: trimmedSecret,
      isValidated: credentials.isValidated,
    });

    if (trimmedKey && trimmedSecret) {
      try {
        const res = await BinanceService.saveCredentials({
          isTestnet,
          apiKey: trimmedKey,
          apiSecret: trimmedSecret,
        });
        if (res.success) {
          setServerConfig((prev) => ({
            ...prev,
            [isTestnet ? 'testnetConfigured' : 'prodConfigured']: true,
          }));
        }
      } catch (err: any) {
        console.warn('Failed to save credentials to backend disk:', err);
      }

      try {
        await EncryptedStorageService.saveCredentials({
          apiKey: trimmedKey,
          apiSecret: trimmedSecret,
          isTestnet,
          walletName,
        });
      } catch (err: any) {
        console.warn('Failed to save encrypted credentials locally:', err);
      }
    }

    setIsSavingApi(false);
    setSavedToastText(
      isArabic
        ? '✓ تم تشفير وحفظ المفاتيح بنجاح (AES-GCM) وثبتت في المتصفح وعلى السيرفر!'
        : '✓ API keys encrypted (AES-GCM) & saved permanently across browser refreshes & server!'
    );
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 3500);
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
    // Pure AI autonomous mode:
    // 1. Capital limits are completely removed and disabled (enableCapitalLimit = false, maxAllocatedCapitalUsd = 0)
    // 2. Capital profile operates in auto mode (capitalUsd = 0) with zero circuit breaker disruption (maxDailyLossPercent = 0)
    // 3. Take Profit (TP1, TP2, TP3) and Stop Loss (SL) are computed 100% dynamically by the AI & ATR engine (aiDynamicTargets = true)
    // 4. Daily drawdown cap is stopped/disabled (maxDailyDrawdownPercent = 0) so the bot trades continuously without arbitrary freeze
    updateSettings({
      capitalProfile: {
        capitalUsd: 0,
        riskPerTradePercent: 1.0,
        maxDailyLossPercent: 0,
        maxOpenPositions: maxConcurrent,
      },
      maxConcurrentPositions: maxConcurrent,
      riskPerTradePercent: 1.0,
      positionSizeUsd: positionSize,
      positionSizingMode,
      leverage,
      allowedDirection: direction,
      maxTradeDurationHours: maxDurationHours,
      takeProfitPercent: 0,
      stopLossPercent: 0,
      trailingStopPercent: trailingStop,
      useTrailingStop: useTrailing,
      maxDailyDrawdownPercent: 0,
      maxConsecutiveLosses: 0,
      lossCooldownMinutes: 0,
      minAiConfidence: minConfidence,
      aiDynamicTargets: true,
      multiTargetTrailing,
      unlimitedHoldTime: scalpingMode ? (scalpingDurationMinutes === 0) : unlimitedHoldTime,
      scalpingMode,
      scalpingDurationMinutes,
      scalpingProfitLockPercent,
      enableToastAlerts,
      enableCapitalLimit: false,
      maxAllocatedCapitalUsd: 0,
    });
    setSavedToastText(t.settingsSaved);
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
              {/* Autonomous AI Architecture Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/15 via-slate-900/90 to-slate-900 border border-amber-500/35 space-y-3.5 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                    <Sparkles className="w-4 h-4" />
                    <span>{isArabic ? 'الأتمتة الشاملة بالذكاء الاصطناعي (Full AI Automation)' : 'Full AI Autonomous Engine'}</span>
                  </div>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold border border-emerald-500/30">
                    {isArabic ? '🤖 نشط وتلقائي بالكامل' : '🤖 100% AUTONOMOUS'}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-slate-200">
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {isArabic
                      ? 'تم إلغاء كافة الإعدادات والنسب المئوية اليدوية والقيود المفروضة على المحفظة بالكامل. البوت يعمل الآن بأتمتة كاملة، ويقوم بتحديد نقاط أخذ الأرباح (TP1, TP2, TP3) ومستوى وقف الخسارة (Stop Loss) وإدارة المخاطرة تلقائياً بالاعتماد على خوارزميات الذكاء الاصطناعي، ومؤشر التقلب اللحظي (ATR)، وسلوك السوق التاريخي.'
                      : 'All manual percentage inputs and capital limit restrictions have been removed. The bot runs with 100% autonomous quantitative algorithms, calculating dynamic TP1/TP2/TP3 targets and ATR-anchored stop loss based on AI intelligence and market regime.'}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 font-mono text-[10px]">
                    <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                      <div className="text-slate-400">{isArabic ? 'أهداف أخذ الربح' : 'Take Profit'}</div>
                      <div className="text-amber-400 font-bold">{isArabic ? 'ذكاء اصطناعي (TP1/2/3)' : 'AI Dynamic'}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                      <div className="text-slate-400">{isArabic ? 'وقف الخسارة' : 'Stop Loss'}</div>
                      <div className="text-emerald-400 font-bold">{isArabic ? 'ديناميكي (ATR)' : 'Dynamic ATR'}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                      <div className="text-slate-400">{isArabic ? 'إدارة الرصيد' : 'Capital Allocation'}</div>
                      <div className="text-cyan-400 font-bold">{isArabic ? 'تلقائي كامل' : 'Full Auto'}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Highlighted AI Dynamic TP/SL & Multi-Target System Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 space-y-3.5 shadow-lg">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                  <Sparkles className="w-4 h-4" />
                  <span>{language === 'ar' ? 'نظام الذكاء الاصطناعي للأهداف المتعددة وتأمين الأرباح' : 'AI Autonomous Multi-Target & Profit Lock System'}</span>
                </div>

                {/* AI Dynamic TP/SL Status */}
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div>
                    <div className="font-semibold text-white">
                      {language === 'ar' ? 'تحكم الذكاء الاصطناعي الذاتي في جني الأرباح ووقف الخسارة' : 'Autonomous AI TP/SL Determination'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      {language === 'ar'
                        ? 'يقوم البوت تلقائياً بحساب 3 أهداف ربح (TP1, TP2, TP3) ومستوى وقف الخسارة الدقيق بناءً على تقلبات وتحليل العملة دون أي نسب يدوية'
                        : 'Bot dynamically computes TP1, TP2, TP3 targets and volatility-anchored stop loss without static percentages'}
                    </div>
                  </div>
                  <span className="text-[10px] px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/30 shrink-0">
                    {language === 'ar' ? 'مفعل دائماً ✓' : 'ALWAYS ACTIVE ✓'}
                  </span>
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
                    checked={unlimitedHoldTime && !scalpingMode}
                    disabled={scalpingMode}
                    onChange={(e) => setUnlimitedHoldTime(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer shrink-0 disabled:opacity-40"
                  />
                </div>

                {/* Fast Scalping Mode ("أنتش واجري" / Hit & Run) */}
                <div className={`p-4 rounded-xl border transition-all ${
                  scalpingMode
                    ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/20'
                    : 'bg-slate-900/80 border-slate-800'
                } space-y-3`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white flex items-center gap-2">
                          <span>{isArabic ? '⚡ وضع السكالبينج السريع الاحترافي (أنتش واجري / Hit & Run)' : '⚡ Fast Scalping Mode (Hit & Run Profit Locking)'}</span>
                          <span className="text-[10px] bg-amber-500/20 text-amber-300 font-mono px-1.5 py-0.5 rounded border border-amber-500/30">
                            {isArabic ? 'نشط وسريع' : 'High Velocity'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                          {isArabic
                            ? 'اقتناص أرباح سريعة ومضمونة (15% إلى 35% ROI) وتأمينها فوراً في المحفظة وتحرير الهامش لصفقات جديدة دون تجميد الأموال لساعات.'
                            : 'Harvests rapid momentum profits (15% to 35% ROI), cashing out directly to wallet and freeing margin instead of leaving capital frozen for hours.'}
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={scalpingMode}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setScalpingMode(val);
                        if (val) setUnlimitedHoldTime(false);
                      }}
                      className="w-5 h-5 accent-amber-500 rounded cursor-pointer shrink-0"
                    />
                  </div>

                  {/* Golden Safety Rule Note */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/90 text-[11px] text-slate-300 flex items-start gap-2 leading-relaxed">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-emerald-400">
                        {isArabic ? 'قاعدة الأمان الذهبية: ' : 'Capital Protection Rule: '}
                      </span>
                      <span>
                        {isArabic
                          ? 'الصفقات الخاسرة لا تُغلق تعسفياً بمرور الـ 15 دقيقة أبداً! التوقيت مخصص فقط لحصد الأرباح الرابحة ("أنتش واجري")، بينما الصفقات الخاسرة تظل محمية بوقف الخسارة Stop Loss أو الإغلاق الوقائي الذكي.'
                          : 'Losing positions are NEVER exited on timer! The time limit strictly applies to harvesting profits. Losing trades stay guarded by structural Stop Loss.'}
                      </span>
                    </div>
                  </div>

                  {scalpingMode && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-4">
                      {/* Target Profit % Selector & Custom Input */}
                      <div className="bg-slate-950/70 p-3 rounded-xl border border-amber-500/20">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[11px] text-slate-200 font-bold flex items-center gap-1.5">
                            <span>🎯 {isArabic ? 'هدف حصد الربح السريع ("أنتش واجري"):' : 'Hit & Run Profit Target ROI:'}</span>
                          </span>
                          <span className="font-mono font-bold text-amber-400 text-xs px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
                            +{scalpingProfitLockPercent}% ROI
                          </span>
                        </div>

                        {/* Presets Grid */}
                        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 font-mono text-[11px] mb-2">
                          {[10, 15, 20, 25, 30, 35, 50, 75].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => setScalpingProfitLockPercent(pct)}
                              className={`py-1.5 rounded-lg border text-center transition ${
                                scalpingProfitLockPercent === pct
                                  ? 'bg-amber-500 text-black font-bold border-amber-400 shadow-md shadow-amber-500/20'
                                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
                              }`}
                            >
                              +{pct}%
                            </button>
                          ))}
                        </div>

                        {/* Direct Custom ROI % Input */}
                        <div className="flex items-center gap-2 pt-1 border-t border-slate-800/60">
                          <label className="text-[10px] text-slate-400 whitespace-nowrap">
                            {isArabic ? 'أو اكتب النسبة المخصصة يدويًا:' : 'Or enter custom target %:'}
                          </label>
                          <div className="relative flex-1">
                            <input
                              type="number"
                              min="5"
                              max="1000"
                              step="1"
                              value={scalpingProfitLockPercent}
                              onChange={(e) => setScalpingProfitLockPercent(Math.max(5, Math.min(1000, Number(e.target.value) || 25)))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-amber-400 focus:outline-none focus:border-amber-400"
                              placeholder="مثال: 35"
                            />
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500 pointer-events-none">
                              % ROI
                            </span>
                          </div>
                        </div>

                        <div className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                          {isArabic
                            ? '💡 بمجرد وصول أي صفقة لهذه النسبة (أو أعلى)، يقوم المحرك فوراً بإغلاقها بالكامل وحصد الأرباح إلى المحفظة بدون انتظار.'
                            : '💡 As soon as a trade reaches this ROI (or higher), the engine immediately cashes out into wallet.'}
                        </div>
                      </div>

                      {/* Scalp Duration Limit & Unlimited Options */}
                      <div className="bg-slate-950/70 p-3 rounded-xl border border-blue-500/20">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[11px] text-slate-200 font-bold flex items-center gap-1.5">
                            <span>⏱️ {isArabic ? 'أقصى وقت للمركز الرابح (حصد وتدوير السيولة):' : 'Max Duration for Winning Trade:'}</span>
                          </span>
                          <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded border ${
                            scalpingDurationMinutes === 0
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                          }`}>
                            {scalpingDurationMinutes === 0
                              ? (isArabic ? '♾️ مفتوح (Unlimited)' : '♾️ Unlimited')
                              : `${scalpingDurationMinutes} ${isArabic ? 'دقيقة' : 'min'}`}
                          </span>
                        </div>

                        {/* Presets Grid */}
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 font-mono text-[11px] mb-2">
                          {[
                            { value: 15, label: isArabic ? '15 دقيقة' : '15m' },
                            { value: 30, label: isArabic ? '30 دقيقة' : '30m' },
                            { value: 45, label: isArabic ? '45 دقيقة' : '45m' },
                            { value: 60, label: isArabic ? '60 دقيقة' : '60m' },
                            { value: 90, label: isArabic ? '90 دقيقة' : '90m' },
                            { value: 0, label: isArabic ? '♾️ مفتوح' : '♾️ Open' },
                          ].map((item) => (
                            <button
                              key={item.value}
                              type="button"
                              onClick={() => setScalpingDurationMinutes(item.value)}
                              className={`py-1.5 rounded-lg border text-center transition ${
                                scalpingDurationMinutes === item.value
                                  ? item.value === 0
                                    ? 'bg-emerald-500 text-black font-bold border-emerald-400 shadow-md shadow-emerald-500/20'
                                    : 'bg-blue-500 text-white font-bold border-blue-400 shadow-md shadow-blue-500/20'
                                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>

                        {/* Direct Custom Minutes Input */}
                        <div className="flex items-center gap-2 pt-1 border-t border-slate-800/60">
                          <label className="text-[10px] text-slate-400 whitespace-nowrap">
                            {isArabic ? 'أو اكتب الدقائق مخصصة (0 = غير محدد):' : 'Or enter custom minutes (0 = open):'}
                          </label>
                          <div className="relative flex-1">
                            <input
                              type="number"
                              min="0"
                              max="1440"
                              step="5"
                              value={scalpingDurationMinutes}
                              onChange={(e) => setScalpingDurationMinutes(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-blue-400 focus:outline-none focus:border-blue-400"
                              placeholder="0 = مفتوح"
                            />
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500 pointer-events-none">
                              {scalpingDurationMinutes === 0 ? (isArabic ? 'مفتوح' : 'Unlimited') : (isArabic ? 'دقيقة' : 'min')}
                            </span>
                          </div>
                        </div>

                        {/* Informative Status Card */}
                        <div className="mt-2.5 p-2 rounded-lg bg-slate-900/80 border border-slate-800 text-[10px] leading-relaxed">
                          {scalpingDurationMinutes === 0 ? (
                            <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
                              <span>🟢</span>
                              <span>
                                {isArabic
                                  ? `وضع مفتوح بدون قيد زمني: الصفقة لن تُغلق بمرور الوقت نهائياً، وستظل مستمرة بحرية حتى تحقق هدف الربح (+${scalpingProfitLockPercent}%) أو تضرب وقف الخسارة الوقائي.`
                                  : `Unlimited Duration: Trade will NEVER close on elapsed time. It will strictly run until hitting +${scalpingProfitLockPercent}% ROI or stop loss.`}
                              </span>
                            </div>
                          ) : (
                            <div className="text-blue-300 font-medium flex items-center gap-1.5">
                              <span>⏱️</span>
                              <span>
                                {isArabic
                                  ? `إغلاق وتدوير بعد ${scalpingDurationMinutes} دقيقة: إذا انقضت هذه المدة والصفقة محققة ربحاً، يتم حصد الأرباح وتحرير رأس المال. وإذا وصلت للهدف (+${scalpingProfitLockPercent}%) في أي وقت قبل انتهاء المدة تُغلق فوراً.`
                                  : `Time Exit after ${scalpingDurationMinutes}m: If trade is in profit at this cutoff, profits are harvested to free capital. Instant exit triggers whenever +${scalpingProfitLockPercent}% target is hit.`}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
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

              {/* Dual Sizing Control (الخيار في أيدينا) */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 via-slate-900 to-slate-950 border border-amber-500/30 space-y-3 shadow-md">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-white text-xs flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-amber-400" />
                    <span>{isArabic ? 'الخيار في أيدينا: آلية تحديد حجم ومخاطرة الصفقة' : 'Dual Sizing Control: Position Sizing & Risk Mode'}</span>
                  </label>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/30">
                    {positionSizingMode === 'RISK_PORTFOLIO_DYNAMIC'
                      ? (isArabic ? 'ديناميكي من إجمالي المحفظة' : 'Dynamic Risk Budget')
                      : (isArabic ? 'هامش ثابت صارم لكل صفقة' : 'Strict Fixed Margin')}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Option 1: Dynamic Portfolio Risk */}
                  <div
                    onClick={() => setPositionSizingMode('RISK_PORTFOLIO_DYNAMIC')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      positionSizingMode === 'RISK_PORTFOLIO_DYNAMIC'
                        ? 'bg-amber-500/15 border-amber-500 text-white shadow-md shadow-amber-500/15 ring-1 ring-amber-500/30'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-amber-400" />
                        <span className="font-bold text-xs text-amber-300">
                          {isArabic ? '1. حاسبة المخاطر من إجمالي المحفظة' : '1. Dynamic Portfolio Risk'}
                        </span>
                      </div>
                      <input
                        type="radio"
                        name="sizing_mode"
                        checked={positionSizingMode === 'RISK_PORTFOLIO_DYNAMIC'}
                        onChange={() => setPositionSizingMode('RISK_PORTFOLIO_DYNAMIC')}
                        className="accent-amber-500 cursor-pointer"
                      />
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-300">
                      {isArabic
                        ? 'يعتمد كلياً على نسبة المخاطرة من إجمالي رصيد المحفظة مقسومة على مسافة الوقف. في الصفقات ذات الوقف القريب (مثل 0.08% و0.05%)، يقوم المحرك بفتح كمية عقود أكبر وهامش محجوز أعلى ($80-$120) كما كان يعمل في البداية مع ضمان عدم تجاوز ميزانية المخاطرة.'
                        : 'Calculates contract quantity strictly from Portfolio Risk Budget / Stop Distance. Scales up contracts and margin on tight stops ($80-$120) while protecting dollar equity.'}
                    </p>
                  </div>

                  {/* Option 2: Strict Fixed Margin */}
                  <div
                    onClick={() => setPositionSizingMode('STRICT_FIXED_MARGIN')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      positionSizingMode === 'STRICT_FIXED_MARGIN'
                        ? 'bg-amber-500/15 border-amber-500 text-white shadow-md shadow-amber-500/15 ring-1 ring-amber-500/30'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="font-bold text-xs text-emerald-300">
                          {isArabic ? '2. التزام صارم بالحد الأقصى للهامش' : '2. Strict Fixed Margin Cap'}
                        </span>
                      </div>
                      <input
                        type="radio"
                        name="sizing_mode"
                        checked={positionSizingMode === 'STRICT_FIXED_MARGIN'}
                        onChange={() => setPositionSizingMode('STRICT_FIXED_MARGIN')}
                        className="accent-amber-500 cursor-pointer"
                      />
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-300">
                      {isArabic
                        ? 'يلتزم المحرك التزاماً صارماً بمبلغ الهامش المحجوز المحدد بالدولار أدناه (مثلاً 2 دولار USDT لكل صفقة) ولا يتجاوزه إطلاقاً أياً كانت مسافة وقف الخسارة.'
                        : 'Strictly enforces the dollar margin cap configured below (e.g. $2 USDT) per trade without exception.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Position Size ($ USD) */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="font-semibold text-slate-200">
                    {positionSizingMode === 'STRICT_FIXED_MARGIN'
                      ? (isArabic ? 'الحد الأقصى الصارم للهامش لكل صفقة ($ USDT)' : 'Strict Margin Cap per Trade ($ USDT)')
                      : t.positionSizeLabel}
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
                <div className="mt-2 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] leading-relaxed text-slate-300 space-y-1">
                  <div className="font-bold text-amber-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isArabic ? 'حماية الرافعة والتكيف التلقائي (Adaptive Leverage)' : 'Adaptive Symbol Leverage Cap'}</span>
                  </div>
                  <p>
                    {isArabic
                      ? `الصفقات ستفتح بالرافعة ${leverage}x التي اخترتها. وإذا كانت هناك عملة تحدد باينانس لها سقفاً أقل (مثل 10x أو 5x)، سيفتح البوت تلقائياً بالرافعة القصوى المسموحة لتلك العملة، ولن يتجاوز الـ ${leverage}x المحددة أبداً (لا 25x ولا 30x).`
                      : `Positions will enter at your target ${leverage}x leverage. For symbols where Binance enforces a lower cap (e.g. 10x or 5x), the bot automatically adapts to that symbol's max allowable leverage and will NEVER exceed your ${leverage}x limit.`}
                  </p>
                </div>
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

                {/* API Key Input Field */}
                <div>
                  <label className="block font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    <span>{language === 'ar' ? 'مفتاح باينانس (Binance API Key):' : 'Binance API Key:'}</span>
                  </label>
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={language === 'ar' ? 'أدخل Binance API Key الخاص بحسابك...' : 'Enter your Binance Futures API Key...'}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                {/* API Secret Input Field */}
                <div>
                  <label className="block font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-amber-400" />
                    <span>{language === 'ar' ? 'المفتاح السري (Binance Secret Key):' : 'Binance Secret Key:'}</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      placeholder={language === 'ar' ? 'أدخل Binance Secret Key...' : 'Enter your Binance Secret Key...'}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 pr-10 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {language === 'ar'
                      ? 'ملاحظة: يمكنك إدخال المفاتيح هنا مباشرة، أو تركها فارغة للقراءة من المتغيرات البيئية (.env).'
                      : 'Optional: Enter keys directly here, or leave blank to load from server environment variables.'}
                  </div>
                </div>

                {/* Environment Selector: Binance Demo vs Binance Live */}
                <div className="space-y-2 pt-1">
                  <label className="block font-semibold text-slate-200 text-xs">
                    {language === 'ar' ? 'بيئة التداول في منصة باينانس:' : 'Binance Trading Environment:'}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIsTestnet(true)}
                      className={`p-3 rounded-xl border text-right transition flex flex-col gap-1 cursor-pointer ${
                        isTestnet
                          ? 'bg-amber-500/15 border-amber-500/50 text-white shadow-sm'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-amber-300">
                          {language === 'ar' ? 'باينانس ديمو التجريبي' : 'Binance Demo (Mock)'}
                        </span>
                        {isTestnet && <span className="text-[10px] text-amber-400">● {language === 'ar' ? 'محدد' : 'Active'}</span>}
                      </div>
                      <span className="text-[10px] text-slate-400 leading-normal">
                        {language === 'ar'
                          ? 'حساب عقود آجلة تجريبي على سيرفر باينانس ديمو (testnet.binancefuture.com) بدون مخاطرة بأموال حقيقية.'
                          : 'Official Binance Futures Demo sandbox with virtual balance on testnet.binancefuture.com.'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsTestnet(false)}
                      className={`p-3 rounded-xl border text-right transition flex flex-col gap-1 cursor-pointer ${
                        !isTestnet
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-white shadow-sm'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-emerald-300">
                          {language === 'ar' ? 'باينانس الحساب الحقيقي' : 'Binance Live (Real)'}
                        </span>
                        {!isTestnet && <span className="text-[10px] text-emerald-400">● {language === 'ar' ? 'محدد' : 'Active'}</span>}
                      </div>
                      <span className="text-[10px] text-slate-400 leading-normal">
                        {language === 'ar'
                          ? 'تداول مباشر بأموال حقيقية على حسابك في منصة وتطبيق باينانس الرسمي (fapi.binance.com).'
                          : 'Real live execution with your actual Binance account balance on fapi.binance.com.'}
                      </span>
                    </button>
                  </div>

                  {/* Anti -2015 Guidance Notice */}
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 space-y-1">
                    <div className="font-bold text-amber-400 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{language === 'ar' ? 'تعليمات مهمة لضمان نجاح الاتصال وتفادي خطأ (-2015):' : 'Key Instructions to Avoid Error -2015:'}</span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-400 text-[10px] leading-relaxed">
                      {isTestnet ? (
                        <>
                          <li>{language === 'ar' ? 'تأكد من استخدام مفتاح تم إنشاؤه من منصة باينانس ديمو (testnet.binancefuture.com).' : 'Use API keys generated on testnet.binancefuture.com.'}</li>
                          <li>{language === 'ar' ? 'مفاتيح باينانس الحقيقي لن تعمل على باينانس ديمو التجريبي.' : 'Live Binance account keys do not work on Demo sandbox.'}</li>
                        </>
                      ) : (
                        <>
                          <li>{language === 'ar' ? 'في حسابك على باينانس > إدارة الـ API، تأكد من تفعيل علامة الصح أمام: Enable Futures (تمكين العقود الآجلة).' : 'In Binance API Management, ensure "Enable Futures" permission is checked.'}</li>
                          <li>{language === 'ar' ? 'تأكد من أن خيار قيود الـ IP هو (Unrestricted) أو إضافة خادمك للقائمة المسموحة.' : 'Verify IP Access Restrictions are set to unrestricted or whitelisted.'}</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Status / Error feedback */}
              {apiStatus === 'connected' && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span className="font-bold">{t.apiValidSuccess}</span>
                  </div>
                  {balance && typeof balance.totalWalletBalance === 'number' && balance.totalWalletBalance > 0 && (
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      ${balance.totalWalletBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDT
                    </span>
                  )}
                </div>
              )}

              {apiStatus === 'error' && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{t.apiValidFailed}</span>
                  </div>
                  <div className="text-[11px] font-sans text-rose-200/90 whitespace-pre-line leading-relaxed">
                    {apiErrorMessage}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={handleSaveApi}
                  disabled={isSavingApi}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSavingApi && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />}
                  <span>{language === 'ar' ? 'حفظ دائم للمحفظة والمفاتيح' : 'Save Permanently to Server'}</span>
                </button>

                <button
                  onClick={async () => {
                    await handleSaveApi();
                    await validateCredentials({
                      id: activeWalletId,
                      walletName,
                      isTestnet,
                      apiKey: apiKey.trim(),
                      apiSecret: apiSecret.trim(),
                      isValidated: false,
                    });
                  }}
                  disabled={isValidatingApi}
                  className="py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10 disabled:opacity-40 cursor-pointer"
                >
                  {isValidatingApi ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{language === 'ar' ? 'جارٍ الاتصال بـ Binance...' : 'Connecting...'}</span>
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4" />
                      <span>{language === 'ar' ? 'فحص والتحقق من حساب باينانس' : 'Verify Binance Connection'}</span>
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
                    onChange={(e) => {
                      const val = e.target.checked;
                      setEnableToastAlerts(val);
                      updateSettings({ enableToastAlerts: val });
                      if (!val) {
                        clearAllToasts();
                      }
                    }}
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

          {/* TAB 4: RESET HISTORY, CACHE & BALANCE */}
          {activeTab === 'reset' && (
            <div className="space-y-4">
              {/* PRIMARY ACTION: CLEAN CACHE & FULL RESET */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 via-slate-900 to-slate-950 border border-amber-500/30 space-y-3">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                  <RefreshCw className="w-4 h-4 text-amber-400" />
                  <span>{language === 'ar' ? 'مسح الكاش والتخزين المؤقت وإعادة الضبط الشامل (Clean Cache & Fresh Reset)' : 'Clean All Cache & Full Reset'}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {language === 'ar'
                    ? 'يقوم هذا الخيار بمسح التخزين المحلي (LocalStorage) بالكامل، وإلغاء كافة البيانات القديمة المعلقة، وتصفير الصفقات والمراكز المفتوحة، وإعادة تعيين الرصيد التجريبي إلى $1,000 لبدء عمل البوت بحالة نقية وجديدة كلياً.'
                    : 'Wipes all local storage cache, clears old positions and trades, and resets simulated paper balance back to $1,000 with clean settings.'}
                </p>

                {hasCleanedCache && (
                  <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold text-center animate-fadeIn">
                    ✓ {language === 'ar' ? 'تم مسح الكاش والتخزين المؤقت وإعادة ضبط البوت بنجاح!' : 'Cache cleared and bot reset to clean state successfully!'}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isCleaningCache}
                  onClick={async () => {
                    setIsCleaningCache(true);
                    await cleanAllCacheAndReset();
                    setIsCleaningCache(false);
                    setHasCleanedCache(true);
                    setTimeout(() => setHasCleanedCache(false), 3500);
                  }}
                  className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/15 cursor-pointer disabled:opacity-50"
                >
                  {isCleaningCache ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{language === 'ar' ? 'جارٍ تنظيف الكاش...' : 'Cleaning Cache...'}</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>{language === 'ar' ? 'مسح الكاش والتخزين المؤقت وإعادة الضبط الشامل الآن' : 'Wipe Local Cache & Reset All Now'}</span>
                    </>
                  )}
                </button>
              </div>

              {/* SECONDARY ACTION: CLEAR TRADE HISTORY ONLY */}
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-3">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                  <Clock className="w-4 h-4" />
                  <span>{language === 'ar' ? 'تصفير سجل الصفقات المغلقة فقط' : 'Clear Closed Trade History Only'}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {language === 'ar'
                    ? 'مسح سجل الصفقات السابقة مع الإبقاء على الإعدادات الحالية والمحفظة دون تغيير.'
                    : 'Clear trade log and history without resetting settings or wallet profiles.'}
                </p>

                {hasReset && (
                  <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold text-center">
                    ✓ {language === 'ar' ? 'تم تصفير سجل الصفقات بنجاح!' : 'Trade history cleared successfully!'}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleResetHistory}
                  className="w-full py-2.5 px-4 rounded-xl bg-rose-600/80 hover:bg-rose-500 text-white font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-rose-600/15"
                >
                  <X className="w-4 h-4" />
                  <span>{language === 'ar' ? 'تصفير سجل الصفقات' : 'Clear History'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer / Toast */}
        {showSavedToast && (
          <div className="bg-emerald-500 text-black font-bold text-xs py-2 px-4 text-center animate-in slide-in-from-bottom">
            {savedToastText || t.settingsSaved}
          </div>
        )}
      </div>
    </div>
  );
};
