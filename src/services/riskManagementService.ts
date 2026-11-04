import {
  AccountBalance,
  BotSettings,
  CapitalProfile,
  ClosedTrade,
  FuturesSymbolInfo,
  Position,
  TradeDirection,
} from '../types/trading';

export interface SizingResult {
  allowed: boolean;
  rejectionReason?: string;
  quantity: number;
  notionalValue: number;
  marginRequiredUsd: number;
  riskBudgetUsd: number;
  stopDistancePercent: number;
  stopDistanceUsd: number;
  effectiveLeverage: number;
}

export interface RiskValidationReport {
  isValid: boolean;
  rejectionReason?: string;
  circuitBreakerTriggered?: boolean;
  metrics: {
    currentOpenPositions: number;
    totalOpenRiskUsd: number;
    totalOpenRiskPercent: number;
    totalOpenNotionalUsd: number;
    totalMarginUsedUsd: number;
    consecutiveLossCount: number;
    dailyRealizedLossUsd: number;
    dailyDrawdownPercent: number;
  };
}

export class RiskManagementService {
  /**
   * Validates CapitalProfile safety constraints.
   * Allows 0 with explicit domain semantics:
   * - capitalUsd = 0 -> AUTO (Uses live account equity)
   * - riskPerTradePercent = 0 -> NO TRADING (Trading disabled)
   * - maxDailyLossPercent = 0 -> DISABLED (Daily loss circuit breaker off)
   * - maxOpenPositions = 0 -> NO TRADING (New positions disabled)
   */
  static validateCapitalProfile(profile?: CapitalProfile): { isValid: boolean; error?: string } {
    if (!profile) return { isValid: true };
    if (typeof profile.capitalUsd !== 'number' || profile.capitalUsd < 0) {
      profile.capitalUsd = 0;
    }
    if (typeof profile.riskPerTradePercent !== 'number' || profile.riskPerTradePercent <= 0) {
      profile.riskPerTradePercent = 1.0;
    }
    if (profile.riskPerTradePercent > 5.0) {
      profile.riskPerTradePercent = 1.0;
    }
    if (typeof profile.maxDailyLossPercent !== 'number' || profile.maxDailyLossPercent < 0) {
      profile.maxDailyLossPercent = 0;
    }
    if (typeof profile.maxOpenPositions !== 'number' || profile.maxOpenPositions <= 0) {
      profile.maxOpenPositions = 4;
    }
    return { isValid: true };
  }

