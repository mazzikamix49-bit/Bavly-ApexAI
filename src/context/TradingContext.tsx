import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  AccountBalance,
  AILearningState,
  BinanceCredentials,
  BotSettings,
  ClosedTrade,
  FuturesSymbolInfo,
  Position,
  TelegramSettings,
  ToastAlert,
  TradeDirection,
  TradingMode,
  WalletProfile,
} from '../types/trading';
import { BinanceService } from '../services/binanceService';
import { aiEngine } from '../services/aiLearningEngine';
import { TelegramService } from '../services/telegramService';
import { Language, translations } from '../utils/translations';

interface TradingContextType {
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
  telegramSettings: TelegramSettings;
  updateTelegramSettings: (settings: Partial<TelegramSettings>) => void;
  balance: AccountBalance;
  positions: Position[];
  closedTrades: ClosedTrade[];
  marketPairs: FuturesSymbolInfo[];
  isLoadingMarket: boolean;
  aiState: AILearningState;
  
  // Dashboard Metrics
  totalTradesCount: number;
  winningTradesCount: number;
  losingTradesCount: number;
  winRatePercent: number;
  totalProfitUsd: number;
  totalLossUsd: number;
  netProfitUsd: number;

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
  clearTradeHistory: () => void;
}

const DEFAULT_SETTINGS: BotSettings = {
  maxConcurrentPositions: 4,
  positionSizeUsd: 15,
  leverage: 20,
  allowedDirection: 'BOTH',
  maxTradeDurationHours: 4,
  takeProfitPercent: 3.5,
  stopLossPercent: 1.8,
  trailingStopPercent: 0.8,
  useTrailingStop: true,
  maxDailyDrawdownPercent: 5.0,
  marginType: 'ISOLATED',
  minAiConfidence: 85,
  autoTradingEnabled: true,
  scanIntervalSeconds: 10,
  aiDynamicTargets: true,
  multiTargetTrailing: true,
  unlimitedHoldTime: true,
  enableToastAlerts: true,
  enableCapitalLimit: true,
  maxAllocatedCapitalUsd: 5.0,
};

