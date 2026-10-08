import { TradeDirection } from '../types/trading';
import { AccountState, AccountStateProvider } from './accountStateProvider';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import {
  PersistedExecutionTransaction,
  TransactionReconciliationStatus,
  executionTransactionStore,
  ExecutionTransactionStore,
} from './executionTransactionStore';

/**
 * ExecutionReconciliationItem
 * Detailed read-only reconciliation status for a single transaction.
 */
export interface ExecutionReconciliationItem {
  transactionId: string;
  symbol: string;
  side: TradeDirection;
  previousState: string;
  reconciliationStatus: TransactionReconciliationStatus;
  knownOrderIds: {
    entryOrderId?: string | null;
    stopLossOrderId?: string | null;
    takeProfitOrderId?: string | null;
  };
  requestedQuantity: number;
  executedQuantity?: number | null;
  observedPosition?: {
    symbol: string;
    side: TradeDirection;
    quantity: number;
    entryPrice: number;
  } | null;
  reason: string;
  testnetOnly: true;
  readOnly: true;
  reconciledAt: number;
}

/**
 * ExecutionReconciliationReport
 * Comprehensive read-only audit report returned by the reconciliation engine.
 */
export interface ExecutionReconciliationReport {
  timestamp: number;
  readOnly: true;
  testnetOnly: true;
  totalTransactionsChecked: number;
  requiringManualReviewCount: number;
  reconciledNoPositionCount: number;
  reconciledPositionPresentCount: number;
  insufficientInfoCount: number;
  items: ExecutionReconciliationItem[];
}

/**
 * ExecutionReconciliationEngine — 100% READ-ONLY
 *
 * Compares persisted execution transactions with remote Binance Futures Testnet
 * positions and account state after worker restart.
 *
 * STRICT SAFETY INVARIANTS:
 * - 100% READ-ONLY: Never places, cancels, modifies, or closes any orders.
 * - NEVER calls /fapi/v1/order, /batchOrders, or /algoOrder.
 * - NEVER automatically sends a recovery order.
 * - Hard-guarded to Binance Futures Testnet ONLY.
 */
export class ExecutionReconciliationEngine {
  private readonly store: ExecutionTransactionStore;
  private readonly accountProvider: AccountStateProvider;

  constructor(
    store: ExecutionTransactionStore = executionTransactionStore,
    accountProvider: AccountStateProvider = binanceTestnetAccountStateProvider
  ) {
    this.store = store;
    this.accountProvider = accountProvider;
  }

  /**
   * Reconciles all persisted transactions against the current Testnet account state.
   * Can accept accountStateOverride for deterministic, isolated mock testing.
   */
  public async reconcile(accountStateOverride?: AccountState): Promise<ExecutionReconciliationReport> {
    const now = Date.now();
    const transactions = await this.store.loadAll();
    const accountState: AccountState = accountStateOverride || (await this.accountProvider.getAccountState());

    const items: ExecutionReconciliationItem[] = [];
    let requiringManualReviewCount = 0;
    let reconciledNoPositionCount = 0;
    let reconciledPositionPresentCount = 0;
    let insufficientInfoCount = 0;

    for (const tx of transactions) {
      const item = this.evaluateTransaction(tx, accountState, now);
      items.push(item);

      // Tally summary counts
      switch (item.reconciliationStatus) {
        case 'REQUIRES_MANUAL_REVIEW':
        case 'REQUIRES_RECONCILIATION':
          requiringManualReviewCount++;
          break;
        case 'RECONCILED_NO_POSITION':
          reconciledNoPositionCount++;
          break;
        case 'RECONCILED_POSITION_PRESENT':
          reconciledPositionPresentCount++;
          break;
        case 'INSUFFICIENT_INFORMATION':
          insufficientInfoCount++;
          break;
      }
    }

    return {
      timestamp: now,
      readOnly: true,
      testnetOnly: true,
      totalTransactionsChecked: transactions.length,
      requiringManualReviewCount,
      reconciledNoPositionCount,
      reconciledPositionPresentCount,
      insufficientInfoCount,
      items,
    };
  }

