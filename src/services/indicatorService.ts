import { Candle, MarketRegime } from '../types/trading';

export interface IndicatorBundle {
  rsi14: number;
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  atr14: number;
  adx14: number;
  plusDI: number;
  minusDI: number;
  macd: { macd: number; signal: number; histogram: number };
  vwap: number;
  relativeVolume: number;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  regime: MarketRegime;
}

export class IndicatorService {
  /**
   * Mathematically exact Wilder's RSI (14-period)
   * Formula:
   * RS = Smoothed Average Gain / Smoothed Average Loss
   * RSI = 100 - (100 / (1 + RS))
   */
  static calculateRSI(prices: number[], period = 14): number {
    if (!prices || prices.length < period + 1) {
      return 50.0;
    }

    let gains = 0;
    let losses = 0;

    // First period: Simple average of gains and losses
    for (let i = 1; i <= period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) {
        gains += diff;
      } else {
        losses += Math.abs(diff);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Subsequent periods: Wilder's smoothing
    for (let i = period + 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      const currentGain = diff >= 0 ? diff : 0;
      const currentLoss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }

    if (avgLoss === 0) {
      return 100.0;
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);
    return Number(Math.max(0, Math.min(100, rsi)).toFixed(2));
  }

  /**
   * Exponential Moving Average (EMA)
   * Multiplier = 2 / (period + 1)
   */
  static calculateEMA(prices: number[], period: number): number[] {
    if (!prices || prices.length === 0) return [];
    if (prices.length < period) {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      return prices.map(() => avg);
    }

    const k = 2 / (period + 1);
    const emaArray: number[] = new Array(prices.length);

    // Initial SMA for the first 'period' values
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += prices[i];
    }
    let prevEma = sum / period;
    emaArray[period - 1] = prevEma;

    for (let i = period; i < prices.length; i++) {
      const currentEma = prices[i] * k + prevEma * (1 - k);
      emaArray[i] = currentEma;
      prevEma = currentEma;
    }

    // Fill earlier values for safe access
    for (let i = 0; i < period - 1; i++) {
      emaArray[i] = emaArray[period - 1];
    }

    return emaArray;
  }

