/**
 * Drizzle ORM implementation of SourceSystemStore.
 *
 * Manages the unified source_systems registry that subsumes
 * the legacy ingestion_sources table.
 */
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sourceSystems } from '@/db/schema';
import type { SourceSystemStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleSourceSystemStore(
  db: NodePgDatabase<DbSchema>
): SourceSystemStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(sourceSystems)
        .where(eq(sourceSystems.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async listActive(filters) {
      const conditions = [eq(sourceSystems.isActive, true)];
      if (filters?.family) {
        conditions.push(eq(sourceSystems.family, filters.family));
      }
      if (filters?.trustTier) {
        conditions.push(eq(sourceSystems.trustTier, filters.trustTier));
      }
      return db
        .select()
        .from(sourceSystems)
        .where(and(...conditions));
    },

    async create(row) {
      const result = await db
        .insert(sourceSystems)
        .values(row)
        .returning();
      return result[0];
    },

    async update(id, updates) {
      // Prevent accidental PK rewrite via spread
      const { id: _omitId, createdAt: _omitCreated, ...safeUpdates } = updates as Record<string, unknown>;
      await db
        .update(sourceSystems)
        .set({ ...safeUpdates, updatedAt: new Date() })
        .where(eq(sourceSystems.id, id));
    },

    async deactivate(id) {
      await db
        .update(sourceSystems)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(sourceSystems.id, id));
    },
  };
}
