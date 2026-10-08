import { Position } from '../types/trading';
import { AccountState, AccountStateProvider } from './accountStateProvider';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { storageService, StorageService } from '../services/storageService';

export interface ReconciliationResult {
  timestamp: number;
  status: 'UNAVAILABLE' | 'IN_SYNC' | 'DRIFT_DETECTED' | 'ERROR';
  accountStateAvailable: boolean;
  localPositionCount: number;
  remotePositionCount: number;
  matchedPositions: string[];
  missingLocally: string[];
  missingRemotely: string[];
  quantityMismatches: string[];
  sideMismatches: string[];
  warnings: string[];
  errors: string[];
}

/**
 * AccountReconciliationService — READ-ONLY
 *
 * Reconciles the Worker's persistent state (data/state.json) against actual
 * remote account state provided by AccountStateProvider.
 *
 * STRICT INVARIANTS:
 * - 100% READ-ONLY
 * - NO order placement, cancellations, or modifications
 * - NO automatic position creation or deletion
 * - Idempotent evaluation
 * - Non-crashing error isolation
 */
export class AccountReconciliationService {
  private accountProvider: AccountStateProvider;
  private storage: StorageService;
  private readonly quantityEpsilon = 1e-6;

  constructor(accountProvider?: AccountStateProvider, storage?: StorageService) {
    this.accountProvider = accountProvider || binanceTestnetAccountStateProvider;
    this.storage = storage || storageService;
  }

  public setAccountProvider(provider: AccountStateProvider): void {
    this.accountProvider = provider;
  }

