import {
  Position,
  TradeDirection,
  FuturesSymbolInfo,
  BotSettings,
  ClosedTrade,
  AccountBalance,
} from '../types/trading';
import { RiskManagementService } from '../services/riskManagementService';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { AccountState, RemotePosition } from './accountStateProvider';
import { storageService, StorageService, PersistentBotState } from '../services/storageService';
import { SAFE_BOOT_MODE } from './workerEngine';

export interface ExecutionOrderPlan {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly: boolean;
}

export interface ExecutionPlan {
  symbol: string;
  side: TradeDirection; // 'LONG' | 'SHORT'
  signal: 'BUY_LONG' | 'SELL_SHORT';
  entryPrice: number;
  quantity: number;
  notionalValue: number;
  leverage: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskAmountUsd: number;
  riskPercent: number;
  estimatedMargin: number;
  orderType: 'MARKET';
  stopLossOrderType: 'STOP_MARKET';
  takeProfitOrderType: 'TAKE_PROFIT_MARKET';
  reduceOnlyForExit: true;
  entryOrder: ExecutionOrderPlan;
  stopLossOrder: ExecutionOrderPlan;
  takeProfitOrder?: ExecutionOrderPlan;
  dryRun: true;
  executionPerformed: false;
  source: string;
  createdAt: number;
  validationErrors: string[];
  validationWarnings: string[];
}

export interface ExecutionBridgeRequest {
  symbol: string;
  signal: 'BUY_LONG' | 'SELL_SHORT';
  entryPrice: number;
  plannedStopLossPrice: number;
  plannedTakeProfitPrice?: number;
  rationale?: string;
  confidence?: number;
  customLeverage?: number;
  symbolInfo?: Partial<FuturesSymbolInfo>;
}

export interface ExecutionPlanResult {
  success: boolean;
  plan?: ExecutionPlan;
  rejectionReason?: string;
  validationErrors: string[];
  validationWarnings: string[];
  dryRun: true;
  executionPerformed: false;
}

export interface ExecutionBridgeContext {
  equity: number;
  openPositions: Position[];
  closedTrades: ClosedTrade[];
  settings: Partial<BotSettings>;
  symbolInfo: FuturesSymbolInfo;
}

/**
 * Normalizes price to tickSize specification.
 * Price must be finite and positive.
 */
export function normalizePrice(price: number, tickSize: number): number {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(tickSize) || tickSize <= 0) {
    return 0;
  }
  let decimals = 0;
  const tickStr = tickSize.toString();
  if (tickStr.includes('e-')) {
    decimals = parseInt(tickStr.split('e-')[1], 10);
  } else if (tickStr.includes('.')) {
    decimals = tickStr.split('.')[1].length;
  }
  const rounded = Math.round(price / tickSize) * tickSize;
  return Number(rounded.toFixed(decimals));
}

/**
 * Normalizes quantity to stepSize, minQty, and maxQty specifications.
 * Rounds down (floor) to prevent exceeding risk budgets.
 */
export function normalizeQuantity(
  quantity: number,
  stepSize: number,
  minQty: number,
  maxQty?: number
): number {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(stepSize) || stepSize <= 0) {
    return 0;
  }
  let decimals = 0;
  const stepStr = stepSize.toString();
  if (stepStr.includes('e-')) {
    decimals = parseInt(stepStr.split('e-')[1], 10);
  } else if (stepStr.includes('.')) {
    decimals = stepStr.split('.')[1].length;
  }
  const stepped = Math.floor(quantity / stepSize + 1e-9) * stepSize;
  const finalQty = Number(stepped.toFixed(decimals));

  if (finalQty < minQty) {
    return 0;
  }
  if (maxQty !== undefined && Number.isFinite(maxQty) && maxQty > 0 && finalQty > maxQty) {
    return 0;
  }
  return finalQty;
}

/**
 * TestnetExecutionBridge — DRY-RUN ONLY
 *
 * Transforms qualified candidate signals into fully validated, auditable Order Plans
 * without ever placing, modifying, or cancelling Binance orders.
 *
 * STRICT SAFETY INVARIANTS:
 * - 100% DRY-RUN. executionPerformed is strictly FALSE.
 * - ZERO orders placed, modified, or cancelled.
 * - ZERO calls to executeOrder, placeOrder, openPosition, closePosition, cancelOrder.
 * - ZERO POST/PUT/DELETE calls to Binance endpoints.
 * - Never touches or alters existing adopted positions (e.g. HOOKUSDT).
 * - AUTO equity uses actual account equity from Binance Testnet (totalMarginBalance).
 * - Enforces CapitalProfile semantics (capitalUsd=0 -> AUTO, riskPerTradePercent=0 -> NO_TRADING, maxOpenPositions=0 -> NO_NEW_POSITIONS).
 * - Enforces tickSize, stepSize, minQty, maxQty, minNotional.
 */