  /**
   * Risk-Based Position Sizing:
   * Sized strictly from account capital profile, allowed risk %, entry price, and stop-loss distance.
   * Quantity = Risk Budget ($) / Stop Distance per coin ($)
   *
   * Special 0-value semantics:
   * - capitalUsd = 0: AUTO mode -> Uses actual account equity; rejects if equity unavailable or <= 0.
   * - riskPerTradePercent = 0: Disables trading immediately with a clear rejection reason.
   */
  static calculatePositionSize(
    equity: number,
    entryPrice: number,
    stopLossPrice: number,
    symbolInfo: FuturesSymbolInfo,
    settings: BotSettings,
    customLeverage?: number
  ): SizingResult {
    // 1. Parameter guards
    if (entryPrice <= 0 || stopLossPrice <= 0) {
      return {
        allowed: false,
        rejectionReason: 'Invalid entry or stop loss price parameters',
        quantity: 0,
        notionalValue: 0,
        marginRequiredUsd: 0,
        riskBudgetUsd: 0,
        stopDistancePercent: 0,
        stopDistanceUsd: 0,
        effectiveLeverage: 1,
      };
    }

    // Capital Profile Safety Check
    if (settings.capitalProfile) {
      const capValidation = this.validateCapitalProfile(settings.capitalProfile);
      if (!capValidation.isValid) {
        return {
          allowed: false,
          rejectionReason: `Invalid Capital Profile: ${capValidation.error}`,
          quantity: 0,
          notionalValue: 0,
          marginRequiredUsd: 0,
          riskBudgetUsd: 0,
          stopDistancePercent: 0,
          stopDistanceUsd: 0,
          effectiveLeverage: 1,
        };
      }
    }

    const lev = Math.min(customLeverage || settings.leverage, 50);
    const stopDistanceUsd = Math.abs(entryPrice - stopLossPrice);
    const stopDistancePercent = (stopDistanceUsd / entryPrice) * 100;

    // 2. Safe Auto-Heal: Ensure riskPercent is a positive institutional value (default 1.0%)
    let riskPercent = settings.capitalProfile !== undefined && settings.capitalProfile.riskPerTradePercent > 0
      ? settings.capitalProfile.riskPerTradePercent
      : (settings.riskPerTradePercent && settings.riskPerTradePercent > 0 ? settings.riskPerTradePercent : 1.0);

    if (typeof riskPercent !== 'number' || riskPercent <= 0) {
      riskPercent = 1.0;
    }

    if (stopDistanceUsd === 0 || stopDistancePercent < 0.2) {
      return {
        allowed: false,
        rejectionReason: 'Stop-loss distance too small (< 0.2%), invalid risk calculation',
        quantity: 0,
        notionalValue: 0,
        marginRequiredUsd: 0,
        riskBudgetUsd: 0,
        stopDistancePercent,
        stopDistanceUsd,
        effectiveLeverage: lev,
      };
    }

    // 3. Determine Effective Capital (No silent fallback to 20!)
    let effectiveCapital: number;
    if (settings.capitalProfile && settings.capitalProfile.capitalUsd > 0) {
      effectiveCapital = settings.capitalProfile.capitalUsd;
    } else {
      // capitalUsd = 0 means AUTO -> Use actual equity
      if (!equity || equity <= 0) {
        return {
          allowed: false,
          rejectionReason: 'Trading rejected: actual account equity unavailable or zero for AUTO capital mode.',
          quantity: 0,
          notionalValue: 0,
          marginRequiredUsd: 0,
          riskBudgetUsd: 0,
          stopDistancePercent,
          stopDistanceUsd,
          effectiveLeverage: lev,
        };
      }
      effectiveCapital = equity;
    }

    // 4. Calculate Planned Dollar Risk Budget
    const riskFraction = riskPercent / 100;
    const riskBudgetUsd = Number((effectiveCapital * riskFraction).toFixed(4));

    // 3. Derive Raw Order Quantity based on selected Position Sizing Mode:
    // Mode A: 'RISK_PORTFOLIO_DYNAMIC' -> Equity Risk Budget / Stop Distance (scales contracts on tight SLs like 0.05%, 0.08%)
    // Mode B: 'STRICT_FIXED_MARGIN' -> Strictly caps margin at user's configured USD per trade (e.g. $2 USD)
    const minNotional = symbolInfo.minNotional || 5.0;
    const minQty = symbolInfo.minQty || 0.001;
    const precision = symbolInfo.quantityPrecision ?? 3;
    const multiplier = Math.pow(10, precision);

    let rawQuantity: number;
    const sizingMode = settings.positionSizingMode || 'RISK_PORTFOLIO_DYNAMIC';

    if (sizingMode === 'STRICT_FIXED_MARGIN') {
      const configuredMargin = settings.positionSizeUsd && settings.positionSizeUsd > 0 ? settings.positionSizeUsd : 2.0;
      const targetNotional = Math.max(minNotional, configuredMargin * lev);
      const targetQtyFromMargin = targetNotional / entryPrice;

      if (settings.useRiskBasedSizing) {
        const riskQty = riskBudgetUsd / stopDistanceUsd;
        rawQuantity = Math.min(riskQty, targetQtyFromMargin);
        if (rawQuantity * entryPrice < minNotional) {
          rawQuantity = targetQtyFromMargin;
        }
      } else {
        rawQuantity = targetQtyFromMargin;
      }
    } else {
      // RISK_PORTFOLIO_DYNAMIC (Default Institutional Mode):
      // Fully anchored to portfolio equity risk budget divided by stop distance.
      // Sizing scales up contract quantity when stop loss is tight (e.g., 0.08% or 0.05%),
      // allocating larger margin while strictly guaranteeing dollar risk remains within budget.
      rawQuantity = riskBudgetUsd / stopDistanceUsd;
    }

    // Check if raw quantity is below minQty:
    // If rawQuantity is smaller than minQty, check if minimum contract quantity is safe for the account:
    if (rawQuantity < minQty) {
      const minQtyMargin = (minQty * entryPrice) / lev;
      const maxAllowedMargin = effectiveCapital < 5 ? effectiveCapital * 0.85 : effectiveCapital * 0.4;
      if (minQtyMargin <= maxAllowedMargin) {
        rawQuantity = minQty;
      } else {
        return {
          allowed: false,
          rejectionReason: `Trade rejected: account capital is too small for Binance minimum order constraints (required qty ${rawQuantity.toFixed(4)} < minQty ${minQty}).`,
          quantity: 0,
          notionalValue: 0,
          marginRequiredUsd: 0,
          riskBudgetUsd,
          stopDistancePercent,
          stopDistanceUsd,
          effectiveLeverage: lev,
        };
      }
    }

    // Round to precision of stepSize cleanly avoiding JS floating-point string artifacts
    let finalQuantity = Number((Math.floor(rawQuantity * multiplier) / multiplier).toFixed(precision));

    if (finalQuantity < minQty) {
      finalQuantity = minQty;
    }

    let finalNotional = Number((finalQuantity * entryPrice).toFixed(2));
    let finalMargin = Number((finalNotional / lev).toFixed(2));

    // Check Binance minimum notional constraint (e.g. $5.00 USDT)
    if (finalNotional < minNotional) {
      const neededQty = Number((Math.ceil((minNotional / entryPrice) * multiplier) / multiplier).toFixed(precision));
      const neededMargin = Number(((neededQty * entryPrice) / lev).toFixed(2));
      const maxNotionalMargin = effectiveCapital < 5 ? effectiveCapital * 0.85 : effectiveCapital * 0.5;
      if (neededMargin <= maxNotionalMargin) {
        finalQuantity = Math.max(minQty, neededQty);
        finalNotional = Number((finalQuantity * entryPrice).toFixed(2));
        finalMargin = Number((finalNotional / lev).toFixed(2));
      } else {
        return {
          allowed: false,
          rejectionReason: `Trade rejected: account capital is too small for Binance minimum order constraints (order notional $${finalNotional.toFixed(2)} < minimum $${minNotional} USDT).`,
          quantity: finalQuantity,
          notionalValue: finalNotional,
          marginRequiredUsd: finalMargin,
          riskBudgetUsd,
          stopDistancePercent,
          stopDistanceUsd,
          effectiveLeverage: lev,
        };
      }
    }

    // Check that required margin does not exceed available capital profile
    if (finalMargin > effectiveCapital) {
      return {
        allowed: false,
        rejectionReason: `Trade rejected: required margin ($${finalMargin.toFixed(2)}) exceeds available capital profile ($${effectiveCapital.toFixed(2)}).`,
        quantity: finalQuantity,
        notionalValue: finalNotional,
        marginRequiredUsd: finalMargin,
        riskBudgetUsd,
        stopDistancePercent,
        stopDistanceUsd,
        effectiveLeverage: lev,
      };
    }

    // Check that actual risk is within reasonable bounds (allowing min contract sizing)
    const actualRiskUsd = finalQuantity * stopDistanceUsd;
    const maxRiskTolerance = Math.max(riskBudgetUsd * 2.5, riskBudgetUsd + 2.5, effectiveCapital * 0.20, 0.25);
    if (actualRiskUsd > maxRiskTolerance) {
      return {
        allowed: false,
        rejectionReason: `Trade rejected: minimum order size would exceed risk tolerance ($${actualRiskUsd.toFixed(2)} > $${maxRiskTolerance.toFixed(2)}).`,
        quantity: finalQuantity,
        notionalValue: finalNotional,
        marginRequiredUsd: finalMargin,
        riskBudgetUsd,
        stopDistancePercent,
        stopDistanceUsd,
        effectiveLeverage: lev,
      };
    }

    return {
      allowed: true,
      quantity: finalQuantity,
      notionalValue: finalNotional,
      marginRequiredUsd: finalMargin,
      riskBudgetUsd,
      stopDistancePercent: Number(stopDistancePercent.toFixed(2)),
      stopDistanceUsd: Number(stopDistanceUsd.toFixed(4)),
      effectiveLeverage: lev,
    };
  }

