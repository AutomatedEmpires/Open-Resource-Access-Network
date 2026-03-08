import { z } from 'zod';

import { SourceTrustLevelSchema, type SourceTrustLevel } from '../sourceRegistry';

/**
 * Pipeline stage identifiers in execution order.
 */
export const PipelineStageSchema = z.enum([
  'source_check',
  'fetch',
  'extract_text',
  'discover_links',
  'llm_extract',
  'llm_categorize',
  'verify',
  'score',
  'build_candidate',
]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

/**
 * Status of a pipeline stage execution.
 */
export const StageStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
]);
export type StageStatus = z.infer<typeof StageStatusSchema>;

/**
 * Result of a single pipeline stage.
 */
export const StageResultSchema = z
  .object({
    stage: PipelineStageSchema,
    status: StageStatusSchema,
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    durationMs: z.number().int().min(0).optional(),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .optional(),
    metrics: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  })
  .strict();
export type StageResult = z.infer<typeof StageResultSchema>;

/**
 * Input to the pipeline - a URL to process.
 */
export const PipelineInputSchema = z
  .object({
    /** The URL to process */
    sourceUrl: z.string().url(),
    /** Optional correlation ID for tracing */
    correlationId: z.string().min(1).optional(),
    /** Whether to force re-processing even if previously processed */
    forceReprocess: z.boolean().default(false),
    /** Maximum stages to execute (for testing/debugging) */
    maxStages: z.number().int().min(1).max(9).optional(),
  })
  .strict();
export type PipelineInput = z.infer<typeof PipelineInputSchema>;

/**
 * Source check result - whether URL is allowed and trust level.
 */
