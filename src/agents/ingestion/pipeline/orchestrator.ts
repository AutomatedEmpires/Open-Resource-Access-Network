import type { SourceRegistryEntry } from '../sourceRegistry';
import { buildBootstrapRegistry } from '../sourceRegistry';
import { computeExtractKeySha256 } from '../fetcher';

import type {
  PipelineConfig,
  PipelineContext,
  PipelineEvent,
  PipelineEventListener,
  PipelineInput,
  PipelineResult,
  PipelineArtifacts,
  DetailedPipelineExecution,
  PipelineStageHandler,
  PipelineStage,
  StageResult,
  PipelineVerificationCheckArtifact,
} from './types';
import { PipelineConfigSchema } from './types';
import { createPipelineStages } from './stages';

/**
 * Default pipeline configuration.
 */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = PipelineConfigSchema.parse({});

/**
 * Pipeline event handler type.
 */
export type PipelineEventHandler = PipelineEventListener;

/**
 * Interface for persisting pipeline results.
 * Implement with a Drizzle/DB store for durable execution records.
 */
export interface PipelineResultStore {
  /** Save a completed pipeline result (insert-or-upsert by correlationId). */
  saveResult(result: PipelineResult): Promise<void>;
}

/**
 * Options for pipeline orchestrator.
 */
export interface PipelineOrchestratorOptions {
  config?: Partial<PipelineConfig>;
  registry?: SourceRegistryEntry[];
  onEvent?: PipelineEventHandler;
  /** Optional persistent store for pipeline results. */
  resultStore?: PipelineResultStore;
}

/**
 * Creates a new pipeline context for a given input.
 */
function createPipelineContext(
  input: PipelineInput,
  config: PipelineConfig
): PipelineContext {
  return {
    input,
    config,
    correlationId: input.correlationId ?? crypto.randomUUID(),
    stageResults: [],
    startedAt: new Date(),
  };
}

/**
 * Pipeline orchestrator that runs all stages in sequence.
 */
export class PipelineOrchestrator {
  private readonly config: PipelineConfig;
  private readonly stages: PipelineStageHandler[];
  private readonly onEvent?: PipelineEventHandler;
  private readonly resultStore?: PipelineResultStore;

  constructor(options: PipelineOrchestratorOptions = {}) {
    this.config = PipelineConfigSchema.parse({ ...DEFAULT_PIPELINE_CONFIG, ...options.config });
    const registry = options.registry ?? buildBootstrapRegistry();
    this.stages = createPipelineStages(registry);
    this.onEvent = options.onEvent;
    this.resultStore = options.resultStore;
  }

  /**
   * Emit a pipeline event.
   */
  private emit(event: PipelineEvent): void {
    if (this.onEvent) {
      try {
        this.onEvent(event);
      } catch {
        // Event handlers should not throw, but if they do, continue
      }
    }
  }

  /**
   * Run a single stage.
   */
  private async runStage(
    stage: PipelineStageHandler,
    context: PipelineContext
  ): Promise<StageResult> {
    this.emit({
      type: 'stage_started',
      correlationId: context.correlationId,
      stage: stage.stage,
    });

    const result = await stage.execute(context);

    if (result.status === 'failed') {
      this.emit({
        type: 'stage_failed',
        correlationId: context.correlationId,
        stage: stage.stage,
        error: result.error?.message ?? 'Unknown error',
      });
    } else if (result.status === 'skipped') {
      this.emit({
        type: 'stage_skipped',
        correlationId: context.correlationId,
        stage: stage.stage,
        reason: (result.metrics?.reason as string) ?? 'unknown',
      });
    } else {
      this.emit({
        type: 'stage_completed',
        correlationId: context.correlationId,
        stage: stage.stage,
        durationMs: result.durationMs ?? 0,
      });
    }

    return result;
  }

