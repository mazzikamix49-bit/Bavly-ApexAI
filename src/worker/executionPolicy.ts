import {
  TradeDirection,
  Position,
  CapitalProfile,
} from '../types/trading';
import { ExecutionPlan } from './testnetExecutionBridge';

/**
 * Execution Policy Specifications & Types
 */

export interface PriceDriftPolicy {
  configured: boolean;
  maxEntryPriceDriftPercent: number | null;
  behaviorOnBreach: 'REQUIRE_REBUILD_PLAN';
}

export interface EquityDriftPolicy {
  configured: boolean;
  maxEquityDriftPercent: number | null;
  behaviorOnBreach: 'REBUILD_EXECUTION_PLAN_REQUIRED';
}

export interface RiskPolicy {
  configured: boolean;
  allowMarginProxyAsRisk: boolean;
  maxRiskPerTradePercent: number | null;
}

export interface PlanFreshnessPolicy {
  /** Maximum allowable plan age in milliseconds (e.g. 60_000 ms = 60 seconds) */
  maxPlanAgeMs: number;
}

export interface ExecutionPolicyConfig {
  priceDriftPolicy: PriceDriftPolicy;
  equityDriftPolicy: EquityDriftPolicy;
  riskPolicy: RiskPolicy;
  freshnessPolicy: PlanFreshnessPolicy;
}

/**
 * SAFE CENTRALIZED CONFIGURATION:
 * - priceDriftPolicy.configured = true (0.5% conservative default for Testnet)
 * - equityDriftPolicy.configured = true (5.0% max equity deviation)
 * - riskPolicy.configured = true (strictly SL-based risk, allowMarginProxyAsRisk=false)
 * - freshnessPolicy: 60,000 milliseconds = 60 seconds (1 minute max freshness)
 */
export const DEFAULT_EXECUTION_POLICY_CONFIG: ExecutionPolicyConfig = {
  priceDriftPolicy: {
    configured: true,
    maxEntryPriceDriftPercent: 0.5, // 0.5% conservative default for Testnet
    behaviorOnBreach: 'REQUIRE_REBUILD_PLAN',
  },
  equityDriftPolicy: {
    configured: true,
    maxEquityDriftPercent: 5.0, // 5.0% max allowable equity drift
    behaviorOnBreach: 'REBUILD_EXECUTION_PLAN_REQUIRED',
  },
  riskPolicy: {
    configured: true,
    allowMarginProxyAsRisk: false, // Strictly false: margin proxy can NEVER authorize trades
    maxRiskPerTradePercent: null, // Strictly null: derived from CapitalProfile (NO hardcoded static percentage)
  },
  freshnessPolicy: {
    maxPlanAgeMs: 60_000, // 60,000 milliseconds = 60 seconds (1 minute)
  },
};

export type ExecutionPolicyCode =
  | 'POLICY_APPROVED'
  | 'EXECUTION_BLOCKED_PRICE_DRIFT_POLICY_UNDEFINED'
  | 'REQUIRE_REBUILD_PLAN'
  | 'EXECUTION_BLOCKED_PRICE_DRIFT'
  | 'EXECUTION_BLOCKED_PRICE_UNAVAILABLE'
  | 'EXECUTION_BLOCKED_INVALID_PRICE'
  | 'EXECUTION_BLOCKED_EQUITY_POLICY_UNDEFINED'
  | 'EXECUTION_BLOCKED_EQUITY_UNAVAILABLE'
  | 'REBUILD_EXECUTION_PLAN_REQUIRED'
  | 'BLOCK_NEW_ENTRY_EXISTING_POSITION'
  | 'EXECUTION_BLOCKED_MISSING_PROTECTIVE_ORDER'
  | 'EXECUTION_BLOCKED_UNRELIABLE_RISK'
  | 'EXECUTION_BLOCKED_RISK_UNKNOWN'
  | 'EXECUTION_BLOCKED_NO_TRADING'
  | 'EXECUTION_BLOCKED_RISK_POLICY_UNDEFINED'
  | 'EXECUTION_BLOCKED_RISK_LIMIT_EXCEEDED';

export interface CalculatedSLRisk {
  valid: boolean;
  riskUsd: number;
  reason?: string;
}

