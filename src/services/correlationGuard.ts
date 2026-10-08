import { Position } from '../types/trading';

export interface PortfolioExposureReport {
  totalOpenNotionalUsd: number;
  totalInitialMarginUsd: number;
  totalRiskToStopUsd: number;
  availableRiskBudgetUsd: number;
  exposureByAsset: Record<string, { notional: number; margin: number; side: string }>;
  exposureByDirection: {
    longNotional: number;
    shortNotional: number;
    netDirectionalDelta: number;
  };
  highlyCorrelatedClusters: Array<{
    symbols: string[];
    correlation: number;
    aggregateNotional: number;
  }>;
}

export class CorrelationGuard {
  /**
   * Calculates Pearson correlation coefficient between two series of price returns
   */
  static calculatePearsonCorrelation(seriesA: number[], seriesB: number[]): number | null {
    if (!seriesA || !seriesB || seriesA.length < 5 || seriesA.length !== seriesB.length) {
      return null;
    }

    const n = seriesA.length;
    const meanA = seriesA.reduce((a, b) => a + b, 0) / n;
    const meanB = seriesB.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let varA = 0;
    let varB = 0;

    for (let i = 0; i < n; i++) {
      const diffA = seriesA[i] - meanA;
      const diffB = seriesB[i] - meanB;
      numerator += diffA * diffB;
      varA += diffA * diffA;
      varB += diffB * diffB;
    }

    if (varA === 0 || varB === 0) return 0;
    const correlation = numerator / Math.sqrt(varA * varB);
    return Number(Math.max(-1, Math.min(1, correlation)).toFixed(2));
  }

  /**
   * Evaluates aggregate portfolio exposure, directional skew and correlated assets
   */
  static evaluatePortfolio(
    openPositions: Position[],
    totalEquity: number,
    maxOpenRiskPercent = 6.0,
    priceReturnsMap?: Record<string, number[]>
  ): PortfolioExposureReport {
    let totalOpenNotionalUsd = 0;
    let totalInitialMarginUsd = 0;
    let totalRiskToStopUsd = 0;

    let longNotional = 0;
    let shortNotional = 0;

    const exposureByAsset: Record<string, { notional: number; margin: number; side: string }> = {};

    for (const p of openPositions) {
      const notional = p.quantity * p.markPrice;
      const margin = p.amountUsd;
      const risk = Math.abs(p.entryPrice - p.stopLossPrice) * p.quantity;

      totalOpenNotionalUsd += notional;
      totalInitialMarginUsd += margin;
      totalRiskToStopUsd += risk;

      if (p.side === 'LONG') {
        longNotional += notional;
      } else {
        shortNotional += notional;
      }

      exposureByAsset[p.symbol] = {
        notional: Number(notional.toFixed(2)),
        margin: Number(margin.toFixed(2)),
        side: p.side,
      };
    }

    const totalAllowedRiskUsd = totalEquity * (maxOpenRiskPercent / 100);
    const availableRiskBudgetUsd = Math.max(0, totalAllowedRiskUsd - totalRiskToStopUsd);

    const netDirectionalDelta = Number((longNotional - shortNotional).toFixed(2));

    // Calculate real correlations if return series are provided
    const highlyCorrelatedClusters: PortfolioExposureReport['highlyCorrelatedClusters'] = [];
    if (priceReturnsMap && openPositions.length >= 2) {
      const symbols = openPositions.map((p) => p.symbol);
      for (let i = 0; i < symbols.length; i++) {
        for (let j = i + 1; j < symbols.length; j++) {
          const symA = symbols[i];
          const symB = symbols[j];
          const returnsA = priceReturnsMap[symA];
          const returnsB = priceReturnsMap[symB];

          if (returnsA && returnsB) {
            const corr = this.calculatePearsonCorrelation(returnsA, returnsB);
            if (corr !== null && corr >= 0.80) {
              const aggNotional =
                (exposureByAsset[symA]?.notional || 0) + (exposureByAsset[symB]?.notional || 0);
              highlyCorrelatedClusters.push({
                symbols: [symA, symB],
                correlation: corr,
                aggregateNotional: Number(aggNotional.toFixed(2)),
              });
            }
          }
        }
      }
    }

    return {
      totalOpenNotionalUsd: Number(totalOpenNotionalUsd.toFixed(2)),
      totalInitialMarginUsd: Number(totalInitialMarginUsd.toFixed(2)),
      totalRiskToStopUsd: Number(totalRiskToStopUsd.toFixed(2)),
      availableRiskBudgetUsd: Number(availableRiskBudgetUsd.toFixed(2)),
      exposureByAsset,
      exposureByDirection: {
        longNotional: Number(longNotional.toFixed(2)),
        shortNotional: Number(shortNotional.toFixed(2)),
        netDirectionalDelta,
      },
      highlyCorrelatedClusters,
    };
  }
}
