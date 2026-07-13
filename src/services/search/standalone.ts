import type { SearchResult } from './types';

const SNAP_RETAILER_NAME = 'snap/ebt accepted here';
const SNAP_RETAILER_SOURCE_MARKER = 'usda fns snap retailer locator';
const SNAP_RETAILER_PURPOSE_MARKER = 'place to spend snap benefits';

/**
 * Browser-side defense in depth for the historical retailer import.
 * The authoritative source-purpose gate runs in SQL; this keeps an already
 * cached or mocked response from becoming a seeker-facing recommendation.
 */
export function isStandaloneSeekerResult(result: SearchResult): boolean {
  const service = result.service.service;
  const name = service.name.trim().toLowerCase();
  const description = service.description?.toLowerCase() ?? '';

  return !(
    name === SNAP_RETAILER_NAME
    && description.includes(SNAP_RETAILER_SOURCE_MARKER)
    && description.includes(SNAP_RETAILER_PURPOSE_MARKER)
  );
}
