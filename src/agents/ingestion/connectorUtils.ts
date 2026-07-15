/**
 * Shared utilities for feed connectors (HSDS, 211 NDP, etc.).
 *
 * Provides canonical hashing, stable serialization, transient error
 * classification, and URL building — used by all connector modules.
 */

import { createHash } from 'node:crypto';

import { assertAllowedRuntimeEndpoint } from '@/services/runtime/providerPolicy';
import {
  getSafeOutboundDispatcher,
  OutboundHttpPolicyError,
  validateOutboundHttpUrl,
  type OutboundDnsResolver,
} from '@/services/security/outboundHttpPolicy';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_LIMIT = 10;
const MAX_TOTAL_TIMEOUT_MS = 60_000;
const NATIVE_FETCH = globalThis.fetch;

type UndiciRequestInit = RequestInit & {
  dispatcher?: ReturnType<typeof getSafeOutboundDispatcher>;
};

export interface ValidatedRedirectFetchOptions {
  endpointLabel: string;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Override DNS resolution for deterministic tests. */
  resolver?: OutboundDnsResolver;
  requestInit?: Omit<RequestInit, 'redirect' | 'signal'>;
}

/**
 * Fetch an endpoint without allowing the runtime to follow redirects on its
 * own. Each next-hop URL is resolved, policy-checked, and only then requested.
 * This closes the otherwise easy safe-host -> retired-provider redirect path.
 */
export async function fetchWithValidatedRedirects(
  initialUrl: string,
  fetchFn: typeof fetch,
  options: ValidatedRedirectFetchOptions,
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRedirects = options.maxRedirects ?? 5;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TOTAL_TIMEOUT_MS) {
    throw new Error(`Feed total timeout must be an integer between 1 and ${MAX_TOTAL_TIMEOUT_MS}`);
  }
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > MAX_REDIRECT_LIMIT) {
    throw new Error(`Feed redirect limit must be an integer between 0 and ${MAX_REDIRECT_LIMIT}`);
  }

  const deadline = Date.now() + timeoutMs;
  const deadlineSignal = AbortSignal.timeout(timeoutMs);
  const dispatcher = fetchFn === NATIVE_FETCH ? getSafeOutboundDispatcher() : undefined;
  let currentUrl = initialUrl;
  let redirectsFollowed = 0;

  while (true) {
    const remainingTimeoutMs = deadline - Date.now();
    if (remainingTimeoutMs <= 0) throw new Error('Feed total timeout exceeded');

    assertAllowedRuntimeEndpoint(currentUrl, options.endpointLabel);
    let response: Response;
    try {
      const target = await validateOutboundHttpUrl(currentUrl, {
        resolver: options.resolver,
        signal: deadlineSignal,
      });
      const requestInit: UndiciRequestInit = {
        ...options.requestInit,
        redirect: 'manual',
        signal: deadlineSignal,
      };
      if (dispatcher) requestInit.dispatcher = dispatcher;
      response = await fetchFn(target.url.href, requestInit);
    } catch (error) {
      if (deadlineSignal.aborted) {
        throw new Error('Feed total timeout exceeded', { cause: error });
      }
      throw error;
    }

    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) throw new Error('Feed redirect response is missing a Location header');
    if (redirectsFollowed >= maxRedirects) {
      throw new Error(`Feed redirect limit exceeded (${maxRedirects})`);
    }

    try {
      currentUrl = new URL(location, currentUrl).href;
    } catch {
      throw new Error('Feed redirect response contains an invalid Location header');
    }
    redirectsFollowed++;
  }
}

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
  // Policy rejections are deterministic security decisions, never retryable
  // transport failures. Retrying would only repeat a prohibited request.
  if (err instanceof OutboundHttpPolicyError) return false;

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