  private buildArtifacts(context: PipelineContext): PipelineArtifacts {
    const evidence =
      context.evidenceSnapshot && context.fetchResult
        ? {
            evidenceId: context.evidenceSnapshot.evidenceId,
            canonicalUrl: context.evidenceSnapshot.canonicalUrl,
            fetchedAt: context.evidenceSnapshot.fetchedAt,
            httpStatus: context.evidenceSnapshot.httpStatus,
            contentHashSha256: context.evidenceSnapshot.contentHashSha256,
            contentType: context.fetchResult.contentType,
            contentLength: context.fetchResult.contentLength,
            htmlRaw: context.fetchResult.body,
            textExtracted: context.textExtraction?.text,
            title: context.textExtraction?.title,
            metaDescription: context.textExtraction?.metaDescription,
            language: context.textExtraction?.language,
          }
        : undefined;

    const candidate =
      context.candidateId &&
      context.extractionId &&
      context.llmExtraction &&
      context.fetchResult &&
      context.candidateScore &&
      context.verificationChecklist
        ? {
            candidateId: context.candidateId,
            extractionId: context.extractionId,
            extractKeySha256: computeExtractKeySha256(
              context.fetchResult.canonicalUrl,
              context.fetchResult.contentHashSha256,
            ),
            extractedAt: new Date().toISOString(),
            organizationName: context.llmExtraction.organizationName,
            serviceName: context.llmExtraction.serviceName,
            description: context.llmExtraction.description,
            websiteUrl: context.llmExtraction.websiteUrl,
            phone: context.llmExtraction.phone,
            address: context.llmExtraction.address,
            isRemoteService: false,
            fieldConfidences: { ...context.llmExtraction.fieldConfidences },
            categoryTags: (context.llmCategorization?.categories ?? []).map((tagValue) => ({
              tagType: 'category' as const,
              tagValue,
              confidence: context.llmCategorization?.categoryConfidences[tagValue] ?? 50,
            })),
            discoveredLinks: (context.discoveredLinks ?? []).map((link) => ({
              url: link.url,
              type: link.type as 'home' | 'contact' | 'apply' | 'eligibility' | 'intake_form' | 'hours' | 'pdf' | 'privacy' | 'other',
              label: link.label,
              confidence: link.confidence,
              evidenceId: context.evidenceSnapshot?.evidenceId ?? '',
            })),
            verificationChecks: (context.verificationResults ?? []).map((check) => ({
              checkType: check.checkType as PipelineVerificationCheckArtifact['checkType'],
              severity: check.severity,
              status: check.status,
              ranAt: new Date().toISOString(),
              details: {},
              evidenceRefs: context.evidenceSnapshot ? [context.evidenceSnapshot.evidenceId] : [],
              extractionId: context.extractionId!,
            })),
            verificationChecklist: context.verificationChecklist,
            score: context.candidateScore,
            sourceTrustLevel: context.sourceCheck?.trustLevel,
          }
        : undefined;

    return {
      evidence,
      candidate,
    };
  }

