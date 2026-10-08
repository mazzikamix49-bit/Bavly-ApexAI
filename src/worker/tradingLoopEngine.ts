import { FuturesSymbolInfo, Candle, Position, BotSettings, ClosedTrade } from '../types/trading';
import { StrategyEngine, strategyEngine } from '../services/strategyEngine';
import { RiskManagementService } from '../services/riskManagementService';
import { storageService, PersistentBotState } from '../services/storageService';
import { SAFE_BOOT_MODE } from './workerEngine';

import { serverMarketDataProvider } from './serverMarketDataProvider';
import { candidateScanner } from './candidateScanner';
import { positionStateSync } from './positionStateSync';

/**
 * Market Data Snapshot abstraction.
 * Completely decouples server-side analysis from any specific transport (WebSocket or REST).
 */
export interface MarketSnapshot {
  timestamp: number;
  pairs: FuturesSymbolInfo[];
}

/**
 * MarketDataProvider interface for abstracting price and candidate feeds.
 */
export interface MarketDataProvider {
  getMarketSnapshot(symbols?: string[]): Promise<MarketSnapshot>;
  getPrice?(symbol: string): Promise<number | null>;
  getKlines?(symbol: string, interval?: string, limit?: number): Promise<Candle[]>;
}

/**
 * NullMarketDataProvider provides a safe no-op implementation
 * ensuring no network connections, webSockets, or external requests are made in safe boot.
 */
export class NullMarketDataProvider implements MarketDataProvider {
  public async getMarketSnapshot(): Promise<MarketSnapshot> {
    return {
      timestamp: Date.now(),
      pairs: [],
    };
  }

  public async getPrice(): Promise<number | null> {
    return null;
  }

  public async getKlines(): Promise<Candle[]> {
    return [];
  }
}

/**
 * PositionAction represents an exit or trailing adjustment action.
 */
export interface PositionAction {
  positionId: string;
  symbol: string;
  action: 'SHIFT_SL_BREAKEVEN' | 'CLOSE';
  reason?: ClosedTrade['exitReason'];
  newStopPrice?: number;
}

/**
 * PositionMonitor encapsulates position monitoring logic (TP1, Trailing Stop, Hard SL, TP, Max Duration)
 * extracted cleanly from React orchestration without changing any mathematical formulas.
 */
export class PositionMonitor {
  public static evaluatePositions(
    positions: Position[],
    settings: Partial<BotSettings>
  ): PositionAction[] {
    const actions: PositionAction[] = [];
    const now = Date.now();

    for (const pos of positions) {
      const isLong = pos.side === 'LONG';
      const currentMark = pos.markPrice;

      // 1. Multi-target trailing: TP1 hit -> Shift Stop Loss to Breakeven
      if (settings.multiTargetTrailing && pos.tp1Price) {
        if ((pos.tpLevelReached || 0) === 0) {
          const hitTp1 = isLong ? currentMark >= pos.tp1Price : currentMark <= pos.tp1Price;
          if (hitTp1) {
            actions.push({
              positionId: pos.id,
              symbol: pos.symbol,
              action: 'SHIFT_SL_BREAKEVEN',
              newStopPrice: pos.entryPrice,
            });
          }
        }
      }

      // 2. Trailing Stop / Hard Stop Loss exit check (only active when stopLossPrice > 0)
      const hitSl = pos.stopLossPrice > 0
        ? (isLong ? currentMark <= pos.stopLossPrice : currentMark >= pos.stopLossPrice)
        : false;
      if (hitSl) {
        actions.push({
          positionId: pos.id,
          symbol: pos.symbol,
          action: 'CLOSE',
          reason: (pos.tpLevelReached || 0) >= 1 ? 'TRAILING_STOP' : 'STOP_LOSS',
        });
        continue;
      }

      // 3. Take profit exit check (only active when takeProfitPrice > 0)
      const hitTp = pos.takeProfitPrice > 0
        ? (isLong ? currentMark >= pos.takeProfitPrice : currentMark <= pos.takeProfitPrice)
        : false;
      if (hitTp) {
        actions.push({
          positionId: pos.id,
          symbol: pos.symbol,
          action: 'CLOSE',
          reason: 'TAKE_PROFIT',
        });
        continue;
      }

      // 4. Max Duration check
      if (!settings.unlimitedHoldTime && pos.maxDurationMs && now - pos.openedAt >= pos.maxDurationMs) {
        actions.push({
          positionId: pos.id,
          symbol: pos.symbol,
          action: 'CLOSE',
          reason: 'TIME_EXPIRED',
        });
        continue;
      }
    }

    return actions;
  }
}