  /**
   * Evaluates a single transaction against the observed remote account state.
   */
  public evaluateTransaction(
    tx: PersistedExecutionTransaction,
    accountState: AccountState,
    now: number = Date.now()
  ): ExecutionReconciliationItem {
    const baseItem: ExecutionReconciliationItem = {
      transactionId: tx.transactionId,
      symbol: tx.symbol,
      side: tx.side,
      previousState: tx.state,
      reconciliationStatus: 'INSUFFICIENT_INFORMATION',
      knownOrderIds: {
        entryOrderId: tx.entryOrderId,
        stopLossOrderId: tx.stopLossOrderId,
        takeProfitOrderId: tx.takeProfitOrderId,
      },
      requestedQuantity: tx.requestedQuantity,
      executedQuantity: tx.executedQuantity,
      observedPosition: null,
      reason: '',
      testnetOnly: true,
      readOnly: true,
      reconciledAt: now,
    };

    // 1. Check if account state is available
    if (!accountState.available) {
      return {
        ...baseItem,
        reconciliationStatus: 'INSUFFICIENT_INFORMATION',
        reason: 'Remote Testnet account state is unavailable. Cannot verify position.',
      };
    }

    // 2. Find remote position for the same symbol
    const remotePos = (accountState.openPositions || []).find(
      (p) => p.symbol.toUpperCase() === tx.symbol.toUpperCase()
    );

    if (remotePos) {
      baseItem.observedPosition = {
        symbol: remotePos.symbol,
        side: remotePos.side,
        quantity: remotePos.quantity,
        entryPrice: remotePos.entryPrice,
      };
    }

    // 3. Case A: No remote position found on exchange
    if (!remotePos || remotePos.quantity <= 0) {
      if (tx.state === 'ENTRY_NOT_SENT' || (tx.state === 'EXECUTION_FAILED' && !tx.entryOrderId)) {
        return {
          ...baseItem,
          reconciliationStatus: 'RECONCILED_NO_POSITION',
          reason: 'Transaction was never submitted or failed before entry order was accepted. Confirmed no remote position.',
        };
      }

      // If entry was recorded as sent or confirmed, but no position exists on Testnet
      return {
        ...baseItem,
        reconciliationStatus: 'REQUIRES_MANUAL_REVIEW',
        reason: `Transaction recorded state as ${tx.state}, but no active position was found on Testnet. Position may have closed, liquidated, or entry failed remotely.`,
      };
    }

    // 4. Case B: Remote position found — compare parameters
    // Check Direction / Side mismatch
    if (remotePos.side !== tx.side) {
      return {
        ...baseItem,
        reconciliationStatus: 'REQUIRES_MANUAL_REVIEW',
        reason: `Side mismatch on Testnet: expected ${tx.side}, but observed active position is ${remotePos.side}. Manual review required.`,
      };
    }

    // Check Quantity mismatch
    const qtyDiff = Math.abs(remotePos.quantity - tx.requestedQuantity);
    if (qtyDiff > 1e-4) {
      return {
        ...baseItem,
        reconciliationStatus: 'REQUIRES_MANUAL_REVIEW',
        reason: `Quantity mismatch on Testnet: requested ${tx.requestedQuantity}, but observed active position quantity is ${remotePos.quantity}. Manual review required.`,
      };
    }

    // 5. Direction and quantity match remote position
    // If transaction had partial protective order execution, position is present but UNPROTECTED
    if (tx.state === 'EXECUTION_PARTIAL' || tx.reconciliationStatus === 'REQUIRES_MANUAL_REVIEW') {
      return {
        ...baseItem,
        reconciliationStatus: 'REQUIRES_MANUAL_REVIEW',
        reason: 'Remote position confirmed present with matching quantity, but protective orders (Stop-Loss or Take-Profit) are unconfirmed. Position may be unprotected.',
      };
    }

    if (tx.state === 'FULL_EXECUTION_CONFIRMED') {
      return {
        ...baseItem,
        reconciliationStatus: 'RECONCILED_POSITION_PRESENT',
        reason: 'Remote position confirmed present on Testnet and matches all planned parameters.',
      };
    }

    // Interrupted transition before full confirmation
    return {
      ...baseItem,
      reconciliationStatus: 'REQUIRES_MANUAL_REVIEW',
      reason: `Remote position is present, but transaction state is ${tx.state}. Process was interrupted prior to full execution confirmation.`,
    };
  }

