import { BotSessionState } from '../types/trading';

const STORAGE_KEY = 'apex_bot_session_state';
const FIVE_HOURS_SECONDS = 5 * 3600; // 18,000 seconds

export type MilestoneCallback = (elapsedSeconds: number, formatted: string) => void;

export class BotSessionService {
  private sessionState: BotSessionState;
  private milestoneListener: MilestoneCallback | null = null;
  private syncTimer: any = null;

  constructor() {
    this.sessionState = this.loadInitialState();
    this.startBackgroundHeartbeat();
  }

  public setMilestoneListener(cb: MilestoneCallback) {
    this.milestoneListener = cb;
  }

  /**
   * Helper to format raw seconds into HH:MM:SS
   */
  static formatDuration(totalSeconds: number): string {
    const safeSec = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeSec / 3600);
    const minutes = Math.floor((safeSec % 3600) / 60);
    const seconds = safeSec % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  private loadInitialState(): BotSessionState {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.sessionId) {
            const now = Date.now();
            if (parsed.status === 'STOPPED') {
              // Persist exact stopped duration without any wall-clock increment!
              const frozenUptime = typeof parsed.uptimeSeconds === 'number' ? parsed.uptimeSeconds : (parsed.elapsedSeconds || 0);
              return {
                sessionId: parsed.sessionId,
                status: 'STOPPED',
                startedAt: parsed.startedAt || parsed.startTime || null,
                stoppedAt: parsed.stoppedAt || now,
                uptimeSeconds: frozenUptime,
                startTime: parsed.startTime || (parsed.startedAt || now),
                elapsedSeconds: frozenUptime,
                formattedDuration: BotSessionService.formatDuration(frozenUptime),
                fiveHourNotified: parsed.fiveHourNotified || false,
                isServerBacked: parsed.isServerBacked || false,
                lastHeartbeat: now,
              };
            } else if (parsed.status === 'RUNNING' && (parsed.startedAt || parsed.startTime)) {
              const start = parsed.startedAt || parsed.startTime;
              const elapsed = Math.max(0, Math.floor((now - start) / 1000));
              return {
                sessionId: parsed.sessionId,
                status: 'RUNNING',
                startedAt: start,
                stoppedAt: null,
                uptimeSeconds: elapsed,
                startTime: start,
                elapsedSeconds: elapsed,
                formattedDuration: BotSessionService.formatDuration(elapsed),
                fiveHourNotified: parsed.fiveHourNotified || false,
                isServerBacked: parsed.isServerBacked || false,
                lastHeartbeat: now,
              };
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load session from localStorage:', e);
    }

    // Default state when no valid session is stored: STOPPED at 00:00:00
    return {
      sessionId: `session-init-${Date.now()}`,
      status: 'STOPPED',
      startedAt: null,
      stoppedAt: null,
      uptimeSeconds: 0,
      startTime: 0,
      elapsedSeconds: 0,
      formattedDuration: '00:00:00',
      fiveHourNotified: false,
      isServerBacked: false,
      lastHeartbeat: Date.now(),
    };
  }

