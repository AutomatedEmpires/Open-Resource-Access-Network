/**
 * Fetcher module for the ingestion agent.
 *
 * This module provides components for:
 * - Fetching web pages with redirect handling and content hashing
 * - Extracting readable text from HTML
 * - Discovering relevant links (contact, apply, eligibility, etc.)
 * - Building evidence snapshots for the pipeline
 * - Deduplication checking
 */

// Types
export type {
  DiscoveredLinkResult,
  Fetcher,
  FetchError,
  FetchErrorCode,
  FetcherOptions,
  FetchResult,
  LinkDiscoveryOptions,
  LinkType,
  TextExtractionOptions,
  TextExtractionResult,
} from './types';

export {
  DiscoveredLinkResultSchema,
  FetchErrorCodeSchema,
  FetchErrorSchema,
  FetcherOptionsSchema,
  FetchResultSchema,
  LinkDiscoveryOptionsSchema,
  LinkTypeSchema,
  TextExtractionOptionsSchema,
  TextExtractionResultSchema,
} from './types';

// Fetcher
export { createPageFetcher, isFetchError, isFetchSuccess, PageFetcher } from './fetcher';

// HTML Extractor
export { createHtmlTextExtractor, extractTextFromHtml, HtmlTextExtractor } from './htmlExtractor';

// Link Discovery
export { createLinkDiscovery, discoverLinks, LinkDiscovery } from './linkDiscovery';

// Evidence Builder
export { buildEvidenceSnapshot, createEvidenceBuilder, EvidenceBuilder } from './evidenceBuilder';

// Dedup Integration
export {
  computeExtractKeySha256,
  computeFetchKeySha256,
  createDedupChecker,
  DedupChecker,
} from './dedupIntegration';
export type { DedupCheckResult } from './dedupIntegration';
