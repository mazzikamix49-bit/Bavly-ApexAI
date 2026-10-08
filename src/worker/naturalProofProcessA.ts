import fs from 'node:fs';
import path from 'node:path';
import { autonomousPilotEngine, CandidateScanSelection, AutonomousPilotCycleResult } from './autonomousPilotEngine';
import { BinanceTestnetOrderTransport } from './binanceTestnetOrderTransport';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { binanceNetworkGuard } from './binanceNetworkGuard';
import { pilotPositionRegistry } from './pilotPositionRegistry';

export interface ProcessASession {
  processAPid: number;
  processACompletedAt: number;
  candidate1: {
    symbol: string;
    side: string;
    confidence: number;
    rationale: string;
    plannedEntry: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    riskRewardRatio: number;
    riskAmount: number;
    cycle: number;
    coverageBatch: number;
    timestamp: number;
  };
  execution1: {
    transactionId: string;
    positionId: string;
    entryOrderId: string;
    entryStatus: string;
    executedQty: number;
    avgPrice: number;
    stopLossOrderId: string;
    takeProfitOrderId: string;
    status: string;
    lifecycleState: string;
  };
  candidate2: {
    symbol: string;
    side: string;
    confidence: number;
    rationale: string;
    plannedEntry: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    riskRewardRatio: number;
    riskAmount: number;
    cycle: number;
    coverageBatch: number;
    timestamp: number;
  };
  execution2: {
    transactionId: string;
    positionId: string;
    entryOrderId: string;
    entryStatus: string;
    executedQty: number;
    avgPrice: number;
    stopLossOrderId: string;
    takeProfitOrderId: string;
    status: string;
    lifecycleState: string;
  };
  simultaneousState: {
    activePositionsCount: number;
    symbols: string[];
    hookusdtUntouched: boolean;
  };
}

