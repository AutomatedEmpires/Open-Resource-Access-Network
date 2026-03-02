import { Pool, PoolClient } from 'pg';

function getDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return url;
}

declare global {
  var __oranPgPool: Pool | undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

/**
 * Module-level singleton pool for production.
 * In dev, we use globalThis to survive hot reloads.
 */
let modulePool: Pool | undefined;

/** Shared pool options for safety: timeout, connection limits */
const POOL_OPTIONS = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  /** Abort any query running longer than 30 seconds — prevents DoS via slow queries */
  statement_timeout: 30_000,
} as const;

export function getPgPool(): Pool {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }

  // Dev: cache on globalThis to survive Next.js hot reloads.
  if (process.env.NODE_ENV !== 'production') {
    if (!globalThis.__oranPgPool) {
      globalThis.__oranPgPool = new Pool({
        connectionString: databaseUrl,
        ...POOL_OPTIONS,
      });
    }
    return globalThis.__oranPgPool;
  }

  // Production: module-level singleton — no leak.
  if (!modulePool) {
    modulePool = new Pool({
      connectionString: databaseUrl,
      ...POOL_OPTIONS,
    });
  }
  return modulePool;
}

export async function executeQuery<T>(sql: string, params: unknown[]): Promise<T[]> {
  const pool = getPgPool();
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function executeCount(sql: string, params: unknown[]): Promise<number> {
  const pool = getPgPool();
  const result = await pool.query<{ count: string }>(sql, params);
  const countStr = result.rows[0]?.count ?? '0';
  const count = Number.parseInt(countStr, 10);
  return Number.isFinite(count) ? count : 0;
}

/**
 * Execute a callback within a database transaction (BEGIN / COMMIT / ROLLBACK).
 * The callback receives a `PoolClient` that should be used for all queries.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
