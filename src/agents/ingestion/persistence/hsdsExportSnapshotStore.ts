/**
 * Drizzle ORM implementation of HsdsExportSnapshotStore.
 *
 * Pre-computed HSDS-compatible JSON snapshots for published entities.
 */
import { eq, and, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { hsdsExportSnapshots } from '@/db/schema';
import type { HsdsExportSnapshotStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleHsdsExportSnapshotStore(
  db: NodePgDatabase<DbSchema>
): HsdsExportSnapshotStore {
  return {
    async getCurrent(entityType, entityId) {
      const rows = await db
        .select()
        .from(hsdsExportSnapshots)
        .where(
          and(
            eq(hsdsExportSnapshots.entityType, entityType),
            eq(hsdsExportSnapshots.entityId, entityId),
            eq(hsdsExportSnapshots.status, 'current')
          )
        )
        .orderBy(desc(hsdsExportSnapshots.snapshotVersion))
        .limit(1);
      return rows[0] ?? null;
    },

    async create(row) {
      // The SQL migration defines a unique partial index on
      // (entity_type, entity_id) WHERE status = 'current'.
      // Withdraw any existing current snapshot before inserting.
      if (row.entityType && row.entityId) {
        await db
          .update(hsdsExportSnapshots)
          .set({ status: 'superseded' })
          .where(
            and(
              eq(hsdsExportSnapshots.entityType, row.entityType),
              eq(hsdsExportSnapshots.entityId, row.entityId),
              eq(hsdsExportSnapshots.status, 'current')
            )
          );
      }
      const result = await db
        .insert(hsdsExportSnapshots)
        .values(row)
        .returning();
      return result[0];
    },

    async withdrawForEntity(entityType, entityId) {
      const result = await db
        .update(hsdsExportSnapshots)
        .set({
          status: 'withdrawn',
          withdrawnAt: new Date(),
        })
        .where(
          and(
            eq(hsdsExportSnapshots.entityType, entityType),
            eq(hsdsExportSnapshots.entityId, entityId),
            eq(hsdsExportSnapshots.status, 'current')
          )
        );
      return result.rowCount ?? 0;
    },

    async listCurrent(limit = 100, offset = 0) {
      return db
        .select()
        .from(hsdsExportSnapshots)
        .where(eq(hsdsExportSnapshots.status, 'current'))
        .orderBy(desc(hsdsExportSnapshots.generatedAt))
        .limit(limit)
        .offset(offset);
    },
  };
}