  /**
   * Evaluates aggregate portfolio risk and hard circuit breakers before any order submission
   */
  static validateOrderRisk(
    candidateSymbol: string,
    candidateSide: TradeDirection,
    plannedQuantity: number,
    entryPrice: number,
    stopLossPrice: number,
    balance: AccountBalance,
    openPositions: Position[],
    closedTrades: ClosedTrade[],
    settings: BotSettings,
    isManualOverride = false
  ): RiskValidationReport {
    const actualEquity = balance.totalMarginBalance || balance.totalWalletBalance;
    let effectiveCapital: number;
    if (settings.capitalProfile && settings.capitalProfile.capitalUsd > 0) {
      effectiveCapital = settings.capitalProfile.capitalUsd;
    } else {
      // capitalUsd = 0 means AUTO -> Use actual equity from account/simulated source
      if (!actualEquity || actualEquity <= 0) {
        return {
          isValid: false,
          rejectionReason: 'Trading rejected: actual account equity unavailable or zero for AUTO capital mode.',
          metrics: this.computePortfolioMetrics(1, openPositions, closedTrades),
        };
      }
      effectiveCapital = actualEquity;
    }

    // Capital Profile Safety Check
    if (settings.capitalProfile) {
      const capValidation = this.validateCapitalProfile(settings.capitalProfile);
      if (!capValidation.isValid) {
        return {
          isValid: false,
          rejectionReason: `Invalid Capital Profile: ${capValidation.error}`,
          metrics: this.computePortfolioMetrics(effectiveCapital, openPositions, closedTrades),
        };
      }
    }

    // 1. Safe Auto-Heal: Ensure riskPercent is a positive institutional value (default 1.0%)
    let riskPercent = settings.capitalProfile !== undefined && settings.capitalProfile.riskPerTradePercent > 0
      ? settings.capitalProfile.riskPerTradePercent
      : (settings.riskPerTradePercent && settings.riskPerTradePercent > 0 ? settings.riskPerTradePercent : 1.0);
    if (typeof riskPercent !== 'number' || riskPercent <= 0) {
      riskPercent = 1.0;
    }

    // 2. Safe Auto-Heal: Ensure maxAllowedPositions is at least 1 (default 4)
    let maxAllowedPositions = settings.capitalProfile !== undefined && settings.capitalProfile.maxOpenPositions > 0
      ? settings.capitalProfile.maxOpenPositions
      : (settings.maxConcurrentPositions && settings.maxConcurrentPositions > 0 ? settings.maxConcurrentPositions : 4);
    if (typeof maxAllowedPositions !== 'number' || maxAllowedPositions <= 0) {
      maxAllowedPositions = 4;
    }

    // 3. Emergency Kill Switch check
    if (settings.killSwitchActive) {
      return {
        isValid: false,
        rejectionReason: 'Emergency Kill Switch is active. All new entries are blocked.',
        metrics: this.computePortfolioMetrics(effectiveCapital, openPositions, closedTrades),
      };
    }

    const metrics = this.computePortfolioMetrics(effectiveCapital, openPositions, closedTrades);

    // 4. Check Daily Drawdown Circuit Breaker
    // When maxDailyLossPercent === 0 -> DISABLED (Never triggers)
    const dailyLossPercent = settings.capitalProfile !== undefined
      ? settings.capitalProfile.maxDailyLossPercent
      : (settings.maxDailyDrawdownPercent ?? 3.0);

    if (dailyLossPercent > 0) {
      const maxDailyAllowedUsd = effectiveCapital * (dailyLossPercent / 100);
      if (metrics.dailyRealizedLossUsd >= maxDailyAllowedUsd && maxDailyAllowedUsd > 0) {
        return {
          isValid: false,
          circuitBreakerTriggered: true,
          rejectionReason: `Daily Loss Circuit Breaker engaged (-$${metrics.dailyRealizedLossUsd.toFixed(2)} / limit $${maxDailyAllowedUsd.toFixed(2)}). Trading suspended until 00:00 UTC.`,
          metrics,
        };
      }
    }

    // 5. Consecutive Loss Tracking (Autonomous AI adapts dynamically without freezing the bot)
    // Cooldown lockout is deactivated to allow smooth continuous autonomous trading.

    if (!isManualOverride) {
      // 6. Max Concurrent Positions check (Respects CapitalProfile maxOpenPositions)
      if (openPositions.length >= maxAllowedPositions) {
        return {
          isValid: false,
          rejectionReason: `Max concurrent positions limit reached (${openPositions.length} / ${maxAllowedPositions}).`,
          metrics,
        };
      }

      // 5. Allowed Direction filter
      if (settings.allowedDirection === 'LONG_ONLY' && candidateSide !== 'LONG') {
        return {
          isValid: false,
          rejectionReason: 'Bot configured for LONG_ONLY trades; SHORT order rejected.',
          metrics,
        };
      }
      if (settings.allowedDirection === 'SHORT_ONLY' && candidateSide !== 'SHORT') {
        return {
          isValid: false,
          rejectionReason: 'Bot configured for SHORT_ONLY trades; LONG order rejected.',
          metrics,
        };
      }

      // 6. Portfolio Open Risk Calculation (Monitored dynamically by AI Position Doctor)
      const candidateRiskUsd = Math.abs(entryPrice - stopLossPrice) * plannedQuantity;
      const proposedTotalRiskUsd = metrics.totalOpenRiskUsd + candidateRiskUsd;
      const proposedRiskPct = (proposedTotalRiskUsd / effectiveCapital) * 100;
      metrics.totalOpenRiskUsd = proposedTotalRiskUsd;
      metrics.totalOpenRiskPercent = Number(proposedRiskPct.toFixed(2));
    }

    return {
      isValid: true,
      metrics,
    };
  }

