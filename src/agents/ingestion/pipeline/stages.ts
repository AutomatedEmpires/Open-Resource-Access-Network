import crypto from 'node:crypto';

import type { SourceRegistryEntry } from '../sourceRegistry';
import { matchSourceForUrl } from '../sourceRegistry';
import {
  createPageFetcher,
  isFetchError,
  createHtmlTextExtractor,
  createLinkDiscovery,
  createEvidenceBuilder,
  computeExtractKeySha256,
} from '../fetcher';

import type { LLMClient } from '../llm';
import { createLLMClient, getLLMConfigFromEnv } from '../llm';

import '../llm/providers';

import type {
  PipelineContext,
  PipelineStageHandler,
  StageResult,
  SourceCheckResult,
} from './types';

/**
 * Helper to create a stage result.
 */
function createStageResult(
  stage: string,
  status: 'completed' | 'failed' | 'skipped',
  startTime: Date,
  error?: { code: string; message: string; retryable: boolean },
  metrics?: Record<string, number | string | boolean>
): StageResult {
  const now = new Date();
  return {
    stage: stage as StageResult['stage'],
    status,
    startedAt: startTime.toISOString(),
    completedAt: now.toISOString(),
    durationMs: now.getTime() - startTime.getTime(),
    error,
    metrics: metrics ?? {},
  };
}

// ============================================================================
// Stage 1: Source Check
// ============================================================================

/**
 * Checks if the source URL is allowed by the source registry.
 */
export class SourceCheckStage implements PipelineStageHandler {
  readonly stage = 'source_check' as const;

  constructor(private readonly registry: SourceRegistryEntry[]) {}

  async execute(context: PipelineContext): Promise<StageResult> {
    const startTime = new Date();

    try {
      const result = matchSourceForUrl(context.input.sourceUrl, this.registry);

      const sourceCheck: SourceCheckResult = {
        allowed: result.allowed,
        trustLevel: result.trustLevel,
        sourceId: result.allowed ? result.sourceId : (result as { sourceId?: string }).sourceId,
        reason: !result.allowed ? (result as { reason: string }).reason : undefined,
      };

      context.sourceCheck = sourceCheck;

      if (!sourceCheck.allowed) {
        return createStageResult(
          this.stage,
          'failed',
          startTime,
          {
            code: 'source_not_allowed',
            message: `Source not allowed: ${sourceCheck.reason}`,
            retryable: false,
          },
          { trustLevel: sourceCheck.trustLevel }
        );
      }

      return createStageResult(this.stage, 'completed', startTime, undefined, {
        trustLevel: sourceCheck.trustLevel,
        sourceId: sourceCheck.sourceId ?? 'unknown',
      });
    } catch (err) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'source_check_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      });
    }
  }
}

// ============================================================================
// Stage 2: Fetch
// ============================================================================

/**
 * Fetches the URL content and creates evidence snapshot.
 */
export class FetchStage implements PipelineStageHandler {
  readonly stage = 'fetch' as const;

  async execute(context: PipelineContext): Promise<StageResult> {
    const startTime = new Date();

    try {
      const fetcher = createPageFetcher({
        timeoutMs: context.config.fetchTimeoutMs,
      });

      const result = await fetcher.fetch(context.input.sourceUrl);

      if (isFetchError(result)) {
        return createStageResult(this.stage, 'failed', startTime, {
          code: result.code,
          message: result.message,
          retryable: result.retryable,
        });
      }

      // Store fetch result in context
      context.fetchResult = {
        canonicalUrl: result.canonicalUrl,
        httpStatus: result.httpStatus,
        contentType: result.contentType,
        contentHashSha256: result.contentHashSha256,
        body: result.body,
        contentLength: result.contentLength,
        fetchedAt: result.fetchedAt,
      };

      // Build evidence snapshot
      const evidenceBuilder = createEvidenceBuilder();
      const snapshot = evidenceBuilder.buildFromFetchResult(result);

      context.evidenceSnapshot = {
        evidenceId: snapshot.evidenceId,
        canonicalUrl: snapshot.canonicalUrl,
        fetchedAt: snapshot.fetchedAt,
        httpStatus: snapshot.httpStatus,
        contentHashSha256: snapshot.contentHashSha256,
      };

      return createStageResult(this.stage, 'completed', startTime, undefined, {
        httpStatus: result.httpStatus,
        contentLength: result.contentLength,
        redirectCount: result.redirectChain.length,
        contentType: result.contentType ?? 'unknown',
      });
    } catch (err) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'fetch_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      });
    }
  }

  shouldSkip(context: PipelineContext): boolean {
    // Skip if source check already exists and body is cached
    return !!context.fetchResult;
  }
}

