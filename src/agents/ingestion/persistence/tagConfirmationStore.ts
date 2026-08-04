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

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function toDatabaseStatus(status: TagConfirmationStatus): string {
  if (status === 'confirmed') return 'approved';
  // AI confidence is not human approval. Legacy domain factories may still
  // emit auto_approved, but durable publication evidence must remain pending.
  if (status === 'auto_approved') return 'pending';
  return status;
}

function fromDatabaseStatus(
  status: string,
  reviewedByUserId: string | null,
): TagConfirmationStatus {
  if (status === 'approved') return reviewedByUserId ? 'confirmed' : 'auto_approved';
  if (status === 'skipped') return 'rejected';
  return status as TagConfirmationStatus;
}

function requireResourceTagId(confirmation: TagConfirmation): string {
  const resourceTagId = confirmation.resourceTagId?.trim();
  if (!resourceTagId) {
    throw new Error('Tag confirmation requires a persisted resourceTagId');
  }
  return resourceTagId;
}

function confirmationToRow(confirmation: TagConfirmation) {
  return {
    resourceTagId: requireResourceTagId(confirmation),
    candidateId: confirmation.candidateId,
    tagType: confirmation.tagType,
    tagValue: confirmation.suggestedValue,
    originalConfidence: confirmation.suggestedConfidence,
    status: toDatabaseStatus(confirmation.confirmationStatus),
    evidenceId: confirmation.evidenceRefs?.[0] ?? null,
  };
}

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
    confirmationStatus: fromDatabaseStatus(row.status, row.reviewedByUserId),
    confirmedValue: row.modifiedTagValue ?? undefined,
    reviewedByUserId: row.reviewedByUserId ?? undefined,
    reviewedAt: row.reviewedAt?.toISOString(),
    reviewNotes: row.reviewNotes ?? undefined,
    evidenceRefs: row.evidenceId ? [row.evidenceId] : [],
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
      await db.insert(tagConfirmationQueue).values(confirmationToRow(confirmation));
    },

    async bulkCreate(confirmations: TagConfirmation[]): Promise<void> {
      if (confirmations.length === 0) return;

      const rows = confirmations.map(confirmationToRow);

      await db.insert(tagConfirmationQueue).values(rows);
    },

    async replacePendingForCandidate(
      candidateId: string,
      tagType: ResourceTagType,
      confirmations: TagConfirmation[],
    ): Promise<void> {
      for (const confirmation of confirmations) {
        requireResourceTagId(confirmation);
        if (
          confirmation.candidateId !== candidateId
          || confirmation.tagType !== tagType
          || confirmation.confirmationStatus !== 'pending'
        ) {
          throw new Error('Pending tag confirmation reconciliation scope is invalid');
        }
      }

      const rows = confirmations.map(confirmationToRow);
      await db
        .delete(tagConfirmationQueue)
        .where(
          and(
            eq(tagConfirmationQueue.candidateId, candidateId),
            eq(tagConfirmationQueue.tagType, tagType),
            eq(tagConfirmationQueue.status, 'pending'),
          ),
        );

      if (rows.length > 0) {
        await db.insert(tagConfirmationQueue).values(rows);
      }
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
      candidateId: string,
      confirmationId: string,
      status: TagConfirmationStatus,
      confirmedValue?: string,
      _confirmedConfidence?: number,
      userId?: string,
      notes?: string
    ): Promise<'updated' | 'conflict'> {
      const result = await db.execute(sql`
        WITH locked_candidate AS MATERIALIZED (
          SELECT candidate_id
          FROM public.extracted_candidates
          WHERE candidate_id = ${candidateId}
            AND review_status IN ('pending', 'in_review', 'escalated')
            AND EXISTS (
              SELECT 1
              FROM public.candidate_admin_assignments actor_assignment
              JOIN public.admin_review_profiles actor_reviewer
                ON actor_reviewer.id = actor_assignment.admin_profile_id
              JOIN public.user_profiles actor_account
                ON actor_account.user_id = actor_reviewer.user_id
              WHERE actor_assignment.candidate_id = extracted_candidates.candidate_id
                AND actor_assignment.status = 'claimed'
                AND (actor_assignment.expires_at IS NULL OR actor_assignment.expires_at > NOW())
                AND actor_reviewer.user_id = ${userId ?? null}
                AND actor_reviewer.is_active IS TRUE
                AND COALESCE(actor_account.account_status, 'active') = 'active'
                AND actor_account.role = 'community_admin'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.candidate_admin_assignments completed_review
              WHERE completed_review.candidate_id = extracted_candidates.candidate_id
                AND completed_review.status = 'completed'
            )
          FOR UPDATE
        ), updated_decision AS (
          UPDATE public.tag_confirmation_queue confirmation
          SET status = ${toDatabaseStatus(status)},
              modified_tag_value = ${status === 'modified' ? confirmedValue ?? null : null},
              reviewed_by_user_id = ${userId ?? null},
              reviewed_at = NOW(),
              review_notes = ${notes ?? null},
              updated_at = NOW()
          FROM locked_candidate
          WHERE confirmation.id = ${confirmationId}
            AND confirmation.candidate_id = locked_candidate.candidate_id
            AND confirmation.status = 'pending'
          RETURNING confirmation.id, confirmation.candidate_id
        ), audit_event AS (
          INSERT INTO public.ingestion_audit_events
            (candidate_id, event_type, actor_type, actor_id, details)
          SELECT updated_decision.candidate_id,
                 ${status === 'rejected' ? 'tag_removed' : 'tag_added'},
                 'admin',
                 ${userId ?? null},
                 ${JSON.stringify({
                   confirmationId,
                   decisionStatus: status,
                   modified: status === 'modified',
                 })}::jsonb
          FROM updated_decision
          RETURNING candidate_id
        )
        SELECT updated_decision.id
        FROM updated_decision
        JOIN audit_event USING (candidate_id)
      `);
      return resultRows<{ id: string }>(result)[0] ? 'updated' : 'conflict';
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
          eq(tagConfirmationQueue.status, toDatabaseStatus(filters.confirmationStatus))
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
            sql`${tagConfirmationQueue.status} IN ('approved', 'modified')`
          )
        );
      return rows.map(rowToConfirmation);
    },
  };
}
