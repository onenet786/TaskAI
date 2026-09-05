import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { pool, isDatabaseConnected } from "./src/db/db";
import { initSchema, seedDatabase } from "./src/db/schema";
import {
  Employee,
  AttendanceRecord,
  TaskItem,
  ToolCallExecution,
  CustomCommand,
  AgentBuiltinFunction,
} from "./src/types";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3000", 10);

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

// Cooldown tracker: employee_id -> last scan timestamp
const cooldownTracker = new Map<string, number>();
const COOLDOWN_MS = 30 * 1000; // 30 seconds

// ============================================================================
// Database query helpers
// ============================================================================

async function getActiveAttendees() {
  const result = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (employee_id)
        employee_id, status, timestamp, confidence_score
      FROM attendance_logs
      ORDER BY employee_id, timestamp DESC
    ),
    first_in AS (
      SELECT DISTINCT ON (employee_id)
        employee_id, timestamp
      FROM attendance_logs
      WHERE status = 'IN'
      ORDER BY employee_id, timestamp ASC
    )
    SELECT e.id AS employee_id, e.name, e.role, e.department,
           f.timestamp AS arrival_time, l.confidence_score
    FROM employees e
    JOIN latest l ON e.id = l.employee_id
    LEFT JOIN first_in f ON e.id = f.employee_id
    WHERE l.status = 'IN'
  `);

  const present_employees = result.rows.map((row: any) => ({
    employee_id: row.employee_id,
    name: row.name,
    role: row.role,
    department: row.department,
    arrival_time: row.arrival_time
      ? new Date(row.arrival_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "—",
    confidence: parseFloat(row.confidence_score) || 0,
  }));

  return {
    count: present_employees.length,
    present_employees,
    sql: `SELECT e.id, e.name, e.role, a.timestamp, a.confidence_score FROM employees e JOIN (SELECT employee_id, status, timestamp, confidence_score, ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY timestamp DESC) as rn FROM attendance_logs) a ON e.id = a.employee_id WHERE a.rn = 1 AND a.status = 'IN';`,
  };
}

async function getEmployeeAttendance(employeeName: string) {
  const searchName = employeeName.trim().toLowerCase();
  const empResult = await pool.query(
    `SELECT * FROM employees WHERE LOWER(name) LIKE $1`,
    [`%${searchName}%`]
  );

  if (empResult.rows.length === 0) {
    return {
      found: false,
      message: `No employee found matching "${employeeName}".`,
      sql: `SELECT * FROM employees WHERE LOWER(name) LIKE '%${employeeName.replace(/'/g, "''")}%';`,
    };
  }

  const emp = empResult.rows[0];
  const logsResult = await pool.query(
    `SELECT * FROM attendance_logs WHERE employee_id = $1 ORDER BY timestamp ASC`,
    [emp.id]
  );
  const logs: AttendanceRecord[] = logsResult.rows;

  const firstIn = logs.find((l) => l.status === "IN");
  const latest = logs[logs.length - 1];

  return {
    found: true,
    employee_id: emp.id,
    employee_name: emp.name,
    role: emp.role,
    checked_in_today: !!firstIn,
    first_check_in_time: firstIn ? new Date(firstIn.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null,
    current_status: latest ? latest.status : "NOT_LOGGED",
    last_event_time: latest ? new Date(latest.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null,
    confidence: latest ? latest.confidence_score : 0,
    total_events: logs.length,
    sql: `SELECT * FROM attendance_logs WHERE employee_id = '${emp.id}' ORDER BY timestamp ASC;`,
  };
}

async function getPendingTasks(employeeName?: string, priority?: string) {
  const conditions: string[] = ["t.status != 'Done'"];
  const params: any[] = [];
  let idx = 1;

  if (employeeName) {
    conditions.push(`LOWER(t.employee_name) LIKE $${idx}`);
    params.push(`%${employeeName.toLowerCase()}%`);
    idx++;
  }
  if (priority) {
    conditions.push(`LOWER(t.priority) = $${idx}`);
    params.push(priority.toLowerCase());
    idx++;
  }

  const query = `
    SELECT t.*, e.name AS employee_name
    FROM tasks t
    JOIN employees e ON t.employee_id = e.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY
      CASE t.priority WHEN 'Critical' THEN 4 WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END DESC,
      t.due_date ASC
  `;
  const result = await pool.query(query, params);

  const tasks = result.rows.map((t: any) => ({
    task_id: t.task_id,
    assignee: t.employee_name,
    title: t.title,
    priority: t.priority,
    status: t.status,
    due_date: t.due_date,
  }));

  return {
    count: tasks.length,
    tasks,
    sql: `SELECT * FROM tasks WHERE status != 'Done' ${employeeName ? `AND LOWER(employee_name) LIKE '%${employeeName}%'` : ""} ${priority ? `AND LOWER(priority) = '${priority}'` : ""} ORDER BY priority DESC, due_date ASC;`,
  };
}

async function getLateArrivals() {
  const result = await pool.query(`
    SELECT DISTINCT ON (employee_id)
      employee_id, name, timestamp
    FROM attendance_logs
    WHERE status = 'IN'
    ORDER BY employee_id, timestamp ASC
  `);

  const late: Array<{ name: string; time: string }> = [];
  for (const row of result.rows) {
    const d = new Date(row.timestamp);
    if (d.getHours() > 9 || (d.getHours() === 9 && d.getMinutes() > 30)) {
      late.push({
        name: row.name,
        time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
    }
  }

  return {
    count: late.length,
    late_arrivals: late,
    sql: `SELECT employee_id, min(timestamp) FROM attendance_logs WHERE status='IN' GROUP BY employee_id HAVING TIME(min(timestamp)) > '09:30:00';`,
  };
}

async function getDepartmentSummary() {
  const result = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (employee_id)
        employee_id, status
      FROM attendance_logs
      ORDER BY employee_id, timestamp DESC
    )
    SELECT e.department, COUNT(*) FILTER (WHERE l.status = 'IN') AS present,
           COUNT(*) AS total
    FROM employees e
    LEFT JOIN latest l ON e.id = l.employee_id
    GROUP BY e.department
  `);

  return {
    departments: result.rows.map((r: any) => ({
      department: r.department,
      present: parseInt(r.present, 10) || 0,
      total: parseInt(r.total, 10),
    })),
    sql: `SELECT e.department, COUNT(*) FILTER (WHERE latest.status='IN') AS present, COUNT(*) AS total FROM employees e LEFT JOIN (SELECT DISTINCT ON (employee_id) employee_id, status FROM attendance_logs ORDER BY employee_id, timestamp DESC) latest ON e.id=latest.employee_id GROUP BY e.department;`,
  };
}

async function getMorningSummary() {
  const activeData = await getActiveAttendees();
  const lateData = await getLateArrivals();
  const criticalResult = await pool.query(
    `SELECT * FROM tasks WHERE priority = 'Critical' AND status != 'Done' ORDER BY due_date ASC`
  );
  const criticalTasks = criticalResult.rows;

  return {
    active_count: activeData.count,
    present_employees: activeData.present_employees.map((p) => p.name),
    late_arrivals: lateData.late_arrivals,
    critical_tasks: criticalTasks.map((t: any) => ({ title: t.title, assignee: t.employee_name, status: t.status })),
    sql: `/* Morning Multi-Table Summary */
SELECT count(*) AS present_count FROM attendance_logs WHERE status='IN';
SELECT employee_id, min(timestamp) FROM attendance_logs WHERE status='IN' GROUP BY employee_id HAVING TIME(min(timestamp)) > '09:30:00';
SELECT * FROM tasks WHERE priority='Critical' AND status != 'Done';`,
  };
}

async function executeBuiltinFunction(
  name: AgentBuiltinFunction,
  args: Record<string, any> = {}
): Promise<{ answer: string; result: any; sql: string }> {
  switch (name) {
    case "get_active_attendees": {
      const data = await getActiveAttendees();
      const names = data.present_employees.map((p) => p.name);
      const answer = names.length > 0
        ? `There are currently ${names.length} team members in the office: ${names.join(", ")}.`
        : "No team members are currently checked into the office.";
      return { answer, result: data, sql: data.sql };
    }
    case "get_employee_attendance": {
      const empName = args.employee_name || "Alex";
      const data = await getEmployeeAttendance(empName);
      let answer = "";
      if (data.found) {
        if (data.checked_in_today) {
          answer = `${data.employee_name} checked in today at ${data.first_check_in_time} (Current status: ${data.current_status}, face match confidence: ${Math.round((data.confidence || 0) * 100)}%).`;
        } else {
          answer = `${data.employee_name} has not checked in today yet.`;
        }
      } else {
        answer = `I couldn't find any attendance logs for "${empName}".`;
      }
      return { answer, result: data, sql: data.sql };
    }
    case "get_pending_tasks": {
      const data = await getPendingTasks(args.employee_name, args.priority);
      let answer = "";
      if (data.count === 0) {
        answer = args.employee_name
          ? `${args.employee_name} has no pending tasks right now.`
          : "There are no pending tasks in the office backlog.";
      } else {
        const top = data.tasks[0];
        answer = `${args.employee_name || "The team"} has ${data.count} pending task${data.count > 1 ? "s" : ""}. Most urgent: "${top.title}" [${top.priority} priority, assigned to ${top.assignee}].`;
      }
      return { answer, result: data, sql: data.sql };
    }
    case "get_morning_summary": {
      const summary = await getMorningSummary();
      const answer = `Morning Briefing: We have ${summary.active_count} employee${summary.active_count === 1 ? "" : "s"} currently in the office (${summary.present_employees.join(", ")}). ${summary.late_arrivals.length > 0 ? `Late arrivals: ${summary.late_arrivals.map((l) => `${l.name} at ${l.time}`).join(", ")}.` : "All arrivals were on time."} There ${summary.critical_tasks.length === 1 ? "is" : "are"} ${summary.critical_tasks.length} critical task${summary.critical_tasks.length === 1 ? "" : "s"} scheduled for today.`;
      return { answer, result: summary, sql: summary.sql };
    }
    case "get_late_arrivals": {
      const data = await getLateArrivals();
      const answer = data.count > 0
        ? `Late arrivals today: ${data.late_arrivals.map((l) => `${l.name} at ${l.time}`).join(", ")}.`
        : "No one has arrived late today.";
      return { answer, result: data, sql: data.sql };
    }
    case "get_department_summary": {
      const data = await getDepartmentSummary();
      const parts = data.departments.map((d) => `${d.department}: ${d.present}/${d.total} present`);
      const answer = `Department presence: ${parts.join("; ")}.`;
      return { answer, result: data, sql: data.sql };
    }
    default:
      throw new Error(`Unknown builtin function: ${name}`);
  }
}

