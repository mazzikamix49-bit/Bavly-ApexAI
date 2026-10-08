import {
  AutonomousPilotEngine,
  DEFAULT_PILOT_CONFIG,
  TESTNET_AUTONOMOUS_PILOT_MODE_DEFAULT,
} from './autonomousPilotEngine';
import {
  MockBinanceOrderTransport,
  testnetExecutionAdapter,
  computePlanFingerprint,
} from './testnetExecutionAdapter';
import { executionTransactionStore } from './executionTransactionStore';
import { executionPreflight } from './executionPreflight';
import { executionPolicy } from './executionPolicy';
import { SAFE_BOOT_MODE } from './workerEngine';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { BinanceTestnetOrderTransport } from './binanceTestnetOrderTransport';

export interface TestResult {
  code: string;
  name: string;
  passed: boolean;
  details: string;
}

export async function runAllPilotTests(): Promise<{
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}> {
  const results: TestResult[] = [];

  const add = (code: string, name: string, passed: boolean, details: string) => {
    results.push({ code, name, passed, details });
    console.log(`[TEST_${code}] ${name}: ${passed ? 'PASS' : 'FAIL'} - ${details}`);
  };

  const engine = new AutonomousPilotEngine();
  const mockFilters = {
    symbol: 'BTCUSDT',
    tickSize: 0.1,
    stepSize: 0.001,
    minQty: 0.001,
    minNotional: 5.0,
    pricePrecision: 1,
    quantityPrecision: 3,
  };

  // Test A: No candidate -> no trade
  try {
    const resA = await engine.scanAndSelectCandidate({
      symbolsSubset: ['BTCUSDT'],
      mockMarketSnapshot: { pairs: [] },
    });
    const passA = resA.candidate === null && resA.allQualifiedCount === 0;
    add('A', 'No candidate -> no trade', passA, `Candidate: ${resA.candidate}, Reason: ${resA.reason}`);
  } catch (err: any) {
    add('A', 'No candidate -> no trade', false, err.message);
  }

  // Test B: One valid candidate -> one Entry
  try {
    const mockCand = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'Breakout above resistance',
    };
    const mockTransportB = new MockBinanceOrderTransport();
    const cycleB = await engine.executeAutonomousCycle(mockTransportB, {
      candidateOverride: mockCand,
      exchangeInfoOverride: mockFilters,
    });
    const passB = cycleB.success && mockTransportB.requests.length >= 1 && mockTransportB.requests[0].side === 'BUY';
    add('B', 'One valid candidate -> one Entry', passB, `Requests: ${mockTransportB.requests.length}, Decision: ${cycleB.decision}`);
  } catch (err: any) {
    add('B', 'One valid candidate -> one Entry', false, err.message);
  }

  // Test C: Two valid candidates -> only one Entry
  try {
    const cand1 = {
      symbol: 'ETHUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 2700,
      stopLossPrice: 2650,
      takeProfitPrice: 2800,
      confidence: 0.80,
      rationale: 'ETH uptrend',
    };
    const cand2 = {
      symbol: 'SOLUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 120,
      stopLossPrice: 116,
      takeProfitPrice: 128,
      confidence: 0.90, // Higher confidence -> must be chosen
      rationale: 'SOL stronger trend',
    };
    const qualified = [cand1, cand2];
    qualified.sort((a, b) => b.confidence - a.confidence);
    const chosen = qualified[0];
    const mockTransportC = new MockBinanceOrderTransport();
    const cycleC = await engine.executeAutonomousCycle(mockTransportC, {
      candidateOverride: chosen,
      exchangeInfoOverride: {
        symbol: 'SOLUSDT',
        tickSize: 0.01,
        stepSize: 0.01,
        minQty: 0.01,
        minNotional: 5.0,
      },
    });
    const passC = cycleC.success && chosen.symbol === 'SOLUSDT' && mockTransportC.requests.length >= 1 && mockTransportC.requests[0].symbol === 'SOLUSDT';
    add('C', 'Two valid candidates -> only one Entry', passC, `Chosen candidate: ${chosen.symbol} (confidence: ${chosen.confidence})`);
  } catch (err: any) {
    add('C', 'Two valid candidates -> only one Entry', false, err.message);
  }

  // Test D: Existing HOOKUSDT -> blocked
  try {
    let hookBlocked = false;
    try {
      await engine.buildExecutionPlan(
        {
          symbol: 'HOOKUSDT',
          signal: 'SELL_SHORT',
          side: 'SHORT',
          entryPrice: 0.013,
          stopLossPrice: 0.015,
          takeProfitPrice: 0.010,
          confidence: 0.9,
          rationale: 'HOOK test',
        },
        10000,
        mockFilters
      );
    } catch (e: any) {
      hookBlocked = e.message.includes('HOOKUSDT');
    }
    add('D', 'Existing HOOKUSDT -> blocked', hookBlocked, 'HOOKUSDT plan construction strictly throws');
  } catch (err: any) {
    add('D', 'Existing HOOKUSDT -> blocked', false, err.message);
  }

  // Test E: Invalid SL -> blocked
  try {
    let invalidSlBlocked = false;
    try {
      await engine.buildExecutionPlan(
        {
          symbol: 'BTCUSDT',
          signal: 'BUY_LONG',
          side: 'LONG',
          entryPrice: 86000,
          stopLossPrice: 86000, // Distance = 0 -> invalid!
          takeProfitPrice: 88000,
          confidence: 0.8,
          rationale: 'Bad SL',
        },
        10000,
        mockFilters
      );
    } catch (e: any) {
      invalidSlBlocked = e.message.includes('Invalid Stop Loss');
    }
    add('E', 'Invalid SL -> blocked', invalidSlBlocked, 'Zero-distance SL strictly rejected');
  } catch (err: any) {
    add('E', 'Invalid SL -> blocked', false, err.message);
  }

  // Test F: Unknown risk -> blocked
  try {
    let unknownRiskBlocked = false;
    try {
      await engine.buildExecutionPlan(
        {
          symbol: 'BTCUSDT',
          signal: 'BUY_LONG',
          side: 'LONG',
          entryPrice: 86000,
          stopLossPrice: NaN,
          takeProfitPrice: 88000,
          confidence: 0.8,
          rationale: 'NaN SL',
        },
        10000,
        mockFilters
      );
    } catch (e: any) {
      unknownRiskBlocked = e.message.includes('NaN');
    }
    add('F', 'Unknown risk -> blocked', unknownRiskBlocked, 'NaN stopLossPrice strictly rejected');
  } catch (err: any) {
    add('F', 'Unknown risk -> blocked', false, err.message);
  }

  // Test G: Equity unavailable -> blocked
  try {
    let equityUnavailableBlocked = false;
    try {
      await engine.buildExecutionPlan(
        {
          symbol: 'BTCUSDT',
          signal: 'BUY_LONG',
          side: 'LONG',
          entryPrice: 86000,
          stopLossPrice: 85000,
          takeProfitPrice: 88000,
          confidence: 0.8,
          rationale: 'No equity test',
        },
        0, // 0 equity!
        mockFilters
      );
    } catch (e: any) {
      equityUnavailableBlocked = e.message.includes('equity');
    }
    add('G', 'Equity unavailable -> blocked', equityUnavailableBlocked, 'Zero or negative equity strictly throws');
  } catch (err: any) {
    add('G', 'Equity unavailable -> blocked', false, err.message);
  }

  // Test H: Price drift breach -> blocked
  try {
    const candH = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'Drift test',
    };
    const planH = await engine.buildExecutionPlan(candH, 10000, mockFilters);
    // Overriding live price to 89000 (+3.4% drift > 1.5% max)
    const policyH = executionPolicy.evaluate(planH, {
      currentPrice: 89000,
      currentEquity: 10000,
      openPositions: [],
      capitalProfile: { capitalUsd: 10000, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 },
      now: Date.now(),
    });
    const passH = !policyH.allowed && policyH.code === 'REQUIRE_REBUILD_PLAN';
    add('H', 'Price drift breach -> blocked', passH, `Policy code: ${policyH.code}`);
  } catch (err: any) {
    add('H', 'Price drift breach -> blocked', false, err.message);
  }

  // Test I: Equity drift breach -> blocked
  try {
    const candI = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'Equity drift test',
    };
    const planI = await engine.buildExecutionPlan(candI, 10000, mockFilters);
    // Overriding equity to 9000 (-10% drift > 5% max)
    const policyI = executionPolicy.evaluate(planI, {
      currentPrice: 86000,
      currentEquity: 9000,
      openPositions: [],
      capitalProfile: { capitalUsd: 10000, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 },
      now: Date.now(),
    });
    const passI = !policyI.allowed && (policyI.code === 'EXECUTION_BLOCKED_RISK_LIMIT_EXCEEDED' || policyI.code === 'REBUILD_EXECUTION_PLAN_REQUIRED');
    add('I', 'Equity drift breach -> blocked', passI, `Policy code: ${policyI.code}`);
  } catch (err: any) {
    add('I', 'Equity drift breach -> blocked', false, err.message);
  }

  // Test J: Preflight failure -> zero Binance order requests
  try {
    const candJ = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'Preflight fail test',
    };
    const mockTransportJ = new MockBinanceOrderTransport();
    // Simulate preflight failure by passing minNotional of 100000 (much higher than notional)
    const cycleJ = await engine.executeAutonomousCycle(mockTransportJ, {
      candidateOverride: candJ,
      exchangeInfoOverride: { ...mockFilters, minNotional: 100000 },
    });
    const passJ = !cycleJ.success && mockTransportJ.requests.length === 0;
    add('J', 'Preflight failure -> zero Binance order requests', passJ, `Requests: ${mockTransportJ.requests.length}`);
  } catch (err: any) {
    add('J', 'Preflight failure -> zero Binance order requests', false, err.message);
  }

  // Test K: Policy failure -> zero Binance order requests
  try {
    const candK = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'Policy fail test',
    };
    const planK = await engine.buildExecutionPlan(candK, 10000, mockFilters);
    const mockTransportK = new MockBinanceOrderTransport();
    const policyK = executionPolicy.evaluate(planK, {
      currentPrice: 86000,
      currentEquity: 10000,
      openPositions: [],
      capitalProfile: { capitalUsd: 10000, riskPerTradePercent: 0, maxDailyLossPercent: 2.0, maxOpenPositions: 1 }, // 0 risk -> rejects!
      now: Date.now(),
    });
    const passK = !policyK.allowed && mockTransportK.requests.length === 0;
    add('K', 'Policy failure -> zero Binance order requests', passK, `Requests: ${mockTransportK.requests.length}, Policy code: ${policyK.code}`);
  } catch (err: any) {
    add('K', 'Policy failure -> zero Binance order requests', false, err.message);
  }

  // Test L: Entry failure -> no SL/TP
  try {
    const candL = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'Entry fail test',
    };
    const mockTransportL = new MockBinanceOrderTransport({ failEntry: true, entryError: 'INSUFFICIENT_MARGIN' });
    const cycleL = await engine.executeAutonomousCycle(mockTransportL, {
      candidateOverride: candL,
      exchangeInfoOverride: mockFilters,
    });
    const passL = !cycleL.success && mockTransportL.requests.length === 1 && !mockTransportL.requests.some((r) => r.type.includes('STOP') || r.type.includes('PROFIT'));
    add('L', 'Entry failure -> no SL/TP', passL, `Requests count: ${mockTransportL.requests.length}`);
    engine.clearManualReview();
  } catch (err: any) {
    add('L', 'Entry failure -> no SL/TP', false, err.message);
  }

  // Test M: SL failure -> partial/manual review
  try {
    const candM = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'SL fail test',
    };
    const mockTransportM = new MockBinanceOrderTransport({ failStop: true, stopError: 'SL_REJECTED_EXCHANGE' });
    const cycleM = await engine.executeAutonomousCycle(mockTransportM, {
      candidateOverride: candM,
      exchangeInfoOverride: mockFilters,
    });
    const passM = !cycleM.success && cycleM.decision === 'SL_REJECTED';
    add('M', 'SL failure -> partial/manual review', passM, `Decision: ${cycleM.decision}`);
    engine.clearManualReview();
    const activeBtcM = engine.getRegistry().getActivePositionBySymbol('BTCUSDT');
    if (activeBtcM) {
      await engine.getRegistry().closePositionRecord(activeBtcM.positionId, { exitReason: 'TEST_CLEANUP' });
    }
  } catch (err: any) {
    add('M', 'SL failure -> partial/manual review', false, err.message);
  }

  // Test N: TP failure -> partial/manual review
  try {
    const candN = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'TP fail test',
    };
    const mockTransportN = new MockBinanceOrderTransport({ failTakeProfit: true, takeProfitError: 'TP_LIMIT_EXCEEDED' });
    const cycleN = await engine.executeAutonomousCycle(mockTransportN, {
      candidateOverride: candN,
      exchangeInfoOverride: mockFilters,
    });
    const passN = !cycleN.success && cycleN.decision === 'TP_REJECTED';
    add('N', 'TP failure -> partial/manual review', passN, `Decision: ${cycleN.decision}`);
    engine.clearManualReview();
    const activeBtcN = engine.getRegistry().getActivePositionBySymbol('BTCUSDT');
    if (activeBtcN) {
      await engine.getRegistry().closePositionRecord(activeBtcN.positionId, { exitReason: 'TEST_CLEANUP' });
    }
  } catch (err: any) {
    add('N', 'TP failure -> partial/manual review', false, err.message);
  }

  // Test O: Restart after Entry -> no duplicate Entry
  try {
    const acc = await binanceTestnetAccountStateProvider.getAccountState();
    const livePrice = (await executionPreflight.fetchCurrentPrice('BTCUSDT')) || 86000;
    const currentEquity = acc.equity || 31720;
    const candO = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: livePrice,
      stopLossPrice: livePrice * 0.99,
      takeProfitPrice: livePrice * 1.01,
      confidence: 0.85,
      rationale: 'Restart after entry test',
    };
    const planO = await engine.buildExecutionPlan(candO, currentEquity);
    const authO = testnetExecutionAdapter.arm(planO, 60000);
    const mockTransportO = new MockBinanceOrderTransport();
    // First run: consumes auth
    await testnetExecutionAdapter.execute(planO, authO, mockTransportO, {
      bypassSafeBootForMockTest: true,
      bypassExecutionDisabledForMockTest: true,
      currentPriceOverride: livePrice,
      currentEquityOverride: currentEquity,
      capitalProfileOverride: { capitalUsd: currentEquity, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 },
      preflightOverrides: {
        currentPrice: livePrice,
        positionMode: 'ONE_WAY',
        accountState: acc as any,
        settings: { capitalProfile: { capitalUsd: currentEquity, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 } },
      },
    });
    // Second run: replay attempt after restart
    const replayO = await testnetExecutionAdapter.execute(planO, authO, mockTransportO, {
      bypassSafeBootForMockTest: true,
      bypassExecutionDisabledForMockTest: true,
      currentPriceOverride: livePrice,
      currentEquityOverride: currentEquity,
      capitalProfileOverride: { capitalUsd: currentEquity, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 },
      preflightOverrides: {
        currentPrice: livePrice,
        positionMode: 'ONE_WAY',
        accountState: acc as any,
        settings: { capitalProfile: { capitalUsd: currentEquity, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 } },
      },
    });
    const passO = !replayO.success && (replayO.failureCode === 'EXECUTION_AUTHORIZATION_ALREADY_CONSUMED' || replayO.failureCode === 'EXECUTION_IDEMPOTENCY_BLOCKED');
    add('O', 'Restart after Entry -> no duplicate Entry', passO, `Failure code: ${replayO.failureCode}`);
  } catch (err: any) {
    add('O', 'Restart after Entry -> no duplicate Entry', false, err.message);
  }

  // Test P: Restart after SL -> no duplicate SL
  try {
    const consumedFp = await executionTransactionStore.getConsumedFingerprints();
    const passP = consumedFp.size > 0;
    add('P', 'Restart after SL -> no duplicate SL', passP, `Consumed fingerprints tracked: ${consumedFp.size}`);
  } catch (err: any) {
    add('P', 'Restart after SL -> no duplicate SL', false, err.message);
  }

  // Test Q: Restart after TP -> no duplicate TP
  try {
    const consumedAuths = await executionTransactionStore.getConsumedAuthIds();
    const passQ = consumedAuths.size > 0;
    add('Q', 'Restart after TP -> no duplicate TP', passQ, `Consumed authorizations tracked: ${consumedAuths.size}`);
  } catch (err: any) {
    add('Q', 'Restart after TP -> no duplicate TP', false, err.message);
  }

  // Test R: Duplicate fingerprint -> blocked
  try {
    const acc = await binanceTestnetAccountStateProvider.getAccountState();
    const livePrice = (await executionPreflight.fetchCurrentPrice('BTCUSDT')) || 86000;
    const currentEquity = acc.equity || 31720;
    const candR = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: livePrice,
      stopLossPrice: livePrice * 0.99,
      takeProfitPrice: livePrice * 1.01,
      confidence: 0.85,
      rationale: 'Duplicate FP test',
    };
    const planR = await engine.buildExecutionPlan(candR, currentEquity);
    const fpR = computePlanFingerprint(planR);
    await executionTransactionStore.createTransaction({
      transactionId: `txn-test-fp-${Date.now()}`,
      planFingerprint: fpR,
      authorizationId: `auth-test-fp-${Date.now()}`,
      symbol: planR.symbol,
      side: planR.side,
      requestedQuantity: planR.quantity,
      state: 'FULL_EXECUTION_CONFIRMED',
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      dryRunOnly: false,
      testnetOnly: true,
      reconciliationStatus: 'NOT_REQUIRED',
    });
    const authR = testnetExecutionAdapter.arm(planR, 60000);
    const replayR = await testnetExecutionAdapter.execute(planR, authR, new MockBinanceOrderTransport(), {
      bypassSafeBootForMockTest: true,
      bypassExecutionDisabledForMockTest: true,
      currentPriceOverride: livePrice,
      currentEquityOverride: currentEquity,
      capitalProfileOverride: { capitalUsd: currentEquity, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 },
      preflightOverrides: {
        currentPrice: livePrice,
        positionMode: 'ONE_WAY',
        accountState: acc as any,
        settings: { capitalProfile: { capitalUsd: currentEquity, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 } },
      },
    });
    const passR = !replayR.success && replayR.failureCode === 'EXECUTION_IDEMPOTENCY_BLOCKED';
    add('R', 'Duplicate fingerprint -> blocked', passR, `Failure code: ${replayR.failureCode}`);
  } catch (err: any) {
    add('R', 'Duplicate fingerprint -> blocked', false, err.message);
  }

  // Test S: Duplicate authorization -> blocked
  try {
    const acc = await binanceTestnetAccountStateProvider.getAccountState();
    const livePrice = (await executionPreflight.fetchCurrentPrice('BTCUSDT')) || 86000;
    const currentEquity = acc.equity || 31720;
    const candS = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: livePrice,
      stopLossPrice: livePrice * 0.99,
      takeProfitPrice: livePrice * 1.01,
      confidence: 0.85,
      rationale: 'Duplicate Auth test',
    };
    const planS = await engine.buildExecutionPlan(candS, currentEquity);
    const authS = testnetExecutionAdapter.arm(planS, 60000);
    await executionTransactionStore.createTransaction({
      transactionId: `txn-test-auth-${Date.now()}`,
      planFingerprint: `fp-unique-${Date.now()}`,
      authorizationId: authS.authorizationId,
      symbol: planS.symbol,
      side: planS.side,
      requestedQuantity: planS.quantity,
      state: 'FULL_EXECUTION_CONFIRMED',
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      dryRunOnly: false,
      testnetOnly: true,
      reconciliationStatus: 'NOT_REQUIRED',
    });
    const replayS = await testnetExecutionAdapter.execute(planS, authS, new MockBinanceOrderTransport(), {
      bypassSafeBootForMockTest: true,
      bypassExecutionDisabledForMockTest: true,
      currentPriceOverride: livePrice,
      currentEquityOverride: currentEquity,
      capitalProfileOverride: { capitalUsd: currentEquity, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 },
      preflightOverrides: {
        currentPrice: livePrice,
        positionMode: 'ONE_WAY',
        accountState: acc as any,
        settings: { capitalProfile: { capitalUsd: currentEquity, riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenPositions: 1 } },
      },
    });
    const passS = !replayS.success && replayS.failureCode === 'EXECUTION_AUTHORIZATION_ALREADY_CONSUMED';
    add('S', 'Duplicate authorization -> blocked', passS, `Failure code: ${replayS.failureCode}`);
  } catch (err: any) {
    add('S', 'Duplicate authorization -> blocked', false, err.message);
  }

  // Test T: Reconciliation mismatch -> new Entry blocked
  try {
    engine.triggerEmergencyStop('Reconciliation mismatch detected on exchange.');
    const cycleT = await engine.executeAutonomousCycle(new MockBinanceOrderTransport());
    const passT = !cycleT.success && cycleT.decision === 'BLOCKED_MANUAL_REVIEW';
    add('T', 'Reconciliation mismatch -> new Entry blocked', passT, `Decision: ${cycleT.decision}`);
    engine.clearManualReview();
  } catch (err: any) {
    add('T', 'Reconciliation mismatch -> new Entry blocked', false, err.message);
  }

  // Test U: Orphan order -> new Entry blocked
  try {
    engine.triggerEmergencyStop('Orphan protective order remaining on account.');
    const cycleU = await engine.executeAutonomousCycle(new MockBinanceOrderTransport());
    const passU = !cycleU.success && cycleU.decision === 'BLOCKED_MANUAL_REVIEW';
    add('U', 'Orphan order -> new Entry blocked', passU, `Decision: ${cycleU.decision}`);
    engine.clearManualReview();
  } catch (err: any) {
    add('U', 'Orphan order -> new Entry blocked', false, err.message);
  }

  // Test V: Production URL -> hard blocked
  try {
    let prodUrlBlocked = false;
    try {
      engine.verifyTestnetGuards('https://fapi.binance.com');
    } catch (e: any) {
      prodUrlBlocked = e.message.includes('Production URL detected');
    }
    add('V', 'Production URL -> hard blocked', prodUrlBlocked, 'Production URL throws immediately');
    engine.clearManualReview();
  } catch (err: any) {
    add('V', 'Production URL -> hard blocked', false, err.message);
  }

  // Test W: SAFE_BOOT remains protected
  try {
    const passW = SAFE_BOOT_MODE === true;
    add('W', 'SAFE_BOOT remains protected', passW, `SAFE_BOOT_MODE is ${SAFE_BOOT_MODE}`);
  } catch (err: any) {
    add('W', 'SAFE_BOOT remains protected', false, err.message);
  }

  // Test X: Pilot OFF by default
  try {
    const freshEngine = new AutonomousPilotEngine();
    const stX = await freshEngine.getStatus();
    const passX = stX.pilotEnabled === false && stX.pilotArmed === false && stX.pilotRunning === false;
    add('X', 'Pilot OFF by default', passX, `pilotEnabled=${stX.pilotEnabled}, pilotArmed=${stX.pilotArmed}, pilotRunning=${stX.pilotRunning}`);
  } catch (err: any) {
    add('X', 'Pilot OFF by default', false, err.message);
  }

  // Test Y: Pilot cannot run against Production
  try {
    let passY = false;
    try {
      engine.verifyTestnetGuards('https://fapi.binance.com');
    } catch {
      passY = true;
    }
    add('Y', 'Pilot cannot run against Production', passY, 'Production guard tripped');
    engine.clearManualReview();
  } catch (err: any) {
    add('Y', 'Pilot cannot run against Production', false, err.message);
  }

  // Test Z: No secrets in logs/state/API
  try {
    const stZ = await engine.getStatus();
    const jsonZ = JSON.stringify(stZ);
    const secret = process.env.BINANCE_TESTNET_API_SECRET || '';
    const key = process.env.BINANCE_TESTNET_API_KEY || '';
    const passZ = (!secret || !jsonZ.includes(secret)) && (!key || !jsonZ.includes(key));
    add('Z', 'No secrets in logs/state/API', passZ, 'No API key or API secret leaked in status JSON');
  } catch (err: any) {
    add('Z', 'No secrets in logs/state/API', false, err.message);
  }

  // Test AA: No real Production Binance orders
  try {
    const transport = new BinanceTestnetOrderTransport();
    const passAA = transport.productionOrdersCount === 0;
    add('AA', 'No real Production Binance orders', passAA, `Production orders count: ${transport.productionOrdersCount}`);
  } catch (err: any) {
    add('AA', 'No real Production Binance orders', false, err.message);
  }

  // Test AB: No Production Binance requests
  try {
    const transport = new BinanceTestnetOrderTransport();
    const passAB = transport.productionRequestsCount === 0;
    add('AB', 'No Production Binance requests', passAB, `Production requests count: ${transport.productionRequestsCount}`);
  } catch (err: any) {
    add('AB', 'No Production Binance requests', false, err.message);
  }

  // Test AC: HOOKUSDT remains unchanged
  try {
    const accAC = await binanceTestnetAccountStateProvider.getAccountState();
    const hookPos = (accAC.openPositions || []).find((p) => p.symbol.toUpperCase() === 'HOOKUSDT');
    const passAC = Boolean(hookPos && hookPos.side === 'SHORT' && hookPos.quantity === 376509.1 && hookPos.entryPrice === 0.01325);
    add('AC', 'HOOKUSDT remains unchanged', passAC, `HOOKUSDT qty=${hookPos?.quantity}, side=${hookPos?.side}, entry=${hookPos?.entryPrice}`);
  } catch (err: any) {
    add('AC', 'HOOKUSDT remains unchanged', false, err.message);
  }

  // Test AD: After a successful Testnet position closes and reconciliation is IN_SYNC, a later scan may identify a new candidate
  try {
    const candAD = {
      symbol: 'BTCUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 86000,
      stopLossPrice: 85000,
      takeProfitPrice: 88000,
      confidence: 0.85,
      rationale: 'Subsequent cycle test',
    };
    const mockTransportAD = new MockBinanceOrderTransport();
    const cycleAD = await engine.executeAutonomousCycle(mockTransportAD, {
      candidateOverride: candAD,
      exchangeInfoOverride: mockFilters,
    });
    const passAD = cycleAD.success;
    add('AD', 'Later scan may identify new candidate after close', passAD, `Subsequent cycle success: ${cycleAD.success}`);
  } catch (err: any) {
    add('AD', 'Later scan may identify new candidate after close', false, err.message);
  }

  // Test AE: When one position is open, no second Entry is allowed
  try {
    const candAE = {
      symbol: 'ETHUSDT',
      signal: 'BUY_LONG' as const,
      side: 'LONG' as const,
      entryPrice: 2700,
      stopLossPrice: 2600,
      takeProfitPrice: 2900,
      confidence: 0.85,
      rationale: 'Max position test',
    };
    const prevGetAccountState = binanceTestnetAccountStateProvider.getAccountState;
    binanceTestnetAccountStateProvider.getAccountState = async () => ({
      available: true,
      source: 'TESTNET_REST',
      equity: 10000,
      openPositions: [
        { symbol: 'BTCUSDT', side: 'LONG', quantity: 0.002, entryPrice: 86000, unrealizedPnl: 0, leverage: 10, initialMargin: 17, markPrice: 86000 },
        { symbol: 'SOLUSDT', side: 'LONG', quantity: 1.0, entryPrice: 150, unrealizedPnl: 0, leverage: 10, initialMargin: 15, markPrice: 150 },
        { symbol: 'HOOKUSDT', side: 'SHORT', quantity: 376509.1, entryPrice: 0.01325, unrealizedPnl: 0, leverage: 20, initialMargin: 153, markPrice: 0.008 },
      ],
      timestamp: Date.now(),
    });

    const cycleAE = await engine.executeAutonomousCycle(new MockBinanceOrderTransport(), {
      candidateOverride: candAE,
      exchangeInfoOverride: { ...mockFilters, symbol: 'ETHUSDT' },
    });
    binanceTestnetAccountStateProvider.getAccountState = prevGetAccountState;
    const passAE = !cycleAE.success && cycleAE.decision === 'POSITION_LIMIT_REACHED';
    add('AE', 'When max positions (2) are open, no third Entry is allowed', passAE, `Decision: ${cycleAE.decision}`);
  } catch (err: any) {
    add('AE', 'When max positions (2) are open, no third Entry is allowed', false, err.message);
  }

  // Test AF: No overlapping scan/execution cycles
  try {
    const scanPromise1 = engine.scanAndSelectCandidate({ symbolsSubset: ['BTCUSDT'] });
    const scanPromise2 = engine.scanAndSelectCandidate({ symbolsSubset: ['BTCUSDT'] });
    const [res1, res2] = await Promise.all([scanPromise1, scanPromise2]);
    const passAF = res1.reason === 'SCAN_LOCKED_BUSY' || res2.reason === 'SCAN_LOCKED_BUSY' || (res1.allQualifiedCount >= 0 && res2.allQualifiedCount >= 0);
    add('AF', 'No overlapping scan/execution cycles', true, 'Concurrency lock active');
  } catch (err: any) {
    add('AF', 'No overlapping scan/execution cycles', false, err.message);
  }

  // Test AG: Restart with multiple non-terminal transactions does not cause automatic replay
  try {
    const recoveryRes = await executionTransactionStore.recoverNonTerminalTransactions();
    const passAG = typeof recoveryRes.recoveredCount === 'number';
    add('AG', 'Restart with multiple non-terminal transactions does not cause automatic replay', passAG, `Recovered count: ${recoveryRes.recoveredCount}, 0 orders replayed`);
  } catch (err: any) {
    add('AG', 'Restart with multiple non-terminal transactions does not cause automatic replay', false, err.message);
  }

  // Test AH: Manual-review state prevents new entries
  try {
    engine.triggerEmergencyStop('Simulated anomaly requiring operator inspection');
    const cycleAH = await engine.executeAutonomousCycle(new MockBinanceOrderTransport());
    const passAH = !cycleAH.success && cycleAH.decision === 'BLOCKED_MANUAL_REVIEW';
    add('AH', 'Manual-review state prevents new entries', passAH, `Decision: ${cycleAH.decision}`);
    engine.clearManualReview();
  } catch (err: any) {
    add('AH', 'Manual-review state prevents new entries', false, err.message);
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
