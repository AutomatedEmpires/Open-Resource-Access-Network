/**
 * Drizzle ORM implementation of VerifiedLinkStore.
 *
 * Maps VerifiedServiceLink domain objects to the verified_service_links table.
 */
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { verifiedServiceLinks } from '@/db/schema';
import type { VerifiedServiceLink, VerifiedLinkStore, VerifiedLinkType } from '../stores';

/**
 * Convert a DB row to a VerifiedServiceLink domain object.
 */
function rowToLink(row: typeof verifiedServiceLinks.$inferSelect): VerifiedServiceLink {
  return {
    id: row.id,
    candidateId: row.candidateId ?? undefined,
    serviceId: row.serviceId ?? undefined,
    url: row.url,
    label: row.label,
    linkType: row.linkType as VerifiedLinkType,
    intentActions: row.intentActions ?? [],
    intentCategories: row.intentCategories ?? [],
    audienceTags: row.audienceTags ?? [],
    locales: row.locales ?? [],
    isVerified: row.isVerified,
    verifiedAt: row.verifiedAt?.toISOString(),
    verifiedByUserId: row.verifiedByUserId ?? undefined,
    lastCheckedAt: row.lastCheckedAt?.toISOString(),
    lastHttpStatus: row.lastHttpStatus ?? undefined,
    isLinkAlive: row.isLinkAlive ?? undefined,
    evidenceId: row.evidenceId ?? undefined,
    discoveredAt: row.discoveredAt.toISOString(),
  };
}

/**
 * Creates a VerifiedLinkStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleVerifiedLinkStore(
  db: NodePgDatabase<Record<string, unknown>>
): VerifiedLinkStore {
  return {
    async add(link: VerifiedServiceLink): Promise<void> {
      await db.insert(verifiedServiceLinks).values({
        candidateId: link.candidateId,
        serviceId: link.serviceId,
        url: link.url,
        label: link.label,
        linkType: link.linkType,
        intentActions: link.intentActions ?? [],
        intentCategories: link.intentCategories ?? [],
        audienceTags: link.audienceTags ?? [],
        locales: link.locales ?? [],
        isVerified: link.isVerified,
        verifiedAt: link.verifiedAt ? new Date(link.verifiedAt) : undefined,
        verifiedByUserId: link.verifiedByUserId,
        lastCheckedAt: link.lastCheckedAt ? new Date(link.lastCheckedAt) : undefined,
        lastHttpStatus: link.lastHttpStatus,
        isLinkAlive: link.isLinkAlive,
        evidenceId: link.evidenceId,
        discoveredAt: new Date(link.discoveredAt),
      });
    },

    async verify(linkId: string, byUserId: string): Promise<void> {
      await db
        .update(verifiedServiceLinks)
        .set({
          isVerified: true,
          verifiedAt: new Date(),
          verifiedByUserId: byUserId,
          updatedAt: new Date(),
        })
        .where(eq(verifiedServiceLinks.id, linkId));
    },

    async updateHealth(
      linkId: string,
      httpStatus: number,
      isAlive: boolean
    ): Promise<void> {
      await db
        .update(verifiedServiceLinks)
        .set({
          lastCheckedAt: new Date(),
          lastHttpStatus: httpStatus,
          isLinkAlive: isAlive,
          updatedAt: new Date(),
        })
        .where(eq(verifiedServiceLinks.id, linkId));
    },

    async listForCandidate(candidateId: string): Promise<VerifiedServiceLink[]> {
      const rows = await db
        .select()
        .from(verifiedServiceLinks)
        .where(eq(verifiedServiceLinks.candidateId, candidateId));
      return rows.map(rowToLink);
    },

    async listForService(
      serviceId: string,
      onlyVerified?: boolean
    ): Promise<VerifiedServiceLink[]> {
      const conditions = [eq(verifiedServiceLinks.serviceId, serviceId)];
      if (onlyVerified) {
        conditions.push(eq(verifiedServiceLinks.isVerified, true));
      }
      const rows = await db
        .select()
        .from(verifiedServiceLinks)
        .where(and(...conditions));
      return rows.map(rowToLink);
    },

    async listByType(
      serviceId: string,
      linkType: VerifiedLinkType
    ): Promise<VerifiedServiceLink[]> {
      const rows = await db
        .select()
        .from(verifiedServiceLinks)
        .where(
          and(
            eq(verifiedServiceLinks.serviceId, serviceId),
            eq(verifiedServiceLinks.linkType, linkType)
          )
        );
      return rows.map(rowToLink);
    },

    async transferToService(
      candidateId: string,
      serviceId: string
    ): Promise<void> {
      await db
        .update(verifiedServiceLinks)
        .set({
          serviceId,
          updatedAt: new Date(),
        })
        .where(eq(verifiedServiceLinks.candidateId, candidateId));
    },

    async bulkAdd(links: VerifiedServiceLink[]): Promise<void> {
      if (links.length === 0) return;

      const rows = links.map((link) => ({
        candidateId: link.candidateId,
        serviceId: link.serviceId,
        url: link.url,
        label: link.label,
        linkType: link.linkType,
        intentActions: link.intentActions ?? [],
        intentCategories: link.intentCategories ?? [],
        audienceTags: link.audienceTags ?? [],
        locales: link.locales ?? [],
        isVerified: link.isVerified,
        verifiedAt: link.verifiedAt ? new Date(link.verifiedAt) : undefined,
        verifiedByUserId: link.verifiedByUserId,
        lastCheckedAt: link.lastCheckedAt ? new Date(link.lastCheckedAt) : undefined,
        lastHttpStatus: link.lastHttpStatus,
        isLinkAlive: link.isLinkAlive,
        evidenceId: link.evidenceId,
        discoveredAt: new Date(link.discoveredAt),
      }));

      await db.insert(verifiedServiceLinks).values(rows);
    },
  };
}
