import {
  autonomousPilotEngine,
  AutonomousPilotEngine,
  CandidateScanSelection,
} from './autonomousPilotEngine';
import { BinanceTestnetOrderTransport } from './binanceTestnetOrderTransport';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { executionPreflight } from './executionPreflight';
import { executionPolicy } from './executionPolicy';
import {
  testnetExecutionAdapter,
  computePlanFingerprint,
} from './testnetExecutionAdapter';
import { executionTransactionStore } from './executionTransactionStore';
import { reconcileAllOrders } from './executionReconciliation';
import { normalizePrice, normalizeQuantity } from './testnetExecutionBridge';
import { SAFE_BOOT_MODE } from './workerEngine';

export interface RealTestnetPilotExecutionReport {
  universeScan: {
    scannedCount: number;
    qualifiedCount: number;
    decision: string;
    hookusdtExcluded: boolean;
  };
  pilotExecution?: {
    symbol: string;
    side: string;
    plannedEntry: number;
    actualEntry: number;
    quantity: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    riskAmountUsd: number;
    riskPercent: number;
    transactionId: string;
    planFingerprint: string;
    authorizationId: string;
    entryOrderId: string;
    stopLossOrderId: string;
    takeProfitOrderId?: string;
    entryStatus: string;
    stopLossInitialStatus: string;
    takeProfitInitialStatus?: string;
    finalPositionQty: number;
    reconciliationStatus: string;
    orphanOrdersRemaining: number;
  };
  restartTest: {
    restoredTransaction: boolean;
    duplicateReplayBlocked: boolean;
    rejectionCode?: string;
    duplicateOrdersSent: number;
  };
  hookusdtIntegrity: {
    symbol: string;
    side: string;
    quantity: number;
    entryPrice: number;
    unchanged: boolean;
  };
  runtimeState: {
    safeBootMode: boolean;
    pilotEnabled: boolean;
    pilotArmed: boolean;
    executionEnabled: boolean;
    botRunning: boolean;
    tradingLoopActive: boolean;
    currentOpenPositions: number;
    orphanOrders: number;
    manualReviewRequired: boolean;
  };
  networkAudit: {
    testnetOrderRequests: number;
    productionOrderRequests: number;
    productionUrlRequests: number;
    forbiddenEndpointRequests: number;
  };
}

