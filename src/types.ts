export interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
  face_embeddings_ref: string;
  avatar: string;
  registered_date: string;
  email: string;
}

export interface AttendanceRecord {
  log_id: string;
  employee_id: string;
  name: string;
  timestamp: string;
  status: 'IN' | 'OUT';
  confidence_score: number;
  camera_id: string;
  direction?: 'entry' | 'exit';
}

export type TaskPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type TaskStatus = 'Pending' | 'In Progress' | 'Done';

export interface TaskItem {
  task_id: string;
  employee_id: string;
  employee_name: string;
  title: string;
  description: string;
  priority: TaskPriority;
  due_date: string;
  status: TaskStatus;
  assigned_date: string;
}

export interface ToolCallExecution {
  tool_name: string;
  arguments: Record<string, any>;
  result: any;
  sql_equivalent?: string;
  execution_time_ms: number;
}

export interface VoiceQueryResponse {
  query: string;
  answer: string;
  tool_call?: ToolCallExecution;
  total_latency_ms: number;
  stt_time_ms?: number;
  reasoning_time_ms?: number;
  tts_time_ms?: number;
  engine: 'gemini-3.8-flash' | 'local-function-orchestrator';
  timestamp: string;
}

export interface RTSPEvent {
  event_id: string;
  timestamp: string;
  employee_id: string | null;
  name: string;
  confidence: number;
  action: 'IN' | 'OUT' | 'UNAUTHORIZED' | 'COOLDOWN_BLOCKED';
  bbox?: [number, number, number, number];
  camera_id: string;
  message: string;
}
