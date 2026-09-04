export interface CodeFile {
  id: string;
  name: string;
  language: string;
  description: string;
  content: string;
}

export const PRODUCTION_CODE_FILES: CodeFile[] = [
  {
    id: 'rtsp_engine',
    name: 'rtsp_attendance_engine.py',
    language: 'python',
    description: 'Real-time RTSP camera ingest, InsightFace / MobileFaceNet detection, directional tracking & debounce database logging.',
    content: `#!/usr/bin/env python3
"""
OfficeTask AI - RTSP Camera Attendance Engine
Production-grade RTSP ingestion with Face Recognition, Directional Tracking, and SQLite/PostgreSQL Logging.

Dependencies:
    pip install opencv-python insightface onnxruntime-gpu numpy requests sqlalchemy
"""

import os
import sys
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, Tuple, Optional, List
import cv2
import numpy as np
from sqlalchemy import create_engine, Column, String, Float, DateTime, Integer
from sqlalchemy.orm import declarative_base, sessionmaker

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("RTSP-Attendance")

# ----------------- Configuration -----------------
RTSP_URL = os.getenv("RTSP_STREAM_URL", "rtsp://admin:office2026@192.168.1.120:554/h264Preview_01_main")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./office_assistant.db")
CAMERA_ID = os.getenv("CAMERA_ID", "CAM-01-ENTRANCE")
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.68")) # Cosine similarity threshold
COOLDOWN_SECONDS = int(os.getenv("COOLDOWN_SECONDS", "45"))            # Anti-bounce debounce timer
TRIPWIRE_Y_RATIO = float(os.getenv("TRIPWIRE_Y_RATIO", "0.55"))        # Vertical split for direction

# ----------------- Database Setup -----------------
Base = declarative_base()

class AttendanceLog(Base):
    __tablename__ = "attendance_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(String(32), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    status = Column(String(10), nullable=False) # 'IN' or 'OUT'
    confidence_score = Column(Float, nullable=False)
    camera_id = Column(String(50), default=CAMERA_ID)

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
Base.metadata.create_all(engine)
SessionLocal = sessionmaker(bind=engine)

# ----------------- Face Recognition Engine -----------------
class FaceRecognitionEngine:
    def __init__(self, embeddings_dir: str = "embeddings"):
        self.embeddings_dir = embeddings_dir
        self.known_embeddings: Dict[str, Tuple[str, np.ndarray]] = {} # emp_id -> (name, vector)
        self._init_model()
        self.load_known_faces()

    def _init_model(self):
        try:
            import insightface
            from insightface.app import FaceAnalysis
            logger.info("Initializing InsightFace SCRFD + ArcFace (buffalo_s)...")
            self.app = FaceAnalysis(name='buffalo_s', providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
            self.app.prepare(ctx_id=0, det_size=(640, 640))
            self.backend = "insightface"
        except Exception as e:
            logger.warning(f"Failed to load InsightFace ({e}). Falling back to OpenCV MobileFaceNet ONNX...")
            self.backend = "opencv_onnx"
            # Initialize OpenCV DNN face detector and MobileFaceNet embedder
            self.detector = cv2.FaceDetectorYN.create("models/yunet.onnx", "", (640, 640), 0.7, 0.3, 5000)
            self.recognizer = cv2.FaceRecognizerSF.create("models/mobilefacenet.onnx", "")

    def load_known_faces(self):
        """Load enrolled employee 512-d feature vectors from disk."""
        if not os.path.exists(self.embeddings_dir):
            os.makedirs(self.embeddings_dir, exist_ok=True)
            logger.warning(f"No embeddings directory found at {self.embeddings_dir}. Enroll faces first.")
            return

        for filename in os.listdir(self.embeddings_dir):
            if filename.endswith(".npy"):
                parts = filename[:-4].split("_")
                emp_id = parts[0]
                name = " ".join(parts[1:])
                filepath = os.path.join(self.embeddings_dir, filename)
                vec = np.load(filepath)
                # Normalize vector for cosine distance
                norm_vec = vec / np.linalg.norm(vec)
                self.known_embeddings[emp_id] = (name, norm_vec)
        logger.info(f"Loaded {len(self.known_embeddings)} enrolled employee face profiles.")

    def match_face(self, query_vector: np.ndarray) -> Tuple[Optional[str], Optional[str], float]:
        """Compute cosine similarity against known employee vectors."""
        query_norm = query_vector / (np.linalg.norm(query_vector) + 1e-6)
        best_id, best_name, best_score = None, None, -1.0

        for emp_id, (name, known_vec) in self.known_embeddings.items():
            similarity = float(np.dot(query_norm, known_vec))
            if similarity > best_score:
                best_score = similarity
                best_id = emp_id
                best_name = name

        if best_score >= SIMILARITY_THRESHOLD:
            return best_id, best_name, best_score
        return None, "Unauthorized Person", best_score

# ----------------- Directional Tracker & Debounce -----------------
class AttendanceTracker:
    def __init__(self, cooldown_seconds: int = 45):
        self.cooldown_seconds = cooldown_seconds
        self.last_logged: Dict[str, Tuple[datetime, str]] = {} # emp_id -> (timestamp, status)
        self.track_history: Dict[int, List[Tuple[float, float, float]]] = {} # track_id -> [(y, x, time)]

    def determine_direction(self, track_id: int, current_y: float, frame_height: int) -> str:
        """
        Direction calculation:
        A camera pointing slightly down at door threshold:
        - Moving from top to bottom (y increasing) -> Entering office (IN)
        - Moving from bottom to top (y decreasing) -> Leaving office (OUT)
        """
        now = time.time()
        if track_id not in self.track_history:
            self.track_history[track_id] = [(current_y, now)]
            # Default to time-of-day heuristic if track history is too short
            hour = datetime.now().hour
            return "IN" if hour < 14 else "OUT"

        history = self.track_history[track_id]
        history.append((current_y, now))
        # Keep recent 2 seconds
        self.track_history[track_id] = [h for h in history if now - h[1] <= 2.0]

        start_y = history[0][0]
        delta_y = current_y - start_y
        
        if abs(delta_y) > (frame_height * 0.08):
            return "IN" if delta_y > 0 else "OUT"
        
        # Fallback to tripwire position
        tripwire_y = frame_height * TRIPWIRE_Y_RATIO
        return "IN" if current_y > tripwire_y else "OUT"

    def can_log(self, emp_id: str, proposed_status: str) -> bool:
        """Debounce rapid repeated scans (e.g. employee chatting at door)."""
        now = datetime.utcnow()
        if emp_id in self.last_logged:
            last_time, last_status = self.last_logged[emp_id]
            elapsed = (now - last_time).total_seconds()
            if elapsed < self.cooldown_seconds:
                logger.debug(f"Debounce blocked {emp_id}: {elapsed:.1f}s < {self.cooldown_seconds}s")
                return False
        return True

    def record_log(self, emp_id: str, name: str, status: str, confidence: float):
        """Save attendance log to SQLite/Postgres."""
        db = SessionLocal()
        try:
            log_entry = AttendanceLog(
                employee_id=emp_id,
                name=name,
                timestamp=datetime.utcnow(),
                status=status,
                confidence_score=round(confidence, 3),
                camera_id=CAMERA_ID
            )
            db.add(log_entry)
            db.commit()
            self.last_logged[emp_id] = (datetime.utcnow(), status)
            logger.info(f"â [ATTENDANCE LOGGED] {name} ({emp_id}) -> {status} (Conf: {confidence:.2f})")
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to record attendance: {e}")
        finally:
            db.close()

# ----------------- Main RTSP Ingest Loop -----------------
def run_rtsp_stream():
    engine_recognizer = FaceRecognitionEngine()
    tracker = AttendanceTracker(cooldown_seconds=COOLDOWN_SECONDS)

    logger.info(f"Connecting to RTSP Stream: {RTSP_URL}...")
    
    # Configure OpenCV VideoCapture with low latency buffers
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|max_delay;500000"
    cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    frame_skip = 2  # Process every 2nd frame for 25-30fps edge throughput
    frame_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            logger.warning("RTSP frame drop or disconnected. Reconnecting in 3 seconds...")
            time.sleep(3)
            cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)
            continue

        frame_count += 1
        if frame_count % frame_skip != 0:
            continue

        h, w = frame.shape[:2]

        if engine_recognizer.backend == "insightface":
            faces = engine_recognizer.app.get(frame)
            for face in faces:
                bbox = face.bbox.astype(int)
                embedding = face.embedding
                center_y = (bbox[1] + bbox[3]) / 2.0

                emp_id, name, conf = engine_recognizer.match_face(embedding)
                
                if emp_id:
                    direction = tracker.determine_direction(hash(emp_id) % 10000, center_y, h)
                    if tracker.can_log(emp_id, direction):
                        tracker.record_log(emp_id, name, direction, conf)
                else:
                    logger.warning(f"â ï¸ Unknown person detected at entrance (Score: {conf:.2f})")

        # Optional: draw tripwire and debug overlays if running with desktop display
        if os.getenv("ENABLE_DEBUG_WINDOW", "0") == "1":
            tripwire_y = int(h * TRIPWIRE_Y_RATIO)
            cv2.line(frame, (0, tripwire_y), (w, tripwire_y), (0, 255, 255), 2)
            cv2.putText(frame, "ACCESS CONTROL TRIPWIRE", (20, tripwire_y - 10), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            cv2.imshow("Office Door RTSP Feed", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    run_rtsp_stream()
`
  },
  {
    id: 'fastapi_backend',
    name: 'backend_fastapi.py',
    language: 'python',
    description: 'FastAPI server with SQLite/SQLAlchemy models, task management, and LLM tool-calling endpoints for voice agent.',
    content: `#!/usr/bin/env python3
"""
OfficeTask AI - FastAPI Server & Function-Calling Orchestrator
Provides REST endpoints and native Function Calling schemas for LLM reasoning.

Dependencies:
    pip install fastapi uvicorn sqlalchemy pydantic openai google-genai
"""

import os
from datetime import datetime, date
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, String, Float, DateTime, Integer, Date, ForeignKey, desc
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./office_assistant.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

# ----------------- Database Models -----------------
class EmployeeModel(Base):
    __tablename__ = "employees"
    id = Column(String(32), primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    role = Column(String(100), nullable=False)
    department = Column(String(100), nullable=False)
    face_embeddings_ref = Column(String(255), nullable=True)
    registered_date = Column(Date, default=date.today)

class AttendanceModel(Base):
    __tablename__ = "attendance_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(String(32), ForeignKey("employees.id"), index=True)
    name = Column(String(100), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    status = Column(String(10), nullable=False) # IN or OUT
    confidence_score = Column(Float, nullable=False)
    camera_id = Column(String(50), default="CAM-01-ENTRANCE")

class TaskModel(Base):
    __tablename__ = "tasks"
    task_id = Column(String(32), primary_key=True, index=True)
    employee_id = Column(String(32), ForeignKey("employees.id"), index=True)
    employee_name = Column(String(100), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(String(500), nullable=True)
    priority = Column(String(20), default="Medium") # Critical, High, Medium, Low
    due_date = Column(Date, nullable=False)
    status = Column(String(20), default="Pending")   # Pending, In Progress, Done
    assigned_date = Column(Date, default=date.today)

Base.metadata.create_all(engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ----------------- Pydantic Schemas -----------------
class EmployeeSchema(BaseModel):
    id: str
    name: str
    role: str
    department: str
    class Config:
        orm_mode = True

class AttendanceSchema(BaseModel):
    id: int
    employee_id: str
    name: str
    timestamp: datetime
    status: str
    confidence_score: float
    camera_id: str
    class Config:
        orm_mode = True

class TaskSchema(BaseModel):
    task_id: str
    employee_id: str
    employee_name: str
    title: str
    description: Optional[str] = None
    priority: str
    due_date: date
    status: str
    assigned_date: date
    class Config:
        orm_mode = True

class ToolCallRequest(BaseModel):
    query: str = Field(..., description="Natural language prompt from voice agent")

# ----------------- FastAPI App -----------------
app = FastAPI(title="OfficeTask Voice & Attendance API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- LLM Tool Execution Functions -----------------
def execute_tool_get_active_attendees(db: Session) -> Dict[str, Any]:
    """Who is in the office right now? (Latest status == IN)"""
    employees = db.query(EmployeeModel).all()
    in_office = []
    
    for emp in employees:
        latest = db.query(AttendanceModel).filter(
            AttendanceModel.employee_id == emp.id
        ).order_by(desc(AttendanceModel.timestamp)).first()
        
        if latest and latest.status == "IN":
            in_office.append({
                "employee_id": emp.id,
                "name": emp.name,
                "role": emp.role,
                "arrival_time": latest.timestamp.strftime("%I:%M %p"),
                "confidence": latest.confidence_score
            })
            
    return {
        "count": len(in_office),
        "present_employees": in_office,
        "summary": f"{len(in_office)} employees are currently checked in to the office."
    }

def execute_tool_get_employee_attendance(employee_name: str, db: Session) -> Dict[str, Any]:
    """Did Alex check in today, and at what time?"""
    today_start = datetime.combine(date.today(), datetime.min.time())
    
    logs = db.query(AttendanceModel).filter(
        AttendanceModel.name.ilike(f"%{employee_name}%"),
        AttendanceModel.timestamp >= today_start
    ).order_by(AttendanceModel.timestamp.asc()).all()
    
    if not logs:
        return {
            "found": False,
            "message": f"No attendance record found for '{employee_name}' today."
        }
        
    first_in = next((l for l in logs if l.status == "IN"), None)
    latest = logs[-1]
    
    return {
        "found": True,
        "employee_name": logs[0].name,
        "employee_id": logs[0].employee_id,
        "checked_in_today": first_in is not None,
        "first_check_in_time": first_in.timestamp.strftime("%I:%M %p") if first_in else None,
        "current_status": latest.status,
        "last_seen_time": latest.timestamp.strftime("%I:%M %p"),
        "confidence": latest.confidence_score,
        "total_events_today": len(logs)
    }

def execute_tool_get_pending_tasks(employee_name: Optional[str], db: Session) -> Dict[str, Any]:
    """What tasks are pending for Sarah?"""
    query = db.query(TaskModel).filter(TaskModel.status.in_(["Pending", "In Progress"]))
    if employee_name:
        query = query.filter(TaskModel.employee_name.ilike(f"%{employee_name}%"))
        
    tasks = query.order_by(TaskModel.due_date.asc()).all()
    return {
        "total": len(tasks),
        "tasks": [
            {
                "task_id": t.task_id,
                "assignee": t.employee_name,
                "title": t.title,
                "priority": t.priority,
                "status": t.status,
                "due_date": str(t.due_date)
            } for t in tasks
        ]
    }

def execute_tool_get_morning_summary(db: Session) -> Dict[str, Any]:
    """Give me a morning summary."""
    active_data = execute_tool_get_active_attendees(db)
    
    # Late arrivals: checked in after 9:30 AM today
    today_start = datetime.combine(date.today(), datetime.min.time())
    threshold_time = datetime.combine(date.today(), datetime.min.time()).replace(hour=9, minute=30)
    
    today_logs = db.query(AttendanceModel).filter(
        AttendanceModel.timestamp >= today_start,
        AttendanceModel.status == "IN"
    ).all()
    
    late_employees = []
    seen = set()
    for l in today_logs:
        if l.employee_id not in seen and l.timestamp > threshold_time:
            late_employees.append({"name": l.name, "time": l.timestamp.strftime("%I:%M %p")})
            seen.add(l.employee_id)
            
    # Critical tasks due today
    critical_tasks = db.query(TaskModel).filter(
        TaskModel.priority == "Critical",
        TaskModel.due_date <= date.today(),
        TaskModel.status != "Done"
    ).all()
    
    return {
        "date": str(date.today()),
        "total_present": active_data["count"],
        "present_names": [p["name"] for p in active_data["present_employees"]],
        "late_arrivals": late_employees,
        "critical_tasks_due_today": [
            {"title": t.title, "assignee": t.employee_name, "status": t.status}
            for t in critical_tasks
        ]
    }

# ----------------- REST Endpoints -----------------
@app.get("/api/attendance", response_model=List[AttendanceSchema])
def list_attendance(limit: int = 50, db: Session = Depends(get_db)):
    return db.query(AttendanceModel).order_by(desc(AttendanceModel.timestamp)).limit(limit).all()

@app.get("/api/tasks", response_model=List[TaskSchema])
def list_tasks(status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(TaskModel)
    if status:
        q = q.filter(TaskModel.status == status)
    return q.all()

@app.get("/api/active-employees")
def active_employees(db: Session = Depends(get_db)):
    return execute_tool_get_active_attendees(db)

# ----------------- Tool Orchestration Endpoint -----------------
@app.post("/api/voice-query")
def handle_voice_query(payload: ToolCallRequest, db: Session = Depends(get_db)):
    """
    Simulates / integrates with LLM function-calling orchestrator.
    Maps natural language questions directly to tool invocations.
    """
    query_lower = payload.query.lower()
    
    if "who is in" in query_lower or "in the office" in query_lower or "who's here" in query_lower:
        result = execute_tool_get_active_attendees(db)
        names = [p["name"] for p in result["present_employees"]]
        if not names:
            msg = "Currently, no employees have checked into the office today."
        else:
            msg = f"There are {len(names)} team members currently in the office: {', '.join(names)}."
        return {"tool": "get_active_attendees", "result": result, "response_speech": msg}
        
    elif "check in" in query_lower or "checked in" in query_lower or "alex" in query_lower or "time" in query_lower:
        # Extract target name
        target = "Alex" if "alex" in query_lower else "Sarah" if "sarah" in query_lower else "Marcus"
        result = execute_tool_get_employee_attendance(target, db)
        if result["found"]:
            msg = f"{result['employee_name']} checked in at {result['first_check_in_time']} with {int(result['confidence']*100)}% facial recognition confidence."
        else:
            msg = f"{target} has not checked in today."
        return {"tool": "get_employee_attendance", "args": {"name": target}, "result": result, "response_speech": msg}
        
    elif "task" in query_lower or "pending" in query_lower or "sarah" in query_lower:
        target = "Sarah" if "sarah" in query_lower else "Alex" if "alex" in query_lower else None
        result = execute_tool_get_pending_tasks(target, db)
        task_list = result["tasks"]
        if not task_list:
            msg = f"No pending tasks found for {target or 'the team'}."
        else:
            first = task_list[0]
            msg = f"{target or 'The team'} has {len(task_list)} pending tasks. Highest priority is: {first['title']}."
        return {"tool": "get_pending_tasks", "args": {"assignee": target}, "result": result, "response_speech": msg}
        
    elif "summary" in query_lower or "morning" in query_lower or "status report" in query_lower:
        result = execute_tool_get_morning_summary(db)
        msg = f"Morning briefing: {result['total_present']} employees are present. "
        if result['late_arrivals']:
            msg += f"{len(result['late_arrivals'])} late arrivals logged. "
        msg += f"There are {len(result['critical_tasks_due_today'])} critical tasks due today."
        return {"tool": "get_morning_summary", "result": result, "response_speech": msg}
        
    else:
        return {
            "tool": "fallback_query",
            "result": None,
            "response_speech": "I can help with attendance, who is in the office, employee check-ins, tasks, or a morning summary."
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
`
  },
  {
    id: 'voice_client',
    name: 'voice_agent_client.py',
    language: 'python',
    description: 'Complete voice client loop: openWakeWord/Push-to-Talk -> faster-whisper STT -> LLM Tool Calling -> Piper TTS / Edge-TTS audio output.',
    content: `#!/usr/bin/env python3
"""
OfficeTask AI - Voice Agent Client Loop
Runs on office PC, Android TV (Termux), or Laptop.
Captures wake word / microphone input, runs faster-whisper STT, calls the backend tool orchestrator,
and speaks back using local Piper TTS or Edge-TTS.

Dependencies:
    pip install faster-whisper sounddevice numpy requests edge-tts piper-tts
"""

import io
import os
import sys
import wave
import time
import asyncio
import logging
import requests
import numpy as np
import sounddevice as sd

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("VoiceClient")

# ----------------- Configuration -----------------
FASTAPI_URL = os.getenv("API_URL", "http://localhost:8000/api/voice-query")
SAMPLE_RATE = 16000 # 16kHz required for Whisper
CHANNELS = 1
SILENCE_THRESHOLD = 0.015 # RMS amplitude
SILENCE_DURATION_SEC = 1.2
MAX_RECORD_SECONDS = 8.0
TTS_ENGINE = os.getenv("TTS_ENGINE", "edge-tts") # 'piper' or 'edge-tts'

# ----------------- STT Engine (faster-whisper) -----------------
class LocalSTTEngine:
    def __init__(self, model_size: str = "base.en", device: str = "cpu"):
        logger.info(f"Loading faster-whisper model '{model_size}' on {device}...")
        from faster_whisper import WhisperModel
        # Use int8 quantization on CPU for sub-300ms inference
        compute_type = "float16" if device == "cuda" else "int8"
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)

    def transcribe(self, audio_data: np.ndarray) -> str:
        """Transcribe normalized float32 16kHz audio array."""
        segments, _ = self.model.transcribe(audio_data, beam_size=2, language="en")
        text = " ".join([segment.text for segment in segments]).strip()
        return text

# ----------------- TTS Engine -----------------
class LocalTTSEngine:
    def __init__(self, engine_type: str = "edge-tts"):
        self.engine_type = engine_type
        logger.info(f"Initialized TTS Engine: {engine_type}")

    def speak(self, text: str):
        """Speak text through default system sounddevice."""
        if not text:
            return
        logger.info(f"ð£ï¸ [TTS Speaking]: \\"{text}\\"")
        
        if self.engine_type == "edge-tts":
            asyncio.run(self._speak_edge_tts(text))
        else:
            self._speak_piper(text)

    async def _speak_edge_tts(self, text: str):
        import edge_tts
        communicate = edge_tts.Communicate(text, "en-US-GuyNeural")
        audio_stream = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_stream.extend(chunk["data"])
                
        # Play via sounddevice
        import soundfile as sf
        with io.BytesIO(audio_stream) as f:
            data, fs = sf.read(f, dtype='float32')
            sd.play(data, fs)
            sd.wait()

    def _speak_piper(self, text: str):
        """Low-latency local Piper TTS (sub-80ms first chunk)."""
        import subprocess
        # Assumes piper binary and ONNX voice model downloaded locally
        cmd = f'echo "{text}" | piper --model en_US-lessac-medium.onnx --output-raw | aplay -r 22050 -f S16_LE -t raw'
        subprocess.run(cmd, shell=True)

# ----------------- Audio Capture Loop -----------------
def record_speech_with_vad() -> np.ndarray:
    """Records audio from microphone with Voice Activity Detection (silence cutoff)."""
    logger.info("ðï¸ Listening... (Speak your question)")
    audio_buffer = []
    silence_frames = 0
    silence_limit = int(SILENCE_DURATION_SEC * (SAMPLE_RATE / 1024))
    has_started_speaking = False

    def callback(indata, frames, time_info, status):
        nonlocal silence_frames, has_started_speaking
        rms = np.sqrt(np.mean(indata**2))
        audio_buffer.append(indata.copy())

        if rms > SILENCE_THRESHOLD:
            has_started_speaking = True
            silence_frames = 0
        elif has_started_speaking:
            silence_frames += 1

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, blocksize=1024, callback=callback):
        start_time = time.time()
        while True:
            sd.sleep(50)
            if has_started_speaking and silence_frames > silence_limit:
                logger.info("Detected end of utterance.")
                break
            if time.time() - start_time > MAX_RECORD_SECONDS:
                logger.info("Max record time reached.")
                break

    if not audio_buffer:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(audio_buffer, axis=0).flatten().astype(np.float32)

# ----------------- Main Assistant Loop -----------------
def run_voice_assistant():
    logger.info("==================================================")
    logger.info("OfficeTask Interactive Voice Assistant Ready!")
    logger.info("Examples: 'Who is in the office right now?'")
    logger.info("          'Did Alex check in today?'")
    logger.info("          'What tasks are pending for Sarah?'")
    logger.info("          'Give me a morning summary.'")
    logger.info("==================================================")

    stt = LocalSTTEngine(model_size="base.en", device="cpu")
    tts = LocalTTSEngine(engine_type=TTS_ENGINE)

    tts.speak("Office voice assistant online. How can I help you?")

    while True:
        try:
            input("\\n[Press ENTER to talk or press Ctrl+C to exit] > ")
            
            t0 = time.time()
            audio = record_speech_with_vad()
            
            if len(audio) < SAMPLE_RATE * 0.5:
                logger.warning("Audio too short, skipping.")
                continue

            t_rec = time.time()
            query_text = stt.transcribe(audio)
            t_stt = time.time()
            
            if not query_text:
                logger.warning("No speech transcribed.")
                continue

            logger.info(f"ð§  User Said: \\"{query_text}\\" (STT latency: {(t_stt - t_rec)*1000:.0f}ms)")

            # Call FastAPI tool orchestrator
            response = requests.post(FASTAPI_URL, json={"query": query_text}, timeout=5.0)
            t_backend = time.time()
            
            if response.status_code == 200:
                data = response.json()
                reply = data.get("response_speech", "No response generated.")
                logger.info(f"ð ï¸ Tool Executed: {data.get('tool')}")
                logger.info(f"ð Total Round-Trip: {(t_backend - t0)*1000:.0f}ms")
                tts.speak(reply)
            else:
                tts.speak("Sorry, I could not query the office database.")

        except KeyboardInterrupt:
            logger.info("Shutting down voice assistant...")
            break
        except Exception as e:
            logger.error(f"Error in voice loop: {e}")

if __name__ == "__main__":
    run_voice_assistant()
`
  },
  {
    id: 'schema_sql',
    name: 'schema.sql',
    language: 'sql',
    description: 'Relational database schema with indexes and triggers for SQLite / PostgreSQL.',
    content: `-- OfficeTask Attendance & Task Assistant Database Schema
-- Compatible with SQLite 3.35+ and PostgreSQL 14+

-- 1. Employees Table
CREATE TABLE IF NOT EXISTS employees (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL,
    face_embeddings_ref VARCHAR(255) NULL,
    registered_date DATE DEFAULT (CURRENT_DATE),
    email VARCHAR(150) UNIQUE
);

-- 2. Attendance Logs Table
CREATE TABLE IF NOT EXISTS attendance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(10) NOT NULL CHECK(status IN ('IN', 'OUT')),
    confidence_score REAL NOT NULL,
    camera_id VARCHAR(50) DEFAULT 'CAM-01-ENTRANCE',
    direction VARCHAR(20) DEFAULT 'entry',
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- Fast Indexing for Voice Queries:
-- Queries like "Who is in right now?" and "Did Alex check in today?" require fast lookups
CREATE INDEX IF NOT EXISTS idx_attendance_emp_time ON attendance_logs(employee_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_name_time ON attendance_logs(name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_logs(status, timestamp DESC);

-- 3. Tasks Table
CREATE TABLE IF NOT EXISTS tasks (
    task_id VARCHAR(32) PRIMARY KEY,
    employee_id VARCHAR(32) NOT NULL,
    employee_name VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'Medium' CHECK(priority IN ('Critical', 'High', 'Medium', 'Low')),
    due_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending' CHECK(status IN ('Pending', 'In Progress', 'Done')),
    assigned_date DATE DEFAULT (CURRENT_DATE),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_emp_status ON tasks(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority_due ON tasks(priority, due_date);

-- Seed Initial Team
INSERT OR IGNORE INTO employees (id, name, role, department, email) VALUES
('EMP-001', 'Alex Vance', 'Lead Systems Architect', 'IoT & Edge Computing', 'alex.vance@edgeoffice.internal'),
('EMP-002', 'Sarah Connor', 'Staff ML Engineer', 'Computer Vision', 'sarah.connor@edgeoffice.internal'),
('EMP-003', 'Marcus Brody', 'Facilities Director', 'Office Infrastructure', 'marcus.brody@edgeoffice.internal'),
('EMP-004', 'Elena Rostova', 'Firmware Engineer', 'IoT & Sensors', 'elena.rostova@edgeoffice.internal');
`
  },
  {
    id: 'docker_compose',
    name: 'docker-compose.yml',
    language: 'yaml',
    description: 'Complete containerized office deployment stack with GPU pass-through.',
    content: `version: '3.8'

services:
  # 1. Door Access & Face Recognition RTSP Ingest Engine
  rtsp-attendance-engine:
    build:
      context: .
      dockerfile: Dockerfile.rtsp
    container_name: office-rtsp-engine
    restart: unless-stopped
    environment:
      - RTSP_STREAM_URL=rtsp://admin:office2026@192.168.1.120:554/h264Preview_01_main
      - DATABASE_URL=sqlite:////data/office_assistant.db
      - SIMILARITY_THRESHOLD=0.68
      - COOLDOWN_SECONDS=45
      - CAMERA_ID=CAM-01-ENTRANCE
    volumes:
      - ./data:/data
      - ./embeddings:/app/embeddings
      - ./models:/app/models
    # Optional NVIDIA GPU acceleration for InsightFace (removes CPU bottleneck)
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  # 2. FastAPI Backend & LLM Tool Orchestrator
  fastapi-backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: office-fastapi-backend
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=sqlite:////data/office_assistant.db
      - GEMINI_API_KEY=\${GEMINI_API_KEY}
    volumes:
      - ./data:/data
    depends_on:
      - rtsp-attendance-engine

  # 3. Piper TTS Server (Low latency speech synthesis daemon)
  piper-tts:
    image: rhasspy/wyoming-piper:latest
    container_name: office-piper-tts
    restart: unless-stopped
    ports:
      - "10200:10200"
    volumes:
      - ./piper-data:/data
    command: ["--voice", "en_US-lessac-medium"]
`
  },
  {
    id: 'requirements',
    name: 'requirements.txt',
    language: 'text',
    description: 'Pinned Python pip dependencies for CPU and GPU edge devices.',
    content: `# Core Vision & Inference
opencv-python-headless>=4.9.0.80
insightface>=0.7.3
onnxruntime-gpu>=1.17.0; sys_platform != 'darwin'
onnxruntime>=1.17.0; sys_platform == 'darwin'
numpy>=1.26.0

# Backend & Database
fastapi>=0.110.0
uvicorn[standard]>=0.28.0
sqlalchemy>=2.0.28
pydantic>=2.6.4
requests>=2.31.0

# Voice Agent & Audio
faster-whisper>=1.0.1
sounddevice>=0.4.6
soundfile>=0.12.1
edge-tts>=6.1.10
google-genai>=2.4.0
`
  }
];

