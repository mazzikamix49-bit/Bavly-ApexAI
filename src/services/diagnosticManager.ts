export interface DiagnosticLogEntry {
  id: string;
  timestamp: string;
  source: 'WS' | 'API' | 'SYSTEM';
  level: 'info' | 'success' | 'warn' | 'error';
  title: string;
  details?: Record<string, any> | string;
  headers?: Record<string, string>;
  url?: string;
  status?: number;
}

export interface WsDiagnosticState {
  readyState: number;
  readyStateText: string;
  endpoint: string;
  reconnectAttempts: number;
  lastMessageTime: string | null;
  messagesReceived: number;
  status: string;
  bufferedAmount: number;
}

export interface ApiDiagnosticSnapshot {
  lastEndpoint: string | null;
  lastStatusCode: number | null;
  lastStatusText: string | null;
  lastHeaders: Record<string, string>;
  lastResponseTimeMs: number | null;
  totalRequests: number;
  failedRequests: number;
}

type DiagnosticSubscriber = () => void;

class DiagnosticManager {
  private logs: DiagnosticLogEntry[] = [];
  private maxLogs = 50;
  private subscribers: Set<DiagnosticSubscriber> = new Set();
  
  public wsSnapshot: WsDiagnosticState = {
    readyState: 3,
    readyStateText: 'CLOSED',
    endpoint: 'wss://fstream.binance.com/ws/!ticker@arr',
    reconnectAttempts: 0,
    lastMessageTime: null,
    messagesReceived: 0,
    status: 'disconnected',
    bufferedAmount: 0,
  };

  public apiSnapshot: ApiDiagnosticSnapshot = {
    lastEndpoint: null,
    lastStatusCode: null,
    lastStatusText: null,
    lastHeaders: {},
    lastResponseTimeMs: null,
    totalRequests: 0,
    failedRequests: 0,
  };

  public subscribe(fn: DiagnosticSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private notify() {
    this.subscribers.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error('Error notifying diagnostic subscriber:', e);
      }
    });
  }

  public addLog(entry: Omit<DiagnosticLogEntry, 'id' | 'timestamp'>) {
    const newEntry: DiagnosticLogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
    };

    this.logs.unshift(newEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    this.notify();
  }

  public recordApiCall(params: {
    url: string;
    status: number;
    statusText: string;
    headers?: Record<string, string>;
    durationMs: number;
    error?: string;
  }) {
    this.apiSnapshot.totalRequests++;
    if (params.status >= 400 || params.error) {
      this.apiSnapshot.failedRequests++;
    }
    this.apiSnapshot.lastEndpoint = params.url;
    this.apiSnapshot.lastStatusCode = params.status;
    this.apiSnapshot.lastStatusText = params.statusText;
    this.apiSnapshot.lastHeaders = params.headers || {};
    this.apiSnapshot.lastResponseTimeMs = params.durationMs;

    this.addLog({
      source: 'API',
      level: params.status >= 200 && params.status < 300 ? 'success' : params.status >= 400 ? 'error' : 'warn',
      title: `${params.status} ${params.statusText || ''} → ${params.url}`,
      url: params.url,
      status: params.status,
      headers: params.headers,
      details: {
        latency: `${params.durationMs}ms`,
        error: params.error,
      },
    });
  }

  public updateWsState(updates: Partial<WsDiagnosticState>) {
    this.wsSnapshot = { ...this.wsSnapshot, ...updates };
    this.notify();
  }

  public getLogs(): DiagnosticLogEntry[] {
    return [...this.logs];
  }

  public clearLogs() {
    this.logs = [];
    this.notify();
  }
}

export const diagnosticManager = new DiagnosticManager();
