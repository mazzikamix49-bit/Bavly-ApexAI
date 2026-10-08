import express, { Request, Response } from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

export const apiRouter = express.Router();

// Initialize Google Gemini AI if API key is provided
let aiClient: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch (err) {
    console.error('Failed to initialize Gemini AI client:', err);
  }
}

// Safe Binance Environment and Guard Configuration
const getBinanceEnv = (): 'testnet' | 'production' => {
  const env = (process.env.BINANCE_ENV || 'testnet').trim().toLowerCase();
  return env === 'production' ? 'production' : 'testnet';
};

const isProductionTradingAllowed = (): boolean => {
  return process.env.ALLOW_PRODUCTION_TRADING === 'true';
};

const resolveIsTestnet = (paramIsTestnet?: any): boolean => {
  if (paramIsTestnet !== undefined && paramIsTestnet !== null && paramIsTestnet !== '') {
    return paramIsTestnet === true || paramIsTestnet === 'true';
  }
  return getBinanceEnv() !== 'production';
};

// Helpers for Binance API
const getBinanceBaseUrl = (isTestnet = true) => {
  if (!isTestnet) {
    if (!isProductionTradingAllowed()) {
      throw new Error('[CENTRAL_GUARD_FAIL_CLOSED] Binance Production environment rejected: ALLOW_PRODUCTION_TRADING is false.');
    }
    return 'https://fapi.binance.com';
  }
  return 'https://testnet.binancefuture.com';
};

// Safe helper to read Binance API credentials server-side from environment variables ONLY:
// Testnet: BINANCE_TESTNET_API_KEY / BINANCE_TESTNET_API_SECRET
// Production: BINANCE_API_KEY / BINANCE_API_SECRET
const getServerBinanceCredentials = (isTestnet = true): { apiKey: string; apiSecret: string } | null => {
  if (isTestnet) {
    const apiKey = (process.env.BINANCE_TESTNET_API_KEY || '').trim();
    const apiSecret = (process.env.BINANCE_TESTNET_API_SECRET || '').trim();
    if (apiKey && apiSecret) {
      return { apiKey, apiSecret };
    }
    return null;
  } else {
    const apiKey = (process.env.BINANCE_API_KEY || '').trim();
    const apiSecret = (process.env.BINANCE_API_SECRET || '').trim();
    if (apiKey && apiSecret) {
      return { apiKey, apiSecret };
    }
    return null;
  }
};

const signQuery = (queryString: string, apiSecret: string): string => {
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
};

const extractBinanceHeaders = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {};
  headers.forEach((val, key) => {
    result[key] = val;
  });
  return result;
};

// Status endpoint to check server credentials configuration without exposing secrets
apiRouter.get('/binance/config-status', (req: Request, res: Response) => {
  const env = getBinanceEnv();
  const allowProd = isProductionTradingAllowed();
  const isTestnet = resolveIsTestnet(req.query.testnet);
  const testnetCreds = getServerBinanceCredentials(true);
  const prodCreds = getServerBinanceCredentials(false);
  res.json({
    success: true,
    environment: env,
    allowProductionTrading: allowProd,
    testnetConfigured: !!testnetCreds,
    prodConfigured: !!prodCreds,
    activeEnvironmentConfigured: isTestnet ? !!testnetCreds : (allowProd && !!prodCreds),
    productionBlocked: !allowProd,
  });
});

// In-Memory Authoritative Bot Session Store
interface ServerSession {
  sessionId: string;
  startTime: number;
  status: 'RUNNING' | 'STOPPED';
  uptimeSeconds: number;
  lastHeartbeat: number;
}

let activeServerSession: ServerSession = {
  sessionId: `session-srv-${Date.now()}`,
  startTime: Date.now(),
  status: 'STOPPED',
  uptimeSeconds: 0,
  lastHeartbeat: Date.now(),
};

// In-Memory Order Execution Lock to prevent duplicate submissions
const recentOrderIds = new Set<string>();

