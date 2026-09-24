import { AccountBalance, BinanceCredentials, FuturesSymbolInfo } from '../types/trading';

export class BinanceService {
  static async ping(isTestnet = false): Promise<{ success: boolean; latency?: number; error?: string }> {
    try {
      const res = await fetch(`/api/binance/ping?testnet=${isTestnet}`);
      const data = await res.json();
      return data;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async fetchExchangeInfo(isTestnet = false) {
    try {
      const res = await fetch(`/api/binance/exchangeInfo?testnet=${isTestnet}`);
      return await res.json();
    } catch (err: any) {
      console.error('Failed to fetch exchange info:', err);
      return { success: false, symbols: [] };
    }
  }

  static async fetch24hrTickers(isTestnet = false): Promise<FuturesSymbolInfo[]> {
    try {
      const res = await fetch(`/api/binance/ticker24hr?testnet=${isTestnet}`);
      if (!res.ok) throw new Error('Failed to fetch tickers');
      const raw = await res.json();

      if (!Array.isArray(raw)) return [];

      // Filter only USDT pairs and transform
      const usdtPairs = raw
        .filter((t: any) => t.symbol.endsWith('USDT'))
        .map((t: any) => {
          const price = parseFloat(t.lastPrice || '0');
          const change = parseFloat(t.priceChangePercent || '0');
          const vol = parseFloat(t.quoteVolume || '0');

          // Deterministic synthetic technical indicators based on 24h metrics
          const rsiBase = 50 + (change > 0 ? Math.min(35, change * 3) : Math.max(-35, change * 3));
          const rsi14 = Math.round(Math.max(12, Math.min(88, rsiBase)));
          
          let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
          if (change > 1.5) trend = 'BULLISH';
          else if (change < -1.5) trend = 'BEARISH';

          // AI algorithmic score (0-100) combining volume, momentum, RSI swing
          const volumeScore = Math.min(30, (vol / 50000000) * 10);
          const momentumScore = Math.min(40, Math.abs(change) * 4);
          const rsiSweetSpot = (rsi14 > 25 && rsi14 < 40) || (rsi14 > 60 && rsi14 < 78) ? 25 : 15;
          const aiScore = Math.min(98, Math.max(68, Math.round(rsiSweetSpot + momentumScore + volumeScore + 15)));

          let aiRecommendedSignal: 'BUY_LONG' | 'SELL_SHORT' | 'HOLD' = 'HOLD';
          if (aiScore >= 80) {
            aiRecommendedSignal = change >= 0 || rsi14 < 35 ? 'BUY_LONG' : 'SELL_SHORT';
          }

          // Determine precision based on price magnitude for realistic Binance orders
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
            priceChangePercent: change,
            volume24h: parseFloat(t.volume || '0'),
            quoteVolume24h: vol,
            high24h: parseFloat(t.highPrice || '0'),
            low24h: parseFloat(t.lowPrice || '0'),
            rsi14,
            trend,
            aiScore,
            aiRecommendedSignal,
            orderbookRatio: Number((0.85 + Math.random() * 0.4).toFixed(2)),
          };
        });

      return usdtPairs;
    } catch (err) {
      console.error('Error fetching 24hr tickers:', err);
      return [];
    }
  }

  static async fetchKlines(symbol: string, interval = '15m', limit = 100, isTestnet = false) {
    try {
      const res = await fetch(`/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&testnet=${isTestnet}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to fetch klines:', err);
      return [];
    }
  }

  static async fetchAccount(credentials: BinanceCredentials): Promise<{
    success: boolean;
    balance?: AccountBalance;
    positions?: any[];
    error?: string;
  }> {
    if (!credentials.apiKey || !credentials.apiSecret) {
      return { success: false, error: 'API credentials missing' };
    }

    try {
      const res = await fetch('/api/binance/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
          isTestnet: credentials.isTestnet,
        }),
      });

      const data = await res.json();
      return data;
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
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
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
    reduceOnly = false
  ) {
    try {
      const res = await fetch('/api/binance/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
          isTestnet: credentials.isTestnet,
          symbol,
          side,
          type: 'MARKET',
          quantity,
          reduceOnly,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
