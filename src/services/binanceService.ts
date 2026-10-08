import { AccountBalance, BinanceCredentials, Candle, FuturesSymbolInfo } from '../types/trading';
import { diagnosticManager } from './diagnosticManager';
import { IndicatorService } from './indicatorService';

function extractResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    headers.forEach((val, key) => {
      result[key] = val;
    });
  } catch {
    // fallback
  }
  return result;
}

export class BinanceService {
  static async ping(isTestnet = false): Promise<{ success: boolean; latency?: number; headers?: Record<string, string>; error?: string }> {
    const startTime = performance.now();
    try {
      const res = await fetch(`/api/binance/ping?testnet=${isTestnet}`);
      const durationMs = Math.round(performance.now() - startTime);
      const headers = extractResponseHeaders(res.headers);

      diagnosticManager.recordApiCall({
        url: `/api/binance/ping?testnet=${isTestnet}`,
        status: res.status,
        statusText: res.statusText,
        headers,
        durationMs,
        error: !res.ok ? `HTTP ${res.status}` : undefined,
      });

      if (res.ok) {
        const data = await res.json();
        return { success: true, latency: durationMs, headers: data.headers || headers };
      }

      // Direct ping fallback
      const base = isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
      const direct = await fetch(`${base}/fapi/v1/ping`);
      const directDuration = Math.round(performance.now() - startTime);
      const directHeaders = extractResponseHeaders(direct.headers);

      return { success: direct.ok, latency: directDuration, headers: directHeaders };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async fetchExchangeInfo(isTestnet = false) {
    const startTime = performance.now();
    try {
      const res = await fetch(`/api/binance/exchangeInfo?testnet=${isTestnet}`);
      const durationMs = Math.round(performance.now() - startTime);
      const headers = extractResponseHeaders(res.headers);

      diagnosticManager.recordApiCall({
        url: `/api/binance/exchangeInfo?testnet=${isTestnet}`,
        status: res.status,
        statusText: res.statusText,
        headers,
        durationMs,
      });

      if (res.ok) {
        return await res.json();
      }

      const base = isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
      const direct = await fetch(`${base}/fapi/v1/exchangeInfo`);
      return await direct.json();
    } catch (err: any) {
      console.error('Failed to fetch exchange info:', err);
      return { success: false, symbols: [] };
    }
  }

  static async fetchOrderBookDepth(
    symbol: string,
    limit = 20,
    isTestnet = false
  ): Promise<{
    bids: Array<[string, string]>;
    asks: Array<[string, string]>;
    imbalanceRatio: number;
    spread: number;
    spreadPercent: number;
  }> {
    try {
      const res = await fetch(`/api/binance/depth?symbol=${symbol}&limit=${limit}&testnet=${isTestnet}`);
      if (res.ok) {
        const data = await res.json();
        if (data.bids && data.asks) {
          const calc = IndicatorService.calculateOrderBookImbalance(data.bids, data.asks);
          return {
            bids: data.bids,
            asks: data.asks,
            imbalanceRatio: calc.imbalanceRatio,
            spread: calc.spread,
            spreadPercent: calc.spreadPercent,
          };
        }
      }

      // Direct fallback
      const base = isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
      const direct = await fetch(`${base}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`);
      if (direct.ok) {
        const data = await direct.json();
        const calc = IndicatorService.calculateOrderBookImbalance(data.bids || [], data.asks || []);
        return {
          bids: data.bids || [],
          asks: data.asks || [],
          imbalanceRatio: calc.imbalanceRatio,
          spread: calc.spread,
          spreadPercent: calc.spreadPercent,
        };
      }
    } catch (e) {
      console.warn(`Depth fetch failed for ${symbol}:`, e);
    }

    return {
      bids: [],
      asks: [],
      imbalanceRatio: 1.0,
      spread: 0,
      spreadPercent: 0,
    };
  }

  static async fetch24hrTickers(isTestnet = false): Promise<FuturesSymbolInfo[]> {
    let raw: any = null;
    const fetchStart = Date.now();

    // 1. Direct client-side fetch to Binance Futures Public API
    try {
      const directBase = isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
      const directRes = await fetch(`${directBase}/fapi/v1/ticker/24hr`, {
        headers: { Accept: 'application/json' },
      });
      if (directRes.ok) {
        const directData = await directRes.json();
        if (Array.isArray(directData) && directData.length > 0) {
          raw = directData;
        }
      }
    } catch {
      // direct fail, try proxy
    }

    // 2. Second Priority: Vercel / Express Backend Proxy
    if (!Array.isArray(raw) || raw.length === 0) {
      try {
        const res = await fetch(`/api/binance/ticker24hr?testnet=${isTestnet}`);
        if (res.ok) {
          const text = await res.text();
          if (text && text.trim().startsWith('[')) {
            raw = JSON.parse(text);
          }
        }
      } catch (proxyErr) {
        console.error('[Binance API] Backend proxy ticker fetch failed:', proxyErr);
      }
    }

    if (!Array.isArray(raw) || raw.length === 0) {
      return [];
    }

    const dataFreshnessMs = Date.now() - fetchStart;

    try {
      // Filter USDT contracts and parse real numerical exchange fields
      const usdtPairs: FuturesSymbolInfo[] = raw
        .filter((t: any) => t && t.symbol && t.symbol.endsWith('USDT'))
        .map((t: any) => {
          const price = parseFloat(t.lastPrice || '0');
          const change = parseFloat(t.priceChangePercent || '0');
          const vol = parseFloat(t.quoteVolume || '0');
          const high = parseFloat(t.highPrice || '0');
          const low = parseFloat(t.lowPrice || '0');
          const bidPrice = parseFloat(t.bidPrice || t.lastPrice || '0');
          const askPrice = parseFloat(t.askPrice || t.lastPrice || '0');

          const spread = Math.max(0, askPrice - bidPrice);
          const midPrice = price > 0 ? price : 1;
          const spreadPercent = Number(((spread / midPrice) * 100).toFixed(3));

          // Base trend from 24h price action
          let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
          if (change > 1.5) trend = 'BULLISH';
          else if (change < -1.5) trend = 'BEARISH';

          // Precision calculation based on price magnitude
          let pricePrecision = 2;
          let quantityPrecision = 3;
          let minQty = 0.001;

          if (price >= 1000) {
            pricePrecision = 2;
            quantityPrecision = 3;
            minQty = 0.001;
          } else if (price >= 10) {
            pricePrecision = 3;
            quantityPrecision = 2;
            minQty = 0.01;
          } else if (price >= 1) {
            pricePrecision = 4;
            quantityPrecision = 1;
            minQty = 0.1;
          } else if (price >= 0.01) {
            pricePrecision = 5;
            quantityPrecision = 0;
            minQty = 1;
          } else {
            pricePrecision = 6;
            quantityPrecision = 0;
            minQty = 10;
          }

          // Initial RSI estimate from 24h candle until 15m candle stream updates
          const rsi14 = Math.round(Math.max(15, Math.min(85, 50 + (change > 0 ? Math.min(30, change * 2.5) : Math.max(-30, change * 2.5)))));
          const aiScore = Math.min(88, Math.max(65, Math.round(70 + Math.abs(change) * 1.5)));

          return {
            symbol: t.symbol,
            baseAsset: t.symbol.replace('USDT', ''),
            quoteAsset: 'USDT',
            pricePrecision,
            quantityPrecision,
            minQty,
            stepSize: minQty,
            tickSize: 1 / Math.pow(10, pricePrecision),
            minNotional: 5,
            price,
            markPrice: price,
            priceChangePercent: change,
            volume24h: parseFloat(t.volume || '0'),
            quoteVolume24h: vol,
            high24h: high,
            low24h: low,
            fundingRate: 0.0001,
            spreadPercent,
            rsi14,
            trend,
            marketRegime: Math.abs(change) > 4 ? 'VOLATILITY_BREAKOUT' : 'RANGING_CONSOLIDATION',
            orderbookRatio: 1.0,
            aiScore,
            aiRecommendedSignal: change > 1.2 ? 'BUY_LONG' : change < -1.2 ? 'SELL_SHORT' : 'HOLD',
            dataFreshnessMs,
            isStale: dataFreshnessMs > 45000,
            timeframe: '15m',
          };
        });

      return usdtPairs;
    } catch (e) {
      console.error('Failed parsing tickers:', e);
      return [];
    }
  }

  static async fetchKlines(
    symbol: string,
    interval = '15m',
    limit = 100,
    isTestnet = false
  ): Promise<Candle[]> {
    try {
      const res = await fetch(
        `/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&testnet=${isTestnet}`
      );
      if (res.ok) {
        return await res.json();
      }

      // Direct fallback
      const base = isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
      const direct = await fetch(`${base}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      if (direct.ok) {
        const raw = await direct.json();
        return raw.map((k: any) => ({
          time: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          quoteVolume: parseFloat(k[7]),
          tradesCount: k[8],
        }));
      }
      return [];
    } catch (err: any) {
      console.error(`Failed to fetch klines for ${symbol}:`, err);
      return [];
    }
  }

  static async checkServerConfigStatus(isTestnet = false): Promise<{
    success: boolean;
    testnetConfigured: boolean;
    prodConfigured: boolean;
    activeEnvironmentConfigured: boolean;
  }> {
    try {
      const res = await fetch(`/api/binance/config-status?testnet=${isTestnet}`);
      return await res.json();
    } catch {
      return { success: false, testnetConfigured: false, prodConfigured: false, activeEnvironmentConfigured: false };
    }
  }

  static async fetchAccount(credentials: BinanceCredentials): Promise<{
    success: boolean;
    balance?: AccountBalance;
    positions?: any[];
    error?: string;
  }> {
    try {
      const res = await fetch('/api/binance/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async fetchOpenOrders(credentials: BinanceCredentials, symbol?: string): Promise<{
    success: boolean;
    orders?: any[];
    error?: string;
  }> {
    try {
      const res = await fetch('/api/binance/openOrders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          symbol,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async setLeverage(credentials: BinanceCredentials, symbol: string, leverage: number) {
    try {
      const res = await fetch('/api/binance/leverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          symbol,
          leverage,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async placeOrder(
    credentials: BinanceCredentials,
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    reduceOnly = false,
    clientOrderId?: string
  ) {
    try {
      const res = await fetch('/api/binance/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          symbol,
          side,
          type: 'MARKET',
          quantity,
          reduceOnly,
          clientOrderId,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async placeProtectiveStopOrder(
    credentials: BinanceCredentials,
    symbol: string,
    side: 'BUY' | 'SELL',
    stopPrice: number,
    quantity: number
  ) {
    try {
      const res = await fetch('/api/binance/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          symbol,
          side,
          type: 'STOP_MARKET',
          stopPrice,
          quantity,
          reduceOnly: true,
          closePosition: false,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async cancelOrder(credentials: BinanceCredentials, symbol: string, orderId: string) {
    try {
      const res = await fetch('/api/binance/cancelOrder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          symbol,
          orderId,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async runDiagnosticProbe(isTestnet = false): Promise<{
    direct: {
      success: boolean;
      statusCode?: number;
      latencyMs: number;
      headers: Record<string, string>;
      error?: string;
    };
    backendProxy: {
      success: boolean;
      statusCode?: number;
      latencyMs: number;
      headers: Record<string, string>;
      environment?: any;
      diagnosis?: string;
      error?: string;
    };
  }> {
    const directBase = isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
    const directStart = performance.now();
    let directResult = {
      success: false,
      statusCode: 0,
      latencyMs: 0,
      headers: {} as Record<string, string>,
      error: undefined as string | undefined,
    };

    try {
      const directRes = await fetch(`${directBase}/fapi/v1/ping`);
      const directLatency = Math.round(performance.now() - directStart);
      const headers = extractResponseHeaders(directRes.headers);
      directResult = {
        success: directRes.ok,
        statusCode: directRes.status,
        latencyMs: directLatency,
        headers,
        error: undefined,
      };
    } catch (err: any) {
      directResult = {
        success: false,
        statusCode: 0,
        latencyMs: Math.round(performance.now() - directStart),
        headers: {},
        error: err.message || 'Direct ping blocked',
      };
    }

    const proxyStart = performance.now();
    let proxyResult = {
      success: false,
      statusCode: 0,
      latencyMs: 0,
      headers: {} as Record<string, string>,
      environment: undefined as any,
      diagnosis: undefined as string | undefined,
      error: undefined as string | undefined,
    };

    try {
      const proxyRes = await fetch(`/api/binance/diagnostics?testnet=${isTestnet}`);
      const proxyLatency = Math.round(performance.now() - proxyStart);
      const responseData = await proxyRes.json();
      const headers = responseData.headers || extractResponseHeaders(proxyRes.headers);

      proxyResult = {
        success: responseData.success ?? proxyRes.ok,
        statusCode: responseData.statusCode || proxyRes.status,
        latencyMs: responseData.durationMs || proxyLatency,
        headers,
        environment: responseData.environment,
        diagnosis: responseData.diagnosis,
        error: responseData.error,
      };
    } catch (err: any) {
      proxyResult = {
        success: false,
        statusCode: 500,
        latencyMs: Math.round(performance.now() - proxyStart),
        headers: {},
        environment: undefined,
        diagnosis: 'Failed to communicate with proxy',
        error: err.message,
      };
    }

    return {
      direct: directResult,
      backendProxy: proxyResult,
    };
  }
}
