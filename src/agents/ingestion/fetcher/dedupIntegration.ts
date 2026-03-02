/**
 * Dedup integration for the fetcher module.
 * Re-exports and extends the existing dedupe utilities for use within the fetcher pipeline.
 */

// Re-export the core dedup functions
export { computeExtractKeySha256, computeFetchKeySha256 } from '../dedupe';

/**
 * Check if a URL has already been fetched by comparing fetch keys.
 * Default implementation is in-memory and scoped to a single process/run.
 * For cross-run dedupe, integrate with the evidence/extraction stores.
 */
export interface DedupCheckResult {
  isDuplicate: boolean;
  existingEvidenceId?: string;
  existingFetchedAt?: string;
  existingContentHash?: string;
}

/**
 * DedupChecker provides methods to check for duplicate fetches and extractions.
 * For persistence across runs, implement a store-backed checker and swap it in at the call site.
 */
export class DedupChecker {
  private readonly seenFetchKeys = new Set<string>();
  private readonly seenExtractKeys = new Set<string>();

  /**
   * Check if a URL has already been fetched in this session.
   * Note: For persistence across sessions, this should query the evidence store.
   */
  hasFetchedUrl(fetchKey: string): boolean {
    return this.seenFetchKeys.has(fetchKey);
  }

  /**
   * Mark a URL as fetched in this session.
   */
  markFetched(fetchKey: string): void {
    this.seenFetchKeys.add(fetchKey);
  }

  /**
   * Check if content has already been extracted.
   */
  hasExtracted(extractKey: string): boolean {
    return this.seenExtractKeys.has(extractKey);
  }

  /**
   * Mark content as extracted.
   */
  markExtracted(extractKey: string): void {
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
 */
export function createDedupChecker(): DedupChecker {
  return new DedupChecker();
}
