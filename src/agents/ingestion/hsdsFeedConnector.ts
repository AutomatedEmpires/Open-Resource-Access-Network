/**
 * HSDS Feed Connector — HSDS API → source_records.
 *
 * Polls an HSDS-compliant API endpoint, fetches organizations and
 * services, and persists each response as a source_record (Zone A).
 * Deduplication is handled via payload SHA-256 hashing.
 *
 * This connector follows Open Referral HSDS v3 conventions:
 *   GET /organizations  → list organizations
 *   GET /services       → list services
 */

import crypto from 'node:crypto';

import type { IngestionStores } from './stores';
import type {
  SourceFeedRow,
  SourceSystemRow,
  NewSourceRecordRow,
} from '@/db/schema';

// ── Public types ──────────────────────────────────────────────

export interface HsdsFeedConnectorOptions {
  stores: IngestionStores;
  sourceSystem: SourceSystemRow;
  feed: SourceFeedRow;
  /** Optional override for fetch (for testing / custom HTTP). */
  fetchFn?: typeof fetch;
  /** Correlation ID for tracing this poll run. */
  correlationId?: string;
  /** Request timeout in milliseconds (default 30 000). */
  timeoutMs?: number;
  /** Max retry attempts per endpoint on transient failures (default 3). */
  maxRetries?: number;
}

export interface HsdsFeedConnectorResult {
  recordsCreated: number;
  recordsSkippedDuplicate: number;
  errors: string[];
}

// ── Helpers ───────────────────────────────────────────────────

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Produce a canonical JSON string with sorted keys so that
 * semantically identical payloads always yield the same hash,
 * regardless of original key ordering.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((sorted, k) => {
          sorted[k] = (val as Record<string, unknown>)[k];
          return sorted;
        }, {});
    }
    return val;
  });
}

function buildFeedUrl(feed: SourceFeedRow, path: string): string {
  const base = (feed.baseUrl ?? '').replace(/\/+$/, '');
  return `${base}${path}`;
}

async function fetchHsdsPage(
  url: string,
  fetchFn: typeof fetch,
  timeoutMs: number = 30_000,
): Promise<unknown[]> {
  const response = await fetchFn(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`HSDS API ${url} returned ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`HSDS API ${url} returned invalid JSON`);
  }

  // HSDS v3 may return { contents: [...] } or just [...].
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).contents)) {
    return (body as Record<string, unknown>).contents as unknown[];
  }
  if (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).data)) {
    return (body as Record<string, unknown>).data as unknown[];
  }
  // Single object
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return [body];
  }
  return [];
}

// ── Retry helper ──────────────────────────────────────────────

function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    // Timeout, network, or 5xx server errors
    if (msg.includes('timeout') || msg.includes('ECONNRESET') || msg.includes('ENOTFOUND')) return true;
    if (/returned 5\d\d/.test(msg)) return true;
  }
  return false;
}

async function fetchWithRetry(
  url: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  maxRetries: number,
): Promise<unknown[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchHsdsPage(url, fetchFn, timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isTransient(err)) {
        // Exponential backoff: 500ms, 1000ms, 2000ms…
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ── Main function ─────────────────────────────────────────────

export async function pollHsdsFeed(
  options: HsdsFeedConnectorOptions,
): Promise<HsdsFeedConnectorResult> {
  const { stores, sourceSystem, feed, correlationId } = options;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 3;

  const result: HsdsFeedConnectorResult = {
    recordsCreated: 0,
    recordsSkippedDuplicate: 0,
    errors: [],
  };

  const endpoints: Array<{ path: string; recordType: string }> = [
    { path: '/organizations', recordType: 'organization' },
    { path: '/services', recordType: 'service' },
  ];

  for (const endpoint of endpoints) {
    const url = buildFeedUrl(feed, endpoint.path);
    let items: unknown[];
    try {
      items = await fetchWithRetry(url, fetchFn, timeoutMs, maxRetries);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${endpoint.path}: ${msg}`);
      continue;
    }

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const itemObj = item as Record<string, unknown>;
      const payloadStr = stableStringify(item);
      const payloadHash = sha256(payloadStr);
      const sourceRecordId =
        (itemObj['id'] as string) ??
        (itemObj['source_id'] as string) ??
        payloadHash;

      // Check for dedup
      const existing = await stores.sourceRecords.findByDedup(
        feed.id,
        endpoint.recordType,
        sourceRecordId,
        payloadHash,
      );

      if (existing) {
        result.recordsSkippedDuplicate++;
        continue;
      }

      const row: NewSourceRecordRow = {
        sourceFeedId: feed.id,
        sourceRecordType: endpoint.recordType,
        sourceRecordId,
        fetchedAt: new Date(),
        payloadSha256: payloadHash,
        rawPayload: item as Record<string, unknown>,
        parsedPayload: item as Record<string, unknown>,
        sourceConfidenceSignals: {
          trustTier: sourceSystem.trustTier,
          family: sourceSystem.family,
        },
        processingStatus: 'pending',
        correlationId: correlationId ?? null,
        sourceLicense: sourceSystem.licenseNotes ?? null,
      };

      await stores.sourceRecords.create(row);
      result.recordsCreated++;
    }
  }

  // Update feed poll status
  const now = new Date().toISOString();
  const hasErrors = result.errors.length > 0;

  await stores.sourceFeeds.updateAfterPoll(feed.id, {
    lastPolledAt: now,
    ...(hasErrors
      ? { lastError: result.errors.join('; '), errorCount: (feed.errorCount ?? 0) + 1 }
      : { lastSuccessAt: now, errorCount: 0 }),
  });

  return result;
}