export class TestnetExecutionBridge {
  private storage: StorageService;
  private lastPlan: ExecutionPlan | null = null;
  private activeLocks: Set<string> = new Set();

  constructor(storage?: StorageService) {
    this.storage = storage || storageService;
  }

  public getLastExecutionPlan(): ExecutionPlan | null {
    return this.lastPlan ? { ...this.lastPlan } : null;
  }

  public clearLastExecutionPlan(): void {
    this.lastPlan = null;
  }

  /**
   * Pure evaluation function for building an ExecutionPlan given a request and complete context.
   */
  public static evaluateExecutionPlan(
    req: ExecutionBridgeRequest,
    ctx: ExecutionBridgeContext
  ): ExecutionPlanResult {
    const validationErrors: string[] = [];
    const validationWarnings: string[] = [];

    // 1. Validate Signal and Side
    if (req.signal !== 'BUY_LONG' && req.signal !== 'SELL_SHORT') {
      return {
        success: false,
        rejectionReason: `Invalid signal type '${String(req.signal)}'. Must be BUY_LONG or SELL_SHORT.`,
        validationErrors: [`Invalid signal type: ${String(req.signal)}`],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    const side: TradeDirection = req.signal === 'BUY_LONG' ? 'LONG' : 'SHORT';
    const entryOrderSide: 'BUY' | 'SELL' = side === 'LONG' ? 'BUY' : 'SELL';
    const exitOrderSide: 'BUY' | 'SELL' = side === 'LONG' ? 'SELL' : 'BUY';

    // 2. Validate Symbol
    const symbol = req.symbol ? req.symbol.trim().toUpperCase() : '';
    if (!symbol) {
      return {
        success: false,
        rejectionReason: 'Invalid symbol: Symbol cannot be empty.',
        validationErrors: ['Symbol cannot be empty'],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // 3. Duplicate Position & Lock Check
    const hasExistingPosition = ctx.openPositions.some(
      (p) => p && p.symbol.toUpperCase() === symbol && p.side === side
    );
    if (hasExistingPosition) {
      return {
        success: false,
        rejectionReason: `Duplicate position rejected: Position for ${symbol}:${side} is already active in tracked positions.`,
        validationErrors: [`Duplicate position ${symbol}:${side}`],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // 4. Validate Capital Profile Settings
    const settings = ctx.settings;
    const profile = settings.capitalProfile;

    // Check riskPerTradePercent === 0 -> NO TRADING
    const riskPercent = profile !== undefined ? profile.riskPerTradePercent : (settings.riskPerTradePercent ?? 1.0);
    if (!Number.isFinite(riskPercent) || riskPercent === 0) {
      return {
        success: false,
        rejectionReason: 'Trading disabled: risk per trade is 0%.',
        validationErrors: ['riskPerTradePercent is 0% (NO_TRADING)'],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // Check maxOpenPositions === 0 -> NO NEW POSITIONS
    const maxOpenPositions = profile !== undefined ? profile.maxOpenPositions : (settings.maxConcurrentPositions ?? 2);
    if (!Number.isFinite(maxOpenPositions) || maxOpenPositions === 0) {
      return {
        success: false,
        rejectionReason: 'New positions disabled: max open positions is 0.',
        validationErrors: ['maxOpenPositions is 0 (NO_NEW_POSITIONS)'],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // Check if open positions count already meets or exceeds maxOpenPositions
    if (ctx.openPositions.length >= maxOpenPositions) {
      return {
        success: false,
        rejectionReason: `Max open positions limit reached (${ctx.openPositions.length} / ${maxOpenPositions}).`,
        validationErrors: [`openPositions count ${ctx.openPositions.length} >= max ${maxOpenPositions}`],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // 5. Determine Capital / AUTO Equity Check
    let effectiveCapital: number;
    if (profile && profile.capitalUsd > 0) {
      effectiveCapital = profile.capitalUsd;
    } else {
      // capitalUsd === 0 -> AUTO -> Uses actual account equity
      if (!Number.isFinite(ctx.equity) || ctx.equity <= 0) {
        return {
          success: false,
          rejectionReason: 'Trading rejected: actual account equity unavailable or zero for AUTO capital mode.',
          validationErrors: ['Actual account equity unavailable or zero for AUTO capital mode'],
          validationWarnings,
          dryRun: true,
          executionPerformed: false,
        };
      }
      effectiveCapital = ctx.equity;
    }

    // 6. Validate Entry Price
    if (!Number.isFinite(req.entryPrice) || req.entryPrice <= 0) {
      return {
        success: false,
        rejectionReason: `Invalid entry price: ${req.entryPrice}. Price must be finite and positive.`,
        validationErrors: [`Invalid entry price: ${req.entryPrice}`],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // 7. Validate Stop-Loss Price (Strictly NO fallbacks to entryPrice or fake values)
    if (!Number.isFinite(req.plannedStopLossPrice) || req.plannedStopLossPrice <= 0) {
      return {
        success: false,
        rejectionReason: `Invalid stop-loss price: ${req.plannedStopLossPrice}. Stop-loss must be finite and positive.`,
        validationErrors: [`Invalid stop-loss price: ${req.plannedStopLossPrice}`],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    if (side === 'LONG' && req.plannedStopLossPrice >= req.entryPrice) {
      return {
        success: false,
        rejectionReason: `Invalid stop-loss for LONG: stopLossPrice (${req.plannedStopLossPrice}) must be below entryPrice (${req.entryPrice}).`,
        validationErrors: ['Stop loss must be below entry price for LONG'],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    if (side === 'SHORT' && req.plannedStopLossPrice <= req.entryPrice) {
      return {
        success: false,
        rejectionReason: `Invalid stop-loss for SHORT: stopLossPrice (${req.plannedStopLossPrice}) must be above entryPrice (${req.entryPrice}).`,
        validationErrors: ['Stop loss must be above entry price for SHORT'],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // 8. Validate Take-Profit Price (Strictly NO fallbacks to entryPrice or fake values)
    if (req.plannedTakeProfitPrice !== undefined) {
      if (!Number.isFinite(req.plannedTakeProfitPrice) || req.plannedTakeProfitPrice <= 0) {
        return {
          success: false,
          rejectionReason: `Invalid take-profit price: ${req.plannedTakeProfitPrice}. Must be finite and positive.`,
          validationErrors: [`Invalid take-profit price: ${req.plannedTakeProfitPrice}`],
          validationWarnings,
          dryRun: true,
          executionPerformed: false,
        };
      }

      if (side === 'LONG' && req.plannedTakeProfitPrice <= req.entryPrice) {
        return {
          success: false,
          rejectionReason: `Invalid take-profit for LONG: takeProfitPrice (${req.plannedTakeProfitPrice}) must be above entryPrice (${req.entryPrice}).`,
          validationErrors: ['Take profit must be above entry price for LONG'],
          validationWarnings,
          dryRun: true,
          executionPerformed: false,
        };
      }

      if (side === 'SHORT' && req.plannedTakeProfitPrice >= req.entryPrice) {
        return {
          success: false,
          rejectionReason: `Invalid take-profit for SHORT: takeProfitPrice (${req.plannedTakeProfitPrice}) must be below entryPrice (${req.entryPrice}).`,
          validationErrors: ['Take profit must be below entry price for SHORT'],
          validationWarnings,
          dryRun: true,
          executionPerformed: false,
        };
      }
    }

    // 9. Symbol Filters (tickSize, stepSize, minQty, maxQty, minNotional)
    const symbolInfo = ctx.symbolInfo;
    const tickSize = symbolInfo.tickSize && symbolInfo.tickSize > 0 ? symbolInfo.tickSize : 0.01;
    const stepSize = symbolInfo.stepSize && symbolInfo.stepSize > 0 ? symbolInfo.stepSize : 0.001;
    const minQty = symbolInfo.minQty && symbolInfo.minQty > 0 ? symbolInfo.minQty : 0.001;
    const minNotional = symbolInfo.minNotional && symbolInfo.minNotional > 0 ? symbolInfo.minNotional : 5.0;

    // Normalize prices
    const normalizedEntryPrice = normalizePrice(req.entryPrice, tickSize);
    const normalizedStopLossPrice = normalizePrice(req.plannedStopLossPrice, tickSize);
    const normalizedTakeProfitPrice =
      req.plannedTakeProfitPrice !== undefined
        ? normalizePrice(req.plannedTakeProfitPrice, tickSize)
        : 0;

    if (normalizedEntryPrice <= 0 || normalizedStopLossPrice <= 0) {
      return {
        success: false,
        rejectionReason: 'Price normalization resulted in zero or invalid price.',
        validationErrors: ['Normalized entry or stop loss price is zero'],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    const fullSettings: BotSettings = {
      tradingMode: 'testnet',
      leverage: 10,
      marginType: 'CROSSED',
      orderType: 'MARKET',
      riskPerTradePercent: 1.0,
      maxConcurrentPositions: 2,
      maxOpenRiskPercent: 6.0,
      allowedDirection: 'BOTH',
      ...settings,
    } as BotSettings;

    // 10. Position Sizing via RiskManagementService
    const sizing = RiskManagementService.calculatePositionSize(
      ctx.equity,
      normalizedEntryPrice,
      normalizedStopLossPrice,
      symbolInfo,
      fullSettings,
      req.customLeverage
    );

    if (!sizing.allowed || sizing.quantity <= 0) {
      return {
        success: false,
        rejectionReason: sizing.rejectionReason || 'Position sizing rejected by RiskManagementService.',
        validationErrors: [sizing.rejectionReason || 'Position sizing failed'],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // 11. Normalize Quantity strictly to stepSize & minQty/maxQty
    const normalizedQuantity = normalizeQuantity(sizing.quantity, stepSize, minQty, (symbolInfo as any).maxQty);
    if (normalizedQuantity <= 0) {
      return {
        success: false,
        rejectionReason: `Quantity normalization resulted in zero quantity or below minQty (${minQty}).`,
        validationErrors: [`Normalized quantity ${normalizedQuantity} < minQty ${minQty}`],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // 12. Notional Value and minNotional validation
    const notionalValue = Number((normalizedQuantity * normalizedEntryPrice).toFixed(4));
    if (notionalValue < minNotional) {
      return {
        success: false,
        rejectionReason: `Order notional ($${notionalValue.toFixed(2)}) is below Binance minNotional ($${minNotional.toFixed(2)}).`,
        validationErrors: [`Notional value $${notionalValue} < minNotional $${minNotional}`],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // 13. Portfolio Risk Validation via RiskManagementService
    const balance: AccountBalance = {
      totalWalletBalance: ctx.equity,
      availableBalance: ctx.equity,
      totalUnrealizedProfit: 0,
      totalMarginBalance: ctx.equity,
      totalInitialMargin: 0,
      totalMaintMargin: 0,
    };

    const riskValidation = RiskManagementService.validateOrderRisk(
      symbol,
      side,
      normalizedQuantity,
      normalizedEntryPrice,
      normalizedStopLossPrice,
      balance,
      ctx.openPositions,
      ctx.closedTrades,
      fullSettings
    );

    if (!riskValidation.isValid) {
      return {
        success: false,
        rejectionReason: riskValidation.rejectionReason || 'Portfolio risk validation failed.',
        validationErrors: [riskValidation.rejectionReason || 'Portfolio risk limit exceeded'],
        validationWarnings,
        dryRun: true,
        executionPerformed: false,
      };
    }

    // 14. Build Entry and Protective Order Plans (DRY-RUN ONLY)
    const leverage = sizing.effectiveLeverage || settings.leverage || 10;
    const estimatedMargin = Number((notionalValue / leverage).toFixed(4));
    const riskAmountUsd = Number((normalizedQuantity * Math.abs(normalizedEntryPrice - normalizedStopLossPrice)).toFixed(4));

    const entryOrder: ExecutionOrderPlan = {
      symbol,
      side: entryOrderSide,
      type: 'MARKET',
      quantity: normalizedQuantity,
      price: normalizedEntryPrice,
      reduceOnly: false,
    };

    const stopLossOrder: ExecutionOrderPlan = {
      symbol,
      side: exitOrderSide,
      type: 'STOP_MARKET',
      quantity: normalizedQuantity,
      stopPrice: normalizedStopLossPrice,
      reduceOnly: true,
    };

    let takeProfitOrder: ExecutionOrderPlan | undefined = undefined;
    if (normalizedTakeProfitPrice > 0) {
      takeProfitOrder = {
        symbol,
        side: exitOrderSide,
        type: 'TAKE_PROFIT_MARKET',
        quantity: normalizedQuantity,
        stopPrice: normalizedTakeProfitPrice,
        reduceOnly: true,
      };
    }

    const plan: ExecutionPlan = {
      symbol,
      side,
      signal: req.signal,
      entryPrice: normalizedEntryPrice,
      quantity: normalizedQuantity,
      notionalValue,
      leverage,
      stopLossPrice: normalizedStopLossPrice,
      takeProfitPrice: normalizedTakeProfitPrice,
      riskAmountUsd,
      riskPercent,
      estimatedMargin,
      orderType: 'MARKET',
      stopLossOrderType: 'STOP_MARKET',
      takeProfitOrderType: 'TAKE_PROFIT_MARKET',
      reduceOnlyForExit: true,
      entryOrder,
      stopLossOrder,
      takeProfitOrder,
      dryRun: true,
      executionPerformed: false,
      source: 'BINANCE_TESTNET_DRY_RUN',
      createdAt: Date.now(),
      validationErrors: [],
      validationWarnings,
    };

    return {
      success: true,
      plan,
      validationErrors: [],
      validationWarnings,
      dryRun: true,
      executionPerformed: false,
    };
  }

  /**
   * Generates a DRY-RUN ExecutionPlan using live persistent state and Binance Testnet account equity.
   * Strictly DRY-RUN: Never places or modifies any order on Binance.
   */
  public async createExecutionPlan(
    req: ExecutionBridgeRequest,
    customState?: PersistentBotState,
    customAccountState?: AccountState
  ): Promise<ExecutionPlanResult> {
    try {
      // 1. Load persistent state
      const state: PersistentBotState = customState || (await this.storage.loadState());
      const openPositions = Array.isArray(state.trackedPositions) ? state.trackedPositions : [];
      const closedTrades: ClosedTrade[] = []; // In server-side state closedTrades can be empty or loaded
      const settings = state.settings || ({} as BotSettings);

      // 2. Fetch live account equity from Binance Testnet
      let equity = 0;
      if (customAccountState) {
        equity = customAccountState.equity || 0;
      } else {
        const accountState = await binanceTestnetAccountStateProvider.getAccountState();
        if (accountState.available && Number.isFinite(accountState.equity) && (accountState.equity as number) > 0) {
          equity = accountState.equity as number;
        } else if (state.lastKnownAccountState?.totalMarginBalance && state.lastKnownAccountState.totalMarginBalance > 0) {
          equity = state.lastKnownAccountState.totalMarginBalance;
        }
      }

      // 3. Resolve symbol info (defaults or provided)
      const symbolInfo: FuturesSymbolInfo = {
        symbol: req.symbol.toUpperCase(),
        baseAsset: req.symbol.replace('USDT', ''),
        quoteAsset: 'USDT',
        pricePrecision: req.symbolInfo?.pricePrecision ?? 2,
        quantityPrecision: req.symbolInfo?.quantityPrecision ?? 3,
        minQty: req.symbolInfo?.minQty ?? 0.001,
        stepSize: req.symbolInfo?.stepSize ?? 0.001,
        tickSize: req.symbolInfo?.tickSize ?? 0.01,
        minNotional: req.symbolInfo?.minNotional ?? 5.0,
        price: req.entryPrice,
        priceChangePercent: 0,
        volume24h: 1000000,
        quoteVolume24h: 1000000,
        high24h: req.entryPrice * 1.05,
        low24h: req.entryPrice * 0.95,
        rsi14: 50,
        trend: 'NEUTRAL',
        orderbookRatio: 1.0,
        aiScore: 50,
        aiRecommendedSignal: req.signal === 'BUY_LONG' ? 'BUY_LONG' : 'SELL_SHORT',
        ...req.symbolInfo,
      };

      const context: ExecutionBridgeContext = {
        equity,
        openPositions,
        closedTrades,
        settings,
        symbolInfo,
      };

      const result = TestnetExecutionBridge.evaluateExecutionPlan(req, context);
      if (result.success && result.plan) {
        this.lastPlan = result.plan;
      }

      return result;
    } catch (err: any) {
      return {
        success: false,
        rejectionReason: `Execution bridge error: ${err.message || String(err)}`,
        validationErrors: [err.message || String(err)],
        validationWarnings: [],
        dryRun: true,
        executionPerformed: false,
      };
    }
  }
}

export const testnetExecutionBridge = new TestnetExecutionBridge();
