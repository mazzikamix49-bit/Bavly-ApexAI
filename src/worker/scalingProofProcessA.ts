import fs from 'node:fs';
import path from 'node:path';
import { autonomousPilotEngine, CandidateScanSelection } from './autonomousPilotEngine';
import { BinanceTestnetOrderTransport } from './binanceTestnetOrderTransport';
import { binanceTestnetAccountStateProvider } from './binanceTestnetAccountStateProvider';
import { binanceNetworkGuard } from './binanceNetworkGuard';
import { pilotPositionRegistry } from './pilotPositionRegistry';

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

export interface ScalingProcessASession {
  processAPid: number;
  processACompletedAt: number;
  capacityConfigured: number;
  positions: PositionCheckpoint[];
  simultaneousState: {
    activePositionsCount: number;
    symbols: string[];
    hookusdtUntouched: boolean;
  };
}

async function runScalingProcessA(): Promise<void> {
  const pid = process.pid;
  console.log(`[PROCESS_A] Starting Multi-Position Continuous Autonomous Scaling Proof Phase A (PID: ${pid})...`);

  // 1. Assert Strict Testnet Guard
  binanceNetworkGuard.assertTestnetTraffic('https://testnet.binancefuture.com', 'ScalingProcessA');

  // 2. Assert HOOKUSDT state
  const accInit = await binanceTestnetAccountStateProvider.getAccountState();
  const hookPos = (accInit.openPositions || []).find((p) => p.symbol.toUpperCase() === 'HOOKUSDT');
  if (!hookPos || hookPos.quantity !== 376509.1 || hookPos.entryPrice !== 0.01325) {
    throw new Error(`[CRITICAL] HOOKUSDT position check failed! Found: ${JSON.stringify(hookPos)}`);
  }
  console.log(`[PROCESS_A] Verified HOOKUSDT is FROZEN on Testnet: qty=${hookPos.quantity}, entry=${hookPos.entryPrice}`);

  const transport = new BinanceTestnetOrderTransport();

  // 3. Ensure Clean Slate for non-HOOK positions and open orders
  const existingOrders = await transport.getOpenOrders();
  for (const o of existingOrders) {
    if ((o.symbol || '').toUpperCase() === 'HOOKUSDT') continue;
    console.log(`[PROCESS_A] Cleaning prior open order: ${o.symbol} ${o.orderId}`);
    await transport.cancelOrder(o.symbol, o.orderId);
  }

  for (const pos of accInit.openPositions || []) {
    if (pos.symbol.toUpperCase() === 'HOOKUSDT') continue;
    if (pos.quantity > 0) {
      console.log(`[PROCESS_A] Cleaning prior open position: ${pos.symbol} qty=${pos.quantity}`);
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

  await pilotPositionRegistry.init();
  for (const p of pilotPositionRegistry.getActivePositions()) {
    await pilotPositionRegistry.closePositionRecord(p.positionId, {
      exitReason: 'PRE_PROOF_RESET',
      closeOrderId: 'clean',
    });
  }

  const initialActive = pilotPositionRegistry.getActivePositions().length;
  console.log(`[PROCESS_A] Initial active pilot positions: ${initialActive} / ${pilotPositionRegistry.getMaxPositions()}`);

  const executedPositions: PositionCheckpoint[] = [];
  const chosenSymbols = new Set<string>();

  // 4. Sequential Discovery and Execution of 4 Natural Qualified Candidates
  for (let posIdx = 1; posIdx <= 4; posIdx++) {
    console.log(`\n[PROCESS_A] >>> Scanning dynamic universe for Natural Candidate #${posIdx}...`);
    let scanRes: CandidateScanSelection | null = null;
    let attempts = 0;

    while (attempts < 25) {
      attempts++;
      scanRes = await autonomousPilotEngine.scanAndSelectCandidate();
      if (!scanRes.candidate) {
        console.log(`[PROCESS_A] Candidate #${posIdx} scan batch ${attempts} returned no candidate (${scanRes.reason}). Rotating to next batch...`);
        await new Promise((r) => setTimeout(r, 600));
      } else if (chosenSymbols.has(scanRes.candidate.symbol.toUpperCase())) {
        console.log(`[PROCESS_A] Candidate #${posIdx} scan batch ${attempts} returned duplicate symbol (${scanRes.candidate.symbol}). Rotating for distinct candidate...`);
        scanRes = null;
        await new Promise((r) => setTimeout(r, 600));
      } else {
        break;
      }
    }

    if (!scanRes?.candidate) {
      throw new Error(`[PROCESS_A_INCOMPLETE] Natural Candidate #${posIdx} not found after ${attempts} rotation batches.`);
    }

    const cand = scanRes.candidate;
    chosenSymbols.add(cand.symbol.toUpperCase());
    console.log(`[PROCESS_A] Natural Candidate #${posIdx} Discovered: ${cand.symbol} (${cand.side}, confidence=${cand.confidence}, entry=${cand.entryPrice}, SL=${cand.stopLossPrice}, TP=${cand.takeProfitPrice})`);

    // Execute real Testnet entry with SL + TP
    console.log(`[PROCESS_A] Executing real Testnet Entry for Position #${posIdx} (${cand.symbol})...`);
    const cycleRes = await autonomousPilotEngine.executeAutonomousCycle(transport, {
      candidateOverride: cand,
      skipClosingAtEnd: true, // Keep open and protected for 4-position simultaneous scaling proof
    });

    if (!cycleRes.success || !cycleRes.positionId || !cycleRes.entryOrderId) {
      throw new Error(`[PROCESS_A_FAILED] Position #${posIdx} execution failed: ${cycleRes.decision} - ${cycleRes.error}`);
    }

    const rec = pilotPositionRegistry.getPosition(cycleRes.positionId);
    console.log(`[PROCESS_A] Position #${posIdx} Confirmed & Protected:`);
    console.log(`  PositionId: ${cycleRes.positionId}`);
    console.log(`  Entry Order ID: ${cycleRes.entryOrderId}`);
    console.log(`  SL Algo Order ID: ${cycleRes.stopLossOrderId}`);
    console.log(`  TP Algo Order ID: ${cycleRes.takeProfitOrderId}`);
    console.log(`  Executed Qty: ${rec?.quantity}`);
    console.log(`  Avg Price: ${rec?.actualEntry}`);
    console.log(`  Lifecycle: ${rec?.lifecycleState}`);
    console.log(`  Active Pilot Positions: ${pilotPositionRegistry.getActivePositions().length}/4`);

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

    // Short pause between cycles
    await new Promise((r) => setTimeout(r, 500));
  }

  // 5. Verify Simultaneous 4-Position State
  const activeRegistryPositions = pilotPositionRegistry.getActivePositions();
  const accCurrent = await binanceTestnetAccountStateProvider.getAccountState();
  const nonHookRemoteSymbols = (accCurrent.openPositions || [])
    .filter((p) => p.symbol.toUpperCase() !== 'HOOKUSDT' && p.quantity > 0)
    .map((p) => p.symbol.toUpperCase());

  console.log(`\n[PROCESS_A] ========================================================`);
  console.log(`[PROCESS_A] Simultaneous 4-Position Verification:`);
  console.log(`  Registry Active: ${activeRegistryPositions.length} / 4`);
  console.log(`  Remote Active Symbols: ${nonHookRemoteSymbols.join(', ')} (${nonHookRemoteSymbols.length})`);
  console.log(`[PROCESS_A] ========================================================`);

  const allSymbolsPresent = executedPositions.every((p) => nonHookRemoteSymbols.includes(p.symbol.toUpperCase()));
  if (activeRegistryPositions.length !== 4 || nonHookRemoteSymbols.length !== 4 || !allSymbolsPresent) {
    throw new Error(`[PROCESS_A_FAILED] Simultaneous 4-position state check failed: Registry=${activeRegistryPositions.length}, Remote=${nonHookRemoteSymbols.length}`);
  }

  // 6. Save Checkpoint Session
  const session: ScalingProcessASession = {
    processAPid: pid,
    processACompletedAt: Date.now(),
    capacityConfigured: 4,
    positions: executedPositions,
    simultaneousState: {
      activePositionsCount: activeRegistryPositions.length,
      symbols: executedPositions.map((p) => p.symbol),
      hookusdtUntouched: true,
    },
  };

  const sessionPath = path.resolve(process.cwd(), 'data/scaling_proof_session.json');
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');
  console.log(`[PROCESS_A] Scaling proof session checkpoint saved to ${sessionPath}`);
  console.log('[PROCESS_A] Process A completed successfully. Exiting cleanly with code 0...');
}

runScalingProcessA()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[PROCESS_A_FATAL_ERROR]:', err.message);
    process.exit(1);
  });
