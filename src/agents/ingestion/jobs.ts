/**
 * Ingestion Job contracts.
 *
 * Jobs track crawl/extraction runs. Every job has a correlationId for audit trail.
 * The agent creates jobs, updates their status, and emits events for each action.
 */
import { z } from 'zod';

export const IngestionJobTypeSchema = z.enum([
  'seed_crawl',
  'scheduled_reverify',
  'manual_submission',
  'rss_feed',
  'sitemap_discovery',
  'registry_change',
]);
export type IngestionJobType = z.infer<typeof IngestionJobTypeSchema>;

export const IngestionJobStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type IngestionJobStatus = z.infer<typeof IngestionJobStatusSchema>;

export const IngestionJobSchema = z
  .object({
    id: z.string().uuid(),
    correlationId: z.string().min(1),
    sourceRegistryId: z.string().uuid().optional(),

    jobType: IngestionJobTypeSchema,
    status: IngestionJobStatusSchema,

    seedUrls: z.array(z.string().url()).default([]),

    // Stats
    urlsDiscovered: z.number().int().min(0).default(0),
    urlsFetched: z.number().int().min(0).default(0),
    candidatesExtracted: z.number().int().min(0).default(0),
    candidatesVerified: z.number().int().min(0).default(0),
    errorsCount: z.number().int().min(0).default(0),

    // Timestamps
    queuedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),

    // Error info
    errorMessage: z.string().optional(),
    errorDetails: z.record(z.string(), z.unknown()).optional(),

    agentId: z.string().min(1).default('oran-ingestion-agent/1.0'),
  })
  .strict();
export type IngestionJob = z.infer<typeof IngestionJobSchema>;

export const CreateIngestionJobInputSchema = z
  .object({
    jobType: IngestionJobTypeSchema,
    seedUrls: z.array(z.string().url()).min(1),
    sourceRegistryId: z.string().uuid().optional(),
    agentId: z.string().min(1).optional(),
  })
  .strict();
export type CreateIngestionJobInput = z.infer<typeof CreateIngestionJobInputSchema>;

/**
 * Create a new job with a unique correlation ID.
 */
export function createIngestionJob(
  input: CreateIngestionJobInput,
  nowIso: string = new Date().toISOString()
): IngestionJob {
  return IngestionJobSchema.parse({
    id: crypto.randomUUID(),
    correlationId: `job-${crypto.randomUUID()}`,
    sourceRegistryId: input.sourceRegistryId,
    jobType: input.jobType,
    status: 'queued',
    seedUrls: input.seedUrls,
    urlsDiscovered: 0,
    urlsFetched: 0,
    candidatesExtracted: 0,
    candidatesVerified: 0,
    errorsCount: 0,
    queuedAt: nowIso,
    agentId: input.agentId ?? 'oran-ingestion-agent/1.0',
  });
}

/**
 * Valid job-status transitions.
 * queued → running → completed | failed | cancelled
 * queued → cancelled (direct cancel before start)
 */
const VALID_JOB_TRANSITIONS: Record<IngestionJobStatus, IngestionJobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

/**
 * Transition a job to the next status.
 * Throws if the transition is illegal.
 */
export function transitionJobStatus(
  job: IngestionJob,
  newStatus: IngestionJobStatus,
  nowIso: string = new Date().toISOString(),
  error?: { message: string; details?: Record<string, unknown> }
): IngestionJob {
  const allowed = VALID_JOB_TRANSITIONS[job.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid job status transition: ${job.status} → ${newStatus}. ` +
      `Allowed transitions from '${job.status}': [${allowed.join(', ')}]`
    );
  }

  const updates: Partial<IngestionJob> = { status: newStatus };

  if (newStatus === 'running' && !job.startedAt) {
    updates.startedAt = nowIso;
  }

  if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') {
    updates.completedAt = nowIso;
  }

  if (error) {
    updates.errorMessage = error.message;
    updates.errorDetails = error.details;
  }

  return IngestionJobSchema.parse({ ...job, ...updates });
}

