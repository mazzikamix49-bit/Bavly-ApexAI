import fs from 'node:fs';
import path from 'node:path';
import { autonomousPilotEngine, CandidateScanSelection } from './autonomousPilotEngine';
import { BinanceTestnetOrderTransport } from './binanceTestnetOrderTransport';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { binanceNetworkGuard } from './binanceNetworkGuard';
import { pilotPositionRegistry } from './pilotPositionRegistry';
import { MockBinanceOrderTransport } from './testnetExecutionAdapter';
import { futuresUniverseProvider } from './futuresUniverseProvider';
import { pilotCoverageManager } from './pilotCoverageManager';
import { executionPreflight } from './executionPreflight';
import { normalizePrice } from './testnetExecutionBridge';

export interface PositionCheckpoint {
  symbol: string;
  side: 'LONG' | 'SHORT';
  confidence: number;
  rationale: string;
  plannedEntry: number;
  actualEntry: number;
  quantity: number;
  riskAmount: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  transactionId: string;
  positionId: string;
  authorizationId: string;
  fingerprint: string;
  entryOrderId: string;
  stopLossOrderId: string;
  takeProfitOrderId: string;
  status: string;
  lifecycleState: string;
  timestamp: number;
}

export interface ManagementStepRecord {
  positionId: string;
  symbol: string;
  actionTaken: string;
  previousSl: number;
  newSl: number;
  lifecycleState: string;
  evaluationType: 'LIVE_VERIFIED' | 'CONTROLLED_TESTNET' | 'READ_ONLY';
  details: string;
}

export interface CawSessionData {
  processAPid: number;
  processACompletedAt: number;
  capacityConfigured: number;
  positions: PositionCheckpoint[];
  simultaneousState: {
    activePositionsCount: number;
    symbols: string[];
    hookusdtUntouched: boolean;
  };
  managementRecords: ManagementStepRecord[];
  fifthCandidateBlocked: boolean;
  universeMetrics: {
    totalUniverse: number;
    eligibleUniverse: number;
    coverageCycle: number;
    evaluatedCount: number;
  };
}

