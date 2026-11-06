import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  AccountBalance,
  AIDiagnosisReport,
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
  TraderSkillModuleStatus,
  TraderSkillPreTradeRiskVerdict,
  WalletProfile,
} from '../types/trading';
import { TraderSkillMasterEngine } from '../services/traderSkillEngine';
import { BinanceService } from '../services/binanceService';
import { binanceWs, WsConnectionStatus, TickerUpdate } from '../services/binanceWsService';
import { aiEngine } from '../services/aiLearningEngine';
import { strategyEngine } from '../services/strategyEngine';
import { botSessionService } from '../services/botSessionService';
import { ExecutionService } from '../services/executionService';
import { RiskManagementService } from '../services/riskManagementService';
import { PositionReconciliationService, ReconciliationReport } from '../services/positionReconciliationService';
import { AIPositionManager } from '../services/aiPositionManager';
import { PerformanceAnalyticsService } from '../services/performanceAnalyticsService';
import { CorrelationGuard, PortfolioExposureReport } from '../services/correlationGuard';
import { TelegramService } from '../services/telegramService';
import { EncryptedStorageService } from '../services/encryptedStorageService';
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
  runAIDoctorDiagnosis: () => Promise<AIDiagnosisReport>;
  executeMaxPrioritySwap: () => Promise<{
    success: boolean;
    message: string;
    closedSymbol?: string;
    openedSymbol?: string;
  }>;
  refreshMarketData: () => Promise<void>;
  refreshAccountData: () => Promise<void>;
  runReconciliation: (isManual?: boolean) => Promise<void>;
  clearTradeHistory: () => void;
  cleanAllCacheAndReset: () => Promise<void>;
  traderSkillAuditTrail: TraderSkillPreTradeRiskVerdict[];
  traderSkillModules: TraderSkillModuleStatus[];
  refreshTraderSkillAudit: () => void;
  workerStatus?: {
    workerRunning: boolean;
    botRunning: boolean;
    safeBootMode: boolean;
    tradingLoopActive: boolean;
    uptimeSeconds: number;
  } | null;
}