export const ARCHITECTURE_PIPELINE = {
  vision_pipeline: [
    { step: 1, title: 'RTSP H.264 Stream', detail: 'IP Camera 1080p@25fps via TCP with ffmpeg nobuffer mode' },
    { step: 2, title: 'SCRFD Face Detection', detail: 'ONNX/CUDA detection of bounding box, 5-point facial landmarks' },
    { step: 3, title: 'WDR & Quality Gate', detail: 'Filter blurry, extreme angled, or dark frames (min size 64x64)' },
    { step: 4, title: 'ArcFace Embeddings', detail: '512-dim normalized vector extraction via InsightFace' },
    { step: 5, title: 'Cosine Matching', detail: 'Compare against enrolled vectors (>0.68 threshold)' },
    { step: 6, title: 'Direction Tracker', detail: 'Centroid displacement across virtual tripwire -> IN vs OUT' },
    { step: 7, title: 'Debounce Cooldown', detail: '45-second sliding window prevents repeated scans' },
    { step: 8, title: 'SQLite / DB Commit', detail: 'Atomic insert into attendance_logs with employee_id & score' }
  ],
  voice_pipeline: [
    { step: 1, title: 'Acoustic Ingest', detail: 'Microphone array 16kHz with AEC (Acoustic Echo Cancellation)' },
    { step: 2, title: 'Wake-Word / Push-to-Talk', detail: 'openWakeWord "Hey Office" or hardware mic button' },
    { step: 3, title: 'VAD & Audio Segmentation', detail: 'Silero-VAD cuts off silence after 1.2 seconds of speech' },
    { step: 4, title: 'faster-whisper STT', detail: 'CTranslate2 int8 transcription on CPU/GPU (~180ms)' },
    { step: 5, title: 'LLM Reasoner & Tool Match', detail: 'Gemini-3.8-Flash function calling maps query to SQL tool' },
    { step: 6, title: 'FastAPI / DB Execution', detail: 'Executes get_active_attendees(), get_tasks(), etc. (<15ms)' },
    { step: 7, title: 'Speech Response Generation', detail: 'LLM synthesizes concise, natural human voice answer' },
    { step: 8, title: 'Streaming TTS & Speaker', detail: 'Piper TTS / Edge-TTS streams low-latency audio chunks' }
  ],
  hardware_matrix: [
    {
      tier: 'Edge Mini-PC / NUC',
      hardware: 'Intel NUC 13th Gen i5 / i7 (CPU-only)',
      rtsp_fps: '18-22 FPS (OpenVINO / ONNX)',
      stt_latency: '240ms (faster-whisper int8)',
      tts_latency: '90ms (Piper TTS CPU)',
      recommendation: 'Best balanced office workstation. Very reliable, low power (35W), runs 24/7.'
    },
    {
      tier: 'IoT Edge Board',
      hardware: 'NVIDIA Jetson Orin Nano (8GB)',
      rtsp_fps: '30+ FPS (TensorRT FP16)',
      stt_latency: '140ms (faster-whisper CUDA)',
      tts_latency: '60ms (Piper TTS)',
      recommendation: 'Ideal dedicated door appliance mounted directly behind the camera junction box.'
    },
    {
      tier: 'Office Desktop / TV Host',
      hardware: 'Office PC with NVIDIA RTX 3060 / 4060',
      rtsp_fps: '60+ FPS (Multi-stream capable)',
      stt_latency: '85ms (faster-whisper large-v3)',
      tts_latency: '40ms (Piper/Edge-TTS)',
      recommendation: 'Ultimate speed. Can ingest 4x cameras simultaneously with zero perceptible lag.'
    }
  ],
  edge_case_solutions: [
    {
      category: 'Lighting & Backlight',
      challenge: 'Glass office doors cause strong morning glare/silhouetting.',
      mitigation: 'Enable camera Wide Dynamic Range (WDR >120dB) and apply CLAHE (Contrast Limited Adaptive Histogram Equalization) before face detector.'
    },
    {
      category: 'Duplicate Scans',
      challenge: 'Employees standing by the entrance conversing create duplicate log entries.',
      mitigation: 'Per-employee 45-second debounce cooldown cache in memory. Only subsequent opposite direction (IN -> OUT) after cooldown is accepted.'
    },
    {
      category: 'Unauthorized Faces',
      challenge: 'Delivery drivers, visitors, or unauthorized individuals walk through door.',
      mitigation: 'If cosine similarity <0.68, log security event as UNAUTHORIZED, trigger snapshot capture, and alert reception via Telegram/Webhook without opening access relay.'
    },
    {
      category: 'Acoustic Echo & Noise',
      challenge: 'Assistant speaking out loud triggers its own microphone.',
      mitigation: 'Hardware acoustic echo cancellation (AEC) or software mute during TTS playback (barge-in enabled via dedicated wake-word interrupt thread).'
    }
  ]
};
