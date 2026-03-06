/**
 * Drizzle ORM implementation of FeedStore.
 *
 * Maps FeedSubscription domain objects to the feed_subscriptions table.
 */
import { eq, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { feedSubscriptions } from '@/db/schema';
import type { FeedSubscription, FeedStore } from '../stores';

/**
 * Convert a DB row to a FeedSubscription domain object.
 */
function rowToFeed(row: typeof feedSubscriptions.$inferSelect): FeedSubscription {
  return {
    id: row.id,
    sourceRegistryId: row.sourceRegistryId ?? undefined,
    feedUrl: row.feedUrl,
    feedType: row.feedType as FeedSubscription['feedType'],
    displayName: row.displayName ?? undefined,
    pollIntervalHours: row.pollIntervalHours,
    lastPolledAt: row.lastPolledAt?.toISOString(),
    lastEtag: row.lastEtag ?? undefined,
    lastModified: row.lastModified ?? undefined,
    isActive: row.isActive,
    errorCount: row.errorCount,
    lastError: row.lastError ?? undefined,
    jurisdictionState: row.jurisdictionState ?? undefined,
    jurisdictionCounty: row.jurisdictionCounty ?? undefined,
  };
}

/**
 * Creates a FeedStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleFeedStore(
  db: NodePgDatabase<Record<string, unknown>>
): FeedStore {
  return {
    async add(feed: FeedSubscription): Promise<void> {
      await db.insert(feedSubscriptions).values({
        sourceRegistryId: feed.sourceRegistryId,
        feedUrl: feed.feedUrl,
        feedType: feed.feedType,
        displayName: feed.displayName,
        pollIntervalHours: feed.pollIntervalHours,
        isActive: feed.isActive,
        jurisdictionState: feed.jurisdictionState,
        jurisdictionCounty: feed.jurisdictionCounty,
      });
    },

    async updateAfterPoll(
      feedId: string,
      result: {
        lastPolledAt: string;
        lastEtag?: string;
        lastModified?: string;
        error?: string;
      }
    ): Promise<void> {
      const updates: Record<string, unknown> = {
        lastPolledAt: new Date(result.lastPolledAt),
        updatedAt: new Date(),
      };

      if (result.lastEtag !== undefined) {
        updates.lastEtag = result.lastEtag;
      }
      if (result.lastModified !== undefined) {
        updates.lastModified = result.lastModified;
      }

      if (result.error) {
        updates.lastError = result.error;
        // Increment error count using SQL expression
        updates.errorCount = sql`${feedSubscriptions.errorCount} + 1`;
      } else {
        // Reset error count on success
        updates.errorCount = 0;
        updates.lastError = null;
      }

      await db
        .update(feedSubscriptions)
        .set(updates)
        .where(eq(feedSubscriptions.id, feedId));
    },

    async listDueForPoll(): Promise<FeedSubscription[]> {
      // Feeds are due when:
      // 1. Active
      // 2. Never polled (lastPolledAt IS NULL)
      //    OR last polled more than pollIntervalHours ago
      const rows = await db
        .select()
        .from(feedSubscriptions)
        .where(
          and(
            eq(feedSubscriptions.isActive, true),
            sql`(
              ${feedSubscriptions.lastPolledAt} IS NULL
              OR ${feedSubscriptions.lastPolledAt} <= NOW() - (${feedSubscriptions.pollIntervalHours} || ' hours')::interval
            )`
          )
        );
      return rows.map(rowToFeed);
    },

    async listActive(): Promise<FeedSubscription[]> {
      const rows = await db
        .select()
        .from(feedSubscriptions)
        .where(eq(feedSubscriptions.isActive, true));
      return rows.map(rowToFeed);
    },

    async deactivate(feedId: string): Promise<void> {
      await db
        .update(feedSubscriptions)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(feedSubscriptions.id, feedId));
    },
  };
}
