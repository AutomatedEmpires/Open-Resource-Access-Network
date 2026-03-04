/**
 * scheduledCrawl — Timer-triggered function (daily at 06:00 UTC).
 *
 * Queries active source registry entries that are due for re-crawl,
 * enqueues their seed URLs onto the `ingestion-fetch` queue.
 *
 * Azure Function binding:
 *   trigger: timer  schedule: "0 0 6 * * *"
 *   output:  queue  queueName: "ingestion-fetch"
 *
 * @module functions/scheduledCrawl
 */

// ---------------------------------------------------------------------------
// Types for Azure Functions v4 programming model
// ---------------------------------------------------------------------------

export interface TimerInfo {
  schedule: { isRunning: boolean };
  isPastDue: boolean;
}

export interface QueueMessage {
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
 * 1. Lists all active sources from the SourceRegistryStore
 * 2. For each source, checks if fetchTtlHours has elapsed
 * 3. Enqueues seed URLs to `ingestion-fetch` queue
 *
 * Current status: STUB — pipeline logic lives in createIngestionService().
 * Wire this to Azure Storage Queue output binding when deploying.
 */
export async function scheduledCrawl(
  _timer: TimerInfo
): Promise<QueueMessage[]> {
  // TODO: Wire to actual stores + queue
  //
  // Implementation outline:
  //   const db = getDrizzle();
  //   const stores = createIngestionStores(db);
  //   const sources = await stores.sourceRegistry.listActive();
  //   const messages: QueueMessage[] = [];
  //
  //   for (const source of sources) {
  //     const ttlMs = source.crawl.fetchTtlHours * 60 * 60 * 1000;
  //     // Check if last fetch was > fetchTtlHours ago
  //     for (const discovery of source.discovery) {
  //       if (discovery.seedUrls) {
  //         for (const url of discovery.seedUrls) {
  //           messages.push({
  //             sourceId: source.id,
  //             seedUrl: url,
  //             correlationId: crypto.randomUUID(),
  //             priority: 5,
  //             enqueuedAt: new Date().toISOString(),
  //           });
  //         }
  //       }
  //     }
  //   }
  //
  //   return messages; // Azure binds this to queue output

  console.log('[scheduledCrawl] Timer triggered — stub, no-op');
  return [];
}
