import { BacktestResult, TradeDirection } from '../types/trading';
import { BinanceService } from './binanceService';

export class BacktestingService {
  static async runBacktest(
    symbol: string,
    interval = '15m',
    limit = 100,
    leverage = 20,
    takeProfitPercent = 2.5,
    stopLossPercent = 1.2,
    initialCapital = 1000,
    positionSizeUsd = 100
  ): Promise<BacktestResult> {
    const klines = await BinanceService.fetchKlines(symbol, interval, limit);

    if (!Array.isArray(klines) || klines.length < 20) {
      throw new Error('Insufficient candlestick data from Binance');
    }

    let capital = initialCapital;
    let peakCapital = initialCapital;
    let maxDrawdown = 0;
    const trades: BacktestResult['trades'] = [];

    let inPosition = false;
    let currentSide: TradeDirection = 'LONG';
    let entryPrice = 0;
    let entryTime = 0;
    let entryIndex = 0;

    // Simulate strategy over historical candles
    for (let i = 15; i < klines.length; i++) {
      const candle = klines[i];
      const prevCandle = klines[i - 1];
      const close = candle.close;
      const high = candle.high;
      const low = candle.low;

      // Simple EMA / Momentum trend logic for backtesting
      const shortChange = ((close - klines[i - 3].close) / klines[i - 3].close) * 100;
      const volumeSpike = candle.volume > prevCandle.volume * 1.3;

      if (!inPosition) {
        // Entry condition
        if (shortChange > 0.8 && volumeSpike) {
          inPosition = true;
          currentSide = 'LONG';
          entryPrice = close;
          entryTime = candle.time;
          entryIndex = i;
        } else if (shortChange < -0.8 && volumeSpike) {
          inPosition = true;
          currentSide = 'SHORT';
          entryPrice = close;
          entryTime = candle.time;
          entryIndex = i;
        }
      } else {
        // In position: check TP / SL / Max duration (e.g. 15 candles)
        const priceDiff = currentSide === 'LONG' ? (close - entryPrice) / entryPrice : (entryPrice - close) / entryPrice;
        const currentPnlPercent = priceDiff * 100 * leverage;

        const highDiff = currentSide === 'LONG' ? (high - entryPrice) / entryPrice : (entryPrice - low) / entryPrice;
        const lowDiff = currentSide === 'LONG' ? (low - entryPrice) / entryPrice : (entryPrice - high) / entryPrice;

        const maxPnlPercent = highDiff * 100 * leverage;
        const minPnlPercent = lowDiff * 100 * leverage;

        let exitReason = '';
        let exitPrice = close;

        if (maxPnlPercent >= takeProfitPercent * leverage) {
          exitReason = 'Take Profit Target Reached';
          exitPrice = currentSide === 'LONG' ? entryPrice * (1 + takeProfitPercent / 100) : entryPrice * (1 - takeProfitPercent / 100);
        } else if (minPnlPercent <= -stopLossPercent * leverage) {
          exitReason = 'Stop Loss Triggered';
          exitPrice = currentSide === 'LONG' ? entryPrice * (1 - stopLossPercent / 100) : entryPrice * (1 + stopLossPercent / 100);
        } else if (i - entryIndex >= 16) {
          exitReason = 'Max Time Limit (Scalp Expiry)';
          exitPrice = close;
        }

        if (exitReason) {
          const finalPriceDiff = currentSide === 'LONG' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
          const finalPnlPercent = finalPriceDiff * 100 * leverage;
          const dollarPnl = (positionSizeUsd * (finalPnlPercent / 100));

          capital += dollarPnl;
          if (capital > peakCapital) peakCapital = capital;
          const drawdown = ((peakCapital - capital) / peakCapital) * 100;
          if (drawdown > maxDrawdown) maxDrawdown = drawdown;

          trades.push({
            entryTime,
            exitTime: candle.time,
            side: currentSide,
            entryPrice,
            exitPrice,
            pnl: dollarPnl,
            pnlPercent: finalPnlPercent,
            reason: exitReason,
          });

          inPosition = false;
        }
      }
    }

    const winningTrades = trades.filter((t) => t.pnl > 0).length;
    const losingTrades = trades.filter((t) => t.pnl <= 0).length;
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const grossProfit = trades.filter((t) => t.pnl > 0).reduce((acc, t) => acc + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((acc, t) => acc + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 1;
    const netProfit = capital - initialCapital;
    const netProfitPercent = (netProfit / initialCapital) * 100;

    return {
      symbol,
      interval,
      periodDays: Math.round((limit * 15) / (60 * 24)),
      totalTrades,
      winningTrades,
      losingTrades,
      winRate: Number(winRate.toFixed(1)),
      initialCapital,
      finalCapital: Number(capital.toFixed(2)),
      netProfit: Number(netProfit.toFixed(2)),
      netProfitPercent: Number(netProfitPercent.toFixed(2)),
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
      trades,
    };
  }
}