  /**
   * Reconciles all transactions against remote orders and detects untracked orders.
   * 100% READ-ONLY.
   */
  public async reconcileAllOrders(
    remoteOrders: RemoteBinanceOrder[],
    transactionsOverride?: PersistedExecutionTransaction[]
  ): Promise<FullOrderReconciliationReport> {
    return reconcileAllOrders(remoteOrders, transactionsOverride);
  }
}

export const executionReconciliationEngine = new ExecutionReconciliationEngine();

/**
 * RemoteBinanceOrder
 *
 * Read-only representation of an order queried from Binance Futures Testnet.
 * Strictly GET-based abstraction; never writes or sends orders.
 */
export interface RemoteBinanceOrder {
  symbol: string;
  orderId: string | number;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  positionSide?: 'BOTH' | 'LONG' | 'SHORT';
  type: string;
  status: string; // 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED'
  origQty: number;
  executedQty: number;
  avgPrice: number;
  reduceOnly: boolean;
  stopPrice?: number;
  updateTime: number;
}

export type OrderReconciliationClassification =
  | 'ORDER_CONFIRMED'
  | 'ORDER_PENDING'
  | 'ORDER_TRIGGERED'
  | 'ORDER_FILLED'
  | 'ORDER_PARTIALLY_FILLED'
  | 'ORDER_CANCELED'
  | 'ORDER_REJECTED'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_MISMATCH'
  | 'ORDER_MISSING_ON_REMOTE'
  | 'REMOTE_ORDER_UNTRACKED'
  | 'INSUFFICIENT_INFORMATION'
  | 'REQUIRES_MANUAL_REVIEW';

export interface ExpectedOrderMatchCriteria {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly: boolean;
  clientOrderId?: string;
  orderId?: string | number;
}

export interface OrderReconciliationResult {
  classification: OrderReconciliationClassification;
  reason: string;
  isConfirmed: boolean;
  requiresManualReview: boolean;
  remoteOrder?: RemoteBinanceOrder | null;
  timestamp: number;
}

/**
 * Reconciles an expected order against a remote Binance order without placing or modifying orders.
 * 100% READ-ONLY abstraction.
 */
export function reconcileRemoteOrder(
  expected: ExpectedOrderMatchCriteria,
  remote: RemoteBinanceOrder | null | undefined
): OrderReconciliationResult {
  const now = Date.now();
  if (!remote) {
    return {
      classification: 'ORDER_NOT_FOUND',
      reason: `Remote order not found on Binance for expected ${expected.symbol} ${expected.side}.`,
      isConfirmed: false,
      requiresManualReview: true,
      remoteOrder: null,
      timestamp: now,
    };
  }

  // 1. Symbol check
  if (remote.symbol.toUpperCase() !== expected.symbol.toUpperCase()) {
    return {
      classification: 'ORDER_MISMATCH',
      reason: `Symbol mismatch: expected ${expected.symbol}, got ${remote.symbol}.`,
      isConfirmed: false,
      requiresManualReview: true,
      remoteOrder: remote,
      timestamp: now,
    };
  }

  // 2. Side check
  if (remote.side !== expected.side) {
    return {
      classification: 'ORDER_MISMATCH',
      reason: `Side mismatch: expected ${expected.side}, got ${remote.side}.`,
      isConfirmed: false,
      requiresManualReview: true,
      remoteOrder: remote,
      timestamp: now,
    };
  }

  // 3. reduceOnly check
  if (Boolean(remote.reduceOnly) !== Boolean(expected.reduceOnly)) {
    return {
      classification: 'ORDER_MISMATCH',
      reason: `reduceOnly mismatch: expected ${expected.reduceOnly}, got ${remote.reduceOnly}.`,
      isConfirmed: false,
      requiresManualReview: true,
      remoteOrder: remote,
      timestamp: now,
    };
  }

  // 4. Quantity check
  if (Math.abs(remote.origQty - expected.quantity) > 1e-4) {
    return {
      classification: 'ORDER_MISMATCH',
      reason: `Quantity mismatch: expected ${expected.quantity}, got ${remote.origQty}.`,
      isConfirmed: false,
      requiresManualReview: true,
      remoteOrder: remote,
      timestamp: now,
    };
  }

  // 5. Status Classification
  switch (remote.status) {
    case 'FILLED':
    case 'EXECUTED':
      return {
        classification: 'ORDER_FILLED',
        reason: `Remote order ${remote.orderId} is confirmed FILLED/EXECUTED at avgPrice ${remote.avgPrice}.`,
        isConfirmed: true,
        requiresManualReview: false,
        remoteOrder: remote,
        timestamp: now,
      };
    case 'TRIGGERED':
      return {
        classification: 'ORDER_TRIGGERED',
        reason: `Remote algo order ${remote.orderId} is confirmed TRIGGERED by exchange.`,
        isConfirmed: true,
        requiresManualReview: false,
        remoteOrder: remote,
        timestamp: now,
      };
    case 'NEW':
      return {
        classification: 'ORDER_CONFIRMED',
        reason: `Remote order ${remote.orderId} is confirmed active on book (status: NEW).`,
        isConfirmed: true,
        requiresManualReview: false,
        remoteOrder: remote,
        timestamp: now,
      };
    case 'PARTIALLY_FILLED':
      return {
        classification: 'ORDER_PARTIALLY_FILLED',
        reason: `Remote order ${remote.orderId} is PARTIALLY_FILLED (${remote.executedQty}/${remote.origQty}). Manual review required.`,
        isConfirmed: false,
        requiresManualReview: true,
        remoteOrder: remote,
        timestamp: now,
      };
    case 'CANCELED':
    case 'EXPIRED':
      return {
        classification: 'ORDER_CANCELED',
        reason: `Remote order ${remote.orderId} was canceled/expired (status: ${remote.status}).`,
        isConfirmed: false,
        requiresManualReview: true,
        remoteOrder: remote,
        timestamp: now,
      };
    case 'REJECTED':
      return {
        classification: 'ORDER_REJECTED',
        reason: `Remote order ${remote.orderId} was rejected by exchange.`,
        isConfirmed: false,
        requiresManualReview: true,
        remoteOrder: remote,
        timestamp: now,
      };
    default:
      return {
        classification: 'INSUFFICIENT_INFORMATION',
        reason: `Remote order ${remote.orderId} has unrecognized status: ${remote.status}.`,
        isConfirmed: false,
        requiresManualReview: true,
        remoteOrder: remote,
        timestamp: now,
      };
  }
}

