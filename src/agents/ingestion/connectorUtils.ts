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
  parseOutboundHttpUrl,
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

async function validateFeedUrl(
  value: string,
  endpointLabel: string,
  resolver: OutboundDnsResolver | undefined,
  signal: AbortSignal,
  resolveDns: boolean,
): Promise<string> {
  const allowed = assertAllowedRuntimeEndpoint(value, endpointLabel);
  if (!resolveDns) return parseOutboundHttpUrl(allowed).href;
  return (await validateOutboundHttpUrl(allowed, { resolver, signal })).url.href;
}

function requestHasSensitiveHeaders(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  const normalized = new Headers(headers);
  return Array.from(normalized.keys()).some((name) =>
    /(?:authorization|cookie|token|secret|api[-_]?key|subscription[-_]?key|dataowners)/iu.test(name),
  );
}

/**
 * Fetch a feed without automatic redirects. Every next-hop endpoint is checked
 * immediately before the network call so a permitted feed cannot redirect the
 * runtime back onto a retired Microsoft provider.
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
  const hasSensitiveHeaders = requestHasSensitiveHeaders(options.requestInit?.headers);
  const dispatcher = fetchFn === NATIVE_FETCH ? getSafeOutboundDispatcher() : undefined;
  // Native fetch is protected both before the request and during socket lookup.
  // Custom fetch implementations own their connection layer; tests can still
  // inject a resolver to exercise deterministic DNS preflight.
  const resolveDns = fetchFn === NATIVE_FETCH || Boolean(options.resolver);
  let currentUrl = initialUrl;
  let redirectsFollowed = 0;

  while (true) {
    if (Date.now() >= deadline) throw new Error('Feed total timeout exceeded');

    currentUrl = await validateFeedUrl(
      currentUrl,
      options.endpointLabel,
      options.resolver,
      deadlineSignal,
      resolveDns,
    );
    const requestInit: UndiciRequestInit = {
      ...options.requestInit,
      redirect: 'manual',
      signal: deadlineSignal,
    };
    if (dispatcher) requestInit.dispatcher = dispatcher;
    const response = await fetchFn(currentUrl, requestInit);

    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    try {
      await response.body?.cancel();
    } catch {
      // The redirect body is disposable; a locked/closed body must not mask policy handling.
    }
    if (!location) throw new Error('Feed redirect response is missing a Location header');
    if (redirectsFollowed >= maxRedirects) {
      throw new Error(`Feed redirect limit exceeded (${maxRedirects})`);
    }

    try {
      const redirectedUrl = new URL(location, currentUrl);
      if (hasSensitiveHeaders && redirectedUrl.origin !== new URL(currentUrl).origin) {
        throw new Error('Feed redirect cannot cross origins while sensitive headers are present');
      }
      currentUrl = redirectedUrl.href;
    } catch {
      throw new Error('Feed redirect response contains an invalid or prohibited Location header');
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