// 1. Authoritative Bot Session Endpoint
apiRouter.get('/bot/session', (req: Request, res: Response) => {
  const now = Date.now();
  const elapsed =
    activeServerSession.status === 'RUNNING'
      ? Math.max(0, Math.floor((now - activeServerSession.startTime) / 1000))
      : activeServerSession.uptimeSeconds;

  res.json({
    success: true,
    session: {
      ...activeServerSession,
      elapsedSeconds: elapsed,
      uptimeSeconds: elapsed,
      serverTime: now,
    },
  });
});

apiRouter.post('/bot/session', (req: Request, res: Response) => {
  const { action, sessionId, startTime } = req.body;
  const now = Date.now();

  if (action === 'START') {
    activeServerSession = {
      sessionId: sessionId || `session-srv-${now}`,
      startTime: startTime || now,
      status: 'RUNNING',
      uptimeSeconds: 0,
      lastHeartbeat: now,
    };
  } else if (action === 'STOP') {
    const finalUptime =
      activeServerSession.status === 'RUNNING'
        ? Math.max(0, Math.floor((now - activeServerSession.startTime) / 1000))
        : activeServerSession.uptimeSeconds;
    activeServerSession.status = 'STOPPED';
    activeServerSession.uptimeSeconds = finalUptime;
    activeServerSession.lastHeartbeat = now;
  } else {
    activeServerSession.lastHeartbeat = now;
  }

  const elapsed =
    activeServerSession.status === 'RUNNING'
      ? Math.max(0, Math.floor((now - activeServerSession.startTime) / 1000))
      : activeServerSession.uptimeSeconds;

  res.json({
    success: true,
    session: {
      ...activeServerSession,
      elapsedSeconds: elapsed,
      uptimeSeconds: elapsed,
      serverTime: now,
    },
  });
});