const DEFAULT_SETTINGS: BotSettings = {
  positionSizingMode: 'RISK_PORTFOLIO_DYNAMIC',
  maxConcurrentPositions: 4,
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
  maxDailyDrawdownPercent: 0,
  maxDailyLossUsd: 0,
  maxConsecutiveLosses: 0,
  lossCooldownMinutes: 0,
  takeProfitPercent: 3.5,
  stopLossPercent: 1.8,
  trailingStopPercent: 0.8,
  useTrailingStop: true,
  aiDynamicTargets: true,
  multiTargetTrailing: true,
  unlimitedHoldTime: true,
  maxTradeDurationHours: 4,
  scalpingMode: false,
  scalpingDurationMinutes: 15,
  scalpingProfitLockPercent: 35,
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

  // 2. Trading Mode: Operates between Binance Demo (testnet) and Binance Live. Paper sandbox removed.
  const [tradingMode, setTradingModeState] = useState<TradingMode>(() => {
    const saved = localStorage.getItem('apex_trading_mode');
    return (saved === 'real' || saved === 'testnet') ? saved : 'real';
  });

  const setTradingMode = (mode: TradingMode) => {
    setTradingModeState(mode);
    localStorage.setItem('apex_trading_mode', mode);
  };

  // 3. Bot Status & Session State
  const [sessionState, setSessionState] = useState<BotSessionState>(() => botSessionService.getState());
  const [botRunning, setBotRunningState] = useState<boolean>(() => {
    const saved = localStorage.getItem('apex_bot_running');
    if (saved !== null) {
      return saved === 'true';
    }
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

  // Trader-Skill Suite Integration State (11 Modules with 95% Reliance)
  const [traderSkillAuditTrail, setTraderSkillAuditTrail] = useState<TraderSkillPreTradeRiskVerdict[]>(() =>
    TraderSkillMasterEngine.getAuditTrail()
  );
  const [traderSkillModules, setTraderSkillModules] = useState<TraderSkillModuleStatus[]>(() =>
    TraderSkillMasterEngine.getModuleStatuses()
  );

  const refreshTraderSkillAudit = () => {
    setTraderSkillAuditTrail(TraderSkillMasterEngine.getAuditTrail());
    setTraderSkillModules(TraderSkillMasterEngine.getModuleStatuses());
  };

  // Authoritative sync from Worker Control API
  const refreshWorkerStatus = async () => {
    try {
      const res = await fetch('/api/worker/status');
      if (res.ok) {
        const data = await res.json();
        setWorkerStatus(data);
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

  // 4. Multi-Wallet Profiles (Clean and persistent)
  const [wallets, setWallets] = useState<WalletProfile[]>(() => {
    try {
      const saved = localStorage.getItem('bavly_wallet_profiles');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sanitized: WalletProfile[] = parsed.map((w: any) => ({
            id: w.id || `wallet-${Date.now()}`,
            name: w.name || 'محفظة بافلي بينانس (Bavly Futures)',
            isTestnet: typeof w.isTestnet === 'boolean' ? w.isTestnet : true,
            isValidated: typeof w.isValidated === 'boolean' ? w.isValidated : false,
            createdAt: w.createdAt || Date.now(),
            apiKey: (w.apiKey || '').toString().trim(),
            apiSecret: (w.apiSecret || '').toString().trim(),
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
        isTestnet: true,
        isValidated: false,
        createdAt: Date.now(),
        apiKey: '',
        apiSecret: '',
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
    apiKey: activeWallet.apiKey || '',
    apiSecret: activeWallet.apiSecret || '',
  }));

  const [apiStatus, setApiStatus] = useState<'disconnected' | 'connected' | 'error'>(() => {
    return activeWallet.isValidated || Boolean(activeWallet.apiKey && activeWallet.apiSecret)
      ? 'connected'
      : 'disconnected';
  });
  const [apiErrorMessage, setApiErrorMessage] = useState('');
  const [isValidatingApi, setIsValidatingApi] = useState(false);

  // 5. Bot Settings
  const [settings, setSettings] = useState<BotSettings>(() => {
    try {
      const saved = localStorage.getItem('apex_bot_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        const resolvedCapitalProfile = {
          ...DEFAULT_CAPITAL_PROFILE,
          ...(parsed.capitalProfile || {}),
        };

        // Auto-heal: Ensure risk per trade is positive institutional 1.0%
        if (!resolvedCapitalProfile.riskPerTradePercent || resolvedCapitalProfile.riskPerTradePercent <= 0) {
          resolvedCapitalProfile.riskPerTradePercent = 1.0;
        }
        if (!resolvedCapitalProfile.maxOpenPositions || resolvedCapitalProfile.maxOpenPositions <= 0) {
          resolvedCapitalProfile.maxOpenPositions = 4;
        }

        const healedSettings: BotSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          riskPerTradePercent:
            parsed.riskPerTradePercent && parsed.riskPerTradePercent > 0 ? parsed.riskPerTradePercent : 1.0,
          enableCapitalLimit: false,
          maxAllocatedCapitalUsd: 0,
          maxDailyDrawdownPercent: 0,
          maxDailyLossUsd: 0,
          maxConsecutiveLosses: 0,
          lossCooldownMinutes: 0,
          aiDynamicTargets: true,
          productionConfirmed: false,
          capitalProfile: resolvedCapitalProfile,
        };

        localStorage.setItem('apex_bot_settings', JSON.stringify(healedSettings));
        return healedSettings;
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

  // 7. Open Positions & Closed Trades
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

  // 8. Balances
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

  // Dynamic Live Position Aggregates
  const totalPositionsUnrealizedPnl = positions.reduce(
    (sum, p) => sum + (Number(p.unrealizedProfit) || 0),
    0
  );
  const totalPositionsInitialMargin = positions.reduce(
    (sum, p) => sum + (Number(p.amountUsd) || (Number(p.notionalValue) / (p.leverage || 1)) || 0),
    0
  );

  const balance: AccountBalance =
    tradingMode === 'real' && (realBalance.totalWalletBalance > 0 || realBalance.availableBalance > 0)
      ? {
          ...realBalance,
          totalUnrealizedProfit: Number(totalPositionsUnrealizedPnl.toFixed(2)),
          totalMarginBalance: Number(
            (realBalance.totalWalletBalance + totalPositionsUnrealizedPnl).toFixed(2)
          ),
          availableBalance:
            positions.length > 0 && totalPositionsInitialMargin > 0
              ? Math.max(0, Number((realBalance.totalWalletBalance - totalPositionsInitialMargin).toFixed(2)))
              : realBalance.availableBalance,
        }
      : {
          totalWalletBalance: Number(paperBalance.toFixed(2)),
          availableBalance: Math.max(0, Number((paperBalance - totalPositionsInitialMargin).toFixed(2))),
          totalUnrealizedProfit: Number(totalPositionsUnrealizedPnl.toFixed(2)),
          totalMarginBalance: Number((paperBalance + totalPositionsUnrealizedPnl).toFixed(2)),
          totalInitialMargin: Number(totalPositionsInitialMargin.toFixed(2)),
          totalMaintMargin: Number((totalPositionsInitialMargin * 0.5).toFixed(2)),
        };

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

  // Refs for asynchronous loops
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const addToast = (toast: Omit<ToastAlert, 'id' | 'timestamp'>) => {
    // If on-screen toast alerts are disabled by user, suppress completely
    if (!settingsRef.current.enableToastAlerts) return;
    const newAlert: ToastAlert = {
      ...toast,
      id: `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };
    setToasts((prev) => [newAlert, ...prev.slice(0, 9)]);
  };

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const clearAllToasts = () => setToasts([]);

  const lastDiscrepancyToastRef = useRef<number>(0);
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

  // Intelligent Pacing & Execution Cooldown Refs
  const botStartedAtRef = useRef<number>(Date.now());
  const lastTradeOpenedAtRef = useRef<number>(0);
  const lastTradedSymbolsRef = useRef<Map<string, number>>(new Map());
  const lastInsufficientMarginToastRef = useRef<number>(0);
  const lastCandidateAttemptRef = useRef<number>(0);

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
    // Initial sync with authoritative backend session while strictly respecting user's localStorage stop command
    botSessionService.syncWithServer().then((synced) => {
      setSessionState(synced);
      const savedRunning = localStorage.getItem('apex_bot_running');
      if (savedRunning !== null) {
        const isRunning = savedRunning === 'true';
        setBotRunningState(isRunning);
        botRunningRef.current = isRunning;
      } else {
        setBotRunningState(synced.status === 'RUNNING');
        botRunningRef.current = synced.status === 'RUNNING';
      }
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
    const isAr = languageRef.current === 'ar';

    if (running) {
      // 1. Capital Safety validation check before starting bot
      const capValidation = RiskManagementService.validateCapitalProfile(settingsRef.current.capitalProfile);
      if (!capValidation.isValid) {
        addToast({
          type: 'ERROR',
          title: isAr ? 'فشل بدء التداول - إعدادات رأس المال غير صالحة' : 'Cannot Start Bot - Invalid Capital Profile',
          message: capValidation.error || 'Invalid Capital Profile settings. Please check Settings modal.',
        });
        return;
      }

      // 2. Synchronous immediate state and ref update
      setBotRunningState(true);
      botRunningRef.current = true;
      botStartedAtRef.current = Date.now();
      lastTradeOpenedAtRef.current = Date.now();
      localStorage.setItem('apex_bot_running', 'true');

      // 3. Notify backend worker
      fetch('/api/worker/start', { method: 'POST' }).catch((err) => {
        console.error('[TradingContext] Failed to call /api/worker/start:', err);
      });

      // 4. Start session ticker
      const newSession = await botSessionService.startSession();
      setSessionState(newSession);

      addToast({
        type: 'INFO',
        title: isAr ? '▶️ تم تشغيل البوت الذكي 24/7' : '▶️ Smart ApexAI Bot Activated',
        message: isAr
          ? `بدأ التحليل الذكي ومسح أزواج السوق لاقتناص أقوى الفرص المؤكدة (Grade A). لن يتم التسرع في الدخول؛ الصفقات تُفتح بتأنٍ عند استيفاء أعلى درجات الزخم وتأكيدات السيولة.`
          : `Scanning and analyzing markets for Grade A confirmed opportunities. Execution is paced and highly selective for top-probability setups.`,
      });
    } else {
      // 1. Synchronous immediate freeze of trading loop
      setBotRunningState(false);
      botRunningRef.current = false;
      localStorage.setItem('apex_bot_running', 'false');

      // 2. Notify backend worker
      fetch('/api/worker/stop', { method: 'POST' }).catch((err) => {
        console.error('[TradingContext] Failed to call /api/worker/stop:', err);
      });

      // 3. Stop session ticker
      const stoppedSession = await botSessionService.stopSession();
      setSessionState(stoppedSession);

      addToast({
        type: 'INFO',
        title: isAr ? '⏹️ تم إيقاف البوت بنجاح' : '⏹️ Bot Stopped',
        message: isAr
          ? 'تم إيقاف عمل البوت فوراً وبشكل كامل. توقفت عمليات فحص السوق وفتح صفقات جديدة حتى يتم تشغيله مجدداً.'
          : 'ApexAI Bot halted immediately. Market scanning and new entries are fully paused.',
      });
    }
  };

  const toggleBot = () => {
    setBotRunning(!botRunningRef.current);
  };

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
      apiKey: target.apiKey || '',
      apiSecret: target.apiSecret || '',
    };
    setCredentials(newCreds);

    if (newCreds.apiKey && newCreds.apiSecret) {
      await validateCredentials(newCreds);
    }
  };

  const saveWalletProfile = (profile: Omit<WalletProfile, 'id' | 'createdAt'> & { id?: string }) => {
    const newId = profile.id || `wallet-${Date.now()}`;
    const newProfile: WalletProfile = {
      id: newId,
      name: profile.name,
      isTestnet: profile.isTestnet,
      isValidated: profile.isValidated ?? false,
      createdAt: Date.now(),
      apiKey: (profile.apiKey || '').toString().trim(),
      apiSecret: (profile.apiSecret || '').toString().trim(),
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
        apiKey: newProfile.apiKey,
        apiSecret: newProfile.apiSecret,
      });
    }

    if (newProfile.apiKey && newProfile.apiSecret) {
      BinanceService.saveCredentials({
        isTestnet: newProfile.isTestnet,
        apiKey: newProfile.apiKey,
        apiSecret: newProfile.apiSecret,
        isValidated: newProfile.isValidated,
      }).catch((e) => console.warn('Failed to sync credentials to server:', e));

      EncryptedStorageService.saveCredentials({
        apiKey: newProfile.apiKey,
        apiSecret: newProfile.apiSecret,
        isTestnet: newProfile.isTestnet,
        walletName: newProfile.name,
      }).catch((e) => console.warn('Failed to persist to encrypted client storage:', e));
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
      if (updated.apiKey && updated.apiSecret) {
        BinanceService.saveCredentials(updated).catch((e) =>
          console.warn('Failed to sync credentials to server:', e)
        );
        EncryptedStorageService.saveCredentials({
          apiKey: updated.apiKey,
          apiSecret: updated.apiSecret,
          isTestnet: updated.isTestnet,
          walletName: updated.walletName,
        }).catch((e) => console.warn('Failed to persist to encrypted client storage:', e));
      }
      return updated;
    });
  };

  const validateCredentials = async (overrideCreds?: BinanceCredentials): Promise<boolean> => {
    const credsToTest: BinanceCredentials = {
      ...credentials,
      ...(overrideCreds || {}),
      apiKey: (overrideCreds?.apiKey ?? credentials.apiKey ?? '').trim(),
      apiSecret: (overrideCreds?.apiSecret ?? credentials.apiSecret ?? '').trim(),
    };
    setIsValidatingApi(true);
    setApiErrorMessage('');

    try {
      const res = await BinanceService.validateCredentials(credsToTest);
      if (res.success && res.balance) {
        setRealBalance(res.balance);
        setApiStatus('connected');
        const finalCreds: BinanceCredentials = {
          ...credsToTest,
          isValidated: true,
          isServerConfigured: true,
        };
        setCredentials(finalCreds);
        setTradingMode('real');
        updateSettings({ productionConfirmed: true });

        // Persist to wallet profile in localStorage
        saveWalletProfile({
          id: activeWalletId,
          name: finalCreds.walletName || activeWallet.name,
          isTestnet: finalCreds.isTestnet,
          isValidated: true,
          apiKey: finalCreds.apiKey,
          apiSecret: finalCreds.apiSecret,
        });

        const isAr = languageRef.current === 'ar';
        addToast({
          type: 'INFO',
          title: isAr
            ? (finalCreds.isTestnet ? '✓ متصل بـ باينانس ديمو (التداول الفعلي مفعل)' : '✓ متصل بـ باينانس الحساب الحقيقي')
            : (finalCreds.isTestnet ? '✓ Connected to Binance Demo (Live Execution Active)' : '✓ Connected to Binance Production'),
          message: isAr
            ? `تم التحقق والربط بنجاح مع منصة باينانس (${finalCreds.isTestnet ? 'حساب ديمو testnet.binancefuture.com' : 'حساب حقيقي'}). الصفقات ستُنفذ وتظهر في حسابك مباشرة. الرصيد: $${res.balance.availableBalance.toFixed(2)} USDT`
            : `Connected to ${finalCreds.isTestnet ? 'Binance Demo' : 'Binance Live'}. Orders will execute directly on your Binance account. Available: $${res.balance.availableBalance.toFixed(2)} USDT`,
        });

        // Also refresh account positions directly from Binance
        await refreshAccountData();
        return true;
      } else {
        setApiStatus('error');
        setApiErrorMessage(res.error || (languageRef.current === 'ar' ? 'فشل الاتصال بـ Binance.' : 'Failed to authenticate with Binance.'));
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

        // Continuous Live Mark-Price & PnL Engine for all open positions
        setPositions((prevPositions) => {
          if (prevPositions.length === 0) return prevPositions;
          let changed = false;
          const tickerMap = new Map<string, FuturesSymbolInfo>();
          tickers.forEach((t) => tickerMap.set(t.symbol, t));

          const updated = prevPositions.map((pos) => {
            const u = tickerMap.get(pos.symbol);
            if (u && typeof u.price === 'number' && u.price > 0) {
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
                unrealizedProfit: Number(dollarPnl.toFixed(4)),
                pnlPercentage: Number(pnlPct.toFixed(2)),
                highestPriceReached: high,
                lowestPriceReached: low,
              };
            }
            return pos;
          });
          return changed ? updated : prevPositions;
        });
      }
    } catch (err) {
      console.warn('[TradingContext] Non-fatal market ticker refresh notice:', err);
    } finally {
      setIsLoadingMarket(false);
    }
  };

  const refreshAccountData = async () => {
    if (credentialsRef.current.isValidated || (credentialsRef.current.apiKey && credentialsRef.current.apiSecret)) {
      const res = await BinanceService.fetchAccount(credentialsRef.current);
      if (res.success && res.balance) {
        setRealBalance(res.balance);
      }
      if (res.success && Array.isArray(res.positions)) {
        // Sync live Binance positions into app state
        setPositions((prevPositions) => {
          const existingMap = new Map(prevPositions.map((p) => [p.symbol, p]));

          const livePositions: Position[] = res.positions!.map((bp: any) => {
            const existing = existingMap.get(bp.symbol);
            const side: TradeDirection = bp.side === 'LONG' ? 'LONG' : 'SHORT';
            const lev = bp.leverage || 20;
            const absAmt = Math.abs(bp.positionAmt);
            const amountUsd = bp.isolatedMargin > 0 ? bp.isolatedMargin : (absAmt * bp.entryPrice) / lev;
            const notional = absAmt * (bp.markPrice || bp.entryPrice);
            const rawPnl = typeof bp.unrealizedProfit === 'number' ? bp.unrealizedProfit : 0;
            const safeMargin = Math.max(0.01, amountUsd);
            const calcPnlPct = (rawPnl / safeMargin) * 100;

            return {
              id: existing?.id || `pos-binance-${bp.symbol}-${Date.now()}`,
              symbol: bp.symbol,
              side,
              entryPrice: bp.entryPrice,
              markPrice: bp.markPrice || bp.entryPrice,
              quantity: absAmt,
              amountUsd: Number(amountUsd.toFixed(2)),
              notionalValue: Number(notional.toFixed(2)),
              leverage: lev,
              liquidationPrice: bp.liquidationPrice || 0,
              stopLossPrice: existing?.stopLossPrice || (side === 'LONG' ? bp.entryPrice * 0.985 : bp.entryPrice * 1.015),
              takeProfitPrice: existing?.takeProfitPrice || (side === 'LONG' ? bp.entryPrice * 1.03 : bp.entryPrice * 0.97),
              unrealizedProfit: Number(rawPnl.toFixed(4)),
              pnlPercentage: Number(calcPnlPct.toFixed(2)),
              openedAt: existing?.openedAt || Date.now(),
              maxDurationMs: existing?.maxDurationMs || 86400000,
              aiConfidence: existing?.aiConfidence || 85,
              rationale: existing?.rationale || 'Real-time Position Synced with Binance',
              isRealOrder: true,
              isTestnet: credentialsRef.current.isTestnet,
              stopLossOrderStatus: existing?.stopLossOrderStatus || 'ACTIVE',
              takeProfitOrderStatus: existing?.takeProfitOrderStatus || 'ACTIVE',
              lastReconciliationTime: Date.now(),
              reconciliationStatus: 'IN_SYNC',
              estimatedCommissionUsd: existing?.estimatedCommissionUsd || 0.02,
              fundingFeeUsd: 0,
              slippageEstimateUsd: 0,
              aiDiagnosis: existing?.aiDiagnosis,
              dcaCount: existing?.dcaCount || 0,
            };
          });

          return livePositions;
        });
      }
    }
  };

  // Auto-connect and hydrate live Binance account data on mount and wallet switch
  useEffect(() => {
    let isMounted = true;
    const initializeAccount = async () => {
      try {
        const hasCreds = Boolean(credentialsRef.current.apiKey && credentialsRef.current.apiSecret);
        const serverStatus = await BinanceService.checkServerConfigStatus(credentialsRef.current.isTestnet);
        const isServerConfigured = credentialsRef.current.isTestnet
          ? serverStatus.testnetConfigured
          : serverStatus.prodConfigured;

        if (hasCreds || isServerConfigured || credentialsRef.current.isValidated) {
          if (isMounted) {
            setApiStatus('connected');
            setCredentials((prev) => ({
              ...prev,
              isValidated: true,
              isServerConfigured,
            }));
            setTradingMode('real');
            await refreshAccountData();
          }
        }
      } catch (e) {
        console.warn('Auto-connect on mount notice:', e);
      }
    };

    initializeAccount();
    return () => {
      isMounted = false;
    };
  }, [activeWalletId, credentials.isTestnet]);

  const runReconciliation = async (isManual = false) => {
    const isAr = languageRef.current === 'ar';
    const report = await PositionReconciliationService.reconcile(
      credentialsRef.current,
      positionsRef.current,
      tradingModeRef.current === 'real'
    );
    setReconciliationReport(report);

    if (report.hasDiscrepancy) {
      // Auto-heal local positions by syncing directly from Binance
      refreshAccountData();

      // Only notify if user clicked manually or if at least 5 minutes have passed since last toast
      const now = Date.now();
      const shouldNotify = isManual || (now - lastDiscrepancyToastRef.current > 300000);
      if (shouldNotify) {
        lastDiscrepancyToastRef.current = now;
        addToast({
          type: 'WARNING',
          title: isAr ? '⚠️ تنبيه مطابقة الصفقات' : '⚠️ Position Reconciliation Alert',
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
    } else if (isManual) {
      addToast({
        type: 'INFO',
        title: isAr ? '🛡️ فحص مطابقة الصفقات' : '🛡️ Reconciliation Complete',
        message: report.message,
      });
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
      stopLossPrice?: number;
      takeProfitPrice?: number;
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

    const pricePrec = pairInfo.pricePrecision ?? 4;
    const isScalp = Boolean(settingsRef.current.scalpingMode);
    const plannedStop = Number(
      (options?.stopLossPrice || evalResult.plannedStopLossPrice || pairInfo.price * (side === 'LONG' ? 0.985 : 1.015)).toFixed(pricePrec)
    );
    // In Fast Scalping mode, anchor TP to tight TP1 impulse target for rapid fill; otherwise use primary planned TP
    const plannedTp = Number(
      (
        options?.takeProfitPrice ||
        (isScalp && evalResult.tp1Price ? evalResult.tp1Price : evalResult.plannedTakeProfitPrice) ||
        pairInfo.price * (side === 'LONG' ? 1.02 : 0.98)
      ).toFixed(pricePrec)
    );

    const hasBinanceCreds = Boolean(credentialsRef.current.apiKey && credentialsRef.current.apiSecret);
    const isBinanceExecution = tradingModeRef.current === 'real' || hasBinanceCreds;

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
      isBinanceExecution,
      credentialsRef.current.isTestnet
    );

    refreshTraderSkillAudit();

    if (!execResult.success || !execResult.position) {
      const isAr = languageRef.current === 'ar';
      const errMsg = execResult.rejectionReason || execResult.error || 'Order rejected by hard limits.';
      const isMarginErr = errMsg.includes('الهامش') || errMsg.toLowerCase().includes('margin');
      const now = Date.now();

      // Only alert once every 5 minutes for insufficient margin to avoid flooding the user interface
      if (!isMarginErr || (now - lastInsufficientMarginToastRef.current > 300000)) {
        if (isMarginErr) {
          lastInsufficientMarginToastRef.current = now;
        }
        addToast({
          type: 'INFO',
          title: isAr ? '🛡️ محرك المخاطر منع الصفقة' : '🛡️ Order Rejected by Risk Engine',
          message: errMsg,
        });
      }
      return false;
    }

    const pos = execResult.position;

    // Direct Verification & Guarantee of SL and TP Orders on Binance during Order Creation Call
    if (isBinanceExecution && hasBinanceCreds) {
      const protectiveSide = side === 'LONG' ? 'SELL' : 'BUY';

      // 1. Ensure Stop Loss order is submitted directly to Binance API
      if (!pos.exchangeStopLossOrderId && plannedStop > 0) {
        try {
          const slResponse = await BinanceService.placeProtectiveStopOrder(
            credentialsRef.current,
            symbol,
            protectiveSide,
            plannedStop,
            pos.quantity,
            pricePrec
          );
          if (slResponse.success && slResponse.order?.orderId) {
            pos.exchangeStopLossOrderId = slResponse.order.orderId.toString();
            pos.stopLossOrderStatus = 'ACTIVE';
          }
        } catch (e) {
          console.warn('[TradingContext] Direct Stop Loss submission error:', e);
        }
      }

      // 2. Ensure Take Profit order is submitted directly to Binance API
      if (!pos.exchangeTakeProfitOrderId && plannedTp > 0) {
        try {
          const tpResponse = await BinanceService.placeTakeProfitOrder(
            credentialsRef.current,
            symbol,
            protectiveSide,
            plannedTp,
            pos.quantity,
            pricePrec
          );
          if (tpResponse.success && tpResponse.order?.orderId) {
            pos.exchangeTakeProfitOrderId = tpResponse.order.orderId.toString();
            pos.takeProfitOrderStatus = 'ACTIVE';
          }
        } catch (e) {
          console.warn('[TradingContext] Direct Take Profit submission error:', e);
        }
      }

      if (pos.exchangeStopLossOrderId && pos.exchangeTakeProfitOrderId) {
        pos.reconciliationStatus = 'IN_SYNC';
        pos.reconciliationMessage = 'Main order, Stop Loss (SL) and Take Profit (TP) active on Binance.';
      }
    }

    setPositions((prev) => [pos, ...prev]);

    // Send Real-Time Toast Notification
    const isAr = languageRef.current === 'ar';
    const isBinanceDirect = execResult.isRealOrder || hasBinanceCreds;
    const envLabel = credentialsRef.current.isTestnet ? 'باينانس ديمو (testnet)' : 'باينانس لايف';
    const hasSl = Boolean(pos.exchangeStopLossOrderId);
    const hasTp = Boolean(pos.exchangeTakeProfitOrderId);

    addToast({
      type: side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
      title: isAr
        ? `تم فتح صفقة ${side === 'LONG' ? 'شراء (LONG)' : 'بيع (SHORT)'} ${isBinanceDirect ? `على ${envLabel} حقيقي` : 'تجريبية'}`
        : `Executed ${side} ${isBinanceDirect ? `on ${credentialsRef.current.isTestnet ? 'Binance Demo' : 'Binance Live'}` : 'Paper'}`,
      message: isAr
        ? `${symbol} • ${pos.leverage}x • $${pos.amountUsd} @ $${pos.entryPrice.toLocaleString()} | وقف: $${plannedStop} ${hasSl ? '✓' : ''} | هدف: $${plannedTp} ${hasTp ? '✓' : ''}`
        : `${symbol} • ${pos.leverage}x • $${pos.amountUsd} @ $${pos.entryPrice.toLocaleString()} | SL: $${plannedStop} ${hasSl ? '✓' : ''} | TP: $${plannedTp} ${hasTp ? '✓' : ''}`,
      symbol,
      side,
    });

    TelegramService.notifyPositionOpened(telegramSettingsRef.current, pos, languageRef.current === 'ar');
    return true;
  };

  const closePosition = async (
    positionId: string,
    reason: ClosedTrade['exitReason'] = 'MANUAL_CLOSE'
  ): Promise<boolean> => {
    const target = positionsRef.current.find((p) => p.id === positionId);
    if (!target) return false;

    // Real Binance close order if in Binance execution mode
    const hasBinance = credentialsRef.current.isValidated && Boolean(credentialsRef.current.apiKey && credentialsRef.current.apiSecret);
    if ((tradingModeRef.current === 'real' || hasBinance) && (target.isRealOrder || hasBinance)) {
      const closeRes = await BinanceService.closePosition(credentialsRef.current, target.symbol);
      if (!closeRes.success && !closeRes.alreadyClosed) {
        console.error(`Failed to close position ${target.symbol} on Binance:`, closeRes.error);
        const isArClose = languageRef.current === 'ar';
        addToast({
          type: 'ERROR',
          title: isArClose ? `❌ تعذر إغلاق ${target.symbol} على باينانس` : `❌ Failed to close ${target.symbol} on Binance`,
          message: closeRes.error || (isArClose ? 'رفضت منصة باينانس تنفيذ أمر الإغلاق. يُرجى مراجعة الاتصال أو إغلاقها يدوياً.' : 'Binance rejected the close order. Check connection or close manually.'),
        });
        return false;
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
    else if (reason === 'AI_EARLY_CUT') reasonText = isArClose ? 'إغلاق ذكي مبكر (حماية من الوقف)' : 'AI Smart Loss Cut';
    else if (reason === 'AI_EARLY_PROFIT_TAKE') reasonText = isArClose ? 'حجز أرباح سكالبينج (أنتش واجري)' : 'Scalp Hit & Run Profit Lock';
    else if (reason === 'AI_BREAKEVEN_EXIT') reasonText = isArClose ? 'خروج تعادل آمن ($0)' : 'AI Breakeven Exit';
    else if (reason === 'AI_DCA_REINFORCE') reasonText = isArClose ? 'تعزيز وتبريد ذكي' : 'AI DCA Exit';
    else if (reason === 'TIME_EXPIRED') reasonText = isArClose ? 'انتهاء المدة' : 'Time Expiry';
    else reasonText = isArClose ? 'إغلاق يدوي' : 'Manual Close';

    addToast({
      type: isWin ? 'CLOSE_WIN' : 'CLOSE_LOSS',
      title: isWin
        ? (isArClose ? (reason === 'AI_EARLY_PROFIT_TAKE' ? '⚡ اقتناص ربح سكالبينج (أنتش واجري)!' : '🎯 تحقيق هدف الربح!') : '🎯 Target Hit! Position Closed')
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
    const isAr = languageRef.current === 'ar';
    const list = [...positionsRef.current];
    if (list.length === 0) return;

    const hasBinance = credentialsRef.current.isValidated && Boolean(credentialsRef.current.apiKey && credentialsRef.current.apiSecret);

    if (tradingModeRef.current === 'real' || hasBinance) {
      // 1. Direct atomic liquidation of all positions on Binance API
      const binanceRes = await BinanceService.closeAllPositions(credentialsRef.current);
      if (!binanceRes.success && (!binanceRes.closedSymbols || binanceRes.closedSymbols.length === 0)) {
        addToast({
          type: 'ERROR',
          title: isAr ? '❌ تعذر إغلاق جميع الصفقات على باينانس' : '❌ Failed to Close All Positions on Binance',
          message: binanceRes.error || (binanceRes.errors && binanceRes.errors.join('; ')) || 'Binance rejected close-all command.',
        });
        await refreshAccountData();
        return;
      }
    }

    // 2. Close positions locally and record closed trades
    let closedCount = 0;
    for (const pos of list) {
      try {
        await closePosition(pos.id, 'MANUAL_CLOSE');
        closedCount++;
      } catch (err) {
        console.error(`Failed to close position ${pos.symbol}:`, err);
      }
    }

    // 3. Immediately refresh account data from Binance to guarantee 100% sync
    if (tradingModeRef.current === 'real' || hasBinance) {
      await refreshAccountData();
    }

    addToast({
      type: 'INFO',
      title: isAr ? '⚡ تم إغلاق وتصفية جميع الصفقات بنجاح' : '⚡ All Positions Closed',
      message: isAr
        ? `تم إغلاق وتصفية جميع الصفقات (${closedCount} صفقات) في حساب باينانس بالكامل وتأمين رأس المال وتحديث الرصيد.`
        : `Successfully closed and liquidated all positions (${closedCount} trades) directly on Binance and freed margin.`,
    });
  };

  const runAIDoctorDiagnosis = async (): Promise<AIDiagnosisReport> => {
    const isAr = languageRef.current === 'ar';
    const currentPositions = [...positionsRef.current];

    if (currentPositions.length === 0) {
      addToast({
        type: 'INFO',
        title: isAr ? '🩺 التشخيص الذكي للصفقات' : '🩺 AI Trade Doctor',
        message: isAr
          ? 'لا توجد أي صفقات مفتوحة حالياً لتشخيصها. يمكنك تشغيل البوت أو استخدام زر "الأولوية القصوى" لاقتناص صفقة.'
          : 'No open positions to diagnose. Start the bot or use Max Priority Swap to enter top opportunities.',
      });
      return {
        scanned: 0,
        closedEarly: 0,
        closedBreakeven: 0,
        profitLocked: 0,
        reinforced: 0,
        held: 0,
        timestamp: Date.now(),
        items: [],
      };
    }

    let closedEarly = 0;
    let closedBreakeven = 0;
    let profitLocked = 0;
    let reinforced = 0;
    let held = 0;
    const items: AIDiagnosisReport['items'] = [];

    // Ticker lookup map
    const pairMap = new Map<string, FuturesSymbolInfo>();
    marketPairsRef.current.forEach((p) => pairMap.set(p.symbol, p));

    for (const pos of currentPositions) {
      const pair = pairMap.get(pos.symbol);
      const diag = AIPositionManager.diagnosePosition(pos, pair, undefined, languageRef.current);

      let actionText = '';
      if (diag.recommendation === 'AI_EARLY_CUT') {
        actionText = isAr ? 'إغلاق وقائي مبكر (توفير خسارة الوقف)' : 'Smart Pre-emptive Cut';
        await closePosition(pos.id, 'AI_EARLY_CUT');
        closedEarly++;
      } else if (diag.recommendation === 'AI_BREAKEVEN_EXIT') {
        actionText = isAr ? 'خروج تعادل آمن ($0 خسارة)' : 'Safe Breakeven Exit ($0)';
        await closePosition(pos.id, 'AI_BREAKEVEN_EXIT');
        closedBreakeven++;
      } else if (diag.recommendation === 'AI_EARLY_PROFIT_TAKE') {
        actionText = isAr ? 'حجز أرباح مبكرة بالذكاء الاصطناعي' : 'Smart Profit Lock';
        await closePosition(pos.id, 'AI_EARLY_PROFIT_TAKE');
        profitLocked++;
      } else if (diag.recommendation === 'AI_DCA_REINFORCE') {
        actionText = isAr ? 'تعزيز وتبريد ذكي للدخول' : 'Smart DCA Reinforce';
        const currentMark = pos.markPrice || pos.entryPrice;
        const newEntry = Number(((pos.entryPrice + currentMark) / 2).toFixed(6));
        setPositions((prev) =>
          prev.map((p) =>
            p.id === pos.id
              ? {
                  ...p,
                  entryPrice: newEntry,
                  dcaCount: (p.dcaCount || 0) + 1,
                  aiDiagnosis: diag,
                }
              : p
          )
        );
        reinforced++;
      } else {
        actionText = isAr ? 'استمرار الصفقة بأمان' : 'Hold & Monitor';
        setPositions((prev) =>
          prev.map((p) => (p.id === pos.id ? { ...p, aiDiagnosis: diag } : p))
        );
        held++;
      }

      items.push({
        symbol: pos.symbol,
        side: pos.side,
        pnlPercentage: pos.pnlPercentage,
        recoveryProbability: diag.recoveryProbability,
        action: actionText,
        actionType: diag.recommendation,
        reason: isAr ? diag.reasoningAr : diag.reasoningEn,
      });
    }

    addToast({
      type: 'INFO',
      title: isAr ? '🩺 اكتمل تشخيص وإدارة الصفقات الذكية' : '🩺 AI Trade Doctor Run Complete',
      message: isAr
        ? `تم فحص ${currentPositions.length} صفقات: ${closedEarly > 0 ? `🛡️ إغلاق ${closedEarly} وقائياً، ` : ''}${closedBreakeven > 0 ? `⚖️ خروج تعادل ${closedBreakeven}، ` : ''}${profitLocked > 0 ? `💰 حجز أرباح ${profitLocked}، ` : ''}✅ ${held} صفقات مستمرة بأمان.`
        : `Scanned ${currentPositions.length} positions: ${closedEarly} early cuts, ${closedBreakeven} breakeven exits, ${profitLocked} profits locked, ${held} healthy held.`,
    });

    return {
      scanned: currentPositions.length,
      closedEarly,
      closedBreakeven,
      profitLocked,
      reinforced,
      held,
      timestamp: Date.now(),
      items,
    };
  };

  const executeMaxPrioritySwap = async (): Promise<{
    success: boolean;
    message: string;
    closedSymbol?: string;
    openedSymbol?: string;
  }> => {
    const isAr = languageRef.current === 'ar';
    const activeList = [...positionsRef.current];
    const availablePairs = marketPairsRef.current;

    if (availablePairs.length === 0) {
      const msg = isAr ? 'بيانات السوق جارية التحديث، يرجى الانتظار ثوانٍ معدودة.' : 'Market pairs loading, please wait.';
      addToast({ type: 'WARNING', title: isAr ? 'تنبيه الأولوية القصوى' : 'Max Priority Alert', message: msg });
      return { success: false, message: msg };
    }

    // Filter out pairs that already have an open position
    const openSymbols = new Set(activeList.map((p) => p.symbol));
    const candidatePairs = availablePairs.filter((p) => !openSymbols.has(p.symbol));

    // Sort candidates by strategic momentum & AI conviction
    const sortedCandidates = [...candidatePairs].sort((a, b) => {
      const scoreA = Math.abs(a.priceChangePercent) * 2 + (a.volume24h > 10000000 ? 20 : 0);
      const scoreB = Math.abs(b.priceChangePercent) * 2 + (b.volume24h > 10000000 ? 20 : 0);
      return scoreB - scoreA;
    });

    const topCandidate = sortedCandidates[0];
    if (!topCandidate) {
      const msg = isAr ? 'لم يتم العثور على فرص جديدة خارج الصفقات المفتوحة حالياً.' : 'No candidate opportunities found.';
      return { success: false, message: msg };
    }

    const targetSide: TradeDirection = topCandidate.trend === 'BEARISH' ? 'SHORT' : 'LONG';

    // CASE 1: No open positions -> Enter top candidate directly
    if (activeList.length === 0) {
      const opened = await openPosition(
        topCandidate.symbol,
        targetSide,
        isAr
          ? `🔥 اقتناص الأولوية القصوى: أقوى فرصة تداول في السوق بزخم ${(topCandidate.priceChangePercent > 0 ? '+' : '') + topCandidate.priceChangePercent.toFixed(2)}%`
          : `🔥 Max Priority Setup: Top momentum setup (${topCandidate.priceChangePercent.toFixed(2)}%)`
      );

      const msg = opened
        ? (isAr
            ? `🔥 تم اقتناص صفقة الأولوية القصوى بنجاح: ${topCandidate.symbol} (${targetSide}) بأعلى زخم في السوق!`
            : `🔥 Max Priority Opportunity Captured: ${topCandidate.symbol} (${targetSide})!`)
        : (isAr ? 'تعذر فتح الصفقة، يرجى التحقق من الرصيد والرافعة.' : 'Could not open position.');

      addToast({
        type: opened ? 'OPEN_LONG' : 'ERROR',
        title: isAr ? '🔥 اقتناص الأولوية القصوى' : '🔥 Max Priority Triggered',
        message: msg,
        symbol: topCandidate.symbol,
      });

      return { success: opened, message: msg, openedSymbol: topCandidate.symbol };
    }

    // CASE 2: Active positions exist -> find the weakest position
    const pairMap = new Map<string, FuturesSymbolInfo>();
    marketPairsRef.current.forEach((p) => pairMap.set(p.symbol, p));

    const diagnosedPositions = activeList.map((pos) => {
      const pair = pairMap.get(pos.symbol);
      const diag = AIPositionManager.diagnosePosition(pos, pair, undefined, languageRef.current);
      return { pos, diag };
    });

    // Sort by recovery probability ascending (lowest recovery first)
    diagnosedPositions.sort((a, b) => {
      if (a.diag.recoveryProbability !== b.diag.recoveryProbability) {
        return a.diag.recoveryProbability - b.diag.recoveryProbability;
      }
      return a.pos.pnlPercentage - b.pos.pnlPercentage;
    });

    const weakest = diagnosedPositions[0];

    // If the weakest position is struggling (recovery <= 50 or negative pnl)
    if (weakest.diag.recoveryProbability <= 50 || weakest.pos.pnlPercentage < 0) {
      // Close weakest to release margin
      await closePosition(weakest.pos.id, 'AI_EARLY_CUT');

      // Immediately enter top candidate
      await openPosition(
        topCandidate.symbol,
        targetSide,
        isAr
          ? `🔥 إعادة تخصيص رأس المال (الأولوية القصوى): تحرير الهامش من ${weakest.pos.symbol} لاقتناص أقوى فرصة (${topCandidate.symbol})`
          : `🔥 Capital Reallocation: Reassigned margin from ${weakest.pos.symbol} to top runner ${topCandidate.symbol}`
      );

      const msg = isAr
        ? `🔄 تم استبدال صفقة الأولوية القصوى: تم تحرير الهامش من ${weakest.pos.symbol} (احتمالية تعافيها ${weakest.diag.recoveryProbability}%) واقتناص ${topCandidate.symbol} (${targetSide}) فوراً بأعلى كفاءة رأس مال!`
        : `🔄 Reallocation complete: Closed lagging ${weakest.pos.symbol} and entered top-conviction ${topCandidate.symbol} (${targetSide})!`;

      addToast({
        type: 'INFO',
        title: isAr ? '🔄 نجاح استبدال وإعادة تخصيص الأولوية القصوى' : '🔄 Max Priority Reallocation Complete',
        message: msg,
        symbol: topCandidate.symbol,
      });

      return {
        success: true,
        message: msg,
        closedSymbol: weakest.pos.symbol,
        openedSymbol: topCandidate.symbol,
      };
    }

    // CASE 3: All active positions are healthy & strong
    // If slots available below maxConcurrentPositions, open top candidate as well!
    if (activeList.length < settingsRef.current.maxConcurrentPositions) {
      await openPosition(
        topCandidate.symbol,
        targetSide,
        isAr
          ? `🔥 دخول صفقة أولوية قصوى إضافية: ${topCandidate.symbol} مع الحفاظ على الصفقات الرابحة الحالية`
          : `🔥 Additional Max Priority entry: ${topCandidate.symbol}`
      );

      const msg = isAr
        ? `🔥 تم اقتناص صفقة الأولوية القصوى (${topCandidate.symbol}) كمركز إضافي مع الاحتفاظ بصفقاتك الرابحة الحالية!`
        : `🔥 Opened additional top opportunity ${topCandidate.symbol}!`;

      addToast({
        type: 'OPEN_LONG',
        title: isAr ? '🔥 اقتناص الأولوية القصوى' : '🔥 Max Priority Captured',
        message: msg,
        symbol: topCandidate.symbol,
      });

      return { success: true, message: msg, openedSymbol: topCandidate.symbol };
    }

    // All slots full and all trades in strong standing
    const msg = isAr
      ? '✅ جميع صفقاتك النشطة في حالة ربح وقوة استثنائية (احتمالية تعافي تفوق 65%)، ولا يوجد أي مركز يستدعي الاستبدال حالياً حفاظاً على استقرار المحفظة.'
      : 'All current positions have high health scores and profitability. No reallocation needed.';

    addToast({
      type: 'INFO',
      title: isAr ? '🛡️ المحفظة في أقصى كفاءة' : '🛡️ Portfolio At Peak Standing',
      message: msg,
    });

    return { success: false, message: msg };
  };

  const clearTradeHistory = () => {
    setClosedTrades([]);
    localStorage.removeItem('apex_closed_trades');
  };

  const cleanAllCacheAndReset = async () => {
    try {
      localStorage.removeItem('apex_bot_settings');
      localStorage.removeItem('apex_active_positions');
      localStorage.removeItem('apex_closed_trades');
      localStorage.removeItem('apex_paper_balance');
      localStorage.removeItem('bavly_wallet_profiles');
      localStorage.removeItem('bavly_active_wallet_id');
      localStorage.removeItem('apex_bot_running');
      localStorage.removeItem('bavly_capital_profile');
      localStorage.removeItem('apex_telegram_settings');

      setPositions([]);
      setClosedTrades([]);
      setPaperBalance(1000.0);
      setSettings(DEFAULT_SETTINGS);
      setBotRunningState(false);

      try {
        await fetch('/api/worker/stop', { method: 'POST' });
        await botSessionService.stopSession();
        await EncryptedStorageService.clearCredentials();
      } catch {
        // ignore
      }

      const isAr = languageRef.current === 'ar';
      addToast({
        type: 'INFO',
        title: isAr ? '🧹 تم تنظيف الكاش والتخزين وإعادة الضبط الشامل' : '🧹 Full Cache Clean & Reset Complete',
        message: isAr
          ? 'تم تفريغ كافة التخزين المؤقت وسجل الصفقات والخزنة المشفرة وإعادة الرصيد الافتراضي إلى $1,000 بحالة نظيفة ونقية.'
          : 'Local cache, encrypted vault, positions, and trades wiped cleanly. Paper balance reset to $1,000.',
      });
    } catch (e) {
      console.error('Error cleaning cache:', e);
    }
  };

  // Reconnection helper
  const reconnectWs = () => {
    binanceWs.disconnect();
    binanceWs.connect(credentialsRef.current.isTestnet);
  };

  // Initial Boot Sequence
  useEffect(() => {
    refreshMarketData();

    // 1. Immediately hydrate from AES-GCM Encrypted Client Storage Vault (persists across page reloads & refreshes)
    EncryptedStorageService.loadCredentials().then((vaultCreds) => {
      if (vaultCreds?.apiKey && vaultCreds?.apiSecret) {
        if (!credentialsRef.current.apiKey || !credentialsRef.current.apiSecret) {
          const clientHydrated: BinanceCredentials = {
            ...credentialsRef.current,
            apiKey: vaultCreds.apiKey,
            apiSecret: vaultCreds.apiSecret,
            isTestnet: vaultCreds.isTestnet,
            walletName: vaultCreds.walletName || credentialsRef.current.walletName,
            isValidated: true,
          };
          setCredentials(clientHydrated);
          credentialsRef.current = clientHydrated;
          validateCredentials(clientHydrated).catch((err) => {
            console.warn('[TradingContext] Auto-auth probe from encrypted vault:', err);
          });
        }
      }
    });

    // 2. Sync credentials from server disk (fallback / multi-origin sync)
    BinanceService.fetchAllStoredCredentials().then((res) => {
      if (!res || !res.success) return;
      const isTestnetActive = credentialsRef.current.isTestnet;
      const activeCreds = isTestnetActive ? res.testnet : res.live;

      // Hydrate all wallet profiles from server disk if local storage was wiped
      setWallets((prev) => {
        let modified = false;
        const updated = prev.map((w) => {
          const serverData = w.isTestnet ? res.testnet : res.live;
          if (serverData?.apiKey && serverData?.apiSecret && (!w.apiKey || !w.apiSecret)) {
            modified = true;
            return {
              ...w,
              apiKey: serverData.apiKey,
              apiSecret: serverData.apiSecret,
              isValidated: true,
            };
          }
          return w;
        });
        if (modified) {
          localStorage.setItem('bavly_wallet_profiles', JSON.stringify(updated));
        }
        return modified ? updated : prev;
      });

      // If active wallet is missing keys, hydrate active credentials from server disk & mirror into encrypted vault
      if (activeCreds?.apiKey && activeCreds?.apiSecret) {
        if (!credentialsRef.current.apiKey || !credentialsRef.current.apiSecret) {
          const hydrated: BinanceCredentials = {
            ...credentialsRef.current,
            apiKey: activeCreds.apiKey,
            apiSecret: activeCreds.apiSecret,
            isValidated: true,
            isServerConfigured: true,
          };
          setCredentials(hydrated);
          credentialsRef.current = hydrated;

          // Mirror into Encrypted Client-Side Storage Vault
          EncryptedStorageService.saveCredentials({
            apiKey: activeCreds.apiKey,
            apiSecret: activeCreds.apiSecret,
            isTestnet: isTestnetActive,
            walletName: hydrated.walletName,
          }).catch((err) => console.warn('[TradingContext] Error mirroring server keys to client vault:', err));

          validateCredentials(hydrated).catch((err) => {
            console.warn('Initial account probe after server hydration:', err);
          });
        }
      }
    });

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
              const priceDiff =
                pos.side === 'LONG'
                  ? (currentMark - pos.entryPrice)
                  : (pos.entryPrice - currentMark);
              const dollarPnl = priceDiff * pos.quantity;
              const safeMargin = Math.max(0.01, pos.amountUsd);
              const pnlPct = (dollarPnl / safeMargin) * 100;
              const high = Math.max(pos.highestPriceReached || currentMark, currentMark);
              const low = Math.min(pos.lowestPriceReached || currentMark, currentMark);

              return {
                ...pos,
                markPrice: currentMark,
                unrealizedProfit: Number(dollarPnl.toFixed(4)),
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
    const pollInterval = setInterval(() => {
      refreshMarketData();
    }, 2500);

    return () => {
      clearInterval(pollInterval);
      binanceWs.disconnect();
    };
  }, []);

  // Autonomous Bot Scanning & Position Monitoring Loop
  useEffect(() => {
    let tickCount = 0;
    const interval = setInterval(async () => {
      // Periodic live balance & positions sync from Binance every 6 seconds (tick runs every 3s)
      if (tickCount % 2 === 0 && (credentialsRef.current.isValidated || Boolean(credentialsRef.current.apiKey && credentialsRef.current.apiSecret))) {
        refreshAccountData();
      }

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

          // Target Profit Harvest ("أنتش واجري"):
          // Strictly wait until position reaches user configured target (e.g. 35% or settings.scalpingProfitLockPercent).
          // NEVER close prematurely at 5%, 10% or a few cents!
          const targetProfitThreshold = settingsRef.current.scalpingProfitLockPercent || 35;
          const hitTargetRoi = pos.pnlPercentage >= targetProfitThreshold;

          if (hitTargetRoi) {
            toClose.push({ id: pos.id, reason: 'AI_EARLY_PROFIT_TAKE' });
            continue;
          }

          // Scalping Mode & Max Duration check
          // RULE: In Fast Scalping mode, only harvest if trade reached at least 25% ROI (or the user target).
          // If slightly in profit (+2%, +5%, +10%) or pennies (e.g. 2 cents), DO NOT close prematurely! Let it run!
          // If scalpingDurationMinutes === 0 (or unlimitedHoldTime), duration is unlimited (no timer exit).
          const isUnlimitedHold = settingsRef.current.scalpingMode
            ? (settingsRef.current.scalpingDurationMinutes === 0)
            : Boolean(settingsRef.current.unlimitedHoldTime);

          const effectiveDurationLimitMs = isUnlimitedHold
            ? 0
            : settingsRef.current.scalpingMode
            ? (settingsRef.current.scalpingDurationMinutes || 15) * 60 * 1000
            : pos.maxDurationMs;

          if (effectiveDurationLimitMs > 0 && Date.now() - pos.openedAt >= effectiveDurationLimitMs) {
            if (settingsRef.current.scalpingMode) {
              if (pos.pnlPercentage >= Math.min(25.0, targetProfitThreshold)) {
                toClose.push({ id: pos.id, reason: 'AI_EARLY_PROFIT_TAKE' });
                continue;
              }
              // Trade is slightly positive (+5%, +10%) or negative: DO NOT close on time timer. Keep running towards target!
            } else {
              toClose.push({ id: pos.id, reason: 'TIME_EXPIRED' });
              continue;
            }
          }

          // AI Trade Doctor Analysis & Autonomous Dynamic Actions
          const pair = marketPairsRef.current.find((p) => p.symbol === pos.symbol);
          const diagnosis = AIPositionManager.diagnosePosition(
            pos,
            pair,
            undefined,
            isAr ? 'ar' : 'en',
            targetProfitThreshold
          );
          pos.aiDiagnosis = diagnosis;

          // AI Action 1: Smart Early Cut Loss (إغلاق وقائي مبكر قبل ضرب الوقف الكامل)
          if (diagnosis.recommendation === 'AI_EARLY_CUT') {
            toClose.push({ id: pos.id, reason: 'AI_EARLY_CUT' });
            continue;
          }

          // AI Action 2: Safe Breakeven Exit ($0 خسارة بعد ارتداد السعر للدخول وضعف الزخم)
          if (diagnosis.recommendation === 'AI_BREAKEVEN_EXIT') {
            toClose.push({ id: pos.id, reason: 'AI_BREAKEVEN_EXIT' });
            continue;
          }

          // AI Action 3: Early Profit Lock (حجز الأرباح المتاحة قبل ارتداد السعر)
          if (diagnosis.recommendation === 'AI_EARLY_PROFIT_TAKE') {
            toClose.push({ id: pos.id, reason: 'AI_EARLY_PROFIT_TAKE' });
            continue;
          }

          // AI Action 4: Smart DCA Reinforcement (تعزيز وتبريد المركز لتقريب متوسط الدخول)
          if (diagnosis.recommendation === 'AI_DCA_REINFORCE' && (pos.dcaCount || 0) === 0) {
            pos.dcaCount = 1;
            const addMarginUsd = Number((pos.amountUsd * 0.5).toFixed(2));
            const addQty = Number(((addMarginUsd * pos.leverage) / currentMark).toFixed(4));
            if (addQty > 0) {
              const prevNotional = pos.entryPrice * pos.quantity;
              const newNotional = currentMark * addQty;
              const newTotalQty = pos.quantity + addQty;
              const newAvgEntry = (prevNotional + newNotional) / newTotalQty;

              pos.entryPrice = Number(newAvgEntry.toFixed(4));
              pos.quantity = Number(newTotalQty.toFixed(4));
              pos.amountUsd = Number((pos.amountUsd + addMarginUsd).toFixed(2));
              pos.notionalValue = Number((pos.quantity * currentMark).toFixed(2));

              if (tradingModeRef.current === 'real' && credentialsRef.current.isValidated) {
                BinanceService.placeOrder(
                  credentialsRef.current,
                  pos.symbol,
                  isLong ? 'BUY' : 'SELL',
                  addQty
                ).catch((e) => console.warn('DCA execution error:', e));
              }

              addToast({
                type: 'INFO',
                title: isAr ? '⚡ تعزيز ذكي بالذكاء الاصطناعي (DCA)' : '⚡ AI Smart DCA Reinforcement',
                message: isAr
                  ? `تم تعزيز مركز ${pos.symbol} بنجاح وخفض متوسط سعر الدخول إلى $${pos.entryPrice.toFixed(2)} لتقريب نقطة الخروج بربح.`
                  : `Reinforced ${pos.symbol}. Lowered average entry to $${pos.entryPrice.toFixed(2)}.`,
                symbol: pos.symbol,
              });
            }
          }
        }

        for (const item of toClose) {
          await closePosition(item.id, item.reason);
        }
      }

      // Autonomous Candidate Scanning:
      // Strictly paused and halted if the 24/7 bot is STOPPED by the user!
      if (!botRunningRef.current) {
        return;
      }

      const now = Date.now();

      // Intelligent Pacing 1: Initial market reconnaissance warm-up window (15 seconds after starting)
      // Allows price feeds, orderbooks, and multi-timeframe indicators to stabilize before opening any trade
      if (now - botStartedAtRef.current < 15000) {
        return;
      }

      // Intelligent Pacing 2: Execution spacing cooldown (at least 45 seconds between automated trade entries)
      // Completely stops the bot from opening 3 or 4 trades simultaneously in seconds
      if (now - lastTradeOpenedAtRef.current < 45000) {
        return;
      }

      if (
        settingsRef.current.autoTradingEnabled &&
        positionsRef.current.length < settingsRef.current.maxConcurrentPositions &&
        marketPairsRef.current.length > 0 &&
        !settingsRef.current.killSwitchActive
      ) {
        const activeSymbols = new Set(positionsRef.current.map((p) => p.symbol));

        // Evaluate ALL candidate symbols across the market to rank them by 100-point rubric
        const candidates: Array<{
          pair: FuturesSymbolInfo;
          evalRes: ReturnType<typeof strategyEngine.evaluateCandidate>;
          score: number;
        }> = [];

        for (const pair of marketPairsRef.current) {
          // Do not open duplicate positions for the same symbol
          if (activeSymbols.has(pair.symbol)) continue;

          // Prevent immediately churning a pair closed within the last 3 minutes
          const lastTraded = lastTradedSymbolsRef.current.get(pair.symbol) || 0;
          if (now - lastTraded < 180000) continue;

          // Skip high-spread noise pairs
          if (pair.spreadPercent && pair.spreadPercent > settingsRef.current.maxSpreadPercent) continue;

          const evalRes = strategyEngine.evaluateCandidate(
            pair,
            [],
            positionsRef.current,
            undefined,
            languageRef.current
          );

          // STRICT GRADE A INTELLIGENCE FILTER:
          // 1. Must qualify with an explicit BUY_LONG or SELL_SHORT setup
          // 2. High confidence (>= settings minAiConfidence, default 70-75%)
          // 3. Trade quality tier must be EXCELLENT (85-100) or GOOD (70-84)
          // 4. Strong risk-to-reward ratio (>= 1.4)
          const qualityScore = evalRes.qualityBreakdown?.totalScore || evalRes.confidence || 0;
          const userMinConf = settingsRef.current.minAiConfidence || 70;
          const isHighGrade =
            qualityScore >= Math.min(userMinConf, 72) &&
            (evalRes.qualityBreakdown?.tier === 'EXCELLENT' || evalRes.qualityBreakdown?.tier === 'GOOD');

          if (
            evalRes.qualified &&
            evalRes.signal !== 'NO_TRADE' &&
            evalRes.confidence >= userMinConf &&
            isHighGrade &&
            evalRes.riskRewardRatio >= 1.4
          ) {
            candidates.push({ pair, evalRes, score: qualityScore });
          }
        }

        // Sort candidates so the single #1 highest-score Grade A setup is selected first!
        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length > 0) {
          const now = Date.now();
          // If previous candidate order attempt failed (e.g. margin limit reached), back off for 30s before trying again
          if (now - lastCandidateAttemptRef.current >= 30000) {
            const topCandidate = candidates[0];
            const side: TradeDirection = topCandidate.evalRes.signal === 'BUY_LONG' ? 'LONG' : 'SHORT';
            lastCandidateAttemptRef.current = now;
            const success = await openPosition(topCandidate.pair.symbol, side, topCandidate.evalRes.rationale);
            if (success) {
              lastTradeOpenedAtRef.current = Date.now();
              lastTradedSymbolsRef.current.set(topCandidate.pair.symbol, Date.now());
            }
          }
        }
      }
    }, 3000);

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
        runAIDoctorDiagnosis,
        executeMaxPrioritySwap,
        refreshMarketData,
        refreshAccountData,
        runReconciliation,
        clearTradeHistory,
        cleanAllCacheAndReset,
        traderSkillAuditTrail,
        traderSkillModules,
        refreshTraderSkillAudit,
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
