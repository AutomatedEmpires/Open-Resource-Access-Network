/**
 * Drizzle DB Helper
 *
 * App Router route handlers (and ingestion pipeline code) use Drizzle for
 * relational access. This module provides a stable import path for routes:
 * `@/services/db/drizzle`.
 */

import { getDb, type NodePgDatabase } from '@/db';
import * as schema from '@/db/schema';

export type DrizzleDb = NodePgDatabase<typeof schema>;

export function getDrizzle(): DrizzleDb {
  return getDb() as DrizzleDb;
}