// ============================================================================
// Stage 3: Extract Text
// ============================================================================

/**
 * Extracts readable text from HTML content.
 */
export class ExtractTextStage implements PipelineStageHandler {
  readonly stage = 'extract_text' as const;

  async execute(context: PipelineContext): Promise<StageResult> {
    const startTime = new Date();

    if (!context.fetchResult) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'missing_fetch_result',
        message: 'Fetch stage must complete before text extraction',
        retryable: false,
      });
    }

    try {
      const extractor = createHtmlTextExtractor();
      const result = extractor.extract(context.fetchResult.body);

      context.textExtraction = {
        text: result.text,
        title: result.title,
        metaDescription: result.metaDescription,
        language: result.language,
        wordCount: result.wordCount,
      };

      return createStageResult(this.stage, 'completed', startTime, undefined, {
        wordCount: result.wordCount,
        hasTitle: !!result.title,
        hasDescription: !!result.metaDescription,
        language: result.language ?? 'unknown',
        usedMainContent: result.usedMainContentSelector,
      });
    } catch (err) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'extract_text_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      });
    }
  }

  shouldSkip(context: PipelineContext): boolean {
    return !!context.textExtraction;
  }
}

// ============================================================================
// Stage 4: Discover Links
// ============================================================================

/**
 * Discovers and classifies relevant links in the HTML.
 */
export class DiscoverLinksStage implements PipelineStageHandler {
  readonly stage = 'discover_links' as const;

  async execute(context: PipelineContext): Promise<StageResult> {
    const startTime = new Date();

    if (!context.fetchResult) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'missing_fetch_result',
        message: 'Fetch stage must complete before link discovery',
        retryable: false,
      });
    }

    try {
      const discovery = createLinkDiscovery();
      const links = discovery.discover(
        context.fetchResult.body,
        context.fetchResult.canonicalUrl
      );

      context.discoveredLinks = links.map((l) => ({
        url: l.url,
        type: l.type,
        label: l.label,
        confidence: l.confidence,
      }));

      // Count link types
      const typeCounts: Record<string, number> = {};
      for (const link of links) {
        typeCounts[link.type] = (typeCounts[link.type] ?? 0) + 1;
      }

      return createStageResult(this.stage, 'completed', startTime, undefined, {
        totalLinks: links.length,
        contactLinks: typeCounts['contact'] ?? 0,
        applyLinks: typeCounts['apply'] ?? 0,
        eligibilityLinks: typeCounts['eligibility'] ?? 0,
        pdfLinks: typeCounts['pdf'] ?? 0,
      });
    } catch (err) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'discover_links_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      });
    }
  }

  shouldSkip(context: PipelineContext): boolean {
    return !!context.discoveredLinks;
  }
}

// ============================================================================
// Stage 5: LLM Extract
// ============================================================================

/**
 * Uses LLM to extract structured service data from text.
 */
export class LlmExtractStage implements PipelineStageHandler {
  readonly stage = 'llm_extract' as const;

  private client?: LLMClient;
  private clientPromise?: Promise<LLMClient>;

  constructor(options?: { llmClient?: LLMClient }) {
    this.client = options?.llmClient;
  }

  private async getClient(timeoutMs: number): Promise<LLMClient> {
    if (this.client) return this.client;
    if (this.clientPromise) return this.clientPromise;

    const config = getLLMConfigFromEnv();
    if (!config.endpoint || !config.apiKey) {
      throw new Error('LLM not configured. Set LLM_ENDPOINT and LLM_API_KEY.');
    }

    this.clientPromise = createLLMClient({
      ...config,
      timeoutMs,
    });

    this.client = await this.clientPromise;
    return this.client;
  }

