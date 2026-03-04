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
 * @module functions/manualSubmit
 */

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
}

// ---------------------------------------------------------------------------
// Handler stub
// ---------------------------------------------------------------------------

/**
 * When deployed as an Azure Function, this handler:
 * 1. Validates the incoming URL
 * 2. Looks up the source registry for matching domain rules
 * 3. Creates an ingestion job record
 * 4. Enqueues the URL to `ingestion-fetch`
 *
 * Current status: STUB — same logic is available via
 *   POST /api/admin/ingestion/process (Next.js API route)
 */
export async function manualSubmit(
  req: HttpRequest
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
  return {
    response: {
      status: 501,
      body: { error: 'Not implemented — use POST /api/admin/ingestion/process' },
    },
    queueMessage: null,
  };
}