  private async processInternal(input: PipelineInput): Promise<DetailedPipelineExecution> {
    const context = createPipelineContext(input, this.config);
    let finalStage: PipelineStage = 'source_check';

    this.emit({
      type: 'pipeline_started',
      correlationId: context.correlationId,
      sourceUrl: input.sourceUrl,
    });

    // Determine how many stages to run
    const maxStages = input.maxStages ?? this.stages.length;
    const stagesToRun = this.stages.slice(0, maxStages);

    for (const stage of stagesToRun) {
      // Check if stage's shouldSkip returns true
      if (stage.shouldSkip?.(context)) {
        context.stageResults.push({
          stage: stage.stage,
          status: 'skipped',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          metrics: { reason: 'already_complete' },
        });
        finalStage = stage.stage;
        continue;
      }

      const result = await this.runStage(stage, context);
      context.stageResults.push(result);
      finalStage = stage.stage;

      // Stop pipeline on failure if stopOnFailure is true
      if (result.status === 'failed' && this.config.stopOnFailure) {
        break;
      }

      // Critical failures always stop the pipeline
      if (result.status === 'failed') {
        if (stage.stage === 'source_check' || stage.stage === 'fetch') {
          break;
        }
      }
    }

    // Build final result
    const completedAt = new Date();
    const totalDurationMs = completedAt.getTime() - context.startedAt.getTime();

    // Determine overall status
    const failedStages = context.stageResults.filter(
      (r) => r.status === 'failed'
    );
    const criticalFailures = failedStages.filter(
      (r) => r.stage === 'source_check' || r.stage === 'fetch'
    );

    let status: 'completed' | 'partial' | 'failed';
    if (criticalFailures.length > 0) {
      status = 'failed';
    } else if (failedStages.length > 0) {
      status = 'partial';
    } else {
      status = 'completed';
    }

    const result: PipelineResult = {
      sourceUrl: input.sourceUrl,
      canonicalUrl: context.fetchResult?.canonicalUrl,
      correlationId: context.correlationId,
      status,
      startedAt: context.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      totalDurationMs,
      stages: context.stageResults,
      finalStage,
      sourceCheck: context.sourceCheck,
      evidenceId: context.evidenceSnapshot?.evidenceId,
      extractionId: context.extractionId,
      candidateId: context.candidateId,
      confidenceScore: context.candidateScore?.overall,
      confidenceTier: context.candidateScore?.tier,
    };
    const artifacts = this.buildArtifacts(context);

    this.emit({
      type: 'pipeline_completed',
      correlationId: context.correlationId,
      status,
    });

    // Persist result if a store is configured
    if (this.resultStore) {
      try {
        await this.resultStore.saveResult(result);
      } catch {
        // Persistence failure is non-fatal — result is still returned to caller.
        // Emit an event so monitoring can detect the issue.
        this.emit({
          type: 'stage_failed',
          correlationId: context.correlationId,
          stage: 'score',
          error: 'Failed to persist pipeline result',
        });
      }
    }

    return { result, artifacts };
  }

  /**
   * Process a single URL through the pipeline.
   */
  async processUrl(input: PipelineInput): Promise<PipelineResult> {
    const { result } = await this.processInternal(input);
    return result;
  }

  /**
   * Process a single URL and return both the public result and the
   * materialized artifacts needed for durable persistence.
   */
  async processUrlDetailed(input: PipelineInput): Promise<DetailedPipelineExecution> {
    return this.processInternal(input);
  }

  /**
   * Process multiple URLs in batch.
   */
  async processBatch(
    inputs: PipelineInput[],
    options?: { maxConcurrent?: number; maxUrls?: number }
  ): Promise<PipelineResult[]> {
    const maxConcurrent = options?.maxConcurrent ?? 1;
    const maxUrls = options?.maxUrls ?? 100;
    const results: PipelineResult[] = [];

    // Limit to config maximum
    const limitedInputs = inputs.slice(0, maxUrls);

    if (maxConcurrent <= 1) {
      // Sequential processing
      for (const input of limitedInputs) {
        const result = await this.processUrl(input);
        results.push(result);
      }
    } else {
      // Concurrent processing with limit
      const chunks: PipelineInput[][] = [];
      for (let i = 0; i < limitedInputs.length; i += maxConcurrent) {
        chunks.push(limitedInputs.slice(i, i + maxConcurrent));
      }

      for (const chunk of chunks) {
        const chunkResults = await Promise.all(
          chunk.map((input) => this.processUrl(input))
        );
        results.push(...chunkResults);
      }
    }

    return results;
  }

  /**
   * Get current pipeline configuration.
   */
  getConfig(): Readonly<PipelineConfig> {
    return { ...this.config };
  }
}

/**
 * Create a pipeline orchestrator with default settings.
 */
export function createPipelineOrchestrator(
  options?: PipelineOrchestratorOptions
): PipelineOrchestrator {
  return new PipelineOrchestrator(options);
}
