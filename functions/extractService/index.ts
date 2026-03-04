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
 * @module functions/extractService
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractQueueMessage {
  sourceId: string;
  sourceUrl: string;
  correlationId: string;
  evidenceId: string;
  contentHash: string;
  enqueuedAt: string;
}

export interface VerifyQueueMessage {
  candidateId: string;
  sourceUrl: string;
  correlationId: string;
  confidenceScore: number;
  confidenceTier: string;
  enqueuedAt: string;
}

// ---------------------------------------------------------------------------
// Handler stub
// ---------------------------------------------------------------------------

/**
 * When deployed as an Azure Function, this handler:
 * 1. Reads the evidence snapshot from the evidence store
 * 2. Runs LLM extraction (via existing LlmExtractionStage + LlmCategorizationStage)
 * 3. Creates a candidate record with extracted service fields
 * 4. Generates tag confirmations for admin review
 * 5. Enqueues to `ingestion-verify`
 *
 * Current status: STUB — extraction logic lives in
 *   src/agents/ingestion/pipeline/stages/llmExtract.ts
 *   src/agents/ingestion/pipeline/stages/llmCategorize.ts
 */
export async function extractService(
  message: ExtractQueueMessage
): Promise<VerifyQueueMessage | null> {
  // TODO: Wire to actual extraction pipeline
  //
  // Implementation outline:
  //   const db = getDrizzle();
  //   const stores = createIngestionStores(db);
  //
  //   const evidence = await stores.evidence.getById(message.evidenceId);
  //   if (!evidence) return null;
  //
  //   // Run LLM extraction stages
  //   const extractResult = await llmExtractStage.execute({
  //     url: message.sourceUrl,
  //     content: evidence.bodyText,
  //   });
  //
  //   // Build candidate from extraction result
  //   const candidateId = crypto.randomUUID();
  //   await stores.candidates.upsert({
  //     id: candidateId,
  //     sourceUrl: message.sourceUrl,
  //     fields: extractResult.fields,
  //     confidenceScore: extractResult.confidence,
  //     confidenceTier: computeTier(extractResult.confidence),
  //     reviewStatus: 'pending',
  //   });
  //
  //   return {
  //     candidateId,
  //     sourceUrl: message.sourceUrl,
  //     correlationId: message.correlationId,
  //     confidenceScore: extractResult.confidence,
  //     confidenceTier: computeTier(extractResult.confidence),
  //     enqueuedAt: new Date().toISOString(),
  //   };

  console.log(`[extractService] Processing evidence ${message.evidenceId} — stub, no-op`);
  return null;
}
