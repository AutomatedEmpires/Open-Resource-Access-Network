/**
 * Drizzle ORM implementation of CanonicalProvenanceStore.
 *
 * Field-level lineage tracking from source assertions to
 * canonical entity fields, with confidence and decision status.
 */
import { eq, and, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { canonicalProvenance } from '@/db/schema';
import type { CanonicalProvenanceStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

export function createDrizzleCanonicalProvenanceStore(
  db: NodePgDatabase<DbSchema>
): CanonicalProvenanceStore {
  return {
    async listByEntity(entityType, entityId) {
      return db
        .select()
        .from(canonicalProvenance)
        .where(
          and(
            eq(canonicalProvenance.canonicalEntityType, entityType),
            eq(canonicalProvenance.canonicalEntityId, entityId)
          )
        )
        .orderBy(desc(canonicalProvenance.createdAt));
    },

    async getAcceptedForField(entityType, entityId, fieldName) {
      const rows = await db
        .select()
        .from(canonicalProvenance)
        .where(
          and(
            eq(canonicalProvenance.canonicalEntityType, entityType),
            eq(canonicalProvenance.canonicalEntityId, entityId),
            eq(canonicalProvenance.fieldName, fieldName),
            eq(canonicalProvenance.decisionStatus, 'accepted')
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async create(row) {
      const result = await db
        .insert(canonicalProvenance)
        .values(row)
        .returning();
      return result[0];
    },

    async bulkCreate(rows) {
      if (rows.length === 0) return;
      await db.insert(canonicalProvenance).values(rows);
    },

    async updateDecision(id, decisionStatus, decidedBy) {
      await db
        .update(canonicalProvenance)
        .set({
          decisionStatus,
          decidedBy: decidedBy ?? null,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(canonicalProvenance.id, id));
    },

    async supersedeField(entityType, entityId, fieldName) {
      const result = await db
        .update(canonicalProvenance)
        .set({
          decisionStatus: 'superseded',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(canonicalProvenance.canonicalEntityType, entityType),
            eq(canonicalProvenance.canonicalEntityId, entityId),
            eq(canonicalProvenance.fieldName, fieldName),
            eq(canonicalProvenance.decisionStatus, 'accepted')
          )
        );
      return result.rowCount ?? 0;
    },

    async acceptField(provenanceId, entityType, entityId, fieldName, decidedBy) {
      return db.transaction(async (tx) => {
        // 1. Supersede any existing accepted provenance for this field
        const superseded = await tx
          .update(canonicalProvenance)
          .set({
            decisionStatus: 'superseded',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(canonicalProvenance.canonicalEntityType, entityType),
              eq(canonicalProvenance.canonicalEntityId, entityId),
              eq(canonicalProvenance.fieldName, fieldName),
              eq(canonicalProvenance.decisionStatus, 'accepted')
            )
          );

        // 2. Accept the new provenance record
        await tx
          .update(canonicalProvenance)
          .set({
            decisionStatus: 'accepted',
            decidedBy: decidedBy ?? null,
            decidedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(canonicalProvenance.id, provenanceId));

        return { supersededCount: superseded.rowCount ?? 0 };
      });
    },
  };
}
