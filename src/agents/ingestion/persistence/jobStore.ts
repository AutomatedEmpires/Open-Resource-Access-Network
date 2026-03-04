/**
 * Drizzle ORM implementation of JobStore.
 *
 * Maps IngestionJob domain objects to the ingestion_jobs table.
 */
import { eq, desc, asc, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { ingestionJobs } from '@/db/schema';
import type { IngestionJob, IngestionJobStatus } from '../jobs';
import type { JobStore } from '../stores';

/**
 * Convert a DB row to an IngestionJob domain object.
 */
function rowToJob(row: typeof ingestionJobs.$inferSelect): IngestionJob {
  return {
    id: row.id,
    correlationId: row.correlationId,
    jobType: row.jobType as IngestionJob['jobType'],
    status: row.status as IngestionJobStatus,
    seedUrls: row.seedUrl ? [row.seedUrl] : [],
    urlsDiscovered: row.statsUrlsDiscovered,
    urlsFetched: row.statsUrlsFetched,
    candidatesExtracted: row.statsCandidatesExtracted,
    candidatesVerified: row.statsCandidatesVerified,
    errorsCount: row.statsErrorsCount,
    queuedAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    agentId: 'oran-ingestion-agent/1.0',
  };
}

/**
 * Creates a JobStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleJobStore(
  db: NodePgDatabase<Record<string, unknown>>
): JobStore {
  return {
    async create(job: IngestionJob): Promise<void> {
      await db.insert(ingestionJobs).values({
        id: job.id,
        correlationId: job.correlationId,
        jobType: job.jobType,
        status: job.status,
        seedUrl: job.seedUrls?.[0],
        priority: 0,
        statsUrlsDiscovered: job.urlsDiscovered ?? 0,
        statsUrlsFetched: job.urlsFetched ?? 0,
        statsCandidatesExtracted: job.candidatesExtracted ?? 0,
        statsCandidatesVerified: job.candidatesVerified ?? 0,
        statsErrorsCount: job.errorsCount ?? 0,
        startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
        completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
      });
    },

    async getById(id: string): Promise<IngestionJob | null> {
      const rows = await db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.id, id))
        .limit(1);
      return rows.length > 0 ? rowToJob(rows[0]) : null;
    },

    async getByCorrelationId(correlationId: string): Promise<IngestionJob | null> {
      const rows = await db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.correlationId, correlationId))
        .limit(1);
      return rows.length > 0 ? rowToJob(rows[0]) : null;
    },

    async update(job: IngestionJob): Promise<void> {
      await db
        .update(ingestionJobs)
        .set({
          status: job.status,
          statsUrlsDiscovered: job.urlsDiscovered,
          statsUrlsFetched: job.urlsFetched,
          statsCandidatesExtracted: job.candidatesExtracted,
          statsCandidatesVerified: job.candidatesVerified,
          statsErrorsCount: job.errorsCount,
          startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
          completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(ingestionJobs.id, job.id));
    },

    async listByStatus(
      status: IngestionJobStatus,
      limit = 50
    ): Promise<IngestionJob[]> {
      const rows = await db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.status, status))
        .orderBy(desc(ingestionJobs.createdAt))
        .limit(limit);
      return rows.map(rowToJob);
    },

    async dequeueNext(): Promise<IngestionJob | null> {
      const rows = await db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.status, 'queued'))
        .orderBy(asc(ingestionJobs.createdAt))
        .limit(1);

      if (rows.length === 0) return null;

      const job = rowToJob(rows[0]);

      // Mark as running
      await db
        .update(ingestionJobs)
        .set({
          status: 'running',
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ingestionJobs.id, rows[0].id));

      return { ...job, status: 'running', startedAt: new Date().toISOString() };
    },

    async incrementStats(
      jobId: string,
      stats: Partial<{
        urlsDiscovered: number;
        urlsFetched: number;
        candidatesExtracted: number;
        candidatesVerified: number;
        errorsCount: number;
      }>
    ): Promise<void> {
      const setClauses: Record<string, unknown> = { updatedAt: new Date() };

      if (stats.urlsDiscovered) {
        setClauses.statsUrlsDiscovered = sql`${ingestionJobs.statsUrlsDiscovered} + ${stats.urlsDiscovered}`;
      }
      if (stats.urlsFetched) {
        setClauses.statsUrlsFetched = sql`${ingestionJobs.statsUrlsFetched} + ${stats.urlsFetched}`;
      }
      if (stats.candidatesExtracted) {
        setClauses.statsCandidatesExtracted = sql`${ingestionJobs.statsCandidatesExtracted} + ${stats.candidatesExtracted}`;
      }
      if (stats.candidatesVerified) {
        setClauses.statsCandidatesVerified = sql`${ingestionJobs.statsCandidatesVerified} + ${stats.candidatesVerified}`;
      }
      if (stats.errorsCount) {
        setClauses.statsErrorsCount = sql`${ingestionJobs.statsErrorsCount} + ${stats.errorsCount}`;
      }

      await db
        .update(ingestionJobs)
        .set(setClauses)
        .where(eq(ingestionJobs.id, jobId));
    },
  };
}
