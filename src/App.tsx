import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { VoiceAssistantTab } from './components/VoiceAssistantTab';
import { DoorCamSimulatorTab } from './components/DoorCamSimulatorTab';
import { DataLayerTab } from './components/DataLayerTab';
import { ArchitectureTab } from './components/ArchitectureTab';
import { Employee, AttendanceRecord, TaskItem, TaskStatus } from './types';
import { INITIAL_EMPLOYEES, INITIAL_ATTENDANCE, INITIAL_TASKS } from './data/mockData';

export default function App() {
  const [activeTab, setActiveTab] = useState<'voice' | 'camera' | 'data' | 'architecture'>('voice');
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceRecord[]>(INITIAL_ATTENDANCE);
  const [tasks, setTasks] = useState<TaskItem[]>(INITIAL_TASKS);
  const [isResetting, setIsResetting] = useState(false);
  const [systemHealth, setSystemHealth] = useState<{
    status: string;
    gemini_configured: boolean;
    total_employees: number;
    attendance_records: number;
    tasks_count: number;
  } | null>(null);

  // Fetch initial system state from backend
  const refreshData = async () => {
    try {
      const [healthRes, empRes, attRes, taskRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/employees'),
        fetch('/api/attendance'),
        fetch('/api/tasks')
      ]);

      if (healthRes.ok) {
        setSystemHealth(await healthRes.json());
      }
      if (empRes.ok) {
        setEmployees(await empRes.json());
      }
      if (attRes.ok) {
        setAttendanceLogs(await attRes.json());
      }
      if (taskRes.ok) {
        setTasks(await taskRes.json());
      }
    } catch (err) {
      console.warn("Backend not ready or running in fallback mode:", err);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await fetch('/api/reset', { method: 'POST' });
      await refreshData();
    } catch (err) {
      console.error("Reset error:", err);
      // Fallback local reset
      setEmployees([...INITIAL_EMPLOYEES]);
      setAttendanceLogs([...INITIAL_ATTENDANCE]);
      setTasks([...INITIAL_TASKS]);
    } finally {
      setIsResetting(false);
    }
  };

  const handleScanLogged = (record: AttendanceRecord) => {
    setAttendanceLogs(prev => [record, ...prev]);
    if (systemHealth) {
      setSystemHealth({
        ...systemHealth,
        attendance_records: systemHealth.attendance_records + 1
      });
    }
  };

  const handleTaskCreated = async (newTask: TaskItem) => {
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTask)
      });
      if (res.ok) {
        const saved = await res.json();
        setTasks(prev => [saved, ...prev]);
      } else {
        setTasks(prev => [newTask, ...prev]);
      }
    } catch (err) {
      setTasks(prev => [newTask, ...prev]);
    }
  };

  const handleTaskStatusUpdated = async (taskId: string, newStatus: TaskStatus) => {
    setTasks(prev => prev.map(t => t.task_id === taskId ? { ...t, status: newStatus } : t));
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
    } catch (err) {
      console.error("Task update error:", err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500/20 selection:text-cyan-200">
      
      {/* Top Telemetry & Nav Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onReset={handleReset}
        isResetting={isResetting}
        systemHealth={systemHealth}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-[1800px] w-full mx-auto px-2 sm:px-3 lg:px-4 py-6">
        {activeTab === 'voice' && (
          <VoiceAssistantTab onQuerySubmitted={refreshData} />
        )}

        {activeTab === 'camera' && (
          <DoorCamSimulatorTab
            employees={employees}
            attendanceLogs={attendanceLogs}
            onScanLogged={handleScanLogged}
          />
        )}

        {activeTab === 'data' && (
          <DataLayerTab
            employees={employees}
            attendanceLogs={attendanceLogs}
            tasks={tasks}
            onTaskCreated={handleTaskCreated}
            onTaskStatusUpdated={handleTaskStatusUpdated}
          />
        )}

        {activeTab === 'architecture' && (
          <ArchitectureTab />
        )}
      </main>

      {/* Persistent Status Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-3 text-center text-xs text-slate-400 font-mono">
        <div className="max-w-[1800px] mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
            <span>Local Office IoT Cluster &bull; Node.js 20 (Express) + Face-API / ONNX + Gemini Reasoner</span>
          </div>
          <div className="text-slate-400">
            <span>RTSP Port: 554 &bull; PostgreSQL &bull; Mic VAD: Active</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
