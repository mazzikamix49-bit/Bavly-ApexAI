import { FuturesSymbolInfo, Candle, Position, EvaluatedCandidate } from '../types/trading';
import { StrategyEngine, strategyEngine } from '../services/strategyEngine';
import { ServerMarketDataProvider, serverMarketDataProvider } from './serverMarketDataProvider';
import { futuresUniverseProvider, FuturesUniverseProvider } from './futuresUniverseProvider';
import { SAFE_BOOT_MODE } from './workerEngine';

export interface CandidateScanResult {
  symbol: string;
  evaluatedAt: number;
  qualified: boolean;
  signal: 'BUY_LONG' | 'SELL_SHORT' | 'NO_TRADE';
  confidence: number;
  rationale: string;
  rejectionReason?: string;
  price: number;
  plannedStopLossPrice: number;
  plannedTakeProfitPrice: number;
  riskRewardRatio: number;
  error?: string;
}

export interface CandidateScanSummary {
  universeSize: number;
  scannedCount: number;
  successCount: number;
  failureCount: number;
  signalCount: number;
  durationMs: number;
  results: CandidateScanResult[];
}

export interface CandidateScannerOptions {
  fetchCandles?: boolean;
  candleLimit?: number;
  activePositions?: Position[];
  language?: 'ar' | 'en';
  verbose?: boolean;
}

/**
 * CandidateScanner — DRY-RUN & SIGNAL INSPECTION ONLY
 *
 * Feeds public market data from ServerMarketDataProvider to StrategyEngine.evaluateCandidate
 * across the entire dynamically discovered Binance USDT-M Futures Universe.
 *
 * SAFETY INVARIANTS:
 * - NO imports or calls to ExecutionService or order endpoints
 * - NO opening or closing positions
 * - NO credentials, keys, or secrets
 * - Concurrency guard prevents duplicate concurrent scans
 * - Per-symbol error isolation prevents worker crashes
 * - All qualified signals log DRY-RUN notices and skip execution
 */
export class CandidateScanner {
  private marketProvider: ServerMarketDataProvider;
  private universeProvider: FuturesUniverseProvider;
  private strategy: StrategyEngine;
  private isBusy: boolean = false;

  constructor(
    marketProvider?: ServerMarketDataProvider,
    strategy?: StrategyEngine,
    universeProvider?: FuturesUniverseProvider
  ) {
    this.marketProvider = marketProvider || serverMarketDataProvider;
    this.strategy = strategy || strategyEngine;
    this.universeProvider = universeProvider || futuresUniverseProvider;
  }

  /**
   * Returns whether a scan is currently executing.
   */
  public isScanning(): boolean {
    return this.isBusy;
  }

  /**
   * Executes a single-shot inspection scan for specified symbols or the entire
   * dynamically discovered Binance USDT-M Futures universe.
   */
  public async scan(
    symbols?: string[],
    options: CandidateScannerOptions = {}
  ): Promise<CandidateScanResult[]> {
    const summary = await this.scanWithSummary(symbols, options);
    return summary.results;
  }

