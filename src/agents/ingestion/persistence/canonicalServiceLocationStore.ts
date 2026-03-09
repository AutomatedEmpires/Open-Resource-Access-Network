/**
 * Drizzle ORM implementation of CanonicalServiceLocationStore.
 *
 * Many-to-many junction between canonical services and locations.
 */
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { canonicalServiceLocations } from '@/db/schema';
import type { CanonicalServiceLocationStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleCanonicalServiceLocationStore(
  db: NodePgDatabase<DbSchema>
): CanonicalServiceLocationStore {
  return {
    async listByService(canonicalServiceId) {
      return db
        .select()
        .from(canonicalServiceLocations)
        .where(eq(canonicalServiceLocations.canonicalServiceId, canonicalServiceId));
    },

    async listByLocation(canonicalLocationId) {
      return db
        .select()
        .from(canonicalServiceLocations)
        .where(eq(canonicalServiceLocations.canonicalLocationId, canonicalLocationId));
    },

    async create(row) {
      const result = await db
        .insert(canonicalServiceLocations)
        .values(row)
        .returning();
      return result[0];
    },

    async bulkCreate(rows) {
      if (rows.length === 0) return [];
      return db
        .insert(canonicalServiceLocations)
        .values(rows)
        .returning();
    },

    async remove(canonicalServiceId, canonicalLocationId) {
      await db
        .delete(canonicalServiceLocations)
        .where(
          and(
            eq(canonicalServiceLocations.canonicalServiceId, canonicalServiceId),
            eq(canonicalServiceLocations.canonicalLocationId, canonicalLocationId)
          )
        );
    },
  };
}