// ============================================================================
// Custom commands
// ============================================================================

async function getActiveCustomCommands(): Promise<CustomCommand[]> {
  const result = await pool.query(
    `SELECT * FROM custom_commands WHERE is_active = true ORDER BY created_at DESC`
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    trigger_phrases: r.trigger_phrases,
    action_type: r.action_type,
    response_text: r.response_text,
    target_function: r.target_function,
    is_active: r.is_active,
    created_at: r.created_at,
  }));
}

async function getCustomCommandById(id: number): Promise<CustomCommand | null> {
  const result = await pool.query(`SELECT * FROM custom_commands WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    name: r.name,
    trigger_phrases: r.trigger_phrases,
    action_type: r.action_type,
    response_text: r.response_text,
    target_function: r.target_function,
    is_active: r.is_active,
    created_at: r.created_at,
  };
}

function queryMatchesTriggers(query: string, triggerPhrases: string[]): boolean {
  const lower = query.toLowerCase();
  return triggerPhrases.some((phrase) => lower.includes(phrase.toLowerCase()));
}

async function matchCustomCommand(query: string): Promise<CustomCommand | null> {
  const commands = await getActiveCustomCommands();
  return commands.find((cmd) => queryMatchesTriggers(query, cmd.trigger_phrases)) || null;
}

async function executeCustomCommand(
  command: CustomCommand,
  query: string
): Promise<{ answer: string; toolCall: ToolCallExecution }> {
  const t0 = Date.now();

  if (command.action_type === "static" || !command.target_function) {
    const answer = command.response_text || "Command executed.";
    return {
      answer,
      toolCall: {
        tool_name: "run_custom_command",
        arguments: { command_id: command.id, query },
        result: { command_name: command.name, action_type: command.action_type, response: answer },
        sql_equivalent: `-- Static custom command: ${command.name}`,
        execution_time_ms: Date.now() - t0,
      },
    };
  }

  const builtin = command.target_function as AgentBuiltinFunction;
  const { answer, result, sql } = await executeBuiltinFunction(builtin, {});
  return {
    answer,
    toolCall: {
      tool_name: "run_custom_command",
      arguments: { command_id: command.id, command_name: command.name, target_function: builtin },
      result,
      sql_equivalent: sql,
      execution_time_ms: Date.now() - t0,
    },
  };
}

// ============================================================================
// Local orchestrator
// ============================================================================

async function runLocalOrchestrator(prompt: string): Promise<{ answer: string; toolCall: ToolCallExecution }> {
  const t0 = Date.now();
  const lower = prompt.toLowerCase();

  // 1. Custom commands take priority
  const custom = await matchCustomCommand(prompt);
  if (custom) {
    return executeCustomCommand(custom, prompt);
  }

  // 2. Builtin keyword routing
  if (lower.includes("who is in") || lower.includes("in the office") || lower.includes("who's in") || lower.includes("present today")) {
    const { answer, result, sql } = await executeBuiltinFunction("get_active_attendees");
    return {
      answer,
      toolCall: { tool_name: "get_active_attendees", arguments: {}, result, sql_equivalent: sql, execution_time_ms: Date.now() - t0 },
    };
  }

  if (lower.includes("late") || lower.includes("arrived after")) {
    const { answer, result, sql } = await executeBuiltinFunction("get_late_arrivals");
    return {
      answer,
      toolCall: { tool_name: "get_late_arrivals", arguments: {}, result, sql_equivalent: sql, execution_time_ms: Date.now() - t0 },
    };
  }

  if (lower.includes("department") || lower.includes("team presence")) {
    const { answer, result, sql } = await executeBuiltinFunction("get_department_summary");
    return {
      answer,
      toolCall: { tool_name: "get_department_summary", arguments: {}, result, sql_equivalent: sql, execution_time_ms: Date.now() - t0 },
    };
  }

  if (lower.includes("task") || lower.includes("pending") || lower.includes("todo") || lower.includes("assigned")) {
    let target: string | undefined = undefined;
    if (lower.includes("sarah")) target = "Sarah";
    else if (lower.includes("alex")) target = "Alex";
    else if (lower.includes("elena")) target = "Elena";
    else if (lower.includes("marcus")) target = "Marcus";

    const { answer, result, sql } = await executeBuiltinFunction("get_pending_tasks", { employee_name: target });
    return {
      answer,
      toolCall: { tool_name: "get_pending_tasks", arguments: { employee_name: target || "ALL" }, result, sql_equivalent: sql, execution_time_ms: Date.now() - t0 },
    };
  }

  if (
    lower.includes("check in") ||
    lower.includes("checked in") ||
    lower.includes("arrival") ||
    lower.includes("what time") ||
    lower.includes("attendance") ||
    lower.includes("alex") ||
    lower.includes("sarah") ||
    lower.includes("marcus") ||
    lower.includes("elena") ||
    lower.includes("david") ||
    lower.includes("maya")
  ) {
    let target = "Alex";
    if (lower.includes("sarah")) target = "Sarah";
    else if (lower.includes("marcus")) target = "Marcus";
    else if (lower.includes("elena")) target = "Elena";
    else if (lower.includes("david")) target = "David";
    else if (lower.includes("maya")) target = "Maya";

    const { answer, result, sql } = await executeBuiltinFunction("get_employee_attendance", { employee_name: target });
    return {
      answer,
      toolCall: { tool_name: "get_employee_attendance", arguments: { employee_name: target }, result, sql_equivalent: sql, execution_time_ms: Date.now() - t0 },
    };
  }

  // 3. Default: Morning Summary
  const { answer, result, sql } = await executeBuiltinFunction("get_morning_summary");
  return {
    answer,
    toolCall: { tool_name: "get_morning_summary", arguments: {}, result, sql_equivalent: sql, execution_time_ms: Date.now() - t0 },
  };
}

// ============================================================================
// Gemini tool definitions
// ============================================================================

function buildBuiltinTools() {
  return [
    {
      functionDeclarations: [
        {
          name: "get_active_attendees",
          description: "Get list of all employees currently present in the office right now (latest status is IN without an OUT).",
          parameters: { type: Type.OBJECT, properties: {} },
        },
        {
          name: "get_employee_attendance",
          description: "Check attendance check-in and check-out logs for a specific employee today.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              employee_name: {
                type: Type.STRING,
                description: "The name or partial name of the employee (e.g. 'Alex', 'Sarah Connor').",
              },
            },
            required: ["employee_name"],
          },
        },
        {
          name: "get_pending_tasks",
          description: "List pending or in-progress tasks, optionally filtered by employee name or priority.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              employee_name: {
                type: Type.STRING,
                description: "Optional employee name to filter tasks for.",
              },
              priority: {
                type: Type.STRING,
                description: "Optional priority: Critical, High, Medium, or Low.",
              },
            },
          },
        },
        {
          name: "get_morning_summary",
          description: "Get morning briefing report including current office headcount, late arrivals (after 9:30 AM), and critical tasks due today.",
          parameters: { type: Type.OBJECT, properties: {} },
        },
        {
          name: "get_late_arrivals",
          description: "List employees who checked in after 9:30 AM today.",
          parameters: { type: Type.OBJECT, properties: {} },
        },
        {
          name: "get_department_summary",
          description: "Show how many employees are currently present in each department.",
          parameters: { type: Type.OBJECT, properties: {} },
        },
      ],
    },
  ];
}

async function buildCustomToolDeclarations() {
  const commands = await getActiveCustomCommands();
  if (commands.length === 0) return [];

  const commandEnum = commands.map((c) => `${c.id}: ${c.name}`).join("; ");
  return [
    {
      functionDeclarations: [
        {
          name: "run_custom_command",
          description: `Run a user-defined custom command. Available commands: ${commandEnum}. Only use this when the user's query clearly matches one of these command names or trigger phrases.`,
          parameters: {
            type: Type.OBJECT,
            properties: {
              command_id: {
                type: Type.INTEGER,
                description: "The numeric id of the custom command to run.",
              },
            },
            required: ["command_id"],
          },
        },
      ],
    },
  ];
}

