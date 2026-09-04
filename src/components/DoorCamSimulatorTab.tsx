import React, { useState, useEffect, useRef } from 'react';
import { Camera, ShieldAlert, CheckCircle2, RefreshCw, Eye, ArrowDown, ArrowUp, Zap, Clock, UserCheck, Video, VideoOff, AlertTriangle } from 'lucide-react';
import { Employee, AttendanceRecord } from '../types';

interface DoorCamSimulatorTabProps {
  employees: Employee[];
  attendanceLogs: AttendanceRecord[];
  onScanLogged: (record: AttendanceRecord) => void;
}

interface SimulatedDetection {
  active: boolean;
  name: string;
  employee_id: string | null;
  confidence: number;
  direction: 'IN' | 'OUT';
  isUnauthorized: boolean;
  cooldownBlocked?: boolean;
  message?: string;
  yPosition: number;
}

export const DoorCamSimulatorTab: React.FC<DoorCamSimulatorTabProps> = ({
  employees,
  attendanceLogs,
  onScanLogged
}) => {
  const [useWebcam, setUseWebcam] = useState(false);
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [activeDetection, setActiveDetection] = useState<SimulatedDetection | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cooldownTimeouts, setCooldownTimeouts] = useState<Record<string, number>>({});
  const [wdrEnabled, setWdrEnabled] = useState(true);
  const [streamFps, setStreamFps] = useState(25);
  const [tripwireRatio, setTripwireRatio] = useState(55); // 55% from top

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Toggle user webcam
  const toggleWebcam = async () => {
    if (webcamActive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      setWebcamActive(false);
      setUseWebcam(false);
      return;
    }

    try {
      setWebcamError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setWebcamActive(true);
      setUseWebcam(true);
    } catch (err: any) {
      console.error("Webcam error:", err);
      setWebcamError("Could not access local webcam. Please allow camera permissions or use simulated feed.");
      setWebcamActive(false);
      setUseWebcam(false);
    }
  };

  // Clean up webcam on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Cooldown countdown timer ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setCooldownTimeouts(prev => {
        const next: Record<string, number> = {};
        for (const [id, val] of Object.entries(prev)) {
          const remaining = Number(val);
          if (remaining > 1) {
            next[id] = remaining - 1;
          }
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Dispatch attendance scan to backend
  const triggerScan = async (
    empId: string | null,
    empName: string,
    direction: 'IN' | 'OUT',
    confidence: number,
    bypassCooldown = false
  ) => {
    setIsScanning(true);

    // If unauthorized / unknown person
    if (!empId) {
      setActiveDetection({
        active: true,
        name: "UNKNOWN_INDIVIDUAL",
        employee_id: null,
        confidence: confidence,
        direction: direction,
        isUnauthorized: true,
        message: "No facial embedding match found. Cosine distance > 0.32. Access denied.",
        yPosition: direction === 'IN' ? 65 : 40
      });
      setIsScanning(false);
      return;
    }

    try {
      const res = await fetch('/api/attendance/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: empId,
          name: empName,
          status: direction,
          confidence_score: confidence,
          camera_id: 'RTSP-CAM-01-ENTRANCE',
          bypass_cooldown: bypassCooldown
        })
      });

      const data = await res.json();

      if (res.status === 429 && data.cooldown_blocked) {
        // Cooldown active
        setActiveDetection({
          active: true,
          name: empName,
          employee_id: empId,
          confidence: confidence,
          direction: direction,
          isUnauthorized: false,
          cooldownBlocked: true,
          message: data.message,
          yPosition: direction === 'IN' ? 60 : 45
        });
        setCooldownTimeouts(prev => ({ ...prev, [empId]: data.remaining_seconds || 30 }));
      } else if (res.ok && data.success) {
        setActiveDetection({
          active: true,
          name: empName,
          employee_id: empId,
          confidence: confidence,
          direction: direction,
          isUnauthorized: false,
          cooldownBlocked: false,
          message: `Check-${direction} logged successfully!`,
          yPosition: direction === 'IN' ? 68 : 38
        });
        setCooldownTimeouts(prev => ({ ...prev, [empId]: 30 }));
        onScanLogged(data.record);
      }
    } catch (err: any) {
      console.error("Scan error:", err);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      {/* Left Column: RTSP Video Feed & Overlays (7 cols) */}
      <div className="lg:col-span-7 space-y-4">
        
        {/* Stream Container */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative">
          
          {/* Top Camera Stream Bar */}
          <div className="bg-slate-950/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-slate-200 font-semibold">
                RTSP://192.168.1.120:554/cam01
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
                H.264
              </span>
            </div>

            <div className="flex items-center gap-3 font-mono text-slate-400 text-[11px]">
              <span>{streamFps} FPS</span>
              <span>1080p</span>
              <button
                onClick={toggleWebcam}
                className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-sans cursor-pointer transition-colors"
                title="Toggle Real Device Webcam"
              >
                {webcamActive ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                <span>{webcamActive ? 'Use Sim Feed' : 'Use Webcam'}</span>
              </button>
            </div>
          </div>

          {/* Stream Canvas / Video viewport */}
          <div className="relative aspect-video bg-slate-950 flex items-center justify-center overflow-hidden select-none">
            
            {/* Background Stream Simulation or Real Webcam */}
            {webcamActive ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform -scale-x-100"
              />
            ) : (
              <div className="w-full h-full relative flex items-center justify-center bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900">
                
                {/* Visual office entrance illustration */}
                <div className="absolute inset-0 opacity-20 pointer-events-none">
                  <div className="absolute top-1/4 left-1/4 right-1/4 bottom-0 border-2 border-dashed border-cyan-500/40 rounded-t-lg" />
                  <div className="absolute top-1/4 left-1/2 bottom-0 w-0.5 bg-cyan-500/30" />
                  <div className="absolute top-1/3 left-1/3 right-1/3 h-1/2 bg-cyan-500/5 rounded" />
                </div>

                <div className="text-center space-y-2 relative z-0">
                  <div className="inline-flex p-3 rounded-2xl bg-slate-800/80 text-cyan-400 border border-slate-700/80">
                    <Camera className="w-8 h-8" />
                  </div>
                  <div className="text-xs font-mono text-slate-400">
                    Office Entrance Portal &bull; Door Sensor Active
                  </div>
                </div>
              </div>
            )}

            {/* Virtual Tripwire Overlay */}
            <div 
              className="absolute left-0 right-0 border-t-2 border-dashed border-yellow-400/80 flex items-center justify-between px-4 text-[10px] font-mono text-yellow-300 pointer-events-none z-10"
              style={{ top: `${tripwireRatio}%` }}
            >
              <span className="bg-slate-900/90 px-1.5 py-0.5 rounded border border-yellow-500/30">
                TRIPWIRE (Direction: &darr; IN / &uarr; OUT)
              </span>
              <span className="bg-slate-900/90 px-1.5 py-0.5 rounded border border-yellow-500/30">
                LINE_Y: {tripwireRatio}%
              </span>
            </div>

            {/* Simulated Detected Face Bounding Box Overlay */}
            {activeDetection && activeDetection.active && (
              <div
                className={`absolute w-36 h-44 rounded-lg border-2 transition-all duration-500 flex flex-col justify-between p-2 z-20 ${
                  activeDetection.isUnauthorized
                    ? 'border-red-500 bg-red-500/10 shadow-lg shadow-red-500/30 animate-pulse'
                    : activeDetection.cooldownBlocked
                    ? 'border-amber-400 bg-amber-400/10 shadow-lg shadow-amber-400/20'
                    : 'border-emerald-400 bg-emerald-400/10 shadow-lg shadow-emerald-400/20'
                }`}
                style={{
                  top: `${Math.max(10, Math.min(60, activeDetection.yPosition - 15))}%`,
                  left: '42%'
                }}
              >
                {/* Top Badge: Name & Confidence */}
                <div className="bg-slate-950/90 px-2 py-1 rounded text-[11px] font-mono text-white flex items-center justify-between border border-slate-800">
                  <span className="truncate font-semibold max-w-[80px]">
                    {activeDetection.isUnauthorized ? 'UNKNOWN' : activeDetection.name.split(' ')[0]}
                  </span>
                  <span className={activeDetection.isUnauthorized ? 'text-red-400' : 'text-emerald-400'}>
                    {Math.round(activeDetection.confidence * 100)}%
                  </span>
                </div>

                {/* 5 Facial Landmark Dots */}
                <div className="flex justify-around my-auto opacity-75">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                </div>

                {/* Bottom Badge: Direction or Warning */}
                <div className={`px-2 py-0.5 rounded text-[10px] font-mono text-center font-semibold ${
                  activeDetection.isUnauthorized
                    ? 'bg-red-500 text-white'
                    : activeDetection.cooldownBlocked
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-emerald-500 text-white'
                }`}>
                  {activeDetection.isUnauthorized
                    ? 'ACCESS DENIED'
                    : activeDetection.cooldownBlocked
                    ? 'COOLDOWN BLOCKED'
                    : `${activeDetection.direction} LOGGED`}
                </div>
              </div>
            )}

            {/* Bottom Stream OSD Overlay */}
            <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-[10px] font-mono text-slate-400 pointer-events-none z-10">
              <span className="bg-slate-900/80 px-2 py-0.5 rounded backdrop-blur">
                MODEL: InsightFace SCRFD+ArcFace
              </span>
              <span className="bg-slate-900/80 px-2 py-0.5 rounded backdrop-blur">
                WDR: {wdrEnabled ? 'ON (120dB)' : 'OFF'}
              </span>
            </div>

          </div>

          {/* Alert / Notification Bar below feed */}
          {activeDetection && (
            <div className={`p-3 text-xs flex items-center justify-between border-t ${
              activeDetection.isUnauthorized
                ? 'bg-red-950/50 border-red-900 text-red-300'
                : activeDetection.cooldownBlocked
                ? 'bg-amber-950/50 border-amber-900 text-amber-300'
                : 'bg-emerald-950/50 border-emerald-900 text-emerald-300'
            }`}>
              <div className="flex items-center gap-2">
                {activeDetection.isUnauthorized ? (
                  <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
                ) : activeDetection.cooldownBlocked ? (
                  <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span className="font-mono">{activeDetection.message}</span>
              </div>

              <button
                onClick={() => setActiveDetection(null)}
                className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-900/60"
              >
                Dismiss
              </button>
            </div>
          )}

          {webcamError && (
            <div className="p-3 bg-red-950/60 border-t border-red-900 text-xs text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span>{webcamError}</span>
            </div>
          )}
        </div>

        {/* Cooldown Active Devices Bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              Anti-Flicker Debounce Cooldown Cache (30s)
            </h4>
            <span className="text-[11px] text-slate-400 font-mono">
              Prevents duplicate scans at door
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {Object.keys(cooldownTimeouts).length === 0 ? (
              <span className="text-xs text-slate-400 italic">No cooldowns currently active. All team members can scan.</span>
            ) : (
              Object.entries(cooldownTimeouts).map(([empId, remaining]) => {
                const emp = employees.find(e => e.id === empId);
                return (
                  <div
                    key={empId}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono"
                  >
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-slate-300">{emp?.name || empId}:</span>
                    <span className="text-amber-400 font-semibold">{remaining}s left</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Right Column: Simulation Control Deck & Engine Config (5 cols) */}
      <div className="lg:col-span-5 space-y-6">
        
        {/* Quick Simulation Action Buttons */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-white">
                Entrance Event Trigger Deck
              </h3>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
              Simulate IP Cam
            </span>
          </div>

          <div className="space-y-2.5">
            
            {/* Alex Vance Entering */}
            <button
              onClick={() => triggerScan('EMP-001', 'Alex Vance', 'IN', 0.962)}
              disabled={isScanning}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-500/40 text-left transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                  <ArrowDown className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white group-hover:text-emerald-300">
                    Alex Vance &bull; Check-IN
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Simulate arrival (Top &rarr; Down direction, 96.2% match)
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-slate-800 text-emerald-400">
                Trigger
              </span>
            </button>

            {/* Sarah Connor Entering */}
            <button
              onClick={() => triggerScan('EMP-002', 'Sarah Connor', 'IN', 0.948)}
              disabled={isScanning}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-500/40 text-left transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                  <ArrowDown className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white group-hover:text-emerald-300">
                    Sarah Connor &bull; Check-IN
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Lead ML Engineer entrance (94.8% confidence)
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-slate-800 text-emerald-400">
                Trigger
              </span>
            </button>

            {/* David Kim Leaving */}
            <button
              onClick={() => triggerScan('EMP-005', 'David Kim', 'OUT', 0.941)}
              disabled={isScanning}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-blue-500/40 text-left transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs">
                  <ArrowUp className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white group-hover:text-blue-300">
                    David Kim &bull; Check-OUT
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Leaving office (Bottom &rarr; Up direction)
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-slate-800 text-blue-400">
                Trigger
              </span>
            </button>

            {/* Unauthorized Face Intruder Test */}
            <button
              onClick={() => triggerScan(null, 'Unknown Individual', 'IN', 0.38)}
              disabled={isScanning}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-red-950/20 hover:bg-red-950/40 border border-red-900/60 hover:border-red-500/60 text-left transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center font-bold text-xs">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-red-200 group-hover:text-red-100">
                    Unknown / Unauthorized Person
                  </div>
                  <div className="text-[11px] text-red-400/80">
                    Simulate stranger walk-in (Cosine similarity &lt; 0.68)
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-red-900/40 text-red-300">
                Alert
              </span>
            </button>

            {/* Test Debounce Spam */}
            <button
              onClick={() => {
                triggerScan('EMP-001', 'Alex Vance', 'IN', 0.96);
                setTimeout(() => triggerScan('EMP-001', 'Alex Vance', 'IN', 0.96), 600);
              }}
              disabled={isScanning}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition-all cursor-pointer"
            >
              <div className="flex items-center gap-2 text-xs text-amber-400">
                <Clock className="w-4 h-4" />
                <span>Test Rapid Spam (Triggers 30s Cooldown Block)</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">Test Debounce</span>
            </button>

          </div>
        </div>

        {/* RTSP & CV Engine Config Parameters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4 text-xs">
          <h3 className="text-sm font-semibold text-white pb-2 border-b border-slate-800 flex items-center gap-2">
            <Eye className="w-4 h-4 text-cyan-400" />
            Computer Vision Hyperparameters
          </h3>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Cosine Similarity Threshold:</span>
                <span className="font-mono text-cyan-400">0.68</span>
              </div>
              <p className="text-[11px] text-slate-400">
                ArcFace normalized 512-dim embedding threshold. Scores &ge;0.68 are verified matches.
              </p>
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Tripwire Y-Threshold:</span>
                <span className="font-mono text-yellow-400">{tripwireRatio}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="80"
                value={tripwireRatio}
                onChange={(e) => setTripwireRatio(parseInt(e.target.value))}
                className="w-full accent-yellow-400 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <div>
                <span className="text-slate-200 font-medium">Hardware WDR (Wide Dynamic Range):</span>
                <p className="text-[11px] text-slate-400">Mitigates glass door morning sunlight silhouetting</p>
              </div>
              <button
                onClick={() => setWdrEnabled(!wdrEnabled)}
                className={`px-3 py-1 rounded text-xs font-mono font-semibold cursor-pointer ${
                  wdrEnabled ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {wdrEnabled ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
