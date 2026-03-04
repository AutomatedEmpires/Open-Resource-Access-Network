/**
 * Drizzle ORM implementation of TagStore.
 *
 * Maps ResourceTag domain objects to the resource_tags table.
 */
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { resourceTags } from '@/db/schema';
import type { ResourceTag, ResourceTagType } from '../tags';
import type { TagAssignedBy } from '../tags';
import type { TagStore } from '../stores';

/**
 * Map a DB source string to the domain TagAssignedBy enum.
 * The DB stores 'llm', 'system', 'human', 'agent' — domain only knows 'system'|'agent'|'human'.
 */
function mapAssignedBy(dbSource: string): TagAssignedBy {
  if (dbSource === 'human') return 'human';
  if (dbSource === 'agent') return 'agent';
  return 'system';
}

/**
 * Convert a DB row to a ResourceTag domain object.
 *
 * DB column → domain field mapping:
 *   targetId (+ targetType='service')   → serviceId
 *   targetId (+ targetType='candidate') → candidateId
 *   confidence                          → tagConfidence
 *   source                              → assignedBy (via mapAssignedBy)
 *   addedBy                             → assignedByUserId
 *   addedAt                             → not in domain type; discarded
 */
function rowToTag(row: typeof resourceTags.$inferSelect): ResourceTag {
  const isService = row.targetType === 'service';
  return {
    id: row.id,
    ...(isService ? { serviceId: row.targetId } : { candidateId: row.targetId }),
    tagType: row.tagType as ResourceTagType,
    tagValue: row.tagValue,
    tagConfidence: row.confidence ?? 100,
    assignedBy: mapAssignedBy(row.source),
    assignedByUserId: row.addedBy ?? undefined,
    evidenceRefs: [],
  };
}

/**
 * Map a domain ResourceTag to the DB insert shape.
 */
function tagToRow(tag: ResourceTag) {
  const targetId = tag.serviceId ?? tag.candidateId ?? '';
  const targetType: string = tag.serviceId ? 'service' : 'candidate';
  return {
    targetId,
    targetType,
    tagType: tag.tagType,
    tagValue: tag.tagValue,
    confidence: tag.tagConfidence,
    source: tag.assignedBy ?? 'system',
    addedBy: tag.assignedByUserId ?? null,
  };
}

/**
 * Creates a TagStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleTagStore(
  db: NodePgDatabase<Record<string, unknown>>
): TagStore {
  return {
    async add(tag: ResourceTag): Promise<void> {
      await db.insert(resourceTags).values(tagToRow(tag));
    },

    async remove(
      targetId: string,
      targetType: 'candidate' | 'service',
      tagType: ResourceTagType,
      tagValue: string
    ): Promise<void> {
      await db
        .delete(resourceTags)
        .where(
          and(
            eq(resourceTags.targetId, targetId),
            eq(resourceTags.targetType, targetType),
            eq(resourceTags.tagType, tagType),
            eq(resourceTags.tagValue, tagValue)
          )
        );
    },

    async listFor(
      targetId: string,
      targetType: 'candidate' | 'service'
    ): Promise<ResourceTag[]> {
      const rows = await db
        .select()
        .from(resourceTags)
        .where(
          and(
            eq(resourceTags.targetId, targetId),
            eq(resourceTags.targetType, targetType)
          )
        );
      return rows.map(rowToTag);
    },

    async listByType(
      targetId: string,
      targetType: 'candidate' | 'service',
      tagType: ResourceTagType
    ): Promise<ResourceTag[]> {
      const rows = await db
        .select()
        .from(resourceTags)
        .where(
          and(
            eq(resourceTags.targetId, targetId),
            eq(resourceTags.targetType, targetType),
            eq(resourceTags.tagType, tagType)
          )
        );
      return rows.map(rowToTag);
    },

    async findByTag(
      tagType: ResourceTagType,
      tagValue: string,
      targetType: 'candidate' | 'service'
    ): Promise<string[]> {
      const rows = await db
        .select({ targetId: resourceTags.targetId })
        .from(resourceTags)
        .where(
          and(
            eq(resourceTags.tagType, tagType),
            eq(resourceTags.tagValue, tagValue),
            eq(resourceTags.targetType, targetType)
          )
        );
      return rows.map((r) => r.targetId);
    },

    async bulkAdd(tags: ResourceTag[]): Promise<void> {
      if (tags.length === 0) return;

      const rows = tags.map(tagToRow);

      await db
        .insert(resourceTags)
        .values(rows)
        .onConflictDoNothing();
    },

    async replaceByType(
      targetId: string,
      targetType: 'candidate' | 'service',
      tagType: ResourceTagType,
      newTags: ResourceTag[]
    ): Promise<void> {
      // Delete existing tags of this type
      await db
        .delete(resourceTags)
        .where(
          and(
            eq(resourceTags.targetId, targetId),
            eq(resourceTags.targetType, targetType),
            eq(resourceTags.tagType, tagType)
          )
        );

      // Insert new tags
      if (newTags.length > 0) {
        await this.bulkAdd(newTags);
      }
    },
  };
}