// ============================================================================
// Server
// ============================================================================

async function startServer() {
  const app = express();

  // Initialize Postgres schema + seed demo data
  try {
    await initSchema();
    await seedDatabase();
    console.log("Postgres connected and schema initialized.");
  } catch (err: any) {
    console.error("Failed to initialize Postgres:", err.message);
    process.exit(1);
  }

  app.use(express.json());

  // 1. Health check
  app.get("/api/health", async (_req, res) => {
    const empCount = await pool.query("SELECT COUNT(*) FROM employees");
    const attCount = await pool.query("SELECT COUNT(*) FROM attendance_logs");
    const taskCount = await pool.query("SELECT COUNT(*) FROM tasks");
    res.json({
      status: "online",
      service: "OfficeTask Voice & Attendance Server",
      gemini_configured: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY",
      database_connected: await isDatabaseConnected(),
      total_employees: parseInt(empCount.rows[0].count, 10),
      attendance_records: parseInt(attCount.rows[0].count, 10),
      tasks_count: parseInt(taskCount.rows[0].count, 10),
    });
  });

  // 2. Employees API
  app.get("/api/employees", async (_req, res) => {
    const result = await pool.query("SELECT * FROM employees ORDER BY name");
    res.json(result.rows);
  });

  // 3. Attendance Logs API
  app.get("/api/attendance", async (_req, res) => {
    const result = await pool.query(
      "SELECT * FROM attendance_logs ORDER BY timestamp DESC"
    );
    res.json(result.rows);
  });

  // 4. Simulate or Ingest RTSP Face Scan
  app.post("/api/attendance/scan", async (req, res) => {
    const { employee_id, name, status, confidence_score, camera_id, bypass_cooldown } = req.body;

    if (!employee_id || !name || !status) {
      return res.status(400).json({ error: "Missing required fields: employee_id, name, status" });
    }

    // Verify employee exists
    const emp = await pool.query("SELECT id FROM employees WHERE id = $1", [employee_id]);
    if (emp.rows.length === 0) {
      return res.status(404).json({ error: `Employee ${employee_id} not found` });
    }

    const now = Date.now();
    const lastScan = cooldownTracker.get(employee_id);
    if (!bypass_cooldown && lastScan && now - lastScan < COOLDOWN_MS) {
      const remainingSec = Math.ceil((COOLDOWN_MS - (now - lastScan)) / 1000);
      return res.status(429).json({
        success: false,
        cooldown_blocked: true,
        remaining_seconds: remainingSec,
        message: `Cooldown active for ${name}. Please wait ${remainingSec}s to prevent duplicate entrance logs.`,
      });
    }

    const newRecord: AttendanceRecord = {
      log_id: `LOG-${Date.now().toString().slice(-6)}`,
      employee_id,
      name,
      timestamp: new Date().toISOString(),
      status: status === "OUT" ? "OUT" : "IN",
      confidence_score: confidence_score ? parseFloat(confidence_score) : 0.95,
      camera_id: camera_id || "CAM-01-ENTRANCE",
      direction: status === "OUT" ? "exit" : "entry",
    };

    await pool.query(
      `INSERT INTO attendance_logs (log_id, employee_id, name, timestamp, status, confidence_score, camera_id, direction)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newRecord.log_id, newRecord.employee_id, newRecord.name, newRecord.timestamp, newRecord.status, newRecord.confidence_score, newRecord.camera_id, newRecord.direction]
    );

    cooldownTracker.set(employee_id, now);

    res.json({
      success: true,
      cooldown_blocked: false,
      record: newRecord,
      message: `Successfully logged ${status} for ${name} (Confidence: ${Math.round(newRecord.confidence_score * 100)}%)`,
    });
  });

  // 5. Tasks API
  app.get("/api/tasks", async (req, res) => {
    const { status, employee_id } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (employee_id) {
      conditions.push(`employee_id = $${idx}`);
      params.push(employee_id);
      idx++;
    }

    const query = `SELECT * FROM tasks ${conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY due_date ASC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  });

  app.post("/api/tasks", async (req, res) => {
    const { employee_id, employee_name, title, description, priority, due_date } = req.body;
    if (!title || !employee_id) {
      return res.status(400).json({ error: "Title and employee_id are required" });
    }

    const empResult = await pool.query("SELECT name FROM employees WHERE id = $1", [employee_id]);
    const empName = employee_name || empResult.rows[0]?.name || "Unknown";

    const newTask: TaskItem = {
      task_id: `TSK-${Math.floor(100 + Math.random() * 900)}`,
      employee_id,
      employee_name: empName,
      title,
      description: description || "",
      priority: priority || "Medium",
      due_date: due_date || new Date().toISOString().split("T")[0],
      status: "Pending",
      assigned_date: new Date().toISOString().split("T")[0],
    };

    await pool.query(
      `INSERT INTO tasks (task_id, employee_id, employee_name, title, description, priority, due_date, status, assigned_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newTask.task_id, newTask.employee_id, newTask.employee_name, newTask.title, newTask.description, newTask.priority, newTask.due_date, newTask.status, newTask.assigned_date]
    );

    res.status(201).json(newTask);
  });

  app.patch("/api/tasks/:id", async (req, res) => {
    const { id } = req.params;
    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(req.body)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE tasks SET ${setClauses.join(", ")} WHERE task_id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(result.rows[0]);
  });

  // 6. Reset database to initial state
  app.post("/api/reset", async (_req, res) => {
    await pool.query("TRUNCATE attendance_logs, tasks, custom_commands RESTART IDENTITY CASCADE");
    await seedDatabase();
    cooldownTracker.clear();
    res.json({ message: "Database reset to initial demo state." });
  });

  // 7. Custom Commands API
  app.get("/api/custom-commands", async (_req, res) => {
    const result = await pool.query("SELECT * FROM custom_commands ORDER BY created_at DESC");
    res.json(result.rows);
  });

  app.post("/api/custom-commands", async (req, res) => {
    const { name, trigger_phrases, action_type, response_text, target_function } = req.body;
    if (!name || !trigger_phrases || trigger_phrases.length === 0) {
      return res.status(400).json({ error: "name and trigger_phrases are required" });
    }

    const result = await pool.query(
      `INSERT INTO custom_commands (name, trigger_phrases, action_type, response_text, target_function)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, trigger_phrases, action_type || "static", response_text || null, target_function || null]
    );
    res.status(201).json(result.rows[0]);
  });

  app.patch("/api/custom-commands/:id", async (req, res) => {
    const { id } = req.params;
    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(req.body)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE custom_commands SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Custom command not found" });
    }

    res.json(result.rows[0]);
  });

  app.delete("/api/custom-commands/:id", async (req, res) => {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM custom_commands WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Custom command not found" });
    }
    res.json({ message: "Custom command deleted" });
  });

  // 8. Voice Agent Query with Function Calling Orchestration
  app.post("/api/agent/query", async (req, res) => {
    const startTime = Date.now();
    const { query } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Missing 'query' string in request body" });
    }

    const ai = getAIClient();

    if (ai) {
      try {
        const tools = [...buildBuiltinTools(), ...(await buildCustomToolDeclarations())];

        const systemInstruction = `You are a voice assistant for an office environment running on a PC/Android TV.
Your tone is professional, concise, and optimized for low-latency voice text-to-speech (TTS).
Keep answers crisp and direct: 1-3 sentences without bullet formatting or markdown asterisks so it sounds natural when spoken.
Always call the appropriate function tool to fetch live data from the database.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: query,
          config: { systemInstruction, tools },
        });

        const functionCalls = response.functionCalls;
        let toolExec: ToolCallExecution | undefined = undefined;

        if (functionCalls && functionCalls.length > 0) {
          const call = functionCalls[0];
          const toolName = call.name;
          const args = (call.args as Record<string, any>) || {};

          let answer = "";
          let toolResult: any = null;
          let sqlQuery = "";

          const tTool0 = Date.now();
          if (toolName === "run_custom_command") {
            const command = await getCustomCommandById(args.command_id);
            if (!command) {
              return res.json({
                query,
                answer: "I could not find that custom command.",
                total_latency_ms: Date.now() - startTime,
                engine: "gemini-3.8-flash",
                timestamp: new Date().toISOString(),
              });
            }
            const exec = await executeCustomCommand(command, query);
            answer = exec.answer;
            toolResult = exec.toolCall.result;
            sqlQuery = exec.toolCall.sql_equivalent || "";
          } else {
            const builtin = toolName as AgentBuiltinFunction;
            const exec = await executeBuiltinFunction(builtin, args);
            answer = exec.answer;
            toolResult = exec.result;
            sqlQuery = exec.sql;
          }
          const toolTime = Date.now() - tTool0;

          toolExec = {
            tool_name: toolName,
            arguments: args,
            result: toolResult,
            sql_equivalent: sqlQuery,
            execution_time_ms: toolTime,
          };

          const followUp = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: [
              { role: "user", parts: [{ text: query }] },
              { role: "model", parts: [{ functionCall: call }] },
              {
                role: "tool",
                parts: [{ functionResponse: { name: toolName, response: toolResult } }],
              },
            ],
            config: {
              systemInstruction: "You are the voice assistant. Answer the user's question directly and concisely based on the function result in plain spoken English (no markdown formatting, max 2 sentences).",
            },
          });

          const finalSpeech = followUp.text?.trim() || answer;

          return res.json({
            query,
            answer: finalSpeech,
            tool_call: toolExec,
            total_latency_ms: Date.now() - startTime,
            engine: "gemini-3.8-flash",
            timestamp: new Date().toISOString(),
          });
        }

        const text = response.text || "I am ready to assist with office attendance and task queries.";
        return res.json({
          query,
          answer: text,
          total_latency_ms: Date.now() - startTime,
          engine: "gemini-3.8-flash",
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        console.warn("Gemini API call failed, using local orchestrator fallback:", err.message);
      }
    }

    // Fallback: local orchestrator
    const local = await runLocalOrchestrator(query);
    return res.json({
      query,
      answer: local.answer,
      tool_call: local.toolCall,
      total_latency_ms: Date.now() - startTime,
      engine: "local-function-orchestrator",
      timestamp: new Date().toISOString(),
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
