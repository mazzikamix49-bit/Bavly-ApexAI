import { TradeDirection } from '../types/trading';
import { PersistedExecutionTransaction } from './executionTransactionStore';

/**
 * Remote Binance Order Representation (Read-Only)
 * Mapped strictly from GET /fapi/v1/order query response.
 */
export interface RemoteBinanceOrderDescriptor {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  positionSide: 'BOTH' | 'LONG' | 'SHORT';
  type: string;
  status: string; // e.g. 'NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'
  origQty: number;
  executedQty: number;
  avgPrice: number;
  reduceOnly: boolean;
  stopPrice: number;
  updateTime: number;
}

/**
 * Order Reconciliation Classifications
 */
export type OrderReconciliationClassification =
  | 'ORDER_CONFIRMED'
  | 'ORDER_PENDING'
  | 'ORDER_FILLED'
  | 'ORDER_PARTIALLY_FILLED'
  | 'ORDER_CANCELED'
  | 'ORDER_REJECTED'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_MISMATCH'
  | 'INSUFFICIENT_INFORMATION'
  | 'REQUIRES_MANUAL_REVIEW';

export interface OrderReconciliationResult {
  orderId?: string | null;
  clientOrderId?: string | null;
  symbol: string;
  classification: OrderReconciliationClassification;
  remoteStatus?: string | null;
  origQty?: number;
  executedQty?: number;
  avgPrice?: number;
  reduceOnly?: boolean;
  notes: string;
  requiresManualReview: boolean;
  readOnly: true;
  testnetOnly: true;
  reconciledAt: number;
}

/**
 * OrderStateReconciliationEngine — 100% READ-ONLY
 *
 * Provides typed evaluation and classification of remote Binance order states
 * against local execution transaction records.
 *
 * STRICT SAFETY INVARIANTS:
 * - 100% READ-ONLY: Never sends POST/PUT/DELETE orders to Binance.
 * - Zero automatic retries: If order state is indeterminate, marks REQUIRES_MANUAL_REVIEW.
 * - Never assumes order success solely because an HTTP response returned 200.
 */
export class OrderStateReconciliationEngine {
  /**
   * Reconciles a planned or submitted order against observed remote order state.
   */
  public reconcileOrderState(
    expected: {
      symbol: string;
      side: 'BUY' | 'SELL';
      quantity: number;
      expectedOrderId?: string | null;
      expectedClientOrderId?: string | null;
      isReduceOnly?: boolean;
    },
    remoteOrder: RemoteBinanceOrderDescriptor | null,
    transportError?: string | null
  ): OrderReconciliationResult {
    const now = Date.now();
    const baseResult = {
      orderId: remoteOrder?.orderId || expected.expectedOrderId || null,
      clientOrderId: remoteOrder?.clientOrderId || expected.expectedClientOrderId || null,
      symbol: expected.symbol,
      readOnly: true as const,
      testnetOnly: true as const,
      reconciledAt: now,
    };

    // 1. Check for transport or query errors
    if (transportError) {
      return {
        ...baseResult,
        classification: 'INSUFFICIENT_INFORMATION',
        notes: `Failed to inspect remote order state due to transport error: ${transportError}. Requires manual review.`,
        requiresManualReview: true,
      };
    }

    // 2. Remote order not found
    if (!remoteOrder) {
      return {
        ...baseResult,
        classification: 'ORDER_NOT_FOUND',
        notes: `Order ${expected.expectedOrderId || expected.expectedClientOrderId || 'unknown'} not found on remote exchange.`,
        requiresManualReview: true,
      };
    }

    // 3. Check for parameter mismatches
    const symbolMatches = remoteOrder.symbol.toUpperCase() === expected.symbol.toUpperCase();
    const sideMatches = remoteOrder.side === expected.side;
    const qtyDiff = Math.abs(remoteOrder.origQty - expected.quantity);
    const qtyMatches = qtyDiff < 1e-6 || qtyDiff / expected.quantity < 0.001;

    if (!symbolMatches || !sideMatches || !qtyMatches) {
      return {
        ...baseResult,
        classification: 'ORDER_MISMATCH',
        remoteStatus: remoteOrder.status,
        origQty: remoteOrder.origQty,
        executedQty: remoteOrder.executedQty,
        avgPrice: remoteOrder.avgPrice,
        reduceOnly: remoteOrder.reduceOnly,
        notes: `Remote order details mismatch expected plan: symbolMatch=${symbolMatches}, sideMatch=${sideMatches}, qtyMatch=${qtyMatches}.`,
        requiresManualReview: true,
      };
    }

    // 4. Classify according to actual exchange status
    const status = remoteOrder.status.toUpperCase();
    switch (status) {
      case 'FILLED':
        return {
          ...baseResult,
          classification: 'ORDER_FILLED',
          remoteStatus: status,
          origQty: remoteOrder.origQty,
          executedQty: remoteOrder.executedQty,
          avgPrice: remoteOrder.avgPrice,
          reduceOnly: remoteOrder.reduceOnly,
          notes: `Order successfully filled on exchange at average price ${remoteOrder.avgPrice}.`,
          requiresManualReview: false,
        };

      case 'PARTIALLY_FILLED':
        return {
          ...baseResult,
          classification: 'ORDER_PARTIALLY_FILLED',
          remoteStatus: status,
          origQty: remoteOrder.origQty,
          executedQty: remoteOrder.executedQty,
          avgPrice: remoteOrder.avgPrice,
          reduceOnly: remoteOrder.reduceOnly,
          notes: `Order partially filled (${remoteOrder.executedQty}/${remoteOrder.origQty}).`,
          requiresManualReview: true,
        };

      case 'NEW':
        return {
          ...baseResult,
          classification: 'ORDER_PENDING',
          remoteStatus: status,
          origQty: remoteOrder.origQty,
          executedQty: remoteOrder.executedQty,
          avgPrice: remoteOrder.avgPrice,
          reduceOnly: remoteOrder.reduceOnly,
          notes: 'Order confirmed accepted by exchange, resting in orderbook or awaiting trigger.',
          requiresManualReview: false,
        };

      case 'CANCELED':
      case 'EXPIRED':
        return {
          ...baseResult,
          classification: 'ORDER_CANCELED',
          remoteStatus: status,
          origQty: remoteOrder.origQty,
          executedQty: remoteOrder.executedQty,
          avgPrice: remoteOrder.avgPrice,
          reduceOnly: remoteOrder.reduceOnly,
          notes: `Order canceled or expired on exchange (${status}).`,
          requiresManualReview: remoteOrder.executedQty > 0, // Manual review if partial fill occurred before cancellation
        };

      case 'REJECTED':
        return {
          ...baseResult,
          classification: 'ORDER_REJECTED',
          remoteStatus: status,
          origQty: remoteOrder.origQty,
          executedQty: remoteOrder.executedQty,
          avgPrice: remoteOrder.avgPrice,
          reduceOnly: remoteOrder.reduceOnly,
          notes: 'Order rejected by exchange.',
          requiresManualReview: true,
        };

      default:
        return {
          ...baseResult,
          classification: 'REQUIRES_MANUAL_REVIEW',
          remoteStatus: status,
          origQty: remoteOrder.origQty,
          executedQty: remoteOrder.executedQty,
          avgPrice: remoteOrder.avgPrice,
          reduceOnly: remoteOrder.reduceOnly,
          notes: `Unrecognized exchange status (${status}). Requires manual review.`,
          requiresManualReview: true,
        };
    }
  }

