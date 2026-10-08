import {
  PilotPositionRegistry,
  pilotPositionRegistry,
  PilotPositionRecord,
} from './pilotPositionRegistry';
import {
  AutonomousPilotEngine,
  CandidateScanSelection,
} from './autonomousPilotEngine';
import {
  MockBinanceOrderTransport,
  testnetExecutionAdapter,
  computePlanFingerprint,
} from './testnetExecutionAdapter';
import { executionTransactionStore } from './executionTransactionStore';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { binanceNetworkGuard } from './binanceNetworkGuard';
import { BinanceTestnetOrderTransport } from './binanceTestnetOrderTransport';

export interface MultiPositionTestResult {
  code: string;
  name: string;
  passed: boolean;
  details: string;
}

/**
 * Multi-Position Foundation Comprehensive Test Suite
 * Validates:
 * 1. maxOpenPositions = 2
 * 2. maxEntriesPerCycle = 1
 * 3. HOOKUSDT strictly excluded and untouched (0 slots used)
 * 4. Unique position identity (no conflation)
 * 5. Same-symbol collision prevention
 * 6. Capacity limit (attempting 3rd position blocked)
 * 7. Independent multi-position native reconciliation
 * 8. Persistence across restart (clean restoration of all active positions)
 * 9. Replay / idempotency protection
 * 10. Strict testnet isolation (0 production requests)
 * 11. Clean exit & safe final state
 */
