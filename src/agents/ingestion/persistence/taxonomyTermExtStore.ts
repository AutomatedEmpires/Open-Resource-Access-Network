/**
 * Drizzle ORM implementation of TaxonomyTermExtStore.
 */
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { taxonomyTermsExt } from '@/db/schema';
import type { TaxonomyTermExtStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleTaxonomyTermExtStore(
  db: NodePgDatabase<DbSchema>
): TaxonomyTermExtStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(taxonomyTermsExt)
        .where(eq(taxonomyTermsExt.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByRegistryAndCode(registryId, code) {
      const rows = await db
        .select()
        .from(taxonomyTermsExt)
        .where(
          and(
            eq(taxonomyTermsExt.registryId, registryId),
            eq(taxonomyTermsExt.code, code)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async listByRegistry(registryId) {
      return db
        .select()
        .from(taxonomyTermsExt)
        .where(eq(taxonomyTermsExt.registryId, registryId));
    },

    async create(row) {
      const result = await db
        .insert(taxonomyTermsExt)
        .values(row)
        .returning();
      return result[0];
    },

    async bulkCreate(rows) {
      if (rows.length === 0) return;
      await db.insert(taxonomyTermsExt).values(rows);
    },
  };
}
