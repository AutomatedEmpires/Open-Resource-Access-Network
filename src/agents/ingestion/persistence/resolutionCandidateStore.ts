/**
 * Drizzle ORM implementation of ResolutionCandidateStore.
 */
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { resolutionCandidates } from '@/db/schema';
import type { ResolutionCandidateStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleResolutionCandidateStore(
  db: NodePgDatabase<DbSchema>
): ResolutionCandidateStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(resolutionCandidates)
        .where(eq(resolutionCandidates.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findBySourceRecord(sourceRecordId) {
      return db
        .select()
        .from(resolutionCandidates)
        .where(eq(resolutionCandidates.sourceRecordId, sourceRecordId));
    },

    async findByEntity(entityType, entityId) {
      return db
        .select()
        .from(resolutionCandidates)
        .where(
          and(
            eq(resolutionCandidates.candidateEntityType, entityType),
            eq(resolutionCandidates.candidateEntityId, entityId),
          ),
        );
    },

    async listByStatus(status, limit = 100) {
      return db
        .select()
        .from(resolutionCandidates)
        .where(eq(resolutionCandidates.status, status))
        .limit(limit);
    },

    async create(row) {
      const result = await db
        .insert(resolutionCandidates)
        .values(row)
        .returning();
      return result[0];
    },

    async update(id, fields) {
      const { id: _omitId, createdAt: _omitCreated, ...safe } = fields as Record<string, unknown>;
      await db
        .update(resolutionCandidates)
        .set(safe)
        .where(eq(resolutionCandidates.id, id));
    },
  };
}
