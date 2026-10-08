import { Position, BotSettings, ClosedTrade, TradeDirection } from '../types/trading';
import { storageService, PersistentBotState } from '../services/storageService';
import { serverMarketDataProvider, ServerMarketDataProvider } from './serverMarketDataProvider';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { SAFE_BOOT_MODE } from './workerEngine';

export interface PositionFieldSource<T> {
  value: T;
  source: 'BINANCE_TESTNET' | 'USER_CONFIGURED' | 'UNKNOWN';
}

export interface PositionStateDiagnostic {
  symbol?: string;
  side?: TradeDirection;
  quantity?: number;
  entryPrice?: number;
  markPrice?: PositionFieldSource<number | null>;
  unrealizedProfit?: PositionFieldSource<number | null>;
  stopLossPrice?: PositionFieldSource<number | null>;
  takeProfitPrice?: PositionFieldSource<number | null>;
  leverage?: PositionFieldSource<number | null>;
  executionPerformed: false;
  readOnly: true;
  positionsCount: number;
  positions: Array<{
    symbol: string;
    side: TradeDirection;
    quantity: number;
    entryPrice: number;
    markPrice: PositionFieldSource<number | null>;
    unrealizedProfit: PositionFieldSource<number | null>;
    stopLossPrice: PositionFieldSource<number | null>;
    takeProfitPrice: PositionFieldSource<number | null>;
  }>;
}

export interface PositionDryRunResult {
  positionId: string;
  symbol: string;
  side: TradeDirection;
  entryPrice: number;
  markPrice: number;
  unrealizedProfit: number;
  pnlPercentage: number;
  hardStopHit: boolean;
  tp1Hit: boolean;
  breakevenProposed: boolean;
  proposedStopLossPrice?: number;
  trailingStopAction?: 'MOVE_TRAILING_STOP' | 'MAINTAIN' | 'NONE';
  takeProfitHit: boolean;
  maxDurationExpired: boolean;
  theoreticalAction: 'NONE' | 'SHIFT_SL_BREAKEVEN' | 'MOVE_TRAILING_STOP' | 'CLOSE';
  exitReason?: ClosedTrade['exitReason'];
  dryRun: true;
  error?: string;
}

/**
 * PositionStateSync — READ/SIMULATION ONLY
 *
 * Synchronizes server-side position state with real market prices,
 * calculating theoretical SL, TP, Breakeven, and Trailing Stop outcomes in memory.
 *
 * SAFETY INVARIANTS:
 * - NO Binance order placement, modification, or cancellation
 * - NO calls or imports to ExecutionService or order endpoints
 * - NO execution of closePosition or openPosition
 * - NO credentials, keys, or secrets
 * - Concurrency guard prevents duplicate simultaneous syncs
 * - Per-position error isolation ensures one failure does not halt others
 * - Output is strictly DRY-RUN simulation for logging and inspection
 */
export class PositionStateSync {
  private marketProvider: ServerMarketDataProvider;
  private isBusy: boolean = false;
  private memoryPositions: Position[] = [];

  constructor(marketProvider?: ServerMarketDataProvider) {
    this.marketProvider = marketProvider || serverMarketDataProvider;
  }

  /**
   * Checks whether a position sync operation is currently active.
   */
  public isSyncing(): boolean {
    return this.isBusy;
  }

  /**
   * Returns current cached in-memory positions.
   */
  public getPositions(): Position[] {
    return [...this.memoryPositions];
  }

