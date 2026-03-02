/**
 * Database Connection for ORAN
 *
 * Provides a Drizzle ORM client connected to PostgreSQL.
 * Uses pg for local dev, @neondatabase/serverless for production edge.
 */
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

let _db: NodePgDatabase<typeof schema> | null = null;
let _pool: Pool | null = null;

/**
 * Get or create the database connection.
 * Uses singleton pattern to reuse connection across requests.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  _pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
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