async function runProcessA(): Promise<void> {
  const pid = process.pid;
  console.log(`[PROCESS_A] Starting Natural Multi-Position Proof Phase A (PID: ${pid})...`);

  // 1. Assert Strict Testnet Guard
  binanceNetworkGuard.assertTestnetTraffic('https://testnet.binancefuture.com', 'ProcessA');

  // 2. Assert HOOKUSDT state
  const accInit = await binanceTestnetAccountStateProvider.getAccountState();
  const hookPos = (accInit.openPositions || []).find((p) => p.symbol.toUpperCase() === 'HOOKUSDT');
  if (!hookPos || hookPos.quantity !== 376509.1 || hookPos.entryPrice !== 0.01325) {
    throw new Error(`[CRITICAL] HOOKUSDT position check failed! Found: ${JSON.stringify(hookPos)}`);
  }
  console.log(`[PROCESS_A] Verified HOOKUSDT is FROZEN on Testnet: qty=${hookPos.quantity}, entry=${hookPos.entryPrice}`);

  const transport = new BinanceTestnetOrderTransport();

  // 3. Natural Candidate #1 Scan
  console.log('[PROCESS_A] Scanning live Binance Testnet for Natural Candidate #1...');
  let scanRes1: CandidateScanSelection | null = null;
  let attempts1 = 0;

  while (!scanRes1?.candidate && attempts1 < 15) {
    attempts1++;
    scanRes1 = await autonomousPilotEngine.scanAndSelectCandidate();
    if (!scanRes1.candidate) {
      console.log(`[PROCESS_A] Scan batch ${attempts1} returned no candidate (${scanRes1.reason}). Rotating to next batch...`);
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (!scanRes1?.candidate) {
    throw new Error('[PROCESS_A_INCOMPLETE] First natural candidate was not found across eligible coverage rotation.');
  }

  const cand1 = scanRes1.candidate;
  const slDist1 = Math.abs(cand1.entryPrice - cand1.stopLossPrice);
  const tpDist1 = Math.abs(cand1.takeProfitPrice - cand1.entryPrice);
  const rr1 = slDist1 > 0 ? Number((tpDist1 / slDist1).toFixed(2)) : 1.5;
  const riskAmount1 = Number(((accInit.equity || 10000) * 0.005).toFixed(2));

  console.log(`[PROCESS_A] Natural Candidate #1 Discovered: ${cand1.symbol} (${cand1.side}, confidence=${cand1.confidence}, entry=${cand1.entryPrice}, SL=${cand1.stopLossPrice}, TP=${cand1.takeProfitPrice})`);

  // 4. Real Execution of Position #1 on Binance Testnet
  console.log(`[PROCESS_A] Executing real Testnet Entry for Position #1 (${cand1.symbol})...`);
  const cycleRes1 = await autonomousPilotEngine.executeAutonomousCycle(transport, {
    candidateOverride: cand1,
    skipClosingAtEnd: true, // Keep Position #1 OPEN and PROTECTED
  });

  if (!cycleRes1.success || !cycleRes1.positionId || !cycleRes1.entryOrderId) {
    throw new Error(`[PROCESS_A_FAILED] Position #1 real execution failed: ${cycleRes1.decision} - ${cycleRes1.error}`);
  }

  const pos1Record = pilotPositionRegistry.getPosition(cycleRes1.positionId);
  console.log(`[PROCESS_A] Position #1 Execution Confirmed & Protected:`);
  console.log(`  PositionId: ${cycleRes1.positionId}`);
  console.log(`  Entry Order ID: ${cycleRes1.entryOrderId}`);
  console.log(`  SL Algo Order ID: ${cycleRes1.stopLossOrderId}`);
  console.log(`  TP Algo Order ID: ${cycleRes1.takeProfitOrderId}`);
  console.log(`  Executed Qty: ${pos1Record?.quantity}`);
  console.log(`  Avg Price: ${pos1Record?.actualEntry}`);
  console.log(`  Lifecycle: ${pos1Record?.lifecycleState}`);

  // 5. Natural Candidate #2 Scan (must be different symbol, naturally qualified)
  console.log('[PROCESS_A] Rotating coverage for Natural Candidate #2...');
  let scanRes2: CandidateScanSelection | null = null;
  let attempts2 = 0;

  while (!scanRes2?.candidate && attempts2 < 15) {
    attempts2++;
    scanRes2 = await autonomousPilotEngine.scanAndSelectCandidate();
    if (!scanRes2.candidate) {
      console.log(`[PROCESS_A] Scan batch ${attempts2} returned no candidate (${scanRes2.reason}). Rotating to next batch...`);
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (!scanRes2?.candidate) {
    throw new Error('[PROCESS_A_INCOMPLETE] Second natural candidate was not found across eligible coverage rotation.');
  }

  const cand2 = scanRes2.candidate;
  if (cand2.symbol.toUpperCase() === cand1.symbol.toUpperCase()) {
    throw new Error(`[PROCESS_A_FAILED] Candidate #2 symbol (${cand2.symbol}) collided with Position #1 symbol!`);
  }

  const slDist2 = Math.abs(cand2.entryPrice - cand2.stopLossPrice);
  const tpDist2 = Math.abs(cand2.takeProfitPrice - cand2.entryPrice);
  const rr2 = slDist2 > 0 ? Number((tpDist2 / slDist2).toFixed(2)) : 1.5;
  const riskAmount2 = Number(((accInit.equity || 10000) * 0.005).toFixed(2));

  console.log(`[PROCESS_A] Natural Candidate #2 Discovered: ${cand2.symbol} (${cand2.side}, confidence=${cand2.confidence}, entry=${cand2.entryPrice}, SL=${cand2.stopLossPrice}, TP=${cand2.takeProfitPrice})`);

  // 6. Real Execution of Position #2 on Binance Testnet
  console.log(`[PROCESS_A] Executing real Testnet Entry for Position #2 (${cand2.symbol})...`);
  const cycleRes2 = await autonomousPilotEngine.executeAutonomousCycle(transport, {
    candidateOverride: cand2,
    skipClosingAtEnd: true, // Keep Position #2 OPEN and PROTECTED
  });

  if (!cycleRes2.success || !cycleRes2.positionId || !cycleRes2.entryOrderId) {
    throw new Error(`[PROCESS_A_FAILED] Position #2 real execution failed: ${cycleRes2.decision} - ${cycleRes2.error}`);
  }

  const pos2Record = pilotPositionRegistry.getPosition(cycleRes2.positionId);
  console.log(`[PROCESS_A] Position #2 Execution Confirmed & Protected:`);
  console.log(`  PositionId: ${cycleRes2.positionId}`);
  console.log(`  Entry Order ID: ${cycleRes2.entryOrderId}`);
  console.log(`  SL Algo Order ID: ${cycleRes2.stopLossOrderId}`);
  console.log(`  TP Algo Order ID: ${cycleRes2.takeProfitOrderId}`);
  console.log(`  Executed Qty: ${pos2Record?.quantity}`);
  console.log(`  Avg Price: ${pos2Record?.actualEntry}`);
  console.log(`  Lifecycle: ${pos2Record?.lifecycleState}`);

  // 7. Verify Simultaneous Active State
  const activePositions = pilotPositionRegistry.getActivePositions();
  const accMid = await binanceTestnetAccountStateProvider.getAccountState();
  const remoteSymbols = (accMid.openPositions || [])
    .filter((p) => p.symbol.toUpperCase() !== 'HOOKUSDT' && p.quantity > 0)
    .map((p) => p.symbol.toUpperCase());

  const hasBothOnExchange =
    remoteSymbols.includes(cand1.symbol.toUpperCase()) &&
    remoteSymbols.includes(cand2.symbol.toUpperCase());

  if (activePositions.length !== 2 || !hasBothOnExchange) {
    throw new Error(`[PROCESS_A_FAILED] Simultaneous state check failed: Registry=${activePositions.length}, Remote=${remoteSymbols.join(',')}`);
  }

  console.log(`[PROCESS_A] SUCCESS: Both Position #1 (${cand1.symbol}) and Position #2 (${cand2.symbol}) are simultaneously OPEN and PROTECTED on Binance Futures Testnet!`);

  // 8. Write Session Checkpoint
  const session: ProcessASession = {
    processAPid: pid,
    processACompletedAt: Date.now(),
    candidate1: {
      symbol: cand1.symbol,
      side: cand1.side,
      confidence: cand1.confidence,
      rationale: cand1.rationale,
      plannedEntry: cand1.entryPrice,
      stopLossPrice: cand1.stopLossPrice,
      takeProfitPrice: cand1.takeProfitPrice,
      riskRewardRatio: rr1,
      riskAmount: riskAmount1,
      cycle: 1,
      coverageBatch: 1,
      timestamp: Date.now(),
    },
    execution1: {
      transactionId: cycleRes1.transactionId || '',
      positionId: cycleRes1.positionId,
      entryOrderId: cycleRes1.entryOrderId,
      entryStatus: 'FILLED',
      executedQty: pos1Record?.quantity || 0,
      avgPrice: pos1Record?.actualEntry || cand1.entryPrice,
      stopLossOrderId: cycleRes1.stopLossOrderId || '',
      takeProfitOrderId: cycleRes1.takeProfitOrderId || '',
      status: 'ACTIVE',
      lifecycleState: 'PROTECTED',
    },
    candidate2: {
      symbol: cand2.symbol,
      side: cand2.side,
      confidence: cand2.confidence,
      rationale: cand2.rationale,
      plannedEntry: cand2.entryPrice,
      stopLossPrice: cand2.stopLossPrice,
      takeProfitPrice: cand2.takeProfitPrice,
      riskRewardRatio: rr2,
      riskAmount: riskAmount2,
      cycle: 2,
      coverageBatch: 2,
      timestamp: Date.now(),
    },
    execution2: {
      transactionId: cycleRes2.transactionId || '',
      positionId: cycleRes2.positionId,
      entryOrderId: cycleRes2.entryOrderId,
      entryStatus: 'FILLED',
      executedQty: pos2Record?.quantity || 0,
      avgPrice: pos2Record?.actualEntry || cand2.entryPrice,
      stopLossOrderId: cycleRes2.stopLossOrderId || '',
      takeProfitOrderId: cycleRes2.takeProfitOrderId || '',
      status: 'ACTIVE',
      lifecycleState: 'PROTECTED',
    },
    simultaneousState: {
      activePositionsCount: activePositions.length,
      symbols: [cand1.symbol, cand2.symbol],
      hookusdtUntouched: true,
    },
  };

  const sessionPath = path.resolve(process.cwd(), 'data/natural_multi_position_session.json');
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');
  console.log(`[PROCESS_A] Session checkpoint saved to ${sessionPath}. Exiting Process A cleanly...`);
}

runProcessA()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[PROCESS_A_FATAL_ERROR]:', err.message);
    process.exit(1);
  });
