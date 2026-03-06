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
  /** Extracted plain text from the page, passed directly to avoid re-fetch. */
  textExtracted: string;
  /** Page title extracted from HTML, if available. */
  pageTitle?: string;
  enqueuedAt: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Fetches the URL, builds an evidence snapshot, persists it to the evidence
 * store, and returns an ExtractQueueMessage for the next queue stage.
 *
 * Robots.txt compliance, crawl policy, and dedup are all handled here.
 * Text extraction runs in-process so the LLM extraction stage receives the
 * cleaned text directly and does not need to re-fetch the page.
 */
export async function fetchPage(
  message: FetchQueueMessage
): Promise<ExtractQueueMessage | null> {
  const { getDrizzle } = await import('@/services/db/drizzle');
  const { createIngestionStores } = await import(
    '@/agents/ingestion/persistence/storeFactory'
  );
  const {
    createPageFetcher,
    isFetchError,
    createEvidenceBuilder,
    createHtmlTextExtractor,
  } = await import('@/agents/ingestion/fetcher');

  const db = getDrizzle();
  const stores = createIngestionStores(db);

  // Verify source still active
  const source = await stores.sourceRegistry.getById(message.sourceId);
  if (!source) {
    console.warn(
      `[fetchPage] Source ${message.sourceId} not found in registry, skipping`
    );
    return null;
  }

  // Dedup: skip if content unchanged since last fetch
  const existingEvidence = await stores.evidence.getByCanonicalUrl(message.seedUrl);

  const fetcher = createPageFetcher({
    timeoutMs: 30_000,
    userAgent: source.crawl.userAgent ?? 'oran-ingestion-agent/1.0',
  });

  const fetchResult = await fetcher.fetch(message.seedUrl);

  if (isFetchError(fetchResult)) {
    console.warn(
      `[fetchPage] Fetch failed for ${message.seedUrl}: ${fetchResult.message}`
    );
    return null;
  }

  // Dedup: skip if content hash unchanged
  if (
    existingEvidence &&
    existingEvidence.contentHashSha256 === fetchResult.contentHashSha256
  ) {
    console.log(
      `[fetchPage] Content unchanged for ${message.seedUrl}, skipping extract`
    );
    return null;
  }

  // Build evidence snapshot
  const evidenceBuilder = createEvidenceBuilder();
  const snapshot = evidenceBuilder.buildFromFetchResult(fetchResult);

  // Persist evidence snapshot
  await stores.evidence.create({
    ...snapshot,
    correlationId: message.correlationId,
  });

  // Extract text in-process so extractService doesn't need to re-fetch
  const textExtractor = createHtmlTextExtractor();
  const textResult = textExtractor.extract(fetchResult.body);

  console.log(
    `[fetchPage] Fetched ${message.seedUrl} → evidenceId=${snapshot.evidenceId} ` +
      `words=${textResult.wordCount}`
  );

  return {
    sourceId: message.sourceId,
    sourceUrl: fetchResult.canonicalUrl,
    correlationId: message.correlationId,
    evidenceId: snapshot.evidenceId,
    contentHash: fetchResult.contentHashSha256,
    textExtracted: textResult.text,
    pageTitle: textResult.title ?? undefined,
    enqueuedAt: new Date().toISOString(),
  };
}

