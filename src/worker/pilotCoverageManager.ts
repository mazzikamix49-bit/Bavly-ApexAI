import fs from 'node:fs';
import path from 'node:path';

export interface CoverageAuditSnapshot {
  universeDiscovered: number;
  universeEligible: number;
  batchEvaluatedCount: number;
  cumulativeEvaluatedCount: number;
  coveragePercent: number;
  coverageCursor: number;
  coverageCycle: number;
  lastEvaluatedAt: number;
  batchSymbols: string[];
}

export interface PersistedCoverageState {
  version: number;
  coverageCursor: number;
  coverageCycle: number;
  lastEvaluatedAt: number;
  evaluatedSymbolSet: string[];
}

const COVERAGE_STATE_FILE = path.resolve(process.cwd(), 'data', 'pilot_coverage_state.json');

export class PilotCoverageManager {
  private coverageCursor: number = 0;
  private coverageCycle: number = 1;
  private evaluatedSymbols: Set<string> = new Set();
  private lastEvaluatedAt: number = 0;
  private isLoaded: boolean = false;

  constructor() {
    this.loadState();
  }

  /**
   * Loads persisted coverage state from disk.
   * If missing or corrupted, fails safely to a clean initial state (cursor 0, cycle 1).
   */
  public loadState(): void {
    try {
      if (fs.existsSync(COVERAGE_STATE_FILE)) {
        const raw = fs.readFileSync(COVERAGE_STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.coverageCursor === 'number') {
          this.coverageCursor = Math.max(0, parsed.coverageCursor);
          this.coverageCycle = Math.max(1, parsed.coverageCycle || 1);
          this.lastEvaluatedAt = parsed.lastEvaluatedAt || 0;
          this.evaluatedSymbols = new Set(
            Array.isArray(parsed.evaluatedSymbolSet) ? parsed.evaluatedSymbolSet : []
          );
          this.isLoaded = true;
          return;
        }
      }
    } catch (err: any) {
      console.warn(`[COVERAGE] Failed to load coverage state: ${err.message}. Initializing safe state.`);
    }

    this.coverageCursor = 0;
    this.coverageCycle = 1;
    this.evaluatedSymbols = new Set();
    this.lastEvaluatedAt = 0;
    this.isLoaded = true;
  }

  /**
   * Persists coverage state to disk atomically.
   * Contains strictly non-sensitive telemetry only (zero secrets).
   */
  public saveState(): void {
    try {
      const dir = path.dirname(COVERAGE_STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const payload: PersistedCoverageState = {
        version: 1,
        coverageCursor: this.coverageCursor,
        coverageCycle: this.coverageCycle,
        lastEvaluatedAt: this.lastEvaluatedAt,
        evaluatedSymbolSet: Array.from(this.evaluatedSymbols),
      };

      const tmpPath = `${COVERAGE_STATE_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, COVERAGE_STATE_FILE);
    } catch (err: any) {
      console.warn(`[COVERAGE] Failed to save coverage state: ${err.message}`);
    }
  }

  /**
   * Selects the next batch of eligible symbols deterministically using cursor rotation.
   */
  public selectNextBatch(
    eligibleSymbols: string[],
    totalDiscovered: number,
    batchSize = 50
  ): {
    batchSymbols: string[];
    snapshot: CoverageAuditSnapshot;
  } {
    if (!this.isLoaded) {
      this.loadState();
    }

    // Sort deterministically to guarantee consistent ordering across cycles and restarts
    const sortedEligible = [...eligibleSymbols].sort((a, b) => a.localeCompare(b));
    const totalEligible = sortedEligible.length;

    if (totalEligible === 0) {
      return {
        batchSymbols: [],
        snapshot: {
          universeDiscovered: totalDiscovered,
          universeEligible: 0,
          batchEvaluatedCount: 0,
          cumulativeEvaluatedCount: 0,
          coveragePercent: 0,
          coverageCursor: 0,
          coverageCycle: this.coverageCycle,
          lastEvaluatedAt: Date.now(),
          batchSymbols: [],
        },
      };
    }

    // Wrap cursor if it exceeds universe size
    if (this.coverageCursor >= totalEligible) {
      this.coverageCursor = 0;
      this.coverageCycle += 1;
      this.evaluatedSymbols.clear();
      console.log(`[COVERAGE] Completed full coverage pass. Starting Cycle ${this.coverageCycle} from cursor 0.`);
    }

    const startIndex = this.coverageCursor;
    const endIndex = Math.min(startIndex + batchSize, totalEligible);
    const batch = sortedEligible.slice(startIndex, endIndex);

    // Track evaluated symbols
    for (const sym of batch) {
      this.evaluatedSymbols.add(sym);
    }

    // Advance cursor
    this.coverageCursor = endIndex >= totalEligible ? 0 : endIndex;
    if (endIndex >= totalEligible) {
      this.coverageCycle += 1;
    }

    this.lastEvaluatedAt = Date.now();
    const cumulativeEvaluatedCount = this.evaluatedSymbols.size;
    const coveragePercent = Number(((cumulativeEvaluatedCount / totalEligible) * 100).toFixed(1));

    const snapshot: CoverageAuditSnapshot = {
      universeDiscovered: totalDiscovered,
      universeEligible: totalEligible,
      batchEvaluatedCount: batch.length,
      cumulativeEvaluatedCount,
      coveragePercent,
      coverageCursor: this.coverageCursor,
      coverageCycle: this.coverageCycle,
      lastEvaluatedAt: this.lastEvaluatedAt,
      batchSymbols: [...batch],
    };

    // Log exact audit requirement format
    console.log(
      `[COVERAGE] Universe discovered: ${snapshot.universeDiscovered} | Eligible: ${snapshot.universeEligible} | ` +
      `Batch evaluated: ${snapshot.batchEvaluatedCount} | Cumulative evaluated: ${snapshot.cumulativeEvaluatedCount} ` +
      `(${snapshot.coveragePercent}%) | Cycle: ${snapshot.coverageCycle} | Next Cursor: ${snapshot.coverageCursor}`
    );

    this.saveState();

    return {
      batchSymbols: batch,
      snapshot,
    };
  }

  /**
   * Returns current coverage status snapshot without advancing cursor.
   */
  public getCurrentStatus(totalEligible: number, totalDiscovered: number): CoverageAuditSnapshot {
    const cumulativeEvaluatedCount = this.evaluatedSymbols.size;
    const coveragePercent = totalEligible > 0
      ? Number(((cumulativeEvaluatedCount / totalEligible) * 100).toFixed(1))
      : 0;

    return {
      universeDiscovered: totalDiscovered,
      universeEligible: totalEligible,
      batchEvaluatedCount: 0,
      cumulativeEvaluatedCount,
      coveragePercent,
      coverageCursor: this.coverageCursor,
      coverageCycle: this.coverageCycle,
      lastEvaluatedAt: this.lastEvaluatedAt,
      batchSymbols: [],
    };
  }

  /**
   * Resets coverage state for testing.
   */
  public resetState(): void {
    this.coverageCursor = 0;
    this.coverageCycle = 1;
    this.evaluatedSymbols.clear();
    this.lastEvaluatedAt = 0;
    this.saveState();
  }
}

export const pilotCoverageManager = new PilotCoverageManager();
