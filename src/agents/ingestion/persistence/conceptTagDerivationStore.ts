/**
 * Drizzle ORM implementation of ConceptTagDerivationStore.
 */
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { conceptTagDerivations } from '@/db/schema';
import type { ConceptTagDerivationStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleConceptTagDerivationStore(
  db: NodePgDatabase<DbSchema>
): ConceptTagDerivationStore {
  return {
    async findByEntity(entityType, entityId) {
      return db
        .select()
        .from(conceptTagDerivations)
        .where(
          and(
            eq(conceptTagDerivations.entityType, entityType),
            eq(conceptTagDerivations.entityId, entityId)
          )
        );
    },

    async create(row) {
      const result = await db
        .insert(conceptTagDerivations)
        .values(row)
        .returning();
      return result[0];
    },

    async bulkCreate(rows) {
      if (rows.length === 0) return;
      await db.insert(conceptTagDerivations).values(rows);
    },
  };
}