  /**
   * Evaluates a single position against the current mark price.
   * Pure mathematical simulation; never triggers live orders.
   */
  public evaluatePositionDryRun(
    pos: Position,
    currentMark: number,
    settings: Partial<BotSettings> = {}
  ): PositionDryRunResult {
    // Strict Guard 1: Mark price must be finite and positive. No fake prices allowed.
    if (!Number.isFinite(currentMark) || currentMark <= 0) {
      return {
        positionId: pos.id,
        symbol: pos.symbol,
        side: pos.side,
        entryPrice: pos.entryPrice,
        markPrice: pos.markPrice,
        unrealizedProfit: pos.unrealizedProfit,
        pnlPercentage: pos.pnlPercentage,
        hardStopHit: false,
        tp1Hit: false,
        breakevenProposed: false,
        takeProfitHit: false,
        maxDurationExpired: false,
        theoreticalAction: 'NONE',
        dryRun: true,
        error: 'Current mark price unavailable or invalid.',
      };
    }

    const isLong = pos.side === 'LONG';
    const now = Date.now();

    // 1. Calculate PnL and excursions
    const diff = isLong
      ? (currentMark - pos.entryPrice) / pos.entryPrice
      : (pos.entryPrice - currentMark) / pos.entryPrice;

    const pnlPercentage = Number((diff * 100 * pos.leverage).toFixed(2));
    const unrealizedProfit = Number((pos.amountUsd * (pnlPercentage / 100)).toFixed(2));
    const highest = Math.max(pos.highestPriceReached || currentMark, currentMark);
    const lowest = Math.min(pos.lowestPriceReached || currentMark, currentMark);

    let theoreticalAction: 'NONE' | 'SHIFT_SL_BREAKEVEN' | 'MOVE_TRAILING_STOP' | 'CLOSE' = 'NONE';
    let exitReason: ClosedTrade['exitReason'] | undefined = undefined;
    let proposedStopLossPrice: number | undefined = undefined;
    let breakevenProposed = false;
    let trailingStopAction: 'MOVE_TRAILING_STOP' | 'MAINTAIN' | 'NONE' = 'NONE';

    // 2. Check TP1 Hit & Breakeven shift (only if tp1Price is valid and > 0)
    const hasValidTp1 = Number.isFinite(pos.tp1Price) && (pos.tp1Price as number) > 0;
    const hitTp1 = Boolean(hasValidTp1 && (isLong ? currentMark >= (pos.tp1Price as number) : currentMark <= (pos.tp1Price as number)));
    if (settings.multiTargetTrailing && hitTp1 && (pos.tpLevelReached || 0) === 0) {
      breakevenProposed = true;
      proposedStopLossPrice = pos.entryPrice;
      theoreticalAction = 'SHIFT_SL_BREAKEVEN';
    }

    // 3. Dynamic Trailing Stop calculation (only active when stopLossPrice is known and > 0)
    const hasValidStopLoss = Number.isFinite(pos.stopLossPrice) && pos.stopLossPrice > 0;
    if (settings.useTrailingStop && hasValidStopLoss) {
      const trailPct = typeof settings.trailingStopPercent === 'number' && settings.trailingStopPercent > 0
        ? settings.trailingStopPercent
        : 0.8;

      if (isLong) {
        const proposedTrailing = highest * (1 - trailPct / 100);
        if (proposedTrailing > pos.stopLossPrice) {
          trailingStopAction = 'MOVE_TRAILING_STOP';
          if (theoreticalAction === 'NONE') {
            theoreticalAction = 'MOVE_TRAILING_STOP';
            proposedStopLossPrice = proposedTrailing;
          }
        } else {
          trailingStopAction = 'MAINTAIN';
        }
      } else {
        const proposedTrailing = lowest * (1 + trailPct / 100);
        if (proposedTrailing < pos.stopLossPrice) {
          trailingStopAction = 'MOVE_TRAILING_STOP';
          if (theoreticalAction === 'NONE') {
            theoreticalAction = 'MOVE_TRAILING_STOP';
            proposedStopLossPrice = proposedTrailing;
          }
        } else {
          trailingStopAction = 'MAINTAIN';
        }
      }
    }

    // 4. Hard Stop exit check (strictly disabled if stopLossPrice is unknown / <= 0)
    const hitSl = hasValidStopLoss
      ? (isLong ? currentMark <= pos.stopLossPrice : currentMark >= pos.stopLossPrice)
      : false;
    if (hitSl) {
      theoreticalAction = 'CLOSE';
      exitReason = (pos.tpLevelReached || 0) >= 1 ? 'TRAILING_STOP' : 'STOP_LOSS';
    }

    // 5. Take Profit exit check (strictly disabled if takeProfitPrice is unknown / <= 0)
    const hasValidTakeProfit = Number.isFinite(pos.takeProfitPrice) && pos.takeProfitPrice > 0;
    const hitTp = hasValidTakeProfit
      ? (isLong ? currentMark >= pos.takeProfitPrice : currentMark <= pos.takeProfitPrice)
      : false;
    if (hitTp && theoreticalAction !== 'CLOSE') {
      theoreticalAction = 'CLOSE';
      exitReason = 'TAKE_PROFIT';
    }

    // 6. Max Hold Duration check (strictly disabled if openedAt or maxDuration are unreliable, e.g. adopted positions)
    const isAdoptedPosition = pos.id?.startsWith('adopted-') || Boolean(pos.rationale?.includes('Adopted'));
    const isHoldTimeReliable = !isAdoptedPosition && Number.isFinite(pos.openedAt) && pos.openedAt > 0 && Number.isFinite(pos.maxDurationMs) && (pos.maxDurationMs as number) > 0;
    const durationExpired = Boolean(
      !settings.unlimitedHoldTime &&
      isHoldTimeReliable &&
      now - pos.openedAt >= (pos.maxDurationMs as number)
    );
    if (durationExpired && theoreticalAction !== 'CLOSE') {
      theoreticalAction = 'CLOSE';
      exitReason = 'TIME_EXPIRED';
    }

    return {
      positionId: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      markPrice: currentMark,
      unrealizedProfit,
      pnlPercentage,
      hardStopHit: hitSl,
      tp1Hit: hitTp1,
      breakevenProposed,
      proposedStopLossPrice,
      trailingStopAction,
      takeProfitHit: hitTp,
      maxDurationExpired: durationExpired,
      theoreticalAction,
      exitReason,
      dryRun: true,
    };
  }

