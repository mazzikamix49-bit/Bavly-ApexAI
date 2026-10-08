import crypto from 'node:crypto';
import { BinanceOrderRequest, BinanceOrderResponse, BinanceOrderTransport } from './testnetExecutionAdapter';
import { RemoteBinanceOrder } from './executionReconciliation';
import { binanceNetworkGuard } from './binanceNetworkGuard';

export interface BinanceTestnetOrderTransportOptions {
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  recvWindow?: number;
  timeoutMs?: number;
}

/**
 * BinanceTestnetOrderTransport
 *
 * Real HTTP Transport strictly communicating with Binance USDT-M Futures Testnet.
 * Supports standard orders (POST /fapi/v1/order) and conditional/algo orders (POST /fapi/v1/algoOrder).
 *
 * STRICT SAFETY INVARIANTS:
 * - TESTNET ONLY: Hard-guarded to reject any production Binance URLs.
 * - HOOKUSDT PROTECTED: Absolutely rejects any order for HOOKUSDT.
 * - ZERO SECRETS: Never logs or serializes API keys, secrets, or signatures.
 * - AUDITABLE COUNTERS: Records exact counts of every order category dispatched.
 */
export class BinanceTestnetOrderTransport implements BinanceOrderTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly recvWindow: number;
  private readonly timeoutMs: number;

  // Order category counters for audit report
  public entryOrdersCount: number = 0;
  public stopLossOrdersCount: number = 0;
  public takeProfitOrdersCount: number = 0;
  public closeOrdersCount: number = 0;
  public cancelOrdersCount: number = 0;
  public productionOrdersCount: number = 0;
  public productionRequestsCount: number = 0;

  // Audit log of executed requests (metadata only, no secrets)
  public dispatchedRequests: Array<{
    category: 'ENTRY' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'CLOSE' | 'CANCEL';
    symbol: string;
    side?: string;
    type?: string;
    quantity?: number;
    price?: number;
    stopPrice?: number;
    clientOrderId?: string;
    orderId?: string | number;
    status?: string;
    timestamp: number;
    testnetOnly: true;
  }> = [];

  constructor(options?: BinanceTestnetOrderTransportOptions) {
    const rawUrl = options?.baseUrl || 'https://testnet.binancefuture.com';

    // Strict Production URL Hard Guard
    binanceNetworkGuard.assertTestnetTraffic(rawUrl, 'BinanceTestnetOrderTransport');
    if (rawUrl.includes('fapi.binance.com') || !rawUrl.includes('testnet.binancefuture.com')) {
      this.productionRequestsCount++;
      throw new Error(
        `[CRITICAL SAFETY BREACH] Production URL detected (${rawUrl}). BinanceTestnetOrderTransport ONLY allows https://testnet.binancefuture.com.`
      );
    }

    this.baseUrl = rawUrl.replace(/\/+$/, '');
    this.apiKey = (options?.apiKey ?? process.env.BINANCE_TESTNET_API_KEY ?? '').trim();
    this.apiSecret = (options?.apiSecret ?? process.env.BINANCE_TESTNET_API_SECRET ?? '').trim();
    this.recvWindow = options?.recvWindow ?? 5000;
    this.timeoutMs = options?.timeoutMs ?? 7000;

    if (!this.apiKey || !this.apiSecret) {
      throw new Error('[BinanceTestnetOrderTransport] Missing BINANCE_TESTNET_API_KEY or BINANCE_TESTNET_API_SECRET.');
    }
  }

  /**
   * Helper to sign query string with HMAC-SHA256
   */
  private sign(params: Record<string, string | number | boolean | undefined>): string {
    const validEntries = Object.entries(params).filter(
      ([_, v]) => v !== undefined && v !== null && v !== ''
    );
    const queryString = validEntries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');

    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');

    return `${queryString}&signature=${signature}`;
  }

  /**
   * Sends an order to Binance Futures Testnet.
   * Dispatches conditional protective orders (STOP_MARKET, TAKE_PROFIT_MARKET) to /fapi/v1/algoOrder
   * and standard market/limit orders to /fapi/v1/order.
   */
  public async sendOrder(request: BinanceOrderRequest): Promise<BinanceOrderResponse> {
    const now = Date.now();

    // Production guard
    if (this.baseUrl.includes('fapi.binance.com') || !this.baseUrl.includes('testnet.binancefuture.com')) {
      this.productionOrdersCount++;
      this.productionRequestsCount++;
      return {
        success: false,
        error: 'PRODUCTION_URL_FORBIDDEN: Attempted to send order to production.',
      };
    }

    // HOOKUSDT Strict Protection
    if (request.symbol.toUpperCase() === 'HOOKUSDT') {
      return {
        success: false,
        error: 'HOOKUSDT_FORBIDDEN: Existing HOOKUSDT position is strictly protected and cannot be modified.',
      };
    }

    const isAlgo = request.type === 'STOP_MARKET' || request.type === 'TAKE_PROFIT_MARKET';

    // Determine category
    let category: 'ENTRY' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'CLOSE' = 'ENTRY';
    if (request.reduceOnly === true) {
      if (request.type === 'STOP_MARKET') {
        category = 'STOP_LOSS';
      } else if (request.type === 'TAKE_PROFIT_MARKET') {
        category = 'TAKE_PROFIT';
      } else {
        category = 'CLOSE';
      }
    }

    try {
      let url: string;
      let signedQuery: string;

      if (isAlgo) {
        url = `${this.baseUrl}/fapi/v1/algoOrder`;
        const algoParams: Record<string, string | number | boolean | undefined> = {
          algoType: 'CONDITIONAL',
          symbol: request.symbol.toUpperCase(),
          side: request.side,
          type: request.type,
          quantity: request.quantity,
          triggerPrice: request.stopPrice,
          reduceOnly: request.reduceOnly ? 'true' : 'false',
          positionSide: request.positionSide || 'BOTH',
          clientAlgoId: request.clientOrderId,
          newClientStrategyId: request.clientOrderId,
          recvWindow: this.recvWindow,
          timestamp: now,
        };
        signedQuery = this.sign(algoParams);
      } else {
        url = `${this.baseUrl}/fapi/v1/order`;
        const orderParams: Record<string, string | number | boolean | undefined> = {
          symbol: request.symbol.toUpperCase(),
          side: request.side,
          type: request.type,
          quantity: request.quantity,
          recvWindow: this.recvWindow,
          timestamp: now,
        };

        if (request.clientOrderId) {
          orderParams.newClientOrderId = request.clientOrderId;
        }

        if (request.positionSide) {
          orderParams.positionSide = request.positionSide;
        }

        if (request.reduceOnly !== undefined) {
          orderParams.reduceOnly = request.reduceOnly ? 'true' : 'false';
        }

        if (request.price !== undefined && request.price > 0 && request.type !== 'MARKET') {
          orderParams.price = request.price;
          if (request.type === 'LIMIT') {
            orderParams.timeInForce = 'GTC';
          }
        }

        if (request.stopPrice !== undefined && request.stopPrice > 0) {
          orderParams.stopPrice = request.stopPrice;
        }

        signedQuery = this.sign(orderParams);
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'ApexAI-TestnetWorker/1.0',
        },
        body: signedQuery,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || (data.code !== undefined && data.code < 0)) {
        const errorMsg = data.msg || `HTTP ${res.status}: Order rejected by Binance Testnet`;
        return {
          success: false,
          symbol: request.symbol,
          error: `BINANCE_REJECTED (${data.code ?? res.status}): ${errorMsg}`,
        };
      }

      // Tally counter based on category
      switch (category) {
        case 'ENTRY':
          this.entryOrdersCount++;
          break;
        case 'STOP_LOSS':
          this.stopLossOrdersCount++;
          break;
        case 'TAKE_PROFIT':
          this.takeProfitOrdersCount++;
          break;
        case 'CLOSE':
          this.closeOrdersCount++;
          break;
      }

      const orderId = String(data.algoId || data.orderId);
      const clientOrderId = data.clientAlgoId || data.clientOrderId || request.clientOrderId;
      const status = data.algoStatus || data.status || 'NEW';
      const avgPrice = String(data.avgPrice || 0);
      const executedQty = String(data.executedQty || 0);

      this.dispatchedRequests.push({
        category,
        symbol: request.symbol,
        side: request.side,
        type: request.type,
        quantity: request.quantity,
        price: request.price,
        stopPrice: request.stopPrice,
        clientOrderId,
        orderId,
        status,
        timestamp: now,
        testnetOnly: true,
      });

      return {
        success: true,
        orderId,
        symbol: data.symbol || request.symbol,
        status,
        clientOrderId,
        avgPrice,
        executedQty,
      };
    } catch (err: any) {
      return {
        success: false,
        symbol: request.symbol,
        error: `NETWORK_ERROR: ${err.message || String(err)}`,
      };
    }
  }

  /**
   * Queries real order status directly from Binance Futures Testnet via /fapi/v1/order or /fapi/v1/algoOrder.
   * 100% READ-ONLY.
   */
  public async queryOrder(
    symbol: string,
    orderId?: string | number,
    clientOrderId?: string
  ): Promise<RemoteBinanceOrder | null> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const now = Date.now();

    // 1. Try querying standard order endpoint (/fapi/v1/order)
    try {
      const params: Record<string, string | number | undefined> = {
        symbol: cleanSymbol,
        recvWindow: this.recvWindow,
        timestamp: now,
      };

      if (orderId) {
        params.orderId = orderId;
      } else if (clientOrderId) {
        params.origClientOrderId = clientOrderId;
      }

      if (params.orderId || params.origClientOrderId) {
        const signedQuery = this.sign(params);
        const url = `${this.baseUrl}/fapi/v1/order?${signedQuery}`;

        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'X-MBX-APIKEY': this.apiKey,
            'Accept': 'application/json',
            'User-Agent': 'ApexAI-TestnetWorker/1.0',
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.orderId !== undefined) {
            return {
              symbol: data.symbol,
              orderId: String(data.orderId),
              clientOrderId: data.clientOrderId,
              side: data.side,
              positionSide: data.positionSide,
              type: data.type,
              status: data.status,
              origQty: parseFloat(data.origQty || '0'),
              executedQty: parseFloat(data.executedQty || '0'),
              avgPrice: parseFloat(data.avgPrice || '0'),
              reduceOnly: Boolean(data.reduceOnly),
              stopPrice: data.stopPrice ? parseFloat(data.stopPrice) : undefined,
              updateTime: data.updateTime || now,
            };
          }
        }
      }
    } catch {
      // Continue to check algo order endpoint
    }

    // 2. Try querying algo order endpoint (/fapi/v1/algoOrder)
    try {
      const algoParams: Record<string, string | number | undefined> = {
        recvWindow: this.recvWindow,
        timestamp: now,
      };
      if (orderId) {
        algoParams.algoId = orderId;
      }

      if (algoParams.algoId) {
        const signedQuery = this.sign(algoParams);
        const url = `${this.baseUrl}/fapi/v1/algoOrder?${signedQuery}`;

        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'X-MBX-APIKEY': this.apiKey,
            'Accept': 'application/json',
            'User-Agent': 'ApexAI-TestnetWorker/1.0',
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.algoId !== undefined) {
            const isExecuted = data.algoStatus === 'EXECUTED';
            const isTriggered = data.algoStatus === 'TRIGGERED';
            const status = isExecuted ? 'FILLED' : (isTriggered ? 'TRIGGERED' : (data.algoStatus || 'NEW'));
            const executedQty = isExecuted ? parseFloat(data.quantity || '0') : parseFloat(data.executedQty || '0');
            const avgPrice = parseFloat(data.actualPrice || data.price || '0');

            return {
              symbol: data.symbol,
              orderId: String(data.algoId),
              clientOrderId: data.clientAlgoId || clientOrderId || '',
              side: data.side,
              positionSide: data.positionSide,
              type: data.orderType || data.type || 'STOP_MARKET',
              status,
              origQty: parseFloat(data.quantity || '0'),
              executedQty,
              avgPrice,
              reduceOnly: Boolean(data.reduceOnly),
              stopPrice: data.triggerPrice ? parseFloat(data.triggerPrice) : undefined,
              updateTime: data.updateTime || now,
            };
          }
        }
      }
    } catch {
      // Fallback
    }

    return null;
  }

  /**
   * Cancels an order on Binance Futures Testnet via DELETE /fapi/v1/order or DELETE /fapi/v1/algoOrder.
   */
  public async cancelOrder(
    symbol: string,
    orderId?: string | number,
    clientOrderId?: string
  ): Promise<boolean> {
    const cleanSymbol = symbol.trim().toUpperCase();
    if (cleanSymbol === 'HOOKUSDT') {
      throw new Error('[SAFETY GUARD] HOOKUSDT orders cannot be canceled by test harness.');
    }

    const now = Date.now();

    // 1. Try canceling as standard order
    try {
      const params: Record<string, string | number | undefined> = {
        symbol: cleanSymbol,
        recvWindow: this.recvWindow,
        timestamp: now,
      };

      if (orderId) {
        params.orderId = orderId;
      } else if (clientOrderId) {
        params.origClientOrderId = clientOrderId;
      }

      if (params.orderId || params.origClientOrderId) {
        const signedQuery = this.sign(params);
        const url = `${this.baseUrl}/fapi/v1/order?${signedQuery}`;

        const res = await fetch(url, {
          method: 'DELETE',
          headers: {
            'X-MBX-APIKEY': this.apiKey,
            'Accept': 'application/json',
            'User-Agent': 'ApexAI-TestnetWorker/1.0',
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.status) {
          this.cancelOrdersCount++;
          this.dispatchedRequests.push({
            category: 'CANCEL',
            symbol: cleanSymbol,
            orderId,
            clientOrderId,
            status: data.status,
            timestamp: now,
            testnetOnly: true,
          });
          return true;
        }
      }
    } catch {
      // Continue to algo cancel
    }

    // 2. Try canceling as algo order (/fapi/v1/algoOrder)
    try {
      if (orderId) {
        const algoParams: Record<string, string | number | undefined> = {
          algoId: orderId,
          recvWindow: this.recvWindow,
          timestamp: now,
        };

        const signedQuery = this.sign(algoParams);
        const url = `${this.baseUrl}/fapi/v1/algoOrder?${signedQuery}`;

        const res = await fetch(url, {
          method: 'DELETE',
          headers: {
            'X-MBX-APIKEY': this.apiKey,
            'Accept': 'application/json',
            'User-Agent': 'ApexAI-TestnetWorker/1.0',
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.code === '200' || data.code === 200 || data.msg === 'success')) {
          this.cancelOrdersCount++;
          this.dispatchedRequests.push({
            category: 'CANCEL',
            symbol: cleanSymbol,
            orderId,
            clientOrderId,
            status: 'CANCELED',
            timestamp: now,
            testnetOnly: true,
          });
          return true;
        }
      }
    } catch {
      // Fall through
    }

    return false;
  }

  /**
   * Fetches all current open orders (standard + algo) on Binance Futures Testnet.
   * 100% READ-ONLY.
   */
  public async getOpenOrders(symbol?: string): Promise<RemoteBinanceOrder[]> {
    const now = Date.now();
    const results: RemoteBinanceOrder[] = [];

    // 1. Fetch standard open orders
    try {
      const params: Record<string, string | number | undefined> = {
        recvWindow: this.recvWindow,
        timestamp: now,
      };
      if (symbol) {
        params.symbol = symbol.trim().toUpperCase();
      }

      const signedQuery = this.sign(params);
      const url = `${this.baseUrl}/fapi/v1/openOrders?${signedQuery}`;

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'Accept': 'application/json',
          'User-Agent': 'ApexAI-TestnetWorker/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (res.ok) {
        const list = await res.json().catch(() => []);
        if (Array.isArray(list)) {
          for (const data of list) {
            results.push({
              symbol: data.symbol,
              orderId: String(data.orderId),
              clientOrderId: data.clientOrderId,
              side: data.side,
              positionSide: data.positionSide,
              type: data.type,
              status: data.status,
              origQty: parseFloat(data.origQty || '0'),
              executedQty: parseFloat(data.executedQty || '0'),
              avgPrice: parseFloat(data.avgPrice || '0'),
              reduceOnly: Boolean(data.reduceOnly),
              stopPrice: data.stopPrice ? parseFloat(data.stopPrice) : undefined,
              updateTime: data.updateTime || now,
            });
          }
        }
      }
    } catch {
      // Ignore and continue to algo orders
    }

    // 2. Fetch open algo orders
    try {
      const algoParams: Record<string, string | number | undefined> = {
        recvWindow: this.recvWindow,
        timestamp: now,
      };
      if (symbol) {
        algoParams.symbol = symbol.trim().toUpperCase();
      }

      const signedQuery = this.sign(algoParams);
      const url = `${this.baseUrl}/fapi/v1/openAlgoOrders?${signedQuery}`;

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'Accept': 'application/json',
          'User-Agent': 'ApexAI-TestnetWorker/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (res.ok) {
        const list = await res.json().catch(() => []);
        if (Array.isArray(list)) {
          for (const data of list) {
            results.push({
              symbol: data.symbol,
              orderId: String(data.algoId),
              clientOrderId: data.clientAlgoId || '',
              side: data.side,
              positionSide: data.positionSide,
              type: data.orderType || data.type || 'STOP_MARKET',
              status: data.algoStatus || 'NEW',
              origQty: parseFloat(data.quantity || '0'),
              executedQty: 0,
              avgPrice: parseFloat(data.price || '0'),
              reduceOnly: Boolean(data.reduceOnly),
              stopPrice: data.triggerPrice ? parseFloat(data.triggerPrice) : undefined,
              updateTime: data.updateTime || now,
            });
          }
        }
      }
    } catch {
      // Ignore
    }

    return results;
  }

  /**
   * Sets leverage for a given symbol on Binance Futures Testnet.
   * Hard-guarded against HOOKUSDT.
   */
  public async setLeverage(
    symbol: string,
    leverage: number
  ): Promise<{ success: boolean; leverage?: number; maxNotionalValue?: string; error?: string }> {
    const cleanSym = symbol.trim().toUpperCase();
    if (cleanSym === 'HOOKUSDT') {
      return { success: false, error: 'HOOKUSDT is strictly isolated from leverage mutation.' };
    }

    try {
      const now = Date.now();
      const params = {
        symbol: cleanSym,
        leverage,
        recvWindow: this.recvWindow,
        timestamp: now,
      };
      const signedQuery = this.sign(params);
      const url = `${this.baseUrl}/fapi/v1/leverage?${signedQuery}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'Accept': 'application/json',
          'User-Agent': 'ApexAI-TestnetWorker/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const bodyText = await res.text();
      let parsed: any;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = null;
      }

      if (!res.ok || !parsed || parsed.code) {
        return {
          success: false,
          error: parsed?.msg || `HTTP ${res.status}: ${bodyText}`,
        };
      }

      console.log(`[TRANSPORT] Synchronized leverage for ${cleanSym} to ${parsed.leverage}x (Max notional: ${parsed.maxNotionalValue})`);
      return {
        success: true,
        leverage: parsed.leverage,
        maxNotionalValue: parsed.maxNotionalValue,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `setLeverage network error: ${err.message || String(err)}`,
      };
    }
  }
}
