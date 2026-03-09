/**
 * Drizzle ORM implementation of CanonicalServiceStore.
 *
 * Normalized service entities belonging to canonical organizations.
 */
import { eq, desc, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { canonicalServices } from '@/db/schema';
import type { CanonicalServiceStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleCanonicalServiceStore(
  db: NodePgDatabase<DbSchema>
): CanonicalServiceStore {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(canonicalServices)
        .where(eq(canonicalServices.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async listByOrganization(canonicalOrganizationId) {
      return db
        .select()
        .from(canonicalServices)
        .where(eq(canonicalServices.canonicalOrganizationId, canonicalOrganizationId));
    },

    async listByLifecycle(lifecycleStatus, limit = 100) {
      return db
        .select()
        .from(canonicalServices)
        .where(eq(canonicalServices.lifecycleStatus, lifecycleStatus))
        .orderBy(desc(canonicalServices.lastRefreshedAt))
        .limit(limit);
    },

    async listByPublication(publicationStatus, limit = 100, offset = 0) {
      return db
        .select()
        .from(canonicalServices)
        .where(eq(canonicalServices.publicationStatus, publicationStatus))
        .orderBy(desc(canonicalServices.lastRefreshedAt))
        .limit(limit)
        .offset(offset);
    },

    async listByWinningSource(sourceSystemId, limit = 100) {
      return db
        .select()
        .from(canonicalServices)
        .where(eq(canonicalServices.winningSourceSystemId, sourceSystemId))
        .orderBy(desc(canonicalServices.lastRefreshedAt))
        .limit(limit);
    },

    async create(row) {
      const result = await db
        .insert(canonicalServices)
        .values(row)
        .returning();
      return result[0];
    },

    async update(id, updates) {
      const { id: _omitId, createdAt: _omitCreated, ...safeUpdates } = updates as Record<string, unknown>;
      await db
        .update(canonicalServices)
        .set({ ...safeUpdates, updatedAt: new Date() })
        .where(eq(canonicalServices.id, id));
    },

    async updateLifecycleStatus(id, status) {
      await db
        .update(canonicalServices)
        .set({ lifecycleStatus: status, updatedAt: new Date() })
        .where(eq(canonicalServices.id, id));
    },

    async updatePublicationStatus(id, status) {
      await db
        .update(canonicalServices)
        .set({ publicationStatus: status, updatedAt: new Date() })
        .where(eq(canonicalServices.id, id));
    },

    async findActiveByUrl(url) {
      if (!url) return null;
      const rows = await db
        .select()
        .from(canonicalServices)
        .where(and(
          eq(canonicalServices.lifecycleStatus, 'active'),
          eq(canonicalServices.url, url),
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    async findActiveByName(name) {
      if (!name) return null;
      const rows = await db
        .select()
        .from(canonicalServices)
        .where(and(
          eq(canonicalServices.lifecycleStatus, 'active'),
          eq(canonicalServices.name, name),
        ))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
