/**
 * Dedup integration for the fetcher module.
 * Re-exports and extends the existing dedupe utilities for use within the fetcher pipeline.
 *
 * Supports two modes:
 * 1. In-memory only (default) — fast but scoped to a single process/run.
 * 2. Store-backed — queries EvidenceStore/CandidateStore for cross-run dedup,
 *    with an in-memory cache to avoid repeated DB hits within the same run.
 */

// Re-export the core dedup functions
export { computeExtractKeySha256, computeFetchKeySha256 } from '../dedupe';

import type { EvidenceStore, CandidateStore } from '../stores';

/**
 * Check if a URL has already been fetched by comparing fetch keys.
 */
export interface DedupCheckResult {
  isDuplicate: boolean;
  existingEvidenceId?: string;
  existingFetchedAt?: string;
  existingContentHash?: string;
}

/**
 * Optional store backends for cross-run dedup.
 */
export interface DedupStores {
  evidence?: EvidenceStore;
  candidates?: CandidateStore;
}

/**
 * DedupChecker provides methods to check for duplicate fetches and extractions.
 *
 * When constructed with stores, it queries the DB for cross-run dedup:
 *   - hasFetchedUrl checks the evidence store by canonical URL
 *   - hasExtracted checks the candidate store by extract key
 *
 * Results are cached in-memory for the duration of the run.
 * The in-memory cache has a configurable max size (default 500_000)
 * to prevent unbounded memory growth during large crawls.
 */
export class DedupChecker {
  private readonly seenFetchKeys = new Set<string>();
  private readonly seenExtractKeys = new Set<string>();
  private readonly stores: DedupStores;
  private readonly maxSize: number;

  constructor(stores: DedupStores = {}, maxSize = 500_000) {
    this.stores = stores;
    this.maxSize = maxSize;
  }

  /**
   * Check if a URL has already been fetched.
   * If an EvidenceStore is available, also checks the DB.
   */
  async hasFetchedUrl(fetchKey: string, canonicalUrl?: string): Promise<boolean> {
    if (this.seenFetchKeys.has(fetchKey)) return true;

    // Cross-run check via EvidenceStore
    if (this.stores.evidence && canonicalUrl) {
      const existing = await this.stores.evidence.getByCanonicalUrl(canonicalUrl);
      if (existing) {
        this.seenFetchKeys.add(fetchKey);
        return true;
      }
    }

    return false;
  }

  /**
   * Mark a URL as fetched in this session.
   * Evicts oldest entries when maxSize is reached.
   */
  markFetched(fetchKey: string): void {
    if (this.seenFetchKeys.size >= this.maxSize) {
      // Evict oldest entry (first inserted in Set iteration order)
      const oldest = this.seenFetchKeys.values().next().value;
      if (oldest !== undefined) this.seenFetchKeys.delete(oldest);
    }
    this.seenFetchKeys.add(fetchKey);
  }

  /**
   * Check if content has already been extracted.
   * If a CandidateStore is available, also checks the DB.
   */
  async hasExtracted(extractKey: string): Promise<boolean> {
    if (this.seenExtractKeys.has(extractKey)) return true;

    // Cross-run check via CandidateStore
    if (this.stores.candidates) {
      const existing = await this.stores.candidates.getByExtractKey(extractKey);
      if (existing) {
        this.seenExtractKeys.add(extractKey);
        return true;
      }
    }

    return false;
  }

  /**
   * Mark content as extracted.
   * Evicts oldest entries when maxSize is reached.
   */
  markExtracted(extractKey: string): void {
    if (this.seenExtractKeys.size >= this.maxSize) {
      const oldest = this.seenExtractKeys.values().next().value;
      if (oldest !== undefined) this.seenExtractKeys.delete(oldest);
    }
    this.seenExtractKeys.add(extractKey);
  }

  /**
   * Reset the checker (useful for testing or new batch runs).
   */
  reset(): void {
    this.seenFetchKeys.clear();
    this.seenExtractKeys.clear();
  }

  /**
   * Get counts for debugging/logging.
   */
  getCounts(): { fetchedUrls: number; extractedItems: number } {
    return {
      fetchedUrls: this.seenFetchKeys.size,
      extractedItems: this.seenExtractKeys.size,
    };
  }
}

/**
 * Factory function to create a DedupChecker instance.
 * Pass stores for cross-run dedup, or omit for in-memory-only mode.
 * @param storesOrOpts — DedupStores, or an options bag { stores?, maxSize? }
 * @param maxSize — maximum number of keys kept in-memory before eviction (default: 500_000)
 */
export function createDedupChecker(
  storesOrOpts?: DedupStores | { stores?: DedupStores; maxSize?: number },
  maxSize?: number,
): DedupChecker {
  // Support both positional and options-bag calling conventions
  if (storesOrOpts && 'maxSize' in storesOrOpts && !('evidence' in storesOrOpts) && !('candidates' in storesOrOpts)) {
    return new DedupChecker(storesOrOpts.stores, storesOrOpts.maxSize);
  }
  return new DedupChecker(storesOrOpts as DedupStores | undefined, maxSize);
}
