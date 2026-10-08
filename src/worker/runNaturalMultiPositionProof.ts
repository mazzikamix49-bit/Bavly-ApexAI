import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NaturalMultiPositionFinalResult } from './naturalProofProcessB';

function runChildProcess(scriptPath: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptPath], {
      cwd: process.cwd(),
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let output = '';

    child.stdout.on('data', (d) => {
      const str = d.toString();
      output += str;
      process.stdout.write(str);
    });

    child.stderr.on('data', (d) => {
      const str = d.toString();
      output += str;
      process.stderr.write(str);
    });

    child.on('close', (code) => {
      resolve({ code, output });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('MULTI-POSITION NATURAL AUTONOMOUS PILOT — CONTROLLED TESTNET PROOF');
  console.log('Executing live end-to-end natural proof on Binance Futures Testnet');
  console.log('================================================================');

  // Clean old session file if exists
  const sessionPath = path.resolve(process.cwd(), 'data/natural_multi_position_session.json');
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }

  // 1. Launch Process A
  console.log('\n>>> STEP 1: Spawning Process A (Natural Scanning & Execution of A + B)...');
  const resA = await runChildProcess('src/worker/naturalProofProcessA.ts');
  if (resA.code !== 0) {
    console.error(`[ORCHESTRATOR] Process A failed with exit code ${resA.code}`);
    process.exit(1);
  }

  if (!fs.existsSync(sessionPath)) {
    console.error('[ORCHESTRATOR] Session file not created by Process A!');
    process.exit(1);
  }

  console.log('\n>>> Process A completed successfully and terminated.');
  console.log('>>> Proceeding to real process restart with Process B...');

  // 2. Launch Process B
  console.log('\n>>> STEP 2: Spawning Process B (Restart Verification, Guards, Replay, Independent Close)...');
  const resB = await runChildProcess('src/worker/naturalProofProcessB.ts');
  if (resB.code !== 0) {
    console.error(`[ORCHESTRATOR] Process B failed with exit code ${resB.code}`);
    process.exit(1);
  }

  const resultPath = path.resolve(process.cwd(), 'data/natural_multi_position_result.json');
  if (!fs.existsSync(resultPath)) {
    console.error('[ORCHESTRATOR] Result file not created by Process B!');
    process.exit(1);
  }

  const finalResult: NaturalMultiPositionFinalResult = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

  console.log('\n================================================================');
  console.log(`FINAL DECISIVE VERDICT: ${finalResult.verdict}`);
  console.log('================================================================');
}

main().catch((err) => {
  console.error('[ORCHESTRATOR_FATAL_ERROR]:', err);
  process.exit(1);
});