  async execute(context: PipelineContext): Promise<StageResult> {
    const startTime = new Date();

    if (!context.textExtraction) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'missing_text_extraction',
        message: 'Text extraction must complete before LLM extraction',
        retryable: false,
      });
    }

    // Check if LLM is enabled and configured
    if (!context.config.enableLlmExtraction) {
      return createStageResult(this.stage, 'skipped', startTime, undefined, {
        reason: 'llm_disabled',
      });
    }

    try {
      const client = await this.getClient(context.config.llmTimeoutMs);

      const result = await client.extract({
        content: context.textExtraction.text,
        sourceUrl: context.fetchResult?.canonicalUrl ?? context.input.sourceUrl,
        pageTitle: context.textExtraction.title,
        sourceQuality:
          context.sourceCheck?.trustLevel === 'allowlisted'
            ? 'official'
            : context.sourceCheck?.trustLevel === 'quarantine'
              ? 'quarantine'
              : 'vetted',
      });

      if (!result.success) {
        return createStageResult(this.stage, 'failed', startTime, {
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable,
        });
      }

      const service = result.data.services[0];
      const conf = result.data.confidences[0];
      if (!service) {
        return createStageResult(this.stage, 'failed', startTime, {
          code: 'invalid_response',
          message: 'LLM extraction returned no services',
          retryable: false,
        });
      }

      const fieldConfidences: Record<string, number> = {};
      if (conf) {
        for (const [key, value] of Object.entries(conf)) {
          const maybe = value as unknown as { confidence?: number };
          if (typeof maybe?.confidence === 'number') {
            fieldConfidences[key] = maybe.confidence;
          }
        }
      }

      const confidenceValues = Object.values(fieldConfidences).filter((v) => Number.isFinite(v));
      const overallConfidence =
        confidenceValues.length > 0
          ? Math.max(0, Math.min(100, Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)))
          : 50;

      context.llmExtraction = {
        organizationName: service.organizationName,
        serviceName: service.serviceName,
        description: service.description,
        websiteUrl: service.websiteUrl ?? context.fetchResult?.canonicalUrl,
        phone: service.phones?.[0]?.number,
        address: service.address
          ? {
              line1: service.address.line1,
              line2: service.address.line2,
              city: service.address.city,
              region: service.address.region,
              postalCode: service.address.postalCode,
              country: service.address.country,
            }
          : undefined,
        confidence: overallConfidence,
        fieldConfidences,
      };

      return createStageResult(this.stage, 'completed', startTime, undefined, {
        method: 'llm',
        provider: client.provider,
        model: client.model,
        confidence: overallConfidence,
        servicesExtracted: result.data.services.length,
      });
    } catch (err) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: err instanceof Error && err.message.includes('LLM not configured') ? 'llm_not_configured' : 'llm_extract_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      });
    }
  }

  shouldSkip(context: PipelineContext): boolean {
    return !!context.llmExtraction;
  }
}

// ============================================================================
// Stage 6: LLM Categorize
// ============================================================================

/**
 * Uses LLM to categorize the service.
 */
export class LlmCategorizeStage implements PipelineStageHandler {
  readonly stage = 'llm_categorize' as const;

  private client?: LLMClient;
  private clientPromise?: Promise<LLMClient>;

  constructor(options?: { llmClient?: LLMClient }) {
    this.client = options?.llmClient;
  }

  private async getClient(timeoutMs: number): Promise<LLMClient> {
    if (this.client) return this.client;
    if (this.clientPromise) return this.clientPromise;

    const config = getLLMConfigFromEnv();
    if (!config.endpoint || !config.apiKey) {
      throw new Error('LLM not configured. Set LLM_ENDPOINT and LLM_API_KEY.');
    }

    this.clientPromise = createLLMClient({
      ...config,
      timeoutMs,
    });

    this.client = await this.clientPromise;
    return this.client;
  }

