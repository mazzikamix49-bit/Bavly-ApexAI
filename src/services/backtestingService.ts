import { BacktestResult, Candle, TradeDirection } from '../types/trading';
import { BinanceService } from './binanceService';
import { IndicatorService } from './indicatorService';

export interface BacktestOptions {
  symbol: string;
  interval?: string;
  limit?: number;
  leverage?: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
  initialCapital?: number;
  riskPerTradePercent?: number;
  takerFeePercent?: number; // default 0.05%
  slippagePercent?: number; // default 0.02%
  fundingFeePer8hPercent?: number; // default 0.01%
}

export class BacktestingService {
  /**
   * Institutional Backtester with realistic execution friction & zero look-ahead bias
   */
  static async runBacktest(
    optionsOrSymbol: BacktestOptions | string,
    intervalArg?: string,
    limitArg?: number,
    leverageArg?: number,
    takeProfitPercentArg?: number,
    stopLossPercentArg?: number,
    initialCapitalArg?: number,
    riskPerTradePercentArg?: number
  ): Promise<BacktestResult> {
    const options: BacktestOptions =
      typeof optionsOrSymbol === 'string'
        ? {
            symbol: optionsOrSymbol,
            interval: intervalArg,
            limit: limitArg,
            leverage: leverageArg,
            takeProfitPercent: takeProfitPercentArg,
            stopLossPercent: stopLossPercentArg,
            initialCapital: initialCapitalArg,
            riskPerTradePercent: riskPerTradePercentArg,
          }
        : optionsOrSymbol;

    const symbol = options.symbol || 'BTCUSDT';
    const interval = options.interval || '15m';
    const limit = options.limit || 150;
    const leverage = Math.min(options.leverage || 20, 50);
    const tpPercent = options.takeProfitPercent || 2.5;
    const slPercent = options.stopLossPercent || 1.2;
    const initialCapital = options.initialCapital || 1000;
    const riskPercent = options.riskPerTradePercent || 1.5;

    const takerFeeRate = (options.takerFeePercent || 0.05) / 100;
    const slippageRate = (options.slippagePercent || 0.02) / 100;
    const fundingRate = (options.fundingFeePer8hPercent || 0.01) / 100;

    const klines = await BinanceService.fetchKlines(symbol, interval, limit);

    if (!Array.isArray(klines) || klines.length < 35) {
      throw new Error(`Insufficient historical candlestick data from Binance Futures for ${symbol} (need >= 35 candles).`);
    }

    let capital = initialCapital;
    let peakCapital = initialCapital;
    let maxDrawdown = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let totalCommissions = 0;
    let totalFunding = 0;
    let totalSlippage = 0;
    let winningTrades = 0;
    let losingTrades = 0;

    const trades: BacktestResult['trades'] = [];

    let inPosition = false;
    let currentSide: TradeDirection = 'LONG';
    let entryPrice = 0;
    let entryTime = 0;
    let entryIndex = 0;
    let positionQuantity = 0;
    let notional = 0;
    let plannedStopLoss = 0;
    let plannedTakeProfit = 0;

    // Rolling simulation window without look-ahead bias
    for (let i = 25; i < klines.length; i++) {
      const historicalWindow = klines.slice(0, i);
      const currentCandle = klines[i];

      if (!inPosition) {
        // Evaluate setup strictly on historicalWindow up to i-1
        const windowCloses = historicalWindow.map((c) => c.close);
        const rsi = IndicatorService.calculateRSI(windowCloses, 14);
        const ema9 = IndicatorService.calculateEMA(windowCloses, 9).pop() || 0;
        const ema21 = IndicatorService.calculateEMA(windowCloses, 21).pop() || 0;
        const atr = IndicatorService.calculateATR(historicalWindow, 14);

        const lastBar = historicalWindow[historicalWindow.length - 1];
        const lastClose = lastBar.close;

        // Long entry criteria
        const isLongSignal = rsi >= 42 && rsi <= 65 && ema9 > ema21 && lastClose > ema21;
        // Short entry criteria
        const isShortSignal = rsi <= 58 && rsi >= 35 && ema9 < ema21 && lastClose < ema21;

        if (isLongSignal || isShortSignal) {
          inPosition = true;
          currentSide = isLongSignal ? 'LONG' : 'SHORT';
          // Enter at open of currentCandle + slippage
          entryPrice = isLongSignal
            ? currentCandle.open * (1 + slippageRate)
            : currentCandle.open * (1 - slippageRate);
          entryTime = currentCandle.time;
          entryIndex = i;

          // Sizing by risk: Risk Dollar = Equity * Risk%
          const riskBudget = capital * (riskPercent / 100);
          const stopDist = Math.max(atr * 1.8, entryPrice * (slPercent / 100));
          positionQuantity = riskBudget / stopDist;
          notional = positionQuantity * entryPrice;

          plannedStopLoss =
            currentSide === 'LONG' ? entryPrice - stopDist : entryPrice + stopDist;
          plannedTakeProfit =
            currentSide === 'LONG'
              ? entryPrice + stopDist * (tpPercent / slPercent)
              : entryPrice - stopDist * (tpPercent / slPercent);

          // Taker fee on entry
          const entryFee = notional * takerFeeRate;
          totalCommissions += entryFee;
          totalSlippage += notional * slippageRate;
          capital -= entryFee;
        }
      } else {
        // We are in position. Evaluate currentCandle extremes (high / low)
        const high = currentCandle.high;
        const low = currentCandle.low;
        const isLong = currentSide === 'LONG';

        const hitTp = isLong ? high >= plannedTakeProfit : low <= plannedTakeProfit;
        const hitSl = isLong ? low <= plannedStopLoss : high >= plannedStopLoss;

        let exitReason = '';
        let exitPrice = currentCandle.close;

        // Zero look-ahead bias: If BOTH TP and SL hit within the same candle,
        // assume conservative worst-case (SL triggered first)
        if (hitTp && hitSl) {
          exitReason = 'Stop Loss (Conservative Intra-bar Resolution)';
          exitPrice = plannedStopLoss;
        } else if (hitSl) {
          exitReason = 'Stop Loss Triggered';
          exitPrice = plannedStopLoss;
        } else if (hitTp) {
          exitReason = 'Take Profit Target Reached';
          exitPrice = plannedTakeProfit;
        } else if (i - entryIndex >= 24) {
          // Time-based exit after 24 candles
          exitReason = 'Max Holding Period (24 bars)';
          exitPrice = currentCandle.close;
        }

        if (exitReason) {
          // Account for slippage on exit
          const executedExitPrice =
            currentSide === 'LONG' ? exitPrice * (1 - slippageRate) : exitPrice * (1 + slippageRate);

          const exitNotional = positionQuantity * executedExitPrice;
          const exitFee = exitNotional * takerFeeRate;
          const exitSlippage = exitNotional * slippageRate;

          // Estimate funding costs for bars held
          const barsHeld = i - entryIndex;
          const periods8h = (barsHeld * 15) / (8 * 60); // approx
          const fundingCost = notional * fundingRate * periods8h;

          // Gross PnL
          const grossPnl =
            currentSide === 'LONG'
              ? (executedExitPrice - entryPrice) * positionQuantity
              : (entryPrice - executedExitPrice) * positionQuantity;

          // Net PnL = Gross - Exit Fee - Funding - Slippage
          const netPnl = grossPnl - exitFee - fundingCost;
          const netPnlPercent = (netPnl / (notional / leverage)) * 100;

          capital += netPnl;
          totalCommissions += exitFee;
          totalFunding += fundingCost;
          totalSlippage += exitSlippage;

          if (grossPnl > 0) {
            grossProfit += grossPnl;
          } else {
            grossLoss += Math.abs(grossPnl);
          }

          if (netPnl > 0) {
            winningTrades++;
          } else {
            losingTrades++;
          }

          if (capital > peakCapital) peakCapital = capital;
          const dd = ((peakCapital - capital) / peakCapital) * 100;
          if (dd > maxDrawdown) maxDrawdown = dd;

          trades.push({
            entryTime,
            exitTime: currentCandle.time,
            side: currentSide,
            entryPrice: Number(entryPrice.toFixed(2)),
            exitPrice: Number(executedExitPrice.toFixed(2)),
            grossPnl: Number(grossPnl.toFixed(2)),
            commission: Number((exitFee + (notional * takerFeeRate)).toFixed(2)),
            netPnl: Number(netPnl.toFixed(2)),
            netPnlPercent: Number(netPnlPercent.toFixed(2)),
            pnl: Number(netPnl.toFixed(2)),
            pnlPercent: Number(netPnlPercent.toFixed(2)),
            reason: exitReason,
            marketRegime: 'TRENDING_BULL',
          });

          inPosition = false;
        }
      }
    }

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;
    const netProfit = Number((capital - initialCapital).toFixed(2));
    const netProfitPercent = Number(((netProfit / initialCapital) * 100).toFixed(2));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99.9 : 0;
    const expectancyPerTrade = totalTrades > 0 ? Number((netProfit / totalTrades).toFixed(2)) : 0;

    return {
      symbol,
      interval,
      periodDays: Math.ceil((limit * 15) / (24 * 60)),
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      initialCapital,
      finalCapital: Number(capital.toFixed(2)),
      grossProfit: Number(grossProfit.toFixed(2)),
      totalCommissions: Number(totalCommissions.toFixed(2)),
      totalFundingCosts: Number(totalFunding.toFixed(2)),
      totalSlippage: Number(totalSlippage.toFixed(2)),
      netProfit,
      netProfitPercent,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      profitFactor,
      expectancyPerTrade,
      assumptions: {
        takerFeePercent: options.takerFeePercent || 0.05,
        makerFeePercent: 0.02,
        slippagePercent: options.slippagePercent || 0.02,
        fundingRateEstimated: options.fundingFeePer8hPercent || 0.01,
        barExecutionRule: 'Conservative: Worst-case Stop-Loss assumed if both limits touched in same candle.',
      },
      trades,
    };
  }
}
