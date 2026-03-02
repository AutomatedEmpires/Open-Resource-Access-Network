import crypto from 'node:crypto';

import type { DiscoveredLink, EvidenceSnapshot } from '../contracts';
import type { FetchResult } from './types';
import type { DiscoveredLinkResult } from './types';

/**
 * EvidenceBuilder creates structured evidence artifacts from fetch results.
 * It generates unique IDs and converts raw fetcher output into the canonical
 * EvidenceSnapshot format used by the ingestion pipeline.
 */
export class EvidenceBuilder {
  /**
   * Generate a unique evidence ID based on URL and content hash.
   * This ensures the same content from the same URL always gets the same ID.
   */
  generateEvidenceId(canonicalUrl: string, contentHashSha256: string): string {
    const input = `evidence:${canonicalUrl}:${contentHashSha256}`;
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex').substring(0, 32);
  }

  /**
   * Build an EvidenceSnapshot from a successful fetch result.
   */
  buildFromFetchResult(fetchResult: FetchResult, blobUri?: string): EvidenceSnapshot {
    const evidenceId = this.generateEvidenceId(fetchResult.canonicalUrl, fetchResult.contentHashSha256);

    return {
      evidenceId,
      canonicalUrl: fetchResult.canonicalUrl,
      fetchedAt: fetchResult.fetchedAt,
      httpStatus: fetchResult.httpStatus,
      contentType: fetchResult.contentType,
      contentHashSha256: fetchResult.contentHashSha256,
      blobUri,
    };
  }

  /**
   * Convert discovered links from the fetcher format to the contract format.
   */
  convertDiscoveredLinks(links: DiscoveredLinkResult[], evidenceId: string): DiscoveredLink[] {
    return links.map((link) => ({
      url: link.url,
      type: link.type,
      label: link.label,
      evidenceId,
    }));
  }

  /**
   * Build a complete evidence package from a fetch operation.
   * This includes the snapshot and converted discovered links.
   */
  buildEvidencePackage(
    fetchResult: FetchResult,
    discoveredLinks: DiscoveredLinkResult[],
    blobUri?: string
  ): {
    snapshot: EvidenceSnapshot;
    links: DiscoveredLink[];
  } {
    const snapshot = this.buildFromFetchResult(fetchResult, blobUri);
    const links = this.convertDiscoveredLinks(discoveredLinks, snapshot.evidenceId);

    return { snapshot, links };
  }
}

/**
 * Factory function to create an EvidenceBuilder instance.
 */
export function createEvidenceBuilder(): EvidenceBuilder {
  return new EvidenceBuilder();
}

/**
 * Convenience function to build an EvidenceSnapshot from a FetchResult.
 */
export function buildEvidenceSnapshot(fetchResult: FetchResult, blobUri?: string): EvidenceSnapshot {
  return new EvidenceBuilder().buildFromFetchResult(fetchResult, blobUri);
}
