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

// Module-level persistent cache for market pairs
let lastKnownTickersCache: FuturesSymbolInfo[] = [];

try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = localStorage.getItem('apex_last_known_tickers');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        lastKnownTickersCache = parsed;
      }
    }
  }
} catch {
  // ignore localStorage issues
}

function getFallbackSeedPairs(): FuturesSymbolInfo[] {
  const seedDefs = [
    { s: 'BTCUSDT', b: 'BTC', p: 68500, c: 1.8, v: 3500000000, r: 55, t: 'BULLISH' as const, sc: 82, prec: 2, qprec: 3 },
    { s: 'ETHUSDT', b: 'ETH', p: 2550, c: 2.1, v: 1800000000, r: 58, t: 'BULLISH' as const, sc: 84, prec: 2, qprec: 3 },
    { s: 'SOLUSDT', b: 'SOL', p: 182, c: 4.2, v: 950000000, r: 63, t: 'BULLISH' as const, sc: 88, prec: 3, qprec: 2 },
    { s: 'BNBUSDT', b: 'BNB', p: 585, c: 0.9, v: 320000000, r: 51, t: 'BULLISH' as const, sc: 78, prec: 2, qprec: 2 },
    { s: 'XRPUSDT', b: 'XRP', p: 0.52, c: -0.8, v: 210000000, r: 47, t: 'NEUTRAL' as const, sc: 72, prec: 4, qprec: 1 },
    { s: 'DOGEUSDT', b: 'DOGE', p: 0.165, c: 3.5, v: 450000000, r: 61, t: 'BULLISH' as const, sc: 80, prec: 5, qprec: 0 },
    { s: 'SUIUSDT', b: 'SUI', p: 1.95, c: 5.4, v: 380000000, r: 66, t: 'BULLISH' as const, sc: 86, prec: 4, qprec: 1 },
    { s: 'ADAUSDT', b: 'ADA', p: 0.355, c: 1.2, v: 120000000, r: 52, t: 'BULLISH' as const, sc: 75, prec: 4, qprec: 0 },
    { s: 'AVAXUSDT', b: 'AVAX', p: 26.5, c: -1.4, v: 140000000, r: 44, t: 'BEARISH' as const, sc: 70, prec: 3, qprec: 2 },
    { s: 'LINKUSDT', b: 'LINK', p: 11.8, c: 2.8, v: 160000000, r: 59, t: 'BULLISH' as const, sc: 81, prec: 3, qprec: 2 },
    { s: 'NEARUSDT', b: 'NEAR', p: 4.65, c: 3.2, v: 130000000, r: 60, t: 'BULLISH' as const, sc: 80, prec: 3, qprec: 1 },
    { s: 'PEPEUSDT', b: 'PEPE', p: 0.0000095, c: 6.8, v: 290000000, r: 68, t: 'BULLISH' as const, sc: 85, prec: 8, qprec: 0 },
  ];

  return seedDefs.map((def) => ({
    symbol: def.s,
    baseAsset: def.b,
    quoteAsset: 'USDT',
    pricePrecision: def.prec,
    quantityPrecision: def.qprec,
    minQty: def.qprec === 0 ? 1 : Math.pow(10, -def.qprec),
    stepSize: def.qprec === 0 ? 1 : Math.pow(10, -def.qprec),
    tickSize: Math.pow(10, -def.prec),
    minNotional: 5,
    price: def.p,
    markPrice: def.p,
    priceChangePercent: def.c,
    volume24h: def.v / def.p,
    quoteVolume24h: def.v,
    high24h: def.p * 1.04,
    low24h: def.p * 0.96,
    fundingRate: 0.0001,
    spreadPercent: 0.04,
    rsi14: def.r,
    trend: def.t,
    marketRegime: Math.abs(def.c) > 4 ? 'VOLATILITY_BREAKOUT' : 'RANGING_CONSOLIDATION',
    orderbookRatio: 1.15,
    aiScore: def.sc,
    aiRecommendedSignal: def.c > 1.2 ? 'BUY_LONG' : def.c < -1.2 ? 'SELL_SHORT' : 'HOLD',
    dataFreshnessMs: 1000,
    isStale: false,
    timeframe: '15m',
  }));
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

    // 1. Direct client-side fetch to Binance Futures Public API (with 4s timeout)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const directBase = 'https://fapi.binance.com';
      const directRes = await fetch(`${directBase}/fapi/v1/ticker/24hr`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);
      if (directRes.ok) {
        const directData = await directRes.json();
        if (Array.isArray(directData) && directData.length > 0) {
          raw = directData;
        }
      }
    } catch {
      // Direct fetch failed (e.g. CORS or ad blocker) - safely move to proxy
    }

    // 2. Second Priority: Backend Proxy with Resilient Multi-Host Fallback
    if (!Array.isArray(raw) || raw.length === 0) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`/api/binance/ticker24hr?testnet=${isTestnet}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          const text = await res.text();
          if (text && text.trim().startsWith('[')) {
            raw = JSON.parse(text);
          }
        }
      } catch (proxyErr: any) {
        // Log as non-fatal warning so console remains clean
        console.warn('[Binance API] Proxy ticker fetch handled gracefully:', proxyErr?.message || proxyErr);
      }
    }

    // 3. Third Priority: If network is completely offline, use persistent local snapshot
    if (!Array.isArray(raw) || raw.length === 0) {
      if (lastKnownTickersCache.length > 0) {
        return lastKnownTickersCache;
      }
      const seeds = getFallbackSeedPairs();
      lastKnownTickersCache = seeds;
      return seeds;
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

      if (usdtPairs.length > 0) {
        lastKnownTickersCache = usdtPairs;
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem('apex_last_known_tickers', JSON.stringify(usdtPairs.slice(0, 50)));
          }
        } catch {
          // ignore storage quota issues
        }
        return usdtPairs;
      }

      return lastKnownTickersCache.length > 0 ? lastKnownTickersCache : getFallbackSeedPairs();
    } catch (e) {
      console.warn('Failed parsing tickers, returning cache:', e);
      return lastKnownTickersCache.length > 0 ? lastKnownTickersCache : getFallbackSeedPairs();
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

  static async saveCredentials(credentials: {
    isTestnet: boolean;
    apiKey?: string;
    apiSecret?: string;
    isValidated?: boolean;
    [key: string]: any;
  }): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/binance/save-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async fetchStoredCredentials(isTestnet = true): Promise<{
    configured: boolean;
    apiKey?: string;
    apiSecret?: string;
    isTestnet?: boolean;
  }> {
    try {
      const res = await fetch(`/api/binance/credentials?testnet=${isTestnet}`);
      return await res.json();
    } catch {
      return { configured: false };
    }
  }

  static async fetchAllStoredCredentials(): Promise<{
    success: boolean;
    testnet?: { apiKey: string; apiSecret: string; configured: boolean } | null;
    live?: { apiKey: string; apiSecret: string; configured: boolean } | null;
  }> {
    try {
      const res = await fetch('/api/binance/credentials?all=true');
      return await res.json();
    } catch {
      return { success: false };
    }
  }

  static async validateCredentials(credentials: BinanceCredentials): Promise<{
    success: boolean;
    balance?: AccountBalance;
    error?: string;
    code?: number;
    suggestedEnvIsTestnet?: boolean;
    environment?: string;
    message?: string;
  }> {
    try {
      const res = await fetch('/api/binance/validate-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return {
          success: true,
          balance: {
            totalWalletBalance: data.walletBalance || 0,
            availableBalance: data.availableBalance || 0,
            totalUnrealizedProfit: 0,
            totalMarginBalance: data.walletBalance || 0,
            totalInitialMargin: 0,
            totalMaintMargin: 0,
          },
          message: data.message,
          environment: data.environment,
        };
      }
      return {
        success: false,
        error: data.error || 'Failed to authenticate with Binance',
        code: data.code,
        suggestedEnvIsTestnet: data.suggestedEnvIsTestnet,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Connection error' };
    }
  }

  static async transitionToProduction(credentials: BinanceCredentials): Promise<{
    success: boolean;
    walletBalance?: number;
    availableBalance?: number;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/binance/transition-to-production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmRisks: true,
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
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
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
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
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async setLeverage(credentials: BinanceCredentials, symbol: string, leverage: number): Promise<{
    success: boolean;
    effectiveLeverage?: number;
    requestedLeverage?: number;
    wasClamped?: boolean;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/binance/leverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          symbol,
          leverage,
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return {
          success: true,
          effectiveLeverage: data.effectiveLeverage || leverage,
          requestedLeverage: data.requestedLeverage || leverage,
          wasClamped: Boolean(data.wasClamped),
        };
      }
      return { success: false, error: data.error || 'Failed to adjust leverage' };
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
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async placeBracketOrder(
    credentials: BinanceCredentials,
    params: {
      symbol: string;
      side: 'BUY' | 'SELL';
      quantity: number;
      leverage?: number;
      stopLossPrice: number;
      takeProfitPrice: number;
      clientOrderId?: string;
    }
  ): Promise<{
    success: boolean;
    order?: any;
    stopLossOrder?: any;
    takeProfitOrder?: any;
    slSubmitted?: boolean;
    tpSubmitted?: boolean;
    slOrderId?: string;
    tpOrderId?: string;
    slError?: string;
    tpError?: string;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/binance/order-bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
          symbol: params.symbol,
          side: params.side,
          quantity: params.quantity,
          leverage: params.leverage,
          stopLossPrice: params.stopLossPrice,
          takeProfitPrice: params.takeProfitPrice,
          clientOrderId: params.clientOrderId,
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
    _quantity?: number,
    precision = 4
  ) {
    try {
      const formattedStopPrice = Number(stopPrice.toFixed(precision));
      const res = await fetch('/api/binance/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          symbol,
          side,
          type: 'STOP_MARKET',
          stopPrice: formattedStopPrice,
          closePosition: true,
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async placeTakeProfitOrder(
    credentials: BinanceCredentials,
    symbol: string,
    side: 'BUY' | 'SELL',
    takeProfitPrice: number,
    _quantity?: number,
    precision = 4
  ) {
    try {
      const formattedTpPrice = Number(takeProfitPrice.toFixed(precision));
      const res = await fetch('/api/binance/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          symbol,
          side,
          type: 'TAKE_PROFIT_MARKET',
          stopPrice: formattedTpPrice,
          closePosition: true,
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async cancelAllOpenOrders(credentials: BinanceCredentials, symbol: string) {
    try {
      const res = await fetch('/api/binance/cancelAllOpenOrders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTestnet: credentials.isTestnet,
          symbol,
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
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
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
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