  /**
   * Evaluates a full PersistedExecutionTransaction against remote order lookups.
   */
  public evaluateTransactionOrders(
    tx: PersistedExecutionTransaction,
    remoteEntryOrder: RemoteBinanceOrderDescriptor | null,
    remoteStopLossOrder: RemoteBinanceOrderDescriptor | null,
    remoteTakeProfitOrder: RemoteBinanceOrderDescriptor | null
  ): {
    entryStatus: OrderReconciliationResult;
    stopStatus?: OrderReconciliationResult | null;
    tpStatus?: OrderReconciliationResult | null;
    overallReconciliationStatus: 'IN_SYNC' | 'REQUIRES_MANUAL_REVIEW';
  } {
    const entryExpectedSide = tx.side === 'LONG' ? 'BUY' : 'SELL';
    const entryStatus = this.reconcileOrderState(
      {
        symbol: tx.symbol,
        side: entryExpectedSide,
        quantity: tx.requestedQuantity,
        expectedOrderId: tx.entryOrderId,
        expectedClientOrderId: tx.entryClientOrderId,
        isReduceOnly: false,
      },
      remoteEntryOrder
    );

    let stopStatus: OrderReconciliationResult | null = null;
    if (tx.stopLossOrderId || tx.stopLossClientOrderId) {
      const stopExpectedSide = tx.side === 'LONG' ? 'SELL' : 'BUY';
      stopStatus = this.reconcileOrderState(
        {
          symbol: tx.symbol,
          side: stopExpectedSide,
          quantity: tx.requestedQuantity,
          expectedOrderId: tx.stopLossOrderId,
          expectedClientOrderId: tx.stopLossClientOrderId,
          isReduceOnly: true,
        },
        remoteStopLossOrder
      );
    }

    let tpStatus: OrderReconciliationResult | null = null;
    if (tx.takeProfitOrderId || tx.takeProfitClientOrderId) {
      const tpExpectedSide = tx.side === 'LONG' ? 'SELL' : 'BUY';
      tpStatus = this.reconcileOrderState(
        {
          symbol: tx.symbol,
          side: tpExpectedSide,
          quantity: tx.requestedQuantity,
          expectedOrderId: tx.takeProfitOrderId,
          expectedClientOrderId: tx.takeProfitClientOrderId,
          isReduceOnly: true,
        },
        remoteTakeProfitOrder
      );
    }

    const needsReview =
      entryStatus.requiresManualReview ||
      Boolean(stopStatus?.requiresManualReview) ||
      Boolean(tpStatus?.requiresManualReview);

    return {
      entryStatus,
      stopStatus,
      tpStatus,
      overallReconciliationStatus: needsReview ? 'REQUIRES_MANUAL_REVIEW' : 'IN_SYNC',
    };
  }
}

export const orderStateReconciliationEngine = new OrderStateReconciliationEngine();