  /**
   * Executes scan and returns complete metrics (universeSize, scannedCount, successCount, failureCount, signals).
   */
  public async scanWithSummary(
    symbols?: string[],
    options: CandidateScannerOptions = {}
  ): Promise<CandidateScanSummary> {
    // 1. Guard against concurrent duplicate scans
    if (this.isBusy) {
      console.warn('[WORKER] Candidate scan already in progress. Skipping duplicate scan.');
      return {
        universeSize: 0,
        scannedCount: 0,
        successCount: 0,
        failureCount: 0,
        signalCount: 0,
        durationMs: 0,
        results: [],
      };
    }

    this.isBusy = true;
    const scanStart = Date.now();
    const results: CandidateScanResult[] = [];
    let signalCount = 0;
    let failureCount = 0;

    try {
      // 2. Discover / resolve target universe
      let targetSymbols = symbols;
      if (!targetSymbols || targetSymbols.length === 0) {
        targetSymbols = await this.universeProvider.getTradableSymbols();
      }

      const universeSize = targetSymbols.length;
      console.log(`[WORKER] Starting candidate scan across ${universeSize} tradable USDT-M Futures pairs (DRY-RUN, Inspection Only)...`);

      // 3. Fetch public market snapshot from provider (single bulk request for all 24h tickers)
      let snapshot;
      try {
        snapshot = await this.marketProvider.getMarketSnapshot(targetSymbols);
      } catch (fetchErr: any) {
        console.warn(`[WORKER] Market data request failed during scan: ${fetchErr.message}`);
        return {
          universeSize,
          scannedCount: 0,
          successCount: 0,
          failureCount: 0,
          signalCount: 0,
          durationMs: Date.now() - scanStart,
          results: [],
        };
      }

      if (!snapshot || !Array.isArray(snapshot.pairs) || snapshot.pairs.length === 0) {
        console.warn('[WORKER] Candidate scanner: No market pairs returned from provider.');
        return {
          universeSize,
          scannedCount: 0,
          successCount: 0,
          failureCount: 0,
          signalCount: 0,
          durationMs: Date.now() - scanStart,
          results: [],
        };
      }

      const activePositions = options.activePositions || [];
      const language = options.language || 'en';
      const isVerbose = options.verbose ?? (snapshot.pairs.length <= 5);

      // 4. Evaluate each pair using StrategyEngine with error isolation
      for (const pair of snapshot.pairs) {
        if (!pair || !pair.symbol || !pair.price || pair.price <= 0) {
          continue;
        }

        try {
          let candles15m: Candle[] = [];
          if (options.fetchCandles) {
            try {
              candles15m = await this.marketProvider.getKlines(pair.symbol, '15m', options.candleLimit || 30);
            } catch (klineErr: any) {
              console.warn(`[WORKER] Kline fetch failed for ${pair.symbol}: ${klineErr.message}`);
            }
          }

          // Strict Quantitative Evaluation
          const evaluation: EvaluatedCandidate = this.strategy.evaluateCandidate(
            pair,
            candles15m,
            activePositions,
            undefined,
            language
          );

          const isSignal = evaluation.qualified && evaluation.signal !== 'NO_TRADE';
          if (isSignal) {
            signalCount++;
          }

          const scanResult: CandidateScanResult = {
            symbol: pair.symbol,
            evaluatedAt: Date.now(),
            qualified: evaluation.qualified,
            signal: evaluation.signal,
            confidence: evaluation.confidence,
            rationale: evaluation.rationale,
            rejectionReason: evaluation.rejectionReason,
            price: pair.price,
            plannedStopLossPrice: evaluation.plannedStopLossPrice,
            plannedTakeProfitPrice: evaluation.plannedTakeProfitPrice,
            riskRewardRatio: evaluation.riskRewardRatio,
          };

          results.push(scanResult);

          // Inspection Logging
          if (isSignal) {
            console.log(`[WORKER] Candidate signal detected (DRY-RUN): ${scanResult.symbol} [${scanResult.signal}] (Confidence: ${scanResult.confidence}%)`);
            if (SAFE_BOOT_MODE) {
              console.log(`[WORKER] Execution skipped: SAFE_BOOT_MODE is active.`);
            } else {
              console.log(`[WORKER] DRY-RUN ONLY — execution skipped.`);
            }
          } else if (isVerbose) {
            console.log(`[WORKER] Candidate signal inspected (DRY-RUN): ${scanResult.symbol} -> Signal: ${scanResult.signal}, Qualified: ${scanResult.qualified} (${scanResult.rejectionReason || 'NONE'})`);
          }
        } catch (symbolEvalErr: any) {
          failureCount++;
          console.warn(`[WORKER] Candidate evaluation failed for ${pair.symbol}: ${symbolEvalErr.message}`);
          results.push({
            symbol: pair.symbol,
            evaluatedAt: Date.now(),
            qualified: false,
            signal: 'NO_TRADE',
            confidence: 0,
            rationale: `Evaluation error: ${symbolEvalErr.message}`,
            rejectionReason: 'EVALUATION_ERROR',
            price: pair.price,
            plannedStopLossPrice: 0,
            plannedTakeProfitPrice: 0,
            riskRewardRatio: 0,
            error: symbolEvalErr.message,
          });
        }
      }

      const durationMs = Date.now() - scanStart;
      const successCount = results.length - failureCount;
      console.log(
        `[WORKER] Candidate scan finished. Universe: ${universeSize} | Scanned: ${results.length} | Succeeded: ${successCount} | Failed: ${failureCount} | Signals: ${signalCount} (${durationMs}ms)`
      );

      return {
        universeSize,
        scannedCount: results.length,
        successCount,
        failureCount,
        signalCount,
        durationMs,
        results,
      };
    } finally {
      this.isBusy = false;
    }
  }
}

export const candidateScanner = new CandidateScanner();
