import React, { useState } from 'react';
import { TradingProvider, useTrading } from './context/TradingContext';
import { Header } from './components/Header';
import { MetricCards } from './components/MetricCards';
import { ActivePositionsTable } from './components/ActivePositionsTable';
import { EquityChart } from './components/EquityChart';
import { GlobalRiskExposureGauge } from './components/GlobalRiskExposureGauge';
import { ToastContainer } from './components/ToastContainer';
import { MarketScannerTab } from './components/MarketScannerTab';
import { AILearningCenterTab } from './components/AILearningCenterTab';
import { BacktestingTab } from './components/BacktestingTab';
import { SocialCopyTradingTab } from './components/SocialCopyTradingTab';
import { TechnicalSupportTab } from './components/TechnicalSupportTab';
import { SettingsModal } from './components/SettingsModal';
import { ClosedTradesHistoryModal } from './components/ClosedTradesHistoryModal';
import { DiagnosticLogsFooter } from './components/DiagnosticLogsFooter';
import {
  Activity,
  Bot,
  Brain,
  History,
  LayoutDashboard,
  Radar,
  Users,
} from 'lucide-react';

type ActiveTab = 'dashboard' | 'scanner' | 'learning' | 'backtest' | 'copy' | 'support';

const MainAppContent: React.FC = () => {
  const { t, language, closedTrades, toasts, dismissToast, clearAllToasts } = useTrading();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const tabs = [
    { id: 'dashboard', label: t.tabDashboard, icon: LayoutDashboard },
    { id: 'scanner', label: t.tabScanner, icon: Radar },
    { id: 'learning', label: t.tabAILearning, icon: Brain },
    { id: 'backtest', label: t.tabBacktest, icon: Activity },
    { id: 'copy', label: t.tabCopyTrading, icon: Users },
    { id: 'support', label: t.tabSupport, icon: Bot },
  ];

  return (
    <div className="min-h-screen bg-[#0a0d14] text-slate-100 flex flex-col font-sans relative">
      {/* Real-time Toast Notifications for Position Open / Close / Profit Targets */}
      <ToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
        onClearAll={clearAllToasts}
        isArabic={language === 'ar'}
      />

      {/* Header */}
      <Header onOpenSettings={() => setIsSettingsOpen(true)} />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 space-y-5">
        {/* Real-time Metric Cards (Visible across all tabs for instant visibility) */}
        <MetricCards />

        {/* Tab Navigation Bar */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-1 overflow-x-auto gap-2">
          <div className="flex items-center gap-1 sm:gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as ActiveTab)}
                  className={`flex items-center gap-2 py-2 px-3 sm:px-4 rounded-xl text-xs sm:text-sm font-semibold transition whitespace-nowrap ${
                    isActive
                      ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20 font-bold'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Trade History Button */}
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-1.5 py-2 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition shrink-0"
          >
            <History className="w-4 h-4 text-amber-400" />
            <span className="hidden sm:inline">{t.tradeHistoryTitle}</span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
              {closedTrades.length}
            </span>
          </button>
        </div>

        {/* Dynamic Tab Content */}
        <div className="animate-in fade-in duration-150">
          {activeTab === 'dashboard' && (
            <div className="space-y-5">
              {/* Automated Global Risk Exposure Gauge */}
              <GlobalRiskExposureGauge />

              {/* Interactive Recharts Equity Growth & Profit/Loss Visualizer */}
              <EquityChart />

              {/* Active Positions Table */}
              <ActivePositionsTable />

              {/* Top Scanner Opportunities on Dashboard */}
              <MarketScannerTab />
            </div>
          )}

          {activeTab === 'scanner' && <MarketScannerTab />}
          {activeTab === 'learning' && <AILearningCenterTab />}
          {activeTab === 'backtest' && <BacktestingTab />}
          {activeTab === 'copy' && <SocialCopyTradingTab />}
          {activeTab === 'support' && <TechnicalSupportTab />}
        </div>
      </main>

      {/* Real-Time WebSocket & Binance API Diagnostic Logs Footer */}
      <DiagnosticLogsFooter />

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-[#07090e] py-4 text-center text-xs text-slate-500 font-mono">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Bavly ApexAI Futures Engine • Binance USDT-M Perpetual</span>
          </div>
          <div>
            24/7 Autonomous Trading • Risk Management Active
          </div>
        </div>
      </footer>

      {/* Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
      <ClosedTradesHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
    </div>
  );
};

export default function App() {
  return (
    <TradingProvider>
      <MainAppContent />
    </TradingProvider>
  );
}
