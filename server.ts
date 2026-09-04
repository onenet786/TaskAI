import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { INITIAL_EMPLOYEES, INITIAL_ATTENDANCE, INITIAL_TASKS } from "./src/data/mockData";
import { Employee, AttendanceRecord, TaskItem, ToolCallExecution } from "./src/types";

dotenv.config();

// In-memory relational database state
let employees: Employee[] = [...INITIAL_EMPLOYEES];
let attendanceLogs: AttendanceRecord[] = [...INITIAL_ATTENDANCE];
let tasks: TaskItem[] = [...INITIAL_TASKS];

// Cooldown tracker: employee_id -> last scan timestamp
const cooldownTracker = new Map<string, number>();
const COOLDOWN_MS = 30 * 1000; // 30 seconds

// Lazy initialization of Gemini client
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "MY_GEMINI_API_KEY") {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

// Database query helpers (simulating SQL queries)
function getActiveAttendees() {
  // Query: SELECT * FROM employees WHERE id IN (SELECT employee_id FROM attendance_logs GROUP BY employee_id HAVING latest status = 'IN')
  const active: Array<{ employee_id: string; name: string; role: string; department: string; arrival_time: string; confidence: number }> = [];
  
  for (const emp of employees) {
    const empLogs = attendanceLogs
      .filter(l => l.employee_id === emp.id)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    if (empLogs.length > 0 && empLogs[0].status === 'IN') {
      const firstInToday = attendanceLogs
        .filter(l => l.employee_id === emp.id && l.status === 'IN')
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
      
      const arrival = new Date(firstInToday?.timestamp || empLogs[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      active.push({
        employee_id: emp.id,
        name: emp.name,
        role: emp.role,
        department: emp.department,
        arrival_time: arrival,
        confidence: empLogs[0].confidence_score
      });
    }
  }

  return {
    count: active.length,
    present_employees: active,
    sql: "SELECT e.id, e.name, e.role, a.timestamp, a.confidence_score FROM employees e JOIN (SELECT employee_id, status, timestamp, confidence_score, ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY timestamp DESC) as rn FROM attendance_logs) a ON e.id = a.employee_id WHERE a.rn = 1 AND a.status = 'IN';"
  };
}

function getEmployeeAttendance(employeeName: string) {
  const searchName = employeeName.trim().toLowerCase();
  const emp = employees.find(e => e.name.toLowerCase().includes(searchName));
  
  if (!emp) {
    return {
      found: false,
      message: `No employee found matching "${employeeName}".`,
      sql: `SELECT * FROM employees WHERE LOWER(name) LIKE '%${employeeName.replace(/'/g, "''")}%';`
    };
  }

  const logs = attendanceLogs
    .filter(l => l.employee_id === emp.id)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const firstIn = logs.find(l => l.status === 'IN');
  const latest = logs[logs.length - 1];

  return {
    found: true,
    employee_id: emp.id,
    employee_name: emp.name,
    role: emp.role,
    checked_in_today: !!firstIn,
    first_check_in_time: firstIn ? new Date(firstIn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
    current_status: latest ? latest.status : 'NOT_LOGGED',
    last_event_time: latest ? new Date(latest.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
    confidence: latest ? latest.confidence_score : 0,
    total_events: logs.length,
    sql: `SELECT * FROM attendance_logs WHERE employee_id = '${emp.id}' ORDER BY timestamp ASC;`
  };
}

function getPendingTasks(employeeName?: string, priority?: string) {
  let filtered = tasks.filter(t => t.status !== 'Done');
  
  if (employeeName) {
    const s = employeeName.toLowerCase();
    filtered = filtered.filter(t => t.employee_name.toLowerCase().includes(s));
  }
  if (priority) {
    filtered = filtered.filter(t => t.priority.toLowerCase() === priority.toLowerCase());
  }

  return {
    count: filtered.length,
    tasks: filtered.map(t => ({
      task_id: t.task_id,
      assignee: t.employee_name,
      title: t.title,
      priority: t.priority,
      status: t.status,
      due_date: t.due_date
    })),
    sql: `SELECT * FROM tasks WHERE status != 'Done' ${employeeName ? `AND LOWER(employee_name) LIKE '%${employeeName}%'` : ''} ${priority ? `AND LOWER(priority) = '${priority}'` : ''} ORDER BY priority DESC, due_date ASC;`
  };
}

function getMorningSummary() {
  const activeData = getActiveAttendees();
  
  // Late arrivals: first check-in after 9:30 AM
  const lateArrivals: Array<{ name: string; time: string }> = [];
  const seenEmp = new Set<string>();

  for (const log of attendanceLogs) {
    if (log.status === 'IN' && !seenEmp.has(log.employee_id)) {
      seenEmp.add(log.employee_id);
      const d = new Date(log.timestamp);
      const hours = d.getHours();
      const mins = d.getMinutes();
      if (hours > 9 || (hours === 9 && mins > 30)) {
        lateArrivals.push({
          name: log.name,
          time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      }
    }
  }

  const criticalTasks = tasks.filter(t => t.priority === 'Critical' && t.status !== 'Done');

  return {
    active_count: activeData.count,
    present_employees: activeData.present_employees.map(p => p.name),
    late_arrivals: lateArrivals,
    critical_tasks: criticalTasks.map(t => ({ title: t.title, assignee: t.employee_name, status: t.status })),
    sql: `/* Morning Multi-Table Summary */
SELECT count(*) AS present_count FROM attendance_logs WHERE status='IN';
SELECT employee_id, min(timestamp) FROM attendance_logs WHERE status='IN' GROUP BY employee_id HAVING TIME(min(timestamp)) > '09:30:00';
SELECT * FROM tasks WHERE priority='Critical' AND status != 'Done';`
  };
}

// Local ultra-fast function orchestrator fallback
function runLocalOrchestrator(prompt: string): { answer: string; toolCall: ToolCallExecution } {
  const t0 = Date.now();
  const lower = prompt.toLowerCase();

  if (lower.includes("who is in") || lower.includes("in the office") || lower.includes("who's in") || lower.includes("present today")) {
    const data = getActiveAttendees();
    const names = data.present_employees.map(p => p.name);
    const answer = names.length > 0
      ? `There are currently ${names.length} team members in the office: ${names.join(", ")}.`
      : "No team members are currently checked into the office.";
    return {
      answer,
      toolCall: {
        tool_name: "get_active_attendees",
        arguments: {},
        result: data,
        sql_equivalent: data.sql,
        execution_time_ms: Date.now() - t0
      }
    };
  }

  if (lower.includes("task") || lower.includes("pending") || lower.includes("todo") || lower.includes("assigned")) {
    let target: string | undefined = undefined;
    if (lower.includes("sarah")) target = "Sarah";
    else if (lower.includes("alex")) target = "Alex";
    else if (lower.includes("elena")) target = "Elena";
    else if (lower.includes("marcus")) target = "Marcus";

    const data = getPendingTasks(target);
    let answer = "";
    if (data.count === 0) {
      answer = target ? `${target} has no pending tasks right now.` : `There are no pending tasks in the office backlog.`;
    } else {
      const top = data.tasks[0];
      answer = `${target || "The team"} has ${data.count} pending task${data.count > 1 ? "s" : ""}. Most urgent: "${top.title}" [${top.priority} priority, assigned to ${top.assignee}].`;
    }

    return {
      answer,
      toolCall: {
        tool_name: "get_pending_tasks",
        arguments: { employee_name: target || "ALL" },
        result: data,
        sql_equivalent: data.sql,
        execution_time_ms: Date.now() - t0
      }
    };
  }

  if (lower.includes("check in") || lower.includes("checked in") || lower.includes("arrival") || lower.includes("what time") || lower.includes("attendance") || lower.includes("alex") || lower.includes("sarah") || lower.includes("marcus") || lower.includes("elena") || lower.includes("david")) {
    let target = "Alex";
    if (lower.includes("sarah")) target = "Sarah";
    else if (lower.includes("marcus")) target = "Marcus";
    else if (lower.includes("elena")) target = "Elena";
    else if (lower.includes("david")) target = "David";
    else if (lower.includes("maya")) target = "Maya";

    const data = getEmployeeAttendance(target);
    let answer = "";
    if (data.found) {
      if (data.checked_in_today) {
        answer = `${data.employee_name} checked in today at ${data.first_check_in_time} (Current status: ${data.current_status}, face match confidence: ${Math.round(data.confidence * 100)}%).`;
      } else {
        answer = `${data.employee_name} has not checked in today yet.`;
      }
    } else {
      answer = `I couldn't find any attendance logs for "${target}".`;
    }

    return {
      answer,
      toolCall: {
        tool_name: "get_employee_attendance",
        arguments: { employee_name: target },
        result: data,
        sql_equivalent: data.sql,
        execution_time_ms: Date.now() - t0
      }
    };
  }

  // Default: Morning Summary
  const summary = getMorningSummary();
  const answer = `Morning Briefing: We have ${summary.active_count} employee${summary.active_count === 1 ? "" : "s"} currently in the office (${summary.present_employees.join(", ")}). ${summary.late_arrivals.length > 0 ? `Late arrivals: ${summary.late_arrivals.map(l => `${l.name} at ${l.time}`).join(", ")}.` : "All arrivals were on time."} There ${summary.critical_tasks.length === 1 ? "is" : "are"} ${summary.critical_tasks.length} critical task${summary.critical_tasks.length === 1 ? "" : "s"} scheduled for today.`;

  return {
    answer,
    toolCall: {
      tool_name: "get_morning_summary",
      arguments: {},
      result: summary,
      sql_equivalent: summary.sql,
      execution_time_ms: Date.now() - t0
    }
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 1. Health check
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "online",
      service: "OfficeTask Voice & Attendance Server",
      gemini_configured: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY",
      total_employees: employees.length,
      attendance_records: attendanceLogs.length,
      tasks_count: tasks.length
    });
  });

  // 2. Employees API
  app.get("/api/employees", (_req, res) => {
    res.json(employees);
  });

  // 3. Attendance Logs API
  app.get("/api/attendance", (_req, res) => {
    // Sort descending by timestamp
    const sorted = [...attendanceLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(sorted);
  });

  // 4. Simulate or Ingest RTSP Face Scan
  app.post("/api/attendance/scan", (req, res) => {
    const { employee_id, name, status, confidence_score, camera_id, bypass_cooldown } = req.body;
    
    if (!employee_id || !name || !status) {
      return res.status(400).json({ error: "Missing required fields: employee_id, name, status" });
    }

    // Check debounce cooldown timer
    const now = Date.now();
    const lastScan = cooldownTracker.get(employee_id);
    if (!bypass_cooldown && lastScan && now - lastScan < COOLDOWN_MS) {
      const remainingSec = Math.ceil((COOLDOWN_MS - (now - lastScan)) / 1000);
      return res.status(429).json({
        success: false,
        cooldown_blocked: true,
        remaining_seconds: remainingSec,
        message: `Cooldown active for ${name}. Please wait ${remainingSec}s to prevent duplicate entrance logs.`
      });
    }

    // Record new attendance event
    const newRecord: AttendanceRecord = {
      log_id: `LOG-${Date.now().toString().slice(-6)}`,
      employee_id,
      name,
      timestamp: new Date().toISOString(),
      status: status === "OUT" ? "OUT" : "IN",
      confidence_score: confidence_score ? parseFloat(confidence_score) : 0.95,
      camera_id: camera_id || "CAM-01-ENTRANCE",
      direction: status === "OUT" ? "exit" : "entry"
    };

    attendanceLogs.unshift(newRecord);
    cooldownTracker.set(employee_id, now);

    res.json({
      success: true,
      cooldown_blocked: false,
      record: newRecord,
      message: `Successfully logged ${status} for ${name} (Confidence: ${Math.round(newRecord.confidence_score * 100)}%)`
    });
  });

  // 5. Tasks API
  app.get("/api/tasks", (req, res) => {
    const { status, employee_id } = req.query;
    let filtered = [...tasks];
    if (status) {
      filtered = filtered.filter(t => t.status === status);
    }
    if (employee_id) {
      filtered = filtered.filter(t => t.employee_id === employee_id);
    }
    res.json(filtered);
  });

  app.post("/api/tasks", (req, res) => {
    const { employee_id, employee_name, title, description, priority, due_date } = req.body;
    if (!title || !employee_id) {
      return res.status(400).json({ error: "Title and employee_id are required" });
    }

    const newTask: TaskItem = {
      task_id: `TSK-${Math.floor(100 + Math.random() * 900)}`,
      employee_id,
      employee_name: employee_name || (employees.find(e => e.id === employee_id)?.name ?? "Unknown"),
      title,
      description: description || "",
      priority: priority || "Medium",
      due_date: due_date || new Date().toISOString().split("T")[0],
      status: "Pending",
      assigned_date: new Date().toISOString().split("T")[0]
    };

    tasks.unshift(newTask);
    res.status(201).json(newTask);
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const { id } = req.params;
    const taskIndex = tasks.findIndex(t => t.task_id === id);
    if (taskIndex === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    tasks[taskIndex] = {
      ...tasks[taskIndex],
      ...req.body
    };

    res.json(tasks[taskIndex]);
  });

  // 6. Reset database to initial state
  app.post("/api/reset", (_req, res) => {
    employees = [...INITIAL_EMPLOYEES];
    attendanceLogs = [...INITIAL_ATTENDANCE];
    tasks = [...INITIAL_TASKS];
    cooldownTracker.clear();
    res.json({ message: "Database reset to initial demo state." });
  });

  // 7. Voice Agent Query with Function Calling Orchestration
  app.post("/api/agent/query", async (req, res) => {
    const startTime = Date.now();
    const { query } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Missing 'query' string in request body" });
    }

    const ai = getAIClient();

    // If Gemini is configured, invoke gemini-3.8-flash with tools
    if (ai) {
      try {
        const tools = [
          {
            functionDeclarations: [
              {
                name: "get_active_attendees",
                description: "Get list of all employees currently present in the office right now (latest status is IN without an OUT).",
                parameters: {
                  type: Type.OBJECT,
                  properties: {}
                }
              },
              {
                name: "get_employee_attendance",
                description: "Check attendance check-in and check-out logs for a specific employee today.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    employee_name: {
                      type: Type.STRING,
                      description: "The name or partial name of the employee (e.g. 'Alex', 'Sarah Connor')."
                    }
                  },
                  required: ["employee_name"]
                }
              },
              {
                name: "get_pending_tasks",
                description: "List pending or in-progress tasks, optionally filtered by employee name or priority.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    employee_name: {
                      type: Type.STRING,
                      description: "Optional employee name to filter tasks for."
                    },
                    priority: {
                      type: Type.STRING,
                      description: "Optional priority: Critical, High, Medium, or Low."
                    }
                  }
                }
              },
              {
                name: "get_morning_summary",
                description: "Get morning briefing report including current office headcount, late arrivals (after 9:30 AM), and critical tasks due today.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {}
                }
              }
            ]
          }
        ];

        const systemInstruction = `You are a voice assistant for an office environment running on a PC/Android TV.
Your tone is professional, concise, and optimized for low-latency voice text-to-speech (TTS).
Keep answers crisp and direct: 1-3 sentences without bullet formatting or markdown asterisks so it sounds natural when spoken.
Always call the appropriate function tool to fetch live data from the database.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: query,
          config: {
            systemInstruction,
            tools
          }
        });

        const functionCalls = response.functionCalls;
        let toolExec: ToolCallExecution | undefined = undefined;

        if (functionCalls && functionCalls.length > 0) {
          const call = functionCalls[0];
          const toolName = call.name;
          const args = (call.args as Record<string, any>) || {};

          let toolResult: any = null;
          let sqlQuery = "";

          const tTool0 = Date.now();
          if (toolName === "get_active_attendees") {
            const resData = getActiveAttendees();
            toolResult = resData;
            sqlQuery = resData.sql;
          } else if (toolName === "get_employee_attendance") {
            const resData = getEmployeeAttendance(args.employee_name || "Alex");
            toolResult = resData;
            sqlQuery = resData.sql;
          } else if (toolName === "get_pending_tasks") {
            const resData = getPendingTasks(args.employee_name, args.priority);
            toolResult = resData;
            sqlQuery = resData.sql;
          } else if (toolName === "get_morning_summary") {
            const resData = getMorningSummary();
            toolResult = resData;
            sqlQuery = resData.sql;
          }
          const toolTime = Date.now() - tTool0;

          toolExec = {
            tool_name: toolName,
            arguments: args,
            result: toolResult,
            sql_equivalent: sqlQuery,
            execution_time_ms: toolTime
          };

          // Generate conversational voice reply from tool execution
          const followUp = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: [
              { role: "user", parts: [{ text: query }] },
              { role: "model", parts: [{ functionCall: call }] },
              {
                role: "tool",
                parts: [
                  {
                    functionResponse: {
                      name: toolName,
                      response: toolResult
                    }
                  }
                ]
              }
            ],
            config: {
              systemInstruction: "You are the voice assistant. Answer the user's question directly and concisely based on the function result in plain spoken English (no markdown formatting, max 2 sentences)."
            }
          });

          const finalSpeech = followUp.text?.trim() || "Information retrieved successfully.";

          return res.json({
            query,
            answer: finalSpeech,
            tool_call: toolExec,
            total_latency_ms: Date.now() - startTime,
            engine: "gemini-3.8-flash",
            timestamp: new Date().toISOString()
          });
        }

        // If no function call needed, return model text
        const text = response.text || "I am ready to assist with office attendance and task queries.";
        return res.json({
          query,
          answer: text,
          total_latency_ms: Date.now() - startTime,
          engine: "gemini-3.8-flash",
          timestamp: new Date().toISOString()
        });

      } catch (err: any) {
        console.warn("Gemini API call failed, using local orchestrator fallback:", err.message);
      }
    }

    // Fallback: Ultra-fast local function-calling orchestrator (<15ms)
    const local = runLocalOrchestrator(query);
    return res.json({
      query,
      answer: local.answer,
      tool_call: local.toolCall,
      total_latency_ms: Date.now() - startTime,
      engine: "local-function-orchestrator",
      timestamp: new Date().toISOString()
    });
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
