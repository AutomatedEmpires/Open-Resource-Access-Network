/**
 * fetchPage — Queue-triggered function.
 *
 * Receives a URL from `ingestion-fetch` queue, fetches the page content,
 * stores the evidence snapshot, and enqueues to `ingestion-extract`.
 *
 * Azure Function binding:
 *   trigger: queue  queueName: "ingestion-fetch"
 *   output:  queue  queueName: "ingestion-extract"
 *
 * @module functions/fetchPage
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetchQueueMessage {
  sourceId: string;
  seedUrl: string;
  correlationId: string;
  priority: number;
  enqueuedAt: string;
}

export interface ExtractQueueMessage {
  sourceId: string;
  sourceUrl: string;
  correlationId: string;
  evidenceId: string;
  contentHash: string;
  enqueuedAt: string;
}

// ---------------------------------------------------------------------------
// Handler stub
// ---------------------------------------------------------------------------

/**
 * When deployed as an Azure Function, this handler:
 * 1. Fetches the URL (respecting robots.txt, crawl policy)
 * 2. Creates an evidence snapshot in the evidence store
 * 3. Enqueues to `ingestion-extract` for LLM extraction
 *
 * Current status: STUB — fetch logic lives in src/agents/ingestion/fetch/.
 */
export async function fetchPage(
  message: FetchQueueMessage
): Promise<ExtractQueueMessage | null> {
  // TODO: Wire to actual fetch pipeline
  //
  // Implementation outline:
  //   const db = getDrizzle();
  //   const stores = createIngestionStores(db);
  //   const source = await stores.sourceRegistry.getById(message.sourceId);
  //   if (!source) return null;
  //
  //   // Check robots.txt
  //   const robotsResult = await checkRobotsTxt(message.seedUrl, source.crawl);
  //   if (!robotsResult.allowed) return null;
  //
  //   // Fetch page
  //   const snapshot = await fetchUrl(message.seedUrl, source.crawl);
  //
  //   // Store evidence
  //   const evidenceId = crypto.randomUUID();
  //   await stores.evidence.upsert({
  //     evidenceId,
  //     url: message.seedUrl,
  //     fetchedAt: new Date().toISOString(),
  //     httpStatus: snapshot.status,
  //     contentType: snapshot.contentType,
  //     contentHash: snapshot.hash,
  //     bodyText: snapshot.text,
  //   });
  //
  //   return {
  //     sourceId: message.sourceId,
  //     sourceUrl: message.seedUrl,
  //     correlationId: message.correlationId,
  //     evidenceId,
  //     contentHash: snapshot.hash,
  //     enqueuedAt: new Date().toISOString(),
  //   };

  console.log(`[fetchPage] Received URL: ${message.seedUrl} — stub, no-op`);
  return null;
}
