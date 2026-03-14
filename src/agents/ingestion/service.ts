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
type PublicationMode = 'canonical_only' | 'review_required' | 'auto_publish';
type PublicationOutcomeReason =
  | 'no_services'
  | 'canonical_only'
  | 'review_required'
  | 'auto_publish_env_disabled'
  | 'auto_publish_approval_missing'
  | 'missing_required_locations'
  | 'auto_publish_policy_filtered';

interface PublicationOutcome {
  mode: PublicationMode;
  reviewQueued: number;
  published: number;
  skipped: number;
  reason: PublicationOutcomeReason;
  decisionReasons?: Record<string, number>;
}

interface NormalizationBatchResult {
  normalized: number;
  errors: number;
  canonicalOrganizationIds: string[];
  canonicalServiceIds: string[];
  canonicalLocationIds: string[];
}

async function appendPollAuditEvent(
  stores: IngestionStores,
  event: {
    correlationId: string;
    eventType: 'feed.poll_started' | 'feed.poll_completed' | 'normalize.failed';
    targetType: 'source_feed' | 'source_record';
    targetId: string;
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
  },
): Promise<void> {
  await stores.audit.append({
    eventId: crypto.randomUUID(),
    correlationId: event.correlationId,
    eventType: event.eventType,
    actorType: 'system',
    actorId: 'source-feed-poller',
    targetType: event.targetType,
    targetId: event.targetId,
    timestamp: new Date().toISOString(),
    inputs: event.inputs ?? {},
    outputs: event.outputs ?? {},
    evidenceRefs: [],
  });
}

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

function isEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function resolveFeedDataOwners(
  configured: string | undefined,
  state: { includedDataOwners?: unknown; excludedDataOwners?: unknown } | null,
): string | undefined {
  const included = toStringArray(state?.includedDataOwners);
  const excluded = new Set(toStringArray(state?.excludedDataOwners));
  const configuredOwners = String(configured ?? '')
    .split(',')
    .map((owner) => owner.trim())
    .filter(Boolean);
  const baseOwners = included.length > 0 ? included : configuredOwners;
  const owners = baseOwners.filter((owner) => !excluded.has(owner));
  return owners.length > 0 ? owners.join(',') : undefined;
}

function getPublicationMode(state: { publicationMode?: unknown } | null): PublicationMode {
  if (state?.publicationMode === 'canonical_only') return 'canonical_only';
  if (state?.publicationMode === 'auto_publish') return 'auto_publish';
  return 'review_required';
}

async function normalizePendingSourceRecordsForFeed(
  stores: IngestionStores,
  sourceFeedId: string,
  correlationId?: string,
): Promise<NormalizationBatchResult> {
  const pendingRecords = await stores.sourceRecords.listPendingByFeed(sourceFeedId);
  let normalized = 0;
  let errors = 0;
  const canonicalOrganizationIds: string[] = [];
  const canonicalServiceIds: string[] = [];
  const canonicalLocationIds: string[] = [];

  for (const sourceRecord of pendingRecords) {
    try {
      let normalizationResult;
      if (is211SourceRecord(sourceRecord)) {
        const { normalize211SourceRecord } = await import('./ndp211Normalizer');
        normalizationResult = await normalize211SourceRecord({
          stores,
          sourceRecord,
          trustTier: getSourceRecordTrustTier(sourceRecord),
          runCrosswalk: true,
        });
      } else {
        const { normalizeSourceRecord } = await import('./normalizeSourceRecord');
        normalizationResult = await normalizeSourceRecord({
          stores,
          sourceRecord,
          trustTier: getSourceRecordTrustTier(sourceRecord),
        });
      }

      normalized++;
      canonicalOrganizationIds.push(normalizationResult.canonicalOrganizationId);
      canonicalServiceIds.push(...normalizationResult.canonicalServiceIds);
      canonicalLocationIds.push(...normalizationResult.canonicalLocationIds);
    } catch (error) {
      errors++;
      await stores.sourceRecords.updateStatus(
        sourceRecord.id,
        'error',
        error instanceof Error ? error.message : 'Normalization failed',
      );
      if (correlationId) {
        await appendPollAuditEvent(stores, {
          correlationId,
          eventType: 'normalize.failed',
          targetType: 'source_record',
          targetId: sourceRecord.id,
          inputs: {
            sourceFeedId,
            sourceRecordType: sourceRecord.sourceRecordType,
          },
          outputs: {
            error: error instanceof Error ? error.message : 'Normalization failed',
          },
        });
      }
    }
  }

  return {
    normalized,
    errors,
    canonicalOrganizationIds,
    canonicalServiceIds,
    canonicalLocationIds,
  };
}

async function markFeedStateAttemptRunning(
  stores: IngestionStores,
  sourceFeedId: string,
  existingState: Awaited<ReturnType<IngestionStores['sourceFeedStates']['getByFeedId']>>,
  startedAt: Date,
): Promise<void> {
  if (existingState) {
    await stores.sourceFeedStates.update(sourceFeedId, {
      lastAttemptStatus: 'running',
      lastAttemptStartedAt: startedAt,
      lastAttemptCompletedAt: null,
      lastAttemptSummary: {},
    });
    return;
  }

  await stores.sourceFeedStates.upsert({
    sourceFeedId,
    publicationMode: 'review_required',
    emergencyPause: false,
    includedDataOwners: [],
    excludedDataOwners: [],
    lastAttemptStatus: 'running',
    lastAttemptStartedAt: startedAt,
    lastAttemptCompletedAt: null,
    lastAttemptSummary: {},
  });
}

