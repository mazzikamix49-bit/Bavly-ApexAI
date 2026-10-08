import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './api/index';
import { workerEngine, SAFE_BOOT_MODE } from './src/worker/workerEngine';
import { positionAdoptionService } from './src/worker/positionAdoption';
import { positionStateSync } from './src/worker/positionStateSync';
import { testnetExecutionBridge } from './src/worker/testnetExecutionBridge';
import { executionPreflight } from './src/worker/executionPreflight';
import { testnetExecutionAdapter } from './src/worker/testnetExecutionAdapter';
import { executionPolicy } from './src/worker/executionPolicy';
import { executionReconciliationEngine } from './src/worker/executionReconciliation';
import { autonomousTradingPipeline } from './src/worker/autonomousPipeline';
import { autonomousPilotEngine } from './src/worker/autonomousPilotEngine';
import { runNaturalOpportunityVerification } from './src/worker/naturalOpportunityVerification';
import { runHardeningAudit } from './src/worker/runHardeningAudit';
import { runFinalProofAudit } from './src/worker/runFinalProofAudit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Expose all response headers for client diagnostics
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Expose-Headers', '*');
  next();
});

// Mount Worker Control API Routes (Authoritative Background Engine)
app.get('/api/worker/status', async (_req, res) => {
  try {
    const status = await workerEngine.getStatusAsync();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get worker status' });
  }
});

app.post('/api/worker/start', async (_req, res) => {
  try {
    const result = await workerEngine.requestBotStart();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to start worker' });
  }
});

app.post('/api/worker/stop', async (_req, res) => {
  try {
    const result = await workerEngine.requestBotStop();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to stop worker' });
  }
});

// Mount READ-ONLY Account Reconciliation endpoint for inspection
app.get('/api/worker/reconciliation', async (_req, res) => {
  try {
    const result = await workerEngine.reconcileAccountState();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to reconcile account state' });
  }
});

