/**
 * Drizzle ORM implementation of SourceRecordStore.
 *
 * Manages the immutable source_records assertion layer and
 * attached taxonomy terms.
 */
import { eq, and, asc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  sourceRecords,
  sourceRecordTaxonomy,
} from '@/db/schema';
import type { SourceRecordStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleSourceRecordStore(
  db: NodePgDatabase<DbSchema>
): SourceRecordStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(sourceRecords)
        .where(eq(sourceRecords.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByDedup(sourceFeedId, sourceRecordType, sourceRecordId, payloadSha256) {
      const rows = await db
        .select()
        .from(sourceRecords)
        .where(
          and(
            eq(sourceRecords.sourceFeedId, sourceFeedId),
            eq(sourceRecords.sourceRecordType, sourceRecordType),
            eq(sourceRecords.sourceRecordId, sourceRecordId),
            eq(sourceRecords.payloadSha256, payloadSha256)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async create(row) {
      const result = await db
        .insert(sourceRecords)
        .values(row)
        .returning();
      return result[0];
    },

    async bulkCreate(rows) {
      if (rows.length === 0) return;
      await db.insert(sourceRecords).values(rows).onConflictDoNothing();
    },

    async updateStatus(id, status, error) {
      await db
        .update(sourceRecords)
        .set({
          processingStatus: status,
          processingError: error ?? null,
          processedAt: new Date(),
        })
        .where(eq(sourceRecords.id, id));
    },

    async listPending(limit = 100) {
      return db
        .select()
        .from(sourceRecords)
        .where(eq(sourceRecords.processingStatus, 'pending'))
        .orderBy(asc(sourceRecords.createdAt))
        .limit(limit);
    },

    async listPendingByFeed(sourceFeedId, limit = 100) {
      return db
        .select()
        .from(sourceRecords)
        .where(
          and(
            eq(sourceRecords.sourceFeedId, sourceFeedId),
            eq(sourceRecords.processingStatus, 'pending')
          )
        )
        .orderBy(asc(sourceRecords.createdAt))
        .limit(limit);
    },

    async listByFeed(sourceFeedId, limit = 500) {
      return db
        .select()
        .from(sourceRecords)
        .where(eq(sourceRecords.sourceFeedId, sourceFeedId))
        .orderBy(asc(sourceRecords.createdAt))
        .limit(limit);
    },

    async addTaxonomy(rows) {
      if (rows.length === 0) return;
      await db.insert(sourceRecordTaxonomy).values(rows);
    },
  };
}