export interface OrderMatchItem {
  role: 'ENTRY' | 'STOP_LOSS' | 'TAKE_PROFIT';
  orderId?: string | null;
  clientOrderId?: string | null;
  classification: OrderReconciliationClassification;
  reason: string;
  matchedRemoteOrder?: RemoteBinanceOrder | null;
}

export interface TransactionOrdersReconciliationReport {
  transactionId: string;
  symbol: string;
  side: TradeDirection;
  overallClassification: OrderReconciliationClassification;
  orders: OrderMatchItem[];
  timestamp: number;
  readOnly: true;
  testnetOnly: true;
}

export interface FullOrderReconciliationReport {
  timestamp: number;
  readOnly: true;
  testnetOnly: true;
  totalTransactionsChecked: number;
  totalRemoteOrdersChecked: number;
  transactions: TransactionOrdersReconciliationReport[];
  untrackedRemoteOrders: RemoteBinanceOrder[];
  summary: {
    confirmedOrdersCount: number;
    pendingOrdersCount: number;
    mismatchedOrdersCount: number;
    missingOnRemoteCount: number;
    untrackedRemoteCount: number;
  };
}

/**
 * Reconciles the orders of a single PersistedExecutionTransaction against observed remote orders.
 * 100% READ-ONLY matching logic.
 */
