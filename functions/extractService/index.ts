/**
 * extractService — Queue-triggered function.
 *
 * Receives a fetched snapshot from `ingestion-extract` queue,
 * runs LLM extraction to identify service data, creates a candidate,
 * and enqueues to `ingestion-verify`.
 *
 * Azure Function binding:
 *   trigger: queue  queueName: "ingestion-extract"
 *   output:  queue  queueName: "ingestion-verify"
 *
 * Idea 3 — Foundry Integration: LLM-powered structured extraction.
 * Uses gpt-4o-mini (Azure OpenAI) by default; override with
 * LLM_MODEL=phi-4-mini-instruct + FOUNDRY_ENDPOINT + FOUNDRY_KEY env vars
 * to route extraction through ORAN-FOUNDRY-resource on Azure AI Foundry.
 *
 * @module functions/extractService
 */
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Message received from the `ingestion-extract` queue (produced by fetchPage). */
export interface ExtractQueueMessage {
  sourceId: string;
  sourceUrl: string;
  correlationId: string;
  evidenceId: string;
  contentHash: string;
  /** Extracted plain text forwarded from fetchPage so we skip a re-fetch. */
  textExtracted: string;
  /** Page title, if available. */
  pageTitle?: string;
  enqueuedAt: string;
}

/** Message written to the `ingestion-verify` queue. */
export interface VerifyQueueMessage {
  candidateId: string;
  sourceUrl: string;
  correlationId: string;
  confidenceScore: number;
  confidenceTier: string;
  enqueuedAt: string;
}

// ---------------------------------------------------------------------------
// Confidence tier helper
// ---------------------------------------------------------------------------

function scoreToTier(score: number): 'green' | 'yellow' | 'orange' | 'red' {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  if (score >= 40) return 'orange';
  return 'red';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Runs LLM extraction (Stages 5-9) on the pre-fetched text content,
 * persists a candidate to the database, and enqueues to ingestion-verify.
 *
 * Stages executed:
 *   5 — LlmExtractStage    (structured field extraction)
 *   6 — LlmCategorizeStage (taxonomy tagging)
 *   7 — VerifyStage        (heuristic data checks)
 *   8 — ScoreStage         (confidence scoring)
 *   9 — BuildCandidateStage (ID generation)
 *
 * The function builds a minimal PipelineContext pre-populated with
 * evidence data so only LLM-intensive stages run. Evidence is not
 * re-fetched.
 */
export async function extractService(
  message: ExtractQueueMessage
): Promise<VerifyQueueMessage | null> {
  const { getDrizzle } = await import('@/services/db/drizzle');
  const { createIngestionStores } = await import(
    '@/agents/ingestion/persistence/storeFactory'
  );
  const {
    LlmExtractStage,
    LlmCategorizeStage,
    VerifyStage,
    ScoreStage,
    BuildCandidateStage,
  } = await import('@/agents/ingestion/pipeline/stages');
  const { PipelineConfigSchema } = await import(
    '@/agents/ingestion/pipeline/types'
  );

  const db = getDrizzle();
  const stores = createIngestionStores(db);

  // Build a minimal pipeline context with extract-stage pre-requisites.
  // sourceCheck is omitted — LlmExtractStage only needs textExtraction.
  const config = PipelineConfigSchema.parse({
    enableLlmExtraction: true,
    enableVerification: true,
  });

  const context: import('@/agents/ingestion/pipeline/types').PipelineContext = {
    input: {
      sourceUrl: message.sourceUrl,
      correlationId: message.correlationId,
      forceReprocess: false,
    },
    config,
    correlationId: message.correlationId,
    startedAt: new Date(),
    stageResults: [],
    // Pre-populate text extraction so Stage 5 (LlmExtract) can start immediately
    textExtraction: {
      text: message.textExtracted,
      title: message.pageTitle,
      wordCount: message.textExtracted.split(/\s+/).filter(Boolean).length,
    },
    fetchResult: {
      canonicalUrl: message.sourceUrl,
      httpStatus: 200,
      contentHashSha256: message.contentHash,
      body: '',
      contentLength: message.textExtracted.length,
      fetchedAt: new Date().toISOString(),
    },
  };

  // Run stages 5–9 in sequence
  const stages = [
    new LlmExtractStage(),
    new LlmCategorizeStage(),
    new VerifyStage(),
    new ScoreStage(),
    new BuildCandidateStage(),
  ];

  for (const stage of stages) {
    if (stage.shouldSkip?.(context)) continue;
    const result = await stage.execute(context);
    context.stageResults.push(result);
    if (result.status === 'failed') {
      console.warn(
        `[extractService] Stage ${stage.stage} failed for ${message.sourceUrl}: ` +
          result.error?.message
      );
      // LLM stages are retryable — bail out cleanly
      return null;
    }
  }

  // BuildCandidateStage sets context.candidateId and context.extractionId
  const { candidateId, extractionId, candidateScore, llmExtraction } = context;

  if (!candidateId || !extractionId || !llmExtraction) {
    console.warn(
      `[extractService] Extraction produced no candidate for ${message.sourceUrl}`
    );
    return null;
  }

  const confidenceScore = candidateScore?.overall ?? llmExtraction.confidence ?? 50;
  const confidenceTier = candidateScore?.tier ?? scoreToTier(confidenceScore);

  // Persist candidate record
  const { computeExtractKeySha256 } = await import('@/agents/ingestion/fetcher');
  const extractKey = computeExtractKeySha256(message.sourceUrl, message.contentHash);

  await stores.candidates.create({
    candidateId,
    extractionId,
    extractKeySha256: extractKey as `${string}`,
    extractedAt: new Date().toISOString(),
    primaryEvidenceId: message.evidenceId,
    correlationId: message.correlationId,
    fields: {
      organizationName: llmExtraction.organizationName,
      serviceName: llmExtraction.serviceName,
      description: llmExtraction.description,
      websiteUrl: llmExtraction.websiteUrl,
      phone: llmExtraction.phone,
      phones: llmExtraction.phone
        ? [{ number: llmExtraction.phone, type: 'voice' as const }]
        : [],
      address: llmExtraction.address,
      isRemoteService: false,
    },
    provenance: {
      serviceName: {
        evidenceId: message.evidenceId,
        confidenceHint: 'medium',
      },
    },
    review: {
      status: 'pending',
      timers: {},
      tags: context.llmCategorization?.categories ?? [],
      checklist: context.verificationChecklist ?? [],
    },
    jurisdictionState: llmExtraction.address?.region,
    jurisdictionCity: llmExtraction.address?.city,
    jurisdictionKind: llmExtraction.address ? 'local' : undefined,
  });

  console.log(
    `[extractService] Created candidate ${candidateId} for ${message.sourceUrl} ` +
      `(score=${confidenceScore}, tier=${confidenceTier})`
  );

  return {
    candidateId,
    sourceUrl: message.sourceUrl,
    correlationId: message.correlationId,
    confidenceScore,
    confidenceTier,
    enqueuedAt: new Date().toISOString(),
  };
}
