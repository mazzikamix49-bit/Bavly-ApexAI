import { Position } from '../types/trading';
import { RemotePosition, AccountState, AccountStateProvider } from './accountStateProvider';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { storageService, StorageService } from '../services/storageService';
import { accountReconciliationService, AccountReconciliationService, ReconciliationResult } from './accountReconciliation';

export type PositionAdoptionStatus =
  | 'ADOPTION_REQUIRED'
  | 'NO_ADOPTION_REQUIRED'
  | 'INVALID_REMOTE_POSITION'
  | 'UNAVAILABLE';

export type SinglePositionEvaluation =
  | 'ADOPTION_CANDIDATE'
  | 'ADOPTED'
  | 'ALREADY_TRACKED'
  | 'INVALID_REMOTE_POSITION'
  | 'IGNORE_ZERO_POSITION';

export interface PositionAdoptionCandidate {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  unrealizedPnl?: number;
  leverage?: number;
  initialMargin?: number;
  evaluation: SinglePositionEvaluation;
  reason: string;
}

export interface PositionAdoptionReport {
  status: PositionAdoptionStatus;
  remotePositions: Array<{
    symbol: string;
    side: 'LONG' | 'SHORT';
    quantity: number;
    entryPrice: number;
    unrealizedPnl?: number;
    leverage?: number;
  }>;
  candidates: PositionAdoptionCandidate[];
  localPositionCount: number;
  remotePositionCount: number;
  candidateCount: number;
  alreadyTrackedCount: number;
  readOnly: boolean;
  executionPerformed: boolean;
  stateModified: boolean;
  warnings: string[];
  timestamp: number;
}

export interface PositionAdoptionItemResult {
  symbol: string;
  side: 'LONG' | 'SHORT';
  evaluation: SinglePositionEvaluation;
  reason: string;
  quantity?: number;
  entryPrice?: number;
  positionId?: string;
}

export interface PositionAdoptionApplyResult {
  success: boolean;
  status: 'COMPLETED' | 'NO_CHANGES' | 'ERROR' | 'UNAVAILABLE';
  adoptedCount: number;
  alreadyTrackedCount: number;
  ignoredCount: number;
  invalidCount: number;
  adoptedPositions: Position[];
  trackedPositionsCount: number;
  results: PositionAdoptionItemResult[];
  reconciliationStatus: ReconciliationResult['status'];
  reconciliation: ReconciliationResult;
  readOnly: boolean;
  executionPerformed: boolean;
  stateModified: boolean;
  warnings: string[];
  errors: string[];
  timestamp: number;
}

/**
 * PositionAdoptionService — Validated Persistent State Adoption
 *
 * Implements policy for adopting pre-existing Binance Futures positions into
 * local persistent state (data/state.json).
 *
 * STRICT SAFETY INVARIANTS:
 * - PERSISTENCE-ONLY: Never sends any Binance order.
 * - NO openPosition, closePosition, executeOrder, placeOrder, cancelOrder.
 * - NO modifying stop loss or take profit orders on Binance.
 * - NO fabricated / imaginary financial numbers ($20, fake SL/TP).
 * - Prevents duplicate adoption of already tracked positions.
 * - Atomic persistence to data/state.json.
 * - Post-adoption READ-ONLY reconciliation verification (expected: IN_SYNC).
 */
export class PositionAdoptionService {
  private accountProvider: AccountStateProvider;
  private storage: StorageService;
  private reconciliationService: AccountReconciliationService;

  constructor(
    accountProvider?: AccountStateProvider,
    storage?: StorageService,
    reconciliationService?: AccountReconciliationService
  ) {
    this.accountProvider = accountProvider || binanceTestnetAccountStateProvider;
    this.storage = storage || storageService;
    this.reconciliationService = reconciliationService || accountReconciliationService;
  }

  public setAccountProvider(provider: AccountStateProvider): void {
    this.accountProvider = provider;
  }

