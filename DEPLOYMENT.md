# OfficeTask AI — Deployment Guide (Ubuntu 24.04 + aaPanel)

This guide deploys the **OfficeTask Voice & Attendance Assistant** on a dedicated
Ubuntu 24.04 server running aaPanel, alongside your existing Node sites.

The app is a single Node.js process (Express + Vite):
- **Dev mode**: `tsx server.ts` (Vite middleware serves the React UI on the same port)
- **Production mode**: `node dist/server.cjs` (serves the pre-built `dist/` static bundle + API)

Default port: **3000**. We will run it behind aaPanel's Nginx reverse proxy with SSL.

---

## 0. Prerequisites

- Ubuntu 24.04 dedicated server with aaPanel installed and working
- An existing aaPanel account with permission to add Node sites
- A domain or subdomain pointed at the server (e.g. `officetask.yourdomain.com`)
- A **Gemini API key** from Google AI Studio → https://aistudio.google.com/app/apikey
- (Optional, for live camera attendance) An RTSP IP camera at the office door

Verify aaPanel Node support is present:

```bash
# In aaPanel: App Store → install "Node.js Version Manager" if not already installed
# Install a supported LTS runtime (Node 20.x or 22.x) via the manager
node -v   # should print v20.x or v22.x
npm -v
```

---

## 1. Upload the Project to the Server

### Option A — Git clone (recommended)

In aaPanel → **Terminal**:

```bash
cd /www/wwwroot
git clone https://github.com/<your-user>/TaskAI.git officetask
cd officetask
```

### Option B — Upload via aaPanel File Manager

1. Zip the project locally (`TaskAI.zip` containing all files **except** `node_modules`).
2. aaPanel → **File** → navigate to `/www/wwwroot/` → **Upload** → extract into `/www/wwwroot/officetask`.

The final layout should be:

```
/www/wwwroot/officetask/
├── server.ts
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/
├── public/
└── .env          # we will create this in step 3
```

---

## 2. Install Dependencies

In aaPanel Terminal:

```bash
cd /www/wwwroot/officetask
npm install --omit=dev      # install runtime deps only
# OR, if you want to build on the server, install everything:
# npm install
```

> If aaPanel's Node Version Manager is using a different Node than your shell,
> prefix commands with the full path it provides, or use `nvm use 20` first.

---

## 3. Create the `.env` File

```bash
cp .env.example .env
nano .env
```

Set the values:

```env
GEMINI_API_KEY="your_real_gemini_api_key_here"
APP_URL="https://officetask.yourdomain.com"
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

Secure the file so the key is not world-readable:

```bash
chmod 600 .env
```

> Without a valid `GEMINI_API_KEY`, the voice agent automatically falls back to
> the built-in **local function orchestrator** (sub-15ms, keyword-based). The UI
> still works, but natural-language understanding will be limited.

---

## 4. Build the Production Bundle

```bash
cd /www/wwwroot/officetask
npm run build
```

This runs:
1. `vite build` → outputs the React frontend to `dist/`
2. `esbuild server.ts --bundle ... --outfile=dist/server.cjs` → bundled server

Verify the output:

```bash
ls -la dist/
# should show: index.html  assets/  server.cjs  server.cjs.map
```

---

## 5. Run the Server with PM2 (process manager)

aaPanel's Node site manager uses PM2 under the hood. You can use either PM2
directly or aaPanel's "Node Project" UI — both are shown below.

### Option A — PM2 directly (most control)

```bash
cd /www/wwwroot/officetask
pm2 start dist/server.cjs --name officetask
pm2 save
pm2 startup     # follow the printed instruction once to enable boot-start
```

Check it is running:

```bash
pm2 status
pm2 logs officetask --lines 20
# You should see: Server running on http://0.0.0.0:3000
```

Test locally on the server:

```bash
curl http://127.0.0.1:3000/api/health
# {"status":"online","service":"OfficeTask Voice & Attendance Server",...}
```

### Option B — aaPanel "Node Project" UI

1. aaPanel → **Website** → **Node Project** → **Add Project**
2. Fields:
   - **Project directory**: `/www/wwwroot/officetask`
   - **Node version**: 20.x or 22.x
   - **Startup file**: `dist/server.cjs`
   - **Project port**: `3000`
   - **Project name**: `officetask`
3. Click **Submit** → aaPanel starts it with PM2 automatically.

---

## 6. Add the Site in aaPanel (Nginx reverse proxy + SSL)

1. aaPanel → **Website** → **Add Site**
   - **Domain**: `officetask.yourdomain.com`
   - **Root directory**: `/www/wwwroot/officetask/dist`
   - **PHP version**: Pure static / none
   - **Database**: none
2. After creation, click **Settings** on the site → **Reverse Proxy** → **Add reverse proxy**:
   - **Proxy name**: `officetask-api`
   - **Target URL**: `http://127.0.0.1:3000`
   - **Send domain**: `$host`
   - Enable it.
3. **SSL** tab → **Let's Encrypt** → issue a certificate for the domain → enable **Force HTTPS**.

aaPanel generates an Nginx config similar to:

