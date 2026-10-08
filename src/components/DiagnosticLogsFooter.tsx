import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  diagnosticManager,
  DiagnosticLogEntry,
  WsDiagnosticState,
  ApiDiagnosticSnapshot,
} from '../services/diagnosticManager';
import { binanceWs } from '../services/binanceWsService';
import { BinanceService } from '../services/binanceService';
import { useTrading } from '../context/TradingContext';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  Globe,
  Info,
  Maximize2,
  Minimize2,
  Play,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';

interface DiagnosticProbeResult {
  direct: {
    success: boolean;
    statusCode?: number;
    latencyMs: number;
    headers: Record<string, string>;
    error?: string;
  };
  backendProxy: {
    success: boolean;
    statusCode?: number;
    latencyMs: number;
    headers: Record<string, string>;
    environment?: any;
    diagnosis?: string;
    error?: string;
  };
}

export const DiagnosticLogsFooter: React.FC = () => {
  const { language, credentials } = useTrading();
  const isArabic = language === 'ar';

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'ws' | 'api' | 'logs' | 'probe'>('ws');
  const [filterSource, setFilterSource] = useState<'ALL' | 'WS' | 'API' | 'ERRORS'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isRunningProbe, setIsRunningProbe] = useState(false);
  const [probeResult, setProbeResult] = useState<DiagnosticProbeResult | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Live state from diagnostic manager
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>(() => diagnosticManager.getLogs());
  const [wsState, setWsState] = useState<WsDiagnosticState>(() => diagnosticManager.wsSnapshot);
  const [apiState, setApiState] = useState<ApiDiagnosticSnapshot>(() => diagnosticManager.apiSnapshot);

  // Time elapsed since last packet
  const [elapsedSincePacket, setElapsedSincePacket] = useState<string>('0s');

  const logContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to diagnostic manager updates
  useEffect(() => {
    const unsubscribe = diagnosticManager.subscribe(() => {
      setLogs(diagnosticManager.getLogs());
      setWsState({ ...diagnosticManager.wsSnapshot });
      setApiState({ ...diagnosticManager.apiSnapshot });
    });
    return unsubscribe;
  }, []);

  // Timer for elapsed seconds since last WS message
  useEffect(() => {
    const timer = setInterval(() => {
      if (!wsState.lastMessageTime) {
        setElapsedSincePacket('Never');
        return;
      }
      setElapsedSincePacket('< 1s');
    }, 1000);
    return () => clearInterval(timer);
  }, [wsState.lastMessageTime]);

  // Handle auto-scroll in logs tab
  useEffect(() => {
    if (autoScroll && logContainerRef.current && activeTab === 'logs') {
      logContainerRef.current.scrollTop = 0;
    }
  }, [logs, autoScroll, activeTab]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleRunProbe = async () => {
    setIsRunningProbe(true);
    setActiveTab('probe');
    setIsOpen(true);
    try {
      const res = await BinanceService.runDiagnosticProbe(credentials.isTestnet);
      setProbeResult(res);
    } catch (err) {
      console.error('Diagnostic probe failed:', err);
    } finally {
      setIsRunningProbe(false);
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filterSource === 'WS' && log.source !== 'WS') return false;
      if (filterSource === 'API' && log.source !== 'API') return false;
      if (filterSource === 'ERRORS' && log.level !== 'error' && log.level !== 'warn') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = log.title.toLowerCase().includes(q);
        const matchesDetails = JSON.stringify(log.details || {}).toLowerCase().includes(q);
        const matchesUrl = log.url ? log.url.toLowerCase().includes(q) : false;
        return matchesTitle || matchesDetails || matchesUrl;
      }
      return true;
    });
  }, [logs, filterSource, searchQuery]);

  // WebSocket status color and description
  const wsStatusColor =
    wsState.readyState === 1
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
      : wsState.readyState === 0
      ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
      : 'text-rose-400 bg-rose-500/10 border-rose-500/30';

  const wsReadyStateLabel =
    wsState.readyState === 0
      ? '0 (CONNECTING)'
      : wsState.readyState === 1
      ? '1 (OPEN)'
      : wsState.readyState === 2
      ? '2 (CLOSING)'
      : '3 (CLOSED)';

  // Binance response headers list
  const headerEntries = useMemo(() => {
    return Object.entries(apiState.lastHeaders || {});
  }, [apiState.lastHeaders]);

  return (
    <div className="w-full bg-[#07090e] border-t border-slate-800/80 font-mono text-xs text-slate-300">
      {/* 1. COMPACT DOCKED STATUS BAR */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: WebSocket & API status pills */}
        <div className="flex flex-wrap items-center gap-2">
          {/* WebSocket Status Pill */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition ${wsStatusColor}`}
          >
            {wsState.readyState === 1 ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            ) : wsState.readyState === 0 ? (
              <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
            ) : (
              <WifiOff className="w-3 h-3 text-rose-400" />
            )}
            <span>WS: {wsReadyStateLabel}</span>
            <span className="text-[10px] text-slate-400">
              • {wsState.messagesReceived.toLocaleString()} msgs
            </span>
          </div>

          {/* Binance API Response Pill */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] ${
              apiState.lastStatusCode && apiState.lastStatusCode >= 200 && apiState.lastStatusCode < 300
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : apiState.lastStatusCode && apiState.lastStatusCode >= 400
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <Server className="w-3 h-3 text-amber-400" />
            <span>
              API: {apiState.lastStatusCode ? `${apiState.lastStatusCode} ${apiState.lastStatusText || ''}` : 'Pending'}
            </span>
            {apiState.lastResponseTimeMs !== null && (
              <span className="text-[10px] text-slate-400">({apiState.lastResponseTimeMs}ms)</span>
            )}
            {apiState.lastHeaders['x-mbx-used-weight-1m'] && (
              <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded">
                Weight: {apiState.lastHeaders['x-mbx-used-weight-1m']}/1200
              </span>
            )}
          </div>

          {/* Cloud / Vercel Environment Indicator */}
          <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900/80 border border-slate-800/80 text-slate-400 text-[10px]">
            <Globe className="w-3 h-3 text-sky-400" />
            <span>Vercel / Cloud Diagnostics</span>
          </div>
        </div>

        {/* Right: Quick Action Buttons */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Run Probe Button */}
          <button
            onClick={handleRunProbe}
            disabled={isRunningProbe}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[11px] font-medium transition cursor-pointer disabled:opacity-50"
            title="Probe connection from browser and backend to Binance"
          >
            <Play className={`w-3 h-3 ${isRunningProbe ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">
              {isRunningProbe ? (isArabic ? 'جارٍ الفحص...' : 'Probing...') : isArabic ? 'فحص الاتصال' : 'Run Probe'}
            </span>
          </button>

          {/* Reconnect WebSocket Button */}
          <button
            onClick={() => binanceWs.reconnect()}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[11px] transition cursor-pointer"
            title="Force reconnect WebSocket"
          >
            <RefreshCw className="w-3 h-3 text-slate-400" />
            <span className="hidden sm:inline">{isArabic ? 'إعادة وصل WS' : 'Reconnect WS'}</span>
          </button>

          {/* Toggle Expand / Collapse Drawer */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/70 text-slate-200 text-[11px] font-semibold transition cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-amber-400" />
            <span>{isArabic ? 'سجلات التشخيص والـ Headers' : 'Diagnostics & Headers'}</span>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 2. EXPANDED TERMINAL & HEADERS INSPECTOR DRAWER */}
      {isOpen && (
        <div className="border-t border-slate-800 bg-[#06080d] max-w-7xl mx-auto px-3 sm:px-6 py-4 space-y-4 animate-in slide-in-from-bottom-2 duration-150">
          {/* Navigation Bar inside Drawer */}
          <div className="flex flex-wrap items-center justify-between border-b border-slate-800/80 pb-2.5 gap-2">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => setActiveTab('ws')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === 'ws'
                    ? 'bg-amber-500 text-black shadow-sm font-bold'
                    : 'bg-slate-900/80 text-slate-400 hover:text-white'
                }`}
              >
                <Wifi className="w-3.5 h-3.5" />
                <span>{isArabic ? 'حالة WebSocket الخام' : 'Raw WebSocket State'}</span>
              </button>

              <button
                onClick={() => setActiveTab('api')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === 'api'
                    ? 'bg-amber-500 text-black shadow-sm font-bold'
                    : 'bg-slate-900/80 text-slate-400 hover:text-white'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>{isArabic ? 'ترويسات الـ API (Headers)' : 'Binance Response Headers'}</span>
                {headerEntries.length > 0 && (
                  <span className="text-[10px] px-1 py-0.2 rounded bg-black/30">
                    {headerEntries.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('logs')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === 'logs'
                    ? 'bg-amber-500 text-black shadow-sm font-bold'
                    : 'bg-slate-900/80 text-slate-400 hover:text-white'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>{isArabic ? 'سجل الأحداث المباشر' : 'Live Event Logs'}</span>
                <span className="text-[10px] px-1 py-0.2 rounded bg-black/30">
                  {logs.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('probe')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === 'probe'
                    ? 'bg-amber-500 text-black shadow-sm font-bold'
                    : 'bg-slate-900/80 text-slate-400 hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>{isArabic ? 'فحص Vercel والشبكة' : 'Vercel Network Probe'}</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
                title="Collapse drawer"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* TAB 1: RAW WEBSOCKET CONNECTION STATE */}
          {activeTab === 'ws' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    {isArabic ? 'حالة الاتصال (ReadyState)' : 'WS readyState'}
                  </div>
                  <div className="text-base font-bold text-white flex items-center gap-2">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        wsState.readyState === 1
                          ? 'bg-emerald-400 animate-pulse'
                          : wsState.readyState === 0
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                      }`}
                    />
                    <span>{wsReadyStateLabel}</span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {wsState.readyState === 1
                      ? 'WebSocket.OPEN (0-latency stream active)'
                      : wsState.readyState === 0
                      ? 'WebSocket.CONNECTING'
                      : 'WebSocket.CLOSED'}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    {isArabic ? 'إجمالي الحزم المستلمة' : 'Packets Received'}
                  </div>
                  <div className="text-base font-bold text-emerald-400">
                    {wsState.messagesReceived.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {isArabic ? 'آخر حزمة:' : 'Last packet:'} {wsState.lastMessageTime || 'None'}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    {isArabic ? 'محاولات إعادة الوصل' : 'Reconnect Attempts'}
                  </div>
                  <div className="text-base font-bold text-amber-400">
                    {wsState.reconnectAttempts} / 10
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {isArabic ? 'النبض الحي:' : 'Heartbeat:'} 10s auto-check
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    {isArabic ? 'الذاكرة المؤقتة (Buffer)' : 'Buffered Amount'}
                  </div>
                  <div className="text-base font-bold text-sky-400">
                    {wsState.bufferedAmount} bytes
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Protocol: wss / USDT-M
                  </div>
                </div>
              </div>

              {/* WebSocket Raw Snapshot Inspector */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    {isArabic ? 'كائن حالة WebSocket المباشر (Raw JSON Snapshot):' : 'Raw WebSocket Instance State Snapshot:'}
                  </span>
                  <button
                    onClick={() => handleCopy(JSON.stringify(wsState, null, 2), 'wsState')}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-300 transition"
                  >
                    {copiedKey === 'wsState' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'wsState' ? 'Copied' : 'Copy State'}</span>
                  </button>
                </div>
                <pre className="p-2.5 rounded-lg bg-black/60 border border-slate-900 overflow-x-auto text-[11px] text-emerald-300/90 leading-relaxed font-mono">
                  {JSON.stringify(
                    {
                      readyState: wsState.readyState,
                      readyStateText: wsReadyStateLabel,
                      status: wsState.status,
                      endpoint: wsState.endpoint,
                      messagesReceived: wsState.messagesReceived,
                      lastMessageTime: wsState.lastMessageTime,
                      bufferedAmount: wsState.bufferedAmount,
                      reconnectAttempts: wsState.reconnectAttempts,
                      clientEnv: typeof window !== 'undefined' ? 'Browser Client' : 'Server',
                      heartbeatIntervalMs: 10000,
                      reconnectStrategy: 'Exponential Backoff (1.5x up to 15s)',
                    },
                    null,
                    2
                  )}
                </pre>
              </div>

              {/* Vercel Tip for WebSockets */}
              <div className="p-3 rounded-xl bg-sky-950/30 border border-sky-800/40 text-[11px] text-sky-200/90 space-y-1">
                <div className="font-semibold flex items-center gap-1.5 text-sky-300">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  <span>{isArabic ? 'ملاحظة معمارية هامة بخصوص Vercel و WebSocket:' : 'Vercel Architecture Note on WebSockets:'}</span>
                </div>
                <p className="leading-relaxed">
                  {isArabic
                    ? 'دوال فيرسل (Vercel Serverless Functions) لها مدة تشغيل قصيرة (Timeout 10-60s) ولا تدعم قنوات WebSocket دائمة. لذلك صُمم apexAI لفتح اتصال WebSocket المباشر من متصفح العميل رأساً إلى سيرفرات بينانس (wss://fstream.binance.com)، متجاوزاً أي قيود على Vercel لضمان بث أسعار لحظي دون انقطاع.'
                    : 'Vercel Serverless Functions have strict execution timeouts (10-60s) and cannot hold persistent WebSockets open. apexAI smartly connects WebSocket streams directly from the client browser to Binance Futures (wss://fstream.binance.com), completely bypassing Vercel serverless limits for uninterrupted sub-second live prices.'}
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: BINANCE API RESPONSE HEADERS */}
          {activeTab === 'api' && (
            <div className="space-y-3">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    {isArabic ? 'آخر رمز استجابة (Status Code)' : 'Last Status Code'}
                  </div>
                  <div
                    className={`text-base font-bold ${
                      apiState.lastStatusCode && apiState.lastStatusCode >= 200 && apiState.lastStatusCode < 300
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {apiState.lastStatusCode || 'N/A'} {apiState.lastStatusText || ''}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate" title={apiState.lastEndpoint || ''}>
                    {apiState.lastEndpoint || 'No requests yet'}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    {isArabic ? 'زمن الاستجابة (Latency)' : 'Roundtrip Latency'}
                  </div>
                  <div className="text-base font-bold text-amber-400">
                    {apiState.lastResponseTimeMs !== null ? `${apiState.lastResponseTimeMs} ms` : 'N/A'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Direct & Proxy telemetry
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    {isArabic ? 'الوزن المستهلك (Rate Weight)' : 'Binance IP Weight'}
                  </div>
                  <div className="text-base font-bold text-sky-400">
                    {apiState.lastHeaders['x-mbx-used-weight-1m'] || '1'} / 1200
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Header: x-mbx-used-weight-1m
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    {isArabic ? 'إجمالي الطلبات / الفاشلة' : 'Requests / Failed'}
                  </div>
                  <div className="text-base font-bold text-slate-200">
                    {apiState.totalRequests} <span className="text-xs text-rose-400 font-normal">({apiState.failedRequests} fail)</span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Success rate:{' '}
                    {apiState.totalRequests > 0
                      ? Math.round(
                          ((apiState.totalRequests - apiState.failedRequests) / apiState.totalRequests) * 100
                        )
                      : 100}
                    %
                  </div>
                </div>
              </div>

              {/* Raw Response Headers Table */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isArabic ? 'ترويسات استجابة بينانس الخام (Raw HTTP Response Headers):' : 'Raw Binance HTTP Response Headers:'}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(JSON.stringify(apiState.lastHeaders, null, 2), 'allHeaders')}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-300 transition"
                    >
                      {copiedKey === 'allHeaders' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'allHeaders' ? 'Copied' : 'Copy All Headers'}</span>
                    </button>
                  </div>
                </div>

                {headerEntries.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 text-xs">
                    {isArabic
                      ? 'لم يتم تسجيل ترويسات بعد. انقر على "فحص الاتصال" (Run Probe) لأخذ قراءة فورية.'
                      : 'No response headers captured yet. Click "Run Probe" to test and fetch live headers.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-72 rounded-lg border border-slate-800/80">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
                          <th className="py-1.5 px-3 font-semibold w-1/3">Header Name</th>
                          <th className="py-1.5 px-3 font-semibold">Value</th>
                          <th className="py-1.5 px-3 font-semibold w-16 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900/80 font-mono">
                        {headerEntries.map(([k, v]) => {
                          const isSpecial =
                            k.startsWith('x-mbx') ||
                            k.includes('cf-ray') ||
                            k.includes('server') ||
                            k.includes('cors');

                          return (
                            <tr
                              key={k}
                              className={`hover:bg-slate-900/50 transition ${
                                isSpecial ? 'bg-amber-500/5 text-amber-200' : 'text-slate-300'
                              }`}
                            >
                              <td className="py-1.5 px-3 font-medium text-slate-400">{k}</td>
                              <td className="py-1.5 px-3 break-all text-slate-200 select-all">{v}</td>
                              <td className="py-1.5 px-3 text-right">
                                <button
                                  onClick={() => handleCopy(`${k}: ${v}`, k)}
                                  className="text-[10px] text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
                                  title="Copy single header"
                                >
                                  {copiedKey === k ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Vercel IP Block Debugging Guide */}
              <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-800/40 text-[11px] text-amber-200/90 space-y-1.5">
                <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                  <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{isArabic ? 'دليل تشخيص أخطاء Vercel مع Binance API (451 / 403 Forbidden):' : 'Vercel Binance API Debugging Guide (451 / 403 Codes):'}</span>
                </div>
                <div className="space-y-1 text-slate-300 leading-relaxed">
                  <p>
                    • <strong className="text-amber-300">HTTP 451 Unavailable For Legal Reasons:</strong>{' '}
                    {isArabic
                      ? 'إذا ظهر هذا الرمز، فهذا يعني أن خوادم Vercel Serverless تم توجيهها إلى داتا سنتر في الولايات المتحدة (مثل iad1 / Washington DC) وبينانس تحظر الآيبيهات الأمريكية بموجب القوانين.'
                      : 'If this status appears, Vercel routed your serverless execution to a US datacenter (e.g., iad1 Washington DC), and Binance restricts US IP ranges.'}
                  </p>
                  <p>
                    • <strong className="text-emerald-300">{isArabic ? 'الحل التلقائي المُدمج:' : 'Built-in Automatic Resolution:'}</strong>{' '}
                    {isArabic
                      ? 'يقوم تطبيق ApexAI تلقائياً بتجاوز خادم فيرسل وجلب الأسعار وعقود الـ USDT عبر المتصفح مباشرةً بتقنية 0-latency WebSocket، مما يضمن عمل التطبيق بنجاح 100% حتى لو كان خادم Vercel مقيداً.'
                      : 'ApexAI automatically falls back to client-side direct WebSocket & browser fetch, completely bypassing Vercel server geo-restrictions.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LIVE EVENT LOG STREAM */}
          {activeTab === 'logs' && (
            <div className="space-y-2.5">
              {/* Log Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {(['ALL', 'WS', 'API', 'ERRORS'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setFilterSource(filter)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                        filterSource === filter
                          ? 'bg-amber-500 text-black font-bold'
                          : 'bg-slate-900 text-slate-400 hover:text-white'
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3 h-3 text-slate-400 absolute left-2 top-2" />
                    <input
                      type="text"
                      placeholder={isArabic ? 'بحث في السجلات...' : 'Filter logs...'}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-md pl-6 pr-2 py-0.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <button
                    onClick={() => setAutoScroll(!autoScroll)}
                    className={`px-2 py-1 rounded text-[10px] border transition ${
                      autoScroll
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
                  </button>

                  <button
                    onClick={() => diagnosticManager.clearLogs()}
                    className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                    title="Clear diagnostic logs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Logs Container */}
              <div
                ref={logContainerRef}
                className="overflow-y-auto max-h-80 rounded-xl bg-slate-950 border border-slate-800/80 p-2 space-y-1.5 font-mono text-[11px]"
              >
                {filteredLogs.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    {isArabic ? 'لا توجد سجلات مطابقة حالياً' : 'No logs recorded matching filter.'}
                  </div>
                ) : (
                  filteredLogs.map((log) => {
                    const isExpanded = expandedLogId === log.id;
                    const levelBadge =
                      log.level === 'success'
                        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                        : log.level === 'warn'
                        ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                        : log.level === 'error'
                        ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                        : 'text-sky-400 bg-sky-500/10 border-sky-500/20';

                    const sourceBadge =
                      log.source === 'WS'
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                        : log.source === 'API'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : 'bg-slate-800 text-slate-300 border-slate-700';

                    return (
                      <div
                        key={log.id}
                        className="rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 p-2 transition space-y-1"
                      >
                        <div
                          className="flex items-center justify-between gap-2 cursor-pointer"
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="text-slate-500 text-[10px] shrink-0">{log.timestamp}</span>
                            <span className={`px-1.5 py-0.2 rounded border text-[10px] font-semibold shrink-0 ${sourceBadge}`}>
                              {log.source}
                            </span>
                            <span className={`px-1.5 py-0.2 rounded border text-[10px] font-semibold shrink-0 ${levelBadge}`}>
                              {log.level.toUpperCase()}
                            </span>
                            <span className="text-slate-200 truncate font-medium">{log.title}</span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {log.details && (
                              <span className="text-[10px] text-slate-500">
                                {isExpanded ? 'Hide' : 'Details'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Collapsible Details */}
                        {isExpanded && (
                          <div className="pt-2 border-t border-slate-800/80 space-y-1.5 animate-in fade-in duration-100">
                            {log.url && (
                              <div className="text-[10px] text-slate-400 break-all">
                                <strong className="text-slate-300">URL:</strong> {log.url}
                              </div>
                            )}
                            {log.details && (
                              <pre className="p-2 rounded bg-black/60 border border-slate-900 overflow-x-auto text-[10px] text-slate-300 select-all">
                                {typeof log.details === 'string'
                                  ? log.details
                                  : JSON.stringify(log.details, null, 2)}
                              </pre>
                            )}
                            {log.headers && Object.keys(log.headers).length > 0 && (
                              <div>
                                <div className="text-[10px] text-amber-400 font-semibold mb-1">
                                  Captured Headers:
                                </div>
                                <pre className="p-2 rounded bg-black/60 border border-slate-900 overflow-x-auto text-[10px] text-amber-300 select-all">
                                  {JSON.stringify(log.headers, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 4: VERCEL NETWORK PROBE RESULTS */}
          {activeTab === 'probe' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-amber-400" />
                  <span>
                    {isArabic
                      ? 'نتائج فحص الاتصال التبادلي (Direct Browser vs Vercel Serverless)'
                      : 'Dual-Path Network Probe Results (Browser Direct vs Vercel Proxy)'}
                  </span>
                </div>
                <button
                  onClick={handleRunProbe}
                  disabled={isRunningProbe}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500 text-black font-bold text-xs hover:bg-amber-400 transition cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isRunningProbe ? 'animate-spin' : ''}`} />
                  <span>{isRunningProbe ? (isArabic ? 'جارٍ الفحص...' : 'Testing...') : isArabic ? 'إعادة الفحص' : 'Retest Probe'}</span>
                </button>
              </div>

              {!probeResult ? (
                <div className="p-8 text-center bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                  <p className="text-slate-400 text-xs">
                    {isArabic
                      ? 'اضغط على "إعادة الفحص" لإجراء اختبار فوري شامل لمسار المتصفح المباشر ومسار خادم Vercel.'
                      : 'Click "Retest Probe" to send diagnostic ping requests to Binance through both client-side and Vercel serverless proxy.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Direct Browser Path */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                        <Wifi className="w-4 h-4 text-emerald-400" />
                        <span>1. Browser Direct Path</span>
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          probeResult.direct.success
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {probeResult.direct.success ? 'PASSED (200 OK)' : 'FAILED / CORS'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 space-y-1">
                      <div>Target: Binance Futures Public API (`fapi.binance.com`)</div>
                      <div>Latency: <strong className="text-white">{probeResult.direct.latencyMs}ms</strong></div>
                      <div>Status Code: {probeResult.direct.statusCode || 'Blocked by CORS'}</div>
                      {probeResult.direct.error && (
                        <div className="text-rose-400 text-[10px]">Error: {probeResult.direct.error}</div>
                      )}
                    </div>
                    {Object.keys(probeResult.direct.headers).length > 0 && (
                      <pre className="p-2 rounded bg-black/60 border border-slate-900 text-[10px] text-slate-300 overflow-x-auto">
                        {JSON.stringify(probeResult.direct.headers, null, 2)}
                      </pre>
                    )}
                  </div>

                  {/* Vercel Serverless Proxy Path */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                        <Server className="w-4 h-4 text-amber-400" />
                        <span>2. Vercel Serverless Proxy Path</span>
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          probeResult.backendProxy.success
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {probeResult.backendProxy.success
                          ? `PASSED (${probeResult.backendProxy.statusCode})`
                          : `STATUS ${probeResult.backendProxy.statusCode}`}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 space-y-1">
                      <div>Endpoint: `/api/binance/diagnostics`</div>
                      <div>Backend Latency: <strong className="text-white">{probeResult.backendProxy.latencyMs}ms</strong></div>
                      {probeResult.backendProxy.environment && (
                        <div className="text-[10px] text-sky-300">
                          Region: {probeResult.backendProxy.environment.vercelRegion} • Node: {probeResult.backendProxy.environment.nodeVersion}
                        </div>
                      )}
                      {probeResult.backendProxy.diagnosis && (
                        <div className="text-amber-300 text-[10px] bg-amber-500/10 p-1.5 rounded border border-amber-500/20">
                          {probeResult.backendProxy.diagnosis}
                        </div>
                      )}
                    </div>
                    {Object.keys(probeResult.backendProxy.headers).length > 0 && (
                      <pre className="p-2 rounded bg-black/60 border border-slate-900 text-[10px] text-amber-300/90 overflow-x-auto">
                        {JSON.stringify(probeResult.backendProxy.headers, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