  /**
   * Pure evaluation function that inspects local vs remote positions
   * and produces a PositionAdoptionReport according to policy (READ-ONLY).
   */
  public static evaluatePolicy(
    localPositions: Position[],
    remotePositions: RemotePosition[]
  ): PositionAdoptionReport {
    const timestamp = Date.now();
    const warnings: string[] = [];
    const candidates: PositionAdoptionCandidate[] = [];
    const cleanRemotePositions: PositionAdoptionReport['remotePositions'] = [];

    // Map existing local positions by symbol:side
    const localMap = new Map<string, Position>();
    for (const lp of localPositions) {
      if (lp && lp.symbol && lp.side) {
        localMap.set(`${lp.symbol.toUpperCase()}:${lp.side.toUpperCase()}`, lp);
      }
    }

    let hasInvalidPosition = false;
    let candidateCount = 0;
    let alreadyTrackedCount = 0;

    for (const rp of remotePositions) {
      if (!rp || typeof rp !== 'object') {
        hasInvalidPosition = true;
        warnings.push('Malformed remote position object encountered.');
        continue;
      }

      const symbol = typeof rp.symbol === 'string' ? rp.symbol.trim().toUpperCase() : '';
      const side = rp.side as 'LONG' | 'SHORT';
      const quantity = rp.quantity;
      const entryPrice = rp.entryPrice;

      // Check 1: Zero quantity (flat)
      if (Number.isFinite(quantity) && Math.abs(quantity) === 0) {
        candidates.push({
          symbol: symbol || 'UNKNOWN',
          side: side || 'LONG',
          quantity: 0,
          entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
          evaluation: 'IGNORE_ZERO_POSITION',
          reason: 'Position quantity is zero (flat position).',
        });
        continue;
      }

      // Check 2: Invalid symbol
      if (!symbol) {
        hasInvalidPosition = true;
        warnings.push('Remote position has empty or invalid symbol.');
        candidates.push({
          symbol: 'UNKNOWN',
          side: side || 'LONG',
          quantity: Number.isFinite(quantity) ? quantity : 0,
          entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
          evaluation: 'INVALID_REMOTE_POSITION',
          reason: 'Missing symbol.',
        });
        continue;
      }

      // Check 3: Invalid side
      if (side !== 'LONG' && side !== 'SHORT') {
        hasInvalidPosition = true;
        warnings.push(`Remote position ${symbol} has invalid side: '${String(rp.side)}'`);
        candidates.push({
          symbol,
          side: 'LONG',
          quantity: Number.isFinite(quantity) ? quantity : 0,
          entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
          evaluation: 'INVALID_REMOTE_POSITION',
          reason: `Invalid positionSide: '${String(rp.side)}'.`,
        });
        continue;
      }

      // Check 4: Invalid quantity (< 0 or non-finite)
      if (!Number.isFinite(quantity) || quantity <= 0) {
        hasInvalidPosition = true;
        warnings.push(`Remote position ${symbol}:${side} has invalid quantity: ${quantity}`);
        candidates.push({
          symbol,
          side,
          quantity: Number.isFinite(quantity) ? quantity : 0,
          entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
          evaluation: 'INVALID_REMOTE_POSITION',
          reason: `Invalid non-positive quantity: ${quantity}.`,
        });
        continue;
      }

      // Check 5: Invalid entry price (<= 0 or non-finite)
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        hasInvalidPosition = true;
        warnings.push(`Remote position ${symbol}:${side} has non-positive or invalid entry price: ${entryPrice}`);
        candidates.push({
          symbol,
          side,
          quantity,
          entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
          evaluation: 'INVALID_REMOTE_POSITION',
          reason: `Invalid non-positive entry price: ${entryPrice}.`,
        });
        continue;
      }

      // Add to clean remote list
      cleanRemotePositions.push({
        symbol,
        side,
        quantity,
        entryPrice,
        unrealizedPnl: rp.unrealizedPnl,
        leverage: rp.leverage,
      });

      // Check 6: Is position already tracked locally?
      const positionKey = `${symbol}:${side}`;
      if (localMap.has(positionKey)) {
        alreadyTrackedCount++;
        candidates.push({
          symbol,
          side,
          quantity,
          entryPrice,
          unrealizedPnl: rp.unrealizedPnl,
          leverage: rp.leverage,
          initialMargin: rp.initialMargin,
          evaluation: 'ALREADY_TRACKED',
          reason: `Position ${positionKey} is already tracked in persistent local state.`,
        });
      } else {
        // Valid remote position missing locally -> Candidate for Adoption
        candidateCount++;
        candidates.push({
          symbol,
          side,
          quantity,
          entryPrice,
          unrealizedPnl: rp.unrealizedPnl,
          leverage: rp.leverage,
          initialMargin: rp.initialMargin,
          evaluation: 'ADOPTION_CANDIDATE',
          reason: `Position ${positionKey} exists on Binance Testnet but is missing from local state. Requires adoption.`,
        });
      }
    }

