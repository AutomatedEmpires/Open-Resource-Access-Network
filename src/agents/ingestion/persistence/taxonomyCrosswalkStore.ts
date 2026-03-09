/**
 * Drizzle ORM implementation of TaxonomyCrosswalkStore.
 */
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { taxonomyCrosswalks } from '@/db/schema';
import type { TaxonomyCrosswalkStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleTaxonomyCrosswalkStore(
  db: NodePgDatabase<DbSchema>
): TaxonomyCrosswalkStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(taxonomyCrosswalks)
        .where(eq(taxonomyCrosswalks.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findBySourceCode(registryId, sourceCode) {
      return db
        .select()
        .from(taxonomyCrosswalks)
        .where(
          and(
            eq(taxonomyCrosswalks.sourceRegistryId, registryId),
            eq(taxonomyCrosswalks.sourceCode, sourceCode)
          )
        );
    },

    async findExact(registryId, sourceCode, conceptId) {
      const rows = await db
        .select()
        .from(taxonomyCrosswalks)
        .where(
          and(
            eq(taxonomyCrosswalks.sourceRegistryId, registryId),
            eq(taxonomyCrosswalks.sourceCode, sourceCode),
            eq(taxonomyCrosswalks.targetConceptId, conceptId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async create(row) {
      const result = await db
        .insert(taxonomyCrosswalks)
        .values(row)
        .returning();
      return result[0];
    },

    async bulkCreate(rows) {
      if (rows.length === 0) return;
      await db.insert(taxonomyCrosswalks).values(rows);
    },
  };
}