// Mount READ-ONLY Position Adoption inspection endpoint
app.get('/api/worker/position-adoption', async (_req, res) => {
  try {
    const report = await positionAdoptionService.evaluateCurrentAdoptionState();
    res.json({
      status: report.status,
      remotePositions: report.remotePositions.map((p) => ({
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
      })),
      localPositionCount: report.localPositionCount,
      candidateCount: report.candidateCount,
      alreadyTrackedCount: report.alreadyTrackedCount,
      readOnly: report.readOnly,
      executionPerformed: report.executionPerformed,
      stateModified: report.stateModified,
      warnings: report.warnings,
      timestamp: report.timestamp,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to evaluate position adoption' });
  }
});

// Mount Persistence-Only Position Adoption apply endpoint (ZERO Binance Orders)
app.post('/api/worker/position-adoption/apply', async (_req, res) => {
  try {
    const result = await positionAdoptionService.validateAndAdoptRemotePositions();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to apply position adoption' });
  }
});

// Mount READ-ONLY Position State Diagnostic endpoint
app.get('/api/worker/position-state', async (_req, res) => {
  try {
    const diagnostic = await positionStateSync.getPositionStateDiagnostic();
    res.json(diagnostic);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to read position state diagnostic' });
  }
});

// Mount READ-ONLY Execution Plan Diagnostic endpoint
app.get('/api/worker/execution-plan', (_req, res) => {
  try {
    const plan = testnetExecutionBridge.getLastExecutionPlan();
    if (!plan) {
      return res.json({
        available: false,
        reason: 'NO_EXECUTION_PLAN',
      });
    }
    res.json({
      available: true,
      plan,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to read execution plan' });
  }
});

// Mount READ-ONLY Execution Plan Dry-Run Generation endpoint (ZERO Binance Orders)
app.post('/api/worker/execution-plan/dry-run', async (req, res) => {
  try {
    const result = await testnetExecutionBridge.createExecutionPlan(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to evaluate execution plan' });
  }
});

// Mount READ-ONLY Execution Preflight Gate endpoint
app.get('/api/worker/execution-preflight', async (_req, res) => {
  try {
    const plan = testnetExecutionBridge.getLastExecutionPlan();
    if (!plan) {
      return res.json({
        available: false,
        reason: 'NO_EXECUTION_PLAN',
      });
    }
    const preflightResult = await executionPreflight.validate(plan);
    res.json({
      available: true,
      preflightResult,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to run execution preflight' });
  }
});

// Mount READ-ONLY Execution Status endpoint
app.get('/api/worker/execution-status', (_req, res) => {
  try {
    const auth = testnetExecutionAdapter.getActiveAuthorization();
    res.json({
      enabled: testnetExecutionAdapter.isEnabled(),
      safeBoot: SAFE_BOOT_MODE,
      armed: testnetExecutionAdapter.isArmed(),
      authorization: auth
        ? {
            authorizationId: auth.authorizationId,
            authorizedSymbol: auth.authorizedSymbol,
            authorizedSide: auth.authorizedSide,
            authorizedQuantity: auth.authorizedQuantity,
            authorizedEntryPrice: auth.authorizedEntryPrice,
            planFingerprint: auth.planFingerprint,
            singleUse: auth.singleUse,
            consumed: auth.consumed,
          }
        : null,
      authorizationExpiry: auth?.expiresAt ?? null,
      lastExecutionResult: testnetExecutionAdapter.getLastResult(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to read execution status' });
  }
});

// Mount READ-ONLY Execution Policy Diagnostic endpoint
app.get('/api/worker/execution-policy', (_req, res) => {
  try {
    const config = executionPolicy.getConfig();
    res.json({
      configured: true,
      policy: config,
      defaults: {
        safeBootMode: SAFE_BOOT_MODE,
        executionEnabled: testnetExecutionAdapter.isEnabled(),
        armed: testnetExecutionAdapter.isArmed(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to read execution policy' });
  }
});

// Mount READ-ONLY Execution Reconciliation Diagnostic endpoint
app.get('/api/worker/execution-reconciliation', async (_req, res) => {
  try {
    const report = await executionReconciliationEngine.reconcile();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to perform execution reconciliation' });
  }
});

// Mount READ-ONLY Autonomous Pipeline Diagnostic endpoint
app.get('/api/worker/autonomous-pipeline-diagnostics', async (_req, res) => {
  try {
    const state = await workerEngine.getPersistentState();
    const reconciliationReport = await executionReconciliationEngine.reconcile();
    const capitalProfile = state?.settings?.capitalProfile;

    res.json({
      timestamp: Date.now(),
      readOnly: true,
      testnetOnly: true,
      safeBootMode: SAFE_BOOT_MODE,
      executionEnabled: testnetExecutionAdapter.isEnabled(),
      armed: testnetExecutionAdapter.isArmed(),
      botRunning: state?.botRunning ?? false,
      currentOpenPositionsCount: state?.trackedPositions?.length ?? 0,
      openPositions: (state?.trackedPositions || []).map((p: any) => ({
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        reconciliationStatus: p.reconciliationStatus,
      })),
      maxOpenPositions: capitalProfile?.maxOpenPositions ?? 4,
      riskPerTradePercent: capitalProfile?.riskPerTradePercent ?? 1.0,
      reconciliation: {
        totalTransactionsChecked: reconciliationReport.totalTransactionsChecked,
        requiringManualReviewCount: reconciliationReport.requiringManualReviewCount,
        reconciledNoPositionCount: reconciliationReport.reconciledNoPositionCount,
        reconciledPositionPresentCount: reconciliationReport.reconciledPositionPresentCount,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to read autonomous pipeline diagnostics' });
  }
});

// Mount READ-ONLY Autonomous Pilot Status endpoint
app.get('/api/worker/pilot-status', async (_req, res) => {
  try {
    const status = await autonomousPilotEngine.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to read pilot status' });
  }
});

// Pilot Control: Arm Pilot
app.post('/api/worker/pilot/arm', (_req, res) => {
  try {
    const result = autonomousPilotEngine.arm();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Pilot Control: Disarm Pilot
app.post('/api/worker/pilot/disarm', (_req, res) => {
  try {
    autonomousPilotEngine.disarm();
    res.json({ success: true, message: 'Pilot disarmed.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Pilot Control: Start Autonomous Pilot
app.post('/api/worker/pilot/start', async (_req, res) => {
  try {
    const result = await autonomousPilotEngine.start();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Pilot Control: Stop Autonomous Pilot
app.post('/api/worker/pilot/stop', (_req, res) => {
  try {
    autonomousPilotEngine.stop();
    res.json({ success: true, message: 'Pilot stopped.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Pilot Control: Enable Pilot Mode
app.post('/api/worker/pilot/enable', (_req, res) => {
  try {
    autonomousPilotEngine.setPilotEnabled(true);
    res.json({ success: true, pilotEnabled: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Pilot Control: Disable Pilot Mode
app.post('/api/worker/pilot/disable', (_req, res) => {
  try {
    autonomousPilotEngine.setPilotEnabled(false);
    res.json({ success: true, pilotEnabled: false });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Pilot Control: Clear Manual Review
app.post('/api/worker/pilot/clear-manual-review', (_req, res) => {
  try {
    autonomousPilotEngine.clearManualReview();
    res.json({ success: true, manualReviewRequired: false });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Run Natural Opportunity Verification Gate
app.all(['/api/worker/natural-verification', '/api/worker/natural-verification/run'], async (_req, res) => {
  try {
    const report = await runNaturalOpportunityVerification();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({
      verdict: 'FAIL — EXECUTION_ERROR',
      summary: `Failed to execute natural opportunity verification: ${err.message}`,
      error: err.message,
    });
  }
});

// Run Final Hardening Audit (C1 - C31)
app.all(['/api/worker/hardening-audit', '/api/worker/hardening-audit/run'], async (_req, res) => {
  try {
    const report = await runHardeningAudit();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({
      verdict: 'FAIL',
      summary: `Hardening audit failed: ${err.message}`,
      error: err.message,
    });
  }
});

// Run Final Proof Audit (Real Process Restart + 527/527 Coverage)
app.all(['/api/worker/final-proof-audit', '/api/worker/final-proof-audit/run'], async (_req, res) => {
  try {
    const report = await runFinalProofAudit();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({
      verdict: 'FAIL',
      summary: `Final proof audit failed: ${err.message}`,
      error: err.message,
    });
  }
});

// Run Scaling Proof Result Inspection Endpoint
app.get('/api/worker/scaling-proof', (_req, res) => {
  try {
    const resultPath = path.resolve(process.cwd(), 'data/scaling_proof_result.json');
    if (!fs.existsSync(resultPath)) {
      return res.status(404).json({ error: 'Scaling proof result not found.' });
    }
    const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Run Continuous Autonomous Worker Proof Result Inspection Endpoint
app.get('/api/worker/caw-proof', (_req, res) => {
  try {
    const resultPath = path.resolve(process.cwd(), 'data/caw_proof_result.json');
    if (!fs.existsSync(resultPath)) {
      return res.status(404).json({ error: 'Continuous autonomous worker proof result not found.' });
    }
    const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mount Centralized Backend API Router
app.use('/api', apiRouter);

async function startServer() {
  // 1. Initialize Persistent Worker Entry Point in SAFE BOOT MODE
  await workerEngine.start();

  // 2. Mount Vite middleware or static assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ApexAI V2] Futures Server running on port ${PORT}`);
  });

  // 3. Graceful Shutdown handlers for SIGINT and SIGTERM
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[SERVER] Received ${signal}. Initiating graceful shutdown...`);
    await workerEngine.stop();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

startServer();
