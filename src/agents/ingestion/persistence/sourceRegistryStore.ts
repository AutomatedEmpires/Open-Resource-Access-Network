/**
 * Drizzle ORM implementation of SourceRegistryStore.
 *
 * Bridges the legacy SourceRegistryEntry interface onto the unified
 * source_systems table so existing ingestion callers can move off the
 * deprecated ingestion_sources registry without a full runtime rewrite.
 */
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sourceSystems } from '@/db/schema';
import {
  matchSourceForUrl,
  SourceRegistryEntrySchema,
  type SourceRegistryEntry,
} from '../sourceRegistry';
import type { SourceRegistryStore } from '../stores';

type DbSchema = typeof import('@/db/schema');

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return strings.length > 0 ? strings : fallback;
}

function inferHomepageUrl(discovery: SourceRegistryEntry['discovery']): string | null {
  for (const rule of discovery) {
    if (rule.seedUrls?.[0]) return rule.seedUrls[0];
    if (rule.sitemapUrl) return rule.sitemapUrl;
    if (rule.feedUrl) return rule.feedUrl;
    if (rule.indexUrl) return rule.indexUrl;
  }
  return null;
}

function isRegistryCompatible(row: typeof sourceSystems.$inferSelect): boolean {
  return Array.isArray(row.domainRules) && row.domainRules.length > 0;
}

function rowToEntry(row: typeof sourceSystems.$inferSelect): SourceRegistryEntry {
  const crawlPolicy = asRecord(row.crawlPolicy);
  const discovery = Array.isArray(crawlPolicy.discovery) ? crawlPolicy.discovery : [{ type: 'seeded_only' }];
  const jurisdictionScope = Array.isArray(row.jurisdictionScope) ? row.jurisdictionScope : [];

  return SourceRegistryEntrySchema.parse({
    id: row.id,
    displayName: row.name,
    trustLevel: row.trustTier,
    domainRules: Array.isArray(row.domainRules) ? row.domainRules : [],
    discovery,
    crawl: {
      obeyRobotsTxt: typeof crawlPolicy.obeyRobotsTxt === 'boolean' ? crawlPolicy.obeyRobotsTxt : true,
      userAgent: typeof crawlPolicy.userAgent === 'string' ? crawlPolicy.userAgent : 'oran-ingestion-agent/1.0',
      allowedPathPrefixes: asStringArray(crawlPolicy.allowedPathPrefixes, ['/']),
      blockedPathPrefixes: asStringArray(crawlPolicy.blockedPathPrefixes, []),
      maxRequestsPerMinute: Number.isFinite(crawlPolicy.maxRequestsPerMinute)
        ? Number(crawlPolicy.maxRequestsPerMinute)
        : 60,
      maxConcurrentRequests: Number.isFinite(crawlPolicy.maxConcurrentRequests)
        ? Number(crawlPolicy.maxConcurrentRequests)
        : 3,
      fetchTtlHours: Number.isFinite(crawlPolicy.fetchTtlHours)
        ? Number(crawlPolicy.fetchTtlHours)
        : 24,
    },
    coverage: jurisdictionScope,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function entryToRow(entry: SourceRegistryEntry) {
  const homepageUrl = inferHomepageUrl(entry.discovery);

  return {
    id: entry.id,
    name: entry.displayName,
    family: entry.discovery[0]?.type ?? 'seeded_only',
    homepageUrl,
    trustTier: entry.trustLevel,
    domainRules: entry.domainRules,
    crawlPolicy: {
      ...entry.crawl,
      discovery: entry.discovery,
    },
    jurisdictionScope: entry.coverage,
  };
}

/**
 * Creates a SourceRegistryStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleSourceRegistryStore(
  db: NodePgDatabase<DbSchema>
): SourceRegistryStore {
  return {
    async listActive(): Promise<SourceRegistryEntry[]> {
      const rows = await db
        .select()
        .from(sourceSystems)
        .where(eq(sourceSystems.isActive, true));
      return rows.filter(isRegistryCompatible).map(rowToEntry);
    },

    async getById(id: string): Promise<SourceRegistryEntry | null> {
      const rows = await db
        .select()
        .from(sourceSystems)
        .where(eq(sourceSystems.id, id))
        .limit(1);
      return rows.length > 0 && isRegistryCompatible(rows[0]) ? rowToEntry(rows[0]) : null;
    },

    async findForUrl(url: string): Promise<SourceRegistryEntry | null> {
      const entries = await this.listActive();
      const match = matchSourceForUrl(url, entries);
      if (!match.allowed || !match.sourceId) {
        return null;
      }
      return entries.find((entry) => entry.id === match.sourceId) ?? null;
    },

    async upsert(entry: SourceRegistryEntry): Promise<void> {
      const values = entryToRow(entry);

      const existing = await db
        .select()
        .from(sourceSystems)
        .where(eq(sourceSystems.id, entry.id))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(sourceSystems)
          .set({
            ...values,
            updatedAt: new Date(),
            isActive: true,
          })
          .where(eq(sourceSystems.id, entry.id));
        return;
      }

      await db.insert(sourceSystems).values({
        ...values,
        isActive: true,
      });
    },

    async deactivate(id: string): Promise<void> {
      await db
        .update(sourceSystems)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(sourceSystems.id, id));
    },
  };
}
