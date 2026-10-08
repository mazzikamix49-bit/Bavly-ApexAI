import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  AccountBalance,
  AILearningState,
  BinanceCredentials,
  BotSessionState,
  BotSettings,
  CapitalProfile,
  ClosedTrade,
  DEFAULT_CAPITAL_PROFILE,
  FuturesSymbolInfo,
  PerformanceMetrics,
  Position,
  TelegramSettings,
  ToastAlert,
  TradeDirection,
  TradingMode,
  WalletProfile,
} from '../types/trading';
import { BinanceService } from '../services/binanceService';
import { binanceWs, WsConnectionStatus, TickerUpdate } from '../services/binanceWsService';
import { aiEngine } from '../services/aiLearningEngine';
import { strategyEngine } from '../services/strategyEngine';
import { botSessionService } from '../services/botSessionService';
import { ExecutionService } from '../services/executionService';
import { RiskManagementService } from '../services/riskManagementService';
import { PositionReconciliationService, ReconciliationReport } from '../services/positionReconciliationService';
import { PerformanceAnalyticsService } from '../services/performanceAnalyticsService';
import { CorrelationGuard, PortfolioExposureReport } from '../services/correlationGuard';
import { TelegramService } from '../services/telegramService';
import { Language, translations } from '../utils/translations';

export interface TradingContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (typeof translations)['ar'];
  tradingMode: TradingMode;
  setTradingMode: (mode: TradingMode) => void;
  botRunning: boolean;
  setBotRunning: (running: boolean) => void;
  toggleBot: () => void;
  credentials: BinanceCredentials;
  updateCredentials: (creds: Partial<BinanceCredentials>) => void;
  validateCredentials: (overrideCreds?: BinanceCredentials) => Promise<boolean>;
  isValidatingApi: boolean;
  apiStatus: 'disconnected' | 'connected' | 'error';
  apiErrorMessage: string;

  // Real-Time Binance WebSocket Stream Status
  wsStatus: WsConnectionStatus;
  wsStatusDetails: string;
  reconnectWs: () => void;

  // Multi-Wallet Profiles Management
  wallets: WalletProfile[];
  activeWalletId: string;
  activeWallet: WalletProfile;
  switchWallet: (walletId: string) => Promise<void>;
  saveWalletProfile: (profile: Omit<WalletProfile, 'id' | 'createdAt'> & { id?: string }) => void;
  deleteWalletProfile: (walletId: string) => void;
  setCustomWalletName: (name: string) => void;

  settings: BotSettings;
  updateSettings: (newSettings: Partial<BotSettings>) => void;
  capitalProfile: CapitalProfile;
  updateCapitalProfile: (newProfile: Partial<CapitalProfile>) => void;
  telegramSettings: TelegramSettings;
  updateTelegramSettings: (settings: Partial<TelegramSettings>) => void;
  balance: AccountBalance;
  positions: Position[];
  closedTrades: ClosedTrade[];
  marketPairs: FuturesSymbolInfo[];
  isLoadingMarket: boolean;
  aiState: AILearningState;

  // Uptime Session State (5-Hour Counter)
  sessionState: BotSessionState;

  // Performance Analytics
  performanceMetrics: PerformanceMetrics;
  totalTradesCount: number;
  winningTradesCount: number;
  losingTradesCount: number;
  winRatePercent: number;
  totalProfitUsd: number;
  totalLossUsd: number;
  netProfitUsd: number;

  // Portfolio Exposure & Reconciliation
  portfolioExposure: PortfolioExposureReport;
  reconciliationReport: ReconciliationReport | null;
  triggerEmergencyKillSwitch: (policy?: 'HOLD_PROTECTED' | 'CLOSE_ALL') => Promise<void>;
  confirmProductionTrading: (confirmed: boolean) => void;

  // Real-time Toast Notifications
  toasts: ToastAlert[];
  addToast: (toast: Omit<ToastAlert, 'id' | 'timestamp'>) => void;
  dismissToast: (id: string) => void;
  clearAllToasts: () => void;

  // Actions
  openPosition: (
    symbol: string,
    side: TradeDirection,
    rationale?: string,
    customLeverage?: number,
    options?: {
      overrideLimits?: boolean;
      customAmountUsd?: number;
    }
  ) => Promise<boolean>;
  closePosition: (positionId: string, reason?: ClosedTrade['exitReason']) => Promise<boolean>;
  closeAllPositions: () => Promise<void>;
  refreshMarketData: () => Promise<void>;
  refreshAccountData: () => Promise<void>;
  runReconciliation: () => Promise<void>;
  clearTradeHistory: () => void;
  workerStatus?: {
    workerRunning: boolean;
    botRunning: boolean;
    safeBootMode: boolean;
    tradingLoopActive: boolean;
    uptimeSeconds: number;
  } | null;
}