  /**
   * Reconciles current persistent positions with the remote account state.
   */
  public async reconcile(
    customPositions?: Position[],
    customAccountState?: AccountState
  ): Promise<ReconciliationResult> {
    const timestamp = Date.now();

    try {
      // 1. Fetch persistent local positions
      let localPositions: Position[];
      if (customPositions) {
        localPositions = customPositions;
      } else {
        const state = await this.storage.loadState();
        localPositions = Array.isArray(state.trackedPositions) ? state.trackedPositions : [];
      }

      // 2. Fetch remote account state
      const accountState: AccountState = customAccountState || (await this.accountProvider.getAccountState());

      // 3. Handle unavailable remote account state gracefully
      if (!accountState || !accountState.available) {
        const result: ReconciliationResult = {
          timestamp,
          status: 'UNAVAILABLE',
          accountStateAvailable: false,
          localPositionCount: localPositions.length,
          remotePositionCount: 0,
          matchedPositions: [],
          missingLocally: [],
          missingRemotely: [],
          quantityMismatches: [],
          sideMismatches: [],
          warnings: [
            accountState?.error ||
              'Remote account state is unavailable (unconfigured credentials or connection offline).',
          ],
          errors: [],
        };

        return result;
      }

      const warnings: string[] = [];
      const errors: string[] = [];
      const matchedPositions: string[] = [];
      const missingLocally: string[] = [];
      const missingRemotely: string[] = [];
      const quantityMismatches: string[] = [];
      const sideMismatches: string[] = [];

      // 4. Validate and index local positions
      const localMap = new Map<string, Position>();
      for (const pos of localPositions) {
        if (!pos || !pos.symbol || !pos.side) {
          warnings.push(`Invalid local position format: ${JSON.stringify(pos)}`);
          continue;
        }

        const symbol = pos.symbol.toUpperCase();
        const side = pos.side.toUpperCase() as 'LONG' | 'SHORT';
        const key = `${symbol}:${side}`;

        if (localMap.has(key)) {
          warnings.push(`Duplicate local position detected for key ${key} (id: ${pos.id})`);
        }

        if (!Number.isFinite(pos.quantity) || pos.quantity <= 0) {
          warnings.push(`Local position ${key} has non-positive or invalid quantity: ${pos.quantity}`);
        }

        if (!Number.isFinite(pos.entryPrice) || pos.entryPrice <= 0) {
          warnings.push(`Local position ${key} has non-positive or invalid entry price: ${pos.entryPrice}`);
        }

        localMap.set(key, pos);
      }

      // 5. Validate and index remote positions
      const remoteMap = new Map<string, typeof accountState.openPositions[0]>();
      const rawRemotePositions = Array.isArray(accountState.openPositions)
        ? accountState.openPositions
        : [];

      for (const rPos of rawRemotePositions) {
        if (!rPos || !rPos.symbol || !rPos.side) {
          warnings.push(`Invalid remote position format: ${JSON.stringify(rPos)}`);
          continue;
        }

        const symbol = rPos.symbol.toUpperCase();
        const side = rPos.side.toUpperCase() as 'LONG' | 'SHORT';
        const key = `${symbol}:${side}`;

        if (remoteMap.has(key)) {
          warnings.push(`Duplicate remote position detected on exchange for key ${key}`);
        }

        if (!Number.isFinite(rPos.quantity) || rPos.quantity <= 0) {
          warnings.push(`Remote position ${key} has non-positive or invalid quantity: ${rPos.quantity}`);
        }

        if (!Number.isFinite(rPos.entryPrice) || rPos.entryPrice <= 0) {
          warnings.push(`Remote position ${key} has non-positive or invalid entry price: ${rPos.entryPrice}`);
        }

        remoteMap.set(key, rPos);
      }

      // 6. Cross-compare local vs remote
      for (const [key, localPos] of localMap.entries()) {
        const symbol = localPos.symbol.toUpperCase();
        const oppositeSide = localPos.side === 'LONG' ? 'SHORT' : 'LONG';
        const oppositeKey = `${symbol}:${oppositeSide}`;

        if (remoteMap.has(key)) {
          const remotePos = remoteMap.get(key)!;
          const diff = Math.abs(localPos.quantity - remotePos.quantity);

          if (diff > this.quantityEpsilon) {
            quantityMismatches.push(
              `${key} [Local Qty: ${localPos.quantity}, Remote Qty: ${remotePos.quantity}, Diff: ${diff}]`
            );
          } else {
            matchedPositions.push(key);
          }
        } else if (remoteMap.has(oppositeKey)) {
          sideMismatches.push(`${symbol} [Local Side: ${localPos.side}, Remote Side: ${oppositeSide}]`);
        } else {
          missingRemotely.push(key);
        }
      }

      // 7. Find remote positions missing locally
      for (const [key, remotePos] of remoteMap.entries()) {
        const symbol = remotePos.symbol.toUpperCase();
        const oppositeSide = remotePos.side === 'LONG' ? 'SHORT' : 'LONG';
        const oppositeKey = `${symbol}:${oppositeSide}`;

        if (!localMap.has(key) && !localMap.has(oppositeKey)) {
          missingLocally.push(key);
        }
      }

      // 8. Determine final status
      let status: ReconciliationResult['status'] = 'IN_SYNC';
      if (errors.length > 0) {
        status = 'ERROR';
      } else if (
        missingLocally.length > 0 ||
        missingRemotely.length > 0 ||
        quantityMismatches.length > 0 ||
        sideMismatches.length > 0
      ) {
        status = 'DRIFT_DETECTED';
      }

      const result: ReconciliationResult = {
        timestamp,
        status,
        accountStateAvailable: true,
        localPositionCount: localPositions.length,
        remotePositionCount: rawRemotePositions.length,
        matchedPositions,
        missingLocally,
        missingRemotely,
        quantityMismatches,
        sideMismatches,
        warnings,
        errors,
      };

      // Update storage timestamp safely (without any secrets)
      if (!customPositions && !customAccountState) {
        await this.storage.setLastReconciliationTimestamp(timestamp);
        if (accountState.available) {
          await this.storage.setLastKnownAccountState({
            totalWalletBalance: accountState.totalWalletBalance,
            availableBalance: accountState.availableBalance,
            totalMarginBalance: accountState.totalMarginBalance,
          });
        }
      }

      return result;
    } catch (err: any) {
      console.error('[WORKER] Reconciliation error:', err);
      return {
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
        warnings: [],
        errors: [`Reconciliation failed: ${err.message || String(err)}`],
      };
    }
  }
}

export const accountReconciliationService = new AccountReconciliationService();
