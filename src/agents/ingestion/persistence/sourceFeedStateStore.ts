/**
 * Drizzle ORM implementation of SourceFeedStateStore.
 *
 * Persists per-feed rollout controls and sync metadata.
 */
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sourceFeedStates } from '@/db/schema';
import type { SourceFeedStateStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleSourceFeedStateStore(
  db: NodePgDatabase<DbSchema>
): SourceFeedStateStore {
  return {
    async getByFeedId(sourceFeedId) {
      const rows = await db
        .select()
        .from(sourceFeedStates)
        .where(eq(sourceFeedStates.sourceFeedId, sourceFeedId))
        .limit(1);
      return rows[0] ?? null;
    },

    async upsert(row) {
      const result = await db
        .insert(sourceFeedStates)
        .values(row)
        .onConflictDoUpdate({
          target: sourceFeedStates.sourceFeedId,
          set: {
            publicationMode: row.publicationMode ?? 'review_required',
            autoPublishApprovedAt: row.autoPublishApprovedAt ?? null,
            autoPublishApprovedBy: row.autoPublishApprovedBy ?? null,
            emergencyPause: row.emergencyPause ?? false,
            includedDataOwners: row.includedDataOwners ?? [],
            excludedDataOwners: row.excludedDataOwners ?? [],
            maxOrganizationsPerPoll: row.maxOrganizationsPerPoll ?? null,
            checkpointCursor: row.checkpointCursor ?? null,
            replayFromCursor: row.replayFromCursor ?? null,
            lastAttemptStatus: row.lastAttemptStatus ?? 'idle',
            lastAttemptStartedAt: row.lastAttemptStartedAt ?? null,
            lastAttemptCompletedAt: row.lastAttemptCompletedAt ?? null,
            lastSuccessfulSyncStartedAt: row.lastSuccessfulSyncStartedAt ?? null,
            lastSuccessfulSyncCompletedAt: row.lastSuccessfulSyncCompletedAt ?? null,
            lastAttemptSummary: row.lastAttemptSummary ?? {},
            notes: row.notes ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      return result[0];
    },

    async update(sourceFeedId, updates) {
      const { sourceFeedId: _omitSourceFeedId, createdAt: _omitCreatedAt, ...safeUpdates } = updates as Record<string, unknown>;
      await db
        .update(sourceFeedStates)
        .set({ ...safeUpdates, updatedAt: new Date() })
        .where(eq(sourceFeedStates.sourceFeedId, sourceFeedId));
    },
  };
}
