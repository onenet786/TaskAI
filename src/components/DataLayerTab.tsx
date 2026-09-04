import React, { useState } from 'react';
import { Database, Plus, Search, Filter, CheckCircle2, Clock, AlertCircle, UserCheck, UserX, Calendar, ShieldCheck, Tag } from 'lucide-react';
import { Employee, AttendanceRecord, TaskItem, TaskPriority, TaskStatus } from '../types';

interface DataLayerTabProps {
  employees: Employee[];
  attendanceLogs: AttendanceRecord[];
  tasks: TaskItem[];
  onTaskCreated: (task: TaskItem) => void;
  onTaskStatusUpdated: (taskId: string, newStatus: TaskStatus) => void;
}

export const DataLayerTab: React.FC<DataLayerTabProps> = ({
  employees,
  attendanceLogs,
  tasks,
  onTaskCreated,
  onTaskStatusUpdated
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'presence' | 'tasks' | 'logs'>('presence');
  const [searchTerm, setSearchTerm] = useState('');
  const [taskFilterStatus, setTaskFilterStatus] = useState<string>('all');
  const [taskFilterAssignee, setTaskFilterAssignee] = useState<string>('all');
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);

  // New task form state
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newEmpId, setNewEmpId] = useState(employees[0]?.id || 'EMP-001');
  const [newPriority, setNewPriority] = useState<TaskPriority>('Medium');
  const [newDueDate, setNewDueDate] = useState(new Date().toISOString().split('T')[0]);

  // Compute active presence: latest status per employee
  const presenceList = employees.map(emp => {
    const empLogs = attendanceLogs
      .filter(l => l.employee_id === emp.id)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const isPresent = empLogs.length > 0 && empLogs[0].status === 'IN';
    const latestLog = empLogs[0];
    
    // Check if late arrival (first check in after 9:30 AM)
    const firstIn = attendanceLogs
      .filter(l => l.employee_id === emp.id && l.status === 'IN')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
    
    let isLate = false;
    if (firstIn) {
      const d = new Date(firstIn.timestamp);
      if (d.getHours() > 9 || (d.getHours() === 9 && d.getMinutes() > 30)) {
        isLate = true;
      }
    }

    return {
      employee: emp,
      isPresent,
      latestLog,
      isLate,
      firstInTime: firstIn ? new Date(firstIn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
    };
  });

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const emp = employees.find(e => e.id === newEmpId);
    const created: TaskItem = {
      task_id: `TSK-${Math.floor(100 + Math.random() * 900)}`,
      employee_id: newEmpId,
      employee_name: emp?.name || 'Unknown',
      title: newTitle.trim(),
      description: newDesc.trim(),
      priority: newPriority,
      due_date: newDueDate,
      status: 'Pending',
      assigned_date: new Date().toISOString().split('T')[0]
    };

    onTaskCreated(created);
    setNewTitle('');
    setNewDesc('');
    setIsNewTaskOpen(false);
  };

  const filteredTasks = tasks.filter(t => {
    if (taskFilterStatus !== 'all' && t.status !== taskFilterStatus) return false;
    if (taskFilterAssignee !== 'all' && t.employee_id !== taskFilterAssignee) return false;
    if (searchTerm && !t.title.toLowerCase().includes(searchTerm.toLowerCase()) && !t.employee_name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const filteredLogs = attendanceLogs.filter(l => {
    if (searchTerm && !l.name.toLowerCase().includes(searchTerm.toLowerCase()) && !l.employee_id.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      
      {/* Sub-navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('presence')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeSubTab === 'presence'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            Live Presence Board ({presenceList.filter(p => p.isPresent).length}/{employees.length} IN)
          </button>

          <button
            onClick={() => setActiveSubTab('tasks')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeSubTab === 'tasks'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            Tasks Management ({tasks.filter(t => t.status !== 'Done').length} Pending)
          </button>

          <button
            onClick={() => setActiveSubTab('logs')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeSubTab === 'logs'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            Attendance Logs ({attendanceLogs.length})
          </button>
        </div>

        {activeSubTab === 'tasks' && (
          <button
            onClick={() => setIsNewTaskOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow-md shadow-cyan-600/20 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create New Task</span>
          </button>
        )}
      </div>

      {/* VIEW 1: LIVE PRESENCE BOARD */}
      {activeSubTab === 'presence' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>
              Real-time office presence status derived from entrance RTSP facial scans.
            </span>
            <span className="font-mono">
              Status = IN (no matching OUT)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {presenceList.map(({ employee, isPresent, latestLog, isLate, firstInTime }) => (
              <div
                key={employee.id}
                className={`p-4 rounded-2xl border transition-all ${
                  isPresent
                    ? 'bg-slate-900/90 border-emerald-500/40 shadow-lg shadow-emerald-500/5'
                    : 'bg-slate-900/50 border-slate-800 opacity-80'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <img
                      src={employee.avatar}
                      alt={employee.name}
                      className="w-12 h-12 rounded-xl object-cover border border-slate-700"
                    />
                    <div>
                      <h4 className="text-sm font-semibold text-white">
                        {employee.name}
                      </h4>
                      <p className="text-xs text-slate-400">{employee.role}</p>
                      <p className="text-[11px] text-slate-400">{employee.department}</p>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 ${
                      isPresent
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {isPresent ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                    {isPresent ? 'IN OFFICE' : 'CHECKED OUT'}
                  </span>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div>
                    <span className="text-slate-400 block text-[10px]">FIRST IN:</span>
                    <span className="text-slate-200">{firstInTime || 'No log'}</span>
                    {isLate && (
                      <span className="ml-1 text-[9px] text-amber-400 font-sans font-semibold">
                        (Late)
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">CONFIDENCE:</span>
                    <span className={isPresent ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                      {latestLog ? `${Math.round(latestLog.confidence_score * 100)}%` : 'N/A'}
                    </span>
                  </div>
                </div>

                <div className="mt-2 text-[10px] text-slate-400 truncate font-mono">
                  Embedding: {employee.face_embeddings_ref}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 2: TASKS MANAGEMENT */}
      {activeSubTab === 'tasks' && (
        <div className="space-y-4">
          
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search tasks or assignees..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">Status:</span>
              <select
                value={taskFilterStatus}
                onChange={(e) => setTaskFilterStatus(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="In Progress">In Progress</option>
                <option value="Done">Done</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">Assignee:</span>
              <select
                value={taskFilterAssignee}
                onChange={(e) => setTaskFilterAssignee(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none"
              >
                <option value="all">All Employees</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tasks Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTasks.map(task => {
              const priorityColors = {
                Critical: 'bg-red-500/20 text-red-300 border-red-500/30',
                High: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
                Medium: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
                Low: 'bg-slate-800 text-slate-400 border-slate-700'
              };

              const statusColors = {
                'Pending': 'text-amber-400 bg-amber-400/10 border-amber-400/30',
                'In Progress': 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',
                'Done': 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
              };

              return (
                <div
                  key={task.task_id}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-slate-400">
                        {task.task_id}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${priorityColors[task.priority]}`}>
                        {task.priority}
                      </span>
                    </div>

                    <h4 className="text-sm font-semibold text-white leading-snug">
                      {task.title}
                    </h4>
                    
                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                      {task.description}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Assignee:</span>
                      <span className="text-slate-200 font-medium">{task.employee_name}</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-slate-400">Due Date:</span>
                      <span className="text-slate-300">{task.due_date}</span>
                    </div>

                    {/* Status Switcher */}
                    <div className="pt-2 flex items-center justify-between">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[task.status]}`}>
                        {task.status}
                      </span>

                      <div className="flex items-center gap-1">
                        {task.status !== 'Pending' && (
                          <button
                            onClick={() => onTaskStatusUpdated(task.task_id, 'Pending')}
                            className="px-2 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                          >
                            Pending
                          </button>
                        )}
                        {task.status !== 'In Progress' && (
                          <button
                            onClick={() => onTaskStatusUpdated(task.task_id, 'In Progress')}
                            className="px-2 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-slate-700 text-cyan-300"
                          >
                            Progress
                          </button>
                        )}
                        {task.status !== 'Done' && (
                          <button
                            onClick={() => onTaskStatusUpdated(task.task_id, 'Done')}
                            className="px-2 py-0.5 text-[10px] rounded bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800"
                          >
                            Done
                          </button>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}

      {/* VIEW 3: ATTENDANCE LOGS TABLE */}
      {activeSubTab === 'logs' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              Raw Attendance Logs Database (Table: attendance_logs)
            </h3>
            <span className="text-xs font-mono text-slate-400">
              Total {attendanceLogs.length} events logged
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px]">
                <tr>
                  <th className="p-3">Log ID</th>
                  <th className="p-3">Employee</th>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Confidence</th>
                  <th className="p-3">Camera ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredLogs.map(log => (
                  <tr key={log.log_id} className="hover:bg-slate-800/40">
                    <td className="p-3 font-mono text-slate-400">{log.log_id}</td>
                    <td className="p-3 font-semibold text-slate-200">
                      <div>{log.name}</div>
                      <div className="text-[10px] font-mono text-slate-400">{log.employee_id}</div>
                    </td>
                    <td className="p-3 font-mono text-slate-300">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="p-3 font-mono">
                      <span className={`px-2 py-0.5 rounded font-bold ${
                        log.status === 'IN'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-emerald-400 font-semibold">
                      {Math.round(log.confidence_score * 100)}%
                    </td>
                    <td className="p-3 font-mono text-slate-400 text-[11px]">{log.camera_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Create Task */}
      {isNewTaskOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">Create Office Task</h3>
            <form onSubmit={handleCreateTask} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Task Title</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Calibrate optical door sensor"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-cyan-500 text-xs"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Assignee</label>
                <select
                  value={newEmpId}
                  onChange={(e) => setNewEmpId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-cyan-500 text-xs"
                >
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.role})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={2}
                  placeholder="Details and acceptance criteria..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-cyan-500 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-cyan-500 text-xs"
                  >
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-cyan-500 text-xs"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewTaskOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold cursor-pointer"
                >
                  Save Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
