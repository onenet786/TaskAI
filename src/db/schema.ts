import { pool } from './db';
import { INITIAL_EMPLOYEES, INITIAL_ATTENDANCE, INITIAL_TASKS } from '../data/mockData';

export async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT,
        department TEXT,
        face_embeddings_ref TEXT,
        avatar TEXT,
        registered_date TEXT,
        email TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        log_id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('IN', 'OUT')),
        confidence_score REAL NOT NULL,
        camera_id TEXT,
        direction TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        employee_name TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL,
        assigned_date TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS custom_commands (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        trigger_phrases TEXT[] NOT NULL,
        action_type TEXT NOT NULL CHECK (action_type IN ('static', 'function')),
        response_text TEXT,
        target_function TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function seedDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const empCount = await client.query('SELECT COUNT(*) FROM employees');
    if (parseInt(empCount.rows[0].count, 10) === 0) {
      for (const emp of INITIAL_EMPLOYEES) {
        await client.query(
          `INSERT INTO employees (id, name, role, department, face_embeddings_ref, avatar, registered_date, email)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [emp.id, emp.name, emp.role, emp.department, emp.face_embeddings_ref, emp.avatar, emp.registered_date, emp.email]
        );
      }
    }

    const attCount = await client.query('SELECT COUNT(*) FROM attendance_logs');
    if (parseInt(attCount.rows[0].count, 10) === 0) {
      for (const log of INITIAL_ATTENDANCE) {
        await client.query(
          `INSERT INTO attendance_logs (log_id, employee_id, name, timestamp, status, confidence_score, camera_id, direction)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [log.log_id, log.employee_id, log.name, log.timestamp, log.status, log.confidence_score, log.camera_id, log.direction]
        );
      }
    }

    const taskCount = await client.query('SELECT COUNT(*) FROM tasks');
    if (parseInt(taskCount.rows[0].count, 10) === 0) {
      for (const task of INITIAL_TASKS) {
        await client.query(
          `INSERT INTO tasks (task_id, employee_id, employee_name, title, description, priority, due_date, status, assigned_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [task.task_id, task.employee_id, task.employee_name, task.title, task.description, task.priority, task.due_date, task.status, task.assigned_date]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
