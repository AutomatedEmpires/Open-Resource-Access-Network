/**
 * Drizzle ORM implementation of EntityClusterMemberStore.
 */
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { entityClusterMembers } from '@/db/schema';
import type { EntityClusterMemberStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleEntityClusterMemberStore(
  db: NodePgDatabase<DbSchema>
): EntityClusterMemberStore {
  return {
    async findByCluster(clusterId) {
      return db
        .select()
        .from(entityClusterMembers)
        .where(eq(entityClusterMembers.clusterId, clusterId));
    },

    async findByEntity(entityType, entityId) {
      return db
        .select()
        .from(entityClusterMembers)
        .where(
          and(
            eq(entityClusterMembers.entityType, entityType),
            eq(entityClusterMembers.entityId, entityId),
          ),
        );
    },

    async create(row) {
      const result = await db
        .insert(entityClusterMembers)
        .values(row)
        .returning();
      return result[0];
    },

    async deleteByCluster(clusterId) {
      const result = await db
        .delete(entityClusterMembers)
        .where(eq(entityClusterMembers.clusterId, clusterId));
      return result.rowCount ?? 0;
    },
  };
}
