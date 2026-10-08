import { FuturesSymbolInfo, Candle } from '../types/trading';
import { MarketDataProvider, MarketSnapshot } from './tradingLoopEngine';
import { futuresUniverseProvider } from './futuresUniverseProvider';

import { BINANCE_FUTURES_BASE_URL } from './workerConstants';
import { binanceNetworkGuard } from './binanceNetworkGuard';
export { BINANCE_FUTURES_BASE_URL };

export interface ServerMarketDataConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * ServerMarketDataProvider — READ-ONLY
 *
 * Fetches public market data (prices, klines, 24hr tickers) directly from
 * Binance Futures REST API within Node.js.
 *
 * Strictly READ-ONLY:
 * - No API keys or secrets
 * - No WebSocket connection
 * - No order placement or trading actions
 * - No internal interval/polling timers (polling is driven on-demand by TradingLoopEngine)
 */
export class ServerMarketDataProvider implements MarketDataProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config?: ServerMarketDataConfig) {
    this.baseUrl = config?.baseUrl || BINANCE_FUTURES_BASE_URL;
    this.timeoutMs = config?.timeoutMs || 6000;
    console.log(`[WORKER] Market data provider initialized (Base URL: ${this.baseUrl}, Timeout: ${this.timeoutMs}ms).`);
  }

  /**
   * Helper to perform validated HTTP GET requests with timeout.
   */
  private async safeGetJson<T>(endpoint: string, params?: Record<string, string | number>): Promise<T | null> {
    const url = new URL(endpoint, this.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        url.searchParams.set(key, String(val));
      });
    }

    const start = Date.now();
    try {
      binanceNetworkGuard.assertTestnetTraffic(url.toString(), 'ServerMarketDataProvider');
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ApexAI-Worker/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        console.warn(`[WORKER] Market data request failed for ${url.pathname}: HTTP ${response.status} ${response.statusText} (${latencyMs}ms)`);
        return null;
      }

      const rawText = await response.text();
      if (!rawText || !rawText.trim()) {
        console.warn(`[WORKER] Market data validation failed: Empty response body from ${url.pathname}`);
        return null;
      }

      try {
        return JSON.parse(rawText) as T;
      } catch (parseErr: any) {
        console.warn(`[WORKER] Market data validation failed: Malformed JSON from ${url.pathname}: ${parseErr.message}`);
        return null;
      }
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        console.warn(`[WORKER] Market data request timed out after ${this.timeoutMs}ms for ${url.pathname}`);
      } else {
        console.warn(`[WORKER] Market data request failed for ${url.pathname}: ${err.message} (${latencyMs}ms)`);
      }
      return null;
    }
  }

  /**
   * Fetches latest ticker price for a single symbol.
   * Endpoint: GET /fapi/v1/ticker/price?symbol=...
   */
  public async getPrice(symbol: string): Promise<number | null> {
    if (!symbol || typeof symbol !== 'string') {
      console.warn('[WORKER] Market data validation failed: Invalid symbol argument');
      return null;
    }

    const cleanSymbol = symbol.trim().toUpperCase();
    const data = await this.safeGetJson<{ symbol: string; price: string; time: number }>(
      '/fapi/v1/ticker/price',
      { symbol: cleanSymbol }
    );

    if (!data || typeof data !== 'object') {
      return null;
    }

    if (!data.price || typeof data.price !== 'string') {
      console.warn(`[WORKER] Market data validation failed: Missing price string for ${cleanSymbol}`);
      return null;
    }

    const priceNum = parseFloat(data.price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      console.warn(`[WORKER] Market data validation failed: Price must be finite and > 0, received: ${data.price}`);
      return null;
    }

    return priceNum;
  }

  /**
   * Fetches candlestick / klines history for a symbol.
   * Endpoint: GET /fapi/v1/klines?symbol=...&interval=...&limit=...
   */
  public async getKlines(symbol: string, interval = '15m', limit = 100): Promise<Candle[]> {
    if (!symbol || typeof symbol !== 'string') {
      console.warn('[WORKER] Market data validation failed: Invalid symbol for klines');
      return [];
    }

    const cleanSymbol = symbol.trim().toUpperCase();
    const safeLimit = Math.min(Math.max(1, limit), 500);

    const rawKlines = await this.safeGetJson<any[]>('/fapi/v1/klines', {
      symbol: cleanSymbol,
      interval,
      limit: safeLimit,
    });

    if (!Array.isArray(rawKlines) || rawKlines.length === 0) {
      return [];
    }

    const validatedCandles: Candle[] = [];

    for (const k of rawKlines) {
      if (!Array.isArray(k) || k.length < 8) {
        continue;
      }

      const time = Number(k[0]);
      const open = parseFloat(k[1]);
      const high = parseFloat(k[2]);
      const low = parseFloat(k[3]);
      const close = parseFloat(k[4]);
      const volume = parseFloat(k[5]);
      const quoteVolume = parseFloat(k[7]);
      const tradesCount = typeof k[8] === 'number' ? k[8] : 0;

      // Strict Validation: open, high, low, close must be finite and > 0, high >= low
      if (
        !Number.isFinite(time) || time <= 0 ||
        !Number.isFinite(open) || open <= 0 ||
        !Number.isFinite(high) || high <= 0 ||
        !Number.isFinite(low) || low <= 0 ||
        !Number.isFinite(close) || close <= 0 ||
        !Number.isFinite(volume) || volume < 0 ||
        high < low
      ) {
        console.warn(`[WORKER] Market data validation failed: Malformed candle item for ${cleanSymbol}`);
        continue;
      }

      validatedCandles.push({
        time,
        open,
        high,
        low,
        close,
        volume,
        quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : volume * close,
        tradesCount,
      });
    }

    return validatedCandles;
  }

  /**
   * Fetches 24hr market ticker snapshot.
   * Endpoint: GET /fapi/v1/ticker/24hr
   */
  public async getMarketSnapshot(symbols?: string[]): Promise<MarketSnapshot> {
    let targetSet: Set<string> | null = null;
    if (symbols && symbols.length > 0) {
      targetSet = new Set(symbols.map(s => s.toUpperCase()));
    } else {
      const tradable = await futuresUniverseProvider.getTradableSymbols();
      if (tradable.length > 0) {
        targetSet = new Set(tradable);
      }
    }

    const rawData = await this.safeGetJson<any[]>('/fapi/v1/ticker/24hr');

    if (!Array.isArray(rawData) || rawData.length === 0) {
      return {
        timestamp: Date.now(),
        pairs: [],
      };
    }

    const pairs: FuturesSymbolInfo[] = [];

    for (const t of rawData) {
      if (!t || typeof t !== 'object') continue;

      const symbol = t.symbol;
      if (!symbol || typeof symbol !== 'string' || !symbol.endsWith('USDT')) {
        continue;
      }

      if (targetSet && !targetSet.has(symbol)) {
        continue;
      }

      const price = parseFloat(t.lastPrice || '0');
      const change = parseFloat(t.priceChangePercent || '0');
      const vol = parseFloat(t.quoteVolume || '0');
      const high = parseFloat(t.highPrice || '0');
      const low = parseFloat(t.lowPrice || '0');
      const volume24h = parseFloat(t.volume || '0');

      // Validation
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }

      const bidPrice = parseFloat(t.bidPrice || t.lastPrice || '0');
      const askPrice = parseFloat(t.askPrice || t.lastPrice || '0');
      const spread = Math.max(0, askPrice - bidPrice);
      const spreadPercent = Number(((spread / price) * 100).toFixed(3));

      let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
      if (change > 1.5) trend = 'BULLISH';
      else if (change < -1.5) trend = 'BEARISH';

      pairs.push({
        symbol,
        baseAsset: symbol.replace('USDT', ''),
        quoteAsset: 'USDT',
        pricePrecision: price < 1 ? 4 : 2,
        quantityPrecision: 3,
        minQty: 0.001,
        stepSize: 0.001,
        tickSize: price < 1 ? 0.0001 : 0.01,
        minNotional: 5,
        price,
        markPrice: price,
        priceChangePercent: Number.isFinite(change) ? change : 0,
        volume24h: Number.isFinite(volume24h) ? volume24h : 0,
        quoteVolume24h: Number.isFinite(vol) ? vol : 0,
        high24h: Number.isFinite(high) ? high : price,
        low24h: Number.isFinite(low) ? low : price,
        fundingRate: 0.0001,
        spreadPercent: Number.isFinite(spreadPercent) ? spreadPercent : 0,
        rsi14: 50,
        trend,
        marketRegime: Math.abs(change) > 4 ? 'VOLATILITY_BREAKOUT' : 'RANGING_CONSOLIDATION',
        orderbookRatio: 1.0,
        aiScore: 50,
        aiRecommendedSignal: change > 1.2 ? 'BUY_LONG' : change < -1.2 ? 'SELL_SHORT' : 'HOLD',
        dataFreshnessMs: 0,
        isStale: false,
        timeframe: '15m',
      });
    }

    return {
      timestamp: Date.now(),
      pairs,
    };
  }
}

export const serverMarketDataProvider = new ServerMarketDataProvider();
