/**
 * Drizzle ORM implementation of SourceFeedStore.
 *
 * Manages feed endpoints (HSDS API, CSV, scrape, etc.) belonging
 * to source systems.
 */
import { eq, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sourceFeeds } from '@/db/schema';
import type { SourceFeedStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleSourceFeedStore(
  db: NodePgDatabase<DbSchema>
): SourceFeedStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(sourceFeeds)
        .where(eq(sourceFeeds.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async listBySystem(sourceSystemId) {
      return db
        .select()
        .from(sourceFeeds)
        .where(eq(sourceFeeds.sourceSystemId, sourceSystemId));
    },

    async listDueForPoll() {
      // A feed is due when: active AND (never polled OR polled more than refreshIntervalHours ago)
      return db
        .select()
        .from(sourceFeeds)
        .where(
          and(
            eq(sourceFeeds.isActive, true),
            sql`(${sourceFeeds.lastPolledAt} IS NULL OR ${sourceFeeds.lastPolledAt} <= NOW() - (${sourceFeeds.refreshIntervalHours} || ' hours')::interval)`
          )
        );
    },

    async create(row) {
      const result = await db
        .insert(sourceFeeds)
        .values(row)
        .returning();
      return result[0];
    },

    async updateAfterPoll(feedId, result) {
      const updates: Record<string, unknown> = {
        lastPolledAt: new Date(result.lastPolledAt),
        updatedAt: new Date(),
      };
      if (result.lastSuccessAt) {
        updates.lastSuccessAt = new Date(result.lastSuccessAt);
        // Reset error state on successful poll
        updates.errorCount = 0;
        updates.lastError = null;
      }
      if (result.lastError !== undefined) updates.lastError = result.lastError;
      if (result.errorCount !== undefined) updates.errorCount = result.errorCount;

      await db
        .update(sourceFeeds)
        .set(updates)
        .where(eq(sourceFeeds.id, feedId));
    },

    async deactivate(id) {
      await db
        .update(sourceFeeds)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(sourceFeeds.id, id));
    },
  };
}
