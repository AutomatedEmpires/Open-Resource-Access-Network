/**
 * Drizzle ORM implementation of EntityIdentifierStore.
 *
 * Cross-database reference IDs linking ORAN entities to
 * external system identifiers.
 */
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { entityIdentifiers } from '@/db/schema';
import type { EntityIdentifierStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleEntityIdentifierStore(
  db: NodePgDatabase<DbSchema>
): EntityIdentifierStore {
  return {
    async listByEntity(entityType, entityId) {
      return db
        .select()
        .from(entityIdentifiers)
        .where(
          and(
            eq(entityIdentifiers.entityType, entityType),
            eq(entityIdentifiers.entityId, entityId)
          )
        );
    },

    async findByScheme(identifierScheme, identifierValue) {
      const rows = await db
        .select()
        .from(entityIdentifiers)
        .where(
          and(
            eq(entityIdentifiers.identifierScheme, identifierScheme),
            eq(entityIdentifiers.identifierValue, identifierValue)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async create(row) {
      const result = await db
        .insert(entityIdentifiers)
        .values(row)
        .returning();
      return result[0];
    },

    async updateStatusForEntity(entityType, entityId, status) {
      const result = await db
        .update(entityIdentifiers)
        .set({
          status,
          statusChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(entityIdentifiers.entityType, entityType),
            eq(entityIdentifiers.entityId, entityId)
          )
        );
      return result.rowCount ?? 0;
    },

    async deleteByEntity(entityType, entityId) {
      const result = await db
        .delete(entityIdentifiers)
        .where(
          and(
            eq(entityIdentifiers.entityType, entityType),
            eq(entityIdentifiers.entityId, entityId)
          )
        );
      return result.rowCount ?? 0;
    },
  };
}