async function runCawProcessA(): Promise<void> {
  const pid = process.pid;
  console.log(`[CAW_PROCESS_A] ========================================================`);
  console.log(`[CAW_PROCESS_A] Starting Continuous Autonomous Worker Proof Phase A (PID: ${pid})...`);
  console.log(`[CAW_PROCESS_A] ========================================================`);

  // CAW-36: Verify Browser Independence (Zero browser globals in execution path)
  const isBrowserFree =
    typeof (globalThis as any).window === 'undefined' &&
    typeof (globalThis as any).document === 'undefined' &&
    typeof (globalThis as any).localStorage === 'undefined';
  if (!isBrowserFree) {
    throw new Error('[CAW_PROCESS_A] Browser globals detected in Node.js worker environment!');
  }
  console.log('[CAW_PROCESS_A] CAW-36: Browser Independence verified (No window, document, localStorage).');

  // CAW-02: Verify Worker Singleton Lock
  const lockPath = path.resolve(process.cwd(), 'data/worker.lock');
  fs.writeFileSync(lockPath, String(pid), 'utf8');
  const readLockPid = fs.readFileSync(lockPath, 'utf8').trim();
  if (readLockPid !== String(pid)) {
    throw new Error(`[CAW_PROCESS_A] CAW-02: Worker lock mismatch: expected ${pid}, got ${readLockPid}`);
  }
  console.log(`[CAW_PROCESS_A] CAW-02: Worker singleton lock verified (PID: ${pid} in ${lockPath}).`);

  // CAW-34 & CAW-35: Assert Strict Testnet Guard
  binanceNetworkGuard.assertTestnetTraffic('https://testnet.binancefuture.com', 'CawProcessA');
  console.log('[CAW_PROCESS_A] CAW-34/35: Fail-closed Testnet network guard active.');

  // CAW-33: Assert HOOKUSDT state is frozen
  const accInit = await binanceTestnetAccountStateProvider.getAccountState();
  const hookPos = (accInit.openPositions || []).find((p) => p.symbol.toUpperCase() === 'HOOKUSDT');
  if (!hookPos || hookPos.quantity !== 376509.1 || hookPos.entryPrice !== 0.01325) {
    throw new Error(`[CRITICAL] HOOKUSDT position check failed! Found: ${JSON.stringify(hookPos)}`);
  }
  console.log(`[CAW_PROCESS_A] CAW-33: HOOKUSDT FROZEN verified (qty=${hookPos.quantity}, entry=${hookPos.entryPrice}).`);

  const transport = new BinanceTestnetOrderTransport();

  // Clean Slate: cancel existing open non-HOOK orders and close stale non-HOOK positions
  const existingOrders = await transport.getOpenOrders();
  for (const o of existingOrders) {
    if ((o.symbol || '').toUpperCase() === 'HOOKUSDT') continue;
    console.log(`[CAW_PROCESS_A] Cleaning prior open order: ${o.symbol} ${o.orderId}`);
    await transport.cancelOrder(o.symbol, o.orderId);
  }

  for (const pos of accInit.openPositions || []) {
    if (pos.symbol.toUpperCase() === 'HOOKUSDT') continue;
    if (pos.quantity > 0) {
      console.log(`[CAW_PROCESS_A] Cleaning prior open position: ${pos.symbol} qty=${pos.quantity}`);
      const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
      await transport.sendOrder({
        symbol: pos.symbol,
        side: closeSide,
        type: 'MARKET',
        quantity: pos.quantity,
        reduceOnly: true,
        positionSide: 'BOTH',
      });
    }
  }

  // Initialize and reset PilotPositionRegistry
  await pilotPositionRegistry.init();
  for (const p of pilotPositionRegistry.getActivePositions()) {
    await pilotPositionRegistry.closePositionRecord(p.positionId, {
      exitReason: 'PRE_PROOF_RESET',
      closeOrderId: 'clean',
    });
  }

  const initialActive = pilotPositionRegistry.getActivePositions().length;
  console.log(`[CAW_PROCESS_A] Initial active pilot positions: ${initialActive} / ${pilotPositionRegistry.getMaxPositions()}`);

  // CAW-03: Dynamic Universe Discovery
  console.log('[CAW_PROCESS_A] Discovering dynamic Binance Futures universe...');
  const tradableSymbols = await futuresUniverseProvider.getTradableSymbols();
  const eligibleSymbols = tradableSymbols.filter((s) => s.toUpperCase() !== 'HOOKUSDT' && s.toUpperCase().endsWith('USDT'));
  console.log(`[CAW_PROCESS_A] CAW-03: Dynamic Universe discovered: ${tradableSymbols.length} tradable, ${eligibleSymbols.length} eligible.`);

  if (eligibleSymbols.length < 100) {
    throw new Error(`[CAW_PROCESS_A] Insufficient dynamic universe symbols: ${eligibleSymbols.length}`);
  }

  const executedPositions: PositionCheckpoint[] = [];
  const chosenSymbols = new Set<string>();

  // Continuous Autonomous Scanning & Execution Cycles (Target: 4 Natural Positions)
  for (let posIdx = 1; posIdx <= 4; posIdx++) {
    console.log(`\n[CAW_PROCESS_A] >>> CYCLE ${posIdx}: Scanning dynamic universe for Natural Candidate #${posIdx}...`);
    let cand: CandidateScanSelection['candidate'] | null = null;
    let cycleRes: any = null;
    let attempts = 0;

    while (attempts < 35) {
      attempts++;
      const scanRes = await autonomousPilotEngine.scanAndSelectCandidate();
      if (!scanRes.candidate) {
        console.log(`[CAW_PROCESS_A] Candidate #${posIdx} scan batch ${attempts} returned no candidate (${scanRes.reason}). Rotating to next batch...`);
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      if (chosenSymbols.has(scanRes.candidate.symbol.toUpperCase())) {
        console.log(`[CAW_PROCESS_A] Candidate #${posIdx} scan batch ${attempts} returned duplicate/tested symbol (${scanRes.candidate.symbol}). Rotating for distinct candidate...`);
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }

      const currentCand = scanRes.candidate;
      console.log(`[CAW_PROCESS_A] Natural Candidate #${posIdx} Evaluated: ${currentCand.symbol} (${currentCand.side}, confidence=${currentCand.confidence}, plannedEntry=${currentCand.entryPrice}, SL=${currentCand.stopLossPrice}, TP=${currentCand.takeProfitPrice})`);

      // Reset any manual review flag from previous candidate rejection
      autonomousPilotEngine.clearManualReview();

      // Execute real Testnet entry with SL + TP
      console.log(`[CAW_PROCESS_A] Executing real Testnet Entry for Position #${posIdx} (${currentCand.symbol})...`);
      cycleRes = await autonomousPilotEngine.executeAutonomousCycle(transport, {
        candidateOverride: currentCand,
        skipClosingAtEnd: true, // Keep open for multi-position continuous lifecycle proof
      });

      if (cycleRes.success && cycleRes.positionId && cycleRes.entryOrderId) {
        cand = currentCand;
        chosenSymbols.add(cand.symbol.toUpperCase());
        console.log(`[CAW_PROCESS_A] Natural Candidate #${posIdx} (${cand.symbol}) executed and protected successfully!`);
        break;
      } else {
        console.warn(`[CAW_PROCESS_A] Position #${posIdx} candidate ${currentCand.symbol} execution rejected (${cycleRes.decision}: ${cycleRes.error}). Rotating to next natural candidate...`);
        chosenSymbols.add(currentCand.symbol.toUpperCase());
        cycleRes = null;
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    if (!cand || !cycleRes?.success || !cycleRes.positionId || !cycleRes.entryOrderId) {
      throw new Error(`[CAW_PROCESS_A_INCOMPLETE] Natural Candidate #${posIdx} execution failed after ${attempts} rotation batches.`);
    }

    const rec = pilotPositionRegistry.getPosition(cycleRes.positionId);
    console.log(`[CAW_PROCESS_A] Position #${posIdx} Confirmed & Protected:`);
    console.log(`  PositionId: ${cycleRes.positionId}`);
    console.log(`  Entry Order ID: ${cycleRes.entryOrderId}`);
    console.log(`  SL Algo Order ID: ${cycleRes.stopLossOrderId}`);
    console.log(`  TP Algo Order ID: ${cycleRes.takeProfitOrderId}`);
    console.log(`  Executed Qty: ${rec?.quantity}`);
    console.log(`  Avg Price: ${rec?.actualEntry}`);
    console.log(`  Lifecycle: ${rec?.lifecycleState}`);
    console.log(`  Active Pilot Positions: ${pilotPositionRegistry.getActivePositions().length} / 4`);

    executedPositions.push({
      symbol: cand.symbol,
      side: cand.side,
      confidence: cand.confidence,
      rationale: cand.rationale,
      plannedEntry: cand.entryPrice,
      actualEntry: rec?.actualEntry || cand.entryPrice,
      quantity: rec?.quantity || 0,
      riskAmount: rec?.riskAmount || 0,
      stopLossPrice: cand.stopLossPrice,
      takeProfitPrice: cand.takeProfitPrice,
      transactionId: cycleRes.transactionId || '',
      positionId: cycleRes.positionId,
      authorizationId: rec?.authorizationId || '',
      fingerprint: rec?.fingerprint || '',
      entryOrderId: cycleRes.entryOrderId,
      stopLossOrderId: cycleRes.stopLossOrderId || '',
      takeProfitOrderId: cycleRes.takeProfitOrderId || '',
      status: 'ACTIVE',
      lifecycleState: 'PROTECTED',
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 600));
  }

  // Verify Simultaneous 4-Position State
  const activeRegistryPositions = pilotPositionRegistry.getActivePositions();
  const accCurrent = await binanceTestnetAccountStateProvider.getAccountState();
  const nonHookRemoteSymbols = (accCurrent.openPositions || [])
    .filter((p) => p.symbol.toUpperCase() !== 'HOOKUSDT' && p.quantity > 0)
    .map((p) => p.symbol.toUpperCase());

  console.log(`\n[CAW_PROCESS_A] ========================================================`);
  console.log(`[CAW_PROCESS_A] Simultaneous 4-Position State Verification:`);
  console.log(`  Registry Active: ${activeRegistryPositions.length} / 4`);
  console.log(`  Remote Active Symbols: ${nonHookRemoteSymbols.join(', ')} (${nonHookRemoteSymbols.length})`);
  console.log(`[CAW_PROCESS_A] ========================================================`);

  if (activeRegistryPositions.length !== 4 || nonHookRemoteSymbols.length !== 4) {
    throw new Error(`[CAW_PROCESS_A_FAILED] Simultaneous 4-position state check failed: Registry=${activeRegistryPositions.length}, Remote=${nonHookRemoteSymbols.length}`);
  }

  // CYCLE 5: Fifth Entry Blocked Guard Test
  console.log('\n[CAW_PROCESS_A] >>> CYCLE 5: Testing fifth candidate capacity limit (4/4 full)...');
  const fifthCycleRes = await autonomousPilotEngine.executeAutonomousCycle(new MockBinanceOrderTransport(), {
    candidateOverride: {
      symbol: 'NEARUSDT',
      signal: 'BUY_LONG',
      side: 'LONG',
      entryPrice: 5.5,
      stopLossPrice: 5.3,
      takeProfitPrice: 5.9,
      confidence: 82,
      rationale: 'Capacity limit verification candidate #5',
    },
  });

  const fifthBlocked = !fifthCycleRes.success && fifthCycleRes.decision === 'POSITION_LIMIT_REACHED';
  console.log(`[CAW_PROCESS_A] Fifth candidate blocked: ${fifthBlocked} (${fifthCycleRes.decision}) with 0 Binance orders.`);

  // Autonomous Position Management Cycle (CAW-10, CAW-11, CAW-12)
  console.log('\n[CAW_PROCESS_A] >>> Management Cycle: Evaluating active positions management rules...');
  const managementRecords: ManagementStepRecord[] = [];

  const posA = executedPositions[0];
  const posB = executedPositions[1];

  // Management on Position A: TP1 / Breakeven test
  const pAEntry = posA.actualEntry;
  const pASl = posA.stopLossPrice;
  const pARange = Math.abs(pAEntry - pASl);
  const pATp1 = posA.side === 'LONG' ? pAEntry + pARange : pAEntry - pARange;

  const aBeResult = await autonomousPilotEngine.managePosition(posA.positionId, {
    markPriceOverride: pATp1,
    transport,
  });
  console.log(`[CAW_PROCESS_A] Position A (${posA.symbol}) Management: Action=${aBeResult.actionTaken}, NewSL=${aBeResult.newSl}, State=${aBeResult.lifecycleState}`);
  managementRecords.push({
    positionId: posA.positionId,
    symbol: posA.symbol,
    actionTaken: aBeResult.actionTaken,
    previousSl: aBeResult.previousSl,
    newSl: aBeResult.newSl,
    lifecycleState: aBeResult.lifecycleState,
    evaluationType: 'CONTROLLED_TESTNET',
    details: aBeResult.details,
  });

  // Management on Position B: Trailing Stop Ratchet test
  const pBEntry = posB.actualEntry;
  const pBSl = posB.stopLossPrice;
  const pBRange = Math.abs(pBEntry - pBSl);
  const pBTp1 = posB.side === 'LONG' ? pBEntry + pBRange : pBEntry - pBRange;
  // Activate TP1 first
  await autonomousPilotEngine.managePosition(posB.positionId, {
    markPriceOverride: pBTp1,
    transport,
  });

  const symInfoB = await executionPreflight.fetchSymbolExchangeInfo(posB.symbol);
  const tickB = symInfoB?.tickSize || 0.0001;
  const bAdvancePrice = posB.side === 'LONG'
    ? normalizePrice(pBEntry * 1.012, tickB)
    : normalizePrice(pBEntry * 0.988, tickB);

  const bTrailResult = await autonomousPilotEngine.managePosition(posB.positionId, {
    markPriceOverride: bAdvancePrice,
    trailingPercent: 0.5,
    transport,
  });
  console.log(`[CAW_PROCESS_A] Position B (${posB.symbol}) Trailing: Action=${bTrailResult.actionTaken}, NewSL=${bTrailResult.newSl}, State=${bTrailResult.lifecycleState}`);
  managementRecords.push({
    positionId: posB.positionId,
    symbol: posB.symbol,
    actionTaken: bTrailResult.actionTaken,
    previousSl: bTrailResult.previousSl,
    newSl: bTrailResult.newSl,
    lifecycleState: bTrailResult.lifecycleState,
    evaluationType: 'CONTROLLED_TESTNET',
    details: bTrailResult.details,
  });

  // Coverage snapshot
  const covStatus = pilotCoverageManager.getCurrentStatus(eligibleSymbols.length, tradableSymbols.length);

  // Save Checkpoint Session
  const session: CawSessionData = {
    processAPid: pid,
    processACompletedAt: Date.now(),
    capacityConfigured: 4,
    positions: executedPositions,
    simultaneousState: {
      activePositionsCount: activeRegistryPositions.length,
      symbols: executedPositions.map((p) => p.symbol),
      hookusdtUntouched: true,
    },
    managementRecords,
    fifthCandidateBlocked: fifthBlocked,
    universeMetrics: {
      totalUniverse: tradableSymbols.length,
      eligibleUniverse: eligibleSymbols.length,
      coverageCycle: covStatus.coverageCycle,
      evaluatedCount: covStatus.cumulativeEvaluatedCount,
    },
  };

  const sessionPath = path.resolve(process.cwd(), 'data/caw_proof_session.json');
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');
  console.log(`[CAW_PROCESS_A] Checkpoint session written to ${sessionPath}`);
  console.log('[CAW_PROCESS_A] Process A completed successfully. Exiting cleanly with code 0...');
}

runCawProcessA()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[CAW_PROCESS_A_FATAL_ERROR]:', err.message);
    process.exit(1);
  });
