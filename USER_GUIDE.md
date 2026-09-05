# OfficeTask AI — User Guide: Training (Face Enrollment) & Daily Usage

This guide explains how to **train** the system (enroll employee faces so the
door camera can recognize them) and how to **use** the assistant day-to-day.

> **What "training" means here:** OfficeTask AI uses pre-trained face recognition
> models (InsightFace ArcFace / OpenCV MobileFaceNet / face-api.js). You do **not**
> train a neural network from scratch. "Training" = **enrollment**: capturing a
> few photos of each employee, computing their 512-d face embedding vector, and
> saving it to the `embeddings/` folder. The camera engine then matches live
> faces against these stored vectors by cosine similarity.

---

## Part 1 — Face Enrollment ("Training")

### 1.1 Choose your recognition backend

The project ships two interchangeable engines (see `src/data/pythonCode.ts` and
`src/data/nodeCode.ts` for the full source, also viewable in the app's
*Architecture* tab):

| Backend | Model | Embedding file format | Best for |
|---|---|---|---|
| **Python / InsightFace** | SCRFD + ArcFace `buffalo_s` | `embeddings/EMP-001_Alex Vance.npy` | GPU or strong CPU, highest accuracy |
| **Node / face-api.js** | SSD MobileNet v1 + 68-landmark net | `embeddings/EMP-001_Alex Vance.json` | CPU-only servers, simpler stack |

Pick **one** backend and use the matching enrollment script below. Mixing `.npy`
and `.json` profiles in the same `embeddings/` folder is fine only if you run
both engines — each engine reads only its own format.

### 1.2 Prepare enrollment photos

For each employee, collect **5–10 photos**:

- Well-lit, front-facing, neutral expression
- Different angles (±15° yaw) and slightly different distances
- Only one face per photo
- Resolution ≥ 400×400 px on the face
- Remove glasses/hats in at least 2 photos (keep 1–2 with typical accessories
  if the employee always wears them)

Store them in a per-employee folder:

```
/www/wwwroot/officetask/enrollment_photos/
├── EMP-001_Alex Vance/
│   ├── 01.jpg
│   ├── 02.jpg
│   └── ...
├── EMP-002_Sarah Connor/
└── ...
```

> The filename convention `<EMP-ID>_<Full Name>` is **required** — the engine
> derives the employee ID and name from it.

### 1.3 Enroll with the Python (InsightFace) backend

Create `enroll_faces.py` in the project root:

```python
#!/usr/bin/env python3
"""Enroll employee faces into embeddings/*.npy using InsightFace ArcFace."""
import os, glob, numpy as np
from insightface.app import FaceAnalysis

PHOTOS_DIR = "enrollment_photos"
EMBED_DIR  = "embeddings"
os.makedirs(EMBED_DIR, exist_ok=True)

app = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
app.prepare(ctx_id=-1, det_size=(640, 640))

for emp_dir in sorted(os.listdir(PHOTOS_DIR)):
    folder = os.path.join(PHOTOS_DIR, emp_dir)
    if not os.path.isdir(folder):
        continue
    emp_id, name = emp_dir.split("_", 1)
    vectors = []
    for img_path in sorted(glob.glob(os.path.join(folder, "*.jpg"))):
        import cv2
        img = cv2.imread(img_path)
        faces = app.get(img)
        if not faces:
            print(f"  ! no face in {img_path}, skipping")
            continue
        # take the largest face in the frame
        face = max(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]))
        vectors.append(face.embedding)
    if not vectors:
        print(f"!! No usable faces for {name}, skipping enrollment.")
        continue
    # Average + L2-normalize for a robust template
    mean_vec = np.mean(vectors, axis=0)
    mean_vec = mean_vec / np.linalg.norm(mean_vec)
    out = os.path.join(EMBED_DIR, f"{emp_id}_{name}.npy")
    np.save(out, mean_vec)
    print(f"✅ Enrolled {name} ({emp_id}) from {len(vectors)} photos -> {out}")

print("Enrollment complete.")
```

Run it:

```bash
cd /www/wwwroot/officetask
source .venv/bin/activate
pip install opencv-python insightface onnxruntime numpy
python3 enroll_faces.py
```

Output:

```
embeddings/
├── EMP-001_Alex Vance.npy
├── EMP-002_Sarah Connor.npy
├── EMP-003_Marcus Brody.npy
└── EMP-004_Elena Rostova.npy
```

### 1.4 Enroll with the Node (face-api.js) backend

