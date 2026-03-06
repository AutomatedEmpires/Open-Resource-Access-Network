/**
 * Drizzle ORM implementation of PublishThresholdStore.
 *
 * Maps PublishThreshold domain objects to the publish_criteria table.
 */
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { publishCriteria } from '@/db/schema';
import type { PublishThreshold, PublishThresholdStore } from '../stores';

/**
 * Convert a DB row to a PublishThreshold domain object.
 */
function rowToThreshold(
  row: typeof publishCriteria.$inferSelect
): PublishThreshold {
  return {
    id: row.id,
    category: row.primaryCategory ?? undefined,
    jurisdictionState: row.jurisdictionState ?? undefined,
    minConfidenceScore: row.minOverallScore,
    minConfirmedTags: row.minServiceTypeTags,
    maxPendingTags: 0, // DB doesn't have this directly; derive from policy
    requiredChecklistItems: (row.requiredFields as string[]) ?? [],
    minAdminApprovals: row.minAdminApprovals,
    requireOrgApproval: row.requireOrgApproval,
    autoPublishThreshold: undefined,
    priority: 0, // Derived from specificity
    isActive: row.isActive,
  };
}

/**
 * Creates a PublishThresholdStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzlePublishThresholdStore(
  db: NodePgDatabase<Record<string, unknown>>
): PublishThresholdStore {
  return {
    async findBestMatch(
      category?: string,
      jurisdictionState?: string
    ): Promise<PublishThreshold | null> {
      // Find most specific matching threshold:
      // 1. category + state (most specific)
      // 2. category only
      // 3. state only
      // 4. Default (no category, no state)
      const rows = await db
        .select()
        .from(publishCriteria)
        .where(eq(publishCriteria.isActive, true));

      if (rows.length === 0) return null;

      let bestMatch: typeof publishCriteria.$inferSelect | null = null;
      let bestScore = -1;

      for (const row of rows) {
        let score = 0;

        // Check category match
        if (row.primaryCategory) {
          if (category && row.primaryCategory === category) {
            score += 2;
          } else {
            continue; // Category required but doesn't match
          }
        }

        // Check state match
        if (row.jurisdictionState) {
          if (jurisdictionState && row.jurisdictionState === jurisdictionState) {
            score += 1;
          } else {
            continue; // State required but doesn't match
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = row;
        }
      }

      return bestMatch ? rowToThreshold(bestMatch) : null;
    },

    async listActive(): Promise<PublishThreshold[]> {
      const rows = await db
        .select()
        .from(publishCriteria)
        .where(eq(publishCriteria.isActive, true));
      return rows.map(rowToThreshold);
    },

    async upsert(threshold: PublishThreshold): Promise<void> {
      if (threshold.id) {
        await db
          .update(publishCriteria)
          .set({
            primaryCategory: threshold.category,
            jurisdictionState: threshold.jurisdictionState,
            minOverallScore: threshold.minConfidenceScore,
            minServiceTypeTags: threshold.minConfirmedTags,
            minAdminApprovals: threshold.minAdminApprovals,
            requireOrgApproval: threshold.requireOrgApproval,
            requiredFields: threshold.requiredChecklistItems,
            isActive: threshold.isActive,
            updatedAt: new Date(),
          })
          .where(eq(publishCriteria.id, threshold.id));
      } else {
        await db.insert(publishCriteria).values({
          primaryCategory: threshold.category,
          jurisdictionState: threshold.jurisdictionState,
          minOverallScore: threshold.minConfidenceScore,
          minServiceTypeTags: threshold.minConfirmedTags,
          minAdminApprovals: threshold.minAdminApprovals,
          requireOrgApproval: threshold.requireOrgApproval,
          requiredFields: threshold.requiredChecklistItems,
          isActive: threshold.isActive,
        });
      }
    },
  };
}
