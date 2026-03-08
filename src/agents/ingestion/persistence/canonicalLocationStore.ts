/**
 * Drizzle ORM implementation of CanonicalLocationStore.
 *
 * Normalized location entities with PostGIS geometry,
 * belonging to canonical organizations.
 */
import { eq, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { canonicalLocations } from '@/db/schema';
import type { CanonicalLocationStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleCanonicalLocationStore(
  db: NodePgDatabase<DbSchema>
): CanonicalLocationStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(canonicalLocations)
        .where(eq(canonicalLocations.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async listByOrganization(canonicalOrganizationId) {
      return db
        .select()
        .from(canonicalLocations)
        .where(eq(canonicalLocations.canonicalOrganizationId, canonicalOrganizationId));
    },

    async listByLifecycle(lifecycleStatus, limit = 100) {
      return db
        .select()
        .from(canonicalLocations)
        .where(eq(canonicalLocations.lifecycleStatus, lifecycleStatus))
        .orderBy(desc(canonicalLocations.lastRefreshedAt))
        .limit(limit);
    },

    async listByPublication(publicationStatus, limit = 100, offset = 0) {
      return db
        .select()
        .from(canonicalLocations)
        .where(eq(canonicalLocations.publicationStatus, publicationStatus))
        .orderBy(desc(canonicalLocations.lastRefreshedAt))
        .limit(limit)
        .offset(offset);
    },

    async listByWinningSource(sourceSystemId, limit = 100) {
      return db
        .select()
        .from(canonicalLocations)
        .where(eq(canonicalLocations.winningSourceSystemId, sourceSystemId))
        .orderBy(desc(canonicalLocations.lastRefreshedAt))
        .limit(limit);
    },

    async create(row) {
      const result = await db
        .insert(canonicalLocations)
        .values(row)
        .returning();
      return result[0];
    },

    async update(id, updates) {
      const { id: _omitId, createdAt: _omitCreated, ...safeUpdates } = updates as Record<string, unknown>;
      await db
        .update(canonicalLocations)
        .set({ ...safeUpdates, updatedAt: new Date() })
        .where(eq(canonicalLocations.id, id));
    },

    async updateLifecycleStatus(id, status) {
      await db
        .update(canonicalLocations)
        .set({ lifecycleStatus: status, updatedAt: new Date() })
        .where(eq(canonicalLocations.id, id));
    },

    async updatePublicationStatus(id, status) {
      await db
        .update(canonicalLocations)
        .set({ publicationStatus: status, updatedAt: new Date() })
        .where(eq(canonicalLocations.id, id));
    },
  };
}
