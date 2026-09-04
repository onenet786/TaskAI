import React, { useState } from 'react';
import { Cpu, Terminal, Copy, Check, Download, Layers, ShieldCheck, ArrowRight, Server, Mic, Camera, Database, Zap } from 'lucide-react';
import { PRODUCTION_CODE_FILES, ARCHITECTURE_PIPELINE, CodeFile } from '../data/pythonCode';

export const ArchitectureTab: React.FC = () => {
  const [selectedFileId, setSelectedFileId] = useState<string>('rtsp_engine');
  const [copied, setCopied] = useState(false);

  const currentFile = PRODUCTION_CODE_FILES.find(f => f.id === selectedFileId) || PRODUCTION_CODE_FILES[0];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (file: CodeFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      
      {/* SECTION 1: SYSTEM DESIGN & FLOW DIAGRAM */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-cyan-400" />
            System Architecture & Dual-Pipeline Dataflow
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Asynchronous real-time edge processing for door vision access control paired with local/hybrid voice reasoning.
          </p>
        </div>

        {/* Pipeline 1: Door Access Vision Engine */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
              <Camera className="w-4 h-4" />
              Pipeline A: Door Camera RTSP Ingestion & Attendance
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              Target: &lt;40ms per frame
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {ARCHITECTURE_PIPELINE.vision_pipeline.map(step => (
              <div
                key={step.step}
                className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 hover:border-emerald-500/40 transition-colors space-y-1"
              >
                <div className="text-[10px] font-mono font-bold text-emerald-400">
                  Step {step.step}
                </div>
                <div className="text-xs font-semibold text-slate-200">
                  {step.title}
                </div>
                <div className="text-[10px] text-slate-400 leading-tight">
                  {step.detail}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline 2: Voice Agent Engine */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-2">
              <Mic className="w-4 h-4" />
              Pipeline B: Voice Assistant Interaction & LLM Tool Orchestration
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
              Target: &lt;350ms total voice latency
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {ARCHITECTURE_PIPELINE.voice_pipeline.map(step => (
              <div
                key={step.step}
                className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 hover:border-purple-500/40 transition-colors space-y-1"
              >
                <div className="text-[10px] font-mono font-bold text-purple-400">
                  Step {step.step}
                </div>
                <div className="text-xs font-semibold text-slate-200">
                  {step.title}
                </div>
                <div className="text-[10px] text-slate-400 leading-tight">
                  {step.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 2: HARDWARE RECOMMENDATION & BENCHMARKS */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          Hardware & Edge Compute Matrix (CPU vs GPU Optimization)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {ARCHITECTURE_PIPELINE.hardware_matrix.map((hw, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 flex flex-col justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono font-bold text-cyan-400">
                  {hw.tier}
                </span>
                <h4 className="text-sm font-semibold text-white mt-0.5">
                  {hw.hardware}
                </h4>
                <div className="mt-3 space-y-1.5 font-mono text-[11px]">
                  <div className="flex justify-between border-b border-slate-800/80 pb-1">
                    <span className="text-slate-400">Vision FPS:</span>
                    <span className="text-emerald-400">{hw.rtsp_fps}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800/80 pb-1">
                    <span className="text-slate-400">STT Latency:</span>
                    <span className="text-purple-400">{hw.stt_latency}</span>
                  </div>
                  <div className="flex justify-between pb-1">
                    <span className="text-slate-400">TTS Latency:</span>
                    <span className="text-cyan-400">{hw.tts_latency}</span>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-300/80 pt-2 border-t border-slate-800 italic">
                {hw.recommendation}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 3: EDGE CASES & FAILURE HANDLING */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          Edge Cases & Failure Handling Playbook
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {ARCHITECTURE_PIPELINE.edge_case_solutions.map((item, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-400">{item.category}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">Risk Mitigation</span>
              </div>
              <p className="text-slate-300 font-medium">
                <span className="text-slate-400">Challenge: </span>{item.challenge}
              </p>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                <span className="text-emerald-400 font-medium">Solution: </span>{item.mitigation}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 4: PRODUCTION PYTHON CODE REPOSITORY */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400" />
              Production Codebase & Standalone Python Scripts
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Fully runnable, standalone scripts for edge devices, camera nodes, and office servers.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Code'}</span>
            </button>

            <button
              onClick={() => handleDownload(currentFile)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download {currentFile.name}</span>
            </button>
          </div>
        </div>

        {/* File Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {PRODUCTION_CODE_FILES.map(file => (
            <button
              key={file.id}
              onClick={() => setSelectedFileId(file.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium whitespace-nowrap transition-all cursor-pointer ${
                selectedFileId === file.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {file.name}
            </button>
          ))}
        </div>

        {/* File Description */}
        <div className="text-xs text-slate-400 font-sans italic bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          {currentFile.description}
        </div>

        {/* Code Display */}
        <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
          <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto max-h-[500px] leading-relaxed select-text">
            <code>{currentFile.content}</code>
          </pre>
        </div>

      </div>

    </div>
  );
};
