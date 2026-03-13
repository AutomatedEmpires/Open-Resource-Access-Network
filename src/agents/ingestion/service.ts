/**
 * IngestionService — High-level service that orchestrates the full
 * ingestion pipeline with store persistence.
 *
 * Bridges the PipelineOrchestrator (stateless URL processing) with the
 * IngestionStores (durable DB persistence) and admin routing workflow.
 *
 * Usage:
 *   const service = createIngestionService(stores);
 *   const result = await service.runPipeline({ sourceUrl: 'https://...' });
 */
import type { IngestionStores } from './stores';
import type { PipelineInput, PipelineResult } from './pipeline/types';
import { createPipelineOrchestrator, type PipelineOrchestratorOptions } from './pipeline/orchestrator';
import { createIngestionJob, type IngestionJob } from './jobs';
import type { SourceRegistryEntry } from './sourceRegistry';
import { materializePipelineArtifacts } from './materialize';

type SupportedSourceFeedHandler = 'ndp_211' | 'hsds_api';

function getSourceRecordTrustTier(sourceRecord: { sourceConfidenceSignals?: unknown }): string | undefined {
  const signals = sourceRecord.sourceConfidenceSignals;
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)) {
    return undefined;
  }

  const trustTier = (signals as Record<string, unknown>).trustTier;
  return typeof trustTier === 'string' ? trustTier : undefined;
}

function is211SourceRecord(sourceRecord: { sourceConfidenceSignals?: unknown; sourceRecordType?: string }): boolean {
  const signals = sourceRecord.sourceConfidenceSignals;
  if (signals && typeof signals === 'object' && !Array.isArray(signals)) {
    const source = (signals as Record<string, unknown>).source;
    if (source === '211_ndp') {
      return true;
    }
  }

  return sourceRecord.sourceRecordType === 'organization_bundle';
}

async function normalizePendingSourceRecordsForFeed(
  stores: IngestionStores,
  sourceFeedId: string,
): Promise<{ normalized: number; errors: number }> {
  const pendingRecords = await stores.sourceRecords.listPendingByFeed(sourceFeedId);
  let normalized = 0;
  let errors = 0;

  for (const sourceRecord of pendingRecords) {
    try {
      if (is211SourceRecord(sourceRecord)) {
        const { normalize211SourceRecord } = await import('./ndp211Normalizer');
        await normalize211SourceRecord({
          stores,
          sourceRecord,
          trustTier: getSourceRecordTrustTier(sourceRecord),
          runCrosswalk: true,
        });
      } else {
        const { normalizeSourceRecord } = await import('./normalizeSourceRecord');
        await normalizeSourceRecord({
          stores,
          sourceRecord,
          trustTier: getSourceRecordTrustTier(sourceRecord),
        });
      }

      normalized++;
    } catch (error) {
      errors++;
      await stores.sourceRecords.updateStatus(
        sourceRecord.id,
        'failed',
        error instanceof Error ? error.message : 'Normalization failed',
      );
    }
  }

  return { normalized, errors };
}

function getSupportedSourceFeedHandler(feed: { feedHandler?: string | null }): SupportedSourceFeedHandler | null {
  if (feed.feedHandler === 'ndp_211' || feed.feedHandler === 'hsds_api') {
    return feed.feedHandler;
  }

  return null;
}

// ============================================================
// Service Types
// ============================================================

export interface RunPipelineOptions {
  /** Source URL to process */
  sourceUrl: string;
  /** Force re-processing even if previously processed */
  forceReprocess?: boolean;
  /** Triggered by (user ID or 'system') */
  triggeredBy?: string;
  /** Maximum stages to execute (for testing/debugging) */
  maxStages?: number;
}

export interface RunPipelineResult {
  /** The ingestion job created for this run */
  job: IngestionJob;
  /** Pipeline execution result */
  pipeline: PipelineResult;
}

export interface IngestionService {
  /** Run the full pipeline for a URL and persist results. */
  runPipeline(options: RunPipelineOptions): Promise<RunPipelineResult>;

  /** Run pipeline for a batch of URLs. */
  runBatch(urls: string[], triggeredBy?: string): Promise<RunPipelineResult[]>;

  /** Poll all active feeds and process new content. */
  pollFeeds(): Promise<{
    feedsPolled: number;
    newUrls: number;
    errors: number;
  }>;

  /** Re-verify candidates due for reverification. */
  runReverification(limit?: number): Promise<{
    candidatesChecked: number;
    updated: number;
    errors: number;
  }>;

  /** Escalate overdue assignments. */
  escalateOverdue(): Promise<{
    assignmentsEscalated: number;
  }>;
}