  public saveLocal() {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessionState));
      }
    } catch (e) {
      console.error('Failed to persist session to localStorage:', e);
    }
  }

  /**
   * Start a brand new session:
   * Always creates a fresh sessionId, sets startedAt to now, resets uptimeSeconds to 0 (00:00:00)
   */
  public async startSession(isServerPreferred = true): Promise<BotSessionState> {
    const now = Date.now();
    const newSessionId = `session-${now}-${Math.random().toString(36).substring(2, 7)}`;

    this.sessionState = {
      sessionId: newSessionId,
      status: 'RUNNING',
      startedAt: now,
      stoppedAt: null,
      uptimeSeconds: 0,
      startTime: now,
      elapsedSeconds: 0,
      formattedDuration: '00:00:00',
      fiveHourNotified: false,
      isServerBacked: false,
      lastHeartbeat: now,
    };

    if (isServerPreferred) {
      try {
        const res = await fetch('/api/bot/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'START', sessionId: newSessionId, startTime: now }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            this.sessionState.isServerBacked = true;
          }
        }
      } catch (err) {
        console.warn('Backend session registration failed, running in client mode:', err);
      }
    }

    this.saveLocal();
    return this.getState();
  }

  /**
   * Stop session:
   * Freezes uptime at current elapsed seconds, records stoppedAt, status = 'STOPPED'
   * Wall-clock elapsed time after this point will NEVER increase uptime!
   */
  public async stopSession(): Promise<BotSessionState> {
    const now = Date.now();
    const currentUptime =
      this.sessionState.status === 'RUNNING' && (this.sessionState.startedAt || this.sessionState.startTime)
        ? Math.max(0, Math.floor((now - (this.sessionState.startedAt || this.sessionState.startTime)) / 1000))
        : this.sessionState.uptimeSeconds;

    this.sessionState.status = 'STOPPED';
    this.sessionState.stoppedAt = now;
    this.sessionState.uptimeSeconds = currentUptime;
    this.sessionState.elapsedSeconds = currentUptime;
    this.sessionState.formattedDuration = BotSessionService.formatDuration(currentUptime);
    this.sessionState.lastHeartbeat = now;

    try {
      await fetch('/api/bot/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'STOP', sessionId: this.sessionState.sessionId }),
      });
    } catch {
      // offline fallback
    }

    this.saveLocal();
    return this.getState();
  }

  /**
   * Tick function:
   * Only advances uptime if status is strictly 'RUNNING'
   */
  public tick(maxDurationHours = 0): {
    state: BotSessionState;
    triggeredFiveHourNotification: boolean;
    reachedMaxDuration: boolean;
  } {
    let triggeredFiveHourNotification = false;
    let reachedMaxDuration = false;

    // IF STOPPED: Freeze, do not advance!
    if (this.sessionState.status !== 'RUNNING' || !this.sessionState.startedAt) {
      return {
        state: this.getState(),
        triggeredFiveHourNotification: false,
        reachedMaxDuration: false,
      };
    }

    const now = Date.now();
    const elapsed = Math.max(0, Math.floor((now - this.sessionState.startedAt) / 1000));
    this.sessionState.uptimeSeconds = elapsed;
    this.sessionState.elapsedSeconds = elapsed;
    this.sessionState.formattedDuration = BotSessionService.formatDuration(elapsed);
    this.sessionState.lastHeartbeat = now;

    // 5-Hour milestone detection (Exact transition at 18000s)
    if (elapsed >= FIVE_HOURS_SECONDS && !this.sessionState.fiveHourNotified) {
      this.sessionState.fiveHourNotified = true;
      triggeredFiveHourNotification = true;
      if (this.milestoneListener) {
        this.milestoneListener(elapsed, this.sessionState.formattedDuration);
      }
    }

    // Max duration policy check if enabled (e.g. 5 hours)
    if (maxDurationHours > 0) {
      const maxSec = maxDurationHours * 3600;
      if (elapsed >= maxSec) {
        reachedMaxDuration = true;
        this.sessionState.maxDurationReached = true;
      }
    }

    this.saveLocal();

    return {
      state: this.getState(),
      triggeredFiveHourNotification,
      reachedMaxDuration,
    };
  }

  public getState(): BotSessionState {
    return { ...this.sessionState };
  }

  public async syncWithServer(): Promise<BotSessionState> {
    try {
      const res = await fetch(`/api/bot/session?sessionId=${this.sessionState.sessionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          this.sessionState.isServerBacked = true;
          if (data.session.status === 'STOPPED') {
            // Priority is authoritative backend: if server is STOPPED, client must NOT run!
            this.sessionState.status = 'STOPPED';
            if (typeof data.session.uptimeSeconds === 'number') {
              this.sessionState.uptimeSeconds = data.session.uptimeSeconds;
              this.sessionState.elapsedSeconds = data.session.uptimeSeconds;
              this.sessionState.formattedDuration = BotSessionService.formatDuration(data.session.uptimeSeconds);
            }
            this.saveLocal();
          } else if (data.session.status === 'RUNNING') {
            this.sessionState.status = 'RUNNING';
            this.sessionState.sessionId = data.session.sessionId || this.sessionState.sessionId;
            this.sessionState.startedAt = data.session.startTime || this.sessionState.startedAt;
            this.sessionState.uptimeSeconds = data.session.uptimeSeconds || 0;
            this.sessionState.elapsedSeconds = data.session.uptimeSeconds || 0;
            this.sessionState.formattedDuration = BotSessionService.formatDuration(this.sessionState.uptimeSeconds);
            this.saveLocal();
          }
        }
      } else if (this.sessionState.isServerBacked && this.sessionState.status === 'RUNNING') {
        // If server returned non-OK and session was server backed, avoid fake running state
        this.sessionState.status = 'STOPPED';
        this.saveLocal();
      }
    } catch {
      // If backend unreachable and session was supposed to be server-backed, prevent fake running session
      if (this.sessionState.isServerBacked && this.sessionState.status === 'RUNNING') {
        this.sessionState.status = 'STOPPED';
        this.saveLocal();
      }
    }
    return this.getState();
  }

  private startBackgroundHeartbeat() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    // Initial sync immediately
    this.syncWithServer().catch(() => {});
    // Sync with backend every 30 seconds
    this.syncTimer = setInterval(async () => {
      await this.syncWithServer();
    }, 30000);
  }
}

export const botSessionService = new BotSessionService();
