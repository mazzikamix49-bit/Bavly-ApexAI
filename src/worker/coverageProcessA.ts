/**
 * Coverage Process A
 *
 * First phase of the multi-process Coverage & Restart Proof.
 * Discovers the dynamic universe from Binance Futures Testnet,
 * initializes persistent coverage rotation at cursor 0,
 * evaluates Batches 1 to 5 (symbols 0 to 249) using live Testnet 15m klines
 * and StrategyEngine.evaluateCandidate, saves state to disk, and TERMINATES.
 */

import fs from 'node:fs';
import path from 'node:path';
import { futuresUniverseProvider } from './futuresUniverseProvider';
import { serverMarketDataProvider } from './serverMarketDataProvider';
import { strategyEngine } from '../services/strategyEngine';
import { pilotCoverageManager } from './pilotCoverageManager';
import { binanceNetworkGuard } from './binanceNetworkGuard';
import { Candle } from '../types/trading';

const AUDIT_SESSION_FILE = path.resolve(process.cwd(), 'data', 'coverage_audit_session.json');

async function evaluateBatchInParallel(
  batchSymbols: string[],
  pairsMap: Map<string, any>
): Promise<{ evaluated: string[]; hookEvaluated: number }> {
  let hookEvaluated = 0;
  const chunkSize = 10;
  const evaluated: string[] = [];

  for (let i = 0; i < batchSymbols.length; i += chunkSize) {
    const chunk = batchSymbols.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (symbol) => {
        if (symbol.toUpperCase() === 'HOOKUSDT') {
          hookEvaluated++;
          return;
        }

        const pair = pairsMap.get(symbol.toUpperCase());
        if (!pair) return;

        let klines: Candle[] = [];
        try {
          klines = await serverMarketDataProvider.getKlines(symbol, '15m', 35);
        } catch {
          klines = [];
        }

        strategyEngine.evaluateCandidate(pair, klines, []);
        evaluated.push(symbol);
      })
    );
  }

  return { evaluated, hookEvaluated };
}

async function main() {
  const pid = process.pid;
  console.log(`[PROCESS_A] Booted with PID: ${pid}`);

  // 1. Discover Universe dynamically from Binance Testnet
  const tradable = await futuresUniverseProvider.getTradableSymbols(true);
  const eligible = tradable.filter(
    (s) => s.toUpperCase() !== 'HOOKUSDT' && s.toUpperCase().endsWith('USDT')
  );

  console.log(`[PROCESS_A] Discovered: ${tradable.length} symbols | Eligible: ${eligible.length}`);

  // 2. Fetch full 24h market snapshot from Testnet
  const snapshot = await serverMarketDataProvider.getMarketSnapshot(eligible);
  const pairsMap = new Map<string, any>();
  for (const p of snapshot.pairs) {
    if (p && p.symbol) {
      pairsMap.set(p.symbol.toUpperCase(), p);
    }
  }

  // 3. Reset coverage manager to clean start (cursor 0, cycle 1)
  pilotCoverageManager.resetState();

  const uniqueEvaluated = new Set<string>();
  let hookusdtEvaluated = 0;
  const batchesToRun = 5; // Batches 1 to 5 = 250 symbols
  const batchSize = 50;

  console.log(`[PROCESS_A] Executing first ${batchesToRun} batches before planned process shutdown...`);

  for (let b = 1; b <= batchesToRun; b++) {
    const batchSel = pilotCoverageManager.selectNextBatch(eligible, tradable.length, batchSize);
    const { evaluated, hookEvaluated } = await evaluateBatchInParallel(batchSel.batchSymbols, pairsMap);

    for (const sym of evaluated) {
      uniqueEvaluated.add(sym);
    }
    hookusdtEvaluated += hookEvaluated;

    console.log(
      `[PROCESS_A] Batch ${b}/${batchesToRun} evaluated ${evaluated.length} symbols. ` +
      `Cumulative unique: ${uniqueEvaluated.size} | Next cursor: ${batchSel.snapshot.coverageCursor}`
    );
  }

  // 4. Save session state for Process B to verify and resume
  const sessionData = {
    processAPid: pid,
    startedAt: Date.now(),
    totalDiscovered: tradable.length,
    totalEligible: eligible.length,
    eligibleSymbolsList: eligible,
    cursorBeforeStop: pilotCoverageManager.getCurrentStatus(eligible.length, tradable.length).coverageCursor,
    uniqueEvaluatedFromProcessA: Array.from(uniqueEvaluated),
    hookusdtEvaluatedInProcessA: hookusdtEvaluated,
  };

  fs.writeFileSync(AUDIT_SESSION_FILE, JSON.stringify(sessionData, null, 2), 'utf8');

  console.log(`[PROCESS_A] Successfully completed phase 1. Process A state saved to ${AUDIT_SESSION_FILE}.`);
  console.log(`[PROCESS_A] Stopping Process A (PID: ${pid}) now...`);

  process.exit(0);
}

main().catch((err) => {
  console.error('[PROCESS_A] Fatal error:', err);
  process.exit(1);
});