const DEFAULT_SETTINGS: BotSettings = {
  maxConcurrentPositions: 2,
  riskPerTradePercent: 1.0,
  positionSizeUsd: 2.0,
  useRiskBasedSizing: true,
  leverage: 20,
  allowedDirection: 'BOTH',
  marginType: 'ISOLATED',
  maxOpenRiskPercent: 6.0,
  maxNotionalExposureUsd: 5000,
  maxAllocatedCapitalUsd: 20.0,
  enableCapitalLimit: false,
  maxDailyDrawdownPercent: 5.0,
  maxDailyLossUsd: 1.0,
  maxConsecutiveLosses: 3,
  lossCooldownMinutes: 30,
  takeProfitPercent: 3.5,
  stopLossPercent: 1.8,
  trailingStopPercent: 0.8,
  useTrailingStop: true,
  aiDynamicTargets: true,
  multiTargetTrailing: true,
  unlimitedHoldTime: true,
  maxTradeDurationHours: 4,
  minAiConfidence: 75,
  maxSpreadPercent: 0.18,
  maxDataAgeSeconds: 20,
  minVolume24hUsd: 5000000,
  autoTradingEnabled: true,
  scanIntervalSeconds: 10,
  enableToastAlerts: true,
  maxSessionDurationHours: 0, // 0 = unlimited by default
  killSwitchActive: false,
  killSwitchPolicy: 'HOLD_PROTECTED',
  productionConfirmed: false,
  capitalProfile: DEFAULT_CAPITAL_PROFILE,
};

const DEFAULT_CREDENTIALS: BinanceCredentials = {
  isTestnet: false,
  isValidated: false,
};

const DEFAULT_TELEGRAM: TelegramSettings = {
  enabled: false,
  botToken: '',
  chatId: '',
  notifyOnOpen: true,
  notifyOnClose: true,
  notifyOnTakeProfit: true,
  notifyOnStopLoss: true,
  notifyOnReconciliationError: true,
  notifyOnUptimeMilestone: true,
  notifyOnCircuitBreaker: true,
};

const TradingContext = createContext<TradingContextType | undefined>(undefined);

