/**
 * Binance Futures WebSocket Real-Time Stream Manager
 * Connects directly to Binance Futures WebSocket endpoint:
 *   Production: wss://fstream.binance.com/ws/!ticker@arr
 *   Testnet:    wss://stream.binancefuture.com/ws/!ticker@arr
 *
 * Provides sub-second real-time streaming market prices for all USDT-M contracts.
 * Includes automatic reconnection with exponential backoff and heartbeat health checking.
 */

export type WsConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface TickerUpdate {
  symbol: string;
  price: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
}

export type TickerCallback = (tickers: Map<string, TickerUpdate>) => void;
export type StatusCallback = (status: WsConnectionStatus, details?: string) => void;

export class BinanceWsService {
  private ws: WebSocket | null = null;
  private isTestnet = false;
  private isExplicitlyClosed = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeoutId: any = null;
  private pingIntervalId: any = null;
  private lastMessageTimestamp = 0;

  private onTickersUpdate: TickerCallback | null = null;
  private onStatusChange: StatusCallback | null = null;
  private currentStatus: WsConnectionStatus = 'disconnected';

  constructor(isTestnet = false) {
    this.isTestnet = isTestnet;
  }

  public setCallbacks(onTickers: TickerCallback, onStatus: StatusCallback) {
    this.onTickersUpdate = onTickers;
    this.onStatusChange = onStatus;
  }

  public getStatus(): WsConnectionStatus {
    return this.currentStatus;
  }

  private updateStatus(status: WsConnectionStatus, details?: string) {
    this.currentStatus = status;
    console.log(`[Binance WS] Status: ${status}${details ? ` - ${details}` : ''}`);
    if (this.onStatusChange) {
      this.onStatusChange(status, details);
    }
  }

  public connect(isTestnet?: boolean) {
    if (isTestnet !== undefined) {
      this.isTestnet = isTestnet;
    }

    this.isExplicitlyClosed = false;
    this.cleanup();

    const baseUrl = this.isTestnet
      ? 'wss://stream.binancefuture.com/ws/!ticker@arr'
      : 'wss://fstream.binance.com/ws/!ticker@arr';

    this.updateStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      console.log(`[Binance WS] Initializing connection to: ${baseUrl} (Attempt ${this.reconnectAttempts + 1})`);
      this.ws = new WebSocket(baseUrl);

      this.ws.onopen = () => {
        console.log('[Binance WS] Connected successfully to real-time stream.');
        this.reconnectAttempts = 0;
        this.lastMessageTimestamp = Date.now();
        this.updateStatus('connected', 'Live sub-second prices');
        this.startHeartbeatCheck();
      };

      this.ws.onmessage = (event) => {
        this.lastMessageTimestamp = Date.now();
        try {
          const raw = JSON.parse(event.data);
          if (Array.isArray(raw)) {
            const updates = new Map<string, TickerUpdate>();
            for (const t of raw) {
              if (t.s && t.s.endsWith('USDT')) {
                updates.set(t.s, {
                  symbol: t.s,
                  price: parseFloat(t.c || '0'),
                  priceChangePercent: parseFloat(t.P || '0'),
                  highPrice: parseFloat(t.h || '0'),
                  lowPrice: parseFloat(t.l || '0'),
                  volume: parseFloat(t.v || '0'),
                  quoteVolume: parseFloat(t.q || '0'),
                });
              }
            }

            if (updates.size > 0 && this.onTickersUpdate) {
              this.onTickersUpdate(updates);
            }
          }
        } catch (e) {
          console.error('[Binance WS] Error parsing message payload:', e);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[Binance WS] WebSocket encountered error:', err);
        this.updateStatus('error', 'Connection error');
      };

      this.ws.onclose = (event) => {
        console.warn(`[Binance WS] Socket closed (Code: ${event.code}, Clean: ${event.wasClean})`);
        this.stopHeartbeatCheck();
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        } else {
          this.updateStatus('disconnected', 'User closed');
        }
      };
    } catch (err: any) {
      console.error('[Binance WS] Failed to initialize WebSocket client:', err);
      this.updateStatus('error', err.message);
      this.scheduleReconnect();
    }
  }

  private startHeartbeatCheck() {
    this.stopHeartbeatCheck();
    // Check every 10s if we received data in the last 15s; if not, force reconnect
    this.pingIntervalId = setInterval(() => {
      if (Date.now() - this.lastMessageTimestamp > 15000 && !this.isExplicitlyClosed) {
        console.warn('[Binance WS] Heartbeat timeout - no data in 15s. Reconnecting...');
        this.reconnect();
      }
    }, 10000);
  }

  private stopHeartbeatCheck() {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  private scheduleReconnect() {
    this.cleanup();
    if (this.isExplicitlyClosed) return;

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);

    this.updateStatus('reconnecting', `Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${(delay / 1000).toFixed(1)}s`);
    console.log(`[Binance WS] Scheduling reconnection attempt in ${delay}ms...`);

    this.reconnectTimeoutId = setTimeout(() => {
      this.connect();
    }, delay);
  }

  public reconnect() {
    console.log('[Binance WS] Manual reconnect triggered');
    this.connect();
  }

  public disconnect() {
    this.isExplicitlyClosed = true;
    this.cleanup();
    this.updateStatus('disconnected', 'Disconnected by user');
  }

  private cleanup() {
    this.stopHeartbeatCheck();
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch (e) {
        // ignore
      }
      this.ws = null;
    }
  }
}

export const binanceWs = new BinanceWsService(false);
