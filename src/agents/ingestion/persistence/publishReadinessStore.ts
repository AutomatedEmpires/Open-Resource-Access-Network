/**
 * Drizzle ORM implementation of PublishReadinessStore.
 *
 * Maps CandidatePublishReadiness domain objects to the candidate_readiness table.
 * Also queries extracted_candidates + related tables for aggregated readiness info.
 */
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { candidateReadiness, extractedCandidates } from '@/db/schema';
import type {
  CandidatePublishReadiness,
  CandidatePublishReadinessSnapshot,
  PublishReadinessStore,
} from '../stores';

/**
 * Convert a candidate_readiness row + candidate info to domain object.
 */
function rowToReadiness(
  readinessRow: typeof candidateReadiness.$inferSelect,
  candidateRow?: typeof extractedCandidates.$inferSelect | null
): CandidatePublishReadiness {
  return {
    candidateId: readinessRow.candidateId,
    reviewStatus: candidateRow?.reviewStatus ?? 'pending',
    confidenceScore: candidateRow?.confidenceScore ?? 0,
    confidenceTier: candidateRow?.confidenceTier ?? 'red',
    confirmedTagsCount: 0, // Will be computed from aggregation if needed
    pendingTagsCount: readinessRow.pendingTagCount,
    approvalCount: readinessRow.adminApprovalCount,
    rejectionCount: 0,
    hasOrgApproval: false,
    satisfiedChecklistCount: 0,
    missingChecklistCount: 0,
    pendingLlmSuggestions: 0,
    meetsPublishThreshold: readinessRow.isReady,
  };
}

/**
 * Creates a PublishReadinessStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzlePublishReadinessStore(
  db: NodePgDatabase<Record<string, unknown>>
): PublishReadinessStore {
  return {
    async upsert(snapshot: CandidatePublishReadinessSnapshot): Promise<void> {
      await db
        .insert(candidateReadiness)
        .values({
          candidateId: snapshot.candidateId,
          isReady: snapshot.isReady,
          hasRequiredFields: snapshot.hasRequiredFields,
          hasRequiredTags: snapshot.hasRequiredTags,
          tagsConfirmed: snapshot.tagsConfirmed,
          meetsScoreThreshold: snapshot.meetsScoreThreshold,
          hasAdminApproval: snapshot.hasAdminApproval,
          pendingTagCount: snapshot.pendingTagCount,
          adminApprovalCount: snapshot.adminApprovalCount,
          blockers: snapshot.blockers,
          lastEvaluatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: candidateReadiness.candidateId,
          set: {
            isReady: snapshot.isReady,
            hasRequiredFields: snapshot.hasRequiredFields,
            hasRequiredTags: snapshot.hasRequiredTags,
            tagsConfirmed: snapshot.tagsConfirmed,
            meetsScoreThreshold: snapshot.meetsScoreThreshold,
            hasAdminApproval: snapshot.hasAdminApproval,
            pendingTagCount: snapshot.pendingTagCount,
            adminApprovalCount: snapshot.adminApprovalCount,
            blockers: snapshot.blockers,
            lastEvaluatedAt: new Date(),
            updatedAt: new Date(),
          },
        });
    },

    async getReadiness(
      candidateId: string
    ): Promise<CandidatePublishReadiness | null> {
      // Join readiness with candidate for full picture
      const readinessRows = await db
        .select()
        .from(candidateReadiness)
        .where(eq(candidateReadiness.candidateId, candidateId))
        .limit(1);

      if (readinessRows.length === 0) return null;

      const candidateRows = await db
        .select()
        .from(extractedCandidates)
        .where(eq(extractedCandidates.candidateId, candidateId))
        .limit(1);

      return rowToReadiness(
        readinessRows[0],
        candidateRows[0] ?? null
      );
    },

    async meetsThreshold(candidateId: string): Promise<boolean> {
      const rows = await db
        .select({ isReady: candidateReadiness.isReady })
        .from(candidateReadiness)
        .where(eq(candidateReadiness.candidateId, candidateId))
        .limit(1);

      return rows.length > 0 ? rows[0].isReady : false;
    },

    async listReadyForPublish(
      limit?: number
    ): Promise<CandidatePublishReadiness[]> {
      // Get all ready candidates joined with their candidate data
      const readinessRows = await db
        .select()
        .from(candidateReadiness)
        .where(eq(candidateReadiness.isReady, true))
        .limit(limit ?? 50);

      if (readinessRows.length === 0) return [];

      // Batch-fetch candidate info
      const candidateIds = readinessRows.map((r) => r.candidateId);
      const candidateRows = await db
        .select()
        .from(extractedCandidates)
        .where(
          sql`${extractedCandidates.candidateId} = ANY(ARRAY[${sql.join(
            candidateIds.map((id) => sql`${id}`),
            sql`, `
          )}])`
        );

      const candidateMap = new Map(
        candidateRows.map((c) => [c.candidateId, c])
      );

      return readinessRows.map((r) =>
        rowToReadiness(r, candidateMap.get(r.candidateId) ?? null)
      );
    },
  };
}
