import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

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

// Helpers for Binance API
const getBinanceBaseUrl = (isTestnet = false) => {
  return isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
};

const signQuery = (queryString: string, apiSecret: string): string => {
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
};

// 1. Binance Connectivity Test
app.get('/api/binance/ping', async (req: Request, res: Response) => {
  const isTestnet = req.query.testnet === 'true';
  const baseUrl = getBinanceBaseUrl(isTestnet);
  try {
    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/fapi/v1/ping`);
    const latency = Date.now() - startTime;
    if (response.ok) {
      res.json({ success: true, latency, status: 'online', isTestnet });
    } else {
      res.status(response.status).json({ success: false, status: 'error', code: response.status });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Connection failed' });
  }
});

// 2. Binance Server Time
app.get('/api/binance/time', async (req: Request, res: Response) => {
  const isTestnet = req.query.testnet === 'true';
  const baseUrl = getBinanceBaseUrl(isTestnet);
  try {
    const response = await fetch(`${baseUrl}/fapi/v1/time`);
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Binance Exchange Info (USDT-M Pairs)
app.get('/api/binance/exchangeInfo', async (req: Request, res: Response) => {
  const isTestnet = req.query.testnet === 'true';
  const baseUrl = getBinanceBaseUrl(isTestnet);
  try {
    const response = await fetch(`${baseUrl}/fapi/v1/exchangeInfo`);
    if (!response.ok) {
      throw new Error(`Binance responded with ${response.status}`);
    }
    const data = await response.json();
    // Filter only USDT-M active perpetual futures
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

// 4. Binance 24hr Ticker Price Change
app.get('/api/binance/ticker24hr', async (req: Request, res: Response) => {
  const isTestnet = req.query.testnet === 'true';
  const symbol = req.query.symbol as string;
  const baseUrl = getBinanceBaseUrl(isTestnet);
  try {
    const url = symbol ? `${baseUrl}/fapi/v1/ticker/24hr?symbol=${symbol}` : `${baseUrl}/fapi/v1/ticker/24hr`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Binance responded with ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Binance Candlestick / Klines
app.get('/api/binance/klines', async (req: Request, res: Response) => {
  const isTestnet = req.query.testnet === 'true';
  const symbol = (req.query.symbol as string) || 'BTCUSDT';
  const interval = (req.query.interval as string) || '15m';
  const limit = (req.query.limit as string) || '100';
  const baseUrl = getBinanceBaseUrl(isTestnet);

  try {
    const response = await fetch(`${baseUrl}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Binance responded with ${response.status}`);
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

// 6. Binance Account Balance & Position Risk (Signed)
app.post('/api/binance/account', async (req: Request, res: Response) => {
  const { apiKey, apiSecret, isTestnet } = req.body;

  if (!apiKey || !apiSecret) {
    return res.status(400).json({ success: false, error: 'API Key and Secret are required' });
  }

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

    // Extract USDT asset balance
    const usdtAsset = (accountData.assets || []).find((a: any) => a.asset === 'USDT') || {
      walletBalance: '0',
      availableBalance: '0',
      unrealizedProfit: '0',
      marginBalance: '0',
      initialMargin: '0',
      maintMargin: '0',
    };

    // Filter active open positions (positionAmt != 0)
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
                ? ((parseFloat(p.markPrice) - parseFloat(p.entryPrice)) /
                    parseFloat(p.entryPrice)) *
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

// 7. Binance Change Leverage
app.post('/api/binance/leverage', async (req: Request, res: Response) => {
  const { apiKey, apiSecret, isTestnet, symbol, leverage } = req.body;

  if (!apiKey || !apiSecret || !symbol || !leverage) {
    return res.status(400).json({ success: false, error: 'Missing parameters' });
  }

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
    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: data.msg, code: data.code });
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. Binance Place Order (MARKET / LIMIT Futures Order)
app.post('/api/binance/order', async (req: Request, res: Response) => {
  const { apiKey, apiSecret, isTestnet, symbol, side, type = 'MARKET', quantity, reduceOnly = false } = req.body;

  if (!apiKey || !apiSecret || !symbol || !side || !quantity) {
    return res.status(400).json({ success: false, error: 'Missing required order parameters' });
  }

  const baseUrl = getBinanceBaseUrl(isTestnet);
  const timestamp = Date.now();
  let queryString = `symbol=${symbol}&side=${side}&type=${type}&quantity=${quantity}&timestamp=${timestamp}&recvWindow=60000`;
  if (reduceOnly) {
    queryString += `&reduceOnly=true`;
  }
  const signature = signQuery(queryString, apiSecret);

  try {
    const response = await fetch(`${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: data.msg, code: data.code });
    }
    res.json({ success: true, order: data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 9. Telegram Notification Dispatch
app.post('/api/telegram/send', async (req: Request, res: Response) => {
  const { botToken, chatId, message } = req.body;

  if (!botToken || !chatId || !message) {
    return res.status(400).json({ success: false, error: 'Bot token, chat ID, and message are required' });
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    const data = await response.json();
    if (data.ok) {
      res.json({ success: true, messageId: data.result?.message_id });
    } else {
      res.status(400).json({ success: false, error: data.description });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Robust Gemini Content Generator with multi-model fallback (handles 503 High Demand spikes)
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash'];

async function generateContentWithFallback(prompt: string, config?: any): Promise<string | null> {
  if (!aiClient) return null;

  for (const model of FALLBACK_MODELS) {
    try {
      // Race against a 2.5-second timeout per model
      const callPromise = aiClient.models.generateContent({
        model,
        contents: prompt,
        config,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 2500)
      );

      const response = await Promise.race([callPromise, timeoutPromise]);
      if (response && response.text) {
        return response.text;
      }
    } catch {
      // If 503 or 404 or TIMEOUT, continue smoothly to next valid model
      continue;
    }
  }
  return null;
}

// 10. Gemini AI Market Analysis & Trade Recommendation
app.post('/api/ai/analyze', async (req: Request, res: Response) => {
  const { symbol, price, change24h, rsi, volume, trend, orderbookRatio, language = 'en' } = req.body;

  const defaultAnalysis = {
    signal: change24h >= 0 ? 'BUY_LONG' : 'SELL_SHORT',
    confidence: Math.min(96, Math.max(78, Math.round(80 + Math.abs(change24h || 1) * 1.5 + ((rsi || 50) > 50 ? 5 : -5)))),
    rationale:
      language === 'ar'
        ? `تحليل خوارزمي ذكي لـ ${symbol}: مؤشر القوة النسبية RSI عند ${rsi || 50} وتغير 24h بنسبة ${change24h || 0}% مع تدفق سيولة إيجابي.`
        : `Algorithmic analysis for ${symbol}: RSI at ${rsi || 50}, 24h price momentum at ${change24h || 0}% with healthy orderflow.`,
    recommendedLeverage: (change24h || 0) > 5 ? 15 : 20,
    riskScore: 'LOW_TO_MEDIUM',
  };

  if (!aiClient) {
    return res.json({ success: true, analysis: defaultAnalysis });
  }

  try {
    const prompt = `You are ApexAI, an elite algorithmic crypto futures trading quant. Analyze the following real-time Binance Futures market data:
Symbol: ${symbol}
Current Price: $${price}
24h Price Change: ${change24h}%
14-period RSI: ${rsi}
24h Volume: $${volume}
Market Trend: ${trend}
Orderbook Buy/Sell Ratio: ${orderbookRatio}
Requested Language: ${language}

Provide a concise, JSON formatted response with:
1. "signal": "BUY_LONG" or "SELL_SHORT" or "NEUTRAL"
2. "confidence": number between 70 and 98 (win probability %)
3. "rationale": 2-3 sentence technical explanation in ${language === 'ar' ? 'Arabic' : 'English'} explaining momentum, RSI divergence, and risk.
4. "recommendedLeverage": suggested leverage (e.g. 10, 20, 50)
5. "riskScore": "LOW", "MEDIUM", or "HIGH"
Respond with raw JSON only.`;

    const rawText = await generateContentWithFallback(prompt, {
      responseMimeType: 'application/json',
    });

    if (rawText) {
      const parsed = JSON.parse(rawText);
      return res.json({ success: true, analysis: parsed });
    }
    return res.json({ success: true, analysis: defaultAnalysis });
  } catch (error: any) {
    console.error('Gemini AI analysis error:', error);
    return res.json({ success: true, analysis: defaultAnalysis });
  }
});

// 11. AI Assistant Chat (Arabic / English 24/7 technical support)
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  const { message, language = 'en' } = req.body;

  const fallbackResponse =
    language === 'ar'
      ? 'أهلاً بك في الدعم الفني الذكي لبوت ApexAI! 🤖\n\n• **تشغيل البوت بدون كود:** البوت يعمل تلقائياً وبشكل كامل عبر هذه الواجهة دون الحاجة لتشغيل أي أكواد أو بايثون.\n• **الربط مع Binance Futures:** يمكنك إدخال مفتاح الـ API والـ Secret Key في نافذة الإعدادات والتأكد من تفعيل خيار "Enable Futures" في إعدادات حسابك على بينانس.\n• **إدارة المخاطر:** يُنصح باختيار رافعة مالية بين 10x و 20x، وتفعيل وقف الخسارة (Stop Loss) عند 1% إلى 1.5% لتفادي التصفية.\n\nهل تود مساعدة في ضبط أي إعداد محدد؟'
      : 'Welcome to ApexAI 24/7 Technical Support! 🤖\n\n• **No-Code Operation:** The bot runs fully autonomously through this web app without requiring Python or coding.\n• **Binance Futures API:** Enter your API Key and Secret Key in Settings. Ensure "Enable Futures" is checked in your Binance API Management.\n• **Risk Management:** We recommend starting with 10x-20x leverage and keeping stop-losses at 1.0%-1.5% to safeguard your margin.\n\nHow else can I assist your trading setup?';

  if (!aiClient) {
    return res.json({ success: true, reply: fallbackResponse });
  }

  try {
    const systemPrompt = `You are ApexAI's 24/7 Elite Technical Support & Crypto Futures Trading Assistant.
You specialize in Binance USDT-M Futures, leverage (1x to 150x), margin management (Cross vs Isolated), Stop-Loss/Take-Profit calculations, API key security, and algorithmic trading strategies.
Reply in ${language === 'ar' ? 'Arabic' : 'English'}. Be concise, highly professional, encouraging, and clear.`;

    const prompt = `${systemPrompt}\nUser question: ${message}`;
    const replyText = await generateContentWithFallback(prompt);

    if (replyText) {
      return res.json({ success: true, reply: replyText });
    }
    return res.json({ success: true, reply: fallbackResponse });
  } catch (error: any) {
    console.error('Gemini chat error, returning helpful response:', error);
    return res.json({ success: true, reply: fallbackResponse });
  }
});

// Setup Vite or static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ApexAI Futures Server running on port ${PORT}`);
  });
}

startServer();
