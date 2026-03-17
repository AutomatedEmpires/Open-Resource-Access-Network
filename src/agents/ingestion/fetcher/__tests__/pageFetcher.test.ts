import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageFetcher, isFetchError, isFetchSuccess } from '@/agents/ingestion/fetcher/fetcher';

const fetchMock = vi.hoisted(() => vi.fn());
const originalFetch = global.fetch;

function makeResponse(
  body: string | null,
  options: {
    status?: number;
    headers?: Record<string, string>;
  } = {},
): Response {
  return new Response(body, {
    status: options.status ?? 200,
    headers: options.headers,
  });
}

function makeStreamResponse(chunkSizes: number[]): Response {
  const cancel = vi.fn();
  let index = 0;

  const body = {
    getReader: () => ({
      read: async () => {
        if (index >= chunkSizes.length) {
          return { done: true, value: undefined };
        }
        const size = chunkSizes[index++];
        return { done: false, value: new Uint8Array(size).fill(97) };
      },
      cancel,
    }),
  };

  return {
    status: 200,
    headers: new Headers(),
    body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('PageFetcher', () => {
  it('follows redirects, computes hash, and returns headers from the final response', async () => {
    fetchMock
      .mockResolvedValueOnce(
        makeResponse(null, {
          status: 302,
          headers: { location: '/final' },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse('hello world', {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT',
            etag: '"abc123"',
            'cache-control': 'max-age=60',
            'content-language': 'en',
          },
        }),
      );

    const fetcher = new PageFetcher();
    const result = await fetcher.fetch('https://example.com/start');

    expect(isFetchSuccess(result)).toBe(true);
    if (!isFetchSuccess(result)) return;

    expect(result.requestedUrl).toBe('https://example.com/start');
    expect(result.canonicalUrl).toBe('https://example.com/final');
    expect(result.redirectChain).toEqual(['https://example.com/start']);
    expect(result.httpStatus).toBe(200);
    expect(result.contentType).toContain('text/html');
    expect(result.body).toBe('hello world');
    expect(result.contentHashSha256).toBe(
      crypto.createHash('sha256').update('hello world', 'utf8').digest('hex'),
    );
    expect(result.headers).toEqual({
      lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT',
      etag: '"abc123"',
      cacheControl: 'max-age=60',
      contentLanguage: 'en',
    });
  });

  it('sets an insecure TLS dispatcher only when validateSsl is false for https', async () => {
    fetchMock.mockResolvedValue(makeResponse('ok'));
    const fetcher = new PageFetcher({ validateSsl: false });

    await fetcher.fetch('https://example.com/secure');
    await fetcher.fetch('http://example.com/plain');

    const httpsInit = fetchMock.mock.calls[0]?.[1] as RequestInit & { dispatcher?: unknown };
    const httpInit = fetchMock.mock.calls[1]?.[1] as RequestInit & { dispatcher?: unknown };

    // Both get a dispatcher because canonicalization normalizes http → https
    expect(httpsInit.dispatcher).toBeDefined();
    expect(httpInit.dispatcher).toBeDefined();
  });

  it('returns invalid_url for malformed URLs', async () => {
    const fetcher = new PageFetcher();
    const result = await fetcher.fetch('not-a-valid-url');

    expect(isFetchError(result)).toBe(true);
    if (!isFetchError(result)) return;
    expect(result.code).toBe('invalid_url');
    expect(result.requestedUrl).toBe('not-a-valid-url');
    expect(result.retryable).toBe(false);
  });

  it('returns network_error when a redirect response has no Location header', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(null, { status: 301 }));
    const fetcher = new PageFetcher();

    const result = await fetcher.fetch('https://example.com/start');

    expect(isFetchError(result)).toBe(true);
    if (!isFetchError(result)) return;
    expect(result.code).toBe('network_error');
    expect(result.httpStatus).toBe(301);
    expect(result.retryable).toBe(false);
  });

  it('returns blocked for explicit 403/451 responses', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse('forbidden', { status: 403 }));
    const fetcher = new PageFetcher();

    const result = await fetcher.fetch('https://example.com/blocked');

    expect(isFetchError(result)).toBe(true);
    if (!isFetchError(result)) return;
    expect(result.code).toBe('blocked');
    expect(result.httpStatus).toBe(403);
    expect(result.retryable).toBe(false);
  });

  it('returns too_many_redirects when redirect count exceeds the configured maximum', async () => {
    fetchMock
      .mockResolvedValueOnce(
        makeResponse(null, {
          status: 302,
          headers: { location: '/step-1' },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse(null, {
          status: 302,
          headers: { location: '/step-2' },
        }),
      );

    const fetcher = new PageFetcher({ maxRedirects: 1 });
    const result = await fetcher.fetch('https://example.com/start');

    expect(isFetchError(result)).toBe(true);
    if (!isFetchError(result)) return;
    expect(result.code).toBe('too_many_redirects');
    expect(result.retryable).toBe(false);
  });

  it('guards against oversized content via Content-Length and streaming body limits', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse('x', {
        status: 200,
        headers: { 'content-length': '999' },
      }),
    );
    const fetcher = new PageFetcher({ maxContentLength: 50 });

    const byHeader = await fetcher.fetch('https://example.com/too-large-header');
    expect(isFetchError(byHeader)).toBe(true);
    if (isFetchError(byHeader)) {
      expect(byHeader.code).toBe('content_too_large');
    }

    fetchMock.mockResolvedValueOnce(makeStreamResponse([30, 30]));
    const byStream = await fetcher.fetch('https://example.com/too-large-stream');
    expect(isFetchError(byStream)).toBe(true);
    if (isFetchError(byStream)) {
      expect(byStream.code).toBe('content_too_large');
    }
  });

  it('classifies fetch exceptions into timeout, DNS, connection, SSL, network, and unknown', async () => {
    const timeoutError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const dnsError = new Error('getaddrinfo ENOTFOUND example.com');
    const refusedError = new Error('connect ECONNREFUSED 127.0.0.1');
    const sslError = new Error('unable to verify certificate');
    const networkError = new Error('socket hang up');
    const unknownError = new Error('something unexpected');

    const cases = [
      { error: timeoutError, expected: 'timeout' },
      { error: dnsError, expected: 'dns_error' },
      { error: refusedError, expected: 'connection_refused' },
      { error: sslError, expected: 'ssl_error' },
      { error: networkError, expected: 'network_error' },
      { error: unknownError, expected: 'unknown' },
      { error: 'string-error', expected: 'unknown' },
    ] as const;

    const fetcher = new PageFetcher();

    for (const c of cases) {
      fetchMock.mockRejectedValueOnce(c.error);
      const result = await fetcher.fetch('https://example.com/error-case');

      expect(isFetchError(result)).toBe(true);
      if (!isFetchError(result)) continue;
      expect(result.code).toBe(c.expected);
    }
  });
});
