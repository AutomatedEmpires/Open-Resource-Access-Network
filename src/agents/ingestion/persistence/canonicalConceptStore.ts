/**
 * Drizzle ORM implementation of CanonicalConceptStore.
 */
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { canonicalConcepts } from '@/db/schema';
import type { CanonicalConceptStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleCanonicalConceptStore(
  db: NodePgDatabase<DbSchema>
): CanonicalConceptStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(canonicalConcepts)
        .where(eq(canonicalConcepts.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByKey(conceptKey) {
      const rows = await db
        .select()
        .from(canonicalConcepts)
        .where(eq(canonicalConcepts.conceptKey, conceptKey))
        .limit(1);
      return rows[0] ?? null;
    },

    async listActive() {
      return db
        .select()
        .from(canonicalConcepts)
        .where(eq(canonicalConcepts.isActive, true));
    },

    async create(row) {
      const result = await db
        .insert(canonicalConcepts)
        .values(row)
        .returning();
      return result[0];
    },

    async update(id, fields) {
      const { id: _omitId, createdAt: _omitCreated, ...safe } = fields as Record<string, unknown>;
      await db
        .update(canonicalConcepts)
        .set({ ...safe, updatedAt: new Date() })
        .where(eq(canonicalConcepts.id, id));
    },
  };
}
