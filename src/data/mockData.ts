import { Employee, AttendanceRecord, TaskItem } from '../types';

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    id: 'EMP-001',
    name: 'Alex Vance',
    role: 'Lead Systems Architect',
    department: 'IoT & Edge Computing',
    face_embeddings_ref: 'models/embeddings/emp_001_alex.npy (512-dim MobileFaceNet)',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    registered_date: '2025-01-15',
    email: 'alex.vance@edgeoffice.internal'
  },
  {
    id: 'EMP-002',
    name: 'Sarah Connor',
    role: 'Staff ML Engineer',
    department: 'Computer Vision',
    face_embeddings_ref: 'models/embeddings/emp_002_sarah.npy (512-dim InsightFace)',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    registered_date: '2025-02-01',
    email: 'sarah.connor@edgeoffice.internal'
  },
  {
    id: 'EMP-003',
    name: 'Marcus Brody',
    role: 'Operations & Facilities Director',
    department: 'Office Infrastructure',
    face_embeddings_ref: 'models/embeddings/emp_003_marcus.npy (512-dim ArcFace)',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    registered_date: '2024-11-10',
    email: 'marcus.brody@edgeoffice.internal'
  },
  {
    id: 'EMP-004',
    name: 'Elena Rostova',
    role: 'Firmware Engineer',
    department: 'IoT & Sensors',
    face_embeddings_ref: 'models/embeddings/emp_004_elena.npy (512-dim MobileFaceNet)',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    registered_date: '2025-03-01',
    email: 'elena.rostova@edgeoffice.internal'
  },
  {
    id: 'EMP-005',
    name: 'David Kim',
    role: 'Frontend & Audio Pipeline Dev',
    department: 'Human Interface',
    face_embeddings_ref: 'models/embeddings/emp_005_david.npy (512-dim ArcFace)',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    registered_date: '2025-02-20',
    email: 'david.kim@edgeoffice.internal'
  },
  {
    id: 'EMP-006',
    name: 'Maya Lin',
    role: 'Security & Compliance Analyst',
    department: 'IT Security',
    face_embeddings_ref: 'models/embeddings/emp_006_maya.npy (512-dim InsightFace)',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    registered_date: '2025-01-28',
    email: 'maya.lin@edgeoffice.internal'
  }
];

// Helper to get formatted timestamps for today
const today = new Date().toISOString().split('T')[0];
const makeTime = (hour: number, minute: number) => {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

export const INITIAL_ATTENDANCE: AttendanceRecord[] = [
  {
    log_id: 'LOG-1001',
    employee_id: 'EMP-001',
    name: 'Alex Vance',
    timestamp: makeTime(8, 42),
    status: 'IN',
    confidence_score: 0.962,
    camera_id: 'RTSP-CAM-01-ENTRANCE',
    direction: 'entry'
  },
  {
    log_id: 'LOG-1002',
    employee_id: 'EMP-002',
    name: 'Sarah Connor',
    timestamp: makeTime(9, 15),
    status: 'IN',
    confidence_score: 0.948,
    camera_id: 'RTSP-CAM-01-ENTRANCE',
    direction: 'entry'
  },
  {
    log_id: 'LOG-1003',
    employee_id: 'EMP-004',
    name: 'Elena Rostova',
    timestamp: makeTime(9, 38), // Note: Late arrival after 9:30 AM
    status: 'IN',
    confidence_score: 0.971,
    camera_id: 'RTSP-CAM-01-ENTRANCE',
    direction: 'entry'
  },
  {
    log_id: 'LOG-1004',
    employee_id: 'EMP-005',
    name: 'David Kim',
    timestamp: makeTime(8, 55),
    status: 'IN',
    confidence_score: 0.935,
    camera_id: 'RTSP-CAM-01-ENTRANCE',
    direction: 'entry'
  },
  {
    log_id: 'LOG-1005',
    employee_id: 'EMP-005',
    name: 'David Kim',
    timestamp: makeTime(11, 30),
    status: 'OUT',
    confidence_score: 0.941,
    camera_id: 'RTSP-CAM-01-ENTRANCE',
    direction: 'exit'
  }
];

export const INITIAL_TASKS: TaskItem[] = [
  {
    task_id: 'TSK-201',
    employee_id: 'EMP-002',
    employee_name: 'Sarah Connor',
    title: 'Quantize InsightFace SCRFD model to ONNX INT8 for Jetson Orin',
    description: 'Optimize the face detection backbone for sub-15ms inference latency on the door entrance edge device.',
    priority: 'Critical',
    due_date: today,
    status: 'In Progress',
    assigned_date: '2026-09-02'
  },
  {
    task_id: 'TSK-202',
    employee_id: 'EMP-002',
    employee_name: 'Sarah Connor',
    title: 'Calibrate WDR lighting compensation threshold on RTSP stream',
    description: 'Ensure recognition confidence remains above 0.90 during strong morning sunrise backlight on glass entrance.',
    priority: 'High',
    due_date: today,
    status: 'Pending',
    assigned_date: '2026-09-03'
  },
  {
    task_id: 'TSK-203',
    employee_id: 'EMP-001',
    employee_name: 'Alex Vance',
    title: 'Deploy Piper TTS voice models with local CUDA acceleration',
    description: 'Benchmark en_US-lessac-medium vs Ryan voice for sub-90ms first audio chunk latency on the office TV host.',
    priority: 'High',
    due_date: today,
    status: 'Pending',
    assigned_date: '2026-09-01'
  },
  {
    task_id: 'TSK-204',
    employee_id: 'EMP-001',
    employee_name: 'Alex Vance',
    title: 'Configure RTSP H.264 hardware decoding with FFmpeg vaapi',
    description: 'Drop CPU utilization on door stream decoding from 28% to under 6% on the Intel NUC.',
    priority: 'Medium',
    due_date: '2026-09-07',
    status: 'Done',
    assigned_date: '2026-08-30'
  },
  {
    task_id: 'TSK-205',
    employee_id: 'EMP-004',
    employee_name: 'Elena Rostova',
    title: 'Solder and test magnetic door relay latch with GPIO trigger',
    description: 'Connect dry-contact relay to the access control box for automated door unlocking on authorized match.',
    priority: 'Critical',
    due_date: today,
    status: 'Pending',
    assigned_date: '2026-09-02'
  },
  {
    task_id: 'TSK-206',
    employee_id: 'EMP-003',
    employee_name: 'Marcus Brody',
    title: 'Order replacement PoE+ injector for entrance PTZ camera',
    description: 'Current 15W injector is insufficient for IR night illumination ring.',
    priority: 'Medium',
    due_date: '2026-09-08',
    status: 'In Progress',
    assigned_date: '2026-09-03'
  },
  {
    task_id: 'TSK-207',
    employee_id: 'EMP-006',
    employee_name: 'Maya Lin',
    title: 'Audit facial vector database for GDPR/BIPA consent compliance',
    description: 'Verify 512-dim embedding storage isolation, salt keys, and employee opt-in biometric agreements.',
    priority: 'High',
    due_date: '2026-09-09',
    status: 'In Progress',
    assigned_date: '2026-09-01'
  }
];
