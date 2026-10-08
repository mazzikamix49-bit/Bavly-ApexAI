/**
 * Master Final Proof Audit Orchestrator
 *
 * Spawns Process A (Batches 1..5 = 250 symbols),
 * awaits Process A clean termination,
 * spawns Process B (resumes cursor 250 -> 527 symbols = 100% coverage + Replay Audit),
 * awaits Process B clean termination,
 * loads and outputs the final proof audit result.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const AUDIT_RESULT_FILE = path.resolve(process.cwd(), 'data', 'final_proof_audit_result.json');

function runChild(scriptPath: string): Promise<{ code: number; stdout: string; stderr: string; pid: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptPath], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const pid = child.pid || 0;
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(s);
    });

    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
    });

    child.on('close', (code) => {
      resolve({ code: code || 0, stdout, stderr, pid });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

export async function runFinalProofAudit() {
  console.log('[MASTER_ORCHESTRATOR] Starting Final Proof Audit Execution...');

  // Step 1: Launch Process A
  console.log('\n>>> LAUNCHING PROCESS A (Phase 1: Initial Coverage Batches 1..5) <<<');
  const resA = await runChild('./src/worker/coverageProcessA.ts');
  if (resA.code !== 0) {
    throw new Error(`Process A failed with exit code ${resA.code}`);
  }
  console.log(`>>> PROCESS A FINISHED AND TERMINATED (Exit Code: ${resA.code}) <<<\n`);

  // Small delay to ensure OS process cleanup
  await new Promise((r) => setTimeout(r, 1000));

  // Step 2: Launch Process B
  console.log('\n>>> LAUNCHING PROCESS B (Phase 2: Resume Cursor 250 -> 527/527 + Replay Audit) <<<');
  const resB = await runChild('./src/worker/coverageProcessB.ts');
  if (resB.code !== 0) {
    throw new Error(`Process B failed with exit code ${resB.code}`);
  }
  console.log(`>>> PROCESS B FINISHED (Exit Code: ${resB.code}) <<<\n`);

  if (!fs.existsSync(AUDIT_RESULT_FILE)) {
    throw new Error(`Audit result file ${AUDIT_RESULT_FILE} was not created.`);
  }

  const result = JSON.parse(fs.readFileSync(AUDIT_RESULT_FILE, 'utf8'));
  return result;
}

if (process.argv[1] && process.argv[1].endsWith('runFinalProofAudit.ts')) {
  runFinalProofAudit()
    .then((r) => {
      console.log('Final Proof Audit Result Verdict:', r.verdict);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Final Proof Audit Failed:', err);
      process.exit(1);
    });
}