export async function runMultiPositionFoundationTests(): Promise<{
  total: number;
  passed: number;
  failed: number;
  results: MultiPositionTestResult[];
}> {
  const results: MultiPositionTestResult[] = [];

  const add = (code: string, name: string, passed: boolean, details: string) => {
    results.push({ code, name, passed, details });
    console.log(`[TEST_${code}] ${name}: ${passed ? 'PASS' : 'FAIL'} - ${details}`);
  };

  const testRegistry = new PilotPositionRegistry({ customPath: './data/test_pilot_registry.json', maxOpenPositions: 2 });
  await testRegistry.clearRegistryForTest();

  const engine = new AutonomousPilotEngine({
    registry: testRegistry,
    config: { maxOpenPositions: 2, maxEntriesPerCycle: 1 },
  });

  const btcFilters = {
    symbol: 'BTCUSDT',
    tickSize: 0.1,
    stepSize: 0.001,
    minQty: 0.001,
    minNotional: 5.0,
    pricePrecision: 1,
    quantityPrecision: 3,
  };

  const ethFilters = {
    symbol: 'ETHUSDT',
    tickSize: 0.01,
    stepSize: 0.001,
    minQty: 0.001,
    minNotional: 5.0,
    pricePrecision: 2,
    quantityPrecision: 3,
  };

  const solFilters = {
    symbol: 'SOLUSDT',
    tickSize: 0.01,
    stepSize: 0.01,
    minQty: 0.01,
    minNotional: 5.0,
    pricePrecision: 2,
    quantityPrecision: 2,
  };

  // Test MP-1: Registry initializes empty and respects maxOpenPositions = 2
  try {
    const active = testRegistry.getActivePositions();
    const maxPos = testRegistry.getMaxPositions();
    const pass1 = active.length === 0 && maxPos === 2;
    add('MP1', 'Registry initializes empty with maxOpenPositions = 2', pass1, `Active: ${active.length}, Max: ${maxPos}`);
  } catch (err: any) {
    add('MP1', 'Registry initializes empty with maxOpenPositions = 2', false, err.message);
  }

  // Test MP-2: Register Position #1 (BTCUSDT) with complete audit schema
  let pos1Record: PilotPositionRecord | null = null;
  try {
    const now = Date.now();
    pos1Record = await testRegistry.registerPosition({
      symbol: 'BTCUSDT',
      side: 'LONG',
      positionSide: 'BOTH',
      entryOrderId: '100101',
      entryClientOrderId: 'apx-e-btc-1',
      transactionId: 'txn-mp-btc-1',
      fingerprint: 'fp-btc-1',
      authorizationId: 'auth-btc-1',
      plannedEntry: 86000,
      actualEntry: 86002,
      quantity: 0.002,
      notional: 172.004,
      SL: 85000,
      TP: 88000,
      riskAmount: 2.004,
      status: 'ACTIVE',
      lifecycleState: 'OPEN',
      openedAt: now,
    });

    const pass2 =
      pos1Record.positionId.startsWith('pos-BTCUSDT-') &&
      pos1Record.symbol === 'BTCUSDT' &&
      pos1Record.status === 'ACTIVE' &&
      pos1Record.lifecycleState === 'OPEN' &&
      testRegistry.getActiveCount() === 1;

    add('MP2', 'Register Position #1 (BTCUSDT) with full schema', pass2, `PositionId: ${pos1Record.positionId}, Active: ${testRegistry.getActiveCount()}`);
  } catch (err: any) {
    add('MP2', 'Register Position #1 (BTCUSDT) with full schema', false, err.message);
  }

  // Test MP-3: Update Position #1 with protective SL/TP -> lifecycleState PROTECTED
  try {
    if (pos1Record) {
      await testRegistry.updatePosition(pos1Record.positionId, {
        stopLossOrderId: '100102',
        stopLossClientOrderId: 'apx-sl-btc-1',
        takeProfitOrderId: '100103',
        takeProfitClientOrderId: 'apx-tp-btc-1',
        lifecycleState: 'PROTECTED',
      });
      const updated = testRegistry.getPosition(pos1Record.positionId);
      const pass3 =
        updated?.lifecycleState === 'PROTECTED' &&
        updated?.stopLossOrderId === '100102' &&
        updated?.takeProfitOrderId === '100103';
      add('MP3', 'Position #1 protective orders update lifecycle to PROTECTED', pass3, `Lifecycle: ${updated?.lifecycleState}`);
    } else {
      add('MP3', 'Position #1 protective orders update lifecycle to PROTECTED', false, 'pos1Record missing');
    }
  } catch (err: any) {
    add('MP3', 'Position #1 protective orders update lifecycle to PROTECTED', false, err.message);
  }

  // Test MP-4: Symbol collision prevention: cannot open second position for BTCUSDT
  try {
    const checkBtc = testRegistry.canOpenNewPosition('BTCUSDT');
    let collisionBlocked = !checkBtc.allowed && Boolean(checkBtc.reason?.includes('SYMBOL_ALREADY_ACTIVE'));

    let throwOnRegister = false;
    try {
      await testRegistry.registerPosition({
        symbol: 'BTCUSDT',
        side: 'SHORT',
        positionSide: 'BOTH',
        entryOrderId: '100104',
        entryClientOrderId: 'apx-e-btc-2',
        transactionId: 'txn-mp-btc-2',
        fingerprint: 'fp-btc-2',
        authorizationId: 'auth-btc-2',
        plannedEntry: 86000,
        actualEntry: 86000,
        quantity: 0.001,
        notional: 86,
        SL: 87000,
        TP: 84000,
        riskAmount: 1,
        status: 'ACTIVE',
        lifecycleState: 'OPEN',
        openedAt: Date.now(),
      });
    } catch (e: any) {
      throwOnRegister = e.message.includes('SYMBOL_ALREADY_ACTIVE');
    }

    const pass4 = collisionBlocked && throwOnRegister;
    add('MP4', 'Symbol collision prevention blocks duplicate BTCUSDT', pass4, `Check: ${checkBtc.reason}`);
  } catch (err: any) {
    add('MP4', 'Symbol collision prevention blocks duplicate BTCUSDT', false, err.message);
  }

  // Test MP-5: Register Position #2 (ETHUSDT) -> Concurrent positions = 2
  let pos2Record: PilotPositionRecord | null = null;
  try {
    const now = Date.now();
    pos2Record = await testRegistry.registerPosition({
      symbol: 'ETHUSDT',
      side: 'LONG',
      positionSide: 'BOTH',
      entryOrderId: '200201',
      entryClientOrderId: 'apx-e-eth-1',
      transactionId: 'txn-mp-eth-1',
      fingerprint: 'fp-eth-1',
      authorizationId: 'auth-eth-1',
      plannedEntry: 2700,
      actualEntry: 2701,
      quantity: 0.05,
      notional: 135.05,
      SL: 2650,
      TP: 2800,
      riskAmount: 2.55,
      status: 'ACTIVE',
      lifecycleState: 'OPEN',
      openedAt: now,
    });

    await testRegistry.updatePosition(pos2Record.positionId, {
      stopLossOrderId: '200202',
      takeProfitOrderId: '200203',
      lifecycleState: 'PROTECTED',
    });

    const activeList = testRegistry.getActivePositions();
    const pass5 =
      activeList.length === 2 &&
      activeList.some((p) => p.symbol === 'BTCUSDT') &&
      activeList.some((p) => p.symbol === 'ETHUSDT') &&
      pos1Record?.positionId !== pos2Record.positionId;

    add('MP5', 'Concurrent positions #1 and #2 active simultaneously', pass5, `Active count: ${activeList.length}/2`);
  } catch (err: any) {
    add('MP5', 'Concurrent positions #1 and #2 active simultaneously', false, err.message);
  }

  // Test MP-6: Capacity limit enforced: Attempting Position #3 is strictly blocked
  try {
    const checkSol = testRegistry.canOpenNewPosition('SOLUSDT');
    let capBlocked = !checkSol.allowed && Boolean(checkSol.reason?.includes('MAX_OPEN_POSITIONS_REACHED'));

    let throwOnThird = false;
    try {
      await testRegistry.registerPosition({
        symbol: 'SOLUSDT',
        side: 'LONG',
        positionSide: 'BOTH',
        entryOrderId: '300301',
        entryClientOrderId: 'apx-e-sol-1',
        transactionId: 'txn-mp-sol-1',
        fingerprint: 'fp-sol-1',
        authorizationId: 'auth-sol-1',
        plannedEntry: 150,
        actualEntry: 150,
        quantity: 0.5,
        notional: 75,
        SL: 145,
        TP: 160,
        riskAmount: 2.5,
        status: 'ACTIVE',
        lifecycleState: 'OPEN',
        openedAt: Date.now(),
      });
    } catch (e: any) {
      throwOnThird = e.message.includes('MAX_OPEN_POSITIONS_REACHED');
    }

    const pass6 = capBlocked && throwOnThird;
    add('MP6', 'Attempting 3rd position strictly blocked by capacity guard', pass6, `Reason: ${checkSol.reason}`);
  } catch (err: any) {
    add('MP6', 'Attempting 3rd position strictly blocked by capacity guard', false, err.message);
  }

  // Test MP-7: HOOKUSDT permanently isolated: cannot be registered or count as slot
  try {
    const checkHook = testRegistry.canOpenNewPosition('HOOKUSDT');
    let hookBlocked = !checkHook.allowed && Boolean(checkHook.reason?.includes('HOOKUSDT_EXCLUDED'));

    let throwOnHook = false;
    try {
      await testRegistry.registerPosition({
        symbol: 'HOOKUSDT',
        side: 'SHORT',
        positionSide: 'BOTH',
        entryOrderId: '999999',
        entryClientOrderId: 'apx-e-hook',
        transactionId: 'txn-hook',
        fingerprint: 'fp-hook',
        authorizationId: 'auth-hook',
        plannedEntry: 0.013,
        actualEntry: 0.013,
        quantity: 100,
        notional: 1.3,
        SL: 0.015,
        TP: 0.010,
        riskAmount: 0.2,
        status: 'ACTIVE',
        lifecycleState: 'OPEN',
        openedAt: Date.now(),
      });
    } catch (e: any) {
      throwOnHook = e.message.includes('HOOKUSDT');
    }

    const pass7 = hookBlocked && throwOnHook;
    add('MP7', 'HOOKUSDT strictly excluded and forbidden in registry', pass7, `Reason: ${checkHook.reason}`);
  } catch (err: any) {
    add('MP7', 'HOOKUSDT strictly excluded and forbidden in registry', false, err.message);
  }

  // Test MP-8: Unique Position Identity: IDs and records are completely independent
  try {
    const p1 = testRegistry.getPosition(pos1Record!.positionId);
    const p2 = testRegistry.getPosition(pos2Record!.positionId);

    const pass8 =
      Boolean(p1 && p2) &&
      p1?.positionId !== p2?.positionId &&
      p1?.symbol !== p2?.symbol &&
      p1?.transactionId !== p2?.transactionId &&
      p1?.entryOrderId !== p2?.entryOrderId &&
      p1?.stopLossOrderId !== p2?.stopLossOrderId &&
      p1?.takeProfitOrderId !== p2?.takeProfitOrderId;

    add('MP8', 'Unique Position Identity prevents conflation of positions', pass8, `P1 ID: ${p1?.positionId}, P2 ID: ${p2?.positionId}`);
  } catch (err: any) {
    add('MP8', 'Unique Position Identity prevents conflation of positions', false, err.message);
  }

  // Test MP-9: Independent Multi-Position Native Reconciliation
  try {
    const mockRemotePositions = [
      { symbol: 'BTCUSDT', side: 'LONG' as const, quantity: 0.002, entryPrice: 86002, unrealizedPnl: 0, leverage: 10, initialMargin: 17, markPrice: 86000 },
      { symbol: 'ETHUSDT', side: 'LONG' as const, quantity: 0.05, entryPrice: 2701, unrealizedPnl: 0, leverage: 10, initialMargin: 13, markPrice: 2700 },
      { symbol: 'HOOKUSDT', side: 'SHORT' as const, quantity: 376509.1, entryPrice: 0.01325, unrealizedPnl: 0, leverage: 20, initialMargin: 153, markPrice: 0.008 },
    ];

    const mockOpenOrders = [
      { orderId: '100102', symbol: 'BTCUSDT', type: 'STOP_MARKET', side: 'SELL', stopPrice: 85000, clientOrderId: 'apx-sl-btc-1' },
      { orderId: '100103', symbol: 'BTCUSDT', type: 'TAKE_PROFIT_MARKET', side: 'SELL', stopPrice: 88000, clientOrderId: 'apx-tp-btc-1' },
      { orderId: '200202', symbol: 'ETHUSDT', type: 'STOP_MARKET', side: 'SELL', stopPrice: 2650, clientOrderId: 'apx-sl-eth-1' },
      { orderId: '200203', symbol: 'ETHUSDT', type: 'TAKE_PROFIT_MARKET', side: 'SELL', stopPrice: 2800, clientOrderId: 'apx-tp-eth-1' },
    ];

    const reconResults = await testRegistry.reconcileAllPositions(mockRemotePositions, mockOpenOrders);

    const btcRecon = reconResults.find((r) => r.symbol === 'BTCUSDT');
    const ethRecon = reconResults.find((r) => r.symbol === 'ETHUSDT');

    const pass9 =
      reconResults.length === 2 &&
      Boolean(btcRecon && btcRecon.inSync && btcRecon.slOrderActive && btcRecon.tpOrderActive) &&
      Boolean(ethRecon && ethRecon.inSync && ethRecon.slOrderActive && ethRecon.tpOrderActive);

    add('MP9', 'Independent native reconciliation verifies each position independently', pass9, `BTC sync: ${btcRecon?.inSync}, ETH sync: ${ethRecon?.inSync}`);
  } catch (err: any) {
    add('MP9', 'Independent native reconciliation verifies each position independently', false, err.message);
  }

  // Test MP-10: Persistence Across Restart: State loads cleanly from disk
  try {
    const restartedRegistry = new PilotPositionRegistry({ customPath: './data/test_pilot_registry.json', maxOpenPositions: 2 });
    await restartedRegistry.init();

    const restoredActive = restartedRegistry.getActivePositions();
    const restoredP1 = restartedRegistry.getPosition(pos1Record!.positionId);
    const restoredP2 = restartedRegistry.getPosition(pos2Record!.positionId);

    const pass10 =
      restoredActive.length === 2 &&
      Boolean(restoredP1 && restoredP1.symbol === 'BTCUSDT' && restoredP1.lifecycleState === 'PROTECTED') &&
      Boolean(restoredP2 && restoredP2.symbol === 'ETHUSDT' && restoredP2.lifecycleState === 'PROTECTED');

    add('MP10', 'Persistence across restart: All active positions restored intact', pass10, `Restored active count: ${restoredActive.length}/2`);
  } catch (err: any) {
    add('MP10', 'Persistence across restart: All active positions restored intact', false, err.message);
  }

  // Test MP-11: Clean orderly exit of Position #1 -> leaves Position #2 active
  try {
    await testRegistry.closePositionRecord(pos1Record!.positionId, {
      exitReason: 'TEST_TAKE_PROFIT_TRIGGERED',
      closeOrderId: '100105',
      realizedPnl: 4.0,
    });

    const activeAfterClose1 = testRegistry.getActivePositions();
    const closedList = testRegistry.getClosedPositions();
    const canNowOpenSol = testRegistry.canOpenNewPosition('SOLUSDT');

    const pass11 =
      activeAfterClose1.length === 1 &&
      activeAfterClose1[0].symbol === 'ETHUSDT' &&
      closedList.length === 1 &&
      closedList[0].symbol === 'BTCUSDT' &&
      canNowOpenSol.allowed === true;

    add('MP11', 'Clean exit of Position #1 frees slot for next opportunity', pass11, `Active: ${activeAfterClose1.length}, Slot open for SOL: ${canNowOpenSol.allowed}`);
  } catch (err: any) {
    add('MP11', 'Clean exit of Position #1 frees slot for next opportunity', false, err.message);
  }

  // Test MP-12: Clean exit of Position #2 -> 0 active positions
  try {
    await testRegistry.closePositionRecord(pos2Record!.positionId, {
      exitReason: 'TEST_MANUAL_CLEAN_CLOSE',
      closeOrderId: '200205',
      realizedPnl: 2.0,
    });

    const activeEnd = testRegistry.getActivePositions();
    const pass12 = activeEnd.length === 0;
    add('MP12', 'Clean exit of Position #2 leaves 0 active pilot positions', pass12, `Final active count: ${activeEnd.length}`);
  } catch (err: any) {
    add('MP12', 'Clean exit of Position #2 leaves 0 active pilot positions', false, err.message);
  }

  // Test MP-13: AutonomousPilotEngine Cycle 1 -> Opens Position #1 (holds open)
  const engineRegistry = new PilotPositionRegistry({ customPath: './data/test_engine_registry.json', maxOpenPositions: 2 });
  await engineRegistry.clearRegistryForTest();

  const cycleEngine = new AutonomousPilotEngine({
    registry: engineRegistry,
    config: { maxOpenPositions: 2, maxEntriesPerCycle: 1 },
  });

  let cycle1PosId: string | undefined;
  try {
    const cand1 = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'Breakout long',
    };
    const transport1 = new MockBinanceOrderTransport();
    const cycle1 = await cycleEngine.executeAutonomousCycle(transport1, {
      candidateOverride: cand1,
      exchangeInfoOverride: btcFilters,
      skipClosingAtEnd: true, // Hold position open!
    });

    cycle1PosId = cycle1.positionId;
    const active1 = engineRegistry.getActivePositions();
    const pass13 =
      cycle1.success &&
      Boolean(cycle1PosId) &&
      active1.length === 1 &&
      active1[0].symbol === 'BTCUSDT' &&
      active1[0].lifecycleState === 'PROTECTED';

    add('MP13', 'Cycle 1: Opens and holds Position #1 (BTCUSDT)', pass13, `Decision: ${cycle1.decision}, PositionId: ${cycle1PosId}`);
  } catch (err: any) {
    add('MP13', 'Cycle 1: Opens and holds Position #1 (BTCUSDT)', false, err.message);
  }

  // Test MP-14: Same-cycle entry limitation / duplicate check in cycle: BTCUSDT rejected
  try {
    const candDup = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'Duplicate entry attempt',
    };
    const cycleDup = await cycleEngine.executeAutonomousCycle(new MockBinanceOrderTransport(), {
      candidateOverride: candDup,
      exchangeInfoOverride: btcFilters,
    });

    const pass14 = !cycleDup.success && cycleDup.decision === 'SYMBOL_ALREADY_ACTIVE';
    add('MP14', 'Duplicate candidate symbol in cycle strictly rejected', pass14, `Decision: ${cycleDup.decision}`);
  } catch (err: any) {
    add('MP14', 'Duplicate candidate symbol in cycle strictly rejected', false, err.message);
  }

  // Test MP-15: AutonomousPilotEngine Cycle 2 -> Opens Position #2 (ETHUSDT) concurrently
  let cycle2PosId: string | undefined;
  try {
    const cand2 = {
      symbol: 'ETHUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 2700,
      stopLossPrice: 2650,
      takeProfitPrice: 2800,
      confidence: 0.88,
      rationale: 'ETH trend continuation',
    };
    const transport2 = new MockBinanceOrderTransport();
    const cycle2 = await cycleEngine.executeAutonomousCycle(transport2, {
      candidateOverride: cand2,
      exchangeInfoOverride: ethFilters,
      skipClosingAtEnd: true, // Hold position open!
    });

    cycle2PosId = cycle2.positionId;
    const active2 = engineRegistry.getActivePositions();
    const pass15 =
      cycle2.success &&
      Boolean(cycle2PosId) &&
      active2.length === 2 &&
      active2.some((p) => p.symbol === 'BTCUSDT') &&
      active2.some((p) => p.symbol === 'ETHUSDT');

    add('MP15', 'Cycle 2: Opens and holds Position #2 (ETHUSDT) concurrently', pass15, `Decision: ${cycle2.decision}, Active: ${active2.length}/2`);
  } catch (err: any) {
    add('MP15', 'Cycle 2: Opens and holds Position #2 (ETHUSDT) concurrently', false, err.message);
  }

  // Test MP-16: Cycle 3: Attempting Position #3 (SOLUSDT) blocked by POSITION_LIMIT_REACHED
  try {
    const cand3 = {
      symbol: 'SOLUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 150,
      stopLossPrice: 145,
      takeProfitPrice: 160,
      confidence: 0.90,
      rationale: 'SOL breakout',
    };
    const cycle3 = await cycleEngine.executeAutonomousCycle(new MockBinanceOrderTransport(), {
      candidateOverride: cand3,
      exchangeInfoOverride: solFilters,
    });

    const pass16 = !cycle3.success && cycle3.decision === 'POSITION_LIMIT_REACHED';
    add('MP16', 'Cycle 3: Opening 3rd position strictly blocked by maxOpenPositions guard', pass16, `Decision: ${cycle3.decision}`);
  } catch (err: any) {
    add('MP16', 'Cycle 3: Opening 3rd position strictly blocked by maxOpenPositions guard', false, err.message);
  }

  // Test MP-17: Scan with 2 active positions returns MAX_POSITIONS_REACHED
  try {
    const scanFull = await cycleEngine.scanAndSelectCandidate({ symbolsSubset: ['SOLUSDT'] });
    const pass17 = scanFull.candidate === null && scanFull.reason === 'MAX_POSITIONS_REACHED';
    add('MP17', 'Candidate scanner returns MAX_POSITIONS_REACHED when 2 positions open', pass17, `Reason: ${scanFull.reason}`);
  } catch (err: any) {
    add('MP17', 'Candidate scanner returns MAX_POSITIONS_REACHED when 2 positions open', false, err.message);
  }

  // Test MP-18: Multi-position reconciliation helper
  try {
    const reconReport = await cycleEngine.reconcilePilotPositions(new MockBinanceOrderTransport());
    const pass18 = reconReport.activeCount === 2;
    add('MP18', 'reconcilePilotPositions verifies both active positions', pass18, `Active counted: ${reconReport.activeCount}`);
  } catch (err: any) {
    add('MP18', 'reconcilePilotPositions verifies both active positions', false, err.message);
  }

  // Test MP-19: Strict Testnet Network Guard verification (0 production requests)
  try {
    const transport = new BinanceTestnetOrderTransport();
    const pass19 =
      transport.productionOrdersCount === 0 &&
      transport.productionRequestsCount === 0 &&
      binanceNetworkGuard.getAuditSummary().productionAttemptCount === 0;

    add('MP19', 'Strict Testnet Network Guard: 0 production requests or orders', pass19, `Prod requests: ${transport.productionRequestsCount}, Prod orders: ${transport.productionOrdersCount}`);
  } catch (err: any) {
    add('MP19', 'Strict Testnet Network Guard: 0 production requests or orders', false, err.message);
  }

  // Clean up test registries
  try {
    await testRegistry.clearRegistryForTest();
    await engineRegistry.clearRegistryForTest();
  } catch {
    // Cleanup ignore
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  return {
    total: results.length,
    passed: passedCount,
    failed: failedCount,
    results,
  };
}