  async execute(context: PipelineContext): Promise<StageResult> {
    const startTime = new Date();

    if (!context.llmExtraction) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'missing_llm_extraction',
        message: 'LLM extraction must complete before categorization',
        retryable: false,
      });
    }

    if (!context.config.enableLlmExtraction) {
      return createStageResult(this.stage, 'skipped', startTime, undefined, {
        reason: 'llm_disabled',
      });
    }

    try {
      const client = await this.getClient(context.config.llmTimeoutMs);

      const service = {
        organizationName: context.llmExtraction.organizationName,
        serviceName: context.llmExtraction.serviceName,
        description: context.llmExtraction.description,
        websiteUrl: context.llmExtraction.websiteUrl,
        phones: context.llmExtraction.phone ? [{ number: context.llmExtraction.phone, type: 'voice' as const }] : [],
        hours: [],
        languages: [],
        isRemoteService: false,
        address: context.llmExtraction.address,
      };

      const result = await client.categorize({ service });
      if (!result.success) {
        return createStageResult(this.stage, 'failed', startTime, {
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable,
        });
      }

      const categoryConfidences: Record<string, number> = {};
      for (const tag of result.data.tags ?? []) {
        categoryConfidences[tag.tag] = tag.confidence;
      }

      context.llmCategorization = {
        categories: (result.data.tags ?? []).map((t) => t.tag),
        categoryConfidences,
      };

      return createStageResult(this.stage, 'completed', startTime, undefined, {
        method: 'llm',
        provider: client.provider,
        model: client.model,
        categoryCount: result.data.tags?.length ?? 0,
        primaryCategory: result.data.primaryCategory ?? 'unknown',
      });
    } catch (err) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: err instanceof Error && err.message.includes('LLM not configured') ? 'llm_not_configured' : 'llm_categorize_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      });
    }
  }

  shouldSkip(context: PipelineContext): boolean {
    return !!context.llmCategorization;
  }
}

// ============================================================================
// Stage 7: Verify
// ============================================================================

/**
 * Runs verification checks on the extracted data.
 */
export class VerifyStage implements PipelineStageHandler {
  readonly stage = 'verify' as const;

  async execute(context: PipelineContext): Promise<StageResult> {
    const startTime = new Date();

    if (!context.llmExtraction) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'missing_extraction',
        message: 'Extraction must complete before verification',
        retryable: false,
      });
    }

    if (!context.config.enableVerification) {
      return createStageResult(this.stage, 'skipped', startTime, undefined, {
        reason: 'verification_disabled',
      });
    }

    try {
      const results: Array<{
        checkType: string;
        status: 'pass' | 'fail' | 'unknown';
        severity: 'critical' | 'warning' | 'info';
      }> = [];

      // Check 1: Domain allowlist
      if (context.sourceCheck?.trustLevel === 'allowlisted') {
        results.push({
          checkType: 'domain_allowlist',
          status: 'pass',
          severity: 'info',
        });
      } else {
        results.push({
          checkType: 'domain_allowlist',
          status: context.sourceCheck?.trustLevel === 'quarantine' ? 'unknown' : 'fail',
          severity: 'warning',
        });
      }

      // Check 2: Contact validity (basic check - has website or phone)
      const hasContact = !!(context.llmExtraction.websiteUrl || context.llmExtraction.phone);
      results.push({
        checkType: 'contact_validity',
        status: hasContact ? 'pass' : 'unknown',
        severity: hasContact ? 'info' : 'warning',
      });

      // Check 3: Description completeness
      const descLength = context.llmExtraction.description?.length ?? 0;
      results.push({
        checkType: 'description_completeness',
        status: descLength > 100 ? 'pass' : descLength > 20 ? 'unknown' : 'fail',
        severity: descLength > 20 ? 'info' : 'warning',
      });

      context.verificationResults = results;

      const passCount = results.filter((r) => r.status === 'pass').length;
      const failCount = results.filter((r) => r.status === 'fail').length;

      return createStageResult(this.stage, 'completed', startTime, undefined, {
        totalChecks: results.length,
        passCount,
        failCount,
        unknownCount: results.length - passCount - failCount,
      });
    } catch (err) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'verify_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      });
    }
  }

  shouldSkip(context: PipelineContext): boolean {
    return !!context.verificationResults;
  }
}

// ============================================================================
// Stage 8: Score
// ============================================================================

/**
 * Computes confidence scores for the candidate.
 */
export class ScoreStage implements PipelineStageHandler {
  readonly stage = 'score' as const;