Create `enroll-faces.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import * as faceapi from '@vladmandic/face-api';
import { Canvas, Image, ImageData, loadImage, createCanvas } from 'canvas';

// @ts-ignore
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const PHOTOS_DIR = './enrollment_photos';
const EMBED_DIR  = './embeddings';
fs.mkdirSync(EMBED_DIR, { recursive: true });

async function main() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk('./models');
  await faceapi.nets.faceLandmark68Net.loadFromDisk('./models');
  await faceapi.nets.faceRecognitionNet.loadFromDisk('./models');

  for (const empDir of fs.readdirSync(PHOTOS_DIR)) {
    const folder = path.join(PHOTOS_DIR, empDir);
    if (!fs.statSync(folder).isDirectory()) continue;
    const [empId, ...nameParts] = empDir.split('_');
    const name = nameParts.join(' ');

    const descriptors: Float32Array[] = [];
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.jpg'))) {
      const img = await loadImage(path.join(folder, file));
      const canvas = createCanvas(img.width, img.height);
      canvas.getContext('2d').drawImage(img, 0, 0);
      const det = await faceapi
        .detectSingleFace(canvas as any)
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (det) descriptors.push(det.descriptor);
    }
    if (descriptors.length === 0) {
      console.warn(`!! No faces for ${name}, skipping.`);
      continue;
    }
    // Average the 128-d descriptors (face-api uses 128-d, not 512-d)
    const avg = new Float32Array(descriptors[0].length);
    for (const d of descriptors) for (let i = 0; i < d.length; i++) avg[i] += d[i];
    for (let i = 0; i < avg.length; i++) avg[i] /= descriptors.length;

    const out = path.join(EMBED_DIR, `${empId}_${name}.json`);
    fs.writeFileSync(out, JSON.stringify({ id: empId, name, vector: Array.from(avg) }));
    console.log(`✅ Enrolled ${name} (${empId}) from ${descriptors.length} photos -> ${out}`);
  }
}
main();
```

Run it:

```bash
cd /www/wwwroot/officetask
npm install @vladmandic/face-api canvas
# download the three model weights into ./models/ from the face-api.js repo
npx tsx enroll-faces.ts
```

### 1.5 Register the employee in the dashboard

After enrollment, also add the employee record (ID, name, role, department) so
the voice agent and task system know about them. Either:

- **Via API** (scriptable):
  ```bash
  curl -X POST https://officetask.yourdomain.com/api/employees \
       -H "Content-Type: application/json" \
       -d '{"id":"EMP-005","name":"Maya Singh","role":"DevOps Engineer","department":"Infrastructure","email":"maya.singh@edgeoffice.internal"}'
  ```
- **Or** edit `src/data/mockData.ts` and rebuild (for the demo in-memory store).

> Note: the shipped `server.ts` uses an **in-memory** array seeded from
> `mockData.ts`. On restart it resets to the demo data. For persistence across
> restarts, switch to the SQLite-backed production server (`backend-express.ts`
> in `src/data/nodeCode.ts`) — see DEPLOYMENT.md §7.

### 1.6 Enrollment best practices

- **Re-enroll** every 6–12 months, or if an employee's appearance changes
  significantly (beard, glasses, weight).
- **Threshold tuning**: default `SIMILARITY_THRESHOLD=0.68` (cosine). If you get
  false positives, raise to `0.72`. If legitimate users are rejected, lower to
  `0.62`. Tune in `camera/.env` and restart the camera engine.
- **Cooldown**: `COOLDOWN_SECONDS=45` prevents duplicate logs when someone
  lingers at the door. Increase for busy entrances.
- **Never** enroll photos of minors, visitors, or people without consent. Keep
  an access-control list of authorized enrollees.

---

## Part 2 — Daily Usage

### 2.1 The four dashboard tabs

Open `https://officetask.yourdomain.com`. The header shows live system health
(employees, attendance records, tasks, Gemini status). Four tabs:

1. **Voice Assistant** — ask natural-language questions, get spoken-style
   answers + see the underlying tool call and SQL.
2. **Door Cam Simulator** — simulate an RTSP face scan (IN/OUT) to test the
   attendance pipeline without a real camera.
3. **Data Layer** — browse employees, attendance logs, and tasks; reset to
   demo state.
4. **Architecture** — diagrams + the production Python/Node reference code.

### 2.2 Voice queries (the assistant)

Click the **Voice Assistant** tab. Type or (if your browser permits mic access)
speak a query. Examples the assistant understands:

| Say / type… | Tool called | What it returns |
|---|---|---|
| "Who is in the office right now?" | `get_active_attendees` | List of currently checked-in staff |
| "Did Alex check in today?" | `get_employee_attendance` | First check-in time, current status, confidence |
| "What tasks are pending for Sarah?" | `get_pending_tasks` | Sarah's open tasks, sorted by priority |
| "Give me the morning summary" | `get_morning_summary` | Headcount, late arrivals, critical tasks |
| "Show critical tasks" | `get_pending_tasks` (priority=Critical) | All critical open tasks |