  /**
   * Average True Range (ATR 14)
   * True Range = max(H - L, |H - C_prev|, |L - C_prev|)
   * Wilder's smoothed over 14 periods.
   */
  static calculateATR(candles: Candle[], period = 14): number {
    if (!candles || candles.length < 2) return 0;

    const trList: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const prev = candles[i - 1];
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prev.close),
        Math.abs(current.low - prev.close)
      );
      trList.push(tr);
    }

    if (trList.length < period) {
      const sum = trList.reduce((acc, v) => acc + v, 0);
      return Number((sum / trList.length).toFixed(4));
    }

    // Initial ATR
    let atr = trList.slice(0, period).reduce((acc, v) => acc + v, 0) / period;

    // Wilder's smoothing
    for (let i = period; i < trList.length; i++) {
      atr = (atr * (period - 1) + trList[i]) / period;
    }

    return Number(atr.toFixed(4));
  }

  /**
   * Average Directional Index (ADX 14)
   * Quantifies trend strength (0 to 100).
   */
  static calculateADX(candles: Candle[], period = 14): { adx: number; plusDI: number; minusDI: number } {
    if (!candles || candles.length < period * 2) {
      return { adx: 22.0, plusDI: 20.0, minusDI: 20.0 };
    }

    const tr: number[] = [];
    const plusDM: number[] = [];
    const minusDM: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const cur = candles[i];
      const prev = candles[i - 1];

      const trueRange = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
      tr.push(trueRange);

      const upMove = cur.high - prev.high;
      const downMove = prev.low - cur.low;

      if (upMove > downMove && upMove > 0) {
        plusDM.push(upMove);
      } else {
        plusDM.push(0);
      }

      if (downMove > upMove && downMove > 0) {
        minusDM.push(downMove);
      } else {
        minusDM.push(0);
      }
    }

    let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

    const dxList: number[] = [];

    for (let i = period; i < tr.length; i++) {
      smoothTR = smoothTR - smoothTR / period + tr[i];
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];

      const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
      const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
      const sumDI = plusDI + minusDI;
      const dx = sumDI > 0 ? (Math.abs(plusDI - minusDI) / sumDI) * 100 : 0;
      dxList.push(dx);
    }

    if (dxList.length < period) {
      return { adx: 25.0, plusDI: 22.0, minusDI: 18.0 };
    }

    let adx = dxList.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dxList.length; i++) {
      adx = (adx * (period - 1) + dxList[i]) / period;
    }

    const finalPlusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const finalMinusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

    return {
      adx: Number(adx.toFixed(1)),
      plusDI: Number(finalPlusDI.toFixed(1)),
      minusDI: Number(finalMinusDI.toFixed(1)),
    };
  }

  /**
   * Moving Average Convergence Divergence (MACD 12, 26, 9)
   */
  static calculateMACD(
    prices: number[],
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9
  ): { macd: number; signal: number; histogram: number } {
    if (!prices || prices.length < slowPeriod + signalPeriod) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    const fastEma = this.calculateEMA(prices, fastPeriod);
    const slowEma = this.calculateEMA(prices, slowPeriod);

    const macdLine: number[] = [];
    for (let i = 0; i < prices.length; i++) {
      macdLine.push(fastEma[i] - slowEma[i]);
    }

    const signalLine = this.calculateEMA(macdLine, signalPeriod);
    const lastIdx = prices.length - 1;
    const finalMacd = macdLine[lastIdx];
    const finalSignal = signalLine[lastIdx];
    const histogram = finalMacd - finalSignal;

    return {
      macd: Number(finalMacd.toFixed(4)),
      signal: Number(finalSignal.toFixed(4)),
      histogram: Number(histogram.toFixed(4)),
    };
  }

  /**
   * Volume Weighted Average Price (VWAP)
   * Formula: Sum(Typical Price * Volume) / Sum(Volume)
   * where Typical Price = (High + Low + Close) / 3
   */
  static calculateVWAP(candles: Candle[]): number {
    if (!candles || candles.length === 0) return 0;

    let cumulativePv = 0;
    let cumulativeVol = 0;

    for (const c of candles) {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumulativePv += typicalPrice * c.volume;
      cumulativeVol += c.volume;
    }

    if (cumulativeVol === 0) return candles[candles.length - 1].close;
    return Number((cumulativePv / cumulativeVol).toFixed(4));
  }

  /**
   * Relative Volume (RVOL)
   * Compares the current candle volume to the rolling 20-period average volume
   */
  static calculateRelativeVolume(candles: Candle[], lookback = 20): number {
    if (!candles || candles.length < 2) return 1.0;

    const currentVol = candles[candles.length - 1].volume;
    const slice = candles.slice(Math.max(0, candles.length - 1 - lookback), candles.length - 1);
    if (slice.length === 0) return 1.0;

    const avgVol = slice.reduce((acc, c) => acc + c.volume, 0) / slice.length;
    if (avgVol <= 0) return 1.0;

    return Number((currentVol / avgVol).toFixed(2));
  }

  /**
   * Order Book Depth Imbalance Ratio
   * Calculated from actual Binance Futures depth level quantities.
   * ratio = totalBidVolume / (totalBidVolume + totalAskVolume)
   * 0.5 = neutral, > 0.55 = buy pressure, < 0.45 = sell pressure
   */
  static calculateOrderBookImbalance(
    bids: Array<[number | string, number | string]>,
    asks: Array<[number | string, number | string]>
  ): {
    bidVolume: number;
    askVolume: number;
    bidDepthUsd: number;
    askDepthUsd: number;
    imbalanceRatio: number;
    spread: number;
    spreadPercent: number;
  } {
    if (!bids || !asks || bids.length === 0 || asks.length === 0) {
      return {
        bidVolume: 0,
        askVolume: 0,
        bidDepthUsd: 0,
        askDepthUsd: 0,
        imbalanceRatio: 1.0,
        spread: 0,
        spreadPercent: 0,
      };
    }

    let bidVolume = 0;
    let bidDepthUsd = 0;
    let askVolume = 0;
    let askDepthUsd = 0;

    for (let i = 0; i < Math.min(bids.length, 20); i++) {
      const price = parseFloat(bids[i][0] as string);
      const qty = parseFloat(bids[i][1] as string);
      bidVolume += qty;
      bidDepthUsd += price * qty;
    }

    for (let i = 0; i < Math.min(asks.length, 20); i++) {
      const price = parseFloat(asks[i][0] as string);
      const qty = parseFloat(asks[i][1] as string);
      askVolume += qty;
      askDepthUsd += price * qty;
    }

    const bestBid = parseFloat(bids[0][0] as string);
    const bestAsk = parseFloat(asks[0][0] as string);
    const spread = Math.max(0, bestAsk - bestBid);
    const midPrice = (bestAsk + bestBid) / 2;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    // Imbalance ratio: Bid depth USD vs Ask depth USD
    const totalDepth = bidDepthUsd + askDepthUsd;
    const ratio = totalDepth > 0 ? (bidDepthUsd / askDepthUsd) : 1.0;

    return {
      bidVolume: Number(bidVolume.toFixed(3)),
      askVolume: Number(askVolume.toFixed(3)),
      bidDepthUsd: Number(bidDepthUsd.toFixed(2)),
      askDepthUsd: Number(askDepthUsd.toFixed(2)),
      imbalanceRatio: Number(Math.max(0.1, Math.min(10.0, ratio)).toFixed(2)),
      spread: Number(spread.toFixed(4)),
      spreadPercent: Number(spreadPercent.toFixed(3)),
    };
  }

  /**
   * Comprehensive indicator bundle compilation from candles
   */
  static analyzeCandles(candles: Candle[]): IndicatorBundle {
    if (!candles || candles.length < 15) {
      return {
        rsi14: 50.0,
        ema9: 0,
        ema21: 0,
        ema50: 0,
        ema200: 0,
        atr14: 0,
        adx14: 20.0,
        plusDI: 20.0,
        minusDI: 20.0,
        macd: { macd: 0, signal: 0, histogram: 0 },
        vwap: 0,
        relativeVolume: 1.0,
        trend: 'NEUTRAL',
        regime: 'RANGING_CONSOLIDATION',
      };
    }

    const closePrices = candles.map((c) => c.close);
    const lastPrice = closePrices[closePrices.length - 1];

    const rsi14 = this.calculateRSI(closePrices, 14);
    const ema9List = this.calculateEMA(closePrices, 9);
    const ema21List = this.calculateEMA(closePrices, 21);
    const ema50List = this.calculateEMA(closePrices, 50);
    const ema200List = this.calculateEMA(closePrices, 200);

    const ema9 = ema9List[ema9List.length - 1];
    const ema21 = ema21List[ema21List.length - 1];
    const ema50 = ema50List[ema50List.length - 1];
    const ema200 = ema200List[ema200List.length - 1];

    const atr14 = this.calculateATR(candles, 14);
    const adxData = this.calculateADX(candles, 14);
    const macdData = this.calculateMACD(closePrices);
    const vwap = this.calculateVWAP(candles);
    const relativeVolume = this.calculateRelativeVolume(candles);

    // Determine trend from moving average stacking
    let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (ema9 > ema21 && lastPrice > ema50) {
      trend = 'BULLISH';
    } else if (ema9 < ema21 && lastPrice < ema50) {
      trend = 'BEARISH';
    }

    // Market regime detection
    let regime: MarketRegime = 'RANGING_CONSOLIDATION';
    const atrPercent = lastPrice > 0 ? (atr14 / lastPrice) * 100 : 0;

    if (adxData.adx >= 25 && trend === 'BULLISH') {
      regime = 'TRENDING_BULL';
    } else if (adxData.adx >= 25 && trend === 'BEARISH') {
      regime = 'TRENDING_BEAR';
    } else if (relativeVolume >= 1.8 && atrPercent >= 1.5) {
      regime = 'VOLATILITY_BREAKOUT';
    } else if (adxData.adx < 20) {
      regime = 'RANGING_CONSOLIDATION';
    } else {
      regime = 'HIGH_NOISE';
    }

    return {
      rsi14,
      ema9: Number(ema9.toFixed(4)),
      ema21: Number(ema21.toFixed(4)),
      ema50: Number(ema50.toFixed(4)),
      ema200: Number(ema200.toFixed(4)),
      atr14,
      adx14: adxData.adx,
      plusDI: adxData.plusDI,
      minusDI: adxData.minusDI,
      macd: macdData,
      vwap,
      relativeVolume,
      trend,
      regime,
    };
  }
}