  async execute(context: PipelineContext): Promise<StageResult> {
    const startTime = new Date();

    if (!context.llmExtraction) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'missing_extraction',
        message: 'Extraction must complete before scoring',
        retryable: false,
      });
    }

    try {
      // Compute sub-scores

      // Verification score: based on verification results
      let verificationScore = 50; // Base score
      if (context.verificationResults) {
        const passCount = context.verificationResults.filter((r) => r.status === 'pass').length;
        const failCount = context.verificationResults.filter((r) => r.status === 'fail').length;
        const total = context.verificationResults.length;
        if (total > 0) {
          verificationScore = Math.round((passCount * 100 + (total - passCount - failCount) * 50) / total);
          verificationScore = Math.max(0, verificationScore - failCount * 20);
        }
      }

      // Completeness score: based on extracted fields
      let completenessScore = 0;
      if (context.llmExtraction.organizationName) completenessScore += 20;
      if (context.llmExtraction.serviceName) completenessScore += 20;
      if (context.llmExtraction.description && context.llmExtraction.description.length > 50) completenessScore += 20;
      if (context.llmExtraction.websiteUrl) completenessScore += 15;
      if (context.llmExtraction.phone) completenessScore += 15;
      if (context.llmExtraction.address) completenessScore += 10;

      // Freshness score: based on source trust level
      let freshnessScore = 50;
      if (context.sourceCheck?.trustLevel === 'allowlisted') {
        freshnessScore = 80;
      } else if (context.sourceCheck?.trustLevel === 'quarantine') {
        freshnessScore = 40;
      }

      // Overall score: weighted average
      const overall = Math.round(
        verificationScore * 0.4 +
        completenessScore * 0.4 +
        freshnessScore * 0.2
      );

      // Determine tier
      let tier: 'green' | 'yellow' | 'orange' | 'red';
      if (overall >= 80) tier = 'green';
      else if (overall >= 60) tier = 'yellow';
      else if (overall >= 40) tier = 'orange';
      else tier = 'red';

      context.candidateScore = {
        overall,
        tier,
        subScores: {
          verification: verificationScore,
          completeness: completenessScore,
          freshness: freshnessScore,
        },
      };

      return createStageResult(this.stage, 'completed', startTime, undefined, {
        overall,
        tier,
        verification: verificationScore,
        completeness: completenessScore,
        freshness: freshnessScore,
      });
    } catch (err) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'score_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      });
    }
  }

  shouldSkip(context: PipelineContext): boolean {
    return !!context.candidateScore;
  }
}

// ============================================================================
// Stage 9: Build Candidate
// ============================================================================

/**
 * Creates the final ExtractedCandidate from all pipeline data.
 */
export class BuildCandidateStage implements PipelineStageHandler {
  readonly stage = 'build_candidate' as const;

  async execute(context: PipelineContext): Promise<StageResult> {
    const startTime = new Date();

    if (!context.llmExtraction) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'missing_extraction',
        message: 'Extraction must complete before building candidate',
        retryable: false,
      });
    }

    try {
      // Generate IDs
      const candidateId = crypto.randomUUID();
      const extractionId = crypto.randomUUID();

      // Compute extract key
      const canonicalUrl = context.fetchResult?.canonicalUrl ?? context.input.sourceUrl;
      const contentHash = context.fetchResult?.contentHashSha256 ?? crypto.randomBytes(32).toString('hex');
      const extractKey = computeExtractKeySha256(canonicalUrl, contentHash);

      context.candidateId = candidateId;
      context.extractionId = extractionId;

      // Note: We don't actually persist the candidate here - that's for the store layer
      // This stage just prepares the data and generates IDs

      return createStageResult(this.stage, 'completed', startTime, undefined, {
        candidateId,
        extractionId,
        extractKey: extractKey.substring(0, 16) + '...',
        tier: context.candidateScore?.tier ?? 'unknown',
        score: context.candidateScore?.overall ?? 0,
      });
    } catch (err) {
      return createStageResult(this.stage, 'failed', startTime, {
        code: 'build_candidate_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      });
    }
  }

  shouldSkip(context: PipelineContext): boolean {
    return !!context.candidateId;
  }
}

// ============================================================================
// Stage Factory
// ============================================================================

/**
 * Creates all pipeline stages in order.
 */
export function createPipelineStages(registry: SourceRegistryEntry[]): PipelineStageHandler[] {
  return [
    new SourceCheckStage(registry),
    new FetchStage(),
    new ExtractTextStage(),
    new DiscoverLinksStage(),
    new LlmExtractStage(),
    new LlmCategorizeStage(),
    new VerifyStage(),
    new ScoreStage(),
    new BuildCandidateStage(),
  ];
}