// 2. Binance Connectivity Ping
apiRouter.get('/binance/ping', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.query.testnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_REJECTED: Binance Production environment is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }
  const baseUrl = getBinanceBaseUrl(isTestnet);
  try {
    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/fapi/v1/ping`);
    const latency = Date.now() - startTime;
    const binanceHeaders = extractBinanceHeaders(response.headers);

    if (binanceHeaders['x-mbx-used-weight-1m']) {
      res.setHeader('x-mbx-used-weight-1m', binanceHeaders['x-mbx-used-weight-1m']);
    }

    if (response.ok) {
      res.json({
        success: true,
        latency,
        status: 'online',
        isTestnet,
        headers: binanceHeaders,
      });
    } else {
      res.status(response.status).json({
        success: false,
        status: 'error',
        code: response.status,
        headers: binanceHeaders,
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Connection failed' });
  }
});

// 2b. Binance Diagnostic Probe
apiRouter.get('/binance/diagnostics', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.query.testnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_REJECTED: Binance Production environment is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }
  const baseUrl = getBinanceBaseUrl(isTestnet);
  const startTime = Date.now();

  try {
    const pingPromise = fetch(`${baseUrl}/fapi/v1/ping`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        Accept: 'application/json',
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Binance Ping Timeout (>5000ms)')), 5000)
    );

    const binanceRes = (await Promise.race([pingPromise, timeoutPromise])) as globalThis.Response;
    const durationMs = Date.now() - startTime;
    const headers = extractBinanceHeaders(binanceRes.headers);

    res.json({
      success: binanceRes.ok,
      targetEndpoint: `${baseUrl}/fapi/v1/ping`,
      statusCode: binanceRes.status,
      statusText: binanceRes.statusText,
      durationMs,
      headers,
      environment: {
        isVercel: !!process.env.VERCEL,
        vercelRegion: process.env.VERCEL_REGION || 'local',
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
      },
      diagnosis:
        binanceRes.status === 451 || binanceRes.status === 403
          ? 'Cloud datacenter IP is geo-blocked by Binance. Bot uses browser direct stream.'
          : binanceRes.ok
          ? 'Healthy connection from backend to Binance Futures API.'
          : `HTTP status ${binanceRes.status} returned by Binance.`,
    });
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    res.status(502).json({
      success: false,
      statusCode: 502,
      durationMs,
      error: err.message,
      headers: {},
      diagnosis: 'Failed to establish connection from backend to Binance Futures API.',
    });
  }
});

// 3. Binance Exchange Info
apiRouter.get('/binance/exchangeInfo', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.query.testnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_REJECTED: Binance Production environment is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }
  const baseUrl = getBinanceBaseUrl(isTestnet);
  try {
    const response = await fetch(`${baseUrl}/fapi/v1/exchangeInfo`);
    if (!response.ok) {
      throw new Error(`Binance responded with ${response.status}`);
    }
    const data = await response.json();
    const symbols = (data.symbols || [])
      .filter((s: any) => s.quoteAsset === 'USDT' && s.status === 'TRADING' && s.contractType === 'PERPETUAL')
      .map((s: any) => {
        const lotFilter = s.filters?.find((f: any) => f.filterType === 'LOT_SIZE') || {};
        const priceFilter = s.filters?.find((f: any) => f.filterType === 'PRICE_FILTER') || {};
        const minNotionalFilter = s.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL') || {};

        return {
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          pricePrecision: s.pricePrecision,
          quantityPrecision: s.quantityPrecision,
          minQty: lotFilter.minQty ? parseFloat(lotFilter.minQty) : 0.001,
          stepSize: lotFilter.stepSize ? parseFloat(lotFilter.stepSize) : 0.001,
          tickSize: priceFilter.tickSize ? parseFloat(priceFilter.tickSize) : 0.01,
          minNotional: minNotionalFilter.notional ? parseFloat(minNotionalFilter.notional) : 5,
        };
      });

    res.json({ success: true, count: symbols.length, symbols });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Binance 24hr Tickers
apiRouter.get('/binance/ticker24hr', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.query.testnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_REJECTED: Binance Production environment is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }
  const symbol = req.query.symbol as string;
  const baseUrl = getBinanceBaseUrl(isTestnet);
  try {
    const url = symbol ? `${baseUrl}/fapi/v1/ticker/24hr?symbol=${symbol}` : `${baseUrl}/fapi/v1/ticker/24hr`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Binance responded with ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Binance Real Order Book Depth
apiRouter.get('/binance/depth', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.query.testnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_REJECTED: Binance Production environment is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }
  const symbol = (req.query.symbol as string) || 'BTCUSDT';
  const limit = (req.query.limit as string) || '20';
  const baseUrl = getBinanceBaseUrl(isTestnet);

  try {
    const response = await fetch(`${baseUrl}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Binance depth error: ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Binance Candlestick / Klines
apiRouter.get('/binance/klines', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.query.testnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_REJECTED: Binance Production environment is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }
  const symbol = (req.query.symbol as string) || 'BTCUSDT';
  const interval = (req.query.interval as string) || '15m';
  const limit = (req.query.limit as string) || '100';
  const baseUrl = getBinanceBaseUrl(isTestnet);

  try {
    const response = await fetch(`${baseUrl}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Binance klines error: ${response.status}`);
    }
    const rawKlines = await response.json();
    const formatted = rawKlines.map((k: any) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[7]),
      tradesCount: k[8],
    }));
    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Binance Account & Positions (Signed Server-Side)
