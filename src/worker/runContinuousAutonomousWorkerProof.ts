import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CawFinalResult } from './cawProofProcessB';

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
  console.log('CONTINUOUS AUTONOMOUS TESTNET WORKER — FULL LIFECYCLE PROOF');
  console.log('Validating Continuous Autonomous Multi-Cycle Scaling on Binance Futures Testnet');
  console.log('Target: Binance USDT-M Futures Testnet (FAIL-CLOSED PRODUCTION GUARD)');
  console.log('================================================================');

  // Clean old session file if exists
  const sessionPath = path.resolve(process.cwd(), 'data/caw_proof_session.json');
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }

  // Step 1: Launch Process A (Sequential discovery and execution of 4 natural candidates)
  console.log('\n>>> STEP 1: Spawning Process A (4-Position Discovery & Continuous Lifecycle Execution)...');
  const resA = await runChildProcess('src/worker/cawProofProcessA.ts');
  if (resA.code !== 0) {
    console.error(`[ORCHESTRATOR] Process A failed with exit code ${resA.code}`);
    process.exit(1);
  }

  if (!fs.existsSync(sessionPath)) {
    console.error('[ORCHESTRATOR] Session file not created by Process A!');
    process.exit(1);
  }

  console.log('\n>>> Process A completed successfully and terminated cleanly.');
  console.log('>>> Proceeding to real process restart with Process B...');

  // Step 2: Launch Process B (Subprocess restart, 4-position restoration, management, slot reuse, full validation matrix)
  console.log('\n>>> STEP 2: Spawning Process B (Restart Verification, Management, Slot Release & Reuse)...');
  const resB = await runChildProcess('src/worker/cawProofProcessB.ts');
  if (resB.code !== 0) {
    console.error(`[ORCHESTRATOR] Process B failed with exit code ${resB.code}`);
    process.exit(1);
  }

  const resultPath = path.resolve(process.cwd(), 'data/caw_proof_result.json');
  if (!fs.existsSync(resultPath)) {
    console.error('[ORCHESTRATOR] Result file not created by Process B!');
    process.exit(1);
  }

  const finalResult: CawFinalResult = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

  console.log('\n================================================================');
  console.log(`FINAL DECISIVE VERDICT: ${finalResult.verdict}`);
  console.log(`VALIDATION TESTS PASSED: ${finalResult.testMatrix.filter((t) => t.passed).length} / ${finalResult.testMatrix.length}`);
  console.log('================================================================');
}

main().catch((err) => {
  console.error('[ORCHESTRATOR_FATAL_ERROR]:', err);
  process.exit(1);
});