export function reconcileTransactionOrders(
  tx: PersistedExecutionTransaction,
  remoteOrders: RemoteBinanceOrder[],
  now: number = Date.now()
): TransactionOrdersReconciliationReport {
  const roles: Array<{
    role: 'ENTRY' | 'STOP_LOSS' | 'TAKE_PROFIT';
    orderId?: string | null;
    clientOrderId?: string | null;
    expectedSide: 'BUY' | 'SELL';
    reduceOnly: boolean;
  }> = [
    {
      role: 'ENTRY',
      orderId: tx.entryOrderId,
      clientOrderId: tx.entryClientOrderId,
      expectedSide: tx.side === 'LONG' ? 'BUY' : 'SELL',
      reduceOnly: false,
    },
    {
      role: 'STOP_LOSS',
      orderId: tx.stopLossOrderId,
      clientOrderId: tx.stopLossClientOrderId,
      expectedSide: tx.side === 'LONG' ? 'SELL' : 'BUY',
      reduceOnly: true,
    },
    {
      role: 'TAKE_PROFIT',
      orderId: tx.takeProfitOrderId,
      clientOrderId: tx.takeProfitClientOrderId,
      expectedSide: tx.side === 'LONG' ? 'SELL' : 'BUY',
      reduceOnly: true,
    },
  ];

  const orderItems: OrderMatchItem[] = [];

  for (const item of roles) {
    const hasRecordedOrder = Boolean(item.orderId || item.clientOrderId);
    if (!hasRecordedOrder) {
      continue;
    }

    // Attempt match by orderId or clientOrderId with symbol
    const matched = remoteOrders.find((ro) => {
      const symMatch = ro.symbol.toUpperCase() === tx.symbol.toUpperCase();
      if (!symMatch) return false;
      const idMatch = item.orderId && String(ro.orderId) === String(item.orderId);
      const clientIdMatch = item.clientOrderId && ro.clientOrderId === item.clientOrderId;
      return Boolean(idMatch || clientIdMatch);
    });

    if (!matched) {
      if (tx.state === 'ENTRY_NOT_SENT' || (tx.state === 'EXECUTION_FAILED' && !item.orderId)) {
        orderItems.push({
          role: item.role,
          orderId: item.orderId,
          clientOrderId: item.clientOrderId,
          classification: 'ORDER_NOT_FOUND',
          reason: `Order ${item.role} was not dispatched or failed locally before submission. Confirmed absent on remote.`,
          matchedRemoteOrder: null,
        });
      } else {
        orderItems.push({
          role: item.role,
          orderId: item.orderId,
          clientOrderId: item.clientOrderId,
          classification: 'ORDER_MISSING_ON_REMOTE',
          reason: `Transaction ${tx.transactionId} recorded ${item.role} (${item.orderId || item.clientOrderId}), but it was NOT found on remote Binance Testnet orders.`,
          matchedRemoteOrder: null,
        });
      }
      continue;
    }

    // Parameter checks
    const symMismatch = matched.symbol.toUpperCase() !== tx.symbol.toUpperCase();
    const sideMismatch = matched.side !== item.expectedSide;
    const qtyMismatch = Math.abs(matched.origQty - tx.requestedQuantity) > 1e-4;

    if (symMismatch || sideMismatch || qtyMismatch) {
      orderItems.push({
        role: item.role,
        orderId: item.orderId,
        clientOrderId: item.clientOrderId,
        classification: 'ORDER_MISMATCH',
        reason: `Discrepancy detected for ${item.role}: symMismatch=${symMismatch}, sideMismatch=${sideMismatch}, qtyMismatch=${qtyMismatch} (expected ${tx.requestedQuantity}, got ${matched.origQty}).`,
        matchedRemoteOrder: matched,
      });
      continue;
    }

    // Status classification
    if (matched.status === 'FILLED') {
      orderItems.push({
        role: item.role,
        orderId: item.orderId,
        clientOrderId: item.clientOrderId,
        classification: 'ORDER_CONFIRMED',
        reason: `Remote order ${matched.orderId} matches ${item.role} and is confirmed FILLED.`,
        matchedRemoteOrder: matched,
      });
    } else if (matched.status === 'NEW') {
      orderItems.push({
        role: item.role,
        orderId: item.orderId,
        clientOrderId: item.clientOrderId,
        classification: 'ORDER_PENDING',
        reason: `Remote order ${matched.orderId} matches ${item.role} and is active/pending on book (status: NEW).`,
        matchedRemoteOrder: matched,
      });
    } else if (matched.status === 'PARTIALLY_FILLED') {
      orderItems.push({
        role: item.role,
        orderId: item.orderId,
        clientOrderId: item.clientOrderId,
        classification: 'ORDER_PENDING',
        reason: `Remote order ${matched.orderId} matches ${item.role} and is partially filled (${matched.executedQty}/${matched.origQty}).`,
        matchedRemoteOrder: matched,
      });
    } else if (matched.status === 'CANCELED' || matched.status === 'EXPIRED') {
      orderItems.push({
        role: item.role,
        orderId: item.orderId,
        clientOrderId: item.clientOrderId,
        classification: 'ORDER_CANCELED',
        reason: `Remote order ${matched.orderId} was canceled or expired on exchange.`,
        matchedRemoteOrder: matched,
      });
    } else if (matched.status === 'REJECTED') {
      orderItems.push({
        role: item.role,
        orderId: item.orderId,
        clientOrderId: item.clientOrderId,
        classification: 'ORDER_REJECTED',
        reason: `Remote order ${matched.orderId} was rejected by exchange.`,
        matchedRemoteOrder: matched,
      });
    } else {
      orderItems.push({
        role: item.role,
        orderId: item.orderId,
        clientOrderId: item.clientOrderId,
        classification: 'INSUFFICIENT_INFORMATION',
        reason: `Remote order ${matched.orderId} has unrecognized status (${matched.status}).`,
        matchedRemoteOrder: matched,
      });
    }
  }

  // Determine overall classification
  let overallClassification: OrderReconciliationClassification = 'ORDER_CONFIRMED';
  if (orderItems.some((o) => o.classification === 'ORDER_MISMATCH')) {
    overallClassification = 'ORDER_MISMATCH';
  } else if (orderItems.some((o) => o.classification === 'ORDER_MISSING_ON_REMOTE')) {
    overallClassification = 'ORDER_MISSING_ON_REMOTE';
  } else if (orderItems.some((o) => o.classification === 'ORDER_PENDING')) {
    overallClassification = 'ORDER_PENDING';
  } else if (orderItems.some((o) => o.classification === 'ORDER_REJECTED' || o.classification === 'ORDER_CANCELED')) {
    overallClassification = 'REQUIRES_MANUAL_REVIEW';
  } else if (orderItems.length === 0) {
    overallClassification = 'ORDER_NOT_FOUND';
  }

  return {
    transactionId: tx.transactionId,
    symbol: tx.symbol,
    side: tx.side,
    overallClassification,
    orders: orderItems,
    timestamp: now,
    readOnly: true,
    testnetOnly: true,
  };
}

