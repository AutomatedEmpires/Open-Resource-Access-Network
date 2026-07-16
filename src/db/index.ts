/**
 * Database Connection for ORAN
 *
 * Provides a Drizzle ORM client connected to PostgreSQL via pg in every
 * environment. Production connects through the Supabase Supavisor pooler
 * (see services/db/runtimeRole.ts for the fail-closed URL validation).
 */
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';
import { buildRuntimeDatabaseConnectionString } from '@/services/db/runtimeRole';

let _db: NodePgDatabase<typeof schema> | null = null;
let _pool: Pool | null = null;

/**
 * Get or create the database connection.
 * Uses singleton pattern to reuse connection across requests.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (_db) return _db;

  const configuredConnectionString = process.env.DATABASE_URL;
  if (!configuredConnectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  const connectionString = buildRuntimeDatabaseConnectionString(configuredConnectionString);

  _pool = new Pool({
    connectionString,
    max: process.env.NODE_ENV === 'production' ? 2 : 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: true,
  });

  _db = drizzlePg(_pool, { schema });
  return _db;
}

/**
 * Close the database connection.
 * Call this during graceful shutdown.
 */
export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

/**
 * Get a raw Pool connection for transactions or advanced usage.
 */
export function getPool(): Pool {
  if (!_pool) {
    getDb(); // Initialize pool
  }
  return _pool!;
}

// Re-export schema types
export * from './schema';
export type { NodePgDatabase };
