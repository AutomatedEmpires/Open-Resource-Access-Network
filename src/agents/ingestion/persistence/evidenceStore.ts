/**
 * Drizzle ORM implementation of EvidenceStore.
 *
 * Handles persistence of evidence snapshots (fetched page content).
 */
import { eq, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { EvidenceSnapshot } from '../contracts';
import type { EvidenceStore } from '../stores';
import {
  evidenceSnapshots,
  discoveredLinks,
  type NewEvidenceSnapshotRow,
  type EvidenceSnapshotRow,
} from '../../../db/schema';

type DbSchema = typeof import('../../../db/schema');

/**
 * Maps a database row to an EvidenceSnapshot domain object.
 */
function rowToSnapshot(row: EvidenceSnapshotRow): EvidenceSnapshot {
  return {
    evidenceId: row.evidenceId,
    canonicalUrl: row.canonicalUrl,
    fetchedAt: row.fetchedAt.toISOString(),
    httpStatus: row.httpStatus,
    contentHashSha256: row.contentHashSha256 as `${string}`,
    contentType: row.contentType ?? undefined,
    blobUri: row.blobStorageKey ?? undefined,
  };
}

/**
 * Creates an EvidenceStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleEvidenceStore(
  db: NodePgDatabase<DbSchema>
): EvidenceStore {
  return {
    async create(snapshot) {
      const row: NewEvidenceSnapshotRow = {
        evidenceId: snapshot.evidenceId,
        canonicalUrl: snapshot.canonicalUrl,
        fetchedAt: new Date(snapshot.fetchedAt),
        httpStatus: snapshot.httpStatus,
        contentHashSha256: snapshot.contentHashSha256,
        contentType: snapshot.contentType,
        blobStorageKey: snapshot.blobUri,
        correlationId: snapshot.correlationId,
        jobId: snapshot.jobId ? (snapshot.jobId as unknown as string) : undefined,
      };

      await db.insert(evidenceSnapshots).values(row);
    },

    async getById(evidenceId) {
      const rows = await db
        .select()
        .from(evidenceSnapshots)
        .where(eq(evidenceSnapshots.evidenceId, evidenceId))
        .limit(1);

      return rows.length > 0 ? rowToSnapshot(rows[0]) : null;
    },

    async getByContentHash(hash) {
      const rows = await db
        .select()
        .from(evidenceSnapshots)
        .where(eq(evidenceSnapshots.contentHashSha256, hash))
        .orderBy(desc(evidenceSnapshots.fetchedAt))
        .limit(1);

      return rows.length > 0 ? rowToSnapshot(rows[0]) : null;
    },

    async getByCanonicalUrl(url) {
      const rows = await db
        .select()
        .from(evidenceSnapshots)
        .where(eq(evidenceSnapshots.canonicalUrl, url))
        .orderBy(desc(evidenceSnapshots.fetchedAt))
        .limit(1);

      return rows.length > 0 ? rowToSnapshot(rows[0]) : null;
    },

    async hasContentChanged(url, newHash) {
      const existing = await this.getByCanonicalUrl(url);
      if (!existing) {
        // No previous snapshot = content is "new"
        return true;
      }
      return existing.contentHashSha256 !== newHash;
    },
  };
}

/**
 * Stores discovered links for an evidence snapshot.
 */
export async function storeDiscoveredLinks(
  db: NodePgDatabase<DbSchema>,
  evidenceId: string,
  links: Array<{
    url: string;
    type: string;
    label?: string;
    confidence: number;
  }>
): Promise<void> {
  if (links.length === 0) return;

  const rows = links.map((link) => ({
    evidenceId,
    url: link.url,
    linkType: link.type,
    label: link.label,
    confidence: link.confidence,
  }));

  await db.insert(discoveredLinks).values(rows);
}

/**
 * Gets discovered links for an evidence snapshot.
 */
export async function getDiscoveredLinks(
  db: NodePgDatabase<DbSchema>,
  evidenceId: string
): Promise<Array<{
  url: string;
  type: string;
  label?: string;
  confidence: number;
}>> {
  const rows = await db
    .select()
    .from(discoveredLinks)
    .where(eq(discoveredLinks.evidenceId, evidenceId));

  return rows.map((row) => ({
    url: row.url,
    type: row.linkType,
    label: row.label ?? undefined,
    confidence: row.confidence ?? 50,
  }));
}
