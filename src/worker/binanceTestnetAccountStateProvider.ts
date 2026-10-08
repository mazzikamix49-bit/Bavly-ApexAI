import crypto from 'node:crypto';
import { AccountState, AccountStateProvider, RemotePosition } from './accountStateProvider';
import { BINANCE_FUTURES_ACCOUNT_BASE_URL } from './workerConstants';
import { binanceNetworkGuard } from './binanceNetworkGuard';

export interface BinanceTestnetProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  timeoutMs?: number;
  recvWindow?: number;
}

/**
 * BinanceTestnetAccountStateProvider — READ-ONLY
 *
 * Connects strictly to Binance USDT-M Futures Testnet to read account and position data.
 * Produces a normalized AccountState representation for AccountReconciliationService.
 *
 * STRICT SAFETY INVARIANTS:
 * - 100% READ-ONLY: Never places, closes, modifies, or cancels any orders
 * - Testnet ONLY: Hard-guarded against production Binance URLs
 * - Secrets Protected: Never logs, outputs, or serializes the API secret or signature
 * - Non-crashing: Returns { available: false } on missing credentials or network errors
 * - Zero Financial Fallbacks: Never invents $20 or any mock balance
 */
export class BinanceTestnetAccountStateProvider implements AccountStateProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly timeoutMs: number;
  private readonly recvWindow: number;

  constructor(options?: BinanceTestnetProviderOptions) {
    const rawUrl = options?.baseUrl || BINANCE_FUTURES_ACCOUNT_BASE_URL;
    binanceNetworkGuard.assertTestnetTraffic(rawUrl, 'BinanceTestnetAccountStateProvider');

    this.baseUrl = rawUrl.replace(/\/+$/, '');
    this.apiKey = (options?.apiKey ?? process.env.BINANCE_TESTNET_API_KEY ?? '').trim();
    this.apiSecret = (options?.apiSecret ?? process.env.BINANCE_TESTNET_API_SECRET ?? '').trim();
    this.timeoutMs = options?.timeoutMs || 6000;
    this.recvWindow = options?.recvWindow || 5000;
  }

  /**
   * Reads account and position information from Binance Futures Testnet.
   * Method is purely READ-ONLY (GET /fapi/v2/account).
   */
  public async getAccountState(): Promise<AccountState> {
    const timestamp = Date.now();

    // 1. Guard against missing credentials
    if (!this.apiKey || !this.apiSecret) {
      return {
        available: false,
        source: 'BINANCE_FUTURES_TESTNET',
        timestamp,
        openPositions: [],
        error: 'Binance Testnet credentials not configured in Worker environment.',
      };
    }

    try {
      // 2. Build signed query string (HMAC SHA256)
      const queryString = `recvWindow=${this.recvWindow}&timestamp=${timestamp}`;
      const signature = crypto
        .createHmac('sha256', this.apiSecret)
        .update(queryString)
        .digest('hex');

      const url = `${this.baseUrl}/fapi/v2/account?${queryString}&signature=${signature}`;
      binanceNetworkGuard.assertTestnetTraffic(url, 'BinanceTestnetAccountStateProvider.getAccountState');

      // 3. Send GET request with AbortSignal timeout
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'Accept': 'application/json',
          'User-Agent': 'ApexAI-Worker/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      // 4. Handle HTTP authentication or client errors gracefully
      if (res.status === 401 || res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        return {
          available: false,
          source: 'BINANCE_FUTURES_TESTNET',
          timestamp: Date.now(),
          openPositions: [],
          error: `Binance Testnet authentication error (${res.status}): ${errJson.msg || 'Unauthorized'}`,
        };
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          available: false,
          source: 'BINANCE_FUTURES_TESTNET',
          timestamp: Date.now(),
          openPositions: [],
          error: `Binance Testnet HTTP ${res.status}: ${errText.slice(0, 150) || res.statusText}`,
        };
      }

      // 5. Parse JSON payload
      const rawData = await res.json();
      if (!rawData || typeof rawData !== 'object') {
        return {
          available: false,
          source: 'BINANCE_FUTURES_TESTNET',
          timestamp: Date.now(),
          openPositions: [],
          error: 'Malformed response received from Binance Testnet.',
        };
      }

      // 6. Map balances and equity (strictly without fallbacks)
      const availableBalance = parseFloat(rawData.availableBalance || 'NaN');
      const totalWalletBalance = parseFloat(rawData.totalWalletBalance || 'NaN');
      const totalMarginBalance = parseFloat(rawData.totalMarginBalance || 'NaN');
      const equity = Number.isFinite(totalMarginBalance) ? totalMarginBalance : undefined;

      // 7. Map open positions using pure mapping function
      const { positions: openPositions, warnings: mappingWarnings } =
        BinanceTestnetAccountStateProvider.mapBinancePositions(rawData.positions);

      if (mappingWarnings.length > 0) {
        for (const w of mappingWarnings) {
          console.warn(`[WORKER] [ACCOUNT] ${w}`);
        }
      }

      // 8. Enrich open positions with authentic live markPrice from Binance Testnet premiumIndex
      for (const op of openPositions) {
        try {
          const liveMark = await this.getMarkPrice(op.symbol);
          if (liveMark !== null) {
            op.markPrice = liveMark;
          }
        } catch {
          // If unavailable, op.markPrice remains undefined without fake fallbacks
        }
      }

      return {
        available: true,
        source: 'BINANCE_FUTURES_TESTNET',
        timestamp: Date.now(),
        availableBalance: Number.isFinite(availableBalance) ? availableBalance : undefined,
        totalWalletBalance: Number.isFinite(totalWalletBalance) ? totalWalletBalance : undefined,
        totalMarginBalance: Number.isFinite(totalMarginBalance) ? totalMarginBalance : undefined,
        equity,
        openPositions,
      };
    } catch (err: any) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
      const errorMsg = isTimeout
        ? 'Network timeout connecting to Binance Futures Testnet'
        : `Failed to fetch account state: ${err.message || String(err)}`;

      return {
        available: false,
        source: 'BINANCE_FUTURES_TESTNET',
        timestamp: Date.now(),
        openPositions: [],
        error: errorMsg,
      };
    }
  }

  /**
   * Pure mapping function that transforms raw Binance positions into normalized RemotePosition objects.
   * Enforces:
   * - One-Way Mode (positionSide === 'BOTH'):
   *     positionAmt > 0 -> LONG with positive quantity Math.abs(positionAmt)
   *     positionAmt < 0 -> SHORT with positive quantity Math.abs(positionAmt)
   *     positionAmt == 0 -> excluded (flat)
   * - Hedge Mode (positionSide === 'LONG' or 'SHORT'):
   *     positionSide === 'LONG' -> LONG with positive quantity Math.abs(positionAmt)
   *     positionSide === 'SHORT' -> SHORT with positive quantity Math.abs(positionAmt)
   * - Non-numeric or invalid amounts/sides:
   *     safely skipped with warning recorded, no crashes.
   */
  public static mapBinancePositions(rawPositions: unknown): {
    positions: RemotePosition[];
    warnings: string[];
  } {
    const positions: RemotePosition[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(rawPositions)) {
      return { positions, warnings };
    }

    for (const p of rawPositions) {
      if (!p || typeof p !== 'object') continue;
      const rawPos = p as Record<string, unknown>;
      const symbol = typeof rawPos.symbol === 'string' ? rawPos.symbol.trim().toUpperCase() : '';
      if (!symbol) continue;

      const rawAmt = rawPos.positionAmt;
      const positionAmt = typeof rawAmt === 'number' ? rawAmt : parseFloat(String(rawAmt ?? '0'));
      if (!Number.isFinite(positionAmt)) {
        warnings.push(`Position for ${symbol} has invalid non-numeric quantity '${String(rawAmt)}', skipping.`);
        continue;
      }

      if (Math.abs(positionAmt) === 0) {
        continue; // Flat / zero position, ignore
      }

      const quantity = Math.abs(positionAmt);
      if (quantity <= 0) continue;

      const rawSide = typeof rawPos.positionSide === 'string' ? rawPos.positionSide.trim().toUpperCase() : 'BOTH';
      let side: 'LONG' | 'SHORT';
      if (rawSide === 'LONG') {
        side = 'LONG';
      } else if (rawSide === 'SHORT') {
        side = 'SHORT';
      } else if (rawSide === 'BOTH') {
        // One-Way Mode: sign determines side
        side = positionAmt > 0 ? 'LONG' : 'SHORT';
      } else {
        warnings.push(`Unknown positionSide '${rawSide}' for ${symbol}, skipping.`);
        continue;
      }

      const rawEntryPrice = rawPos.entryPrice;
      const entryPrice = typeof rawEntryPrice === 'number' ? rawEntryPrice : parseFloat(String(rawEntryPrice ?? '0'));
      const rawUnrealizedProfit = rawPos.unrealizedProfit;
      const unrealizedPnl =
        typeof rawUnrealizedProfit === 'number' ? rawUnrealizedProfit : parseFloat(String(rawUnrealizedProfit ?? '0'));
      const rawLeverage = rawPos.leverage;
      const leverage = typeof rawLeverage === 'number' ? rawLeverage : parseFloat(String(rawLeverage ?? '0'));
      const rawInitialMargin = rawPos.initialMargin;
      const initialMargin =
        typeof rawInitialMargin === 'number' ? rawInitialMargin : parseFloat(String(rawInitialMargin ?? '0'));

      positions.push({
        symbol,
        side,
        quantity, // ALWAYS strictly positive!
        entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
        unrealizedPnl: Number.isFinite(unrealizedPnl) ? unrealizedPnl : 0,
        leverage: Number.isFinite(leverage) && leverage > 0 ? leverage : undefined,
        initialMargin: Number.isFinite(initialMargin) && initialMargin > 0 ? initialMargin : undefined,
      });
    }

    return { positions, warnings };
  }

  /**
   * Fetches the current live mark price for a symbol directly from Binance Futures Testnet premiumIndex.
   * Endpoint: GET https://testnet.binancefuture.com/fapi/v1/premiumIndex?symbol=...
   * Strictly READ-ONLY public endpoint.
   */
  public async getMarkPrice(symbol: string): Promise<number | null> {
    if (!symbol || typeof symbol !== 'string') return null;
    const cleanSymbol = symbol.trim().toUpperCase();
    try {
      const url = new URL('/fapi/v1/premiumIndex', this.baseUrl);
      url.searchParams.set('symbol', cleanSymbol);
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== 'object' || !data.markPrice) return null;
      const num = parseFloat(data.markPrice);
      return Number.isFinite(num) && num > 0 ? num : null;
    } catch {
      return null;
    }
  }

  /**
   * Reads account position mode (One-Way vs Hedge Mode) from Binance Futures Testnet.
   * Endpoint: GET /fapi/v1/positionSide/dual
   * Strictly READ-ONLY.
   */
  public async getPositionMode(): Promise<'ONE_WAY' | 'HEDGE' | null> {
    if (!this.apiKey || !this.apiSecret) return null;
    try {
      const timestamp = Date.now();
      const qs = `timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex');
      const url = `${this.baseUrl}/fapi/v1/positionSide/dual?${qs}&signature=${signature}`;
      const res = await fetch(url, {
        headers: { 'X-MBX-APIKEY': this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data?.dualSidePosition === 'boolean') {
        return data.dualSidePosition ? 'HEDGE' : 'ONE_WAY';
      }
      return null;
    } catch {
      return null;
    }
  }
}

export const binanceTestnetAccountStateProvider = new BinanceTestnetAccountStateProvider();
