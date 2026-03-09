/**
 * Drizzle ORM implementation of TaxonomyRegistryStore.
 */
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { taxonomyRegistries } from '@/db/schema';
import type { TaxonomyRegistryStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleTaxonomyRegistryStore(
  db: NodePgDatabase<DbSchema>
): TaxonomyRegistryStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(taxonomyRegistries)
        .where(eq(taxonomyRegistries.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByName(name) {
      const rows = await db
        .select()
        .from(taxonomyRegistries)
        .where(eq(taxonomyRegistries.name, name))
        .limit(1);
      return rows[0] ?? null;
    },

    async listActive() {
      return db
        .select()
        .from(taxonomyRegistries)
        .where(eq(taxonomyRegistries.status, 'active'));
    },

    async create(row) {
      const result = await db
        .insert(taxonomyRegistries)
        .values(row)
        .returning();
      return result[0];
    },

    async update(id, fields) {
      const { id: _omitId, createdAt: _omitCreated, ...safe } = fields as Record<string, unknown>;
      await db
        .update(taxonomyRegistries)
        .set({ ...safe, updatedAt: new Date() })
        .where(eq(taxonomyRegistries.id, id));
    },
  };
}
