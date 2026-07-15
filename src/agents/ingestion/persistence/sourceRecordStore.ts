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
import type { SourceRecordRow } from '@/db/schema';
import type { SourceRecordStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export interface SourceRecordNormalizationClaimKey {
  id: string;
  sourceFeedId: string;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
}

export interface SourceRecordNormalizationClaim {
  claimed: boolean;
  sourceRecord: SourceRecordRow;
}

/**
 * Transaction-bound extension used by the normalization bridge.
 *
 * The composite store interface intentionally stays implementation-agnostic;
 * normalization detects this capability at runtime and fails closed when the
 * backing store cannot provide a row lock plus compare-and-set claim.
 */
export interface AtomicSourceRecordStore extends SourceRecordStore {
  claimPendingForNormalization(
    expected: SourceRecordNormalizationClaimKey,
  ): Promise<SourceRecordNormalizationClaim>;
}

export function createDrizzleSourceRecordStore(
  db: NodePgDatabase<DbSchema>
): AtomicSourceRecordStore {
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

    async claimPendingForNormalization(expected) {
      // This method is called through a transaction-bound store. Locking the
      // assertion serializes concurrent normalizers for the same source row.
      const lockedRows = await db
        .select()
        .from(sourceRecords)
        .where(eq(sourceRecords.id, expected.id))
        .limit(1)
        .for('update');
      const locked = lockedRows[0];

      if (!locked) {
        throw new Error(`Source record ${expected.id} no longer exists`);
      }

      if (
        locked.sourceFeedId !== expected.sourceFeedId
        || locked.sourceRecordType !== expected.sourceRecordType
        || locked.sourceRecordId !== expected.sourceRecordId
        || locked.payloadSha256 !== expected.payloadSha256
      ) {
        throw new Error(
          `Source record ${expected.id} changed before normalization could claim it`,
        );
      }

      if (locked.processingStatus !== 'pending') {
        return { claimed: false, sourceRecord: locked };
      }

      // Keep the status predicate even though the row is locked. It is the
      // explicit pending -> processing CAS and protects this method if its
      // locking contract is ever weakened by a future adapter.
      const claimedRows = await db
        .update(sourceRecords)
        .set({
          processingStatus: 'processing',
          processingError: null,
          processedAt: null,
        })
        .where(and(
          eq(sourceRecords.id, expected.id),
          eq(sourceRecords.processingStatus, 'pending'),
        ))
        .returning();
      const claimed = claimedRows[0];

      if (!claimed) {
        throw new Error(`Source record ${expected.id} normalization claim was lost`);
      }

      return { claimed: true, sourceRecord: claimed };
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
