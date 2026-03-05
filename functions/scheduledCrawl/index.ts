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
import crypto from 'node:crypto';

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
// Handler
// ---------------------------------------------------------------------------

/**
 * Lists all active sources from the SourceRegistryStore and enqueues
 * their seed URLs to the `ingestion-fetch` queue.
 *
 * Each source with discovery rules of type 'seeded_only' or 'crawl' will have
 * its seed URLs enqueued. Sources without seed URLs in their discovery config
 * are skipped.
 *
 * Returns the array of queue messages; Azure binds this to queue output.
 */
export async function scheduledCrawl(
  _timer: TimerInfo
): Promise<QueueMessage[]> {
  const { getDrizzle } = await import('@/services/db/drizzle');
  const { createIngestionStores } = await import(
    '@/agents/ingestion/persistence/storeFactory'
  );

  const db = getDrizzle();
  const stores = createIngestionStores(db);
  const sources = await stores.sourceRegistry.listActive();
  const messages: QueueMessage[] = [];
  const now = new Date().toISOString();

  for (const source of sources) {
    for (const discovery of source.discovery) {
      const seedUrls: string[] =
        'seedUrls' in discovery && Array.isArray(discovery.seedUrls)
          ? (discovery.seedUrls as string[])
          : [];

      for (const url of seedUrls) {
        messages.push({
          sourceId: source.id,
          seedUrl: url,
          correlationId: crypto.randomUUID(),
          priority: 5,
          enqueuedAt: now,
        });
      }
    }
  }

  console.log(
    `[scheduledCrawl] Enqueuing ${messages.length} URLs from ${sources.length} active sources`
  );
  return messages;
}