/**
 * Calculates theoretical trade risk strictly from entry price, stop loss price, and quantity.
 * Rejects non-positive, non-finite (NaN, Infinity), and invalid stop loss directions.
 *
 * LONG:  risk = (entryPrice - stopLossPrice) * quantity
 * SHORT: risk = (stopLossPrice - entryPrice) * quantity
 */
export function calculateSLRisk(
  entryPrice: number,
  stopLossPrice: number,
  quantity: number,
  side: TradeDirection
): CalculatedSLRisk {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { valid: false, riskUsd: 0, reason: `Invalid entry price: ${entryPrice}` };
  }
  if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) {
    return { valid: false, riskUsd: 0, reason: `Invalid stop-loss price: ${stopLossPrice}` };
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { valid: false, riskUsd: 0, reason: `Invalid quantity: ${quantity}` };
  }
  if (side === 'LONG') {
    if (stopLossPrice >= entryPrice) {
      return {
        valid: false,
        riskUsd: 0,
        reason: `Invalid SL direction for LONG: stopLoss (${stopLossPrice}) >= entry (${entryPrice})`,
      };
    }
    const risk = (entryPrice - stopLossPrice) * quantity;
    if (!Number.isFinite(risk) || risk <= 0) {
      return { valid: false, riskUsd: 0, reason: `Calculated risk is non-positive or non-finite: ${risk}` };
    }
    return { valid: true, riskUsd: Number(risk.toFixed(4)) };
  } else if (side === 'SHORT') {
    if (stopLossPrice <= entryPrice) {
      return {
        valid: false,
        riskUsd: 0,
        reason: `Invalid SL direction for SHORT: stopLoss (${stopLossPrice}) <= entry (${entryPrice})`,
      };
    }
    const risk = (stopLossPrice - entryPrice) * quantity;
    if (!Number.isFinite(risk) || risk <= 0) {
      return { valid: false, riskUsd: 0, reason: `Calculated risk is non-positive or non-finite: ${risk}` };
    }
    return { valid: true, riskUsd: Number(risk.toFixed(4)) };
  }
  return { valid: false, riskUsd: 0, reason: `Invalid trade side: ${side}` };
}

export type RiskSource = 'SL_BASED' | 'MARGIN_PROXY' | 'UNKNOWN';

export interface RiskAssessment {
  riskSource: RiskSource;
  plannedRiskUsd: number;
  riskPercent: number;
  maxAllowedRiskUsd: number;
  isReliable: boolean;
  reason: string;
}

export interface ExecutionPolicyResult {
  allowed: boolean;
  code: ExecutionPolicyCode;
  reason: string;
  priceDriftPercent?: number;
  equityDriftPercent?: number;
  riskAssessment: RiskAssessment;
  checkedAt: number;
  details?: Record<string, unknown>;
}

export interface ExecutionPolicyContext {
  currentPrice?: number | null;
  currentEquity?: number | null;
  openPositions?: Position[] | Array<{ symbol: string; side: TradeDirection }>;
  capitalProfile?: CapitalProfile | null;
  now?: number;
  overrides?: Partial<ExecutionPolicyConfig>;
}

/**
 * ExecutionPolicyLayer
 *
 * Implements strict, typed, policy evaluations prior to any order execution.
 * Completely decoupled from transport layers and network dispatchers.
 */
export class ExecutionPolicyLayer {
  private config: ExecutionPolicyConfig;

  constructor(config?: Partial<ExecutionPolicyConfig>) {
    this.config = {
      priceDriftPolicy: {
        ...DEFAULT_EXECUTION_POLICY_CONFIG.priceDriftPolicy,
        ...(config?.priceDriftPolicy || {}),
      },
      equityDriftPolicy: {
        ...DEFAULT_EXECUTION_POLICY_CONFIG.equityDriftPolicy,
        ...(config?.equityDriftPolicy || {}),
      },
      riskPolicy: {
        ...DEFAULT_EXECUTION_POLICY_CONFIG.riskPolicy,
        ...(config?.riskPolicy || {}),
      },
      freshnessPolicy: {
        ...DEFAULT_EXECUTION_POLICY_CONFIG.freshnessPolicy,
        ...(config?.freshnessPolicy || {}),
      },
    };
  }