async function queueBatchForReview(
  stores: IngestionStores,
  batch: Pick<NormalizationBatchResult, 'canonicalOrganizationIds' | 'canonicalServiceIds' | 'canonicalLocationIds'>,
): Promise<void> {
  await Promise.all([
    ...Array.from(new Set(batch.canonicalOrganizationIds)).map((id) =>
      stores.canonicalOrganizations.updatePublicationStatus(id, 'pending_review'),
    ),
    ...Array.from(new Set(batch.canonicalServiceIds)).map((id) =>
      stores.canonicalServices.updatePublicationStatus(id, 'pending_review'),
    ),
    ...Array.from(new Set(batch.canonicalLocationIds)).map((id) =>
      stores.canonicalLocations.updatePublicationStatus(id, 'pending_review'),
    ),
  ]);
}

async function applyPublicationMode(
  stores: IngestionStores,
  batch: NormalizationBatchResult,
  state: {
    publicationMode?: unknown;
    autoPublishApprovedAt?: unknown;
    autoPublishApprovedBy?: unknown;
  } | null,
  sourceFeed: { feedHandler?: string | null },
): Promise<PublicationOutcome> {
  const mode = getPublicationMode(state);
  if (batch.canonicalServiceIds.length === 0) {
    return { mode, reviewQueued: 0, published: 0, skipped: 0, reason: 'no_services' };
  }

  if (mode === 'canonical_only') {
    return {
      mode,
      reviewQueued: 0,
      published: 0,
      skipped: batch.canonicalServiceIds.length,
      reason: 'canonical_only',
    };
  }

  if (mode === 'review_required') {
    await queueBatchForReview(stores, batch);
    return {
      mode,
      reviewQueued: batch.canonicalServiceIds.length,
      published: 0,
      skipped: 0,
      reason: 'review_required',
    };
  }

  if (!isEnabled(process.env.SOURCE_FEED_AUTO_PUBLISH_ENABLED)) {
    await queueBatchForReview(stores, batch);
    return {
      mode: 'review_required',
      reviewQueued: batch.canonicalServiceIds.length,
      published: 0,
      skipped: 0,
      reason: 'auto_publish_env_disabled',
    };
  }

  if (!state?.autoPublishApprovedAt || !state?.autoPublishApprovedBy) {
    await queueBatchForReview(stores, batch);
    return {
      mode: 'review_required',
      reviewQueued: batch.canonicalServiceIds.length,
      published: 0,
      skipped: 0,
      reason: 'auto_publish_approval_missing',
    };
  }

  if (sourceFeed.feedHandler === 'ndp_211' && batch.canonicalLocationIds.length === 0) {
    await queueBatchForReview(stores, batch);
    return {
      mode: 'review_required',
      reviewQueued: batch.canonicalServiceIds.length,
      published: 0,
      skipped: 0,
      reason: 'missing_required_locations',
    };
  }

  const { autoPublish } = await import('./autoPublish');
  const autoPublishResult = await autoPublish({
    stores,
    canonicalServiceIds: batch.canonicalServiceIds,
    policy: {
      eligibleTiers: ['verified_publisher', 'trusted_partner', 'curated'],
      trustedPartnerMinConfidence: Number.parseInt(
        process.env.ORAN_TRUSTED_PARTNER_AUTO_PUBLISH_MIN_CONFIDENCE ?? '90',
        10,
      ),
      curatedMinConfidence: Number.parseInt(process.env.ORAN_CURATED_AUTO_PUBLISH_MIN_CONFIDENCE ?? '85', 10),
      allowRepublish: false,
    },
  });

  const skippedIds = new Set(
    autoPublishResult.decisions.filter((decision) => !decision.eligible).map((decision) => decision.canonicalServiceId),
  );
  for (const error of autoPublishResult.errors) {
    skippedIds.add(error.canonicalServiceId);
  }

  await Promise.all(
    Array.from(skippedIds).map((serviceId) =>
      stores.canonicalServices.updatePublicationStatus(serviceId, 'pending_review'),
    ),
  );

  if (autoPublishResult.published === 0 && skippedIds.size > 0) {
    await Promise.all(
      Array.from(new Set(batch.canonicalOrganizationIds)).map((id) =>
        stores.canonicalOrganizations.updatePublicationStatus(id, 'pending_review'),
      ),
    );
    await Promise.all(
      Array.from(new Set(batch.canonicalLocationIds)).map((id) =>
        stores.canonicalLocations.updatePublicationStatus(id, 'pending_review'),
      ),
    );
  }

  const decisionReasons = autoPublishResult.decisions
    .filter((decision) => !decision.eligible)
    .map((decision) => decision.reason)
    .concat(autoPublishResult.errors.map((error) => `error:${error.error}`))
    .reduce<Record<string, number>>((counts, reason) => {
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {});

  return {
    mode,
    reviewQueued: skippedIds.size,
    published: autoPublishResult.published,
    skipped: autoPublishResult.skipped,
    reason: 'auto_publish_policy_filtered',
    decisionReasons: Object.keys(decisionReasons).length > 0 ? decisionReasons : undefined,
  };
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
          const correlationId = `source-feed-poll-${sourceFeed.id}-${Date.now()}`;
          const sourceSystem = await stores.sourceSystems.getById(sourceFeed.sourceSystemId);
          if (!sourceSystem) {
            errors++;
            continue;
          }

          const sourceFeedState = await stores.sourceFeedStates.getByFeedId(sourceFeed.id);
          if (sourceFeedState?.emergencyPause) {
            await appendPollAuditEvent(stores, {
              correlationId,
              eventType: 'feed.poll_completed',
              targetType: 'source_feed',
              targetId: sourceFeed.id,
              outputs: {
                status: 'skipped',
                reason: 'emergency_pause',
              },
            });
            continue;
          }

          const attemptStartedAt = new Date();
          await markFeedStateAttemptRunning(stores, sourceFeed.id, sourceFeedState, attemptStartedAt);

          try {
            const feedHandler = getSupportedSourceFeedHandler(sourceFeed);
            await appendPollAuditEvent(stores, {
              correlationId,
              eventType: 'feed.poll_started',
              targetType: 'source_feed',
              targetId: sourceFeed.id,
              inputs: {
                feedHandler: sourceFeed.feedHandler,
                feedType: sourceFeed.feedType,
                baseUrl: sourceFeed.baseUrl,
                sourceSystemId: sourceFeed.sourceSystemId,
              },
            });

            if (feedHandler === 'ndp_211') {
              const { poll211NdpFeed } = await import('./ndp211Connector');
              const dataOwners = resolveFeedDataOwners(process.env.NDP_211_DATA_OWNERS, sourceFeedState);
              const pollResult = await poll211NdpFeed({
                stores,
                sourceSystem,
                feed: sourceFeed,
                correlationId,
                dataOwners,
                maxOrganizations: sourceFeedState?.maxOrganizationsPerPoll ?? undefined,
              });
              newUrls += pollResult.recordsCreated;
              if (pollResult.errors.length > 0) errors += pollResult.errors.length;
            } else if (feedHandler === 'hsds_api') {
              const { pollHsdsFeed } = await import('./hsdsFeedConnector');
              const pollResult = await pollHsdsFeed({
                stores,
                sourceSystem,
                feed: sourceFeed,
                correlationId,
              });
              newUrls += pollResult.recordsCreated;
              if (pollResult.errors.length > 0) errors += pollResult.errors.length;
            } else {
              continue;
            }

            const normalizationResult = await normalizePendingSourceRecordsForFeed(
              stores,
              sourceFeed.id,
              correlationId,
            );
            errors += normalizationResult.errors;
            const publicationResult = await applyPublicationMode(
              stores,
              normalizationResult,
              sourceFeedState,
              sourceFeed,
            );
            sourceAssertionFeeds++;
            await stores.sourceFeedStates.update(sourceFeed.id, {
              replayFromCursor: null,
              lastAttemptStatus: 'succeeded',
              lastAttemptCompletedAt: new Date(),
              lastSuccessfulSyncStartedAt: attemptStartedAt,
              lastSuccessfulSyncCompletedAt: new Date(),
              lastAttemptSummary: {
                normalized: normalizationResult.normalized,
                normalizationErrors: normalizationResult.errors,
                publicationMode: publicationResult.mode,
                publicationReason: publicationResult.reason,
                reviewQueued: publicationResult.reviewQueued,
                published: publicationResult.published,
                skipped: publicationResult.skipped,
                decisionReasons: publicationResult.decisionReasons,
                feedHandler,
              },
            });
            await appendPollAuditEvent(stores, {
              correlationId,
              eventType: 'feed.poll_completed',
              targetType: 'source_feed',
              targetId: sourceFeed.id,
              outputs: {
                normalized: normalizationResult.normalized,
                normalizationErrors: normalizationResult.errors,
                publicationMode: publicationResult.mode,
                publicationReason: publicationResult.reason,
                reviewQueued: publicationResult.reviewQueued,
                published: publicationResult.published,
                skipped: publicationResult.skipped,
                decisionReasons: publicationResult.decisionReasons,
                feedHandler,
              },
            });
          } catch (error) {
            errors++;
            await stores.sourceFeedStates.update(sourceFeed.id, {
              lastAttemptStatus: 'failed',
              lastAttemptCompletedAt: new Date(),
              lastAttemptSummary: {
                error: error instanceof Error ? error.message : 'Feed poll failed',
              },
            });
            await appendPollAuditEvent(stores, {
              correlationId,
              eventType: 'feed.poll_completed',
              targetType: 'source_feed',
              targetId: sourceFeed.id,
              outputs: {
                status: 'failed',
                error: error instanceof Error ? error.message : 'Feed poll failed',
              },
            });
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
