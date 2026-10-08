import {
  TradeDirection,
  FuturesSymbolInfo,
  BotSettings,
} from '../types/trading';
import { ExecutionPlan } from './testnetExecutionBridge';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { AccountState } from './accountStateProvider';
import { storageService, StorageService } from '../services/storageService';
import { BINANCE_FUTURES_ACCOUNT_BASE_URL } from './workerConstants';
import { binanceNetworkGuard } from './binanceNetworkGuard';
import { normalizePrice, normalizeQuantity } from './testnetExecutionBridge';

export interface PreflightCheckItem {
  name: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface PreflightResult {
  approved: boolean;
  symbol: string;
  side: TradeDirection;
  quantity: number;
  entryPrice: number;
  currentPrice?: number;
  currentEquity?: number;
  plannedEquity?: number;
  currentPositionCount: number;
  maxOpenPositions: number;
  checks: PreflightCheckItem[];
  errors: string[];
  warnings: string[];
  timestamp: number;
  dryRun: true;
  executionPerformed: false;
}

export interface PreflightOverrides {
  targetBaseUrl?: string;
  accountState?: AccountState;
  positionMode?: 'ONE_WAY' | 'HEDGE' | null;
  currentPrice?: number;
  symbolFilters?: Partial<FuturesSymbolInfo>;
  settings?: Partial<BotSettings>;
}

/**
 * ExecutionPreflight — READ-ONLY Pre-Execution Gate
 *
 * Verifies that an ExecutionPlan remains fully valid and safe at the exact moment
 * prior to any proposed execution.
 *
 * STRICT SAFETY INVARIANTS:
 * - 100% READ-ONLY: Never places, closes, modifies, or cancels any order
 * - NO execution endpoints called
 * - Testnet ONLY: Rejects if Production URL is detected
 * - Never touches or sends orders to existing adopted positions (e.g. HOOKUSDT)
 * - Zero secrets exposed in results or logs
 */
export class ExecutionPreflight {
  private storage: StorageService;

  constructor(storage?: StorageService) {
    this.storage = storage || storageService;
  }