export const TradingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Language state
  const [language, setLangState] = useState<Language>(() => {
    return (localStorage.getItem('apex_language') as Language) || 'ar';
  });

  const setLanguage = (lang: Language) => {
    setLangState(lang);
    localStorage.setItem('apex_language', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', lang);
  };

  useEffect(() => {
    document.documentElement.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', language);
  }, [language]);

  const t = translations[language];

  // 2. Trading Mode: ALWAYS default to SAFE 'paper' mode on startup / refresh!
  const [tradingMode, setTradingModeState] = useState<TradingMode>('paper');

  const setTradingMode = (mode: TradingMode) => {
    setTradingModeState(mode);
    localStorage.setItem('apex_trading_mode', mode);
  };

  // 3. Bot Status & Session State (Authoritative Persistent Worker Engine)
  const [sessionState, setSessionState] = useState<BotSessionState>(() => botSessionService.getState());
  const [botRunning, setBotRunningState] = useState<boolean>(() => {
    return botSessionService.getState().status === 'RUNNING';
  });

  const [workerStatus, setWorkerStatus] = useState<{
    workerRunning: boolean;
    botRunning: boolean;
    safeBootMode: boolean;
    tradingLoopActive: boolean;
    uptimeSeconds: number;
  } | null>(null);
  const workerStatusRef = useRef(workerStatus);
  workerStatusRef.current = workerStatus;

  // Authoritative sync from Worker Control API
  const refreshWorkerStatus = async () => {
    try {
      const res = await fetch('/api/worker/status');
      if (res.ok) {
        const data = await res.json();
        setWorkerStatus(data);
        if (typeof data.botRunning === 'boolean') {
          setBotRunningState(data.botRunning);
        }
      }
    } catch {
      // Backend worker initializing
    }
  };

  useEffect(() => {
    refreshWorkerStatus();
    const interval = setInterval(refreshWorkerStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // 4. Multi-Wallet Profiles (Clean of any client-side secrets)
  const [wallets, setWallets] = useState<WalletProfile[]>(() => {
    try {
      const saved = localStorage.getItem('bavly_wallet_profiles');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Strictly purge any legacy secrets from client storage
          const sanitized: WalletProfile[] = parsed.map((w: any) => ({
            id: w.id || `wallet-${Date.now()}`,
            name: w.name || 'محفظة بافلي بينانس (Bavly Futures)',
            isTestnet: typeof w.isTestnet === 'boolean' ? w.isTestnet : false,
            isValidated: typeof w.isValidated === 'boolean' ? w.isValidated : false,
            createdAt: w.createdAt || Date.now(),
          }));
          localStorage.setItem('bavly_wallet_profiles', JSON.stringify(sanitized));
          return sanitized;
        }
      }
    } catch (e) {
      console.error('Error loading wallet profiles:', e);
    }
    const defaultProfiles: WalletProfile[] = [
      {
        id: 'wallet-default',
        name: 'محفظة بافلي بينانس (Bavly Futures)',
        isTestnet: false,
        isValidated: false,
        createdAt: Date.now(),
      },
    ];
    localStorage.setItem('bavly_wallet_profiles', JSON.stringify(defaultProfiles));
    return defaultProfiles;
  });

  const [activeWalletId, setActiveWalletId] = useState<string>(() => {
    return localStorage.getItem('bavly_active_wallet_id') || 'wallet-default';
  });

  const activeWallet = wallets.find((w) => w.id === activeWalletId) || wallets[0];

  const [credentials, setCredentials] = useState<BinanceCredentials>(() => ({
    id: activeWallet.id,
    walletName: activeWallet.name,
    isTestnet: activeWallet.isTestnet,
    isValidated: activeWallet.isValidated,
  }));

  const [apiStatus, setApiStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');
  const [apiErrorMessage, setApiErrorMessage] = useState('');
  const [isValidatingApi, setIsValidatingApi] = useState(false);

  // 5. Bot Settings
  const [settings, setSettings] = useState<BotSettings>(() => {
    try {
      const saved = localStorage.getItem('apex_bot_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          productionConfirmed: false,
          capitalProfile: parsed.capitalProfile
            ? { ...DEFAULT_CAPITAL_PROFILE, ...parsed.capitalProfile }
            : DEFAULT_CAPITAL_PROFILE,
        };
      }
      return DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const updateSettings = (newSettings: Partial<BotSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem('apex_bot_settings', JSON.stringify(updated));
      return updated;
    });
  };

  const capitalProfile: CapitalProfile = settings.capitalProfile || DEFAULT_CAPITAL_PROFILE;

  const updateCapitalProfile = (newProfile: Partial<CapitalProfile>) => {
    const updated: CapitalProfile = {
      ...(settings.capitalProfile || DEFAULT_CAPITAL_PROFILE),
      ...newProfile,
    };
    updateSettings({
      capitalProfile: updated,
      maxConcurrentPositions: updated.maxOpenPositions,
      riskPerTradePercent: updated.riskPerTradePercent,
    });
  };

  // 6. Telegram Settings
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings>(() => {
    try {
      const saved = localStorage.getItem('apex_telegram_settings');
      return saved ? { ...DEFAULT_TELEGRAM, ...JSON.parse(saved) } : DEFAULT_TELEGRAM;
    } catch {
      return DEFAULT_TELEGRAM;
    }
  });

  const updateTelegramSettings = (newTg: Partial<TelegramSettings>) => {
    setTelegramSettings((prev) => {
      const updated = { ...prev, ...newTg };
      localStorage.setItem('apex_telegram_settings', JSON.stringify(updated));
      return updated;
    });
  };

  // 7. Balances
  const [paperBalance, setPaperBalance] = useState<number>(() => {
    const saved = localStorage.getItem('apex_paper_balance');
    return saved ? parseFloat(saved) : 1000.0;
  });

  const [realBalance, setRealBalance] = useState<AccountBalance>({
    totalWalletBalance: 0,
    availableBalance: 0,
    totalUnrealizedProfit: 0,
    totalMarginBalance: 0,
    totalInitialMargin: 0,
    totalMaintMargin: 0,
  });

  const balance: AccountBalance =
    tradingMode === 'real'
      ? realBalance
      : {
          totalWalletBalance: paperBalance,
          availableBalance: paperBalance,
          totalUnrealizedProfit: 0,
          totalMarginBalance: paperBalance,
          totalInitialMargin: 0,
          totalMaintMargin: 0,
        };

  // 8. Open Positions & Closed Trades
  const [positions, setPositions] = useState<Position[]>(() => {
    try {
      const saved = localStorage.getItem('apex_active_positions');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>(() => {
    try {
      const saved = localStorage.getItem('apex_closed_trades');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // 9. Market Tickers & WebSocket Stream
  const [marketPairs, setMarketPairs] = useState<FuturesSymbolInfo[]>([]);
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus>('disconnected');
  const [wsStatusDetails, setWsStatusDetails] = useState('');

  // 10. AI Learning State
  const [aiState, setAiState] = useState<AILearningState>(() => aiEngine.getState());

  // 12. Position Reconciliation Report
  const [reconciliationReport, setReconciliationReport] = useState<ReconciliationReport | null>(null);

  // 13. Toast Alerts
  const [toasts, setToasts] = useState<ToastAlert[]>([]);

  const addToast = (toast: Omit<ToastAlert, 'id' | 'timestamp'>) => {
    if (!settings.enableToastAlerts && toast.type !== 'ERROR') return;
    const newAlert: ToastAlert = {
      ...toast,
      id: `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };
    setToasts((prev) => [newAlert, ...prev.slice(0, 9)]);
  };

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const clearAllToasts = () => setToasts([]);

  // Refs for asynchronous loops
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const closedTradesRef = useRef(closedTrades);
  closedTradesRef.current = closedTrades;
  const marketPairsRef = useRef(marketPairs);
  marketPairsRef.current = marketPairs;
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;
  const tradingModeRef = useRef(tradingMode);
  tradingModeRef.current = tradingMode;
  const botRunningRef = useRef(botRunning);
  botRunningRef.current = botRunning;
  const languageRef = useRef(language);
  languageRef.current = language;
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const telegramSettingsRef = useRef(telegramSettings);
  telegramSettingsRef.current = telegramSettings;

  // Persist state updates
  useEffect(() => {
    localStorage.setItem('apex_active_positions', JSON.stringify(positions));
  }, [positions]);

  useEffect(() => {
    localStorage.setItem('apex_closed_trades', JSON.stringify(closedTrades));
  }, [closedTrades]);

  useEffect(() => {
    localStorage.setItem('apex_paper_balance', paperBalance.toString());
  }, [paperBalance]);

  // Session Uptime Ticker (1-second precision) & 5-Hour Milestone Alert
  useEffect(() => {
    // Initial sync with authoritative backend session to prevent fake running states on reload
    botSessionService.syncWithServer().then((synced) => {
      setSessionState(synced);
      setBotRunningState(synced.status === 'RUNNING');
    });

    const timer = setInterval(() => {
      const { state, triggeredFiveHourNotification, reachedMaxDuration } = botSessionService.tick(
        settingsRef.current.maxSessionDurationHours
      );
      setSessionState(state);

      if (triggeredFiveHourNotification) {
        const isAr = languageRef.current === 'ar';
        addToast({
          type: 'INFO',
          title: isAr ? '⏱️ إنجاز 5 ساعات تشغيل متواصل (05:00:00)' : '⏱️ 5-Hour Uptime Milestone (05:00:00)',
          message: isAr
            ? 'البوت حقق 5 ساعات متواصلة من العمل المستقر ومراقبة السوق وإدارة المخاطر. العداد مستمر بالعد تصاعدياً.'
            : 'ApexAI Bot has reached 5 continuous hours of active session uptime (05:00:00). Counter continuing upward.',
        });

        if (telegramSettingsRef.current.enabled && telegramSettingsRef.current.notifyOnUptimeMilestone) {
          TelegramService.sendMessage(
            telegramSettingsRef.current.botToken,
            telegramSettingsRef.current.chatId,
            isAr
              ? '⏱️ <b>إشعار استقرار الجلسة (5 ساعات تشغيل)</b>\n\n• المدة: <b>05:00:00</b>\n• حالة الاتصال: متصل ومستقر\n• محرك المخاطر والمراقبة نشط 24/7 🛡️'
              : '⏱️ <b>Session Uptime Milestone (5 Hours)</b>\n\n• Duration: <b>05:00:00</b>\n• Status: Operational & Stable\n• Risk Engine Active 24/7 🛡️'
          );
        }
      }

      if (reachedMaxDuration && botRunningRef.current) {
        setBotRunningState(false);
        localStorage.setItem('apex_bot_running', 'false');
        botSessionService.stopSession().then(setSessionState);
        const isAr = languageRef.current === 'ar';
        addToast({
          type: 'WARNING',
          title: isAr ? '🛑 بلوغ الحد الأقصى للجلسة المحددة' : '🛑 Max Session Duration Reached',
          message: isAr
            ? `تم إيقاف دخول صفقات جديدة بأمان بعد بلوغ سقف الـ ${settingsRef.current.maxSessionDurationHours} ساعات المحددة.`
            : `Halted new entries safely after reaching the configured ${settingsRef.current.maxSessionDurationHours}h session limit.`,
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const setBotRunning = async (running: boolean) => {
    if (running) {
      // Capital Safety validation check before starting bot:
      const capValidation = RiskManagementService.validateCapitalProfile(settingsRef.current.capitalProfile);
      if (!capValidation.isValid) {
        const isAr = languageRef.current === 'ar';
        addToast({
          type: 'ERROR',
          title: isAr ? 'فشل بدء التداول - إعدادات رأس المال غير صالحة' : 'Cannot Start Bot - Invalid Capital Profile',
          message: capValidation.error || 'Invalid Capital Profile settings. Please check Settings modal.',
        });
        return;
      }

      try {
        const res = await fetch('/api/worker/start', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          setBotRunningState(Boolean(data.botRunning));
          setWorkerStatus({
            workerRunning: Boolean(data.workerRunning),
            botRunning: Boolean(data.botRunning),
            safeBootMode: Boolean(data.safeBootMode),
            tradingLoopActive: Boolean(data.tradingLoopActive),
            uptimeSeconds: workerStatusRef.current?.uptimeSeconds || 0,
          });
        }
      } catch (err) {
        console.error('[TradingContext] Failed to call /api/worker/start:', err);
      }

      // START: Creates session from 00:00:00 with fresh sessionId for UI visualization
      const newSession = await botSessionService.startSession();
      setSessionState(newSession);
    } else {
      try {
        const res = await fetch('/api/worker/stop', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          setBotRunningState(Boolean(data.botRunning));
          setWorkerStatus({
            workerRunning: Boolean(data.workerRunning),
            botRunning: Boolean(data.botRunning),
            safeBootMode: Boolean(data.safeBootMode),
            tradingLoopActive: Boolean(data.tradingLoopActive),
            uptimeSeconds: workerStatusRef.current?.uptimeSeconds || 0,
          });
        }
      } catch (err) {
        console.error('[TradingContext] Failed to call /api/worker/stop:', err);
      }

      // STOP: Freezes uptime, records stoppedAt, status STOPPED
      const stoppedSession = await botSessionService.stopSession();
      setSessionState(stoppedSession);
    }
  };

  const toggleBot = () => setBotRunning(!botRunning);

  const confirmProductionTrading = (confirmed: boolean) => {
    updateSettings({ productionConfirmed: confirmed });
    if (confirmed) {
      setTradingMode('real');
      const isAr = language === 'ar';
      addToast({
        type: 'WARNING',
        title: isAr ? '⚠️ تم تأكيد وضع التداول الحقيقي' : '⚠️ Production Trading Enabled',
        message: isAr
          ? 'تم تفعيل التداول الحقيقي على منصة بينانس مع تأكيد الحماية ووقف الخسارة الإلزامي.'
          : 'Production trading on Binance Futures is now active with mandatory protective stops.',
      });
    }
  };

  const triggerEmergencyKillSwitch = async (policy: 'HOLD_PROTECTED' | 'CLOSE_ALL' = 'HOLD_PROTECTED') => {
    updateSettings({ killSwitchActive: true, killSwitchPolicy: policy });
    setBotRunning(false);

    const isAr = language === 'ar';
    addToast({
      type: 'ERROR',
      title: isAr ? '🚨 تفعيل زر الطوارئ (Emergency Kill Switch)' : '🚨 Emergency Kill Switch Activated',
      message: isAr
        ? `تم تجميد فتح أي صفقات جديدة فوراً. سياسة الحماية: ${policy === 'CLOSE_ALL' ? 'إغلاق كافة الصفقات فوراً' : 'إبقاء الصفقات الحالية محمية بوقف الخسارة'}.`
        : `All new order submissions blocked immediately. Policy: ${policy === 'CLOSE_ALL' ? 'Market closing all open positions' : 'Holding existing positions protected by exchange SL'}.`,
    });

    if (policy === 'CLOSE_ALL') {
      await closeAllPositions();
    }
  };

  // Switch Wallet Profile
  const switchWallet = async (walletId: string) => {
    const target = wallets.find((w) => w.id === walletId);
    if (!target) return;
    setActiveWalletId(walletId);
    localStorage.setItem('bavly_active_wallet_id', walletId);

    const newCreds: BinanceCredentials = {
      id: target.id,
      walletName: target.name,
      isTestnet: target.isTestnet,
      isValidated: target.isValidated,
    };
    setCredentials(newCreds);

    await validateCredentials(newCreds);
  };

  const saveWalletProfile = (profile: Omit<WalletProfile, 'id' | 'createdAt'> & { id?: string }) => {
    const newId = profile.id || `wallet-${Date.now()}`;
    const newProfile: WalletProfile = {
      id: newId,
      name: profile.name,
      isTestnet: profile.isTestnet,
      isValidated: profile.isValidated ?? false,
      createdAt: Date.now(),
    };

    setWallets((prev) => {
      const exists = prev.some((w) => w.id === newId);
      const updated = exists ? prev.map((w) => (w.id === newId ? newProfile : w)) : [...prev, newProfile];
      localStorage.setItem('bavly_wallet_profiles', JSON.stringify(updated));
      return updated;
    });

    if (newId === activeWalletId) {
      setCredentials({
        id: newProfile.id,
        walletName: newProfile.name,
        isTestnet: newProfile.isTestnet,
        isValidated: newProfile.isValidated,
      });
    }
  };

  const deleteWalletProfile = (walletId: string) => {
    if (wallets.length <= 1) return;
    setWallets((prev) => {
      const updated = prev.filter((w) => w.id !== walletId);
      localStorage.setItem('bavly_wallet_profiles', JSON.stringify(updated));
      return updated;
    });
    if (activeWalletId === walletId) {
      const nextWallet = wallets.find((w) => w.id !== walletId) || wallets[0];
      switchWallet(nextWallet.id);
    }
  };

  const setCustomWalletName = (name: string) => {
    setWallets((prev) => {
      const updated = prev.map((w) => (w.id === activeWalletId ? { ...w, name } : w));
      localStorage.setItem('bavly_wallet_profiles', JSON.stringify(updated));
      return updated;
    });
    setCredentials((prev) => ({ ...prev, walletName: name }));
  };

  const updateCredentials = (creds: Partial<BinanceCredentials>) => {
    setCredentials((prev) => {
      const updated = { ...prev, ...creds };
      return updated;
    });
  };

  const validateCredentials = async (overrideCreds?: BinanceCredentials): Promise<boolean> => {
    const credsToTest = overrideCreds || credentials;
    setIsValidatingApi(true);
    setApiErrorMessage('');

    try {
      const res = await BinanceService.fetchAccount(credsToTest);
      if (res.success && res.balance) {
        setRealBalance(res.balance);
        setApiStatus('connected');
        setCredentials((prev) => ({ ...prev, ...credsToTest, isValidated: true, isServerConfigured: true }));
        return true;
      } else {
        setApiStatus('error');
        setApiErrorMessage(
          res.error ||
            (language === 'ar'
              ? 'فشل الاتصال بـ Binance. يرجى التأكد من ضبط المفاتيح في المتغيرات البيئية بالخادم (.env).'
              : 'Failed to authenticate with Binance. Ensure server environment variables are configured in .env.')
        );
        return false;
      }
    } catch (err: any) {
      setApiStatus('error');
      setApiErrorMessage(err.message || 'Connection timeout');
      return false;
    } finally {
      setIsValidatingApi(false);
    }
  };

  const refreshMarketData = async () => {
    try {
      setIsLoadingMarket(true);
      const tickers = await BinanceService.fetch24hrTickers(credentialsRef.current.isTestnet);
      if (tickers.length > 0) {
        setMarketPairs(tickers);
      }
    } catch (err) {
      console.error('[TradingContext] Error refreshing tickers:', err);
    } finally {
      setIsLoadingMarket(false);
    }
  };

  const refreshAccountData = async () => {
    if (tradingModeRef.current === 'real' && credentialsRef.current.isValidated) {
      const res = await BinanceService.fetchAccount(credentialsRef.current);
      if (res.success && res.balance) {
        setRealBalance(res.balance);
      }
    }
  };

  const runReconciliation = async () => {
    if (tradingModeRef.current !== 'real') return;
    const report = await PositionReconciliationService.reconcile(
      credentialsRef.current,
      positionsRef.current,
      true
    );
    setReconciliationReport(report);

    if (report.hasDiscrepancy) {
      const isAr = languageRef.current === 'ar';
      addToast({
        type: 'WARNING',
        title: isAr ? '⚠️ تنبيه مطابقة الصفقات (Reconciliation)' : '⚠️ Position Reconciliation Alert',
        message: report.message,
      });
      if (telegramSettingsRef.current.enabled && telegramSettingsRef.current.notifyOnReconciliationError) {
        TelegramService.sendMessage(
          telegramSettingsRef.current.botToken,
          telegramSettingsRef.current.chatId,
          `⚠️ <b>Binance Reconciliation Alert</b>\n\n${report.message}`
        );
      }
    }
  };

  const openPosition = async (
    symbol: string,
    side: TradeDirection,
    rationale = 'Quantitative Strategy Entry',
    customLeverage?: number,
    options?: {
      overrideLimits?: boolean;
      customAmountUsd?: number;
    }
  ): Promise<boolean> => {
    const pairInfo = marketPairsRef.current.find((p) => p.symbol === symbol);
    if (!pairInfo) return false;

    // Evaluate candidate through Strategy Engine for dynamic targets
    const evalResult = strategyEngine.evaluateCandidate(
      pairInfo,
      [],
      positionsRef.current,
      undefined,
      languageRef.current
    );

    const plannedStop = evalResult.plannedStopLossPrice || pairInfo.price * (side === 'LONG' ? 0.985 : 1.015);
    const plannedTp = evalResult.plannedTakeProfitPrice || pairInfo.price * (side === 'LONG' ? 1.035 : 0.965);

    const execResult = await ExecutionService.executeOrder(
      {
        symbol,
        side,
        rationale: rationale || evalResult.rationale,
        customLeverage,
        customAmountUsd: options?.customAmountUsd,
        overrideLimits: options?.overrideLimits,
      },
      pairInfo,
      plannedStop,
      plannedTp,
      evalResult.tp1Price,
      evalResult.tp2Price,
      evalResult.tp3Price,
      balanceRef.current,
      positionsRef.current,
      closedTradesRef.current,
      settingsRef.current,
      credentialsRef.current,
      tradingModeRef.current === 'real',
      credentialsRef.current.isTestnet
    );

    if (!execResult.success || !execResult.position) {
      const isAr = languageRef.current === 'ar';
      addToast({
        type: 'INFO',
        title: isAr ? '🛡️ محرك المخاطر منع الصفقة' : '🛡️ Order Rejected by Risk Engine',
        message: execResult.rejectionReason || execResult.error || 'Order rejected by hard limits.',
      });
      return false;
    }

    setPositions((prev) => [execResult.position!, ...prev]);

    // Send Real-Time Toast Notification
    const isAr = languageRef.current === 'ar';
    addToast({
      type: side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
      title: isAr
        ? `تم تنفيذ صفقة ${side === 'LONG' ? 'شراء (LONG)' : 'بيع (SHORT)'} ${execResult.isRealOrder ? 'حقيقية' : 'تجريبية'}`
        : `Executed ${side} ${execResult.isRealOrder ? 'Live' : 'Paper'} Position`,
      message: `${symbol} • ${execResult.position.leverage}x • $${execResult.position.amountUsd} @ $${execResult.position.entryPrice.toLocaleString()}`,
      symbol,
      side,
    });

    TelegramService.notifyPositionOpened(telegramSettingsRef.current, execResult.position, languageRef.current === 'ar');
    return true;
  };

  const closePosition = async (
    positionId: string,
    reason: ClosedTrade['exitReason'] = 'MANUAL_CLOSE'
  ): Promise<boolean> => {
    const target = positionsRef.current.find((p) => p.id === positionId);
    if (!target) return false;

    // Real Binance close order if in real mode
    if (tradingModeRef.current === 'real' && credentialsRef.current.isValidated && target.isRealOrder) {
      try {
        await BinanceService.placeOrder(
          credentialsRef.current,
          target.symbol,
          target.side === 'LONG' ? 'SELL' : 'BUY',
          target.quantity,
          true
        );
      } catch (err) {
        console.error('Failed to close real Binance order:', err);
      }
    }

    const currentMark = target.markPrice;
    const grossPnl =
      target.side === 'LONG'
        ? (currentMark - target.entryPrice) * target.quantity
        : (target.entryPrice - currentMark) * target.quantity;

    const commission = (target.quantity * target.entryPrice + target.quantity * currentMark) * 0.0005;
    const slippage = (target.quantity * currentMark) * 0.0002;
    const netPnl = Number((grossPnl - commission - slippage).toFixed(2));
    const pnlPercentage = Number(((netPnl / target.amountUsd) * 100).toFixed(2));

    const peak = target.highestPriceReached || target.entryPrice;
    const trough = target.lowestPriceReached || target.entryPrice;
    const mae =
      target.side === 'LONG'
        ? ((target.entryPrice - trough) / target.entryPrice) * 100
        : ((peak - target.entryPrice) / target.entryPrice) * 100;
    const mfe =
      target.side === 'LONG'
        ? ((peak - target.entryPrice) / target.entryPrice) * 100
        : ((target.entryPrice - trough) / target.entryPrice) * 100;

    const closedTrade: ClosedTrade = {
      id: `trade-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      symbol: target.symbol,
      side: target.side,
      entryPrice: target.entryPrice,
      exitPrice: currentMark,
      quantity: target.quantity,
      amountUsd: target.amountUsd,
      notionalValue: target.notionalValue,
      leverage: target.leverage,
      grossPnl: Number(grossPnl.toFixed(2)),
      commissionPaid: Number(commission.toFixed(3)),
      fundingFeePaid: 0,
      slippageEstimated: Number(slippage.toFixed(3)),
      pnl: netPnl,
      netPnl,
      pnlPercentage,
      openedAt: target.openedAt,
      closedAt: Date.now(),
      durationMs: Date.now() - target.openedAt,
      exitReason: reason,
      aiConfidence: target.aiConfidence,
      wasWinning: netPnl > 0,
      tpLevelReached: target.tpLevelReached || 0,
      securedProfitUsd: target.securedProfitUsd || 0,
      marketRegime: 'TRENDING_BULL',
      strategyVersion: 'MultiTimeframe-ATR-v2.1',
      modelVersion: 'ApexQuant-v2.4',
      maxAdverseExcursionPercent: Number(mae.toFixed(2)),
      maxFavorableExcursionPercent: Number(mfe.toFixed(2)),
      isRealOrder: target.isRealOrder,
    };

    setPositions((prev) => prev.filter((p) => p.id !== positionId));
    setClosedTrades((prev) => [closedTrade, ...prev]);

    // Update Paper balance if in paper mode
    if (tradingModeRef.current === 'paper') {
      setPaperBalance((prev) => Number((prev + netPnl).toFixed(2)));
    }

    const isArClose = languageRef.current === 'ar';
    const isWin = netPnl >= 0;
    let reasonText = '';
    if (reason === 'TAKE_PROFIT') reasonText = isArClose ? 'هدف الربح (TP)' : 'Take Profit';
    else if (reason === 'STOP_LOSS') reasonText = isArClose ? 'وقف الخسارة (SL)' : 'Stop Loss';
    else if (reason === 'TRAILING_STOP') reasonText = isArClose ? 'الوقف المتحرك' : 'Trailing Stop';
    else if (reason === 'TIME_EXPIRED') reasonText = isArClose ? 'انتهاء المدة' : 'Time Expiry';
    else reasonText = isArClose ? 'إغلاق يدوي' : 'Manual Close';

    addToast({
      type: isWin ? 'CLOSE_WIN' : 'CLOSE_LOSS',
      title: isWin
        ? (isArClose ? '🎯 تحقيق هدف الربح!' : '🎯 Target Hit! Position Closed')
        : (isArClose ? '🛡️ إغلاق وقائي لحماية الحساب' : '🛡️ Position Closed / Stop Loss'),
      message: `${target.symbol} (${target.side}) • ${reasonText} • PnL: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)} (${pnlPercentage}%)`,
      symbol: target.symbol,
      side: target.side,
      pnl: netPnl,
      pnlPercentage,
    });

    const updatedAiState = aiEngine.recordTradeFeedback(closedTrade, languageRef.current);
    setAiState(updatedAiState);
    TelegramService.notifyPositionClosed(telegramSettingsRef.current, closedTrade, languageRef.current === 'ar');

    return true;
  };

  const closeAllPositions = async () => {
    const ids = positionsRef.current.map((p) => p.id);
    for (const id of ids) {
      await closePosition(id, 'MANUAL_CLOSE');
    }
  };

  const clearTradeHistory = () => {
    setClosedTrades([]);
    localStorage.removeItem('apex_closed_trades');
  };

  // Reconnection helper
  const reconnectWs = () => {
    binanceWs.disconnect();
    binanceWs.connect(credentialsRef.current.isTestnet);
  };

  // Initial Boot Sequence
  useEffect(() => {
    refreshMarketData();
    if (credentials.isValidated) {
      refreshAccountData();
    }

    binanceWs.setCallbacks(
      (updates: Map<string, TickerUpdate>) => {
        setMarketPairs((prevPairs) => {
          if (prevPairs.length === 0) return prevPairs;
          let changed = false;
          const updated = prevPairs.map((pair) => {
            const u = updates.get(pair.symbol);
            if (u) {
              changed = true;
              return {
                ...pair,
                price: u.price,
                markPrice: u.price,
                priceChangePercent: u.priceChangePercent,
                volume24h: u.volume,
                quoteVolume24h: u.quoteVolume,
                high24h: u.highPrice,
                low24h: u.lowPrice,
                dataFreshnessMs: 0,
                isStale: false,
              };
            }
            return pair;
          });
          return changed ? updated : prevPairs;
        });

        // Fast mark-price updates for positions
        setPositions((prevPositions) => {
          if (prevPositions.length === 0) return prevPositions;
          let changed = false;
          const updated = prevPositions.map((pos) => {
            const u = updates.get(pos.symbol);
            if (u) {
              changed = true;
              const currentMark = u.price;
              const diff =
                pos.side === 'LONG'
                  ? (currentMark - pos.entryPrice) / pos.entryPrice
                  : (pos.entryPrice - currentMark) / pos.entryPrice;
              const pnlPct = diff * 100 * pos.leverage;
              const dollarPnl = pos.amountUsd * (pnlPct / 100);
              const high = Math.max(pos.highestPriceReached || currentMark, currentMark);
              const low = Math.min(pos.lowestPriceReached || currentMark, currentMark);

              return {
                ...pos,
                markPrice: currentMark,
                unrealizedProfit: Number(dollarPnl.toFixed(2)),
                pnlPercentage: Number(pnlPct.toFixed(2)),
                highestPriceReached: high,
                lowestPriceReached: low,
              };
            }
            return pos;
          });
          return changed ? updated : prevPositions;
        });
      },
      (status: WsConnectionStatus, details?: string) => {
        setWsStatus(status);
        setWsStatusDetails(details || '');
      }
    );

    binanceWs.connect(credentialsRef.current.isTestnet);
    return () => {
      binanceWs.disconnect();
    };
  }, []);

  // Autonomous Bot Scanning & Position Monitoring Loop
  useEffect(() => {
    let tickCount = 0;
    const interval = setInterval(async () => {
      tickCount++;

      // Periodic reconciliation check every 24 seconds (real mode only)
      if (tickCount % 6 === 0 && tradingModeRef.current === 'real') {
        runReconciliation();
      }

      // Check SL / TP for open positions
      const currentPositions = positionsRef.current;
      if (currentPositions.length > 0) {
        const toClose: Array<{ id: string; reason: ClosedTrade['exitReason'] }> = [];
        const isAr = languageRef.current === 'ar';

        for (const pos of currentPositions) {
          const isLong = pos.side === 'LONG';
          const currentMark = pos.markPrice;

          // Multi-target trailing
          if (settingsRef.current.multiTargetTrailing && pos.tp1Price) {
            if ((pos.tpLevelReached || 0) === 0) {
              const hitTp1 = isLong ? currentMark >= pos.tp1Price : currentMark <= pos.tp1Price;
              if (hitTp1) {
                pos.tpLevelReached = 1;
                pos.stopLossPrice = pos.entryPrice; // Breakeven
                addToast({
                  type: 'CLOSE_WIN',
                  title: isAr ? '🎯 تحقيق الهدف الأول (TP1) - نقل الوقف لنقطة الدخول!' : '🎯 Target 1 Hit - SL to Breakeven!',
                  message: `${pos.symbol}: Stop-loss shifted to $${pos.entryPrice} for zero risk.`,
                  symbol: pos.symbol,
                });
              }
            }
          }

          // Trailing SL exit check
          const hitSl = isLong ? currentMark <= pos.stopLossPrice : currentMark >= pos.stopLossPrice;
          if (hitSl) {
            toClose.push({
              id: pos.id,
              reason: (pos.tpLevelReached || 0) >= 1 ? 'TRAILING_STOP' : 'STOP_LOSS',
            });
            continue;
          }

          // Take profit exit check
          const hitTp = isLong ? currentMark >= pos.takeProfitPrice : currentMark <= pos.takeProfitPrice;
          if (hitTp) {
            toClose.push({ id: pos.id, reason: 'TAKE_PROFIT' });
            continue;
          }

          // Max Duration check
          if (!settingsRef.current.unlimitedHoldTime && Date.now() - pos.openedAt >= pos.maxDurationMs) {
            toClose.push({ id: pos.id, reason: 'TIME_EXPIRED' });
            continue;
          }
        }

        for (const item of toClose) {
          await closePosition(item.id, item.reason);
        }
      }

      // Autonomous Candidate Scanning - Strictly disabled in SAFE BOOT MODE or when trading loop is inactive
      const canScanAndTrade = workerStatusRef.current ? workerStatusRef.current.tradingLoopActive : false;
      if (
        canScanAndTrade &&
        botRunningRef.current &&
        settingsRef.current.autoTradingEnabled &&
        positionsRef.current.length < settingsRef.current.maxConcurrentPositions &&
        marketPairsRef.current.length > 0 &&
        !settingsRef.current.killSwitchActive
      ) {
        // Find top candidate that satisfies strategy rules
        for (const pair of marketPairsRef.current) {
          const evalRes = strategyEngine.evaluateCandidate(
            pair,
            [],
            positionsRef.current,
            undefined,
            languageRef.current
          );

          if (evalRes.qualified && evalRes.signal !== 'NO_TRADE') {
            const side: TradeDirection = evalRes.signal === 'BUY_LONG' ? 'LONG' : 'SHORT';
            await openPosition(pair.symbol, side, evalRes.rationale);
            break; // Open one at a time per scan tick
          }
        }
      }
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  // Compute Performance Analytics & Exposure
  const performanceMetrics = PerformanceAnalyticsService.calculateMetrics(closedTrades);
  const totalEquity = balance.totalMarginBalance || balance.totalWalletBalance || 0;
  const portfolioExposure = CorrelationGuard.evaluatePortfolio(
    positions,
    totalEquity,
    settings.maxOpenRiskPercent
  );

  return (
    <TradingContext.Provider
      value={{
        language,
        setLanguage,
        t,
        tradingMode,
        setTradingMode,
        botRunning,
        setBotRunning,
        toggleBot,
        credentials,
        updateCredentials,
        validateCredentials,
        isValidatingApi,
        apiStatus,
        apiErrorMessage,
        wsStatus,
        wsStatusDetails,
        reconnectWs,
        wallets,
        activeWalletId,
        activeWallet,
        switchWallet,
        saveWalletProfile,
        deleteWalletProfile,
        setCustomWalletName,
        settings,
        updateSettings,
        capitalProfile,
        updateCapitalProfile,
        telegramSettings,
        updateTelegramSettings,
        balance,
        positions,
        closedTrades,
        marketPairs,
        isLoadingMarket,
        aiState,
        sessionState,
        performanceMetrics,
        totalTradesCount: performanceMetrics.totalTrades,
        winningTradesCount: performanceMetrics.winningTrades,
        losingTradesCount: performanceMetrics.losingTrades,
        winRatePercent: performanceMetrics.winRatePercent,
        totalProfitUsd: performanceMetrics.grossProfitUsd,
        totalLossUsd: performanceMetrics.grossLossUsd,
        netProfitUsd: performanceMetrics.netProfitUsd,
        portfolioExposure,
        reconciliationReport,
        triggerEmergencyKillSwitch,
        confirmProductionTrading,
        toasts,
        addToast,
        dismissToast,
        clearAllToasts,
        openPosition,
        closePosition,
        closeAllPositions,
        refreshMarketData,
        refreshAccountData,
        runReconciliation,
        clearTradeHistory,
        workerStatus,
      }}
    >
      {children}
    </TradingContext.Provider>
  );
};

export const useTrading = () => {
  const ctx = useContext(TradingContext);
  if (!ctx) throw new Error('useTrading must be used within TradingProvider');
  return ctx;
};