/**
 * Reconciles all transactions against remote orders and detects untracked orders.
 * 100% READ-ONLY.
 */
export async function reconcileAllOrders(
  remoteOrders: RemoteBinanceOrder[],
  transactions?: PersistedExecutionTransaction[]
): Promise<FullOrderReconciliationReport> {
  const now = Date.now();
  const txs = transactions || (await executionTransactionStore.loadAll());
  const reports: TransactionOrdersReconciliationReport[] = [];
  const matchedRemoteIds = new Set<string>();

  for (const tx of txs) {
    const rep = reconcileTransactionOrders(tx, remoteOrders, now);
    reports.push(rep);
    for (const ord of rep.orders) {
      if (ord.matchedRemoteOrder) {
        matchedRemoteIds.add(String(ord.matchedRemoteOrder.orderId));
        if (ord.matchedRemoteOrder.clientOrderId) {
          matchedRemoteIds.add(ord.matchedRemoteOrder.clientOrderId);
        }
      }
    }
  }

  const untrackedRemoteOrders = remoteOrders.filter(
    (ro) => !matchedRemoteIds.has(String(ro.orderId)) && (!ro.clientOrderId || !matchedRemoteIds.has(ro.clientOrderId))
  );

  let confirmedOrdersCount = 0;
  let pendingOrdersCount = 0;
  let mismatchedOrdersCount = 0;
  let missingOnRemoteCount = 0;

  for (const rep of reports) {
    for (const ord of rep.orders) {
      if (ord.classification === 'ORDER_CONFIRMED' || ord.classification === 'ORDER_FILLED') {
        confirmedOrdersCount++;
      } else if (ord.classification === 'ORDER_PENDING' || ord.classification === 'ORDER_PARTIALLY_FILLED') {
        pendingOrdersCount++;
      } else if (ord.classification === 'ORDER_MISMATCH') {
        mismatchedOrdersCount++;
      } else if (ord.classification === 'ORDER_MISSING_ON_REMOTE') {
        missingOnRemoteCount++;
      }
    }
  }

  return {
    timestamp: now,
    readOnly: true,
    testnetOnly: true,
    totalTransactionsChecked: txs.length,
    totalRemoteOrdersChecked: remoteOrders.length,
    transactions: reports,
    untrackedRemoteOrders,
    summary: {
      confirmedOrdersCount,
      pendingOrdersCount,
      mismatchedOrdersCount,
      missingOnRemoteCount,
      untrackedRemoteCount: untrackedRemoteOrders.length,
    },
  };
}