// ============================================================
// Service Implementation
// ============================================================

export function createIngestionService(
  stores: IngestionStores,
  pipelineOptions?: Partial<PipelineOrchestratorOptions>
): IngestionService {
  const service: IngestionService = {
    async runPipeline(options: RunPipelineOptions): Promise<RunPipelineResult> {
      // 1. Look up source registry entry for URL
      const sourceEntry = await stores.sourceRegistry.findForUrl(options.sourceUrl);

      // 2. Create ingestion job
      const job = createIngestionJob({
        jobType: 'seed_crawl',
        seedUrls: [options.sourceUrl],
        sourceRegistryId: sourceEntry?.id,
      });

      await stores.jobs.create(job);
      const correlationId = job.correlationId;

      // 3. Update job to running
      const updatedJob: IngestionJob = { ...job, status: 'running', startedAt: new Date().toISOString() };
      await stores.jobs.update(updatedJob);

      // 4. Build pipeline input
      const pipelineInput: PipelineInput = {
        sourceUrl: options.sourceUrl,
        correlationId,
        forceReprocess: options.forceReprocess ?? false,
        maxStages: options.maxStages,
      };

      // 5. Build source registry for the orchestrator
      let registry: SourceRegistryEntry[] = [];
      try {
        const activeSources = await stores.sourceRegistry.listActive();
        registry = activeSources;
      } catch {
        // Fall back to bootstrap registry if store fails
      }

      // 6. Create and run pipeline orchestrator
      const orchestrator = createPipelineOrchestrator({
        ...pipelineOptions,
        registry: registry.length > 0 ? registry : pipelineOptions?.registry,
        onEvent: (event) => {
          // Forward events and update job stats
          pipelineOptions?.onEvent?.(event);
        },
      });

      let pipelineResult: PipelineResult;
      try {
        const detailedExecution = await orchestrator.processUrlDetailed(pipelineInput);
        const materialized = await materializePipelineArtifacts(stores, detailedExecution, {
          jobId: job.id,
          correlationId,
        });

        pipelineResult = {
          ...detailedExecution.result,
          candidateId: materialized.candidateId ?? detailedExecution.result.candidateId,
          evidenceId: materialized.evidenceId ?? detailedExecution.result.evidenceId,
        };
      } catch (error) {
        // Pipeline failed - update job
        const failedJob: IngestionJob = {
          ...updatedJob,
          status: 'failed',
          completedAt: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        };
        await stores.jobs.update(failedJob);

        // Emit audit event
        await stores.audit.append({
          eventId: crypto.randomUUID(),
          correlationId,
          eventType: 'extract.completed',
          actorType: 'system',
          actorId: 'ingestion-service',
          targetType: 'extraction',
          targetId: correlationId,
          timestamp: new Date().toISOString(),
          inputs: { sourceUrl: options.sourceUrl },
          outputs: { error: failedJob.errorMessage },
          evidenceRefs: [],
        });

        throw error;
      }

      // 7. Persist audit output for the completed pipeline
      await persistPipelineResults(stores, pipelineResult, correlationId, options.triggeredBy);

      // 8. Update job stats
      const completedJob: IngestionJob = {
        ...updatedJob,
        status: pipelineResult.status === 'failed' ? 'failed' : 'completed',
        completedAt: new Date().toISOString(),
        urlsDiscovered: 1,
        urlsFetched: pipelineResult.evidenceId ? 1 : 0,
        candidatesExtracted: pipelineResult.candidateId ? 1 : 0,
        candidatesVerified: pipelineResult.confidenceScore !== undefined ? 1 : 0,
        errorsCount: pipelineResult.stages.filter((s) => s.status === 'failed').length,
      };
      await stores.jobs.update(completedJob);

      return { job: completedJob, pipeline: pipelineResult };
    },

    async runBatch(urls: string[], triggeredBy?: string): Promise<RunPipelineResult[]> {
      const results: RunPipelineResult[] = [];
      for (const url of urls) {
        try {
          const result = await service.runPipeline({
            sourceUrl: url,
            triggeredBy,
          });
          results.push(result);
        } catch {
          // Continue processing other URLs on failure
        }
      }
      return results;
    },

    async pollFeeds(): Promise<{
      feedsPolled: number;
      newUrls: number;
      errors: number;
    }> {
      // ── Legacy feeds (FeedSubscription) ────────────────────
      const dueFeeds = await stores.feeds.listDueForPoll();
      let newUrls = 0;
      let errors = 0;

      for (const feed of dueFeeds) {
        try {
          await stores.feeds.updateAfterPoll(feed.id!, {
            lastPolledAt: new Date().toISOString(),
          });
        } catch {
          errors++;
          if (feed.id) {
            await stores.feeds.updateAfterPoll(feed.id, {
              lastPolledAt: new Date().toISOString(),
              error: 'Feed poll failed',
            });
          }
        }
      }

      // ── Source-assertion-layer feeds (sourceFeeds) ──────────
      let sourceAssertionFeeds = 0;
      try {
        const dueSourceFeeds = await stores.sourceFeeds.listDueForPoll();
        for (const sourceFeed of dueSourceFeeds) {
          const sourceSystem = await stores.sourceSystems.getById(sourceFeed.sourceSystemId);
          if (!sourceSystem) {
            errors++;
            continue;
          }

          try {
            const feedHandler = getSupportedSourceFeedHandler(sourceFeed);
            if (feedHandler === 'ndp_211') {
              const { poll211NdpFeed } = await import('./ndp211Connector');
              const pollResult = await poll211NdpFeed({
                stores,
                sourceSystem,
                feed: sourceFeed,
                correlationId: `poll-211-${sourceFeed.id}-${Date.now()}`,
                dataOwners: process.env.NDP_211_DATA_OWNERS,
              });
              newUrls += pollResult.recordsCreated;
              if (pollResult.errors.length > 0) errors += pollResult.errors.length;
            } else if (feedHandler === 'hsds_api') {
              const { pollHsdsFeed } = await import('./hsdsFeedConnector');
              const pollResult = await pollHsdsFeed({
                stores,
                sourceSystem,
                feed: sourceFeed,
                correlationId: `poll-hsds-${sourceFeed.id}-${Date.now()}`,
              });
              newUrls += pollResult.recordsCreated;
              if (pollResult.errors.length > 0) errors += pollResult.errors.length;
            } else {
              continue;
            }

            const normalizationResult = await normalizePendingSourceRecordsForFeed(
              stores,
              sourceFeed.id,
            );
            errors += normalizationResult.errors;
            sourceAssertionFeeds++;
          } catch {
            errors++;
          }
        }
      } catch {
        // sourceFeeds store may not be available in all environments
      }

      return {
        feedsPolled: dueFeeds.length + sourceAssertionFeeds,
        newUrls,
        errors,
      };
    },

    async runReverification(
      limit?: number
    ): Promise<{ candidatesChecked: number; updated: number; errors: number }> {
      const candidates = await stores.candidates.listDueForReverify(limit ?? 50);
      let updated = 0;
      let errors = 0;

      for (const candidate of candidates) {
        try {
          // Re-run pipeline for the candidate's source URL
          if (candidate.fields.websiteUrl) {
            await service.runPipeline({
              sourceUrl: candidate.fields.websiteUrl,
              forceReprocess: true,
              triggeredBy: 'reverification-service',
            });
            updated++;
          }
        } catch {
          errors++;
        }
      }

      return { candidatesChecked: candidates.length, updated, errors };
    },

    async escalateOverdue(): Promise<{ assignmentsEscalated: number }> {
      const overdue = await stores.assignments.listOverdue(100);
      let escalated = 0;

      for (const assignment of overdue) {
        try {
          await stores.assignments.updateStatus(
            assignment.id!,
            'expired'
          );
          escalated++;
        } catch {
          // Continue processing other assignments
        }
      }

      return { assignmentsEscalated: escalated };
    },
  };

  return service;
}

/**
 * Persist pipeline results to the various stores.
 * This is the critical function that writes extraction results to the DB.
 */
async function persistPipelineResults(
  stores: IngestionStores,
  result: PipelineResult,
  correlationId: string,
  triggeredBy?: string
): Promise<void> {
  // 1. Audit event for pipeline completion
  await stores.audit.append({
    eventId: crypto.randomUUID(),
    correlationId,
    eventType: result.candidateId ? 'extract.completed' : 'evidence.fetched',
    actorType: triggeredBy === 'system' ? 'system' : 'service_principal',
    actorId: triggeredBy ?? 'ingestion-service',
    targetType: result.candidateId ? 'candidate' : 'evidence',
    targetId: result.candidateId ?? result.evidenceId ?? correlationId,
    timestamp: new Date().toISOString(),
    inputs: { sourceUrl: result.sourceUrl },
    outputs: {
      status: result.status,
      candidateId: result.candidateId,
      evidenceId: result.evidenceId,
      confidenceScore: result.confidenceScore,
    },
    evidenceRefs: result.evidenceId ? [result.evidenceId] : [],
  });
}