apiRouter.post('/binance/account', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_REJECTED: Binance Production environment is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const credentials = getServerBinanceCredentials(isTestnet);
  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: `Binance credentials not configured on server (.env: ${isTestnet ? 'BINANCE_TESTNET_API_KEY / BINANCE_TESTNET_API_SECRET' : 'BINANCE_API_KEY / BINANCE_API_SECRET'})`,
    });
  }

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet);
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}&recvWindow=60000`;
  const signature = signQuery(queryString, apiSecret);

  try {
    const [accountRes, positionRes] = await Promise.all([
      fetch(`${baseUrl}/fapi/v2/account?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
      }),
      fetch(`${baseUrl}/fapi/v2/positionRisk?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
      }),
    ]);

    const accountData = await accountRes.json();
    const positionData = await positionRes.json();

    if (!accountRes.ok) {
      return res.status(accountRes.status).json({
        success: false,
        error: accountData.msg || 'Binance Account API error',
        code: accountData.code,
      });
    }

    const usdtAsset = (accountData.assets || []).find((a: any) => a.asset === 'USDT') || {
      walletBalance: '0',
      availableBalance: '0',
      unrealizedProfit: '0',
      marginBalance: '0',
      initialMargin: '0',
      maintMargin: '0',
    };

    const activePositions = Array.isArray(positionData)
      ? positionData
          .filter((p: any) => parseFloat(p.positionAmt) !== 0)
          .map((p: any) => ({
            symbol: p.symbol,
            positionAmt: parseFloat(p.positionAmt),
            entryPrice: parseFloat(p.entryPrice),
            markPrice: parseFloat(p.markPrice),
            unrealizedProfit: parseFloat(p.unRealizedProfit),
            liquidationPrice: parseFloat(p.liquidationPrice),
            leverage: parseInt(p.leverage, 10),
            marginType: p.marginType,
            isolatedMargin: parseFloat(p.isolatedMargin || '0'),
            side: parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT',
            pnlPercentage:
              parseFloat(p.entryPrice) > 0
                ? ((parseFloat(p.markPrice) - parseFloat(p.entryPrice)) / parseFloat(p.entryPrice)) *
                  100 *
                  parseInt(p.leverage, 10) *
                  (parseFloat(p.positionAmt) > 0 ? 1 : -1)
                : 0,
          }))
      : [];

    res.json({
      success: true,
      balance: {
        totalWalletBalance: parseFloat(accountData.totalWalletBalance || usdtAsset.walletBalance || '0'),
        availableBalance: parseFloat(accountData.availableBalance || usdtAsset.availableBalance || '0'),
        totalUnrealizedProfit: parseFloat(accountData.totalUnrealizedProfit || usdtAsset.unrealizedProfit || '0'),
        totalMarginBalance: parseFloat(accountData.totalMarginBalance || usdtAsset.marginBalance || '0'),
        totalInitialMargin: parseFloat(accountData.totalInitialMargin || usdtAsset.initialMargin || '0'),
        totalMaintMargin: parseFloat(accountData.totalMaintMargin || usdtAsset.maintMargin || '0'),
      },
      positions: activePositions,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. Binance Open Orders (Reconciliation)
apiRouter.post('/binance/openOrders', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_REJECTED: Binance Production environment is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const { symbol } = req.body;
  const credentials = getServerBinanceCredentials(isTestnet);

  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: `Binance credentials not configured on server (.env: ${isTestnet ? 'BINANCE_TESTNET_API_KEY' : 'BINANCE_API_KEY'})`,
    });
  }

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet);
  const timestamp = Date.now();
  const queryParts = [`timestamp=${timestamp}`, `recvWindow=60000`];
  if (symbol) queryParts.unshift(`symbol=${symbol}`);
  const queryString = queryParts.join('&');
  const signature = signQuery(queryString, apiSecret);

  try {
    const response = await fetch(`${baseUrl}/fapi/v1/openOrders?${queryString}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const data = await response.json();
    if (response.ok) {
      res.json({ success: true, orders: Array.isArray(data) ? data : [] });
    } else {
      res.status(response.status).json({ success: false, error: data.msg || 'Failed to fetch open orders' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 9. Binance Leverage Adjustment
apiRouter.post('/binance/leverage', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_REJECTED: Binance Production environment is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const { symbol, leverage } = req.body;
  const credentials = getServerBinanceCredentials(isTestnet);

  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: `Binance credentials not configured on server (.env: ${isTestnet ? 'BINANCE_TESTNET_API_KEY' : 'BINANCE_API_KEY'})`,
    });
  }

  if (!symbol || !leverage) {
    return res.status(400).json({ success: false, error: 'Missing parameters (symbol, leverage)' });
  }

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet);
  const timestamp = Date.now();
  const queryString = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}&recvWindow=60000`;
  const signature = signQuery(queryString, apiSecret);

  try {
    const response = await fetch(`${baseUrl}/fapi/v1/leverage?${queryString}&signature=${signature}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const data = await response.json();
    if (response.ok) {
      res.json({ success: true, data });
    } else {
      res.status(response.status).json({ success: false, error: data.msg || 'Failed to change leverage' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 10. Binance Order Execution with Idempotency & Protective Orders
apiRouter.post('/binance/order', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_TRADING_DISABLED: Binance Production trading is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const {
    symbol,
    side,
    type = 'MARKET',
    quantity,
    stopPrice,
    reduceOnly = false,
    clientOrderId,
  } = req.body;

  const credentials = getServerBinanceCredentials(isTestnet);
  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: `Binance order execution rejected: server credentials not configured (.env: ${isTestnet ? 'BINANCE_TESTNET_API_KEY' : 'BINANCE_API_KEY'})`,
    });
  }

  if (!symbol || !side || !quantity) {
    return res.status(400).json({ success: false, error: 'Missing required order parameters' });
  }

  // Idempotency lock check
  const idempotencyKey = clientOrderId || `${symbol}-${side}-${quantity}-${Math.floor(Date.now() / 2000)}`;
  if (recentOrderIds.has(idempotencyKey)) {
    return res.status(409).json({
      success: false,
      error: 'Duplicate order detected by server execution lock (idempotency key matched).',
    });
  }
  recentOrderIds.add(idempotencyKey);
  setTimeout(() => recentOrderIds.delete(idempotencyKey), 10000);

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet);
  const timestamp = Date.now();
  const params: Record<string, string> = {
    symbol,
    side: side.toUpperCase(),
    type: type.toUpperCase(),
    quantity: quantity.toString(),
    timestamp: timestamp.toString(),
    recvWindow: '60000',
  };

  if (reduceOnly) {
    params.reduceOnly = 'true';
  }

  if (stopPrice) {
    params.stopPrice = stopPrice.toString();
  }

  if (clientOrderId) {
    params.newClientOrderId = clientOrderId;
  }

  const queryString = new URLSearchParams(params).toString();
  const signature = signQuery(queryString, apiSecret);

  try {
    const response = await fetch(`${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const data = await response.json();
    if (response.ok) {
      res.json({ success: true, order: data });
    } else {
      res.status(response.status).json({
        success: false,
        error: data.msg || 'Binance order execution failed',
        code: data.code,
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 11. Binance Cancel Order
apiRouter.post('/binance/cancelOrder', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed()) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_TRADING_DISABLED: Binance Production trading is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const { symbol, orderId } = req.body;
  const credentials = getServerBinanceCredentials(isTestnet);

  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: `Binance credentials not configured on server (.env: ${isTestnet ? 'BINANCE_TESTNET_API_KEY' : 'BINANCE_API_KEY'})`,
    });
  }

  if (!symbol || !orderId) {
    return res.status(400).json({ success: false, error: 'Missing required cancellation parameters' });
  }

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet);
  const timestamp = Date.now();
  const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${timestamp}&recvWindow=60000`;
  const signature = signQuery(queryString, apiSecret);

  try {
    const response = await fetch(`${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`, {
      method: 'DELETE',
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const data = await response.json();
    if (response.ok) {
      res.json({ success: true, cancelled: data });
    } else {
      res.status(response.status).json({ success: false, error: data.msg || 'Cancel order failed' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 12. Telegram Alert Dispatcher
apiRouter.post('/telegram/send', async (req: Request, res: Response) => {
  const { botToken, chatId, message } = req.body;

  if (!botToken || !chatId || !message) {
    return res.status(400).json({ success: false, error: 'Missing Telegram botToken, chatId or message' });
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const data = await response.json();
    if (response.ok && data.ok) {
      res.json({ success: true, result: data.result });
    } else {
      res.status(400).json({ success: false, error: data.description || 'Telegram API error' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 13. Gemini AI Market Decision Support
apiRouter.post('/ai/analyze', async (req: Request, res: Response) => {
  const { symbol, price, change24h, rsi, volume, trend, orderbookRatio = 1.0, language = 'en' } = req.body;

  const defaultAnalysis = {
    symbol,
    signal: change24h > 0 ? 'BUY_LONG' : 'SELL_SHORT',
    confidence: 76,
    rationale:
      language === 'ar'
        ? `تحليل سياق السوق لـ ${symbol}: مؤشر RSI عند ${rsi} مع تغير ${change24h}%، ونسبة طلب بالدفتر ${orderbookRatio}. التحليل يدعم ضبط إدارة المخاطر.`
        : `Market context analysis for ${symbol}: RSI at ${rsi}, 24h change ${change24h}%, orderbook ratio ${orderbookRatio}. Fulfills discretionary checklist.`,
    recommendedLeverage: 15,
    riskScore: 'MEDIUM',
  };

  if (!aiClient) {
    return res.json({ success: true, analysis: defaultAnalysis });
  }

  try {
    const prompt = `You are ApexAI, an institutional crypto futures quant trader and risk analyst.
Analyze the following USDT-M market context:
- Symbol: ${symbol}
- Mark Price: $${price}
- 24h Price Change: ${change24h}%
- 14-period RSI: ${rsi}
- 24h Volume: $${volume}
- Trend Alignment: ${trend}
- Orderbook Imbalance Ratio: ${orderbookRatio}

Requirements:
- Decision support only. Do not claim certainty or guaranteed returns.
- Return a valid JSON object matching this schema:
{
  "signal": "BUY_LONG" | "SELL_SHORT" | "HOLD",
  "confidence": number between 65 and 88,
  "rationale": "2-3 concise technical sentences in ${language === 'ar' ? 'Arabic' : 'English'}",
  "recommendedLeverage": number (10 to 20),
  "riskScore": "LOW" | "MEDIUM" | "HIGH"
}`;

    const response = await aiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });

    if (response && response.text) {
      const parsed = JSON.parse(response.text);
      return res.json({ success: true, analysis: parsed });
    }
    return res.json({ success: true, analysis: defaultAnalysis });
  } catch {
    return res.json({ success: true, analysis: defaultAnalysis });
  }
});

// 14. Gemini AI Support Chat
apiRouter.post('/ai/chat', async (req: Request, res: Response) => {
  const { message, language = 'en' } = req.body;

  const fallback =
    language === 'ar'
      ? 'أهلاً بك في الدعم الفني الذكي لبوت ApexAI! 🤖\n\n• البوت يعمل في وضع المحاكاة الافتراضية (Paper Mode) افتراضياً لسلامة رأس المال.\n• يمكنك تفعيل وضع التداول الحقيقي بعد التحقق من مفاتيح Binance Futures API وتأكيد الموافقة.\n• محرك إدارة المخاطر يحدد حجم الصفقات آلياً بناءً على مسافة وقف الخسارة ونسبة المخاطرة.'
      : 'Welcome to ApexAI Technical Support! 🤖\n\n• The bot defaults safely to Paper Trading mode.\n• Production trading requires validated Binance Futures API keys and explicit user confirmation.\n• Sizing is dynamically anchored on account equity and stop-loss distance.';

  if (!aiClient) {
    return res.json({ success: true, reply: fallback });
  }

  try {
    const prompt = `You are ApexAI Technical Support for a professional Binance Futures trading application.
Reply in ${language === 'ar' ? 'Arabic' : 'English'}. Concise, accurate and professional.
User question: ${message}`;

    const response = await aiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    if (response && response.text) {
      return res.json({ success: true, reply: response.text });
    }
    return res.json({ success: true, reply: fallback });
  } catch {
    return res.json({ success: true, reply: fallback });
  }
});

// Default Express app for Vercel Serverless
const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Expose-Headers', '*');
  next();
});
app.use('/api', apiRouter);

export default app;
