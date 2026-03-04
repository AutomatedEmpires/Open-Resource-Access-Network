import { z } from 'zod';

/**
 * Options for configuring the page fetcher.
 */
export const FetcherOptionsSchema = z
  .object({
    /** Maximum time in milliseconds to wait for the response */
    timeoutMs: z.number().int().positive().default(30_000),
    /** Maximum number of redirects to follow */
    maxRedirects: z.number().int().min(0).max(20).default(10),
    /** User-Agent header to send */
    userAgent: z.string().min(1).default('ORAN-IngestionAgent/1.0'),
    /** Accept header */
    accept: z.string().min(1).default('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
    /** Whether to validate SSL certificates */
    validateSsl: z.boolean().default(true),
    /** Maximum content length to fetch (bytes) */
    maxContentLength: z.number().int().positive().default(10 * 1024 * 1024), // 10MB
  })
  .strict();
export type FetcherOptions = z.infer<typeof FetcherOptionsSchema>;

/**
 * Minimal interface for a page fetcher.
 * Production code uses PageFetcher; tests can supply a mock.
 */
export interface Fetcher {
  fetch(url: string): Promise<FetchResult | FetchError>;
}

/**
 * Result of a successful page fetch.
 */
export const FetchResultSchema = z
  .object({
    /** The original URL that was requested */
    requestedUrl: z.string().url(),
    /** The final URL after following all redirects */
    canonicalUrl: z.string().url(),
    /** HTTP status code of the final response */
    httpStatus: z.number().int().min(100).max(599),
    /** Content-Type header value */
    contentType: z.string().optional(),
    /** SHA-256 hash of the response body */
    contentHashSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    /** The raw response body (HTML or other content) */
    body: z.string(),
    /** Size of the response body in bytes */
    contentLength: z.number().int().min(0),
    /** When the fetch completed */
    fetchedAt: z.string().datetime(),
    /** Chain of redirects followed (if any) */
    redirectChain: z.array(z.string().url()).default([]),
    /** Response headers (selected useful ones) */
    headers: z
      .object({
        lastModified: z.string().optional(),
        etag: z.string().optional(),
        cacheControl: z.string().optional(),
        contentLanguage: z.string().optional(),
      })
      .default({}),
  })
  .strict();
export type FetchResult = z.infer<typeof FetchResultSchema>;

/**
 * Error categories for fetch failures.
 */
export const FetchErrorCodeSchema = z.enum([
  'timeout',
  'dns_error',
  'connection_refused',
  'ssl_error',
  'too_many_redirects',
  'content_too_large',
  'invalid_url',
  'network_error',
  'blocked',
  'unknown',
]);
export type FetchErrorCode = z.infer<typeof FetchErrorCodeSchema>;

/**
 * Structured fetch error with classification.
 */
export const FetchErrorSchema = z
  .object({
    code: FetchErrorCodeSchema,
    message: z.string().min(1),
    requestedUrl: z.string().url(),
    httpStatus: z.number().int().min(0).max(599).optional(),
    retryable: z.boolean(),
    failedAt: z.string().datetime(),
  })
  .strict();
export type FetchError = z.infer<typeof FetchErrorSchema>;

/**
 * Options for HTML text extraction.
 */
export const TextExtractionOptionsSchema = z
  .object({
    /** Maximum text length to return */
    maxTextLength: z.number().int().positive().default(100_000),
    /** Whether to preserve some structure (paragraphs) */
    preserveParagraphs: z.boolean().default(true),
    /** Selectors to remove from content */
    removeSelectors: z
      .array(z.string())
      .default([
        'script',
        'style',
        'noscript',
        'iframe',
        'nav',
        'header',
        'footer',
        'aside',
        '[role="navigation"]',
        '[role="banner"]',
        '[role="contentinfo"]',
        '.nav',
        '.navbar',
        '.header',
        '.footer',
        '.sidebar',
        '.menu',
        '.advertisement',
        '.ad',
        '.cookie-banner',
        '.popup',
        '.modal',
      ]),
    /** Selectors to prioritize for main content */
    mainContentSelectors: z
      .array(z.string())
      .default(['main', '[role="main"]', 'article', '.content', '.main-content', '#content', '#main']),
  })
  .strict();
export type TextExtractionOptions = z.infer<typeof TextExtractionOptionsSchema>;

/**
 * Result of HTML text extraction.
 */
export const TextExtractionResultSchema = z
  .object({
    /** The extracted plain text */
    text: z.string(),
    /** Detected page title */
    title: z.string().optional(),
    /** Meta description if present */
    metaDescription: z.string().optional(),
    /** Detected language (from html lang or meta) */
    language: z.string().optional(),
    /** Whether main content selector was found */
    usedMainContentSelector: z.boolean(),
    /** Approximate word count */
    wordCount: z.number().int().min(0),
  })
  .strict();
export type TextExtractionResult = z.infer<typeof TextExtractionResultSchema>;

/**
 * Link type classification for discovery.
 */
export const LinkTypeSchema = z.enum([
  'home',
  'contact',
  'apply',
  'eligibility',
  'intake_form',
  'hours',
  'pdf',
  'privacy',
  'other',
]);
export type LinkType = z.infer<typeof LinkTypeSchema>;

/**
 * A discovered link from HTML content.
 */
export const DiscoveredLinkResultSchema = z
  .object({
    url: z.string().url(),
    type: LinkTypeSchema,
    label: z.string().optional(),
    confidence: z.number().min(0).max(1).default(0.5),
    context: z.string().optional(),
  })
  .strict();
export type DiscoveredLinkResult = z.infer<typeof DiscoveredLinkResultSchema>;

/**
 * Options for link discovery.
 */
export const LinkDiscoveryOptionsSchema = z
  .object({
    /** Maximum number of links to return */
    maxLinks: z.number().int().positive().default(50),
    /** Minimum confidence threshold */
    minConfidence: z.number().min(0).max(1).default(0.3),
    /** Whether to include external links */
    includeExternal: z.boolean().default(true),
    /** Whether to resolve relative URLs */
    resolveRelative: z.boolean().default(true),
  })
  .strict();
export type LinkDiscoveryOptions = z.infer<typeof LinkDiscoveryOptionsSchema>;
