/**
 * Drizzle ORM implementation of TagConfirmationStore.
 *
 * Maps TagConfirmation domain objects to the tag_confirmation_queue table.
 */
import { eq, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { tagConfirmationQueue } from '@/db/schema';
import type { TagConfirmation, TagConfirmationStatus } from '../tagConfirmations';
import type { ResourceTagType } from '../tags';
import type { TagConfirmationStore, TagConfirmationFilters } from '../stores';
import { getConfidenceTier } from '@/domain/confidence';

/**
 * Convert a DB row to a TagConfirmation domain object.
 */
function rowToConfirmation(
  row: typeof tagConfirmationQueue.$inferSelect
): TagConfirmation {
  const confidence = row.originalConfidence;
  return {
    id: row.id,
    candidateId: row.candidateId,
    resourceTagId: row.resourceTagId,
    tagType: row.tagType as ResourceTagType,
    suggestedValue: row.tagValue,
    suggestedConfidence: confidence,
    confidenceTier: getConfidenceTier(confidence),
    confirmationStatus: row.status as TagConfirmationStatus,
    confirmedValue: row.modifiedTagValue ?? undefined,
    reviewedByUserId: row.reviewedByUserId ?? undefined,
    reviewedAt: row.reviewedAt?.toISOString(),
    reviewNotes: row.reviewNotes ?? undefined,
    evidenceRefs: [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Creates a TagConfirmationStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleTagConfirmationStore(
  db: NodePgDatabase<Record<string, unknown>>
): TagConfirmationStore {
  return {
    async create(confirmation: TagConfirmation): Promise<void> {
      await db.insert(tagConfirmationQueue).values({
        resourceTagId: confirmation.resourceTagId ?? confirmation.id ?? crypto.randomUUID(),
        candidateId: confirmation.candidateId,
        tagType: confirmation.tagType,
        tagValue: confirmation.suggestedValue,
        originalConfidence: confirmation.suggestedConfidence,
        status: confirmation.confirmationStatus,
      });
    },

    async bulkCreate(confirmations: TagConfirmation[]): Promise<void> {
      if (confirmations.length === 0) return;

      const rows = confirmations.map((c) => ({
        resourceTagId: c.resourceTagId ?? c.id ?? crypto.randomUUID(),
        candidateId: c.candidateId,
        tagType: c.tagType,
        tagValue: c.suggestedValue,
        originalConfidence: c.suggestedConfidence,
        status: c.confirmationStatus,
      }));

      await db.insert(tagConfirmationQueue).values(rows);
    },

    async getById(confirmationId: string): Promise<TagConfirmation | null> {
      const rows = await db
        .select()
        .from(tagConfirmationQueue)
        .where(eq(tagConfirmationQueue.id, confirmationId))
        .limit(1);
      return rows.length > 0 ? rowToConfirmation(rows[0]) : null;
    },

    async updateDecision(
      confirmationId: string,
      status: TagConfirmationStatus,
      confirmedValue?: string,
      _confirmedConfidence?: number,
      userId?: string,
      notes?: string
    ): Promise<void> {
      const updates: Record<string, unknown> = {
        status,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      };

      if (confirmedValue !== undefined) {
        updates.modifiedTagValue = confirmedValue;
      }
      if (userId) {
        updates.reviewedByUserId = userId;
      }
      if (notes) {
        updates.reviewNotes = notes;
      }

      await db
        .update(tagConfirmationQueue)
        .set(updates)
        .where(eq(tagConfirmationQueue.id, confirmationId));
    },

    async list(
      filters: TagConfirmationFilters,
      limit?: number,
      offset?: number
    ): Promise<TagConfirmation[]> {
      const conditions = [];

      if (filters.candidateId) {
        conditions.push(
          eq(tagConfirmationQueue.candidateId, filters.candidateId)
        );
      }
      if (filters.tagType) {
        conditions.push(eq(tagConfirmationQueue.tagType, filters.tagType));
      }
      if (filters.confirmationStatus) {
        conditions.push(
          eq(tagConfirmationQueue.status, filters.confirmationStatus)
        );
      }
      if (filters.reviewedByUserId) {
        conditions.push(
          eq(tagConfirmationQueue.reviewedByUserId, filters.reviewedByUserId)
        );
      }

      const rows = await db
        .select()
        .from(tagConfirmationQueue)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(limit ?? 50)
        .offset(offset ?? 0);

      // Post-filter by confidence tier if specified (derived field)
      if (filters.confidenceTier) {
        return rows
          .map(rowToConfirmation)
          .filter((c) => c.confidenceTier === filters.confidenceTier);
      }

      return rows.map(rowToConfirmation);
    },

    async listForCandidate(
      candidateId: string
    ): Promise<TagConfirmation[]> {
      const rows = await db
        .select()
        .from(tagConfirmationQueue)
        .where(eq(tagConfirmationQueue.candidateId, candidateId));
      return rows.map(rowToConfirmation);
    },

    async listPendingForCandidate(
      candidateId: string
    ): Promise<TagConfirmation[]> {
      const rows = await db
        .select()
        .from(tagConfirmationQueue)
        .where(
          and(
            eq(tagConfirmationQueue.candidateId, candidateId),
            eq(tagConfirmationQueue.status, 'pending')
          )
        );
      return rows.map(rowToConfirmation);
    },

    async countPendingByTier(
      candidateId: string
    ): Promise<Record<string, number>> {
      const rows = await db
        .select()
        .from(tagConfirmationQueue)
        .where(
          and(
            eq(tagConfirmationQueue.candidateId, candidateId),
            eq(tagConfirmationQueue.status, 'pending')
          )
        );

      const counts: Record<string, number> = {};
      for (const row of rows) {
        const tier = getConfidenceTier(row.originalConfidence);
        counts[tier] = (counts[tier] ?? 0) + 1;
      }
      return counts;
    },

    async listConfirmed(candidateId: string): Promise<TagConfirmation[]> {
      const rows = await db
        .select()
        .from(tagConfirmationQueue)
        .where(
          and(
            eq(tagConfirmationQueue.candidateId, candidateId),
            sql`${tagConfirmationQueue.status} IN ('confirmed', 'modified', 'auto_approved')`
          )
        );
      return rows.map(rowToConfirmation);
    },
  };
}
