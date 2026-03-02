import crypto from 'node:crypto';

import { Agent } from 'undici';

import { canonicalizeUrl } from '../sourceRegistry';

import {
  type FetchError,
  type FetchErrorCode,
  type FetcherOptions,
  FetcherOptionsSchema,
  type FetchResult,
} from './types';

/**
 * PageFetcher handles fetching URLs with proper redirect handling,
 * content hashing, and error classification.
 *
 * This is a minimal implementation using Node's native fetch API
 * with redirect handling and content hash computation.
 */
export class PageFetcher {
  private readonly options: FetcherOptions;

  private static readonly insecureTlsDispatcher = new Agent({
    connect: {
      rejectUnauthorized: false,
    },
  });

  constructor(options: Partial<FetcherOptions> = {}) {
    this.options = FetcherOptionsSchema.parse(options);
  }

  /**
   * Fetch a URL and return the result with content hash.
   * Follows redirects up to maxRedirects and captures the redirect chain.
   */
  async fetch(url: string): Promise<FetchResult | FetchError> {
    let requestedUrl = url;
    const redirectChain: string[] = [];
    let currentUrl = url;
    let redirectCount = 0;

    // Validate + canonicalize URL
    try {
      requestedUrl = canonicalizeUrl(url);
      currentUrl = requestedUrl;
    } catch {
      return this.createError('invalid_url', `Invalid URL format: ${url}`, url, false);
    }

    try {
      // Use manual redirect handling to capture the chain
      while (redirectCount <= this.options.maxRedirects) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

        try {
          const requestInit: RequestInit & { dispatcher?: unknown } = {
            method: 'GET',
            headers: {
              'User-Agent': this.options.userAgent,
              Accept: this.options.accept,
            },
            redirect: 'manual', // Handle redirects manually
            signal: controller.signal,
          };

          // Allow explicit opt-out of TLS verification (unsafe; use only in controlled dev/test).
          if (!this.options.validateSsl && currentUrl.startsWith('https:')) {
            requestInit.dispatcher = PageFetcher.insecureTlsDispatcher;
          }

          const response = await fetch(currentUrl, requestInit);

          clearTimeout(timeoutId);

          // Check for redirect
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) {
              return this.createError(
                'network_error',
                `Redirect without Location header at ${currentUrl}`,
                requestedUrl,
                false,
                response.status
              );
            }

            // Record current URL in chain before following redirect
            redirectChain.push(currentUrl);

            // Resolve relative redirects
            currentUrl = canonicalizeUrl(new URL(location, currentUrl).href);
            redirectCount++;
            continue;
          }

          // Explicit blocking by upstream (no point parsing body)
          if (response.status === 403 || response.status === 451) {
            return this.createError(
              'blocked',
              `Access blocked (HTTP ${response.status})`,
              requestedUrl,
              false,
              response.status
            );
          }

          // Not a redirect - process the response
          const contentType = response.headers.get('content-type') ?? undefined;
          const contentLengthHeader = response.headers.get('content-length');
          const expectedLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;

          // Check content length before fetching body
          if (expectedLength && expectedLength > this.options.maxContentLength) {
            return this.createError(
              'content_too_large',
              `Content-Length ${expectedLength} exceeds maximum ${this.options.maxContentLength}`,
              requestedUrl,
              false,
              response.status
            );
          }

          // Read body with size limit
          const body = await this.readBodyWithLimit(response, this.options.maxContentLength);

          // Compute content hash
          const contentHashSha256 = crypto.createHash('sha256').update(body, 'utf8').digest('hex');

          return {
            requestedUrl,
            canonicalUrl: currentUrl,
            httpStatus: response.status,
            contentType,
            contentHashSha256,
            body,
            contentLength: Buffer.byteLength(body, 'utf8'),
            fetchedAt: new Date().toISOString(),
            redirectChain,
            headers: {
              lastModified: response.headers.get('last-modified') ?? undefined,
              etag: response.headers.get('etag') ?? undefined,
              cacheControl: response.headers.get('cache-control') ?? undefined,
              contentLanguage: response.headers.get('content-language') ?? undefined,
            },
          };
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      }

      // Exceeded max redirects
      return this.createError(
        'too_many_redirects',
        `Exceeded maximum redirects (${this.options.maxRedirects})`,
        requestedUrl,
        false
      );
    } catch (error) {
      return this.classifyError(error, requestedUrl);
    }
  }

  /**
   * Read response body with a size limit.
   */
  private async readBodyWithLimit(response: Response, maxLength: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      return '';
    }

    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalLength += value.length;
      if (totalLength > maxLength) {
        reader.cancel();
        throw new ContentTooLargeError(`Response body exceeds ${maxLength} bytes`);
      }

      chunks.push(value);
    }

    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder('utf-8', { fatal: false }).decode(combined);
  }

  /**
   * Create a structured fetch error.
   */
  private createError(
    code: FetchErrorCode,
    message: string,
    requestedUrl: string,
    retryable: boolean,
    httpStatus?: number
  ): FetchError {
    return {
      code,
      message,
      requestedUrl,
      httpStatus,
      retryable,
      failedAt: new Date().toISOString(),
    };
  }

  /**
   * Classify an exception into a structured error.
   */
  private classifyError(error: unknown, requestedUrl: string): FetchError {
    if (error instanceof ContentTooLargeError) {
      return this.createError('content_too_large', error.message, requestedUrl, false);
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      const name = error.name.toLowerCase();

      // AbortError from timeout
      if (name === 'aborterror' || message.includes('abort')) {
        return this.createError('timeout', 'Request timed out', requestedUrl, true);
      }

      // DNS errors
      if (message.includes('getaddrinfo') || message.includes('enotfound') || message.includes('dns')) {
        return this.createError('dns_error', `DNS resolution failed: ${error.message}`, requestedUrl, true);
      }

      // Connection refused
      if (message.includes('econnrefused') || message.includes('connection refused')) {
        return this.createError(
          'connection_refused',
          `Connection refused: ${error.message}`,
          requestedUrl,
          true
        );
      }

      // SSL errors
      if (
        message.includes('ssl') ||
        message.includes('cert') ||
        message.includes('certificate') ||
        message.includes('unable to verify')
      ) {
        return this.createError('ssl_error', `SSL error: ${error.message}`, requestedUrl, false);
      }

      // Network errors
      if (
        message.includes('network') ||
        message.includes('econnreset') ||
        message.includes('socket') ||
        message.includes('etimedout')
      ) {
        return this.createError('network_error', `Network error: ${error.message}`, requestedUrl, true);
      }

      return this.createError('unknown', error.message, requestedUrl, true);
    }

    return this.createError('unknown', String(error), requestedUrl, true);
  }
}

/**
 * Custom error for content size limit exceeded.
 */
class ContentTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentTooLargeError';
  }
}

/**
 * Type guard to check if a result is a FetchError.
 */
export function isFetchError(result: FetchResult | FetchError): result is FetchError {
  return 'code' in result && 'retryable' in result;
}

/**
 * Type guard to check if a result is a successful FetchResult.
 */
export function isFetchSuccess(result: FetchResult | FetchError): result is FetchResult {
  return 'body' in result && 'contentHashSha256' in result;
}

/**
 * Factory function to create a PageFetcher with default options.
 */
export function createPageFetcher(options: Partial<FetcherOptions> = {}): PageFetcher {
  return new PageFetcher(options);
}
