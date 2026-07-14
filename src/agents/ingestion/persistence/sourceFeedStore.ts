/**
 * Drizzle ORM implementation of SourceFeedStore.
 *
 * Manages feed endpoints (HSDS API, CSV, scrape, etc.) belonging
 * to source systems.
 */
import { eq, and, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sourceFeeds } from '@/db/schema';
import type { SourceFeedStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

const POLLABLE_SOURCE_FEED_HANDLERS = ['hsds_api', 'ndp_211'] as const;

function hasPollableHandler(feed: { feedHandler: string }): boolean {
  return POLLABLE_SOURCE_FEED_HANDLERS.some((handler) => handler === feed.feedHandler);
}

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
      // Handler-less/manual authority feeds may remain active because is_active
      // is part of publication authority. They are not executable poll jobs.
      const rows = await db
        .select()
        .from(sourceFeeds)
        .where(
          and(
            eq(sourceFeeds.isActive, true),
            inArray(sourceFeeds.feedHandler, [...POLLABLE_SOURCE_FEED_HANDLERS]),
            sql`(${sourceFeeds.lastPolledAt} IS NULL OR ${sourceFeeds.lastPolledAt} <= NOW() - (${sourceFeeds.refreshIntervalHours} || ' hours')::interval)`
          )
        );

      // Keep the store boundary fail-closed even when a non-SQL test adapter or
      // future query wrapper does not enforce the database predicate.
      return rows.filter(hasPollableHandler);
    },

    async create(row) {
      const result = await db
        .insert(sourceFeeds)
        .values(row)
        .returning();
      return result[0];
    },

    async update(id, updates) {
      const { id: _omitId, createdAt: _omitCreatedAt, ...safeUpdates } = updates as Record<string, unknown>;
      await db
        .update(sourceFeeds)
        .set({ ...safeUpdates, updatedAt: new Date() })
        .where(eq(sourceFeeds.id, id));
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