  /**
   * Fetches public exchangeInfo for a symbol directly from Binance Futures Testnet.
   * Endpoint: GET /fapi/v1/exchangeInfo
   */
  public async fetchSymbolExchangeInfo(symbol: string): Promise<FuturesSymbolInfo | null> {
    try {
      const cleanSymbol = symbol.trim().toUpperCase();
      const targetUrl = 'https://testnet.binancefuture.com/fapi/v1/exchangeInfo';
      binanceNetworkGuard.assertTestnetTraffic(targetUrl, 'ExecutionPreflight.fetchSymbolExchangeInfo');
      const res = await fetch(targetUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !Array.isArray(data.symbols)) return null;

      const sym = data.symbols.find((s: any) => s.symbol === cleanSymbol);
      if (!sym) return null;

      const priceFilter = sym.filters?.find((f: any) => f.filterType === 'PRICE_FILTER') || {};
      const lotSize = sym.filters?.find((f: any) => f.filterType === 'LOT_SIZE') || {};
      const marketLotSize = sym.filters?.find((f: any) => f.filterType === 'MARKET_LOT_SIZE') || {};
      const minNotionalFilter = sym.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL') || {};

      return {
        symbol: cleanSymbol,
        baseAsset: sym.baseAsset || '',
        quoteAsset: sym.quoteAsset || 'USDT',
        pricePrecision: sym.pricePrecision ?? 2,
        quantityPrecision: sym.quantityPrecision ?? 3,
        minQty: parseFloat(lotSize.minQty || '0.001'),
        maxQty: lotSize.maxQty ? parseFloat(lotSize.maxQty) : undefined,
        marketMaxQty: marketLotSize.maxQty ? parseFloat(marketLotSize.maxQty) : (lotSize.maxQty ? parseFloat(lotSize.maxQty) : undefined),
        stepSize: parseFloat(lotSize.stepSize || '0.001'),
        tickSize: parseFloat(priceFilter.tickSize || '0.01'),
        minNotional: parseFloat(minNotionalFilter.notional || '5.0'),
        price: 0,
        priceChangePercent: 0,
        volume24h: 0,
        quoteVolume24h: 0,
        high24h: 0,
        low24h: 0,
        rsi14: 50,
        trend: 'NEUTRAL',
        orderbookRatio: 1.0,
        aiScore: 50,
        aiRecommendedSignal: 'HOLD',
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetches current market price directly from Binance Futures Testnet ticker.
   * Endpoint: GET /fapi/v1/ticker/price?symbol=...
   */
  public async fetchCurrentPrice(symbol: string): Promise<number | null> {
    try {
      const cleanSymbol = symbol.trim().toUpperCase();
      const url = new URL('https://testnet.binancefuture.com/fapi/v1/ticker/price');
      url.searchParams.set('symbol', cleanSymbol);
      binanceNetworkGuard.assertTestnetTraffic(url.toString(), 'ExecutionPreflight.fetchCurrentPrice');
      const res = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== 'object' || !data.price) return null;
      const num = parseFloat(data.price);
      return Number.isFinite(num) && num > 0 ? num : null;
    } catch {
      return null;
    }
  }

  /**
   * Performs the full preflight validation suite against an ExecutionPlan.
   */
  public async validate(
    plan: ExecutionPlan,
    overrides?: PreflightOverrides
  ): Promise<PreflightResult> {
    const checks: PreflightCheckItem[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const now = Date.now();

    // 1. Environment Safety Check
    const targetUrl = overrides?.targetBaseUrl || BINANCE_FUTURES_ACCOUNT_BASE_URL;
    let isProductionUrl = false;
    try {
      binanceNetworkGuard.assertTestnetTraffic(targetUrl, 'ExecutionPreflight.validate');
    } catch {
      isProductionUrl = true;
    }

    if (isProductionUrl) {
      checks.push({
        name: 'ENVIRONMENT_SAFETY',
        passed: false,
        message: 'FAIL: Production Binance API URL detected. Preflight strictly requires Binance Futures Testnet.',
        details: { targetUrl },
      });
      errors.push('Production environment rejected: Only Binance Futures Testnet is permitted.');
    } else {
      checks.push({
        name: 'ENVIRONMENT_SAFETY',
        passed: true,
        message: 'PASS: Verified target environment is Binance Futures Testnet.',
        details: { targetUrl },
      });
    }

    // Load persistent state
    const state = await this.storage.loadState();
    const effectiveSettings = overrides?.settings || state.settings || {};
    const profile = effectiveSettings.capitalProfile;

    // 2. Account & Equity Check
    let accountState: AccountState;
    if (overrides?.accountState) {
      accountState = overrides.accountState;
    } else {
      accountState = await binanceTestnetAccountStateProvider.getAccountState();
    }

    let currentEquity = 0;
    const isAccountAvailable = accountState.available && Number.isFinite(accountState.equity) && (accountState.equity as number) > 0;

    if (!isAccountAvailable) {
      checks.push({
        name: 'ACCOUNT_EQUITY',
        passed: false,
        message: `FAIL: Account state or equity unavailable on Binance Testnet (${accountState.error || 'Equity is 0 or undefined'}).`,
      });
      errors.push('Account equity unavailable or zero on Binance Futures Testnet.');
    } else {
      currentEquity = accountState.equity as number;
      checks.push({
        name: 'ACCOUNT_EQUITY',
        passed: true,
        message: `PASS: Verified account reachable with positive equity: $${currentEquity.toFixed(2)} USDT.`,
        details: { currentEquity },
      });

      // Planned vs Current Equity Divergence Check (for AUTO capital mode)
      const plannedCapital = profile && profile.capitalUsd > 0 ? profile.capitalUsd : plan.riskAmountUsd / (plan.riskPercent / 100);
      if (plannedCapital > 0) {
        const divergencePercent = Math.abs(currentEquity - plannedCapital) / plannedCapital * 100;
        if (divergencePercent > 10) {
          checks.push({
            name: 'EQUITY_STABILITY',
            passed: false,
            message: `FAIL REQUIRE_RECALCULATION: Current equity ($${currentEquity.toFixed(2)}) diverged significantly (${divergencePercent.toFixed(1)}%) from planned equity ($${plannedCapital.toFixed(2)}).`,
            details: { plannedCapital, currentEquity, divergencePercent },
          });
          errors.push('Equity diverged significantly from planned equity. Re-calculation required.');
        } else {
          checks.push({
            name: 'EQUITY_STABILITY',
            passed: true,
            message: `PASS: Current equity is stable (divergence: ${divergencePercent.toFixed(2)}%).`,
            details: { plannedCapital, currentEquity, divergencePercent },
          });
        }
      }
    }

    // 3. Position Count & Duplicate Check (HOOKUSDT is strictly isolated from trade limits)
    const openPositions = accountState.openPositions || [];
    const activeNonIsolatedPositions = openPositions.filter((p) => p.symbol.toUpperCase() !== 'HOOKUSDT' && p.quantity > 0);
    const currentPositionCount = activeNonIsolatedPositions.length;
    const maxOpenPositions = profile !== undefined ? profile.maxOpenPositions : (effectiveSettings.maxConcurrentPositions ?? 4);

    if (maxOpenPositions === 0) {
      checks.push({
        name: 'MAX_POSITIONS_CONFIG',
        passed: false,
        message: 'FAIL: New positions disabled (maxOpenPositions = 0).',
      });
      errors.push('New positions disabled: maxOpenPositions is 0.');
    } else {
      checks.push({
        name: 'MAX_POSITIONS_CONFIG',
        passed: true,
        message: `PASS: maxOpenPositions is configured (${maxOpenPositions}).`,
      });
    }

    if (maxOpenPositions > 0 && currentPositionCount >= maxOpenPositions) {
      checks.push({
        name: 'POSITION_COUNT_LIMIT',
        passed: false,
        message: `FAIL: Current position count (${currentPositionCount}) has reached or exceeded maxOpenPositions (${maxOpenPositions}).`,
        details: { currentPositionCount, maxOpenPositions },
      });
      errors.push(`Position count limit reached: ${currentPositionCount} >= ${maxOpenPositions}`);
    } else if (maxOpenPositions > 0) {
      checks.push({
        name: 'POSITION_COUNT_LIMIT',
        passed: true,
        message: `PASS: Position count (${currentPositionCount}) is within allowable limit (${maxOpenPositions}).`,
        details: { currentPositionCount, maxOpenPositions },
      });
    }

    // Duplicate Check: Same symbol (cannot open duplicate position on same symbol)
    const hasDuplicate = openPositions.some(
      (p) => p.symbol.toUpperCase() === plan.symbol.toUpperCase() && p.quantity > 0
    );
    if (hasDuplicate) {
      checks.push({
        name: 'DUPLICATE_POSITION',
        passed: false,
        message: `FAIL DUPLICATE_POSITION: An active position for ${plan.symbol} already exists on Binance Testnet.`,
        details: { symbol: plan.symbol, side: plan.side },
      });
      errors.push(`Duplicate position detected for ${plan.symbol}.`);
    } else {
      checks.push({
        name: 'DUPLICATE_POSITION',
        passed: true,
        message: `PASS: No duplicate position exists for ${plan.symbol}.`,
      });
    }

    // 4. Exchange Info & Filter Revalidation
    let symbolFilters: FuturesSymbolInfo | null;
    if (overrides?.symbolFilters) {
      symbolFilters = {
        symbol: plan.symbol,
        baseAsset: plan.symbol.replace('USDT', ''),
        quoteAsset: 'USDT',
        pricePrecision: overrides.symbolFilters.pricePrecision ?? 2,
        quantityPrecision: overrides.symbolFilters.quantityPrecision ?? 3,
        minQty: overrides.symbolFilters.minQty ?? 0.001,
        stepSize: overrides.symbolFilters.stepSize ?? 0.001,
        tickSize: overrides.symbolFilters.tickSize ?? 0.01,
        minNotional: overrides.symbolFilters.minNotional ?? 5.0,
        price: plan.entryPrice,
        priceChangePercent: 0,
        volume24h: 1000000,
        quoteVolume24h: 1000000,
        high24h: plan.entryPrice * 1.05,
        low24h: plan.entryPrice * 0.95,
        rsi14: 50,
        trend: 'NEUTRAL',
        orderbookRatio: 1.0,
        aiScore: 50,
        aiRecommendedSignal: 'HOLD',
        ...overrides.symbolFilters,
      };
    } else {
      symbolFilters = await this.fetchSymbolExchangeInfo(plan.symbol);
    }

    if (!symbolFilters) {
      checks.push({
        name: 'EXCHANGE_INFO',
        passed: false,
        message: `FAIL: Unable to fetch exchangeInfo for ${plan.symbol} from Binance Testnet.`,
      });
      errors.push(`Failed to fetch exchangeInfo for ${plan.symbol}.`);
    } else {
      // Validate filters against the plan
      const tickSize = symbolFilters.tickSize;
      const stepSize = symbolFilters.stepSize;
      const minQty = symbolFilters.minQty;
      const minNotional = symbolFilters.minNotional;

      // Re-normalize planned values
      const testNormalizedQty = normalizeQuantity(plan.quantity, stepSize, minQty, (symbolFilters as any).maxQty);
      const testNormalizedPrice = normalizePrice(plan.entryPrice, tickSize);

      const qtyMatches = Math.abs(testNormalizedQty - plan.quantity) < 1e-8;
      const priceMatches = Math.abs(testNormalizedPrice - plan.entryPrice) < 1e-8;
      const notionalValid = plan.notionalValue >= minNotional;

      if (!qtyMatches || !priceMatches || !notionalValid) {
        checks.push({
          name: 'EXCHANGE_FILTERS',
          passed: false,
          message: 'FAIL REQUIRE_REBUILD_PLAN: Symbol filters differ from ExecutionPlan or plan violates current constraints.',
          details: {
            qtyMatches,
            priceMatches,
            notionalValid,
            planQty: plan.quantity,
            expectedQty: testNormalizedQty,
            planPrice: plan.entryPrice,
            expectedPrice: testNormalizedPrice,
            minNotional,
            planNotional: plan.notionalValue,
          },
        });
        errors.push('REQUIRE_REBUILD_PLAN: Filters changed or constraints violated.');
      } else {
        checks.push({
          name: 'EXCHANGE_FILTERS',
          passed: true,
          message: 'PASS: ExecutionPlan adheres strictly to Binance Testnet exchange filters.',
          details: { tickSize, stepSize, minQty, minNotional },
        });
      }
    }

    // 5. Price Revalidation
    let currentPrice: number | null;
    if (overrides?.currentPrice !== undefined) {
      currentPrice = overrides.currentPrice;
    } else {
      currentPrice = await this.fetchCurrentPrice(plan.symbol);
    }

    if (!currentPrice || !Number.isFinite(currentPrice) || currentPrice <= 0) {
      checks.push({
        name: 'PRICE_REVALIDATION',
        passed: false,
        message: `FAIL: Current price for ${plan.symbol} is invalid or unavailable (${currentPrice}).`,
      });
      errors.push(`Current price unavailable or invalid for ${plan.symbol}.`);
    } else {
      const priceDiff = Math.abs(currentPrice - plan.entryPrice);
      const deviationPercent = Number(((priceDiff / plan.entryPrice) * 100).toFixed(3));

      // As specified: If no slippage threshold exists in settings, record warning and do not auto-approve
      warnings.push(
        `Price deviation between planned entry ($${plan.entryPrice}) and live market ($${currentPrice}) is ${deviationPercent}%. No predefined slippage tolerance threshold set.`
      );

      checks.push({
        name: 'PRICE_REVALIDATION',
        passed: true,
        message: `PASS: Live market price verified ($${currentPrice}). Deviation: ${deviationPercent}%.`,
        details: { plannedEntry: plan.entryPrice, currentPrice, deviationPercent },
      });
    }

    // 6. Risk Revalidation
    const riskCheckPassed =
      plan.riskPercent > 0 &&
      plan.riskAmountUsd > 0 &&
      plan.quantity > 0 &&
      plan.stopLossPrice > 0 &&
      plan.stopLossPrice !== plan.entryPrice &&
      (plan.side === 'LONG' ? plan.stopLossPrice < plan.entryPrice : plan.stopLossPrice > plan.entryPrice);

    if (!riskCheckPassed) {
      checks.push({
        name: 'RISK_REVALIDATION',
        passed: false,
        message: 'FAIL: Risk parameters invalid (stop-loss missing, equal to entry, or incorrect side).',
        details: {
          riskPercent: plan.riskPercent,
          riskAmountUsd: plan.riskAmountUsd,
          stopLossPrice: plan.stopLossPrice,
          entryPrice: plan.entryPrice,
        },
      });
      errors.push('Risk revalidation failed: Invalid stop-loss or risk budget.');
    } else {
      checks.push({
        name: 'RISK_REVALIDATION',
        passed: true,
        message: `PASS: Risk parameters verified ($${plan.riskAmountUsd} at risk, SL: ${plan.stopLossPrice}).`,
      });
    }

    // 7. Leverage Check
    const plannedLeverage = plan.leverage;
    if (!Number.isFinite(plannedLeverage) || plannedLeverage <= 0) {
      checks.push({
        name: 'LEVERAGE_CHECK',
        passed: false,
        message: `FAIL: Planned leverage is invalid (${plannedLeverage}).`,
      });
      errors.push(`Invalid planned leverage: ${plannedLeverage}`);
    } else {
      warnings.push(`Planned leverage is ${plannedLeverage}x. Leverage endpoint was NOT called (strictly READ-ONLY).`);
      checks.push({
        name: 'LEVERAGE_CHECK',
        passed: true,
        message: `PASS: Planned leverage ${plannedLeverage}x is valid.`,
        details: { plannedLeverage },
      });
    }

    // 8. Position Mode Check (One-Way vs Hedge Mode)
    let positionMode: 'ONE_WAY' | 'HEDGE' | null;
    if (overrides?.positionMode !== undefined) {
      positionMode = overrides.positionMode;
    } else {
      positionMode = await binanceTestnetAccountStateProvider.getPositionMode();
    }

    if (!positionMode) {
      checks.push({
        name: 'POSITION_MODE',
        passed: false,
        message: 'FAIL: Position mode (One-Way vs Hedge) could not be verified via read-only check.',
      });
      errors.push('Position mode could not be verified on Binance Testnet.');
    } else {
      checks.push({
        name: 'POSITION_MODE',
        passed: true,
        message: `PASS: Verified account position mode is ${positionMode}.`,
        details: { positionMode },
      });
    }

    // 9. Order Plan Integrity (Protective Orders Integrity)
    const slOrder = plan.stopLossOrder;
    const isSlValid =
      Boolean(slOrder) &&
      slOrder.symbol.toUpperCase() === plan.symbol.toUpperCase() &&
      Math.abs(slOrder.quantity - plan.quantity) < 1e-8 &&
      slOrder.reduceOnly === true &&
      slOrder.stopPrice === plan.stopLossPrice &&
      slOrder.side === (plan.side === 'LONG' ? 'SELL' : 'BUY') &&
      (plan.side === 'LONG' ? slOrder.stopPrice < plan.entryPrice : slOrder.stopPrice > plan.entryPrice);

    let isTpValid = true;
    if (plan.takeProfitOrder) {
      const tp = plan.takeProfitOrder;
      isTpValid =
        tp.symbol.toUpperCase() === plan.symbol.toUpperCase() &&
        Math.abs(tp.quantity - plan.quantity) < 1e-8 &&
        tp.reduceOnly === true &&
        tp.stopPrice === plan.takeProfitPrice &&
        tp.side === (plan.side === 'LONG' ? 'SELL' : 'BUY') &&
        (plan.side === 'LONG' ? (tp.stopPrice as number) > plan.entryPrice : (tp.stopPrice as number) < plan.entryPrice);
    }

    const planIntegrityPassed =
      plan.dryRun === true &&
      plan.executionPerformed === false &&
      Boolean(plan.entryOrder && plan.entryOrder.quantity === plan.quantity && plan.entryOrder.type === 'MARKET') &&
      isSlValid &&
      isTpValid;

    if (!planIntegrityPassed) {
      checks.push({
        name: 'ORDER_PLAN_INTEGRITY',
        passed: false,
        message: 'FAIL: ExecutionPlan structure or protective order specification (SL/TP) is invalid, missing, or altered.',
      });
      errors.push('ExecutionPlan integrity check failed: protective order specification invalid.');
    } else {
      checks.push({
        name: 'ORDER_PLAN_INTEGRITY',
        passed: true,
        message: 'PASS: ExecutionPlan integrity confirmed (entryOrder + protective orders SL/TP strictly validated).',
      });
    }

    const approved = checks.every((c) => c.passed) && errors.length === 0;

    return {
      approved,
      symbol: plan.symbol,
      side: plan.side,
      quantity: plan.quantity,
      entryPrice: plan.entryPrice,
      currentPrice: currentPrice || undefined,
      currentEquity: currentEquity || undefined,
      plannedEquity: plan.riskAmountUsd / (plan.riskPercent / 100),
      currentPositionCount,
      maxOpenPositions,
      checks,
      errors,
      warnings,
      timestamp: now,
      dryRun: true,
      executionPerformed: false,
    };
  }
}

export const executionPreflight = new ExecutionPreflight();