/**
 * Server-Side Trading Loop Engine Skeleton.
 *
 * Responsibilities:
 * - Manages the lifecycle of the server-side scanning & monitoring loop.
 * - Enforces SAFE_BOOT_MODE guard: strictly prevents loop startup, timer creation, and order submission.
 * - Prevents duplicate timer intervals.
 * - Coordinates Market Data Provider, StrategyEngine, RiskManagementService, and PositionMonitor.
 */
export class TradingLoopEngine {
  private isLoopActive: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private tickIntervalMs: number = 4000;
  private marketDataProvider: MarketDataProvider;
  private tickCount: number = 0;

  constructor(dataProvider?: MarketDataProvider) {
    this.marketDataProvider = dataProvider || serverMarketDataProvider;
  }

  public getMarketDataProvider(): MarketDataProvider {
    return this.marketDataProvider;
  }

  /**
   * Starts the server-side trading loop.
   * STRICTLY GUARDED: If SAFE_BOOT_MODE is active, execution is rejected immediately
   * and NO timer is created.
   */
  public start(): void {
    if (SAFE_BOOT_MODE) {
      console.warn('[WORKER] Refusing to start trading loop: SAFE_BOOT_MODE is active.');
      return;
    }

    if (this.isLoopActive || this.intervalTimer !== null) {
      console.warn('[WORKER] Trading loop is already running. Duplicate start ignored.');
      return;
    }

    this.isLoopActive = true;
    console.log('[WORKER] Starting server-side trading loop...');

    // Single interval timer only
    this.intervalTimer = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[WORKER] Error during trading loop tick:', err);
      });
    }, this.tickIntervalMs);

    console.log('[WORKER] Server-side trading loop active.');
  }

  /**
   * Stops the server-side trading loop and clears any timer.
   */
  public stop(): void {
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.isLoopActive = false;
    console.log('[WORKER] Trading loop stopped.');
  }

  /**
   * Checks whether the trading loop is active.
   * Always false when SAFE_BOOT_MODE is true.
   */
  public isRunning(): boolean {
    if (SAFE_BOOT_MODE) {
      return false;
    }
    return this.isLoopActive && this.intervalTimer !== null;
  }

  /**
   * Set custom market data provider (e.g. for future market data feeds or mock testing).
   */
  public setMarketDataProvider(provider: MarketDataProvider): void {
    this.marketDataProvider = provider;
  }

  /**
   * Single Tick Orchestration Skeleton.
   * In SAFE_BOOT_MODE, this method exits immediately before evaluating or executing anything.
   */
  public async tick(): Promise<void> {
    if (SAFE_BOOT_MODE) {
      return;
    }

    this.tickCount++;

    // 1. Load persistent state
    const state: PersistentBotState = await storageService.loadState();
    if (!state.botRunning) {
      return;
    }

    const settings = state.settings || {};
    const positions = state.trackedPositions || [];

    // 2. Monitor open positions (TP1, Trailing Stop, SL, TP) — DRY RUN ONLY
    if (positions.length > 0) {
      await positionStateSync.syncPositions(positions, settings);
      // In future phases: dispatch actions to Execution Gateway
    }

    // 3. Scan market candidates if capacity allows
    const maxPositions = settings.maxConcurrentPositions || 3;
    if (positions.length < maxPositions && settings.autoTradingEnabled && !settings.killSwitchActive) {
      const candidates = await candidateScanner.scan(undefined, { activePositions: positions });
      for (const cand of candidates) {
        if (cand.qualified && cand.signal !== 'NO_TRADE') {
          // In future phases: pass to RiskManagementService & Execution Gateway
          break;
        }
      }
    }
  }

  public getStatus(): { isRunning: boolean; tickIntervalMs: number; safeBoot: boolean } {
    return {
      isRunning: this.isRunning(),
      tickIntervalMs: this.tickIntervalMs,
      safeBoot: SAFE_BOOT_MODE,
    };
  }
}

export const tradingLoopEngine = new TradingLoopEngine();
