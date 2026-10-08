import { BINANCE_FUTURES_BASE_URL } from './workerConstants';
import { binanceNetworkGuard } from './binanceNetworkGuard';

export interface BinanceRawSymbol {
  symbol: string;
  pair: string;
  contractType: string;
  status: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision?: number;
  quantityPrecision?: number;
}

export interface FuturesUniverseMetadata {
  count: number;
  lastUpdatedAt: number;
  isStale: boolean;
  totalExchangeSymbols: number;
}

export interface FuturesUniverseProvider {
  getTradableSymbols(forceRefresh?: boolean): Promise<string[]>;
  getUniverseMetadata(): FuturesUniverseMetadata;
}

/**
 * BinanceFuturesUniverseProvider
 *
 * Dynamically discovers all actively tradable Binance USDT-M Perpetual Futures pairs
 * via the public /fapi/v1/exchangeInfo endpoint.
 *
 * Strict Selection Criteria:
 * - contractType === 'PERPETUAL'
 * - quoteAsset === 'USDT'
 * - status === 'TRADING'
 *
 * In-memory caching with TTL prevents redundant HTTP requests.
 * Zero credentials, zero timers, zero polling loops.
 */
export class BinanceFuturesUniverseProvider implements FuturesUniverseProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;

  private cachedSymbols: string[] = [];
  private totalExchangeSymbols: number = 0;
  private lastUpdatedAt: number = 0;
  private isRefreshing: boolean = false;

  constructor(options?: { baseUrl?: string; timeoutMs?: number; cacheTtlMs?: number }) {
    this.baseUrl = options?.baseUrl || BINANCE_FUTURES_BASE_URL;
    this.timeoutMs = options?.timeoutMs || 8000;
    this.cacheTtlMs = options?.cacheTtlMs || 15 * 60 * 1000; // 15 minutes TTL
  }

  /**
   * Fetches or retrieves cached tradable USDT-M perpetual symbols.
   */
  public async getTradableSymbols(forceRefresh = false): Promise<string[]> {
    const isCacheValid =
      !forceRefresh &&
      this.cachedSymbols.length > 0 &&
      Date.now() - this.lastUpdatedAt < this.cacheTtlMs;

    if (isCacheValid) {
      return [...this.cachedSymbols];
    }

    if (this.isRefreshing) {
      if (this.cachedSymbols.length > 0) {
        return [...this.cachedSymbols];
      }
    }

    this.isRefreshing = true;
    const start = Date.now();

    try {
      console.log(`[WORKER] Discovering Binance Futures Universe from ${this.baseUrl}/fapi/v1/exchangeInfo...`);
      const url = new URL('/fapi/v1/exchangeInfo', this.baseUrl);
      binanceNetworkGuard.assertTestnetTraffic(url.toString(), 'FuturesUniverseProvider');
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ApexAI-Worker/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        console.warn(`[WORKER] exchangeInfo request failed: HTTP ${res.status} ${res.statusText} (${latencyMs}ms)`);
        return this.cachedSymbols.length > 0 ? [...this.cachedSymbols] : [];
      }

      const data = await res.json();
      if (!data || !Array.isArray(data.symbols)) {
        console.warn('[WORKER] exchangeInfo response did not contain symbols array');
        return this.cachedSymbols.length > 0 ? [...this.cachedSymbols] : [];
      }

      this.totalExchangeSymbols = data.symbols.length;

      // Filter: PERPETUAL + USDT + TRADING
      const tradable: string[] = [];
      for (const s of data.symbols as BinanceRawSymbol[]) {
        if (
          s &&
          typeof s.symbol === 'string' &&
          s.contractType === 'PERPETUAL' &&
          s.quoteAsset === 'USDT' &&
          s.status === 'TRADING'
        ) {
          tradable.push(s.symbol.toUpperCase());
        }
      }

      if (tradable.length > 0) {
        this.cachedSymbols = tradable;
        this.lastUpdatedAt = Date.now();
        console.log(`[WORKER] Tradable USDT-M Futures Universe discovered: ${tradable.length} active PERPETUAL symbols (out of ${this.totalExchangeSymbols} exchange symbols) in ${latencyMs}ms.`);
      } else {
        console.warn('[WORKER] Zero tradable USDT-M futures symbols found in exchangeInfo response');
      }

      return [...this.cachedSymbols];
    } catch (err: any) {
      console.warn(`[WORKER] Futures universe discovery failed: ${err.message}`);
      return this.cachedSymbols.length > 0 ? [...this.cachedSymbols] : [];
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Returns current metadata about discovered universe.
   */
  public getUniverseMetadata(): FuturesUniverseMetadata {
    return {
      count: this.cachedSymbols.length,
      lastUpdatedAt: this.lastUpdatedAt,
      isStale: this.cachedSymbols.length === 0 || Date.now() - this.lastUpdatedAt >= this.cacheTtlMs,
      totalExchangeSymbols: this.totalExchangeSymbols,
    };
  }
}

export const futuresUniverseProvider = new BinanceFuturesUniverseProvider();