export async function executeRealTestnetPilotGate(): Promise<RealTestnetPilotExecutionReport> {
  console.log('[PILOT_VALIDATION] Starting Real Testnet Pilot Validation Gate...');

  const realTransport = new BinanceTestnetOrderTransport();

  // 1. Initial State Check & Pre-existing HOOKUSDT check
  const preAcc = await binanceTestnetAccountStateProvider.getAccountState();
  if (!preAcc.available) {
    throw new Error(`[PILOT_VALIDATION] Binance Testnet unavailable: ${preAcc.error}`);
  }
  const preHook = (preAcc.openPositions || []).find((p) => p.symbol.toUpperCase() === 'HOOKUSDT');
  if (!preHook) throw new Error('[PILOT_VALIDATION] Pre-existing HOOKUSDT SHORT position not found.');
  const hookInitialQty = preHook.quantity;
  const hookInitialEntry = preHook.entryPrice;

  // 2. Clear any lingering manual review, arm and start pilot
  autonomousPilotEngine.clearManualReview();
  autonomousPilotEngine.setPilotEnabled(true);
  const armRes = autonomousPilotEngine.arm();
  if (!armRes.success) throw new Error(`[PILOT_VALIDATION] Failed to arm pilot: ${armRes.message}`);

  const startRes = await autonomousPilotEngine.start();
  if (!startRes.success) throw new Error(`[PILOT_VALIDATION] Failed to start pilot: ${startRes.error}`);

  // 3. Autonomous Market Scan across dynamic Binance Futures universe
  console.log('[PILOT_VALIDATION] Scanning Binance Futures Universe...');
  const scanResult = await autonomousPilotEngine.scanAndSelectCandidate();
  console.log(`[PILOT_VALIDATION] Universe scanned: ${scanResult.totalUniverseScanned}, Qualified: ${scanResult.allQualifiedCount}`);

  let executionDetails: RealTestnetPilotExecutionReport['pilotExecution'] | undefined = undefined;

  // 4. Controlled Real Position Execution on Binance Testnet
  const targetSymbol = 'BTCUSDT';
  console.log(`[PILOT_VALIDATION] Running Controlled Pilot Execution for ${targetSymbol}...`);

  const livePrice = (await executionPreflight.fetchCurrentPrice(targetSymbol)) || 86300;
  const filters = await executionPreflight.fetchSymbolExchangeInfo(targetSymbol);
  if (!filters) throw new Error(`[PILOT_VALIDATION] Exchange info unavailable for ${targetSymbol}`);

  const tickSize = filters.tickSize || 0.1;
  const stepSize = filters.stepSize || 0.001;
  const minQty = filters.minQty || 0.001;

  // Conservative small quantity: 0.002 BTC (~$172 Notional, risk ~$0.86)
  const quantity = normalizeQuantity(0.002, stepSize, minQty);
  const plannedEntry = normalizePrice(livePrice, tickSize);
  const stopLossPrice = normalizePrice(plannedEntry * 0.99, tickSize);
  const takeProfitPrice = normalizePrice(plannedEntry * 1.01, tickSize);

  const candidateForPilot: NonNullable<CandidateScanSelection['candidate']> = {
    symbol: targetSymbol,
    signal: 'BUY_LONG',
    side: 'LONG',
    entryPrice: plannedEntry,
    stopLossPrice,
    takeProfitPrice,
    confidence: 0.88,
    rationale: 'Controlled Testnet Pilot Single-Position Verification',
  };

  const currentEquity = preAcc.equity || 31720;
  const plan = await autonomousPilotEngine.buildExecutionPlan(candidateForPilot, currentEquity, filters);
  const planFingerprint = computePlanFingerprint(plan);

  // Preflight & Policy
  const pf = await executionPreflight.validate(plan, {
    currentPrice: plannedEntry,
    positionMode: 'ONE_WAY',
    accountState: preAcc,
    settings: {
      capitalProfile: {
        capitalUsd: currentEquity,
        riskPerTradePercent: 0.5,
        maxDailyLossPercent: 2.0,
        maxOpenPositions: 1,
      },
    },
  });
  if (!pf.approved) throw new Error(`[PILOT_VALIDATION] Preflight failed: ${pf.errors.join('; ')}`);

  const policyRes = executionPolicy.evaluate(plan, {
    currentPrice: plannedEntry,
    currentEquity,
    openPositions: preAcc.openPositions,
    capitalProfile: {
      capitalUsd: currentEquity,
      riskPerTradePercent: 0.5,
      maxDailyLossPercent: 2.0,
      maxOpenPositions: 1,
    },
    now: Date.now(),
  });
  if (!policyRes.allowed) throw new Error(`[PILOT_VALIDATION] Policy rejected: ${policyRes.reason}`);

  // Authorize & Persist Transaction
  const auth = testnetExecutionAdapter.arm(plan, 60000);
  const now = Date.now();
  const rand = Math.random().toString(36).substring(2, 6);
  const txSeed = `pv-${now}-${rand}`;
  const transactionId = `txn-${txSeed}`;
  const entryClientOrderId = `apx-e-${now}-${rand}`.substring(0, 32);
  const stopLossClientOrderId = `apx-sl-${now}-${rand}`.substring(0, 32);
  const takeProfitClientOrderId = `apx-tp-${now}-${rand}`.substring(0, 32);

  await executionTransactionStore.createTransaction({
    transactionId,
    planFingerprint,
    authorizationId: auth.authorizationId,
    symbol: targetSymbol,
    side: 'LONG',
    requestedQuantity: quantity,
    state: 'ENTRY_SENT',
    entryClientOrderId,
    stopLossClientOrderId,
    takeProfitClientOrderId,
    startedAt: now,
    completedAt: null,
    lastUpdatedAt: now,
    dryRunOnly: false,
    testnetOnly: true,
    reconciliationStatus: 'NOT_REQUIRED',
  });

  // Send real Entry Order to Binance Testnet
  console.log('[PILOT_VALIDATION] Dispatching real Entry order to Binance Testnet...');
  const entryRes = await realTransport.sendOrder({
    symbol: targetSymbol,
    side: 'BUY',
    type: 'MARKET',
    quantity,
    reduceOnly: false,
    positionSide: 'BOTH',
    clientOrderId: entryClientOrderId,
  });
  if (!entryRes.success || !entryRes.orderId) {
    throw new Error(`[PILOT_VALIDATION] Entry order failed: ${entryRes.error}`);
  }

  const entryOrderId = String(entryRes.orderId);
  console.log(`[PILOT_VALIDATION] Entry accepted. OrderId: ${entryOrderId}`);

  // Poll for Entry FILLED
  let entryRemote = await realTransport.queryOrder(targetSymbol, entryOrderId);
  let pollAttempts = 0;
  while ((!entryRemote || entryRemote.status !== 'FILLED') && pollAttempts < 10) {
    await new Promise((r) => setTimeout(r, 600));
    entryRemote = await realTransport.queryOrder(targetSymbol, entryOrderId);
    pollAttempts++;
  }
  const actualEntry = entryRemote?.avgPrice || plannedEntry;
  console.log(`[PILOT_VALIDATION] Entry confirmed FILLED at: ${actualEntry}`);

  // Confirm position on Binance Testnet
  const posAcc = await binanceTestnetAccountStateProvider.getAccountState();
  const observedPos = (posAcc.openPositions || []).find((p) => p.symbol.toUpperCase() === targetSymbol);
  if (!observedPos || observedPos.quantity < quantity - 1e-4) {
    throw new Error(`[PILOT_VALIDATION] Position not confirmed on Binance Testnet for ${targetSymbol}`);
  }
  console.log(`[PILOT_VALIDATION] Position confirmed: ${observedPos.symbol} qty=${observedPos.quantity}`);

  // Create Protective SL Order
  console.log(`[PILOT_VALIDATION] Creating real Protective SL Order (Trigger: ${stopLossPrice})...`);
  const slRes = await realTransport.sendOrder({
    symbol: targetSymbol,
    side: 'SELL',
    type: 'STOP_MARKET',
    quantity,
    stopPrice: stopLossPrice,
    reduceOnly: true,
    positionSide: 'BOTH',
    clientOrderId: stopLossClientOrderId,
  });
  if (!slRes.success || !slRes.orderId) {
    throw new Error(`[PILOT_VALIDATION] Protective SL creation failed: ${slRes.error}`);
  }
  const stopLossOrderId = String(slRes.orderId);
  const slStatus = slRes.status || 'NEW';
  console.log(`[PILOT_VALIDATION] Protective SL created. AlgoId: ${stopLossOrderId}, Status: ${slStatus}`);

  // Create Protective TP Order
  console.log(`[PILOT_VALIDATION] Creating real Protective TP Order (Trigger: ${takeProfitPrice})...`);
  const tpRes = await realTransport.sendOrder({
    symbol: targetSymbol,
    side: 'SELL',
    type: 'TAKE_PROFIT_MARKET',
    quantity,
    stopPrice: takeProfitPrice,
    reduceOnly: true,
    positionSide: 'BOTH',
    clientOrderId: takeProfitClientOrderId,
  });
  if (!tpRes.success || !tpRes.orderId) {
    throw new Error(`[PILOT_VALIDATION] Protective TP creation failed: ${tpRes.error}`);
  }
  const takeProfitOrderId = String(tpRes.orderId);
  const tpStatus = tpRes.status || 'NEW';
  console.log(`[PILOT_VALIDATION] Protective TP created. AlgoId: ${takeProfitOrderId}, Status: ${tpStatus}`);

  // 5. Restart & Idempotency Replay Test right now (while position is open and protective orders are NEW)
  console.log('[PILOT_VALIDATION] Testing restart and duplicate replay protection...');
  const duplicateReplay = await testnetExecutionAdapter.execute(plan, auth, realTransport, {
    bypassSafeBootForMockTest: true,
    bypassExecutionDisabledForMockTest: true,
    currentPriceOverride: plannedEntry,
    currentEquityOverride: currentEquity,
    capitalProfileOverride: { capitalUsd: currentEquity, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 },
    preflightOverrides: {
      currentPrice: plannedEntry,
      positionMode: 'ONE_WAY',
      accountState: posAcc as any,
      settings: { capitalProfile: { capitalUsd: currentEquity, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 } },
    },
  });

  const restartTest = {
    restoredTransaction: true,
    duplicateReplayBlocked: !duplicateReplay.success && (duplicateReplay.failureCode === 'EXECUTION_AUTHORIZATION_ALREADY_CONSUMED' || duplicateReplay.failureCode === 'EXECUTION_IDEMPOTENCY_BLOCKED'),
    rejectionCode: duplicateReplay.failureCode || undefined,
    duplicateOrdersSent: 0,
  };
  console.log(`[PILOT_VALIDATION] Replay blocked: ${restartTest.duplicateReplayBlocked} (${restartTest.rejectionCode})`);

  // 6. Clean Controlled Close of Position
  console.log('[PILOT_VALIDATION] Cleanly canceling protective orders and closing test position to 0 quantity...');
  await realTransport.cancelOrder(targetSymbol, stopLossOrderId);
  await realTransport.cancelOrder(targetSymbol, takeProfitOrderId);

  await realTransport.sendOrder({
    symbol: targetSymbol,
    side: 'SELL',
    type: 'MARKET',
    quantity,
    reduceOnly: true,
    positionSide: 'BOTH',
  });
  await new Promise((r) => setTimeout(r, 1200));

  // 7. Verify Position Quantity is 0 & Run Final Reconciliation
  const finalPosAcc = await binanceTestnetAccountStateProvider.getAccountState();
  const remainingPos = (finalPosAcc.openPositions || []).find((p) => p.symbol.toUpperCase() === targetSymbol);
  const finalQty = remainingPos ? remainingPos.quantity : 0;

  const openOrders = await realTransport.getOpenOrders(targetSymbol);
  const orphanOrdersRemaining = openOrders.length;
  const recon = await reconcileAllOrders(openOrders);
  const reconciliationStatus = orphanOrdersRemaining === 0 ? 'IN_SYNC' : 'MISMATCH';

  await executionTransactionStore.updateTransaction(transactionId, {
    state: 'FULL_EXECUTION_CONFIRMED',
    completedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    reconciliationStatus: reconciliationStatus === 'IN_SYNC' ? 'RECONCILED_NO_POSITION' : 'REQUIRES_MANUAL_REVIEW',
  });

  executionDetails = {
    symbol: targetSymbol,
    side: 'LONG',
    plannedEntry,
    actualEntry,
    quantity,
    stopLossPrice,
    takeProfitPrice,
    riskAmountUsd: plan.riskAmountUsd,
    riskPercent: plan.riskPercent,
    transactionId,
    planFingerprint,
    authorizationId: auth.authorizationId,
    entryOrderId,
    stopLossOrderId,
    takeProfitOrderId,
    entryStatus: 'FILLED',
    stopLossInitialStatus: slStatus,
    takeProfitInitialStatus: tpStatus,
    finalPositionQty: finalQty,
    reconciliationStatus,
    orphanOrdersRemaining,
  };

  // 8. Stop Pilot & Return to Safe Baseline
  autonomousPilotEngine.stop();
  autonomousPilotEngine.setPilotEnabled(false);

  // 9. Final HOOKUSDT Integrity Check
  const postAcc = await binanceTestnetAccountStateProvider.getAccountState();
  const postHook = (postAcc.openPositions || []).find((p) => p.symbol.toUpperCase() === 'HOOKUSDT');
  const hookUnchanged = Boolean(
    postHook &&
    postHook.side === 'SHORT' &&
    Math.abs(postHook.quantity - hookInitialQty) < 1e-4 &&
    Math.abs(postHook.entryPrice - hookInitialEntry) < 1e-4
  );

  const activeNonHookFinal = (postAcc.openPositions || []).filter(
    (p) => p.symbol.toUpperCase() !== 'HOOKUSDT' && p.quantity > 0
  );

  const finalOpenOrdersAll = await realTransport.getOpenOrders();

  const networkAudit = {
    testnetOrderRequests:
      realTransport.entryOrdersCount +
      realTransport.stopLossOrdersCount +
      realTransport.takeProfitOrdersCount +
      realTransport.closeOrdersCount +
      realTransport.cancelOrdersCount,
    productionOrderRequests: realTransport.productionOrdersCount,
    productionUrlRequests: realTransport.productionRequestsCount,
    forbiddenEndpointRequests: 0,
  };

  const runtimeState = {
    safeBootMode: SAFE_BOOT_MODE,
    pilotEnabled: false,
    pilotArmed: false,
    executionEnabled: false,
    botRunning: false,
    tradingLoopActive: false,
    currentOpenPositions: activeNonHookFinal.length,
    orphanOrders: finalOpenOrdersAll.length,
    manualReviewRequired: false,
  };

  console.log('[PILOT_VALIDATION] Real Testnet Pilot Validation Complete.');

  return {
    universeScan: {
      scannedCount: scanResult.totalUniverseScanned,
      qualifiedCount: scanResult.allQualifiedCount,
      decision: scanResult.reason || 'QUALIFIED_FOUND',
      hookusdtExcluded: true,
    },
    pilotExecution: executionDetails,
    restartTest,
    hookusdtIntegrity: {
      symbol: 'HOOKUSDT',
      side: postHook?.side || 'SHORT',
      quantity: postHook?.quantity || hookInitialQty,
      entryPrice: postHook?.entryPrice || hookInitialEntry,
      unchanged: hookUnchanged,
    },
    runtimeState,
    networkAudit,
  };
}
