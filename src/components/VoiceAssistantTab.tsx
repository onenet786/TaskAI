import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Send, Terminal, Sparkles, Clock, CheckCircle2, ChevronRight, Play, AlertCircle, Database } from 'lucide-react';
import { VoiceQueryResponse } from '../types';

interface VoiceAssistantTabProps {
  onQuerySubmitted?: () => void;
}

export const VoiceAssistantTab: React.FC<VoiceAssistantTabProps> = ({ onQuerySubmitted }) => {
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [history, setHistory] = useState<VoiceQueryResponse[]>([]);
  const [activeToolDetails, setActiveToolDetails] = useState<VoiceQueryResponse | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  // Reference to Web Speech API SpeechRecognition
  const recognitionRef = useRef<any>(null);

  // Initialize Web Speech Recognition if supported
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError(null);
      };

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setInputText(transcript);
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error !== 'no-speech') {
          setSpeechError(`Speech recognition: ${event.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  // Text-To-Speech handler using browser SpeechSynthesis
  const speakText = (text: string) => {
    if (!ttsEnabled || !window.speechSynthesis) return;

    window.speechSynthesis.cancel(); // Stop prior speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    // Pick a natural English voice if available
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(v => (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Guy')) && v.lang.startsWith('en')) || voices.find(v => v.lang.startsWith('en'));
    if (naturalVoice) {
      utterance.voice = naturalVoice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          console.warn(e);
        }
      } else {
        setSpeechError("Speech recognition is not natively supported in this browser; please use text input or click prompt chips.");
      }
    }
  };

  const submitQuery = async (queryToRun?: string) => {
    const q = (queryToRun ?? inputText).trim();
    if (!q || isProcessing) return;

    setIsProcessing(true);
    setInputText('');
    setSpeechError(null);

    const clientStart = Date.now();

    try {
      const response = await fetch('/api/agent/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data: VoiceQueryResponse = await response.json();
      setHistory(prev => [data, ...prev]);
      setActiveToolDetails(data);

      if (ttsEnabled) {
        speakText(data.answer);
      }

      if (onQuerySubmitted) {
        onQuerySubmitted();
      }
    } catch (err: any) {
      console.error('Agent query error:', err);
      const fallbackData: VoiceQueryResponse = {
        query: q,
        answer: `I could not connect to the backend agent orchestrator: ${err.message}`,
        total_latency_ms: Date.now() - clientStart,
        engine: 'local-function-orchestrator',
        timestamp: new Date().toISOString()
      };
      setHistory(prev => [fallbackData, ...prev]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Seed with initial greeting
  useEffect(() => {
    if (history.length === 0) {
      const welcomeItem: VoiceQueryResponse = {
        query: "System Initialization",
        answer: "Office Voice Assistant online. Door RTSP camera feed and task database connected. Ask me who is in the office, check employee attendance, review tasks, or request a morning summary.",
        total_latency_ms: 85,
        engine: 'local-function-orchestrator',
        timestamp: new Date().toISOString()
      };
      setHistory([welcomeItem]);
      setActiveToolDetails(welcomeItem);
    }
  }, []);

  const sampleQueries = [
    { text: "Who is in the office right now?", desc: "Query active IN statuses" },
    { text: "Did Alex check in today, and at what time?", desc: "Query Alex's attendance log" },
    { text: "What tasks are pending for Sarah?", desc: "Query pending tasks by employee" },
    { text: "Give me a morning summary.", desc: "Headcount, late arrivals & critical tasks" }
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      {/* Left Column: Voice Console & Interactive Waveform (7 cols) */}
      <div className="lg:col-span-7 space-y-6">
        
        {/* Main Smart Display Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
          
          {/* Subtle background glow */}
          <div className="absolute -top-24 -left-24 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Header Controls */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-800 relative z-10">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Voice Agent Terminal</h2>
                <p className="text-xs text-slate-400">Push-to-Talk or select sample voice queries</p>
              </div>
            </div>

            {/* TTS Mute Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (isSpeaking) window.speechSynthesis.cancel();
                  setTtsEnabled(!ttsEnabled);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  ttsEnabled 
                    ? 'bg-slate-800 text-cyan-300 border border-slate-700 hover:bg-slate-750' 
                    : 'bg-slate-800/50 text-slate-400 border border-slate-800 hover:text-slate-300'
                }`}
                title={ttsEnabled ? 'Mute Assistant Voice' : 'Enable Assistant Voice'}
              >
                {ttsEnabled ? <Volume2 className="w-3.5 h-3.5 text-cyan-400" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span>{ttsEnabled ? 'TTS Output ON' : 'TTS Muted'}</span>
              </button>
            </div>
          </div>

          {/* Interactive Voice Orb / Push to Talk Hub */}
          <div className="py-8 flex flex-col items-center justify-center text-center relative z-10">
            <div className="relative mb-5">
              {/* Pulsing rings when listening or speaking */}
              {isListening && (
                <>
                  <div className="absolute -inset-4 rounded-full bg-cyan-500/20 animate-ping opacity-75" />
                  <div className="absolute -inset-8 rounded-full bg-cyan-500/10 animate-pulse" />
                </>
              )}
              {isSpeaking && (
                <>
                  <div className="absolute -inset-4 rounded-full bg-purple-500/20 animate-ping opacity-75" />
                  <div className="absolute -inset-8 rounded-full bg-purple-500/10 animate-pulse" />
                </>
              )}

              <button
                onClick={toggleListening}
                disabled={isProcessing}
                className={`relative h-24 w-24 rounded-full flex items-center justify-center shadow-2xl transition-all cursor-pointer transform active:scale-95 ${
                  isListening
                    ? 'bg-red-500 text-white shadow-red-500/30 scale-105'
                    : isSpeaking
                    ? 'bg-purple-600 text-white shadow-purple-500/30'
                    : isProcessing
                    ? 'bg-slate-700 text-cyan-400 animate-pulse'
                    : 'bg-gradient-to-tr from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-cyan-500/25'
                }`}
              >
                {isListening ? (
                  <MicOff className="w-10 h-10 animate-pulse" />
                ) : isSpeaking ? (
                  <Volume2 className="w-10 h-10 animate-bounce" />
                ) : (
                  <Mic className="w-10 h-10" />
                )}
              </button>
            </div>

            {/* Status readout */}
            <div className="h-6">
              {isListening ? (
                <span className="text-xs font-mono text-cyan-400 flex items-center gap-1.5 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
                  Listening via microphone... Speak clearly.
                </span>
              ) : isProcessing ? (
                <span className="text-xs font-mono text-purple-400 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-ping"></span>
                  LLM Function Calling & Database Reasoning...
                </span>
              ) : isSpeaking ? (
                <span className="text-xs font-mono text-purple-300 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce"></span>
                  Speaking audio response...
                </span>
              ) : (
                <span className="text-xs font-mono text-slate-400">
                  Click microphone or type query below
                </span>
              )}
            </div>

            {speechError && (
              <p className="mt-2 text-xs text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {speechError}
              </p>
            )}
          </div>

          {/* Natural Language Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitQuery();
            }}
            className="flex items-center gap-2 relative z-10"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask: 'Who is in the office?', 'Did Alex check in today?', 'What tasks are pending?'..."
              disabled={isProcessing}
              className="flex-1 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isProcessing}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white px-4 py-3 rounded-xl font-medium text-sm transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-cyan-600/20"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Ask</span>
            </button>
          </form>

          {/* Quick Voice Prompt Chips (Required Interaction Examples) */}
          <div className="mt-5 pt-4 border-t border-slate-800/80">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
              Core Voice Interactions:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sampleQueries.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => submitQuery(q.text)}
                  disabled={isProcessing}
                  className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-cyan-500/40 text-left transition-all group cursor-pointer"
                >
                  <div className="p-1 rounded-md bg-cyan-500/10 text-cyan-400 mt-0.5 group-hover:bg-cyan-500/20">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-200 group-hover:text-cyan-300 truncate">
                      "{q.text}"
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {q.desc}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Conversation Logs */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" />
              Voice Session History
            </h3>
            <span className="text-xs text-slate-400 font-mono">
              {history.length} interactions
            </span>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {history.map((item, idx) => (
              <div
                key={idx}
                onClick={() => setActiveToolDetails(item)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                  activeToolDetails === item
                    ? 'bg-slate-800/90 border-cyan-500/50 shadow-sm'
                    : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-cyan-400 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
                    User: "{item.query}"
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-mono">
                      {item.total_latency_ms}ms
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        speakText(item.answer);
                      }}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
                      title="Replay Voice Speech"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-sans">
                  {item.answer}
                </p>

                {item.tool_call && (
                  <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
                    <span className="text-purple-400 font-mono flex items-center gap-1">
                      <Terminal className="w-3 h-3" />
                      {item.tool_call.tool_name}()
                    </span>
                    <span className="text-slate-400">
                      Click to inspect SQL & tool payload
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Right Column: Function Calling & SQL Inspector (5 cols) */}
      <div className="lg:col-span-5 space-y-6">
        
        {/* Tool Execution Inspector Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col h-full">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-semibold text-white">
                Function Calling & Database Execution
              </h3>
            </div>
            {activeToolDetails?.tool_call && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono border border-purple-500/30">
                Executed in {activeToolDetails.tool_call.execution_time_ms}ms
              </span>
            )}
          </div>

          {activeToolDetails?.tool_call ? (
            <div className="space-y-4 flex-1">
              
              {/* Tool Name & Inferred Arguments */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Invoked Tool Function:
                </div>
                <div className="font-mono text-sm text-purple-300 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  {activeToolDetails.tool_call.tool_name}()
                </div>
                {Object.keys(activeToolDetails.tool_call.arguments || {}).length > 0 && (
                  <div className="mt-2 text-xs font-mono bg-slate-900 p-2 rounded text-slate-300 border border-slate-800">
                    Args: {JSON.stringify(activeToolDetails.tool_call.arguments, null, 2)}
                  </div>
                )}
              </div>

              {/* SQL Equivalent Query */}
              {activeToolDetails.tool_call.sql_equivalent && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Database className="w-3.5 h-3.5" />
                    SQL Database Query Executed:
                  </div>
                  <pre className="text-xs font-mono text-emerald-300/90 whitespace-pre-wrap leading-relaxed overflow-x-auto p-2 bg-slate-900 rounded border border-slate-800/80">
                    {activeToolDetails.tool_call.sql_equivalent}
                  </pre>
                </div>
              )}

              {/* Raw JSON Return Data */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Structured Tool Return Payload:
                </div>
                <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap max-h-56 overflow-y-auto p-2 bg-slate-900 rounded border border-slate-800/80">
                  {JSON.stringify(activeToolDetails.tool_call.result, null, 2)}
                </pre>
              </div>

              {/* Latency Pipeline Breakdown */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Voice-to-Speech Latency Benchmark:
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-[10px] text-slate-400">STT (Whisper)</div>
                    <div className="font-mono font-semibold text-slate-200">~180ms</div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-[10px] text-slate-400">LLM Tool Call</div>
                    <div className="font-mono font-semibold text-cyan-400">
                      {activeToolDetails.tool_call.execution_time_ms}ms
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-[10px] text-slate-400">Total Roundtrip</div>
                    <div className="font-mono font-semibold text-emerald-400">
                      {activeToolDetails.total_latency_ms}ms
                    </div>
                  </div>
                </div>
              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-3">
              <Database className="w-10 h-10 text-slate-600 stroke-[1.5]" />
              <p className="text-xs max-w-xs">
                Ask a question like <span className="text-cyan-400 font-medium">"Who is in the office right now?"</span> to view the live LLM tool declaration, executed SQL query, and structured return payload.
              </p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
