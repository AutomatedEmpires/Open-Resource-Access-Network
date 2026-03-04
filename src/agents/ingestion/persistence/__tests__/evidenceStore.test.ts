import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDrizzleEvidenceStore,
  getDiscoveredLinks,
  storeDiscoveredLinks,
} from '../evidenceStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        orderBy: vi.fn(() => builder),
        limit: vi.fn(() => Promise.resolve(result)),
        then: (onFulfilled?: ((value: unknown) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) =>
          Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        return {
          then: (onFulfilled: ((value: void) => unknown) | null | undefined, onRejected?: ((reason: unknown) => unknown) | null | undefined) =>
            Promise.resolve().then(onFulfilled, onRejected),
        };
      }),
    })),
  };

  return { db, insertValues };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    evidenceId: 'ev-1',
    canonicalUrl: 'https://example.gov/feed',
    fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
    httpStatus: 200,
    contentHashSha256: 'a'.repeat(64),
    contentLength: 1234,
    contentType: 'text/html',
    blobStorageKey: 'https://blob.example/ev-1',
    htmlRaw: null,
    textExtracted: null,
    title: null,
    metaDescription: null,
    language: null,
    jobId: null,
    correlationId: 'corr-1',
    createdAt: new Date('2026-01-01T00:00:01.000Z'),
    ...overrides,
  };
}

describe('evidenceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates evidence snapshots with the expected DB payload', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleEvidenceStore(db as never);

    await store.create({
      evidenceId: 'ev-1',
      canonicalUrl: 'https://example.gov/feed',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      httpStatus: 200,
      contentHashSha256: 'a'.repeat(64) as `${string}`,
      contentType: 'text/html',
      blobUri: 'https://blob.example/ev-1',
      correlationId: 'corr-1',
      jobId: 'job-1',
    });

    expect(insertValues).toEqual([
      {
        evidenceId: 'ev-1',
        canonicalUrl: 'https://example.gov/feed',
        fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
        httpStatus: 200,
        contentHashSha256: 'a'.repeat(64),
        contentType: 'text/html',
        blobStorageKey: 'https://blob.example/ev-1',
        correlationId: 'corr-1',
        jobId: 'job-1',
      },
    ]);
  });

  it('maps rows for id, hash, and canonical URL lookups', async () => {
    const { db } = createMockDb([
      [makeRow()],
      [makeRow({ evidenceId: 'ev-2', contentHashSha256: 'b'.repeat(64), blobStorageKey: null })],
      [],
    ]);
    const store = createDrizzleEvidenceStore(db as never);

    await expect(store.getById('ev-1')).resolves.toEqual(
      expect.objectContaining({
        evidenceId: 'ev-1',
        canonicalUrl: 'https://example.gov/feed',
        blobUri: 'https://blob.example/ev-1',
      }),
    );
    await expect(store.getByContentHash('b'.repeat(64))).resolves.toEqual(
      expect.objectContaining({
        evidenceId: 'ev-2',
        blobUri: undefined,
      }),
    );
    await expect(store.getByCanonicalUrl('https://missing.gov')).resolves.toBeNull();
  });

  it('detects whether content changed against the most recent canonical URL snapshot', async () => {
    const { db } = createMockDb([
      [makeRow({ contentHashSha256: 'a'.repeat(64) })],
      [],
    ]);
    const store = createDrizzleEvidenceStore(db as never);

    await expect(store.hasContentChanged('https://example.gov/feed', 'b'.repeat(64))).resolves.toBe(true);
    await expect(store.hasContentChanged('https://missing.gov', 'c'.repeat(64))).resolves.toBe(true);
  });

  it('stores and retrieves discovered links with normalized defaults', async () => {
    const { db, insertValues } = createMockDb([
      [
        {
          url: 'https://example.gov/contact',
          linkType: 'contact',
          label: 'Contact',
          confidence: 77,
        },
        {
          url: 'https://example.gov/apply',
          linkType: 'apply',
          label: null,
          confidence: null,
        },
      ],
    ]);

    await storeDiscoveredLinks(db as never, 'ev-1', [
      { url: 'https://example.gov/contact', type: 'contact', label: 'Contact', confidence: 77 },
      { url: 'https://example.gov/apply', type: 'apply', confidence: 60 },
    ]);

    const links = await getDiscoveredLinks(db as never, 'ev-1');

    expect(insertValues).toEqual([
      [
        {
          evidenceId: 'ev-1',
          url: 'https://example.gov/contact',
          linkType: 'contact',
          label: 'Contact',
          confidence: 77,
        },
        {
          evidenceId: 'ev-1',
          url: 'https://example.gov/apply',
          linkType: 'apply',
          label: undefined,
          confidence: 60,
        },
      ],
    ]);
    expect(links).toEqual([
      { url: 'https://example.gov/contact', type: 'contact', label: 'Contact', confidence: 77 },
      { url: 'https://example.gov/apply', type: 'apply', label: undefined, confidence: 50 },
    ]);
  });
});