export const SourceCheckResultSchema = z
  .object({
    allowed: z.boolean(),
    trustLevel: SourceTrustLevelSchema,
    sourceId: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();
export type SourceCheckResult = z.infer<typeof SourceCheckResultSchema>;

/**
 * Complete pipeline execution result.
 */
export const PipelineResultSchema = z
  .object({
    /** Input URL that was processed */
    sourceUrl: z.string().url(),
    /** Canonical URL after redirects */
    canonicalUrl: z.string().url().optional(),
    /** Correlation ID for tracing */
    correlationId: z.string().min(1),
    /** Overall pipeline status */
    status: z.enum(['completed', 'failed', 'partial']),
    /** When pipeline started */
    startedAt: z.string().datetime(),
    /** When pipeline completed */
    completedAt: z.string().datetime(),
    /** Total duration in milliseconds */
    totalDurationMs: z.number().int().min(0),
    /** Results from each stage */
    stages: z.array(StageResultSchema),
    /** Final stage reached */
    finalStage: PipelineStageSchema,
    /** Source registry check result */
    sourceCheck: SourceCheckResultSchema.optional(),
    /** Evidence snapshot if fetch succeeded */
    evidenceId: z.string().min(1).optional(),
    /** Extraction ID if extraction succeeded */
    extractionId: z.string().min(1).optional(),
    /** Candidate ID if candidate was created */
    candidateId: z.string().min(1).optional(),
    /** Overall confidence score if scoring completed */
    confidenceScore: z.number().int().min(0).max(100).optional(),
    /** Confidence tier if scoring completed */
    confidenceTier: z.enum(['green', 'yellow', 'orange', 'red']).optional(),
  })
  .strict();
export type PipelineResult = z.infer<typeof PipelineResultSchema>;

export interface PipelineEvidenceArtifact {
  evidenceId: string;
  canonicalUrl: string;
  fetchedAt: string;
  httpStatus: number;
  contentHashSha256: string;
  contentType?: string;
  contentLength: number;
  htmlRaw: string;
  textExtracted?: string;
  title?: string;
  metaDescription?: string;
  language?: string;
}

export interface PipelineDiscoveredLinkArtifact {
  url: string;
  type: 'home' | 'contact' | 'apply' | 'eligibility' | 'intake_form' | 'hours' | 'pdf' | 'privacy' | 'other';
  label?: string;
  confidence: number;
  evidenceId: string;
}

export interface PipelineCandidateTagArtifact {
  tagType: 'category';
  tagValue: string;
  confidence: number;
}

export interface PipelineVerificationCheckArtifact {
  checkType: 'domain_allowlist' | 'contact_validity' | 'cross_source_agreement' | 'hours_stability' | 'location_plausibility' | 'policy_constraints';
  severity: 'critical' | 'warning' | 'info';
  status: 'pass' | 'fail' | 'unknown';
  ranAt: string;
  details: Record<string, unknown>;
  evidenceRefs: string[];
  extractionId: string;
}

export interface PipelineCandidateArtifact {
  candidateId: string;
  extractionId: string;
  extractKeySha256: string;
  extractedAt: string;
  organizationName: string;
  serviceName: string;
  description: string;
  websiteUrl?: string;
  phone?: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  };
  isRemoteService: boolean;
  fieldConfidences: Record<string, number>;
  categoryTags: PipelineCandidateTagArtifact[];
  discoveredLinks: PipelineDiscoveredLinkArtifact[];
  verificationChecks: PipelineVerificationCheckArtifact[];
  verificationChecklist: import('../checklist').VerificationChecklist;
  score: {
    overall: number;
    tier: 'green' | 'yellow' | 'orange' | 'red';
    subScores: {
      verification: number;
      completeness: number;
      freshness: number;
    };
  };
  sourceTrustLevel?: SourceTrustLevel;
}

export interface PipelineArtifacts {
  evidence?: PipelineEvidenceArtifact;
  candidate?: PipelineCandidateArtifact;
}

export interface DetailedPipelineExecution {
  result: PipelineResult;
  artifacts: PipelineArtifacts;
}

/**
 * Configuration options for the pipeline.
 */
export const PipelineConfigSchema = z
  .object({
    /** Whether to use LLM for extraction (requires LLM_ENDPOINT) */
    enableLlmExtraction: z.boolean().default(true),
    /** Whether to run verification checks */
    enableVerification: z.boolean().default(true),
    /** Whether to store evidence in blob storage */
    storeEvidenceBlobs: z.boolean().default(false),
    /** Timeout for fetch stage in milliseconds */
    fetchTimeoutMs: z.number().int().min(1000).max(120000).default(30000),
    /** Timeout for LLM calls in milliseconds */
    llmTimeoutMs: z.number().int().min(5000).max(300000).default(60000),
    /** Stop pipeline on first failure */
    stopOnFailure: z.boolean().default(true),
  })
  .strict();
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

/**
 * Context passed between pipeline stages.
 * Accumulates data as stages execute.
 */
export interface PipelineContext {
  /** Pipeline input */
  input: PipelineInput;
  /** Pipeline configuration */
  config: PipelineConfig;
  /** Correlation ID for tracing */
  correlationId: string;
  /** When pipeline started */
  startedAt: Date;
  /** Results from completed stages */
  stageResults: StageResult[];

  /**
   * Optional fetcher override.
   * When provided, FetchStage uses this instead of creating a default PageFetcher.
   * This allows tests to inject a mock HTTP client.
   */
  fetcher?: import('../fetcher').Fetcher;

  // Data accumulated by stages
  sourceCheck?: SourceCheckResult;
  fetchResult?: {
    canonicalUrl: string;
    httpStatus: number;
    contentType?: string;
    contentHashSha256: string;
    body: string;
    contentLength: number;
    fetchedAt: string;
  };
  evidenceSnapshot?: {
    evidenceId: string;
    canonicalUrl: string;
    fetchedAt: string;
    httpStatus: number;
    contentHashSha256: string;
  };
  textExtraction?: {
    text: string;
    title?: string;
    metaDescription?: string;
    language?: string;
    wordCount: number;
  };
  discoveredLinks?: Array<{
    url: string;
    type: string;
    label?: string;
    confidence: number;
  }>;
  llmExtraction?: {
    organizationName: string;
    serviceName: string;
    description: string;
    websiteUrl?: string;
    phone?: string;
    address?: {
      line1: string;
      line2?: string;
      city: string;
      region: string;
      postalCode: string;
      country: string;
    };
    confidence: number;
    fieldConfidences: Record<string, number>;
  };
  llmCategorization?: {
    categories: string[];
    categoryConfidences: Record<string, number>;
  };
  verificationResults?: Array<{
    checkType: string;
    status: 'pass' | 'fail' | 'unknown';
    severity: 'critical' | 'warning' | 'info';
  }>;
  candidateScore?: {
    overall: number;
    tier: 'green' | 'yellow' | 'orange' | 'red';
    subScores: {
      verification: number;
      completeness: number;
      freshness: number;
    };
  };
  /** Verification checklist populated by ScoreStage from pipeline data */
  verificationChecklist?: import('../checklist').VerificationChecklist;
  candidateId?: string;
  extractionId?: string;
}

/**
 * Interface for a single pipeline stage.
 */
export interface PipelineStageHandler {
  /** Stage identifier */
  stage: PipelineStage;
  /** Execute the stage */
  execute(context: PipelineContext): Promise<StageResult>;
  /** Check if stage should be skipped */
  shouldSkip?(context: PipelineContext): boolean;
}

/**
 * Event types emitted by the pipeline.
 */
export type PipelineEvent =
  | { type: 'pipeline_started'; correlationId: string; sourceUrl: string }
  | { type: 'stage_started'; correlationId: string; stage: PipelineStage }
  | { type: 'stage_completed'; correlationId: string; stage: PipelineStage; durationMs: number }
  | { type: 'stage_failed'; correlationId: string; stage: PipelineStage; error: string }
  | { type: 'stage_skipped'; correlationId: string; stage: PipelineStage; reason: string }
  | { type: 'pipeline_completed'; correlationId: string; status: 'completed' | 'failed' | 'partial' };

/**
 * Listener for pipeline events.
 */
export type PipelineEventListener = (event: PipelineEvent) => void;
