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
      return { isValid: false, error: 'Capital cannot be negative (0 = AUTO)' };
    }
    if (typeof profile.riskPerTradePercent !== 'number' || profile.riskPerTradePercent < 0) {
      return { isValid: false, error: 'Risk per trade cannot be negative (0 = Disable Trading)' };
    }
    if (profile.riskPerTradePercent > 5.0) {
      return { isValid: false, error: 'Risk per trade cannot exceed configured maximum of 5%' };
    }
    if (typeof profile.maxDailyLossPercent !== 'number' || profile.maxDailyLossPercent < 0) {
      return { isValid: false, error: 'Max daily loss cannot be negative (0 = Disabled)' };
    }
    if (typeof profile.maxOpenPositions !== 'number' || profile.maxOpenPositions < 0) {
      return { isValid: false, error: 'Max open positions cannot be negative (0 = Disable New Positions)' };
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

    // 2. Check riskPerTradePercent === 0 -> NO TRADING
    const riskPercent = settings.capitalProfile !== undefined
      ? settings.capitalProfile.riskPerTradePercent
      : (settings.riskPerTradePercent ?? 1.0);

    if (riskPercent === 0) {
      return {
        allowed: false,
        rejectionReason: 'Trading disabled: risk per trade is 0%.',
        quantity: 0,
        notionalValue: 0,
        marginRequiredUsd: 0,
        riskBudgetUsd: 0,
        stopDistancePercent,
        stopDistanceUsd,
        effectiveLeverage: lev,
      };
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

    // 3. Derive Raw Order Quantity: Quantity = RiskBudget / StopDistance
    const rawQuantity = riskBudgetUsd / stopDistanceUsd;
    const stepSize = symbolInfo.stepSize || 0.001;
    const minQty = symbolInfo.minQty || 0.001;
    const minNotional = symbolInfo.minNotional || 5.0;

    // Check if raw quantity is strictly below Binance minQty constraint:
    // CRITICAL: DO NOT clamp up to minQty as that would dangerously multiply the allowed risk!
    if (rawQuantity < minQty) {
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

    // Round down to precision of stepSize
    const precision = symbolInfo.quantityPrecision ?? 3;
    const multiplier = Math.pow(10, precision);
    const finalQuantity = Math.floor(rawQuantity * multiplier) / multiplier;

    if (finalQuantity < minQty) {
      return {
        allowed: false,
        rejectionReason: `Trade rejected: account capital is too small for Binance minimum order constraints.`,
        quantity: 0,
        notionalValue: 0,
        marginRequiredUsd: 0,
        riskBudgetUsd,
        stopDistancePercent,
        stopDistanceUsd,
        effectiveLeverage: lev,
      };
    }

    const finalNotional = Number((finalQuantity * entryPrice).toFixed(2));
    const finalMargin = Number((finalNotional / lev).toFixed(2));

    // Check Binance minimum notional constraint (e.g. $5.00 USDT)
    if (finalNotional < minNotional) {
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

    // Check that rounding does not allow actual risk to exceed planned risk budget by more than 1%
    const actualRiskUsd = finalQuantity * stopDistanceUsd;
    if (actualRiskUsd > riskBudgetUsd * 1.01) {
      return {
        allowed: false,
        rejectionReason: `Trade rejected: rounding constraints would exceed maximum planned risk ($${actualRiskUsd.toFixed(2)} > $${riskBudgetUsd.toFixed(2)}).`,
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

    // 1. Check riskPerTradePercent === 0 -> NO TRADING
    const riskPercent = settings.capitalProfile !== undefined
      ? settings.capitalProfile.riskPerTradePercent
      : (settings.riskPerTradePercent ?? 1.0);
    if (riskPercent === 0) {
      return {
        isValid: false,
        rejectionReason: 'Trading disabled: risk per trade is 0%.',
        metrics: this.computePortfolioMetrics(effectiveCapital, openPositions, closedTrades),
      };
    }

    // 2. Check maxOpenPositions === 0 -> NO TRADING
    const maxAllowedPositions = settings.capitalProfile !== undefined
      ? settings.capitalProfile.maxOpenPositions
      : (settings.maxConcurrentPositions ?? 2);

    if (maxAllowedPositions === 0) {
      return {
        isValid: false,
        rejectionReason: 'New positions disabled.',
        metrics: this.computePortfolioMetrics(effectiveCapital, openPositions, closedTrades),
      };
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

    // 5. Consecutive Loss Circuit Breaker & Cooldown
    if (settings.maxConsecutiveLosses > 0 && metrics.consecutiveLossCount >= settings.maxConsecutiveLosses) {
      const lastTrade = closedTrades[0];
      const cooldownMs = (settings.lossCooldownMinutes || 30) * 60 * 1000;
      const elapsedSinceLoss = lastTrade ? Date.now() - lastTrade.closedAt : cooldownMs + 1;

      if (elapsedSinceLoss < cooldownMs) {
        const remainingMinutes = Math.ceil((cooldownMs - elapsedSinceLoss) / 60000);
        return {
          isValid: false,
          circuitBreakerTriggered: true,
          rejectionReason: `Consecutive Loss Protection engaged (${metrics.consecutiveLossCount} losses). Cooldown active for ${remainingMinutes} more minutes.`,
          metrics,
        };
      }
    }

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

      // 6. Max Open Risk check across portfolio
      const candidateRiskUsd = Math.abs(entryPrice - stopLossPrice) * plannedQuantity;
      const proposedTotalRiskUsd = metrics.totalOpenRiskUsd + candidateRiskUsd;
      const proposedRiskPct = (proposedTotalRiskUsd / effectiveCapital) * 100;
      const maxAllowedRiskPct = settings.maxOpenRiskPercent || 6.0;

      if (proposedRiskPct > maxAllowedRiskPct) {
        return {
          isValid: false,
          rejectionReason: `Total portfolio open risk (${proposedRiskPct.toFixed(1)}%) would exceed hard safety limit (${maxAllowedRiskPct}% of $${effectiveCapital}).`,
          metrics,
        };
      }
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