```nginx
server {
    listen 443 ssl http2;
    server_name officetask.yourdomain.com;
    root /www/wwwroot/officetask/dist;

    ssl_certificate    /www/server/panel/vhost/cert/officetask.yourdomain.com/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/officetask.yourdomain.com/privkey.pem;

    # Static frontend
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API + voice agent → Node backend
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;   # Gemini calls can take a few seconds
    }
}
```

> If aaPanel's reverse-proxy UI does not auto-add the `location /api/` block,
> open the site's Nginx config (Website → Settings → Config file) and paste the
> `location /api/ { ... }` block above inside the `server { }` block, then
> reload Nginx from aaPanel.

Reload Nginx:

```bash
nginx -t && nginx -s reload
```

Visit: **https://officetask.yourdomain.com** — you should see the dashboard.

---

## 7. (Optional) Run the Live RTSP Camera Attendance Engine

The web app ships with **reference production code** (visible in the
*Architecture* and *Data Layer* tabs) for a separate Python or Node service that
connects to a door RTSP camera, recognizes faces, and writes attendance logs to
SQLite. This service is **not** required for the web dashboard to work — the
dashboard has a built-in Door Cam Simulator tab and in-memory data.

If you want real camera-driven attendance, deploy ONE of the following on the
same server (or a separate edge PC near the door):

### Python engine (recommended, GPU optional)

```bash
sudo apt install python3-venv python3-pip -y
cd /www/wwwroot/officetask
python3 -m venv .venv && source .venv/bin/activate
pip install opencv-python insightface onnxruntime numpy requests sqlalchemy fastapi uvicorn
```

Create `/www/wwwroot/officetask/camera/.env`:

```env
RTSP_STREAM_URL=rtsp://admin:yourcamerapass@192.168.1.120:554/h264Preview_01_main
DATABASE_URL=sqlite:////www/wwwroot/officetask/office_assistant.db
CAMERA_ID=CAM-01-ENTRANCE
SIMILARITY_THRESHOLD=0.68
COOLDOWN_SECONDS=45
```

Extract `rtsp_attendance_engine.py` from `src/data/pythonCode.ts` (copy the
string between the backticks into a real `.py` file), then:

```bash
pm2 start "python3 rtsp_attendance_engine.py" --name officetask-cam
pm2 save
```

### Node engine (alternative, CPU-friendly)

```bash
cd /www/wwwroot/officetask/camera
npm install fluent-ffmpeg @vladmandic/face-api canvas better-sqlite3 dotenv
# extract rtsp-attendance-engine.ts from src/data/nodeCode.ts
pm2 start "npx tsx rtsp-attendance-engine.ts" --name officetask-cam
pm2 save
```

> See **USER_GUIDE.md** for how to enroll employee faces (the "training" step)
> before the camera engine can recognize anyone.

---

## 8. Updating the App

```bash
cd /www/wwwroot/officetask
git pull
npm install --omit=dev
npm run build
pm2 restart officetask
# if you also run the camera engine:
# pm2 restart officetask-cam
```

---

## 9. Backups

Back up at minimum:

- `/www/wwwroot/officetask/.env` (contains the API key)
- `/www/wwwroot/officetask/embeddings/` (enrolled face vectors — see USER_GUIDE.md)
- `/www/wwwroot/officetask/office_assistant.db` (if using the live camera engine)

aaPanel → **Cron** can schedule a daily tarball of these paths to your backup
destination.

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `curl localhost:3000/api/health` returns connection refused | `pm2 restart officetask && pm2 logs officetask` |
| UI loads but voice queries return generic answers | `.env` `GEMINI_API_KEY` missing/invalid — the server falls back to the local orchestrator. Check `/api/health` → `gemini_configured: false` |
| 502 Bad Gateway from Nginx | Node process not running, or port mismatch. Confirm `pm2 status` and the reverse-proxy target URL match port 3000 |
| Gemini calls time out through Nginx | Raise `proxy_read_timeout` in the `location /api/` block to `120s` and reload Nginx |
| Port 3000 already in use by another aaPanel Node site | Edit `server.ts` `const PORT = 3000;` or set `PORT=3001` in `.env` and update the reverse proxy target accordingly. Note: the current `server.ts` hardcodes 3000 — change the source or patch it to read `process.env.PORT` |
| `npm run build` fails on `esbuild` | Ensure Node ≥ 20 and run `npm install` (full, not `--omit=dev`) so devDependencies (`esbuild`, `typescript`) are present |

---

## 11. Security Checklist

- [ ] `.env` is `chmod 600` and **not** committed to git (already in `.gitignore`)
- [ ] Gemini API key restricted to your server's IP in Google AI Studio if possible
- [ ] aaPanel firewall (Security tab) only exposes 22, 80, 443 — **not** 3000
- [ ] Force HTTPS enabled on the site
- [ ] `office_assistant.db` and `embeddings/` are not under the web root served
      by Nginx (they live in `/www/wwwroot/officetask/` but Nginx only serves
      `dist/`, so they are safe — verify your reverse proxy only forwards `/api/`)
- [ ] Regular `pm2 save` so the process list survives reboots
