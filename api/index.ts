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

const isProductionTradingAllowed = (req?: Request): boolean => {
  if (process.env.ALLOW_PRODUCTION_TRADING === 'true') return true;
  if (req) {
    if (req.body?.productionConfirmed === true || req.headers['x-production-confirmed'] === 'true') {
      return true;
    }
    const clientKey = (req.body?.apiKey || req.headers['x-binance-api-key'] || '').toString().trim();
    const clientSecret = (req.body?.apiSecret || req.headers['x-binance-api-secret'] || '').toString().trim();
    if (clientKey && clientSecret) {
      return true;
    }
  }
  return false;
};

const resolveIsTestnet = (paramIsTestnet?: any): boolean => {
  if (paramIsTestnet !== undefined && paramIsTestnet !== null && paramIsTestnet !== '') {
    return paramIsTestnet === true || paramIsTestnet === 'true';
  }
  return getBinanceEnv() !== 'production';
};

import fs from 'fs';
import path from 'path';

// Helpers for Binance API
const getBinanceBaseUrl = (isTestnet = true, isOrderExecution = false, req?: Request) => {
  if (!isTestnet) {
    if (isOrderExecution && !isProductionTradingAllowed(req)) {
      throw new Error('[CENTRAL_GUARD_FAIL_CLOSED] Binance Production environment rejected: ALLOW_PRODUCTION_TRADING is false.');
    }
    return 'https://fapi.binance.com';
  }
  return 'https://testnet.binancefuture.com';
};

interface CachedCredentials {
  apiKey: string;
  apiSecret: string;
}

const cachedServerCredentials: {
  testnet?: CachedCredentials;
  live?: CachedCredentials;
} = {};

const PRIMARY_CREDS_FILE = path.join(process.cwd(), 'data', 'server_binance_credentials.json');
const LEGACY_CREDS_FILE = path.join(process.cwd(), '.server_binance_credentials.json');

const loadServerCredentialsFromFile = () => {
  try {
    const filePath = fs.existsSync(PRIMARY_CREDS_FILE)
      ? PRIMARY_CREDS_FILE
      : (fs.existsSync(LEGACY_CREDS_FILE) ? LEGACY_CREDS_FILE : null);
    if (filePath) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      if (data.testnet?.apiKey && data.testnet?.apiSecret) {
        cachedServerCredentials.testnet = data.testnet;
        process.env.BINANCE_TESTNET_API_KEY = data.testnet.apiKey;
        process.env.BINANCE_TESTNET_API_SECRET = data.testnet.apiSecret;
      }
      if (data.live?.apiKey && data.live?.apiSecret) {
        cachedServerCredentials.live = data.live;
        process.env.BINANCE_API_KEY = data.live.apiKey;
        process.env.BINANCE_API_SECRET = data.live.apiSecret;
      }
      console.log(`[Binance Credentials] Loaded saved credentials from ${filePath}`);
    }
  } catch (err) {
    console.error('[Binance Credentials] Failed to read cached credentials file:', err);
  }
};

const saveServerCredentialsToFile = () => {
  try {
    const dir = path.dirname(PRIMARY_CREDS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PRIMARY_CREDS_FILE, JSON.stringify(cachedServerCredentials, null, 2), 'utf-8');
    console.log(`[Binance Credentials] Successfully persisted credentials to ${PRIMARY_CREDS_FILE}`);
  } catch (err) {
    console.error('[Binance Credentials] Failed to write cached credentials file:', err);
  }
};

// Initialize from file on boot
loadServerCredentialsFromFile();

// Safe helper to read Binance API credentials server-side from environment variables or cache
const getServerBinanceCredentials = (isTestnet = true): { apiKey: string; apiSecret: string } | null => {
  if (isTestnet) {
    const apiKey = (process.env.BINANCE_TESTNET_API_KEY || '').trim();
    const apiSecret = (process.env.BINANCE_TESTNET_API_SECRET || '').trim();
    if (apiKey && apiSecret) {
      return { apiKey, apiSecret };
    }
    if (cachedServerCredentials.testnet?.apiKey && cachedServerCredentials.testnet?.apiSecret) {
      return cachedServerCredentials.testnet;
    }
    return null;
  } else {
    const apiKey = (process.env.BINANCE_API_KEY || '').trim();
    const apiSecret = (process.env.BINANCE_API_SECRET || '').trim();
    if (apiKey && apiSecret) {
      return { apiKey, apiSecret };
    }
    if (cachedServerCredentials.live?.apiKey && cachedServerCredentials.live?.apiSecret) {
      return cachedServerCredentials.live;
    }
    return null;
  }
};

