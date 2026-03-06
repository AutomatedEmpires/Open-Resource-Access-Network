/**
 * manualSubmit — HTTP-triggered function.
 *
 * Accepts a URL via HTTP POST and enqueues it for ingestion processing.
 * Alternative entry point to the API route for external integrations.
 *
 * Azure Function binding:
 *   trigger: http  methods: ["POST"]  route: "ingestion/submit"
 *   output:  queue  queueName: "ingestion-fetch"
 *
 * Idea 13 (Phase 5): If the submitted URL is a PDF and the
 * doc_intelligence_intake feature flag is enabled, Document Intelligence
 * pre-extracts the text before the URL is enqueued for the main pipeline.
 *
 * @module functions/manualSubmit
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpRequest {
  method: string;
  url: string;
  body?: {
    sourceUrl: string;
    sourceId?: string;
    priority?: number;
  };
}

export interface HttpResponse {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface FetchQueueMessage {
  sourceId: string;
  seedUrl: string;
  correlationId: string;
  priority: number;
  enqueuedAt: string;
  /** Pre-extracted PDF text from Document Intelligence, if available. */
  docText?: string;
}

// ---------------------------------------------------------------------------
// Handler stub
// ---------------------------------------------------------------------------

/**
 * When deployed as an Azure Function, this handler:
 * 1. Validates the incoming URL
 * 2. (Idea 13) If the URL is a PDF and DOC_INTELLIGENCE_INTAKE flag is on,
 *    calls Document Intelligence to pre-extract text
 * 3. Looks up the source registry for matching domain rules
 * 4. Creates an ingestion job record
 * 5. Enqueues the URL (+ optional docText) to `ingestion-fetch`
 *
 * Current status: STUB — same logic is available via
 *   POST /api/admin/ingestion/process (Next.js API route)
 */
export async function manualSubmit(
  _req: HttpRequest
): Promise<{ response: HttpResponse; queueMessage: FetchQueueMessage | null }> {
  // TODO: Wire to actual pipeline
  //
  // Implementation outline:
  //   if (!req.body?.sourceUrl) {
  //     return {
  //       response: { status: 400, body: { error: 'sourceUrl is required' } },
  //       queueMessage: null,
  //     };
  //   }
  //
  //   const { flagService } = await import('@/services/flags/flags');
  //   const { FEATURE_FLAGS } = await import('@/domain/constants');
  //   const { isPdfUrl, analyzeDocument, isDocIntelligenceConfigured } =
  //     await import('@/services/ingestion/docIntelligence');
  //
  //   let docText: string | undefined;
  //   const docIntakeEnabled =
  //     await flagService.isEnabled(FEATURE_FLAGS.DOC_INTELLIGENCE_INTAKE);
  //   if (docIntakeEnabled && isDocIntelligenceConfigured() &&
  //       isPdfUrl(req.body.sourceUrl)) {
  //     const result = await analyzeDocument(req.body.sourceUrl);
  //     if (result) {
  //       console.log(`[manualSubmit] Doc Intelligence extracted ${result.pages} page(s)`);
  //       docText = result.text;
  //     }
  //   }
  //
  //   const db = getDrizzle();
  //   const stores = createIngestionStores(db);
  //   const source = await stores.sourceRegistry.findForUrl(req.body.sourceUrl);
  //
  //   const correlationId = crypto.randomUUID();
  //   const job = createIngestionJob({
  //     jobType: 'manual_submission',
  //     seedUrls: [req.body.sourceUrl],
  //     sourceRegistryId: source?.id,
  //   });
  //   await stores.jobs.create(job);
  //
  //   const queueMessage: FetchQueueMessage = {
  //     sourceId: source?.id ?? 'unknown',
  //     seedUrl: req.body.sourceUrl,
  //     correlationId,
  //     priority: req.body.priority ?? 5,
  //     enqueuedAt: new Date().toISOString(),
  //     ...(docText ? { docText } : {}),
  //   };
  //
  //   return {
  //     response: {
  //       status: 202,
  //       body: { jobId: job.id, correlationId, status: 'queued' },
  //     },
  //     queueMessage,
  //   };

  console.log(`[manualSubmit] Received submission — stub, no-op`);
  void crypto; // referenced in outline above
  return {
    response: {
      status: 501,
      body: { error: 'Not implemented — use POST /api/admin/ingestion/process' },
    },
    queueMessage: null,
  };
}