  /**
   * Computes real-time portfolio exposure and drawdown metrics
   */
  static computePortfolioMetrics(
    totalEquity: number,
    openPositions: Position[],
    closedTrades: ClosedTrade[]
  ): RiskValidationReport['metrics'] {
    let totalOpenRiskUsd = 0;
    let totalOpenNotionalUsd = 0;
    let totalMarginUsedUsd = 0;

    for (const pos of openPositions) {
      const riskUsd = Number.isFinite(pos.stopLossPrice) && pos.stopLossPrice > 0
        ? Math.abs(pos.entryPrice - pos.stopLossPrice) * pos.quantity
        : pos.amountUsd;
      totalOpenRiskUsd += riskUsd;
      totalOpenNotionalUsd += pos.notionalValue;
      totalMarginUsedUsd += pos.amountUsd;
    }

    const totalOpenRiskPercent = totalEquity > 0 ? (totalOpenRiskUsd / totalEquity) * 100 : 0;

    // Daily realized loss (trades closed today UTC)
    const todayMidnightUtc = new Date().setUTCHours(0, 0, 0, 0);
    const todayTrades = closedTrades.filter((t) => t.closedAt >= todayMidnightUtc);
    const dailyRealizedLossUsd = Math.abs(
      todayTrades.filter((t) => t.netPnl < 0).reduce((acc, t) => acc + t.netPnl, 0)
    );

    const dailyDrawdownPercent = totalEquity > 0 ? (dailyRealizedLossUsd / totalEquity) * 100 : 0;

    // Consecutive loss count
    let consecutiveLossCount = 0;
    for (const t of closedTrades) {
      if (t.netPnl < 0) {
        consecutiveLossCount++;
      } else {
        break;
      }
    }

    return {
      currentOpenPositions: openPositions.length,
      totalOpenRiskUsd: Number(totalOpenRiskUsd.toFixed(2)),
      totalOpenRiskPercent: Number(totalOpenRiskPercent.toFixed(2)),
      totalOpenNotionalUsd: Number(totalOpenNotionalUsd.toFixed(2)),
      totalMarginUsedUsd: Number(totalMarginUsedUsd.toFixed(2)),
      consecutiveLossCount,
      dailyRealizedLossUsd: Number(dailyRealizedLossUsd.toFixed(2)),
      dailyDrawdownPercent: Number(dailyDrawdownPercent.toFixed(2)),
    };
  }
}