  public getConfig(): ExecutionPolicyConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  public updateConfig(patch: Partial<ExecutionPolicyConfig>): void {
    if (patch.priceDriftPolicy) {
      this.config.priceDriftPolicy = { ...this.config.priceDriftPolicy, ...patch.priceDriftPolicy };
    }
    if (patch.equityDriftPolicy) {
      this.config.equityDriftPolicy = { ...this.config.equityDriftPolicy, ...patch.equityDriftPolicy };
    }
    if (patch.riskPolicy) {
      this.config.riskPolicy = { ...this.config.riskPolicy, ...patch.riskPolicy };
    }
    if (patch.freshnessPolicy) {
      this.config.freshnessPolicy = { ...this.config.freshnessPolicy, ...patch.freshnessPolicy };
    }
  }

  /**
   * Assesses the risk of an ExecutionPlan or position strictly from Stop-Loss distance.
   *
   * STRICT SAFETY INVARIANT:
   * SL-based risk is mandatory for all new entries.
   * Margin proxy is NEVER permitted to authorize trades or substitute for maximum loss.
   */
  public assessRisk(plan: ExecutionPlan, _riskPolicy?: RiskPolicy): RiskAssessment {
    const slResult = calculateSLRisk(plan.entryPrice, plan.stopLossPrice, plan.quantity, plan.side);

    if (slResult.valid) {
      return {
        riskSource: 'SL_BASED',
        plannedRiskUsd: slResult.riskUsd,
        riskPercent: plan.riskPercent,
        maxAllowedRiskUsd: slResult.riskUsd,
        isReliable: true,
        reason: `Stop-loss order defined at ${plan.stopLossPrice} with strictly bounded downside loss ($${slResult.riskUsd}).`,
      };
    }

    // STRICT INVARIANT: Margin proxy is NEVER permitted to authorize trades!
    // Stored for monitoring/reporting only, never as a silent substitute for maximum loss.
    return {
      riskSource: 'UNKNOWN',
      plannedRiskUsd: 0,
      riskPercent: plan.riskPercent,
      maxAllowedRiskUsd: 0,
      isReliable: false,
      reason: slResult.reason || 'No valid stop-loss defined. Risk is indeterminate.',
    };
  }

