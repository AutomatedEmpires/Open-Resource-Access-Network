/**
 * Drizzle ORM implementation of CanonicalOrganizationStore.
 *
 * Normalized organization entities derived from source assertions.
 */
import { eq, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { canonicalOrganizations } from '@/db/schema';
import type { CanonicalOrganizationStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleCanonicalOrganizationStore(
  db: NodePgDatabase<DbSchema>
): CanonicalOrganizationStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(canonicalOrganizations)
        .where(eq(canonicalOrganizations.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async listByLifecycle(lifecycleStatus, limit = 100) {
      return db
        .select()
        .from(canonicalOrganizations)
        .where(eq(canonicalOrganizations.lifecycleStatus, lifecycleStatus))
        .orderBy(desc(canonicalOrganizations.lastRefreshedAt))
        .limit(limit);
    },

    async listByPublication(publicationStatus, limit = 100, offset = 0) {
      return db
        .select()
        .from(canonicalOrganizations)
        .where(eq(canonicalOrganizations.publicationStatus, publicationStatus))
        .orderBy(desc(canonicalOrganizations.lastRefreshedAt))
        .limit(limit)
        .offset(offset);
    },

    async listByWinningSource(sourceSystemId, limit = 100) {
      return db
        .select()
        .from(canonicalOrganizations)
        .where(eq(canonicalOrganizations.winningSourceSystemId, sourceSystemId))
        .orderBy(desc(canonicalOrganizations.lastRefreshedAt))
        .limit(limit);
    },

    async create(row) {
      const result = await db
        .insert(canonicalOrganizations)
        .values(row)
        .returning();
      return result[0];
    },

    async update(id, updates) {
      const { id: _omitId, createdAt: _omitCreated, ...safeUpdates } = updates as Record<string, unknown>;
      // updatedAt is also set by DB trigger (belt-and-suspenders; trigger wins)
      await db
        .update(canonicalOrganizations)
        .set({ ...safeUpdates, updatedAt: new Date() })
        .where(eq(canonicalOrganizations.id, id));
    },

    async updateLifecycleStatus(id, status) {
      await db
        .update(canonicalOrganizations)
        .set({ lifecycleStatus: status, updatedAt: new Date() })
        .where(eq(canonicalOrganizations.id, id));
    },

    async updatePublicationStatus(id, status) {
      await db
        .update(canonicalOrganizations)
        .set({ publicationStatus: status, updatedAt: new Date() })
        .where(eq(canonicalOrganizations.id, id));
    },
  };
}
