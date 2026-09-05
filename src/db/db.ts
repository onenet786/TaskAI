import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

function buildConfig(): PoolConfig {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'taskai',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  };
}

export const pool = new Pool(buildConfig());

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err);
});

export async function isDatabaseConnected(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
}