const DEFAULT_CREDENTIALS: BinanceCredentials = {
  apiKey: '',
  apiSecret: '',
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

  // 2. Trading Mode ('paper' or 'real')
  const [tradingMode, setTradingModeState] = useState<TradingMode>(() => {
    return (localStorage.getItem('apex_trading_mode') as TradingMode) || 'paper';
  });

  const setTradingMode = (mode: TradingMode) => {
    setTradingModeState(mode);
    localStorage.setItem('apex_trading_mode', mode);
  };

  // 3. Bot Status (Running 24/7 or Paused)
  const [botRunning, setBotRunningState] = useState<boolean>(() => {
    const saved = localStorage.getItem('apex_bot_running');
    return saved !== null ? saved === 'true' : true; // Default running 24/7
  });

  const setBotRunning = (running: boolean) => {
    setBotRunningState(running);
    localStorage.setItem('apex_bot_running', running.toString());
  };

  const toggleBot = () => setBotRunning(!botRunning);

  // 4. Multi-Wallet Profiles & Binance Credentials
  const [wallets, setWallets] = useState<WalletProfile[]>(() => {
    try {
      const saved = localStorage.getItem('bavly_wallet_profiles');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      const legacyCreds = localStorage.getItem('apex_binance_creds');
      if (legacyCreds) {
        const parsed = JSON.parse(legacyCreds);
        return [
          {
            id: 'wallet-default',
            name: parsed.walletName || 'محفظة بافلي بينانس (Bavly Futures)',
            apiKey: parsed.apiKey || '',
            apiSecret: parsed.apiSecret || '',
            isTestnet: !!parsed.isTestnet,
            isValidated: !!parsed.isValidated,
            createdAt: Date.now(),
          },
        ];
      }
    } catch (e) {
      console.error('Error loading wallet profiles:', e);
    }
    return [
      {
        id: 'wallet-default',
        name: 'محفظة بافلي بينانس (Bavly Futures)',
        apiKey: '',
        apiSecret: '',
        isTestnet: false,
        isValidated: false,
        createdAt: Date.now(),
      },
    ];
  });

  const [activeWalletId, setActiveWalletId] = useState<string>(() => {
    return localStorage.getItem('bavly_active_wallet_id') || 'wallet-default';
  });

  const activeWallet = wallets.find((w) => w.id === activeWalletId) || wallets[0] || {
    id: 'wallet-default',
    name: 'محفظة بافلي بينانس (Bavly Futures)',
    apiKey: '',
    apiSecret: '',
    isTestnet: false,
    isValidated: false,
    createdAt: Date.now(),
  };

  const [credentials, setCredentials] = useState<BinanceCredentials>(() => ({
    id: activeWallet.id,
    walletName: activeWallet.name,
    apiKey: activeWallet.apiKey,
    apiSecret: activeWallet.apiSecret,
    isTestnet: activeWallet.isTestnet,
    isValidated: activeWallet.isValidated,
  }));

  const [isValidatingApi, setIsValidatingApi] = useState(false);
  const [apiStatus, setApiStatus] = useState<'disconnected' | 'connected' | 'error'>(() => {
    return activeWallet.isValidated ? 'connected' : 'disconnected';
  });
  const [apiErrorMessage, setApiErrorMessage] = useState('');

  const updateCredentials = (creds: Partial<BinanceCredentials>) => {
    setCredentials((prev) => {
      const updated = { ...prev, ...creds, isValidated: false };
      return updated;
    });
    setWallets((prev) => {
      const updated = prev.map((w) =>
        w.id === activeWalletId
          ? {
              ...w,
              apiKey: creds.apiKey !== undefined ? creds.apiKey : w.apiKey,
              apiSecret: creds.apiSecret !== undefined ? creds.apiSecret : w.apiSecret,
              isTestnet: creds.isTestnet !== undefined ? creds.isTestnet : w.isTestnet,
              name: creds.walletName !== undefined ? creds.walletName : w.name,
              isValidated: false,
            }
          : w
      );
      localStorage.setItem('bavly_wallet_profiles', JSON.stringify(updated));
      return updated;
    });
    setApiStatus('disconnected');
  };

  const setCustomWalletName = (name: string) => {
    const trimmed = name.trim() || 'محفظة بافلي بينانس (Bavly Futures)';
    setWallets((prev) => {
      const updated = prev.map((w) => (w.id === activeWalletId ? { ...w, name: trimmed } : w));
      localStorage.setItem('bavly_wallet_profiles', JSON.stringify(updated));
      return updated;
    });
    setCredentials((prev) => ({ ...prev, walletName: trimmed }));
  };

  const switchWallet = async (walletId: string) => {
    const target = wallets.find((w) => w.id === walletId);
    if (!target) return;
    setActiveWalletId(walletId);
    localStorage.setItem('bavly_active_wallet_id', walletId);
    setCredentials({
      id: target.id,
      walletName: target.name,
      apiKey: target.apiKey,
      apiSecret: target.apiSecret,
      isTestnet: target.isTestnet,
      isValidated: target.isValidated,
    });
    setApiStatus(target.isValidated ? 'connected' : 'disconnected');
    if (target.isValidated && target.apiKey && target.apiSecret) {
      try {
        const res = await BinanceService.fetchAccount({
          apiKey: target.apiKey,
          apiSecret: target.apiSecret,
          isTestnet: target.isTestnet,
          isValidated: true,
        });
        if (res.success && res.balance) {
          setRealBalance(res.balance);
        }
      } catch (e) {
        console.error('Failed to fetch new wallet balance:', e);
      }
    }
  };

  const saveWalletProfile = (profile: Omit<WalletProfile, 'id' | 'createdAt'> & { id?: string }) => {
    setWallets((prev) => {
      let updated: WalletProfile[];
      if (profile.id) {
        updated = prev.map((w) => (w.id === profile.id ? { ...w, ...profile } : w));
      } else {
        const newWallet: WalletProfile = {
          id: `wallet-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name: profile.name || `محفظة بينانس ${prev.length + 1}`,
          apiKey: profile.apiKey,
          apiSecret: profile.apiSecret,
          isTestnet: !!profile.isTestnet,
          isValidated: !!profile.isValidated,
          createdAt: Date.now(),
        };
        updated = [...prev, newWallet];
      }
      localStorage.setItem('bavly_wallet_profiles', JSON.stringify(updated));
      return updated;
    });
  };

  const deleteWalletProfile = (walletId: string) => {
    if (wallets.length <= 1) return;
    setWallets((prev) => {
      const updated = prev.filter((w) => w.id !== walletId);
      localStorage.setItem('bavly_wallet_profiles', JSON.stringify(updated));
      return updated;
    });
    if (activeWalletId === walletId) {
      const remaining = wallets.filter((w) => w.id !== walletId);
      if (remaining.length > 0) {
        switchWallet(remaining[0].id);
      }
    }
  };

  // 5. Bot Settings
  const [settings, setSettings] = useState<BotSettings>(() => {
    try {
      const saved = localStorage.getItem('apex_bot_settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
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

  // 7. Virtual & Real Balances
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
  });

  // 8. Open Positions & Closed Trades
  const [positions, setPositions] = useState<Position[]>(() => {
    try {
      const saved = localStorage.getItem('apex_active_positions');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const seen = new Set<string>();
          return parsed.map((item: Position, idx: number) => {
            if (!item.id || seen.has(item.id)) {
              const uniqueId = `pos-${item.openedAt || Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`;
              seen.add(uniqueId);
              return { ...item, id: uniqueId };
            }
            seen.add(item.id);
            return item;
          });
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>(() => {
    try {
      const saved = localStorage.getItem('apex_closed_trades');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Deduplicate IDs so two trades never share the exact same ID key
          const seen = new Set<string>();
          return parsed.map((item: ClosedTrade, idx: number) => {
            if (!item.id || seen.has(item.id)) {
              const uniqueId = `trade-${item.closedAt || Date.now()}-${idx}-${Math.random().toString(36).substring(2, 8)}`;
              seen.add(uniqueId);
              return { ...item, id: uniqueId };
            }
            seen.add(item.id);
            return item;
          });
        }
      }
    } catch {}
    // Initial starter demo trades for rich visualization
    return [
      {
        id: 'trade-init-1',
        symbol: 'SOLUSDT',
        side: 'LONG',
        entryPrice: 148.2,
        exitPrice: 152.1,
        quantity: 1.35,
        amountUsd: 200,
        leverage: 20,
        pnl: 10.52,
        pnlPercentage: 5.26,
        openedAt: Date.now() - 1000 * 60 * 95,
        closedAt: Date.now() - 1000 * 60 * 42,
        durationMs: 1000 * 60 * 53,
        exitReason: 'TAKE_PROFIT',
        aiConfidence: 91,
        wasWinning: true,
      },
      {
        id: 'trade-init-2',
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryPrice: 63800,
        exitPrice: 64250,
        quantity: 0.003,
        amountUsd: 191.4,
        leverage: 25,
        pnl: 3.48,
        pnlPercentage: 1.76,
        openedAt: Date.now() - 1000 * 60 * 180,
        closedAt: Date.now() - 1000 * 60 * 110,
        durationMs: 1000 * 60 * 70,
        exitReason: 'TAKE_PROFIT',
        aiConfidence: 89,
        wasWinning: true,
      },
      {
        id: 'trade-init-3',
        symbol: 'ETHUSDT',
        side: 'SHORT',
        entryPrice: 2650,
        exitPrice: 2665,
        quantity: 0.075,
        amountUsd: 198.7,
        leverage: 20,
        pnl: -2.25,
        pnlPercentage: -1.13,
        openedAt: Date.now() - 1000 * 60 * 320,
        closedAt: Date.now() - 1000 * 60 * 290,
        durationMs: 1000 * 60 * 30,
        exitReason: 'STOP_LOSS',
        aiConfidence: 84,
        wasWinning: false,
      },
    ];
  });

  // 9. Market Tickers
  const [marketPairs, setMarketPairs] = useState<FuturesSymbolInfo[]>([]);
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);

  // 10. AI Learning State
  const [aiState, setAiState] = useState<AILearningState>(() => aiEngine.getState());

  // 11. Real-time Toast Notifications
  const [toasts, setToasts] = useState<ToastAlert[]>([]);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const clearAllToasts = () => {
    setToasts([]);
  };

  const addToast = (toast: Omit<ToastAlert, 'id' | 'timestamp'>) => {
    // Respect user's setting to mute popup notifications
    if (settingsRef.current && settingsRef.current.enableToastAlerts === false) {
      return;
    }
    const newToast: ToastAlert = {
      ...toast,
      id: `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };
    // Keep max 2 toasts at a time so it never covers the UI
    setToasts((prev) => [newToast, ...prev.slice(0, 1)]);
    setTimeout(() => {
      dismissToast(newToast.id);
    }, 4200);
  };

  // Reset/Clear Trade History & Performance
  const clearTradeHistory = () => {
    setClosedTrades([]);
    localStorage.removeItem('apex_closed_trades');
    setPaperBalance(1000.0);
    localStorage.setItem('apex_paper_balance', '1000.0');
    setToasts([]);
    const freshAiState = aiEngine.resetToDefault();
    setAiState(freshAiState);

    const isAr = languageRef.current === 'ar';
    addToast({
      type: 'CLOSE_WIN',
      title: isAr ? '🧹 تم تصفير سجل الصفقات وإعادة تهيئة البيانات!' : '🧹 Trade History & Data Reset Complete!',
      message: isAr
        ? 'تم مسح كافة الصفقات السابقة وإعادة تعيين الرصيد التجريبي إلى $1,000.00 وتحديث نموذج الذكاء الاصطناعي بنجاح.'
        : 'All historical trades wiped. Paper trading balance reset to $1,000.00 and AI models recalibrated.',
      pnl: 0,
    });
  };

  // Ref to always access latest state inside intervals
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const botRunningRef = useRef(botRunning);
  botRunningRef.current = botRunning;
  const marketPairsRef = useRef(marketPairs);
  marketPairsRef.current = marketPairs;
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;
  const tradingModeRef = useRef(tradingMode);
  tradingModeRef.current = tradingMode;
  const telegramSettingsRef = useRef(telegramSettings);
  telegramSettingsRef.current = telegramSettings;
  const languageRef = useRef(language);
  languageRef.current = language;

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

  // Derived Performance Metrics
  const totalTradesCount = closedTrades.length;
  const winningTradesCount = closedTrades.filter((t) => t.wasWinning).length;
  const losingTradesCount = closedTrades.filter((t) => !t.wasWinning).length;
  const winRatePercent = totalTradesCount > 0 ? Number(((winningTradesCount / totalTradesCount) * 100).toFixed(1)) : 0;
  const totalProfitUsd = Number(
    closedTrades.filter((t) => t.pnl > 0).reduce((acc, t) => acc + t.pnl, 0).toFixed(2)
  );
  const totalLossUsd = Number(
    Math.abs(closedTrades.filter((t) => t.pnl < 0).reduce((acc, t) => acc + t.pnl, 0)).toFixed(2)
  );
  const netProfitUsd = Number((totalProfitUsd - totalLossUsd).toFixed(2));

  // Current balance object based on active mode
  const currentTotalUnrealized = positions.reduce((acc, p) => acc + p.unrealizedProfit, 0);
  const currentInitialMargin = positions.reduce((acc, p) => acc + p.amountUsd, 0);

  const balance: AccountBalance =
    tradingMode === 'real' && credentials.isValidated
      ? realBalance
      : {
          totalWalletBalance: Number((paperBalance + netProfitUsd).toFixed(2)),
          availableBalance: Number(Math.max(0, paperBalance + netProfitUsd - currentInitialMargin).toFixed(2)),
          totalUnrealizedProfit: Number(currentTotalUnrealized.toFixed(2)),
          totalMarginBalance: Number((paperBalance + netProfitUsd + currentTotalUnrealized).toFixed(2)),
          totalInitialMargin: Number(currentInitialMargin.toFixed(2)),
        };

  // Validate Binance Credentials
  const validateCredentials = async (overrideCreds?: BinanceCredentials): Promise<boolean> => {
    const credsToTest = overrideCreds || credentials;
    if (!credsToTest.apiKey || !credsToTest.apiSecret) {
      setApiStatus('disconnected');
      setApiErrorMessage(language === 'ar' ? 'يرجى إدخال مفتاح الـ API والرمز السري أولاً.' : 'Please enter API Key and Secret Key.');
      return false;
    }

    setIsValidatingApi(true);
    setApiErrorMessage('');

    try {
      const res = await BinanceService.fetchAccount(credsToTest);
      if (res.success && res.balance) {
        setRealBalance(res.balance);
        setApiStatus('connected');
        setCredentials((prev) => {
          const updated = { ...prev, ...credsToTest, isValidated: true };
          localStorage.setItem('apex_binance_creds', JSON.stringify(updated));
          return updated;
        });
        setWallets((prevWallets) => {
          const updated = prevWallets.map((w) =>
            w.id === activeWalletId
              ? {
                  ...w,
                  isValidated: true,
                  apiKey: credsToTest.apiKey,
                  apiSecret: credsToTest.apiSecret,
                  isTestnet: credsToTest.isTestnet,
                  name: credsToTest.walletName || w.name,
                }
              : w
          );
          localStorage.setItem('bavly_wallet_profiles', JSON.stringify(updated));
          return updated;
        });
        return true;
      } else {
        setApiStatus('error');
        const errMsg = res.error || 'Failed to authenticate with Binance Futures.';
        setApiErrorMessage(errMsg);
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

  // Fetch Live 24hr Binance Tickers
  const refreshMarketData = async () => {
    try {
      setIsLoadingMarket(true);
      const tickers = await BinanceService.fetch24hrTickers(credentialsRef.current.isTestnet);
      if (tickers.length > 0) {
        setMarketPairs(tickers);
      }
    } catch (err) {
      console.error('Error refreshing tickers:', err);
    } finally {
      setIsLoadingMarket(false);
    }
  };

  // Refresh Account
  const refreshAccountData = async () => {
    if (tradingModeRef.current === 'real' && credentialsRef.current.isValidated) {
      const res = await BinanceService.fetchAccount(credentialsRef.current);
      if (res.success && res.balance) {
        setRealBalance(res.balance);
      }
    }
  };

  // 1-Click Open Position (Manual or Autonomous)
  const openPosition = async (
    symbol: string,
    side: TradeDirection,
    rationale = 'AI High Probability Setup',
    customLeverage?: number,
    options?: {
      overrideLimits?: boolean;
      customAmountUsd?: number;
    }
  ): Promise<boolean> => {
    const currentPositions = positionsRef.current;
    const currentSettings = settingsRef.current;
    const isOverride = !!options?.overrideLimits;

    // Check max concurrent limit (Bypassed if manual execution / deep analysis override)
    if (!isOverride && currentPositions.length >= currentSettings.maxConcurrentPositions) {
      return false;
    }

    // Check direction constraints (Bypassed if manual execution / deep analysis override)
    if (!isOverride) {
      if (currentSettings.allowedDirection === 'LONG_ONLY' && side !== 'LONG') return false;
      if (currentSettings.allowedDirection === 'SHORT_ONLY' && side !== 'SHORT') return false;
    }

    // Check if pair is already open
    if (currentPositions.some((p) => p.symbol === symbol)) {
      const isAr = languageRef.current === 'ar';
      addToast({
        type: 'INFO',
        title: isAr ? 'الصفقة مفتوحة بالفعل' : 'Position Already Open',
        message: isAr
          ? `لديك صفقة نشطة بالفعل على زوج ${symbol}.`
          : `You already have an active open position for ${symbol}.`,
      });
      return false;
    }

    const lev = customLeverage || currentSettings.leverage;
    let amountUsd = options?.customAmountUsd || currentSettings.positionSizeUsd;

    // Check Allocated Capital Limit (Wallet Reserve Protection) - Bypassed if manual execution / deep analysis override
    if (!isOverride && currentSettings.enableCapitalLimit && (currentSettings.maxAllocatedCapitalUsd ?? 0) > 0) {
      const capLimit = currentSettings.maxAllocatedCapitalUsd!;
      const currentUsedMargin = currentPositions.reduce((acc, p) => acc + p.amountUsd, 0);
      const remainingBudget = Math.max(0, capLimit - currentUsedMargin);

      if (remainingBudget <= 0.25) {
        const isAr = languageRef.current === 'ar';
        addToast({
          type: 'INFO',
          title: isAr ? '🛡️ حماية رصيد المحفظة المحجوز' : '🛡️ Protected Wallet Limit Reached',
          message: isAr
            ? `تم منع فتح الصفقة (${symbol}) لعدم تجاوز سقف $${capLimit} المخصص للبوت. الرصيد المستخدم حالياً: $${currentUsedMargin.toFixed(2)}، وباقي رصيدك في بينانس آمن تماماً.`
            : `New trade on ${symbol} blocked to respect your $${capLimit} capital limit. Active margin used: $${currentUsedMargin.toFixed(2)}. Your reserved Binance balance is untouched.`,
        });
        return false;
      }

      // If requested position size exceeds remaining allocated budget, adapt to remaining budget
      if (amountUsd > remainingBudget) {
        amountUsd = Number(remainingBudget.toFixed(2));
      }
    }

    // Find symbol price from market pairs
    const pairInfo = marketPairsRef.current.find((p) => p.symbol === symbol);
    const entryPrice = pairInfo?.price || (symbol.startsWith('BTC') ? 64000 : 150);
    const notionalValue = amountUsd * lev;
    const qtyPrecision = pairInfo?.quantityPrecision !== undefined ? pairInfo.quantityPrecision : 3;
    let quantity = parseFloat((notionalValue / entryPrice).toFixed(qtyPrecision));

    // Ensure quantity meets Binance minQty
    const minQty = pairInfo?.minQty || 0.001;
    if (quantity < minQty) {
      quantity = minQty;
    }

    // Target Prices: AI Dynamic Analysis or Manual Config
    let takeProfitPrice: number;
    let stopLossPrice: number;
    let tp1Price: number;
    let tp2Price: number;
    let tp3Price: number;

    if (currentSettings.aiDynamicTargets) {
      const plan = aiEngine.calculateDynamicPlan(
        pairInfo,
        side,
        entryPrice,
        pairInfo?.pricePrecision || 2,
        languageRef.current
      );
      tp1Price = plan.tp1Price;
      tp2Price = plan.tp2Price;
      tp3Price = plan.tp3Price;
      takeProfitPrice = plan.tp3Price;
      stopLossPrice = plan.stopLossPrice;
      if (!rationale || rationale === 'AI High Probability Setup') {
        rationale = plan.rationale;
      }
    } else {
      const tpMultiplier = side === 'LONG' ? 1 + currentSettings.takeProfitPercent / 100 : 1 - currentSettings.takeProfitPercent / 100;
      const slMultiplier = side === 'LONG' ? 1 - currentSettings.stopLossPercent / 100 : 1 + currentSettings.stopLossPercent / 100;
      takeProfitPrice = Number((entryPrice * tpMultiplier).toFixed(pairInfo?.pricePrecision || 2));
      stopLossPrice = Number((entryPrice * slMultiplier).toFixed(pairInfo?.pricePrecision || 2));
      tp1Price = Number((entryPrice * (side === 'LONG' ? 1 + (currentSettings.takeProfitPercent * 0.35) / 100 : 1 - (currentSettings.takeProfitPercent * 0.35) / 100)).toFixed(pairInfo?.pricePrecision || 2));
      tp2Price = Number((entryPrice * (side === 'LONG' ? 1 + (currentSettings.takeProfitPercent * 0.65) / 100 : 1 - (currentSettings.takeProfitPercent * 0.65) / 100)).toFixed(pairInfo?.pricePrecision || 2));
      tp3Price = takeProfitPrice;
    }

    const liqMultiplier = side === 'LONG' ? 1 - 1 / lev * 0.9 : 1 + 1 / lev * 0.9;
    const liquidationPrice = Number((entryPrice * liqMultiplier).toFixed(pairInfo?.pricePrecision || 2));

    const newPosition: Position = {
      id: `pos-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      symbol,
      side,
      entryPrice,
      markPrice: entryPrice,
      quantity,
      amountUsd,
      leverage: lev,
      liquidationPrice,
      unrealizedProfit: 0,
      pnlPercentage: 0,
      stopLossPrice,
      takeProfitPrice,
      tp1Price,
      tp2Price,
      tp3Price,
      tpLevelReached: 0,
      initialStopLossPrice: stopLossPrice,
      securedProfitUsd: 0,
      highestPriceReached: entryPrice,
      lowestPriceReached: entryPrice,
      openedAt: Date.now(),
      maxDurationMs: currentSettings.maxTradeDurationHours * 3600 * 1000,
      aiConfidence: pairInfo?.aiScore || 88,
      rationale,
      isRealOrder: tradingModeRef.current === 'real',
    };

    // If Real Mode, execute real order on Binance Futures!
    if (tradingModeRef.current === 'real') {
      if (!credentialsRef.current.isValidated || !credentialsRef.current.apiKey) {
        const isAr = languageRef.current === 'ar';
        addToast({
          type: 'INFO',
          title: isAr ? '⚠️ وضع التداول الحقيقي يتطلب ربط بينانس' : '⚠️ Real Mode Requires Binance API',
          message: isAr
            ? 'أنت في وضع التداول الحقيقي ولكن لم تقم بربط وتأكيد مفاتيح Binance API بعد. يرجى إدخالها من الإعدادات.'
            : 'You are in Real Trading Mode, but Binance API credentials are not yet validated. Please configure them in Settings.',
        });
        return false;
      }

      try {
        await BinanceService.setLeverage(credentialsRef.current, symbol, lev);
        const orderRes = await BinanceService.placeOrder(
          credentialsRef.current,
          symbol,
          side === 'LONG' ? 'BUY' : 'SELL',
          quantity
        );
        if (!orderRes.success) {
          const isAr = languageRef.current === 'ar';
          addToast({
            type: 'CLOSE_LOSS',
            title: isAr ? '❌ فشل إرسال الأمر لمنصة بينانس' : '❌ Binance Order Rejected',
            message: isAr
              ? `رفضت باينانس أمر ${symbol}: ${orderRes.error || 'تأكد من تفعيل صلاحية تداول العقود الآجلة Futures في مفتاح API أو كفاية الرصيد'}`
              : `Binance rejected ${symbol} order: ${orderRes.error || 'Ensure Futures Trading permission is enabled on your API key.'}`,
          });
          return false;
        }
      } catch (err: any) {
        console.error('Real order execution failed:', err);
        const isAr = languageRef.current === 'ar';
        addToast({
          type: 'CLOSE_LOSS',
          title: isAr ? '❌ خطأ اتصال أثناء تنفيذ الأمر' : '❌ Network Error on Order Execution',
          message: isAr ? (err.message || 'تعذر الاتصال بباينانس') : (err.message || 'Failed connecting to Binance'),
        });
        return false;
      }
    }

    setPositions((prev) => [newPosition, ...prev]);

    // Send Real-Time Toast Notification
    const isAr = languageRef.current === 'ar';
    if (isOverride) {
      addToast({
        type: side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        title: isAr ? '⚡ تنفيذ مباشر استثنائي (تجاوز القيود)' : '⚡ Manual Priority Override Executed',
        message: isAr
          ? `تم تنفيذ صفقة ${symbol} فوراً بنجاح وتجاوز سقف الـ ${currentSettings.maxConcurrentPositions} صفقات وسقف رأس المال بطلبك المباشر!`
          : `Executed ${symbol} instantly, bypassing max open positions (${currentSettings.maxConcurrentPositions}) & capital constraints upon your direct manual command!`,
        symbol,
        side,
      });
    } else {
      addToast({
        type: side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        title: isAr
          ? `تم فتح صفقة ${side === 'LONG' ? 'شراء (LONG)' : 'بيع (SHORT)'}`
          : `New ${side} Position Executed`,
        message: isAr
          ? `${symbol} • رافعة ${lev}x • حجم $${amountUsd} بسعر $${entryPrice.toLocaleString()} (ذكاء اصطناعي ${newPosition.aiConfidence}%)`
          : `${symbol} • ${lev}x • $${amountUsd} @ $${entryPrice.toLocaleString()} (AI Confidence ${newPosition.aiConfidence}%)`,
        symbol,
        side,
      });
    }

    // Send Telegram Notification
    TelegramService.notifyPositionOpened(telegramSettingsRef.current, newPosition, languageRef.current === 'ar');

    return true;
  };

  // Close Position (Manual or Autonomous)
  const closePosition = async (positionId: string, reason: ClosedTrade['exitReason'] = 'MANUAL_CLOSE'): Promise<boolean> => {
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
          true // reduceOnly
        );
      } catch (err) {
        console.error('Failed to close real Binance order:', err);
      }
    }

    const closedTrade: ClosedTrade = {
      id: `trade-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      symbol: target.symbol,
      side: target.side,
      entryPrice: target.entryPrice,
      exitPrice: target.markPrice,
      quantity: target.quantity,
      amountUsd: target.amountUsd,
      leverage: target.leverage,
      pnl: target.unrealizedProfit,
      pnlPercentage: target.pnlPercentage,
      openedAt: target.openedAt,
      closedAt: Date.now(),
      durationMs: Date.now() - target.openedAt,
      exitReason: reason,
      aiConfidence: target.aiConfidence,
      wasWinning: target.unrealizedProfit > 0,
      tpLevelReached: target.tpLevelReached || 0,
      securedProfitUsd: target.securedProfitUsd || 0,
    };

    // Update positions & trade history
    setPositions((prev) => prev.filter((p) => p.id !== positionId));
    setClosedTrades((prev) => [closedTrade, ...prev]);

    // Send Real-Time Toast Notification
    const isArClose = languageRef.current === 'ar';
    const isWin = target.unrealizedProfit >= 0;
    let reasonText = '';
    if (reason === 'TAKE_PROFIT') reasonText = isArClose ? 'هدف الربح (TP)' : 'Take Profit';
    else if (reason === 'STOP_LOSS') reasonText = isArClose ? 'وقف الخسارة (SL)' : 'Stop Loss';
    else if (reason === 'TRAILING_STOP') reasonText = isArClose ? 'الوقف المتحرك' : 'Trailing Stop';
    else if (reason === 'TIME_EXPIRED') reasonText = isArClose ? 'انتهاء وقت الصفقة السريع' : 'Scalp Expiry';
    else reasonText = isArClose ? 'إغلاق يدوي' : 'Manual Close';

    addToast({
      type: isWin ? 'CLOSE_WIN' : 'CLOSE_LOSS',
      title: isWin
        ? (isArClose ? '🎯 تحقيق هدف الربح!' : '🎯 Target Hit! Position Closed')
        : (isArClose ? '🛡️ إغلاق وقائي لحماية الحساب' : '🛡️ Position Closed / Stop Loss'),
      message: isArClose
        ? `${target.symbol} (${target.side}) • سبب الإغلاق: ${reasonText}`
        : `${target.symbol} (${target.side}) • Exit: ${reasonText}`,
      symbol: target.symbol,
      side: target.side,
      pnl: target.unrealizedProfit,
      pnlPercentage: target.pnlPercentage,
    });

    // Feed trade result back into AI Self-Learning Engine (Continuous Learning 24/7!)
    const updatedAiState = aiEngine.recordTradeFeedback(closedTrade, languageRef.current);
    setAiState(updatedAiState);

    // Send Telegram Notification
    TelegramService.notifyPositionClosed(telegramSettingsRef.current, closedTrade, languageRef.current === 'ar');

    return true;
  };

  const closeAllPositions = async () => {
    const ids = positionsRef.current.map((p) => p.id);
    for (const id of ids) {
      await closePosition(id, 'MANUAL_CLOSE');
    }
  };

  // Initial load
  useEffect(() => {
    refreshMarketData();
    if (credentials.isValidated) {
      refreshAccountData();
    }
  }, []);

  // Continuous 24/7 Autonomous Bot Loop & Position Price Tracking
  useEffect(() => {
    const interval = setInterval(async () => {
      // 1. Refresh live ticker prices
      let currentTickers = marketPairsRef.current;
      try {
        const freshTickers = await BinanceService.fetch24hrTickers(credentialsRef.current.isTestnet);
        if (freshTickers.length > 0) {
          currentTickers = freshTickers;
          setMarketPairs(freshTickers);
        }
      } catch (e) {
        // use existing
      }

      // 2. Update mark prices and calculate PnL for active positions
      const currentPositions = positionsRef.current;
      if (currentPositions.length > 0) {
        const now = Date.now();
        const updated = currentPositions.map((pos) => {
          const match = currentTickers.find((t) => t.symbol === pos.symbol);
          const currentMark = match ? match.price : pos.markPrice;

          const priceDiff =
            pos.side === 'LONG'
              ? (currentMark - pos.entryPrice) / pos.entryPrice
              : (pos.entryPrice - currentMark) / pos.entryPrice;

          const pnlPct = priceDiff * 100 * pos.leverage;
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
        });

        // 3. Autonomous Check for Multi-Target Trailing SL, Take-Profit, and Stop-Loss
        const toClose: Array<{ id: string; reason: ClosedTrade['exitReason'] }> = [];
        const isAr = languageRef.current === 'ar';

        for (const pos of updated) {
          const isLong = pos.side === 'LONG';
          const currentMark = pos.markPrice;

          // Smart Trailing Exit System (TP1 -> Breakeven, TP2 -> TP1 level, TP3 -> TP2 level)
          if (settingsRef.current.multiTargetTrailing && pos.tp1Price && pos.tp2Price) {
            // Target 1 Hit: Move Stop-Loss to Entry Price (Breakeven) - Risk-free position!
            if ((pos.tpLevelReached || 0) === 0) {
              const hitTp1 = isLong ? currentMark >= pos.tp1Price : currentMark <= pos.tp1Price;
              if (hitTp1) {
                pos.tpLevelReached = 1;
                // Move Stop Loss to Entry Price (Breakeven)
                pos.stopLossPrice = pos.entryPrice;
                pos.securedProfitUsd = 0;

                addToast({
                  type: 'CLOSE_WIN',
                  title: isAr ? '🎯 تحقيق الهدف الأول (TP1) - نقل الوقف للدخول!' : '🎯 Target 1 Hit - SL to Breakeven!',
                  message: isAr
                    ? `${pos.symbol}: تم تحقيق الهدف الأول ($${pos.tp1Price}). تم نقل وقف الخسارة تلقائياً إلى نقطة الدخول ($${pos.entryPrice}) لتأمين رأس المال (Breakeven). بانتظار الهدف الثاني (TP2: $${pos.tp2Price})...`
                    : `${pos.symbol}: Target 1 reached ($${pos.tp1Price}). Stop-loss moved to entry ($${pos.entryPrice}) for guaranteed breakeven. Monitoring Target 2 ($${pos.tp2Price})...`,
                  symbol: pos.symbol,
                  side: pos.side,
                  pnl: 0,
                });

                TelegramService.sendMessage(
                  telegramSettingsRef.current.botToken,
                  telegramSettingsRef.current.chatId,
                  isAr
                    ? `🎯 <b>تحقيق الهدف الأول (TP1) - ${pos.symbol}</b>\n\n• السعر الحالي: $${currentMark}\n• تم نقل وقف الخسارة آلياً إلى نقطة الدخول $${pos.entryPrice} (صفقة خالية من المخاطر Breakeven).\n• جاري متابعة الهدف الثاني (TP2: $${pos.tp2Price}) 🚀`
                    : `🎯 <b>Target 1 Hit (TP1) - ${pos.symbol}</b>\n\n• Current: $${currentMark}\n• Stop-Loss shifted to Entry ($${pos.entryPrice}) for zero risk.\n• Monitoring Target 2 ($${pos.tp2Price}) 🚀`
                );
              }
            }

            // Target 2 Hit: Dynamically trail Stop-Loss to previous target level (TP1) - Lock in profit!
            if (pos.tpLevelReached === 1 && pos.tp2Price) {
              const hitTp2 = isLong ? currentMark >= pos.tp2Price : currentMark <= pos.tp2Price;
              if (hitTp2) {
                pos.tpLevelReached = 2;
                // Trail Stop Loss to previous target level (TP1)
                pos.stopLossPrice = pos.tp1Price;
                pos.securedProfitUsd = Number(
                  (pos.amountUsd * ((Math.abs(pos.tp1Price - pos.entryPrice) / pos.entryPrice) * pos.leverage)).toFixed(2)
                );

                addToast({
                  type: 'CLOSE_WIN',
                  title: isAr ? '🚀 تحقيق الهدف الثاني (TP2) - حجز أرباح TP1!' : '🚀 Target 2 Hit - SL Trailed to TP1!',
                  message: isAr
                    ? `${pos.symbol}: تم تحقيق الهدف الثاني ($${pos.tp2Price}). تم رفع وقف الخسارة إلى مستوى الهدف الأول ($${pos.tp1Price}) لحجز الأرباح تلقائياً ومواصلة الصعود نحو الهدف الثالث!`
                    : `${pos.symbol}: Target 2 reached ($${pos.tp2Price}). Trailed stop-loss to Target 1 level ($${pos.tp1Price}) locking in profit while allowing runner upside!`,
                  symbol: pos.symbol,
                  side: pos.side,
                  pnl: pos.securedProfitUsd,
                });

                TelegramService.sendMessage(
                  telegramSettingsRef.current.botToken,
                  telegramSettingsRef.current.chatId,
                  isAr
                    ? `🚀 <b>تحقيق الهدف الثاني (TP2) - ${pos.symbol}</b>\n\n• السعر الحالي: $${currentMark}\n• تم رفع وقف الخسارة تلقائياً إلى مستوى الهدف الأول $${pos.tp1Price}.\n• تم حجز وتأمين أرباح الهدف الأول بالكامل مع إتاحة المجال لتحقيق الهدف الثالث (TP3) 🏆`
                    : `🚀 <b>Target 2 Hit (TP2) - ${pos.symbol}</b>\n\n• Current: $${currentMark}\n• Stop-Loss trailed to Target 1 ($${pos.tp1Price}).\n• Gains locked, continuing upside towards Target 3! 🏆`
                );
              }
            }

            // Target 3 Hit: Dynamically trail Stop-Loss to previous target level (TP2) - Lock in major gains!
            const target3Price = pos.tp3Price || pos.takeProfitPrice;
            if (pos.tpLevelReached === 2 && target3Price) {
              const hitTp3 = isLong ? currentMark >= target3Price : currentMark <= target3Price;
              if (hitTp3) {
                pos.tpLevelReached = 3;
                // Trail Stop Loss to previous target level (TP2)
                pos.stopLossPrice = pos.tp2Price;
                pos.securedProfitUsd = Number(
                  (pos.amountUsd * ((Math.abs(pos.tp2Price - pos.entryPrice) / pos.entryPrice) * pos.leverage)).toFixed(2)
                );

                addToast({
                  type: 'CLOSE_WIN',
                  title: isAr ? '🏆 تحقيق الهدف الثالث (TP3) - رفع الوقف لمستوى TP2!' : '🏆 Target 3 Hit - SL Trailed to TP2!',
                  message: isAr
                    ? `${pos.symbol}: تم تحقيق الهدف الثالث ($${target3Price}). تم رفع وقف الخسارة إلى مستوى الهدف الثاني ($${pos.tp2Price}) لحجز أقصى عائد مع إبقاء الصفقة حية لجني المزيد من المكاسب!`
                    : `${pos.symbol}: Target 3 reached ($${target3Price}). Trailed stop-loss to Target 2 level ($${pos.tp2Price}) to lock in maximum gains with continued upside runner!`,
                  symbol: pos.symbol,
                  side: pos.side,
                  pnl: pos.securedProfitUsd,
                });

                TelegramService.sendMessage(
                  telegramSettingsRef.current.botToken,
                  telegramSettingsRef.current.chatId,
                  isAr
                    ? `🏆 <b>تحقيق الهدف الثالث (TP3) - ${pos.symbol}</b>\n\n• السعر الحالي: $${currentMark}\n• تم رفع وقف الخسارة إلى مستوى الهدف الثاني $${pos.tp2Price}.\n• تم حجز أعلى نسبة أرباح مع إبقاء الصفقة مفتوحة لمواصلة المكاسب 💎`
                    : `🏆 <b>Target 3 Hit (TP3) - ${pos.symbol}</b>\n\n• Current: $${currentMark}\n• Stop-Loss trailed to Target 2 ($${pos.tp2Price}).\n• Massive profit secured with open runner 💎`
                );
              }
            }
          }

          // Trailing SL Exit Check: If price retraces to the trailing stop loss
          const hitSl = isLong ? currentMark <= pos.stopLossPrice : currentMark >= pos.stopLossPrice;
          if (hitSl) {
            const isProfitableExit = (pos.tpLevelReached || 0) >= 1 || pos.unrealizedProfit >= 0;
            toClose.push({
              id: pos.id,
              reason: isProfitableExit ? 'TRAILING_STOP' : 'STOP_LOSS',
            });
            continue;
          }

          // Trailing Stop check
          if (settingsRef.current.useTrailingStop && pos.pnlPercentage > 1.8) {
            const peak = isLong ? pos.highestPriceReached! : pos.lowestPriceReached!;
            const dropFromPeak = isLong
              ? ((peak - currentMark) / peak) * 100 * pos.leverage
              : ((currentMark - peak) / peak) * 100 * pos.leverage;

            if (dropFromPeak >= settingsRef.current.trailingStopPercent * pos.leverage) {
              toClose.push({ id: pos.id, reason: 'TRAILING_STOP' });
              continue;
            }
          }

          // Max Duration (Only enforced if unlimitedHoldTime is disabled)
          if (!settingsRef.current.unlimitedHoldTime && now - pos.openedAt >= pos.maxDurationMs) {
            toClose.push({ id: pos.id, reason: 'TIME_EXPIRED' });
            continue;
          }
        }

        // Close flagged positions
        for (const item of toClose) {
          await closePosition(item.id, item.reason);
        }

        setPositions(updated.filter((p) => !toClose.some((tc) => tc.id === p.id)));
      }

      // 4. Autonomous 24/7 AI Training Cycle
      const freshAiState = aiEngine.runAutonomousBackgroundTraining(currentTickers, languageRef.current);
      setAiState(freshAiState);

      // 5. Autonomous 24/7 Bot Trade Scanner & Execution (High-Probability Filter)
      if (
        botRunningRef.current &&
        settingsRef.current.autoTradingEnabled &&
        positionsRef.current.length < settingsRef.current.maxConcurrentPositions &&
        currentTickers.length > 0
      ) {
        const openSymbols = new Set(positionsRef.current.map((p) => p.symbol));
        // Use AI quantitative candidate filter for high win rate
        const eligible = aiEngine.filterHighProbabilityCandidates(
          currentTickers,
          openSymbols,
          settingsRef.current.minAiConfidence
        );

        if (eligible.length > 0) {
          const topCandidate = eligible[0];
          const sideToOpen: TradeDirection = topCandidate.aiRecommendedSignal === 'SELL_SHORT' ? 'SHORT' : 'LONG';

          // Check direction filter
          let canOpen = true;
          if (settingsRef.current.allowedDirection === 'LONG_ONLY' && sideToOpen !== 'LONG') canOpen = false;
          if (settingsRef.current.allowedDirection === 'SHORT_ONLY' && sideToOpen !== 'SHORT') canOpen = false;

          if (canOpen) {
            const rationale =
              languageRef.current === 'ar'
                ? `صفقة ذكية عالية الاحتمالية لـ ${topCandidate.symbol}: توافق الاتجاه والسيولة (+${topCandidate.priceChangePercent}%) مع مؤشر RSI عند ${topCandidate.rsi14} وثقة خوارزمية ${topCandidate.aiScore}%.`
                : `High-Probability Entry on ${topCandidate.symbol}: Trend and volume surge (+${topCandidate.priceChangePercent}%) with RSI ${topCandidate.rsi14} and AI conviction ${topCandidate.aiScore}%.`;

            await openPosition(topCandidate.symbol, sideToOpen, rationale);
          }
        }
      }
    }, 4000); // 4-second responsive scan loop

    return () => clearInterval(interval);
  }, []);

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
        wallets,
        activeWalletId,
        activeWallet,
        switchWallet,
        saveWalletProfile,
        deleteWalletProfile,
        setCustomWalletName,
        settings,
        updateSettings,
        telegramSettings,
        updateTelegramSettings,
        balance,
        positions,
        closedTrades,
        marketPairs,
        isLoadingMarket,
        aiState,
        totalTradesCount,
        winningTradesCount,
        losingTradesCount,
        winRatePercent,
        totalProfitUsd,
        totalLossUsd,
        netProfitUsd,
        toasts,
        addToast,
        dismissToast,
        clearAllToasts,
        openPosition,
        closePosition,
        closeAllPositions,
        refreshMarketData,
        refreshAccountData,
        clearTradeHistory,
      }}
    >
      {children}
    </TradingContext.Provider>
  );
};

export const useTrading = () => {
  const context = useContext(TradingContext);
  if (!context) {
    throw new Error('useTrading must be used within a TradingProvider');
  }
  return context;
};
