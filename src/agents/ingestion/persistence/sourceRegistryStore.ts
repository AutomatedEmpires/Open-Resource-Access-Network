/**
 * Drizzle ORM implementation of SourceRegistryStore.
 *
 * Maps SourceRegistryEntry domain objects to the ingestion_sources table.
 */
import { eq, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { ingestionSources } from '@/db/schema';
import type { SourceRegistryEntry } from '../sourceRegistry';
import type { SourceRegistryStore } from '../stores';

/**
 * Map legacy DB patternType values to the current domain DomainRule type.
 *
 * The ingestion_sources table may contain legacy values ('exact', 'domain', 'regex')
 * that pre-date the current domain schema which only allows 'exact_host' | 'suffix'.
 * Unknown or un-mappable values fall back to 'suffix'.
 */
function mapPatternType(dbValue: string): 'exact_host' | 'suffix' {
  if (dbValue === 'exact_host') return 'exact_host';
  if (dbValue === 'exact') return 'exact_host';  // legacy alias
  if (dbValue === 'suffix') return 'suffix';
  // 'domain', 'regex', and any other legacy values treated as suffix-style matching
  return 'suffix';
}

/**
 * Convert a DB row to a SourceRegistryEntry domain object.
 *
 * The ingestion_sources table predates the current domain model revision.
 * DB fields are mapped to domain fields as follows:
 *   name           → displayName
 *   maxDepth       → crawl.maxConcurrentRequests (closest semantic fit; no 1:1 for maxDepth)
 *   crawlFrequency → not directly representable in CrawlPolicy; used for scheduling context
 *   isActive       → not part of SourceRegistryEntry; used only at the DB query level
 *   notes          → not part of SourceRegistryEntry; discarded safely
 * discovery, coverage default to schema defaults since the DB has no corresponding columns.
 */
function rowToEntry(
  row: typeof ingestionSources.$inferSelect
): SourceRegistryEntry {
  return {
    id: row.id,
    displayName: row.name,
    trustLevel: row.trustLevel as SourceRegistryEntry['trustLevel'],
    domainRules: [
      {
        type: mapPatternType(row.patternType),
        value: row.pattern,
      },
    ],
    discovery: [{ type: 'seeded_only' as const }],
    crawl: {
      obeyRobotsTxt: true,
      userAgent: 'oran-ingestion-agent/1.0',
      allowedPathPrefixes: ['/'],
      blockedPathPrefixes: [],
      maxRequestsPerMinute: 60,
      maxConcurrentRequests: Math.min(row.maxDepth, 50), // repurpose maxDepth as concurrency hint
      fetchTtlHours: row.crawlFrequency, // repurpose crawlFrequency as TTL hint
    },
    coverage: [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Creates a SourceRegistryStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleSourceRegistryStore(
  db: NodePgDatabase<Record<string, unknown>>
): SourceRegistryStore {
  return {
    async listActive(): Promise<SourceRegistryEntry[]> {
      const rows = await db
        .select()
        .from(ingestionSources)
        .where(eq(ingestionSources.isActive, true));
      return rows.map(rowToEntry);
    },

    async getById(id: string): Promise<SourceRegistryEntry | null> {
      const rows = await db
        .select()
        .from(ingestionSources)
        .where(eq(ingestionSources.id, id))
        .limit(1);
      return rows.length > 0 ? rowToEntry(rows[0]) : null;
    },

    async findForUrl(url: string): Promise<SourceRegistryEntry | null> {
      let hostname: string;
      try {
        hostname = new URL(url).hostname.toLowerCase();
      } catch {
        return null;
      }

      const rows = await db
        .select()
        .from(ingestionSources)
        .where(eq(ingestionSources.isActive, true));

      for (const row of rows) {
        const pattern = row.pattern.toLowerCase();
        const type = row.patternType;

        if (type === 'exact' && hostname === pattern) {
          return rowToEntry(row);
        }
        if (type === 'suffix' && hostname.endsWith(pattern)) {
          return rowToEntry(row);
        }
        if (type === 'domain' && (hostname === pattern || hostname.endsWith(`.${pattern}`))) {
          return rowToEntry(row);
        }
        if (type === 'regex') {
          try {
            if (new RegExp(pattern, 'i').test(hostname)) {
              return rowToEntry(row);
            }
          } catch {
            // Invalid regex — skip
          }
        }
      }

      return null;
    },

    async upsert(entry: SourceRegistryEntry): Promise<void> {
      const rule = entry.domainRules?.[0];
      const values = {
        id: entry.id,
        name: entry.displayName ?? rule?.value ?? 'Unknown',
        pattern: rule?.value ?? '',
        patternType: rule?.type ?? 'exact_host',
        trustLevel: entry.trustLevel,
        // crawl policy provides nearest equivalents for legacy DB columns
        maxDepth: entry.crawl?.maxConcurrentRequests ?? 2,
        crawlFrequency: entry.crawl?.fetchTtlHours ?? 7,
        // isActive not in domain type — default true on insert; preserves existing on update
        isActive: true,
        notes: null as string | null,
      };

      if (entry.id) {
        const existing = await db
          .select()
          .from(ingestionSources)
          .where(eq(ingestionSources.id, entry.id))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(ingestionSources)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(ingestionSources.id, entry.id));
          return;
        }
      }

      await db.insert(ingestionSources).values(values);
    },

    async deactivate(id: string): Promise<void> {
      await db
        .update(ingestionSources)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(ingestionSources.id, id));
    },
  };
}