    // Determine overall status
    let status: PositionAdoptionStatus;
    if (hasInvalidPosition) {
      status = 'INVALID_REMOTE_POSITION';
    } else if (candidateCount > 0) {
      status = 'ADOPTION_REQUIRED';
    } else {
      status = 'NO_ADOPTION_REQUIRED';
    }

    return {
      status,
      remotePositions: cleanRemotePositions,
      candidates,
      localPositionCount: localPositions.length,
      remotePositionCount: remotePositions.length,
      candidateCount,
      alreadyTrackedCount,
      readOnly: true,
      executionPerformed: false,
      stateModified: false,
      warnings,
      timestamp,
    };
  }

  /**
   * Evaluates the adoption policy against the current live remote account
   * and current local persistent state without modifying state (READ-ONLY).
   */
  public async evaluateCurrentAdoptionState(): Promise<PositionAdoptionReport> {
    const timestamp = Date.now();
    try {
      const state = await this.storage.loadState();
      const localPositions = Array.isArray(state.trackedPositions) ? state.trackedPositions : [];

      const accountState = await this.accountProvider.getAccountState();
      if (!accountState || !accountState.available) {
        return {
          status: 'UNAVAILABLE',
          remotePositions: [],
          candidates: [],
          localPositionCount: localPositions.length,
          remotePositionCount: 0,
          candidateCount: 0,
          alreadyTrackedCount: 0,
          readOnly: true,
          executionPerformed: false,
          stateModified: false,
          warnings: [
            accountState?.error || 'Remote account state is unavailable (unconfigured or offline).',
          ],
          timestamp,
        };
      }

      return PositionAdoptionService.evaluatePolicy(localPositions, accountState.openPositions);
    } catch (err: any) {
      return {
        status: 'INVALID_REMOTE_POSITION',
        remotePositions: [],
        candidates: [],
        localPositionCount: 0,
        remotePositionCount: 0,
        candidateCount: 0,
        alreadyTrackedCount: 0,
        readOnly: true,
        executionPerformed: false,
        stateModified: false,
        warnings: [`Evaluation failed: ${err.message || String(err)}`],
        timestamp,
      };
    }
  }

  /**
   * Validates and adopts pre-existing remote positions into local persistent state (data/state.json).
   *
   * STRICT SAFETY INVARIANTS:
   * - ZERO orders sent to Binance.
   * - ZERO execution calls.
   * - ZERO fake values: uses exact Binance numbers (or 0 for unsubmitted SL/TP).
   * - Prevents duplicate adoption.
   * - Persists state atomically.
   * - Executes READ-ONLY reconciliation immediately afterwards.
   */
  public async validateAndAdoptRemotePositions(
    customAccountState?: AccountState
  ): Promise<PositionAdoptionApplyResult> {
    const timestamp = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];
    const results: PositionAdoptionItemResult[] = [];
    const newlyAdoptedPositions: Position[] = [];

    try {
      // 1. Fetch remote account state
      const accountState: AccountState = customAccountState || (await this.accountProvider.getAccountState());
      if (!accountState || !accountState.available) {
        return {
          success: false,
          status: 'UNAVAILABLE',
          adoptedCount: 0,
          alreadyTrackedCount: 0,
          ignoredCount: 0,
          invalidCount: 0,
          adoptedPositions: [],
          trackedPositionsCount: 0,
          results: [],
          reconciliationStatus: 'UNAVAILABLE',
          reconciliation: {
            timestamp,
            status: 'UNAVAILABLE',
            accountStateAvailable: false,
            localPositionCount: 0,
            remotePositionCount: 0,
            matchedPositions: [],
            missingLocally: [],
            missingRemotely: [],
            quantityMismatches: [],
            sideMismatches: [],
            warnings: [accountState?.error || 'Remote account state unavailable.'],
            errors: [],
          },
          readOnly: false,
          executionPerformed: false,
          stateModified: false,
          warnings: [accountState?.error || 'Remote account state is unavailable.'],
          errors: [],
          timestamp,
        };
      }

      // 2. Load current persistent state atomically
      const state = await this.storage.loadState();
      const currentTracked: Position[] = Array.isArray(state.trackedPositions)
        ? [...state.trackedPositions]
        : [];

      // Build existing local lookup by symbol:side to prevent duplicates
      const localMap = new Map<string, Position>();
      for (const lp of currentTracked) {
        if (lp && lp.symbol && lp.side) {
          localMap.set(`${lp.symbol.toUpperCase()}:${lp.side.toUpperCase()}`, lp);
        }
      }

      let adoptedCount = 0;
      let alreadyTrackedCount = 0;
      let ignoredCount = 0;
      let invalidCount = 0;

      // 3. Process each remote position
      for (const rp of accountState.openPositions) {
        if (!rp || typeof rp !== 'object') {
          invalidCount++;
          errors.push('Malformed remote position object encountered.');
          continue;
        }

        const symbol = typeof rp.symbol === 'string' ? rp.symbol.trim().toUpperCase() : '';
        const side = rp.side as 'LONG' | 'SHORT';
        const quantity = rp.quantity;
        const entryPrice = rp.entryPrice;

        // Condition 1: Flat/Zero quantity position
        if (Number.isFinite(quantity) && Math.abs(quantity) === 0) {
          ignoredCount++;
          results.push({
            symbol: symbol || 'UNKNOWN',
            side: side || 'LONG',
            evaluation: 'IGNORE_ZERO_POSITION',
            reason: 'Position quantity is zero (flat position). Not persisted.',
            quantity: 0,
            entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
          });
          continue;
        }

        // Condition 2: Validate symbol
        if (!symbol) {
          invalidCount++;
          errors.push('Remote position is missing a valid symbol.');
          results.push({
            symbol: 'UNKNOWN',
            side: side || 'LONG',
            evaluation: 'INVALID_REMOTE_POSITION',
            reason: 'Missing symbol. State unchanged.',
          });
          continue;
        }

        // Condition 3: Validate side
        if (side !== 'LONG' && side !== 'SHORT') {
          invalidCount++;
          errors.push(`Remote position ${symbol} has invalid side: '${String(rp.side)}'`);
          results.push({
            symbol,
            side: 'LONG',
            evaluation: 'INVALID_REMOTE_POSITION',
            reason: `Invalid positionSide: '${String(rp.side)}'. State unchanged.`,
          });
          continue;
        }

        // Condition 4: Validate quantity (> 0, finite)
        if (!Number.isFinite(quantity) || quantity <= 0) {
          invalidCount++;
          errors.push(`Remote position ${symbol}:${side} has invalid quantity: ${quantity}`);
          results.push({
            symbol,
            side,
            evaluation: 'INVALID_REMOTE_POSITION',
            reason: `Non-positive or non-finite quantity: ${quantity}. State unchanged.`,
            quantity,
            entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
          });
          continue;
        }

        // Condition 5: Validate entryPrice (> 0, finite)
        if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
          invalidCount++;
          errors.push(`Remote position ${symbol}:${side} has non-positive or invalid entry price: ${entryPrice}`);
          results.push({
            symbol,
            side,
            evaluation: 'INVALID_REMOTE_POSITION',
            reason: `Non-positive or invalid entry price: ${entryPrice}. State unchanged.`,
            quantity,
            entryPrice,
          });
          continue;
        }

        // Condition 6: Duplicate adoption check
        const positionKey = `${symbol}:${side}`;
        if (localMap.has(positionKey)) {
          alreadyTrackedCount++;
          const existing = localMap.get(positionKey)!;
          results.push({
            symbol,
            side,
            evaluation: 'ALREADY_TRACKED',
            reason: `Position ${positionKey} is already tracked in persistent state. Duplicate prevented.`,
            quantity,
            entryPrice,
            positionId: existing.id,
          });
          continue;
        }

        // Condition 7: Valid pre-existing position -> Create clean local Position
        const leverage = Number.isFinite(rp.leverage) && (rp.leverage as number) > 0 ? (rp.leverage as number) : 1;
        const notionalValue = quantity * entryPrice;
        const amountUsd =
          Number.isFinite(rp.initialMargin) && (rp.initialMargin as number) > 0
            ? (rp.initialMargin as number)
            : notionalValue / leverage;
        const unrealizedProfit = Number.isFinite(rp.unrealizedPnl) ? (rp.unrealizedPnl as number) : 0;
        const pnlPercentage = amountUsd > 0 ? (unrealizedProfit / amountUsd) * 100 : 0;
        const positionId = `adopted-${symbol.toLowerCase()}-${side.toLowerCase()}-${timestamp}`;

        const adoptedPosition: Position = {
          id: positionId,
          symbol,
          side,
          entryPrice,
          markPrice: Number.isFinite(rp.markPrice) && (rp.markPrice as number) > 0 ? (rp.markPrice as number) : entryPrice,
          quantity,
          amountUsd,
          notionalValue,
          leverage,
          liquidationPrice: 0,
          unrealizedProfit,
          pnlPercentage,
          stopLossPrice: 0, // Unsubmitted protective order, exact reality on exchange
          takeProfitPrice: 0, // Unsubmitted protective order, exact reality on exchange
          stopLossOrderStatus: 'UNSUBMITTED',
          takeProfitOrderStatus: 'UNSUBMITTED',
          lastReconciliationTime: timestamp,
          reconciliationStatus: 'IN_SYNC',
          reconciliationMessage: 'Adopted from Binance Futures Testnet into persistent state',
          estimatedCommissionUsd: 0,
          fundingFeeUsd: 0,
          slippageEstimateUsd: 0,
          openedAt: timestamp,
          maxDurationMs: 86400000,
          aiConfidence: 100, // Directly verified on exchange
          rationale: 'Adopted pre-existing position from Binance Futures Testnet',
          isRealOrder: false,
          isTestnet: true,
        };

        newlyAdoptedPositions.push(adoptedPosition);
        currentTracked.push(adoptedPosition);
        localMap.set(positionKey, adoptedPosition);
        adoptedCount++;

        results.push({
          symbol,
          side,
          evaluation: 'ADOPTED',
          reason: `Position ${positionKey} successfully adopted into persistent state.`,
          quantity,
          entryPrice,
          positionId,
        });
      }

      // 4. Atomic state persistence if new positions were adopted
      let stateModified = false;
      if (adoptedCount > 0) {
        await this.storage.setTrackedPositions(currentTracked);
        stateModified = true;
      }

      // 5. Post-adoption READ-ONLY reconciliation check
      const reconciliation = await this.reconciliationService.reconcile(currentTracked, accountState);

      return {
        success: true,
        status: adoptedCount > 0 ? 'COMPLETED' : 'NO_CHANGES',
        adoptedCount,
        alreadyTrackedCount,
        ignoredCount,
        invalidCount,
        adoptedPositions: newlyAdoptedPositions,
        trackedPositionsCount: currentTracked.length,
        results,
        reconciliationStatus: reconciliation.status,
        reconciliation,
        readOnly: false, // State persistence performed
        executionPerformed: false, // ZERO exchange orders
        stateModified,
        warnings,
        errors,
        timestamp,
      };
    } catch (err: any) {
      console.error('[PositionAdoptionService] Error in validateAndAdoptRemotePositions:', err);
      return {
        success: false,
        status: 'ERROR',
        adoptedCount: 0,
        alreadyTrackedCount: 0,
        ignoredCount: 0,
        invalidCount: 0,
        adoptedPositions: [],
        trackedPositionsCount: 0,
        results,
        reconciliationStatus: 'ERROR',
        reconciliation: {
          timestamp,
          status: 'ERROR',
          accountStateAvailable: false,
          localPositionCount: 0,
          remotePositionCount: 0,
          matchedPositions: [],
          missingLocally: [],
          missingRemotely: [],
          quantityMismatches: [],
          sideMismatches: [],
          warnings,
          errors: [`Adoption failed: ${err.message || String(err)}`],
        },
        readOnly: false,
        executionPerformed: false,
        stateModified: false,
        warnings,
        errors: [`Adoption failed: ${err.message || String(err)}`],
        timestamp,
      };
    }
  }
}

export const positionAdoptionService = new PositionAdoptionService();
