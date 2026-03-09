/**
 * Drizzle ORM implementation of ResolutionDecisionStore.
 */
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { resolutionDecisions } from '@/db/schema';
import type { ResolutionDecisionStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleResolutionDecisionStore(
  db: NodePgDatabase<DbSchema>
): ResolutionDecisionStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(resolutionDecisions)
        .where(eq(resolutionDecisions.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findBySourceRecord(sourceRecordId) {
      return db
        .select()
        .from(resolutionDecisions)
        .where(eq(resolutionDecisions.sourceRecordId, sourceRecordId));
    },

    async findByEntity(entityType, entityId) {
      return db
        .select()
        .from(resolutionDecisions)
        .where(
          and(
            eq(resolutionDecisions.entityType, entityType),
            eq(resolutionDecisions.entityId, entityId),
          ),
        );
    },

    async create(row) {
      const result = await db
        .insert(resolutionDecisions)
        .values(row)
        .returning();
      return result[0];
    },
  };
}
