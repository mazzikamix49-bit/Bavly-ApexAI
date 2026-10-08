import { ClosedTrade, PerformanceMetrics } from '../types/trading';

export class PerformanceAnalyticsService {
  /**
   * Computes institutional-grade performance analytics without double counting
   */
  static calculateMetrics(closedTrades: ClosedTrade[]): PerformanceMetrics {
    if (!closedTrades || closedTrades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRatePercent: 0,
        grossProfitUsd: 0,
        grossLossUsd: 0,
        netProfitUsd: 0,
        totalCommissionsUsd: 0,
        totalFundingFeesUsd: 0,
        totalSlippageUsd: 0,
        profitFactor: 0,
        expectancyUsd: 0,
        averageWinUsd: 0,
        averageLossUsd: 0,
        maxDrawdownUsd: 0,
        maxDrawdownPercent: 0,
        consecutiveLosses: 0,
        maxConsecutiveLosses: 0,
        averageHoldingTimeMinutes: 0,
        longPerformance: { trades: 0, winRate: 0, netPnl: 0 },
        shortPerformance: { trades: 0, winRate: 0, netPnl: 0 },
        measurementPeriodDays: 0,
      };
    }

    let grossProfit = 0;
    let grossLoss = 0;
    let totalCommissions = 0;
    let totalFunding = 0;
    let totalSlippage = 0;

    let winCount = 0;
    let lossCount = 0;
    let winPnlSum = 0;
    let lossPnlSum = 0;

    let longTrades = 0;
    let longWins = 0;
    let longNetPnl = 0;

    let shortTrades = 0;
    let shortWins = 0;
    let shortNetPnl = 0;

    let totalDurationMs = 0;
    let currentConsecutiveLosses = 0;
    let maxConsecutiveLosses = 0;

    // Track cumulative equity curve for drawdown calculation
    let runningEquity = 0;
    let peakEquity = 0;
    let maxDrawdownUsd = 0;
    let maxDrawdownPercent = 0;

    // Sort chronologically ascending for accurate drawdown calculation
    const sortedTrades = [...closedTrades].sort((a, b) => a.closedAt - b.closedAt);

    for (const trade of sortedTrades) {
      // Calculate realistic commissions if not already saved:
      // Taker fee on entry + exit ~ 0.05% of notional
      const entryNotional = trade.quantity * trade.entryPrice;
      const exitNotional = trade.quantity * trade.exitPrice;
      const commission = trade.commissionPaid || (entryNotional + exitNotional) * 0.0005;
      const funding = trade.fundingFeePaid || 0;
      const slippage = trade.slippageEstimated || (entryNotional + exitNotional) * 0.0002;

      // Gross PnL
      const gross =
        trade.grossPnl !== undefined
          ? trade.grossPnl
          : trade.side === 'LONG'
          ? (trade.exitPrice - trade.entryPrice) * trade.quantity
          : (trade.entryPrice - trade.exitPrice) * trade.quantity;

      // Net PnL = Gross - Commission - Funding - Slippage
      const net = trade.netPnl !== undefined ? trade.netPnl : gross - commission - funding - slippage;

      if (gross > 0) {
        grossProfit += gross;
      } else {
        grossLoss += Math.abs(gross);
      }

      totalCommissions += commission;
      totalFunding += funding;
      totalSlippage += slippage;

      if (net > 0) {
        winCount++;
        winPnlSum += net;
        currentConsecutiveLosses = 0;
      } else {
        lossCount++;
        lossPnlSum += Math.abs(net);
        currentConsecutiveLosses++;
        if (currentConsecutiveLosses > maxConsecutiveLosses) {
          maxConsecutiveLosses = currentConsecutiveLosses;
        }
      }

      // Long vs Short breakdown
      if (trade.side === 'LONG') {
        longTrades++;
        if (net > 0) longWins++;
        longNetPnl += net;
      } else {
        shortTrades++;
        if (net > 0) shortWins++;
        shortNetPnl += net;
      }

      totalDurationMs += trade.durationMs || 0;

      // Equity curve & drawdown
      runningEquity += net;
      if (runningEquity > peakEquity) {
        peakEquity = runningEquity;
      }
      const ddUsd = peakEquity - runningEquity;
      if (ddUsd > maxDrawdownUsd) {
        maxDrawdownUsd = ddUsd;
      }
      if (peakEquity > 0) {
        const ddPct = (ddUsd / peakEquity) * 100;
        if (ddPct > maxDrawdownPercent) {
          maxDrawdownPercent = ddPct;
        }
      }
    }

    const totalTrades = closedTrades.length;
    const winRatePercent = Number(((winCount / totalTrades) * 100).toFixed(1));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99.9 : 0;

    const averageWinUsd = winCount > 0 ? Number((winPnlSum / winCount).toFixed(2)) : 0;
    const averageLossUsd = lossCount > 0 ? Number((lossPnlSum / lossCount).toFixed(2)) : 0;

    // Mathematical Expectancy = (Win% * AvgWin) - (Loss% * AvgLoss)
    const winRateFrac = winCount / totalTrades;
    const lossRateFrac = lossCount / totalTrades;
    const expectancyUsd = Number((winRateFrac * averageWinUsd - lossRateFrac * averageLossUsd).toFixed(2));

    const netProfitUsd = Number((grossProfit - grossLoss - totalCommissions - totalFunding - totalSlippage).toFixed(2));

    const averageHoldingTimeMinutes =
      totalTrades > 0 ? Math.round(totalDurationMs / totalTrades / 60000) : 0;

    // Measurement period in days
    const firstTradeTime = sortedTrades[0].openedAt;
    const lastTradeTime = sortedTrades[sortedTrades.length - 1].closedAt;
    const measurementPeriodDays = Math.max(1, Math.ceil((lastTradeTime - firstTradeTime) / (86400 * 1000)));

    return {
      totalTrades,
      winningTrades: winCount,
      losingTrades: lossCount,
      winRatePercent,
      grossProfitUsd: Number(grossProfit.toFixed(2)),
      grossLossUsd: Number(grossLoss.toFixed(2)),
      netProfitUsd,
      totalCommissionsUsd: Number(totalCommissions.toFixed(2)),
      totalFundingFeesUsd: Number(totalFunding.toFixed(2)),
      totalSlippageUsd: Number(totalSlippage.toFixed(2)),
      profitFactor,
      expectancyUsd,
      averageWinUsd,
      averageLossUsd,
      maxDrawdownUsd: Number(maxDrawdownUsd.toFixed(2)),
      maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(1)),
      consecutiveLosses: currentConsecutiveLosses,
      maxConsecutiveLosses,
      averageHoldingTimeMinutes,
      longPerformance: {
        trades: longTrades,
        winRate: longTrades > 0 ? Number(((longWins / longTrades) * 100).toFixed(1)) : 0,
        netPnl: Number(longNetPnl.toFixed(2)),
      },
      shortPerformance: {
        trades: shortTrades,
        winRate: shortTrades > 0 ? Number(((shortWins / shortTrades) * 100).toFixed(1)) : 0,
        netPnl: Number(shortNetPnl.toFixed(2)),
      },
      measurementPeriodDays,
    };
  }
}
