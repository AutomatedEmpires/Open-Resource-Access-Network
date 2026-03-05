import { describe, expect, it, vi } from 'vitest';

import type { CandidateStore, EvidenceStore } from '../../stores';
import {
  computeExtractKeySha256,
  computeFetchKeySha256,
  createDedupChecker,
  DedupChecker,
} from '../dedupIntegration';

describe('dedupIntegration store-backed coverage', () => {
  it('re-exports deterministic hash helpers', () => {
    const fetchHash = computeFetchKeySha256('https://example.org/page');
    const extractHash = computeExtractKeySha256('https://example.org/page', 'abc123');

    expect(fetchHash).toMatch(/^[a-f0-9]{64}$/);
    expect(computeFetchKeySha256('https://example.org/page')).toBe(fetchHash);
    expect(extractHash).toMatch(/^[a-f0-9]{64}$/);
    expect(extractHash).not.toBe(fetchHash);
  });

  it('handles in-memory fetch/extract tracking and reset', async () => {
    const checker = createDedupChecker();
    const fetchKey = computeFetchKeySha256('https://example.org/a');
    const extractKey = computeExtractKeySha256('https://example.org/a', 'content-hash');

    expect(await checker.hasFetchedUrl(fetchKey)).toBe(false);
    checker.markFetched(fetchKey);
    expect(await checker.hasFetchedUrl(fetchKey)).toBe(true);

    expect(await checker.hasExtracted(extractKey)).toBe(false);
    checker.markExtracted(extractKey);
    expect(await checker.hasExtracted(extractKey)).toBe(true);
    expect(checker.getCounts()).toEqual({ fetchedUrls: 1, extractedItems: 1 });

    checker.reset();
    expect(checker.getCounts()).toEqual({ fetchedUrls: 0, extractedItems: 0 });
    expect(await checker.hasFetchedUrl(fetchKey)).toBe(false);
    expect(await checker.hasExtracted(extractKey)).toBe(false);
  });

  it('checks evidence store when canonicalUrl is provided and caches hit', async () => {
    const getByCanonicalUrl = vi.fn().mockResolvedValue({
      evidenceId: 'ev-1',
      canonicalUrl: 'https://example.org/a',
    });

    const checker = new DedupChecker({
      evidence: { getByCanonicalUrl } as unknown as EvidenceStore,
    });

    const fetchKey = computeFetchKeySha256('https://example.org/a');
    expect(await checker.hasFetchedUrl(fetchKey, 'https://example.org/a')).toBe(true);
    expect(getByCanonicalUrl).toHaveBeenCalledTimes(1);
    expect(getByCanonicalUrl).toHaveBeenCalledWith('https://example.org/a');

    getByCanonicalUrl.mockClear();
    expect(await checker.hasFetchedUrl(fetchKey, 'https://example.org/a')).toBe(true);
    expect(getByCanonicalUrl).not.toHaveBeenCalled();
  });

  it('skips evidence store check when canonicalUrl is omitted', async () => {
    const getByCanonicalUrl = vi.fn().mockResolvedValue({
      evidenceId: 'ev-2',
      canonicalUrl: 'https://example.org/b',
    });
    const checker = new DedupChecker({
      evidence: { getByCanonicalUrl } as unknown as EvidenceStore,
    });

    const fetchKey = computeFetchKeySha256('https://example.org/b');
    expect(await checker.hasFetchedUrl(fetchKey)).toBe(false);
    expect(getByCanonicalUrl).not.toHaveBeenCalled();
  });

  it('checks candidate store for extracted content and caches hit', async () => {
    const getByExtractKey = vi.fn().mockResolvedValue({
      id: 'cand-1',
      extractKey: 'extract-1',
    });

    const checker = createDedupChecker({
      candidates: { getByExtractKey } as unknown as CandidateStore,
    });

    const extractKey = computeExtractKeySha256('https://example.org/c', 'hash-c');
    expect(await checker.hasExtracted(extractKey)).toBe(true);
    expect(getByExtractKey).toHaveBeenCalledTimes(1);
    expect(getByExtractKey).toHaveBeenCalledWith(extractKey);

    getByExtractKey.mockClear();
    expect(await checker.hasExtracted(extractKey)).toBe(true);
    expect(getByExtractKey).not.toHaveBeenCalled();
  });

  it('returns false on store misses', async () => {
    const getByCanonicalUrl = vi.fn().mockResolvedValue(null);
    const getByExtractKey = vi.fn().mockResolvedValue(null);

    const checker = createDedupChecker({
      evidence: { getByCanonicalUrl } as unknown as EvidenceStore,
      candidates: { getByExtractKey } as unknown as CandidateStore,
    });

    expect(
      await checker.hasFetchedUrl(
        computeFetchKeySha256('https://example.org/miss'),
        'https://example.org/miss',
      ),
    ).toBe(false);
    expect(
      await checker.hasExtracted(computeExtractKeySha256('https://example.org/miss', 'hash-miss')),
    ).toBe(false);
  });
});
