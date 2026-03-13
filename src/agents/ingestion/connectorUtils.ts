/**
 * Shared utilities for feed connectors (HSDS, 211 NDP, etc.).
 *
 * Provides canonical hashing, stable serialization, transient error
 * classification, and URL building — used by all connector modules.
 */

import { createHash } from 'node:crypto';

/**
 * SHA-256 hash of a string, returned as hex.
 * Used for payload deduplication in source records.
 */
export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Deterministic JSON serialization with sorted keys.
 * Semantically identical payloads always produce the same string,
 * regardless of original key ordering.
 */
export function stableStringify(value: unknown): string {
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

/**
 * Classify whether a fetch error is transient (retryable).
 * Returns true for: timeouts, connection resets, DNS failures, 5xx HTTP.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes('timeout') || msg.includes('ECONNRESET') || msg.includes('ENOTFOUND')) return true;
    if (/returned 5\d\d/.test(msg)) return true;
  }
  return false;
}

/**
 * Build a full URL from a base and relative path.
 * Normalizes trailing slashes on the base.
 */
export function buildUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${path}`;
}