  /**
   * Synchronizes positions with public market prices and performs dry-run monitoring.
   * If customPositions are not provided, loads positions from storageService.
   */
  public async syncPositions(
    customPositions?: Position[],
    customSettings?: Partial<BotSettings>
  ): Promise<PositionDryRunResult[]> {
    if (this.isBusy) {
      console.warn('[WORKER] Position sync already in progress. Skipping duplicate sync.');
      return [];
    }

    this.isBusy = true;
    const results: PositionDryRunResult[] = [];

    try {
      // 1. Determine positions & settings to evaluate
      let positionsToSync: Position[] = [];
      let settings: Partial<BotSettings> = customSettings || {};

      if (customPositions) {
        positionsToSync = customPositions;
      } else {
        const state: PersistentBotState = await storageService.loadState();
        positionsToSync = state.trackedPositions || [];
        if (!customSettings && state.settings) {
          settings = state.settings;
        }
      }

      this.memoryPositions = [...positionsToSync];

      if (positionsToSync.length === 0) {
        return [];
      }

      // 2. Process each position with error isolation
      for (const pos of positionsToSync) {
        try {
          if (!pos || !pos.symbol) continue;

          // Fetch current price from public market data provider
          let markPrice: number | null = null;
          try {
            markPrice = await this.marketProvider.getPrice(pos.symbol);
          } catch (fetchErr: any) {
            console.warn(`[WORKER] Price fetch failed for position ${pos.symbol}: ${fetchErr.message}`);
          }

          if (markPrice === null || !Number.isFinite(markPrice) || markPrice <= 0) {
            console.warn(`[WORKER] Position sync: Valid price unavailable for ${pos.symbol}, skipping evaluation.`);
            results.push({
              positionId: pos.id,
              symbol: pos.symbol,
              side: pos.side,
              entryPrice: pos.entryPrice,
              markPrice: pos.markPrice || 0,
              unrealizedProfit: pos.unrealizedProfit || 0,
              pnlPercentage: pos.pnlPercentage || 0,
              hardStopHit: false,
              tp1Hit: false,
              breakevenProposed: false,
              takeProfitHit: false,
              maxDurationExpired: false,
              theoreticalAction: 'NONE',
              dryRun: true,
              error: 'PRICE_UNAVAILABLE',
            });
            continue;
          }

          // Mathematical simulation
          const dryRunResult = this.evaluatePositionDryRun(pos, markPrice, settings);
          results.push(dryRunResult);

          // Dry-run logging only
          console.log(
            `[WORKER] Position dry-run: ${dryRunResult.symbol} ${dryRunResult.side} | ` +
            `Entry: ${dryRunResult.entryPrice} | Mark: ${dryRunResult.markPrice} | ` +
            `PnL: ${dryRunResult.pnlPercentage}% ($${dryRunResult.unrealizedProfit}) | ` +
            `Action: ${dryRunResult.theoreticalAction} ${dryRunResult.exitReason ? `(${dryRunResult.exitReason})` : ''} | ` +
            `DRY-RUN ONLY`
          );

          if (dryRunResult.theoreticalAction !== 'NONE') {
            if (SAFE_BOOT_MODE) {
              console.log(`[WORKER] Action ${dryRunResult.theoreticalAction} skipped: SAFE_BOOT_MODE is active.`);
            } else {
              console.log(`[WORKER] Action ${dryRunResult.theoreticalAction} skipped: DRY-RUN SIMULATION ONLY.`);
            }
          }
        } catch (posErr: any) {
          console.warn(`[WORKER] Error evaluating position ${pos.symbol}: ${posErr.message}`);
          results.push({
            positionId: pos.id,
            symbol: pos.symbol,
            side: pos.side,
            entryPrice: pos.entryPrice,
            markPrice: pos.markPrice || 0,
            unrealizedProfit: 0,
            pnlPercentage: 0,
            hardStopHit: false,
            tp1Hit: false,
            breakevenProposed: false,
            takeProfitHit: false,
            maxDurationExpired: false,
            theoreticalAction: 'NONE',
            dryRun: true,
            error: posErr.message,
          });
        }
      }

      return results;
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * Generates a strictly READ-ONLY diagnostic report of tracked positions,
   * fetching authentic live markPrice and unrealizedProfit from Binance Testnet,
   * without fabricating any missing data.
   */
  public async getPositionStateDiagnostic(): Promise<PositionStateDiagnostic> {
    const state = await storageService.loadState();
    const tracked = Array.isArray(state.trackedPositions) ? [...state.trackedPositions] : [];

    if (tracked.length === 0) {
      return {
        executionPerformed: false,
        readOnly: true,
        positionsCount: 0,
        positions: [],
      };
    }

    // Attempt to read live testnet account to get verified unrealizedProfit
    const testnetAccount = await binanceTestnetAccountStateProvider.getAccountState().catch(() => null);

    const diagnosticPositions = [];
    let stateChanged = false;

    for (const pos of tracked) {
      // 1. Fetch authentic markPrice from Binance Testnet premiumIndex
      let liveMark: number | null = null;
      let markSource: 'BINANCE_TESTNET' | 'UNKNOWN' = 'UNKNOWN';
      try {
        liveMark = await binanceTestnetAccountStateProvider.getMarkPrice(pos.symbol);
        if (Number.isFinite(liveMark) && liveMark !== null && liveMark > 0) {
          markSource = 'BINANCE_TESTNET';
          if (pos.markPrice !== liveMark) {
            pos.markPrice = liveMark;
            stateChanged = true;
          }
        } else {
          liveMark = null;
        }
      } catch {
        liveMark = null;
      }

      // 2. Fetch authentic unrealizedProfit from Binance Testnet account
      let livePnl: number | null = null;
      let pnlSource: 'BINANCE_TESTNET' | 'UNKNOWN' = 'UNKNOWN';
      const remotePos = testnetAccount?.openPositions?.find(
        (rp) => rp.symbol === pos.symbol && rp.side === pos.side
      );
      if (remotePos && Number.isFinite(remotePos.unrealizedPnl)) {
        livePnl = remotePos.unrealizedPnl as number;
        pnlSource = 'BINANCE_TESTNET';
        if (pos.unrealizedProfit !== livePnl) {
          pos.unrealizedProfit = livePnl;
          stateChanged = true;
        }
      } else if (Number.isFinite(pos.unrealizedProfit)) {
        livePnl = pos.unrealizedProfit;
        pnlSource = 'BINANCE_TESTNET';
      }

      // 3. Stop loss & take profit
      const hasSl = Number.isFinite(pos.stopLossPrice) && pos.stopLossPrice > 0;
      const slSource: 'USER_CONFIGURED' | 'UNKNOWN' = hasSl ? 'USER_CONFIGURED' : 'UNKNOWN';
      const slValue = hasSl ? pos.stopLossPrice : null;

      const hasTp = Number.isFinite(pos.takeProfitPrice) && pos.takeProfitPrice > 0;
      const tpSource: 'USER_CONFIGURED' | 'UNKNOWN' = hasTp ? 'USER_CONFIGURED' : 'UNKNOWN';
      const tpValue = hasTp ? pos.takeProfitPrice : null;

      diagnosticPositions.push({
        symbol: pos.symbol,
        side: pos.side,
        quantity: pos.quantity,
        entryPrice: pos.entryPrice,
        markPrice: {
          value: liveMark,
          source: markSource,
        },
        unrealizedProfit: {
          value: livePnl,
          source: pnlSource,
        },
        stopLossPrice: {
          value: slValue,
          source: slSource,
        },
        takeProfitPrice: {
          value: tpValue,
          source: tpSource,
        },
      });
    }

    // Persist verified live mark price and unrealized profit to state.json if updated
    if (stateChanged) {
      await storageService.setTrackedPositions(tracked);
    }

    const first = diagnosticPositions[0];
    return {
      symbol: first?.symbol,
      side: first?.side,
      quantity: first?.quantity,
      entryPrice: first?.entryPrice,
      markPrice: first?.markPrice,
      unrealizedProfit: first?.unrealizedProfit,
      stopLossPrice: first?.stopLossPrice,
      takeProfitPrice: first?.takeProfitPrice,
      executionPerformed: false,
      readOnly: true,
      positionsCount: diagnosticPositions.length,
      positions: diagnosticPositions,
    };
  }
}

export const positionStateSync = new PositionStateSync();
