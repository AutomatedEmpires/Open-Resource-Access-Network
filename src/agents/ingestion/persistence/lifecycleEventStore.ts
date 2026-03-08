/**
 * Drizzle ORM implementation of LifecycleEventStore.
 *
 * Status change audit trail for cross-database propagation.
 */
import { eq, and, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { lifecycleEvents } from '@/db/schema';
import type { LifecycleEventStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleLifecycleEventStore(
  db: NodePgDatabase<DbSchema>
): LifecycleEventStore {
  return {
    async create(row) {
      const result = await db
        .insert(lifecycleEvents)
        .values(row)
        .returning();
      return result[0];
    },

    async listByEntity(entityType, entityId) {
      return db
        .select()
        .from(lifecycleEvents)
        .where(
          and(
            eq(lifecycleEvents.entityType, entityType),
            eq(lifecycleEvents.entityId, entityId)
          )
        )
        .orderBy(desc(lifecycleEvents.createdAt));
    },

    async listByType(eventType, limit = 100) {
      return db
        .select()
        .from(lifecycleEvents)
        .where(eq(lifecycleEvents.eventType, eventType))
        .orderBy(desc(lifecycleEvents.createdAt))
        .limit(limit);
    },
  };
}