The response card shows:
- **Answer** — the spoken-style reply (1–3 sentences, no markdown)
- **Tool call** — which function ran, its arguments, the raw result
- **SQL equivalent** — the SQL the production backend would execute
- **Latency** — end-to-end milliseconds
- **Engine** — `gemini-3.8-flash` (with API key) or `local-function-orchestrator` (fallback)

### 2.3 Simulating a door scan (no camera)

Door Cam Simulator tab → pick an employee → choose **IN** or **OUT** → set a
confidence score → **Log Scan**. The attendance log updates instantly and the
30-second cooldown prevents accidental double-logs. Use this to:
- Test the cooldown/debounce logic
- Demo the system to stakeholders
- Verify the voice agent reflects new attendance immediately

### 2.4 Managing tasks

In the **Data Layer** tab (or via the REST API):

- **Create a task**:
  ```bash
  curl -X POST https://officetask.yourdomain.com/api/tasks \
       -H "Content-Type: application/json" \
       -d '{"employee_id":"EMP-001","title":"Patch door camera firmware","priority":"High","due_date":"2026-09-10"}'
  ```
- **Update status** (Pending → In Progress → Done):
  ```bash
  curl -X PATCH https://officetask.yourdomain.com/api/tasks/TSK-123 \
       -H "Content-Type: application/json" \
       -d '{"status":"Done"}'
  ```
- **Reset everything to demo state**: `POST /api/reset` (clears all changes
  since the server started).

### 2.5 With a live RTSP camera

Once the camera engine from DEPLOYMENT.md §7 is running and faces are enrolled
(Part 1 above), attendance logs are written automatically to
`office_assistant.db`. The web dashboard's `/api/attendance` endpoint will show
them in real time (refresh the page or use the Data Layer tab).

Typical daily flow:
1. Employees walk through the door → camera detects + recognizes the face →
   determines direction (IN before 14:00, OUT after; or by vertical motion) →
   logs to SQLite with confidence score.
2. A manager opens the dashboard in the morning → asks the voice agent
   "Give me the morning summary" → gets headcount, late arrivals, critical tasks.
3. During the day → "Who is in the office right now?" → live headcount.
4. End of day → "Did Elena check out?" → confirms OUT event + time.

### 2.6 Acting on the data ("act accordingly")

The assistant is read-only by default — it answers questions. To **act**:

- **Reassign an overdue critical task**: ask "Show critical tasks", then
  PATCH the task to a different `employee_id`.
- **Flag late arrivals to HR**: export the attendance log
  (`GET /api/attendance`) and filter by first `IN` after 09:30.
- **Investigate low-confidence scans**: in the Data Layer tab, sort by
  `confidence_score` ascending. Scores below ~0.70 may indicate a mis-enrolled
  face or someone trying to spoof — re-enroll the employee or review camera
  placement.
- **Unknown-person alerts**: the camera engine logs `Unauthorized Person` to
  stdout when a face is detected but matches no enrollment. Pipe PM2 logs to a
  notifier (Slack webhook, email) for security:
  ```bash
  pm2 install pm2-logrotate
  # or write a small watcher that tails `pm2 logs officetask-cam --raw`
  # and POSTs "Unauthorized Person" lines to a Slack incoming webhook
  ```

---

## Part 3 — Routine Maintenance

| Task | Frequency | Command |
|---|---|---|
| Restart the web app after config change | as needed | `pm2 restart officetask` |
| Restart the camera engine after `.env` change | as needed | `pm2 restart officetask-cam` |
| Re-enroll changed faces | every 6–12 months | Part 1 |
| Backup `.env`, `embeddings/`, `office_assistant.db` | daily | aaPanel Cron |
| Rotate PM2 logs | weekly | `pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 10M` |
| Update the app | as needed | DEPLOYMENT.md §8 |
| Check Gemini usage / quota | monthly | Google AI Studio dashboard |

---

## Part 4 — Quick Reference: REST API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Service status + Gemini configured flag |
| GET | `/api/employees` | List all employees |
| GET | `/api/attendance` | Attendance logs (newest first) |
| POST | `/api/attendance/scan` | Log a manual/simulated IN/OUT scan |
| GET | `/api/tasks` | List tasks (filter: `?status=Pending&employee_id=EMP-001`) |
| POST | `/api/tasks` | Create a task |
| PATCH | `/api/tasks/:id` | Update a task (e.g. status) |
| POST | `/api/reset` | Reset in-memory store to demo data |
| POST | `/api/agent/query` | Voice agent query — body `{"query":"..."}` |

All endpoints are served by the same Node process on port 3000 and exposed
through Nginx at `https://officetask.yourdomain.com/api/...`.