const getEffectiveCredentials = (req: Request, isTestnet = true): { apiKey: string; apiSecret: string } | null => {
  const clientKey = (req.body?.apiKey || req.headers['x-binance-api-key'] || req.query?.apiKey || '').toString().trim();
  const clientSecret = (req.body?.apiSecret || req.headers['x-binance-api-secret'] || req.query?.apiSecret || '').toString().trim();
  if (clientKey && clientSecret) {
    if (isTestnet) {
      cachedServerCredentials.testnet = { apiKey: clientKey, apiSecret: clientSecret };
      process.env.BINANCE_TESTNET_API_KEY = clientKey;
      process.env.BINANCE_TESTNET_API_SECRET = clientSecret;
    } else {
      cachedServerCredentials.live = { apiKey: clientKey, apiSecret: clientSecret };
      process.env.BINANCE_API_KEY = clientKey;
      process.env.BINANCE_API_SECRET = clientSecret;
    }
    saveServerCredentialsToFile();
    return { apiKey: clientKey, apiSecret: clientSecret };
  }
  const envCreds = getServerBinanceCredentials(isTestnet);
  if (envCreds) return envCreds;
  return null;
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
  const testnetCreds = getEffectiveCredentials(req, true);
  const prodCreds = getEffectiveCredentials(req, false);
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

// Endpoint to persist Binance credentials from the UI Settings modal
apiRouter.post('/binance/save-credentials', (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  const apiKey = (req.body.apiKey || '').toString().trim();
  const apiSecret = (req.body.apiSecret || '').toString().trim();

  if (!apiKey || !apiSecret) {
    return res.status(400).json({ success: false, error: 'API Key and API Secret are required' });
  }

  if (isTestnet) {
    cachedServerCredentials.testnet = { apiKey, apiSecret };
    process.env.BINANCE_TESTNET_API_KEY = apiKey;
    process.env.BINANCE_TESTNET_API_SECRET = apiSecret;
  } else {
    cachedServerCredentials.live = { apiKey, apiSecret };
    process.env.BINANCE_API_KEY = apiKey;
    process.env.BINANCE_API_SECRET = apiSecret;
  }
  saveServerCredentialsToFile();

  res.json({
    success: true,
    message: isTestnet
      ? 'تم حفظ مفاتيح باينانس ديمو التجريبي على الخادم بنجاح.'
      : 'تم حفظ مفاتيح باينانس الحقيقي على الخادم بنجاح.',
    testnetConfigured: !!cachedServerCredentials.testnet,
    prodConfigured: !!cachedServerCredentials.live,
  });
});

// Endpoint to retrieve active credentials (for UI initialization if stored on server)
apiRouter.get('/binance/credentials', (req: Request, res: Response) => {
  // Ensure server credentials are fresh from disk if memory is empty
  if (!cachedServerCredentials.testnet && !cachedServerCredentials.live) {
    loadServerCredentialsFromFile();
  }

  const isTestnet = resolveIsTestnet(req.query.testnet);
  const includeAll = req.query.all === 'true';

  const testnetCreds = getServerBinanceCredentials(true);
  const liveCreds = getServerBinanceCredentials(false);

  if (includeAll) {
    return res.json({
      success: true,
      testnet: testnetCreds ? { apiKey: testnetCreds.apiKey, apiSecret: testnetCreds.apiSecret, configured: true } : null,
      live: liveCreds ? { apiKey: liveCreds.apiKey, apiSecret: liveCreds.apiSecret, configured: true } : null,
    });
  }

  const creds = isTestnet ? testnetCreds : liveCreds;
  if (creds && creds.apiKey) {
    return res.json({
      configured: true,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      isTestnet,
    });
  }

  return res.json({
    configured: false,
    isTestnet,
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
  const baseUrl = getBinanceBaseUrl(isTestnet, false, req);
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
  const baseUrl = getBinanceBaseUrl(isTestnet, false, req);
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
  const baseUrl = getBinanceBaseUrl(isTestnet, false);
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

// 4. Binance 24hr Tickers (Public Read-Only Real Market Data with Resilient Cache & Multi-Host Fallback)
let cachedTickersData: any[] | null = null;
let cachedTickersExpiry = 0;
let inFlightTickerPromise: Promise<any[]> | null = null;

async function fetchBinanceTickersWithFallback(symbol?: string): Promise<any[]> {
  const hosts = [
    'https://fapi.binance.com',
    'https://fapi1.binance.com',
    'https://fapi2.binance.com',
    'https://fapi3.binance.com',
  ];

  for (const host of hosts) {
    try {
      const url = symbol ? `${host}/fapi/v1/ticker/24hr?symbol=${symbol}` : `${host}/fapi/v1/ticker/24hr`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          return data;
        } else if (data && !Array.isArray(data) && symbol) {
          return [data];
        }
      }
    } catch {
      // try next host
    }
  }

  // If all hosts failed and we have cached data, return it
  if (cachedTickersData && cachedTickersData.length > 0) {
    return symbol
      ? cachedTickersData.filter((t: any) => t.symbol === symbol)
      : cachedTickersData;
  }

  return [];
}

apiRouter.get('/binance/ticker24hr', async (req: Request, res: Response) => {
  const symbol = req.query.symbol as string;
  const now = Date.now();

  // Return cached data if valid and fresh (15s TTL)
  if (!symbol && cachedTickersData && cachedTickersExpiry > now) {
    return res.json(cachedTickersData);
  }

  try {
    if (!symbol) {
      if (!inFlightTickerPromise) {
        inFlightTickerPromise = fetchBinanceTickersWithFallback()
          .then((data) => {
            if (data.length > 0) {
              cachedTickersData = data;
              cachedTickersExpiry = Date.now() + 15000;
            }
            return data;
          })
          .finally(() => {
            inFlightTickerPromise = null;
          });
      }
      const data = await inFlightTickerPromise;
      if (data.length > 0) {
        return res.json(data);
      }
    } else {
      const data = await fetchBinanceTickersWithFallback(symbol);
      if (data.length > 0) {
        return res.json(data);
      }
    }

    if (cachedTickersData && cachedTickersData.length > 0) {
      return res.json(symbol ? cachedTickersData.filter((t: any) => t.symbol === symbol) : cachedTickersData);
    }

    res.json([]);
  } catch (error: any) {
    if (cachedTickersData && cachedTickersData.length > 0) {
      return res.json(cachedTickersData);
    }
    res.status(500).json({ error: error.message });
  }
});

// 5. Binance Real Order Book Depth (Public Read-Only Market Data)
apiRouter.get('/binance/depth', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.query.testnet);
  const symbol = (req.query.symbol as string) || 'BTCUSDT';
  const limit = (req.query.limit as string) || '20';
  const baseUrl = getBinanceBaseUrl(isTestnet, false);

  try {
    let response = await fetch(`${baseUrl}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`);
    if (!response.ok && isTestnet) {
      response = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${limit}`);
    }
    if (!response.ok) {
      throw new Error(`Binance depth error: ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Binance Candlestick / Klines (Public Read-Only Market Data)
apiRouter.get('/binance/klines', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.query.testnet);
  const symbol = (req.query.symbol as string) || 'BTCUSDT';
  const interval = (req.query.interval as string) || '15m';
  const limit = (req.query.limit as string) || '100';
  const baseUrl = getBinanceBaseUrl(isTestnet, false);

  try {
    let response = await fetch(`${baseUrl}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!response.ok && isTestnet) {
      response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    }
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

// 7. Binance Account & Positions (Signed Read-Only)
apiRouter.post('/binance/account', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  const credentials = getEffectiveCredentials(req, isTestnet);
  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: `Binance credentials not configured (${isTestnet ? 'BINANCE_TESTNET_API_KEY or Settings' : 'BINANCE_API_KEY or Settings'})`,
    });
  }

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet, false);
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

// 8. Binance Open Orders (Reconciliation Read-Only)
apiRouter.post('/binance/openOrders', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  const { symbol } = req.body;
  const credentials = getEffectiveCredentials(req, isTestnet);

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

// 9. Binance Leverage Adjustment with Auto Step-Down Clamping
apiRouter.post('/binance/leverage', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed(req)) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_REJECTED: Binance Production environment is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const { symbol, leverage: reqLeverage } = req.body;
  const requestedLeverage = parseInt(reqLeverage, 10);
  const credentials = getEffectiveCredentials(req, isTestnet);

  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: `Binance credentials not configured on server (.env: ${isTestnet ? 'BINANCE_TESTNET_API_KEY' : 'BINANCE_API_KEY'})`,
    });
  }

  if (!symbol || isNaN(requestedLeverage)) {
    return res.status(400).json({ success: false, error: 'Missing parameters (symbol, leverage)' });
  }

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet, false, req);

  // Dynamic Adaptive Leverage Clamping:
  // Never exceed the user's requested leverage (e.g. 20x).
  // If Binance caps that coin lower (e.g. 10x or 5x), step down to highest valid tier.
  const candidateTiers = [requestedLeverage, 20, 15, 10, 8, 5, 4, 3, 2, 1]
    .filter((lev, idx, arr) => lev <= requestedLeverage && arr.indexOf(lev) === idx)
    .sort((a, b) => b - a);

  let lastError = '';
  for (const lev of candidateTiers) {
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&leverage=${lev}&timestamp=${timestamp}&recvWindow=60000`;
    const signature = signQuery(queryString, apiSecret);

    try {
      const response = await fetch(`${baseUrl}/fapi/v1/leverage?${queryString}&signature=${signature}`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': apiKey },
      });
      const data = await response.json();
      if (response.ok && data.leverage) {
        return res.json({
          success: true,
          data,
          requestedLeverage,
          effectiveLeverage: data.leverage,
          wasClamped: data.leverage < requestedLeverage,
        });
      }
      lastError = data.msg || 'Failed to change leverage';
      // If error is not related to leverage boundary, don't keep looping
      if (data.code && data.code !== -4028 && data.code !== -4141) {
        return res.status(response.status).json({ success: false, error: lastError });
      }
    } catch (err: any) {
      lastError = err.message;
      break;
    }
  }

  res.status(400).json({ success: false, error: lastError || 'Failed to set leverage' });
});

// Precision Filter Cache & Helpers to permanently prevent error -1111 ("Precision is over the maximum defined for this asset")
interface SymbolFilterInfo {
  symbol: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: number;
  stepSize: number;
  minQty: number;
  minNotional: number;
}

const symbolFilterCache = new Map<string, { data: SymbolFilterInfo; expiry: number }>();

async function getSymbolFilterInfo(symbol: string, isTestnet: boolean): Promise<SymbolFilterInfo> {
  const cacheKey = `${symbol}-${isTestnet}`;
  const cached = symbolFilterCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  const defaultFilter: SymbolFilterInfo = {
    symbol,
    pricePrecision: 2,
    quantityPrecision: 3,
    tickSize: 0.01,
    stepSize: 0.001,
    minQty: 0.001,
    minNotional: 5,
  };

  try {
    const baseUrl = getBinanceBaseUrl(isTestnet, false);
    const res = await fetch(`${baseUrl}/fapi/v1/exchangeInfo`);
    if (res.ok) {
      const data = await res.json();
      const symInfo = (data.symbols || []).find((s: any) => s.symbol === symbol);
      if (symInfo) {
        let tickSize = 0.01;
        let stepSize = 0.001;
        let minQty = 0.001;
        let minNotional = 5;

        for (const filter of symInfo.filters || []) {
          if (filter.filterType === 'PRICE_FILTER') {
            tickSize = parseFloat(filter.tickSize) || 0.01;
          } else if (filter.filterType === 'LOT_SIZE') {
            stepSize = parseFloat(filter.stepSize) || 0.001;
            minQty = parseFloat(filter.minQty) || 0.001;
          } else if (filter.filterType === 'MIN_NOTIONAL') {
            minNotional = parseFloat(filter.notional) || 5;
          }
        }

        const pricePrecision =
          typeof symInfo.pricePrecision === 'number'
            ? symInfo.pricePrecision
            : Math.max(0, Math.round(-Math.log10(tickSize)));
        const quantityPrecision =
          typeof symInfo.quantityPrecision === 'number'
            ? symInfo.quantityPrecision
            : Math.max(0, Math.round(-Math.log10(stepSize)));

        const filterResult: SymbolFilterInfo = {
          symbol,
          pricePrecision,
          quantityPrecision,
          tickSize,
          stepSize,
          minQty,
          minNotional,
        };

        symbolFilterCache.set(cacheKey, { data: filterResult, expiry: Date.now() + 60 * 60 * 1000 });
        return filterResult;
      }
    }
  } catch (err) {
    console.warn(`[Binance Filter] Failed to fetch filter info for ${symbol}:`, err);
  }
  return defaultFilter;
}

function formatQuantityByFilter(qty: number, filter: SymbolFilterInfo): string {
  if (isNaN(qty) || qty <= 0) return '0';
  const step = filter.stepSize > 0 ? filter.stepSize : 0.001;
  const precision = filter.quantityPrecision;
  const steps = Math.floor((qty + 1e-12) / step);
  const clamped = Math.max(filter.minQty, steps * step);
  return clamped.toFixed(precision);
}

function formatPriceByFilter(price: number, filter: SymbolFilterInfo): string {
  if (isNaN(price) || price <= 0) return '0';
  const tick = filter.tickSize > 0 ? filter.tickSize : 0.01;
  const precision = filter.pricePrecision;
  const steps = Math.round(price / tick);
  const clamped = steps * tick;
  return clamped.toFixed(precision);
}

// Dual-Side Position Mode (Hedge vs One-Way) Cache & Detection to permanently prevent error -4061 ("Order's position side does not match user's setting.")
const dualPositionModeCache = new Map<string, { isDual: boolean; expiry: number }>();

async function getAccountDualSidePosition(apiKey: string, apiSecret: string, baseUrl: string): Promise<boolean> {
  const cacheKey = apiKey.slice(-8);
  const cached = dualPositionModeCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.isDual;
  }

  try {
    const ts = Date.now();
    const query = `timestamp=${ts}&recvWindow=60000`;
    const sig = signQuery(query, apiSecret);
    const res = await fetch(`${baseUrl}/fapi/v1/positionSide/dual?${query}&signature=${sig}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    if (res.ok) {
      const data = await res.json();
      const isDual = Boolean(data.dualSidePosition);
      dualPositionModeCache.set(cacheKey, { isDual, expiry: Date.now() + 5 * 60 * 1000 });
      return isDual;
    }
  } catch (err) {
    console.warn('[Binance PositionMode] Query dual position mode failed:', err);
  }
  return false;
}

// 10. Binance Order Execution with Idempotency, Precision Clamping & Dual Position Handling
apiRouter.post('/binance/order', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed(req)) {
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
    closePosition = false,
    clientOrderId,
    positionSide: explicitPositionSide,
  } = req.body;

  const credentials = getEffectiveCredentials(req, isTestnet);
  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: `Binance order execution rejected: server credentials not configured (.env: ${isTestnet ? 'BINANCE_TESTNET_API_KEY' : 'BINANCE_API_KEY'})`,
    });
  }

  // Validate parameters
  const isConditionalClose = closePosition === true || closePosition === 'true';
  if (!symbol || !side) {
    return res.status(400).json({ success: false, error: 'Missing required order parameters (symbol, side)' });
  }

  if (isConditionalClose) {
    if (!stopPrice) {
      return res.status(400).json({ success: false, error: 'Missing required stopPrice for closePosition order' });
    }
  } else {
    if (!quantity || parseFloat(quantity) <= 0) {
      return res.status(400).json({ success: false, error: 'Missing required quantity for order' });
    }
  }

  // Fetch precision and step filters for this symbol to avoid -1111 Precision error
  const filterInfo = await getSymbolFilterInfo(symbol, isTestnet);

  // Idempotency lock check
  const idempotencyKey = clientOrderId || `${symbol}-${side}-${type}-${quantity || 'all'}-${Math.floor(Date.now() / 2000)}`;
  if (recentOrderIds.has(idempotencyKey)) {
    return res.status(409).json({
      success: false,
      error: 'Duplicate order detected by server execution lock (idempotency key matched).',
    });
  }
  recentOrderIds.add(idempotencyKey);
  setTimeout(() => recentOrderIds.delete(idempotencyKey), 10000);

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet, true, req);
  const timestamp = Date.now();
  const params: Record<string, string> = {
    symbol,
    side: side.toUpperCase(),
    type: type.toUpperCase(),
    timestamp: timestamp.toString(),
    recvWindow: '60000',
  };

  if (isConditionalClose) {
    params.closePosition = 'true';
  } else {
    params.quantity = formatQuantityByFilter(parseFloat(quantity), filterInfo);
    if (reduceOnly) {
      params.reduceOnly = 'true';
    }
  }

  if (stopPrice) {
    params.stopPrice = formatPriceByFilter(parseFloat(stopPrice), filterInfo);
  }

  if (clientOrderId) {
    params.newClientOrderId = clientOrderId;
  }

  // Determine correct positionSide for Binance account setting
  let resolvedPositionSide = explicitPositionSide?.toString().toUpperCase();
  if (!resolvedPositionSide) {
    const isDual = await getAccountDualSidePosition(apiKey, apiSecret, baseUrl);
    if (isDual) {
      if (side.toUpperCase() === 'BUY') {
        resolvedPositionSide = (reduceOnly || isConditionalClose) ? 'SHORT' : 'LONG';
      } else {
        resolvedPositionSide = (reduceOnly || isConditionalClose) ? 'LONG' : 'SHORT';
      }
    } else {
      resolvedPositionSide = 'BOTH';
    }
  }
  params.positionSide = resolvedPositionSide;
  // If in Dual/Hedge Mode (positionSide is LONG or SHORT), Binance strictly rejects 'reduceOnly' with error -4059.
  if (resolvedPositionSide !== 'BOTH') {
    delete params.reduceOnly;
  }

  const queryString = new URLSearchParams(params).toString();
  const signature = signQuery(queryString, apiSecret);

  try {
    let response = await fetch(`${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    let data = await response.json();

    // Auto-recover from Binance error -4061 (Order's position side does not match user's setting)
    if (!response.ok && data.code === -4061) {
      const alternateSide = resolvedPositionSide === 'BOTH'
        ? (side.toUpperCase() === 'BUY' ? (reduceOnly || isConditionalClose ? 'SHORT' : 'LONG') : (reduceOnly || isConditionalClose ? 'LONG' : 'SHORT'))
        : 'BOTH';
      params.positionSide = alternateSide;
      dualPositionModeCache.set(apiKey.slice(-8), { isDual: alternateSide !== 'BOTH', expiry: Date.now() + 5 * 60 * 1000 });

      const retryQs = new URLSearchParams(params).toString();
      const retrySig = signQuery(retryQs, apiSecret);
      response = await fetch(`${baseUrl}/fapi/v1/order?${retryQs}&signature=${retrySig}`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': apiKey },
      });
      data = await response.json();
    }

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

// 10b. Binance Atomic Bracket Order Execution (Entry + Automatic SL & TP with Precision & Dual Position Side Guard)
apiRouter.post('/binance/order-bracket', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed(req)) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_TRADING_DISABLED: Binance Production trading is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const {
    symbol,
    side,
    quantity,
    leverage,
    stopLossPrice,
    takeProfitPrice,
    clientOrderId,
  } = req.body;

  const credentials = getEffectiveCredentials(req, isTestnet);
  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: `Binance order execution rejected: server credentials not configured (${isTestnet ? 'BINANCE_TESTNET_API_KEY' : 'BINANCE_API_KEY'})`,
    });
  }

  if (!symbol || !side || !quantity || parseFloat(quantity) <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing required order parameters (symbol, side, quantity)',
    });
  }

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet, true, req);

  // Fetch precision filters to prevent error -1111 on entry, SL, and TP
  const filterInfo = await getSymbolFilterInfo(symbol, isTestnet);
  const formattedQuantity = formatQuantityByFilter(parseFloat(quantity), filterInfo);
  const formattedStopLossPrice = stopLossPrice ? formatPriceByFilter(parseFloat(stopLossPrice), filterInfo) : null;
  const formattedTakeProfitPrice = takeProfitPrice ? formatPriceByFilter(parseFloat(takeProfitPrice), filterInfo) : null;

  // Detect position mode (Hedge vs One-Way) to prevent error -4061
  const isDual = await getAccountDualSidePosition(apiKey, apiSecret, baseUrl);
  let entryPositionSide = isDual ? (side.toUpperCase() === 'BUY' ? 'LONG' : 'SHORT') : 'BOTH';
  // In Hedge Mode, protective SL and TP close the established position:
  // For LONG position: protective side is SELL, positionSide is 'LONG'.
  // For SHORT position: protective side is BUY, positionSide is 'SHORT'.
  let protectivePositionSide = entryPositionSide;

  // Step 1: Optional Leverage adjustment
  if (leverage && !isNaN(parseInt(leverage, 10))) {
    try {
      const levTimestamp = Date.now();
      const levQuery = `symbol=${symbol}&leverage=${parseInt(leverage, 10)}&timestamp=${levTimestamp}&recvWindow=60000`;
      const levSig = signQuery(levQuery, apiSecret);
      await fetch(`${baseUrl}/fapi/v1/leverage?${levQuery}&signature=${levSig}`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': apiKey },
      });
    } catch (e) {
      console.warn('[Bracket Order] Optional leverage adjustment pre-step failed:', e);
    }
  }

  // Step 2: Main Entry Order
  const entryTimestamp = Date.now();
  const entryParams: Record<string, string> = {
    symbol,
    side: side.toUpperCase(),
    positionSide: entryPositionSide,
    type: 'MARKET',
    quantity: formattedQuantity,
    timestamp: entryTimestamp.toString(),
    recvWindow: '60000',
  };
  if (clientOrderId) {
    entryParams.newClientOrderId = clientOrderId;
  }

  let entryQueryString = new URLSearchParams(entryParams).toString();
  let entrySignature = signQuery(entryQueryString, apiSecret);

  let entryOrderData: any = null;
  try {
    let entryResponse = await fetch(`${baseUrl}/fapi/v1/order?${entryQueryString}&signature=${entrySignature}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    entryOrderData = await entryResponse.json();

    // Auto-recover if position side mode mismatch occurred (-4061)
    if (!entryResponse.ok && entryOrderData.code === -4061) {
      entryPositionSide = entryPositionSide === 'BOTH' ? (side.toUpperCase() === 'BUY' ? 'LONG' : 'SHORT') : 'BOTH';
      protectivePositionSide = entryPositionSide;
      dualPositionModeCache.set(apiKey.slice(-8), { isDual: entryPositionSide !== 'BOTH', expiry: Date.now() + 5 * 60 * 1000 });
      entryParams.positionSide = entryPositionSide;

      entryQueryString = new URLSearchParams(entryParams).toString();
      entrySignature = signQuery(entryQueryString, apiSecret);
      entryResponse = await fetch(`${baseUrl}/fapi/v1/order?${entryQueryString}&signature=${entrySignature}`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': apiKey },
      });
      entryOrderData = await entryResponse.json();
    }

    if (!entryResponse.ok) {
      return res.status(entryResponse.status).json({
        success: false,
        error: entryOrderData.msg || 'Binance entry order rejected',
        code: entryOrderData.code,
      });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: `Failed to execute entry order: ${err.message}` });
  }

  // Step 3: Automatically submit Stop Loss & Take Profit directly to Binance API during this order creation call
  const protectiveSide = side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY';
  let stopLossOrderData: any = null;
  let takeProfitOrderData: any = null;
  let slError: string | null = null;
  let tpError: string | null = null;

  // Helper to place protective order with closePosition=true and fallback to reduceOnly
  const placeProtectiveOrder = async (
    orderType: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET',
    targetPriceFormatted: string
  ) => {
    const ts = Date.now();

    // Attempt A: closePosition: true with matching positionSide
    const p1: Record<string, string> = {
      symbol,
      side: protectiveSide,
      positionSide: protectivePositionSide,
      type: orderType,
      stopPrice: targetPriceFormatted,
      closePosition: 'true',
      workingType: 'MARK_PRICE',
      timestamp: ts.toString(),
      recvWindow: '60000',
    };
    let q1 = new URLSearchParams(p1).toString();
    let s1 = signQuery(q1, apiSecret);

    let res = await fetch(`${baseUrl}/fapi/v1/order?${q1}&signature=${s1}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    let data = await res.json();

    if (!res.ok && data.code === -4061) {
      protectivePositionSide = protectivePositionSide === 'BOTH' ? (side.toUpperCase() === 'BUY' ? 'LONG' : 'SHORT') : 'BOTH';
      p1.positionSide = protectivePositionSide;
      q1 = new URLSearchParams(p1).toString();
      s1 = signQuery(q1, apiSecret);
      res = await fetch(`${baseUrl}/fapi/v1/order?${q1}&signature=${s1}`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': apiKey },
      });
      data = await res.json();
    }

    if (res.ok && data.orderId) {
      return { success: true, data };
    }

    // Attempt B: fallback with reduceOnly: true and properly formatted quantity
    const ts2 = Date.now();
    const p2: Record<string, string> = {
      symbol,
      side: protectiveSide,
      positionSide: protectivePositionSide,
      type: orderType,
      stopPrice: targetPriceFormatted,
      quantity: formattedQuantity,
      reduceOnly: 'true',
      workingType: 'MARK_PRICE',
      timestamp: ts2.toString(),
      recvWindow: '60000',
    };
    let q2 = new URLSearchParams(p2).toString();
    let s2 = signQuery(q2, apiSecret);

    res = await fetch(`${baseUrl}/fapi/v1/order?${q2}&signature=${s2}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    data = await res.json();
    if (res.ok && data.orderId) {
      return { success: true, data };
    }

    return { success: false, error: data.msg || `Failed to submit ${orderType}`, code: data.code };
  };

  // Submit SL
  if (formattedStopLossPrice) {
    try {
      const slResult = await placeProtectiveOrder('STOP_MARKET', formattedStopLossPrice);
      if (slResult.success) {
        stopLossOrderData = slResult.data;
      } else {
        slError = slResult.error || 'Failed to submit SL';
      }
    } catch (e: any) {
      slError = e.message;
    }
  }

  // Submit TP
  if (formattedTakeProfitPrice) {
    try {
      const tpResult = await placeProtectiveOrder('TAKE_PROFIT_MARKET', formattedTakeProfitPrice);
      if (tpResult.success) {
        takeProfitOrderData = tpResult.data;
      } else {
        tpError = tpResult.error || 'Failed to submit TP';
      }
    } catch (e: any) {
      tpError = e.message;
    }
  }

  return res.json({
    success: true,
    order: entryOrderData,
    stopLossOrder: stopLossOrderData,
    takeProfitOrder: takeProfitOrderData,
    slSubmitted: !!stopLossOrderData,
    tpSubmitted: !!takeProfitOrderData,
    slOrderId: stopLossOrderData?.orderId?.toString(),
    tpOrderId: takeProfitOrderData?.orderId?.toString(),
    slError,
    tpError,
  });
});

// 11. Binance Cancel Single Order
apiRouter.post('/binance/cancelOrder', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed(req)) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_TRADING_DISABLED: Binance Production trading is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const { symbol, orderId } = req.body;
  const credentials = getEffectiveCredentials(req, isTestnet);

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
  const baseUrl = getBinanceBaseUrl(isTestnet, false, req);
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

// 11b. Binance Cancel All Open Orders for a Symbol (To cleanly remove pending TP/SL on close)
apiRouter.post('/binance/cancelAllOpenOrders', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed(req)) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_TRADING_DISABLED: Binance Production trading is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const { symbol } = req.body;
  const credentials = getEffectiveCredentials(req, isTestnet);

  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: `Binance credentials not configured on server (.env: ${isTestnet ? 'BINANCE_TESTNET_API_KEY' : 'BINANCE_API_KEY'})`,
    });
  }

  if (!symbol) {
    return res.status(400).json({ success: false, error: 'Missing required symbol parameter' });
  }

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet, false, req);
  const timestamp = Date.now();
  const queryString = `symbol=${symbol}&timestamp=${timestamp}&recvWindow=60000`;
  const signature = signQuery(queryString, apiSecret);

  try {
    const response = await fetch(`${baseUrl}/fapi/v1/allOpenOrders?${queryString}&signature=${signature}`, {
      method: 'DELETE',
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const data = await response.json();
    if (response.ok) {
      res.json({ success: true, result: data });
    } else {
      res.status(response.status).json({ success: false, error: data.msg || 'Cancel all open orders failed' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 11c. Binance Atomic Position Close (Cancels open SL/TP orders, fetches exact position amount, and market closes)
apiRouter.post('/binance/close-position', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed(req)) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_TRADING_DISABLED: Binance Production trading is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const { symbol } = req.body;
  const credentials = getEffectiveCredentials(req, isTestnet);
  if (!credentials) {
    return res.status(400).json({ success: false, error: 'Binance credentials not configured on server.' });
  }
  if (!symbol) {
    return res.status(400).json({ success: false, error: 'Missing required symbol parameter' });
  }

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet, true, req);

  try {
    // Step 1: Cleanly cancel all pending protective/conditional orders (SL & TP) first so they do not block closing
    try {
      const cancelTs = Date.now();
      const cancelQs = `symbol=${symbol}&timestamp=${cancelTs}&recvWindow=60000`;
      const cancelSig = signQuery(cancelQs, apiSecret);
      await fetch(`${baseUrl}/fapi/v1/allOpenOrders?${cancelQs}&signature=${cancelSig}`, {
        method: 'DELETE',
        headers: { 'X-MBX-APIKEY': apiKey },
      });
    } catch (cancelErr) {
      console.warn(`[ClosePosition] Warning: Cancel orders failed for ${symbol}:`, cancelErr);
    }

    // Step 2: Fetch actual real-time position from Binance to get exact current position amount
    const posTs = Date.now();
    const posQs = `symbol=${symbol}&timestamp=${posTs}&recvWindow=60000`;
    const posSig = signQuery(posQs, apiSecret);
    const posRes = await fetch(`${baseUrl}/fapi/v2/positionRisk?${posQs}&signature=${posSig}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const posData = await posRes.json();
    if (!posRes.ok || !Array.isArray(posData)) {
      return res.status(400).json({ success: false, error: posData?.msg || 'Failed to fetch positionRisk from Binance' });
    }

    // Find positions for this symbol with open amount
    const openPositions = posData.filter((p: any) => p.symbol === symbol && Math.abs(parseFloat(p.positionAmt || '0')) > 0);
    if (openPositions.length === 0) {
      return res.json({ success: true, alreadyClosed: true, message: `Position ${symbol} is already closed on Binance.` });
    }

    const filterInfo = await getSymbolFilterInfo(symbol, isTestnet);
    const isDual = await getAccountDualSidePosition(apiKey, apiSecret, baseUrl);
    const closeResults: any[] = [];

    for (const openPos of openPositions) {
      const positionAmt = parseFloat(openPos.positionAmt);
      const isLong = positionAmt > 0;
      const closeSide = isLong ? 'SELL' : 'BUY';
      const absQty = Math.abs(positionAmt);
      const formattedQty = formatQuantityByFilter(absQty, filterInfo);

      let positionSide = 'BOTH';
      if (isDual) {
        positionSide = isLong ? 'LONG' : 'SHORT';
      }

      const orderParams: Record<string, string> = {
        symbol,
        side: closeSide,
        type: 'MARKET',
        quantity: formattedQty,
        timestamp: Date.now().toString(),
        recvWindow: '60000',
        positionSide,
      };

      if (!isDual) {
        orderParams.reduceOnly = 'true';
      }

      let orderQs = new URLSearchParams(orderParams).toString();
      let orderSig = signQuery(orderQs, apiSecret);

      let orderRes = await fetch(`${baseUrl}/fapi/v1/order?${orderQs}&signature=${orderSig}`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': apiKey },
      });
      let orderData = await orderRes.json();

      // Auto-recover from -4061 (Order's position side does not match user's setting)
      if (!orderRes.ok && orderData.code === -4061) {
        orderParams.positionSide = positionSide === 'BOTH' ? (isLong ? 'LONG' : 'SHORT') : 'BOTH';
        if (orderParams.positionSide === 'BOTH') {
          orderParams.reduceOnly = 'true';
        } else {
          delete orderParams.reduceOnly;
        }
        orderQs = new URLSearchParams(orderParams).toString();
        orderSig = signQuery(orderQs, apiSecret);
        orderRes = await fetch(`${baseUrl}/fapi/v1/order?${orderQs}&signature=${orderSig}`, {
          method: 'POST',
          headers: { 'X-MBX-APIKEY': apiKey },
        });
        orderData = await orderRes.json();
      }

      if (orderRes.ok) {
        closeResults.push({ symbol, side: closeSide, quantity: formattedQty, success: true, order: orderData });
      } else {
        closeResults.push({ symbol, side: closeSide, quantity: formattedQty, success: false, error: orderData?.msg || 'Close order failed' });
      }
    }

    const allSuccessful = closeResults.length > 0 && closeResults.every((r) => r.success);
    if (allSuccessful) {
      return res.json({ success: true, symbol, closeResults });
    } else {
      return res.status(400).json({
        success: false,
        error: closeResults.map((r) => r.error).filter(Boolean).join('; ') || 'Failed to close position on Binance',
        closeResults,
      });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 11d. Binance Atomic Close All Positions (Emergency Kill Switch / Close All)
apiRouter.post('/binance/close-all', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  if (!isTestnet && !isProductionTradingAllowed(req)) {
    return res.status(403).json({
      success: false,
      error: 'PRODUCTION_TRADING_DISABLED: Binance Production trading is strictly blocked because ALLOW_PRODUCTION_TRADING is false.',
    });
  }

  const credentials = getEffectiveCredentials(req, isTestnet);
  if (!credentials) {
    return res.status(400).json({ success: false, error: 'Binance credentials not configured on server.' });
  }

  const { apiKey, apiSecret } = credentials;
  const baseUrl = getBinanceBaseUrl(isTestnet, true, req);

  try {
    // Step 1: Query all positions from Binance
    const posTs = Date.now();
    const posQs = `timestamp=${posTs}&recvWindow=60000`;
    const posSig = signQuery(posQs, apiSecret);
    const posRes = await fetch(`${baseUrl}/fapi/v2/positionRisk?${posQs}&signature=${posSig}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const posData = await posRes.json();
    if (!posRes.ok || !Array.isArray(posData)) {
      return res.status(400).json({ success: false, error: posData?.msg || 'Failed to fetch positionRisk from Binance' });
    }

    const activePositions = posData.filter((p: any) => Math.abs(parseFloat(p.positionAmt || '0')) > 0);
    if (activePositions.length === 0) {
      return res.json({ success: true, closedCount: 0, message: 'No open positions found on Binance.' });
    }

    const isDual = await getAccountDualSidePosition(apiKey, apiSecret, baseUrl);
    const closedSymbols: string[] = [];
    const errors: string[] = [];

    for (const openPos of activePositions) {
      const symbol = openPos.symbol;
      const positionAmt = parseFloat(openPos.positionAmt);
      const isLong = positionAmt > 0;
      const closeSide = isLong ? 'SELL' : 'BUY';
      const absQty = Math.abs(positionAmt);

      // Cancel open orders first
      try {
        const cancelTs = Date.now();
        const cancelQs = `symbol=${symbol}&timestamp=${cancelTs}&recvWindow=60000`;
        const cancelSig = signQuery(cancelQs, apiSecret);
        await fetch(`${baseUrl}/fapi/v1/allOpenOrders?${cancelQs}&signature=${cancelSig}`, {
          method: 'DELETE',
          headers: { 'X-MBX-APIKEY': apiKey },
        });
      } catch (e) {
        console.warn(`Cancel orders for ${symbol} failed:`, e);
      }

      const filterInfo = await getSymbolFilterInfo(symbol, isTestnet);
      const formattedQty = formatQuantityByFilter(absQty, filterInfo);

      let positionSide = 'BOTH';
      if (isDual) {
        positionSide = isLong ? 'LONG' : 'SHORT';
      }

      const orderParams: Record<string, string> = {
        symbol,
        side: closeSide,
        type: 'MARKET',
        quantity: formattedQty,
        timestamp: Date.now().toString(),
        recvWindow: '60000',
        positionSide,
      };

      if (!isDual) {
        orderParams.reduceOnly = 'true';
      }

      let orderQs = new URLSearchParams(orderParams).toString();
      let orderSig = signQuery(orderQs, apiSecret);

      let orderRes = await fetch(`${baseUrl}/fapi/v1/order?${orderQs}&signature=${orderSig}`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': apiKey },
      });
      let orderData = await orderRes.json();

      // Retry for -4061
      if (!orderRes.ok && orderData.code === -4061) {
        orderParams.positionSide = positionSide === 'BOTH' ? (isLong ? 'LONG' : 'SHORT') : 'BOTH';
        if (orderParams.positionSide === 'BOTH') {
          orderParams.reduceOnly = 'true';
        } else {
          delete orderParams.reduceOnly;
        }
        orderQs = new URLSearchParams(orderParams).toString();
        orderSig = signQuery(orderQs, apiSecret);
        orderRes = await fetch(`${baseUrl}/fapi/v1/order?${orderQs}&signature=${orderSig}`, {
          method: 'POST',
          headers: { 'X-MBX-APIKEY': apiKey },
        });
        orderData = await orderRes.json();
      }

      if (orderRes.ok) {
        closedSymbols.push(symbol);
      } else {
        errors.push(`${symbol}: ${orderData?.msg || 'Failed'}`);
      }
    }

    return res.json({
      success: errors.length === 0 || closedSymbols.length > 0,
      closedCount: closedSymbols.length,
      closedSymbols,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 11b. Intelligent Binance Credentials Validation & Diagnostic Endpoint
apiRouter.post('/binance/validate-credentials', async (req: Request, res: Response) => {
  const isTestnet = resolveIsTestnet(req.body.isTestnet);
  const credentials = getEffectiveCredentials(req, isTestnet);

  if (!credentials || !credentials.apiKey || !credentials.apiSecret) {
    return res.status(400).json({
      success: false,
      error: 'يرجى إدخال كل من API Key و API Secret للتحقق من الاتصال بحساب باينانس.',
      code: 'MISSING_CREDENTIALS',
    });
  }

  const { apiKey, apiSecret } = credentials;
  const primaryBaseUrl = isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
  const alternateBaseUrl = isTestnet ? 'https://fapi.binance.com' : 'https://testnet.binancefuture.com';

  const testAuth = async (baseUrl: string) => {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}&recvWindow=60000`;
    const signature = signQuery(queryString, apiSecret);
    const response = await fetch(`${baseUrl}/fapi/v2/account?${queryString}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  };

  try {
    const primaryResult = await testAuth(primaryBaseUrl);

    if (primaryResult.ok) {
      if (isTestnet) {
        cachedServerCredentials.testnet = { apiKey, apiSecret };
        process.env.BINANCE_TESTNET_API_KEY = apiKey;
        process.env.BINANCE_TESTNET_API_SECRET = apiSecret;
      } else {
        cachedServerCredentials.live = { apiKey, apiSecret };
        process.env.BINANCE_API_KEY = apiKey;
        process.env.BINANCE_API_SECRET = apiSecret;
      }
      saveServerCredentialsToFile();

      const data = primaryResult.data;
      const usdt = (data.assets || []).find((a: any) => a.asset === 'USDT') || {};
      return res.json({
        success: true,
        environment: isTestnet ? 'DEMO_TESTNET' : 'LIVE_PRODUCTION',
        walletBalance: parseFloat(data.totalWalletBalance || usdt.walletBalance || '0'),
        availableBalance: parseFloat(data.availableBalance || usdt.availableBalance || '0'),
        canTrade: data.canTrade ?? true,
        message: isTestnet
          ? 'تم التحقق بنجاح من حساب باينانس ديمو التجريبي (Binance Demo Futures).'
          : 'تم التحقق بنجاح من حساب باينانس الحقيقي المباشر (Binance Live Futures).',
      });
    }

    // Handle Binance Error Code -2015 / Auth failure with deep diagnosis
    const errorCode = primaryResult.data?.code;
    const errorMsg = primaryResult.data?.msg || 'Authentication failed';

    if (errorCode === -2015) {
      // Cross-check if this key belongs to the other environment!
      try {
        const altResult = await testAuth(alternateBaseUrl);
        if (altResult.ok) {
          const correctEnvName = isTestnet ? 'باينانس الحقيقي (Live)' : 'باينانس ديمو التجريبي (Demo Testnet)';
          return res.status(400).json({
            success: false,
            code: -2015,
            error: `المفتاح المدخل يعمل بنجاح على ${correctEnvName} وليس على البيئة المحددة حالياً. يرجى تبديل الخيار في الإعدادات إلى ${correctEnvName}.`,
            suggestedEnvIsTestnet: !isTestnet,
          });
        }
      } catch {
        // Alt check error, proceed to standard -2015 explanation
      }

      const diagnosis = isTestnet
        ? 'خطأ (-2015) في باينانس ديمو: المفتاح أو الـ Secret غير صحيحين، أو تم إنشاؤهما على موقع باينانس الحقيقي بدلاً من منصة باينانس ديمو التجريبية (testnet.binancefuture.com).'
        : 'خطأ (-2015) في باينانس الحقيقي: المفتاح غير مصرح له أو تم رفض الطلب. يرجى فتح حسابك على منصة باينانس > إدارة الـ API، والتأكد من:\n1. تفعيل خيار "Enable Futures" (تمكين العقود الآجلة).\n2. التحقق من صلاحيات القراءة والتداول.\n3. التأكد من إعدادات تقييد الآي بي (IP Access Restrictions).';

      return res.status(400).json({
        success: false,
        code: -2015,
        rawMessage: errorMsg,
        error: diagnosis,
      });
    }

    return res.status(primaryResult.status).json({
      success: false,
      code: errorCode,
      error: `فشل الاتصال بباينانس: ${errorMsg}`,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: `حدث خطأ أثناء فحص بيانات الاعتماد: ${err.message}`,
    });
  }
});

// 11c. Transition to Production Validation Endpoint
apiRouter.post('/binance/transition-to-production', async (req: Request, res: Response) => {
  const { apiKey, apiSecret, confirmRisks } = req.body;
  if (!confirmRisks) {
    return res.status(400).json({
      success: false,
      error: 'يجب تأكيد المخاطر قبل الانتقال إلى التداول الحقيقي بأموال حقيقية.',
    });
  }

  const credentials = getEffectiveCredentials(req, false);
  if (!credentials || !credentials.apiKey || !credentials.apiSecret) {
    return res.status(400).json({
      success: false,
      error: 'بيانات حساب باينانس الحقيقي (API Key و Secret) مطلوبة للانتقال إلى التداول الحقيقي.',
    });
  }

  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}&recvWindow=60000`;
  const signature = signQuery(queryString, credentials.apiSecret);

  try {
    const response = await fetch(`https://fapi.binance.com/fapi/v2/account?${queryString}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': credentials.apiKey },
    });
    const data = await response.json();

    if (response.ok) {
      return res.json({
        success: true,
        environment: 'production',
        message: 'تم التحقق من الحساب الحقيقي واعتماد الانتقال للتداول المباشر بنجاح.',
        walletBalance: parseFloat(data.totalWalletBalance || '0'),
        availableBalance: parseFloat(data.availableBalance || '0'),
        authorizedAt: Date.now(),
      });
    } else {
      return res.status(response.status).json({
        success: false,
        code: data.code,
        error: data.msg || 'فشل التحقق من حساب باينانس الحقيقي.',
      });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
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