  /**
   * Evaluates an ExecutionPlan against all active execution policies.
   */
  public evaluate(plan: ExecutionPlan, ctx: ExecutionPolicyContext): ExecutionPolicyResult {
    const now = ctx.now || Date.now();
    const effectiveConfig: ExecutionPolicyConfig = {
      priceDriftPolicy: { ...this.config.priceDriftPolicy, ...(ctx.overrides?.priceDriftPolicy || {}) },
      equityDriftPolicy: { ...this.config.equityDriftPolicy, ...(ctx.overrides?.equityDriftPolicy || {}) },
      riskPolicy: { ...this.config.riskPolicy, ...(ctx.overrides?.riskPolicy || {}) },
      freshnessPolicy: { ...this.config.freshnessPolicy, ...(ctx.overrides?.freshnessPolicy || {}) },
    };

    // 1. Entry Price Validation
    if (!Number.isFinite(plan.entryPrice) || plan.entryPrice <= 0) {
      return {
        allowed: false,
        code: 'EXECUTION_BLOCKED_INVALID_PRICE',
        reason: `Planned entry price is invalid or zero (${plan.entryPrice}).`,
        riskAssessment: this.assessRisk(plan, effectiveConfig.riskPolicy),
        checkedAt: now,
      };
    }

    // 2. Plan Freshness Policy (milliseconds: 60,000 ms = 60 seconds)
    const planAgeMs = now - (plan.createdAt || now);
    if (planAgeMs > effectiveConfig.freshnessPolicy.maxPlanAgeMs) {
      return {
        allowed: false,
        code: 'REBUILD_EXECUTION_PLAN_REQUIRED',
        reason: `ExecutionPlan is stale (age: ${(planAgeMs / 1000).toFixed(1)}s, max allowable freshness: ${(effectiveConfig.freshnessPolicy.maxPlanAgeMs / 1000).toFixed(1)}s). Plan must be rebuilt.`,
        riskAssessment: this.assessRisk(plan, effectiveConfig.riskPolicy),
        checkedAt: now,
        details: { planAgeMs, maxPlanAgeMs: effectiveConfig.freshnessPolicy.maxPlanAgeMs },
      };
    }

    // 3. Adopted & Existing Position Protection (Block duplicate position on same symbol)
    if (ctx.openPositions && Array.isArray(ctx.openPositions)) {
      const duplicate = ctx.openPositions.some(
        (p: any) => p && p.symbol && p.symbol.toUpperCase() === plan.symbol.toUpperCase() && (typeof p.quantity === 'number' ? p.quantity > 0 : true)
      );
      if (duplicate) {
        return {
          allowed: false,
          code: 'BLOCK_NEW_ENTRY_EXISTING_POSITION',
          reason: `Position already exists for ${plan.symbol}. Opening duplicate position is strictly blocked.`,
          riskAssessment: this.assessRisk(plan, effectiveConfig.riskPolicy),
          checkedAt: now,
          details: { symbol: plan.symbol, side: plan.side },
        };
      }
    }

    // 4. Protective Orders Integrity (Stop Loss & Take Profit)
    const stopOrder = plan.stopLossOrder;
    const expectedStopSide = plan.side === 'LONG' ? 'SELL' : 'BUY';
    const isStopValid =
      Boolean(stopOrder) &&
      Number.isFinite(stopOrder.stopPrice) &&
      (stopOrder.stopPrice as number) > 0 &&
      stopOrder.stopPrice !== plan.entryPrice &&
      stopOrder.side === expectedStopSide &&
      stopOrder.reduceOnly === true &&
      stopOrder.symbol.toUpperCase() === plan.symbol.toUpperCase() &&
      Math.abs(stopOrder.quantity - plan.quantity) < 1e-8 &&
      (plan.side === 'LONG' ? (stopOrder.stopPrice as number) < plan.entryPrice : (stopOrder.stopPrice as number) > plan.entryPrice);

    if (!isStopValid) {
      return {
        allowed: false,
        code: 'EXECUTION_BLOCKED_MISSING_PROTECTIVE_ORDER',
        reason: 'Execution requires a valid, pre-specified protective stop loss order with matching quantity, correct opposite side, correct direction, and reduceOnly=true.',
        riskAssessment: this.assessRisk(plan, effectiveConfig.riskPolicy),
        checkedAt: now,
        details: {
          stopOrderPresent: Boolean(stopOrder),
          stopPrice: stopOrder?.stopPrice,
          expectedSide: expectedStopSide,
          actualSide: stopOrder?.side,
          reduceOnly: stopOrder?.reduceOnly,
        },
      };
    }

    // Validate TP if specified in plan
    const tpOrder = plan.takeProfitOrder;
    if (tpOrder) {
      const expectedTpSide = expectedStopSide;
      const isTpValid =
        Number.isFinite(tpOrder.stopPrice) &&
        (tpOrder.stopPrice as number) > 0 &&
        tpOrder.stopPrice !== plan.entryPrice &&
        tpOrder.side === expectedTpSide &&
        tpOrder.reduceOnly === true &&
        tpOrder.symbol.toUpperCase() === plan.symbol.toUpperCase() &&
        Math.abs(tpOrder.quantity - plan.quantity) < 1e-8 &&
        (plan.side === 'LONG' ? (tpOrder.stopPrice as number) > plan.entryPrice : (tpOrder.stopPrice as number) < plan.entryPrice);

      if (!isTpValid) {
        return {
          allowed: false,
          code: 'EXECUTION_BLOCKED_MISSING_PROTECTIVE_ORDER',
          reason: 'Take-profit order in ExecutionPlan is invalid: must have matching quantity, correct opposite side, correct target direction, and reduceOnly=true.',
          riskAssessment: this.assessRisk(plan, effectiveConfig.riskPolicy),
          checkedAt: now,
          details: {
            tpPrice: tpOrder.stopPrice,
            expectedSide: expectedTpSide,
            actualSide: tpOrder.side,
            reduceOnly: tpOrder.reduceOnly,
          },
        };
      }
    }

    // 5. Risk Assessment Policy (Strictly SL-based; Margin proxy cannot authorize entry)
    const riskAssessment = this.assessRisk(plan, effectiveConfig.riskPolicy);
    if (!riskAssessment.isReliable || riskAssessment.riskSource === 'UNKNOWN') {
      return {
        allowed: false,
        code: 'EXECUTION_BLOCKED_RISK_UNKNOWN',
        reason: `Risk assessment failed (SL-based risk required): ${riskAssessment.reason}`,
        riskAssessment,
        checkedAt: now,
      };
    }

    // Link Risk Policy to CapitalProfile (riskPerTradePercent)
    let allowedMaxRiskPercent: number | null = null;
    if (ctx.capitalProfile) {
      if (typeof ctx.capitalProfile.riskPerTradePercent === 'number') {
        if (ctx.capitalProfile.riskPerTradePercent === 0) {
          return {
            allowed: false,
            code: 'EXECUTION_BLOCKED_NO_TRADING',
            reason: 'CapitalProfile riskPerTradePercent is 0. Trading is strictly disabled (NO_TRADING).',
            riskAssessment,
            checkedAt: now,
          };
        }
        allowedMaxRiskPercent = ctx.capitalProfile.riskPerTradePercent;
      }
    } else if (effectiveConfig.riskPolicy.configured && effectiveConfig.riskPolicy.maxRiskPerTradePercent !== null) {
      allowedMaxRiskPercent = effectiveConfig.riskPolicy.maxRiskPerTradePercent;
    }

    if (allowedMaxRiskPercent !== null) {
      // Check both dollar amount limit against equity and percentage limit
      if (ctx.currentEquity && ctx.currentEquity > 0) {
        const allowedMaxRiskUsd = ctx.currentEquity * (allowedMaxRiskPercent / 100);
        if (riskAssessment.plannedRiskUsd > allowedMaxRiskUsd + 1e-4) {
          return {
            allowed: false,
            code: 'EXECUTION_BLOCKED_RISK_LIMIT_EXCEEDED',
            reason: `Planned SL risk ($${riskAssessment.plannedRiskUsd.toFixed(2)}) exceeds maximum allowable risk budget ($${allowedMaxRiskUsd.toFixed(2)} at ${allowedMaxRiskPercent}% of equity $${ctx.currentEquity.toFixed(2)}).`,
            riskAssessment,
            checkedAt: now,
            details: { plannedRiskUsd: riskAssessment.plannedRiskUsd, allowedMaxRiskUsd, allowedMaxRiskPercent },
          };
        }
      }
      if (plan.riskPercent > allowedMaxRiskPercent + 1e-4) {
        return {
          allowed: false,
          code: 'EXECUTION_BLOCKED_RISK_LIMIT_EXCEEDED',
          reason: `Plan risk percent (${plan.riskPercent}%) exceeds maximum allowable risk limit (${allowedMaxRiskPercent}%).`,
          riskAssessment,
          checkedAt: now,
          details: { planRiskPercent: plan.riskPercent, allowedMaxRiskPercent },
        };
      }
    } else {
      return {
        allowed: false,
        code: 'EXECUTION_BLOCKED_RISK_POLICY_UNDEFINED',
        reason: 'Risk policy is unconfigured and no CapitalProfile risk limit is available. Execution blocked by safe default.',
        riskAssessment,
        checkedAt: now,
      };
    }

    // 6. Centralized Price Drift Policy
    let priceDriftPercent: number | undefined = undefined;
    if (ctx.currentPrice === undefined || ctx.currentPrice === null) {
      return {
        allowed: false,
        code: 'EXECUTION_BLOCKED_PRICE_UNAVAILABLE',
        reason: 'Current market price is unavailable. Execution requires fresh, verified market price.',
        riskAssessment,
        checkedAt: now,
      };
    }

    if (!Number.isFinite(ctx.currentPrice) || ctx.currentPrice <= 0) {
      return {
        allowed: false,
        code: 'EXECUTION_BLOCKED_INVALID_PRICE',
        reason: `Current market price is invalid or non-positive (${ctx.currentPrice}).`,
        riskAssessment,
        checkedAt: now,
      };
    }

    if (!Number.isFinite(plan.entryPrice) || plan.entryPrice <= 0) {
      return {
        allowed: false,
        code: 'EXECUTION_BLOCKED_INVALID_PRICE',
        reason: `Planned entry price is invalid or zero (${plan.entryPrice}).`,
        riskAssessment,
        checkedAt: now,
      };
    }

    priceDriftPercent = Number(((Math.abs(ctx.currentPrice - plan.entryPrice) / plan.entryPrice) * 100).toFixed(4));

    if (!effectiveConfig.priceDriftPolicy.configured) {
      // Safe Blocking Default: If price drifted and policy is not configured, block execution
      if (priceDriftPercent > 0.0001) {
        return {
          allowed: false,
          code: 'EXECUTION_BLOCKED_PRICE_DRIFT_POLICY_UNDEFINED',
          reason: `Price drifted by ${priceDriftPercent}%, but priceDriftPolicy is unconfigured. Execution blocked by safe default.`,
          priceDriftPercent,
          riskAssessment,
          checkedAt: now,
          details: { currentPrice: ctx.currentPrice, plannedEntry: plan.entryPrice, priceDriftPercent },
        };
      }
    } else {
      const maxDrift = effectiveConfig.priceDriftPolicy.maxEntryPriceDriftPercent;
      if (maxDrift !== null && priceDriftPercent > maxDrift) {
        return {
          allowed: false,
          code: 'REQUIRE_REBUILD_PLAN',
          reason: `Price drift (${priceDriftPercent}%) exceeds allowable threshold (${maxDrift}%). Plan must be rebuilt.`,
          priceDriftPercent,
          riskAssessment,
          checkedAt: now,
          details: {
            currentPrice: ctx.currentPrice,
            plannedEntry: plan.entryPrice,
            priceDriftPercent,
            maxDrift,
            aliasCode: 'EXECUTION_BLOCKED_PRICE_DRIFT',
          },
        };
      }
    }

    // 7. Equity Drift Policy
    let equityDriftPercent: number | undefined = undefined;
    if (!effectiveConfig.equityDriftPolicy.configured) {
      return {
        allowed: false,
        code: 'EXECUTION_BLOCKED_EQUITY_POLICY_UNDEFINED',
        reason: 'equityDriftPolicy is unconfigured. Execution blocked by safe default.',
        priceDriftPercent,
        riskAssessment,
        checkedAt: now,
      };
    }

    if (ctx.currentEquity !== undefined) {
      if (ctx.currentEquity === null || !Number.isFinite(ctx.currentEquity) || ctx.currentEquity <= 0) {
        return {
          allowed: false,
          code: 'EXECUTION_BLOCKED_EQUITY_UNAVAILABLE',
          reason: `Current account equity is unavailable or zero (${ctx.currentEquity}).`,
          priceDriftPercent,
          riskAssessment,
          checkedAt: now,
        };
      }

      if (plan.riskAmountUsd > 0 && plan.riskPercent > 0) {
        const plannedCapital = plan.riskAmountUsd / (plan.riskPercent / 100);
        equityDriftPercent = Number((Math.abs(ctx.currentEquity - plannedCapital) / plannedCapital * 100).toFixed(4));
        const maxEquityDrift = effectiveConfig.equityDriftPolicy.maxEquityDriftPercent;

        if (maxEquityDrift !== null && equityDriftPercent > maxEquityDrift) {
          return {
            allowed: false,
            code: 'REBUILD_EXECUTION_PLAN_REQUIRED',
            reason: `Current equity ($${ctx.currentEquity.toFixed(2)}) diverged ${equityDriftPercent.toFixed(1)}% from planned capital ($${plannedCapital.toFixed(2)}). Exceeds limit of ${maxEquityDrift}%. Plan must be rebuilt.`,
            priceDriftPercent,
            equityDriftPercent,
            riskAssessment,
            checkedAt: now,
            details: { currentEquity: ctx.currentEquity, plannedCapital, equityDriftPercent, maxEquityDrift },
          };
        }
      }
    }

    return {
      allowed: true,
      code: 'POLICY_APPROVED',
      reason: 'ExecutionPlan conforms to all Price Drift, Equity Drift, Risk, and Freshness policies.',
      priceDriftPercent,
      equityDriftPercent,
      riskAssessment,
      checkedAt: now,
    };
  }
}

export const executionPolicy = new ExecutionPolicyLayer();
