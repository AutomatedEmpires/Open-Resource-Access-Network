/**
 * Drizzle ORM implementation of EntityClusterStore.
 */
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { entityClusters } from '@/db/schema';
import type { EntityClusterStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleEntityClusterStore(
  db: NodePgDatabase<DbSchema>
): EntityClusterStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(entityClusters)
        .where(eq(entityClusters.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByCanonicalEntity(entityType, entityId) {
      return db
        .select()
        .from(entityClusters)
        .where(
          and(
            eq(entityClusters.entityType, entityType),
            eq(entityClusters.canonicalEntityId, entityId),
          ),
        );
    },

    async listByStatus(status, limit = 100) {
      return db
        .select()
        .from(entityClusters)
        .where(eq(entityClusters.status, status))
        .limit(limit);
    },

    async create(row) {
      const result = await db
        .insert(entityClusters)
        .values(row)
        .returning();
      return result[0];
    },

    async update(id, fields) {
      const { id: _omitId, createdAt: _omitCreated, ...safe } = fields as Record<string, unknown>;
      await db
        .update(entityClusters)
        .set({ ...safe, updatedAt: new Date() })
        .where(eq(entityClusters.id, id));
    },
  };
}
