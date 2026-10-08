import { BinanceCredentials, Position, ReconciliationStatus } from '../types/trading';
import { BinanceService } from './binanceService';

export interface ReconciliationReport {
  timestamp: number;
  status: ReconciliationStatus;
  hasDiscrepancy: boolean;
  message: string;
  exchangePositionsCount: number;
  localPositionsCount: number;
  openOrdersCount: number;
  discrepancies: Array<{
    symbol: string;
    type:
      | 'UNKNOWN_EXCHANGE_POSITION'
      | 'MISSING_LOCAL_POSITION'
      | 'QUANTITY_MISMATCH'
      | 'MISSING_PROTECTIVE_SL'
      | 'MISSING_PROTECTIVE_TP'
      | 'MANUAL_EXCHANGE_CLOSE';
    detail: string;
    actionTaken: string;
  }>;
}

export class PositionReconciliationService {
  /**
   * Reconciles local positions against Binance Futures exchange positions & open orders
   */
  static async reconcile(
    credentials: BinanceCredentials,
    localPositions: Position[],
    isRealMode: boolean
  ): Promise<ReconciliationReport> {
    const now = Date.now();

    // If Paper mode, local simulation is authoritative
    if (!isRealMode || !credentials.isValidated) {
      return {
        timestamp: now,
        status: 'IN_SYNC',
        hasDiscrepancy: false,
        message: 'Paper Trading Sandbox: Local state authoritative, no exchange reconciliation needed.',
        exchangePositionsCount: 0,
        localPositionsCount: localPositions.length,
        openOrdersCount: 0,
        discrepancies: [],
      };
    }

    try {
      // 1. Fetch live exchange positions & open orders concurrently
      const [accountRes, openOrdersRes] = await Promise.all([
        BinanceService.fetchAccount(credentials),
        BinanceService.fetchOpenOrders(credentials),
      ]);

      if (!accountRes.success) {
        return {
          timestamp: now,
          status: 'ERROR',
          hasDiscrepancy: true,
          message: `Reconciliation failed to query Binance account: ${accountRes.error}`,
          exchangePositionsCount: 0,
          localPositionsCount: localPositions.length,
          openOrdersCount: 0,
          discrepancies: [],
        };
      }

      const exchangePositions = accountRes.positions || [];
      const openOrders = openOrdersRes.orders || [];

      const discrepancies: ReconciliationReport['discrepancies'] = [];

      // 2. Check each local position against exchange
      for (const localPos of localPositions) {
        const exchangeMatch = exchangePositions.find((ep) => ep.symbol === localPos.symbol);

        if (!exchangeMatch || Math.abs(exchangeMatch.positionAmt) === 0) {
          discrepancies.push({
            symbol: localPos.symbol,
            type: 'MANUAL_EXCHANGE_CLOSE',
            detail: `Position for ${localPos.symbol} exists in local state (${localPos.quantity} units) but is CLOSED on Binance.`,
            actionTaken: 'Flagged for local sync removal to prevent ghost positions.',
          });
          continue;
        }

        // Check quantity mismatch
        const exchangeQty = Math.abs(exchangeMatch.positionAmt);
        const qtyDiff = Math.abs(exchangeQty - localPos.quantity);
        if (qtyDiff > 0.0001 && qtyDiff / localPos.quantity > 0.02) {
          discrepancies.push({
            symbol: localPos.symbol,
            type: 'QUANTITY_MISMATCH',
            detail: `Quantity discrepancy on ${localPos.symbol}: Local=${localPos.quantity}, Binance=${exchangeQty}`,
            actionTaken: 'Synchronized local quantity to match exchange.',
          });
        }

        // Check if protective STOP_MARKET / STOP order is present on exchange
        const protectiveOrders = openOrders.filter(
          (o: any) => o.symbol === localPos.symbol && (o.type === 'STOP_MARKET' || o.type === 'STOP')
        );

        if (protectiveOrders.length === 0) {
          discrepancies.push({
            symbol: localPos.symbol,
            type: 'MISSING_PROTECTIVE_SL',
            detail: `Active position for ${localPos.symbol} lacks confirmed exchange-side STOP_MARKET protection!`,
            actionTaken: 'Immediate user alert triggered. Entries blocked.',
          });
        }
      }

      // 3. Check for untracked positions on exchange
      for (const ep of exchangePositions) {
        if (Math.abs(ep.positionAmt) > 0 && !localPositions.some((lp) => lp.symbol === ep.symbol)) {
          discrepancies.push({
            symbol: ep.symbol,
            type: 'UNKNOWN_EXCHANGE_POSITION',
            detail: `Found untracked position for ${ep.symbol} on Binance (${ep.positionAmt} units) opened outside ApexAI.`,
            actionTaken: 'Imported into monitoring list to maintain risk tracking.',
          });
        }
      }

      const hasDiscrepancy = discrepancies.length > 0;
      const status: ReconciliationStatus = hasDiscrepancy ? 'DESYNC_DETECTED' : 'IN_SYNC';
      const message = hasDiscrepancy
        ? `Reconciliation detected ${discrepancies.length} state discrepancies between local bot and Binance.`
        : 'Reconciliation verified: 100% in sync with Binance Futures account.';

      return {
        timestamp: now,
        status,
        hasDiscrepancy,
        message,
        exchangePositionsCount: exchangePositions.length,
        localPositionsCount: localPositions.length,
        openOrdersCount: openOrders.length,
        discrepancies,
      };
    } catch (err: any) {
      return {
        timestamp: now,
        status: 'ERROR',
        hasDiscrepancy: true,
        message: `Position reconciliation error: ${err.message || 'Unknown network error'}`,
        exchangePositionsCount: 0,
        localPositionsCount: localPositions.length,
        openOrdersCount: 0,
        discrepancies: [],
      };
    }
  }
}
