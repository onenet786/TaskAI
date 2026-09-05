import React from 'react';
import { Camera, Mic, Database, Cpu, RefreshCw, Sparkles, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  activeTab: 'voice' | 'camera' | 'data' | 'architecture';
  setActiveTab: (tab: 'voice' | 'camera' | 'data' | 'architecture') => void;
  onReset: () => void;
  isResetting: boolean;
  systemHealth: {
    status: string;
    gemini_configured: boolean;
    total_employees: number;
    attendance_records: number;
    tasks_count: number;
  } | null;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onReset,
  isResetting,
  systemHealth
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-[1800px] mx-auto px-2 sm:px-3 lg:px-4 py-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Brand & Status */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white font-bold">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  OfficeTask AI
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    Voice & Vision IoT
                  </span>
                </h1>
              </div>
              <p className="text-xs text-slate-400">
                Door RTSP Face Attendance Engine & Talking Voice Orchestrator
              </p>
            </div>
          </div>

          {/* Real-time Hardware Telemetry Bar */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
              systemHealth?.gemini_configured
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            }`}>
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="font-semibold font-mono">
                {systemHealth?.gemini_configured ? 'Gemini API Connected' : 'Gemini API Not Configured'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
              <span className="text-emerald-400 font-semibold font-mono">Node.js 20</span>
              <span className="text-slate-400">Express</span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-300">
              <Camera className="w-3.5 h-3.5 text-cyan-400" />
              <span>RTSP Cam 01</span>
              <span className="text-slate-400 font-mono">1080p@25</span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-300">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span>SQLite Logs:</span>
              <span className="font-semibold text-emerald-400 font-mono">
                {systemHealth?.attendance_records ?? 5}
              </span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-300">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Engine:</span>
              <span className="font-semibold text-purple-300">
                {systemHealth?.gemini_configured ? 'Gemini 3.8 Flash' : 'Edge Fast Tools'}
              </span>
            </div>

            <button
              onClick={onReset}
              disabled={isResetting}
              title="Reset sample database to demo state"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer text-xs"
            >
              <RefreshCw className={`w-3 h-3 ${isResetting ? 'animate-spin text-cyan-400' : ''}`} />
              <span className="hidden sm:inline">Reset Demo</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-1 mt-3 pt-2 border-t border-slate-800/60 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('voice')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'voice'
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Mic className="w-4 h-4 text-cyan-400" />
            <span>Interactive Voice Agent</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-cyan-500/20 text-cyan-300 font-mono">Live</span>
          </button>

          <button
            onClick={() => setActiveTab('camera')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'camera'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Camera className="w-4 h-4 text-emerald-400" />
            <span>Door Cam & RTSP Ingest</span>
          </button>

          <button
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'data'
                ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Database className="w-4 h-4 text-purple-400" />
            <span>Attendance & Task Layer</span>
          </button>

          <button
            onClick={() => setActiveTab('architecture')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'architecture'
                ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span>Architecture & Code (Node / Python)</span>
          </button>
        </div>
      </div>
    </header>
  );
};
