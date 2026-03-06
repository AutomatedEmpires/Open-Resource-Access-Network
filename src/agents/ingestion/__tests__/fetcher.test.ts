import { describe, expect, it, beforeEach } from 'vitest';

import { EvidenceSnapshotSchema, DiscoveredLinkSchema, type DiscoveredLink } from '../contracts';

import {
  // Types
  FetcherOptionsSchema,
  FetchResultSchema,
  FetchErrorSchema,
  TextExtractionOptionsSchema,
  LinkDiscoveryOptionsSchema,
  // Fetcher
  isFetchError,
  isFetchSuccess,
  createPageFetcher,
  // HTML Extractor
  HtmlTextExtractor,
  createHtmlTextExtractor,
  extractTextFromHtml,
  // Link Discovery
  LinkDiscovery,
  createLinkDiscovery,
  discoverLinks,
  // Evidence Builder
  createEvidenceBuilder,
  buildEvidenceSnapshot,
  // Dedup
  DedupChecker,
  createDedupChecker,
  computeFetchKeySha256,
  computeExtractKeySha256,
  // Types
  type DiscoveredLinkResult,
} from '../fetcher/index';

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Fetcher Schema Validation', () => {
  describe('FetcherOptionsSchema', () => {
    it('should accept empty object and apply defaults', () => {
      const result = FetcherOptionsSchema.parse({});
      expect(result.timeoutMs).toBe(30_000);
      expect(result.maxRedirects).toBe(10);
      expect(result.userAgent).toBe('ORAN-IngestionAgent/1.0');
      expect(result.validateSsl).toBe(true);
      expect(result.maxContentLength).toBe(10 * 1024 * 1024);
    });

    it('should accept custom options', () => {
      const result = FetcherOptionsSchema.parse({
        timeoutMs: 5000,
        maxRedirects: 5,
        userAgent: 'CustomAgent/1.0',
      });
      expect(result.timeoutMs).toBe(5000);
      expect(result.maxRedirects).toBe(5);
      expect(result.userAgent).toBe('CustomAgent/1.0');
    });

    it('should reject invalid timeout', () => {
      expect(() => FetcherOptionsSchema.parse({ timeoutMs: -1 })).toThrow();
      expect(() => FetcherOptionsSchema.parse({ timeoutMs: 0 })).toThrow();
    });

    it('should reject invalid maxRedirects', () => {
      expect(() => FetcherOptionsSchema.parse({ maxRedirects: -1 })).toThrow();
      expect(() => FetcherOptionsSchema.parse({ maxRedirects: 21 })).toThrow();
    });
  });

  describe('FetchResultSchema', () => {
    it('should validate a complete fetch result', () => {
      const result = FetchResultSchema.parse({
        requestedUrl: 'https://example.com/page',
        canonicalUrl: 'https://www.example.com/page',
        httpStatus: 200,
        contentType: 'text/html',
        contentHashSha256: 'a'.repeat(64),
        body: '<html>test</html>',
        contentLength: 17,
        fetchedAt: new Date().toISOString(),
        redirectChain: ['https://example.com/page'],
        headers: { lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT' },
      });
      expect(result.httpStatus).toBe(200);
      expect(result.redirectChain).toHaveLength(1);
    });

    it('should reject invalid content hash', () => {
      expect(() =>
        FetchResultSchema.parse({
          requestedUrl: 'https://example.com',
          canonicalUrl: 'https://example.com',
          httpStatus: 200,
          contentHashSha256: 'invalid-hash',
          body: 'test',
          contentLength: 4,
          fetchedAt: new Date().toISOString(),
        })
      ).toThrow();
    });
  });

  describe('FetchErrorSchema', () => {
    it('should validate a fetch error', () => {
      const result = FetchErrorSchema.parse({
        code: 'timeout',
        message: 'Request timed out',
        requestedUrl: 'https://example.com',
        retryable: true,
        failedAt: new Date().toISOString(),
      });
      expect(result.code).toBe('timeout');
      expect(result.retryable).toBe(true);
    });

    it('should accept optional httpStatus', () => {
      const result = FetchErrorSchema.parse({
        code: 'network_error',
        message: 'Connection reset',
        requestedUrl: 'https://example.com',
        httpStatus: 503,
        retryable: true,
        failedAt: new Date().toISOString(),
      });
      expect(result.httpStatus).toBe(503);
    });
  });

  describe('TextExtractionOptionsSchema', () => {
    it('should apply default options', () => {
      const result = TextExtractionOptionsSchema.parse({});
      expect(result.maxTextLength).toBe(100_000);
      expect(result.preserveParagraphs).toBe(true);
      expect(result.removeSelectors).toContain('script');
      expect(result.mainContentSelectors).toContain('main');
    });
  });

  describe('LinkDiscoveryOptionsSchema', () => {
    it('should apply default options', () => {
      const result = LinkDiscoveryOptionsSchema.parse({});
      expect(result.maxLinks).toBe(50);
      expect(result.minConfidence).toBe(0.3);
      expect(result.includeExternal).toBe(true);
      expect(result.resolveRelative).toBe(true);
    });
  });
});

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('Type Guards', () => {
  const mockFetchResult = {
    requestedUrl: 'https://example.com',
    canonicalUrl: 'https://example.com',
    httpStatus: 200,
    contentHashSha256: 'a'.repeat(64),
    body: 'test',
    contentLength: 4,
    fetchedAt: new Date().toISOString(),
    redirectChain: [],
    headers: {},
  };

  const mockFetchError = {
    code: 'timeout' as const,
    message: 'Request timed out',
    requestedUrl: 'https://example.com',
    retryable: true,
    failedAt: new Date().toISOString(),
  };

  it('isFetchError should identify errors', () => {
    expect(isFetchError(mockFetchError)).toBe(true);
    expect(isFetchError(mockFetchResult)).toBe(false);
  });

  it('isFetchSuccess should identify successful results', () => {
    expect(isFetchSuccess(mockFetchResult)).toBe(true);
    expect(isFetchSuccess(mockFetchError)).toBe(false);
  });
});

// ============================================================================
// HTML Text Extractor Tests
// ============================================================================

describe('HtmlTextExtractor', () => {
  describe('basic extraction', () => {
    it('should extract text from simple HTML', () => {
      const html = '<html><body><p>Hello World</p></body></html>';
      const result = extractTextFromHtml(html);
      expect(result.text).toContain('Hello World');
      expect(result.wordCount).toBeGreaterThan(0);
    });

    it('should extract title from title tag', () => {
      const html = '<html><head><title>Test Page</title></head><body><p>Content</p></body></html>';
      const result = extractTextFromHtml(html);
      expect(result.title).toBe('Test Page');
    });

    it('should extract title from og:title', () => {
      const html =
        '<html><head><meta property="og:title" content="OG Title"></head><body><p>Content</p></body></html>';
      const result = extractTextFromHtml(html);
      expect(result.title).toBe('OG Title');
    });

    it('should extract meta description', () => {
      const html =
        '<html><head><meta name="description" content="Page description"></head><body><p>Content</p></body></html>';
      const result = extractTextFromHtml(html);
      expect(result.metaDescription).toBe('Page description');
    });

    it('should extract language from html lang attribute', () => {
      const html = '<html lang="en-US"><body><p>Content</p></body></html>';
      const result = extractTextFromHtml(html);
      expect(result.language).toBe('en-US');
    });
  });

  describe('content filtering', () => {
    it('should remove script tags', () => {
      const html =
        '<html><body><p>Content</p><script>alert("bad")</script></body></html>';
      const result = extractTextFromHtml(html);
      expect(result.text).not.toContain('alert');
      expect(result.text).toContain('Content');
    });

    it('should remove nav elements', () => {
      const html = '<html><body><nav>Navigation</nav><main><p>Main content</p></main></body></html>';
      const result = extractTextFromHtml(html);
      expect(result.text).not.toContain('Navigation');
      expect(result.text).toContain('Main content');
    });

    it('should remove footer elements', () => {
      const html = '<html><body><main><p>Content</p></main><footer>Footer text</footer></body></html>';
      const result = extractTextFromHtml(html);
      expect(result.text).not.toContain('Footer text');
    });
  });

  describe('main content detection', () => {
    it('should prefer main element', () => {
      const html =
        '<html><body><div>Sidebar with navigation</div><main><p>Important main content that is substantial enough to be recognized. This paragraph contains detailed information about services and resources available to the community. It includes multiple sentences to surpass the minimum content threshold.</p></main></body></html>';
      const result = extractTextFromHtml(html);
      expect(result.usedMainContentSelector).toBe(true);
      expect(result.text).toContain('Important main content');
    });

    it('should prefer article element', () => {
      const html =
        '<html><body><div>Other navigation content</div><article><p>Article content with substantial text that should be extracted from the page. This provides detailed information about the services being offered to community members who need assistance finding resources. The article contains multiple sentences.</p></article></body></html>';
      const result = extractTextFromHtml(html);
      expect(result.usedMainContentSelector).toBe(true);
    });
  });

  describe('factory functions', () => {
    it('createHtmlTextExtractor should create instance', () => {
      const extractor = createHtmlTextExtractor({ maxTextLength: 500 });
      expect(extractor).toBeInstanceOf(HtmlTextExtractor);
    });

    it('extractTextFromHtml convenience function should work', () => {
      const result = extractTextFromHtml('<p>Test</p>');
      expect(result.text).toBeTruthy();
    });
  });
});

// ============================================================================
// Link Discovery Tests
// ============================================================================

describe('LinkDiscovery', () => {
  const baseUrl = 'https://example.org';

  describe('basic link discovery', () => {
    it('should discover links in HTML', () => {
      const html = `
        <html><body>
          <a href="/contact">Contact Us</a>
          <a href="/apply">Apply Now</a>
        </body></html>
      `;
      const links = discoverLinks(html, baseUrl);
      expect(links.length).toBeGreaterThanOrEqual(2);
    });

    it('should resolve relative URLs', () => {
      const html = '<html><body><a href="/page">Link</a></body></html>';
      const links = discoverLinks(html, baseUrl);
      expect(links[0].url).toBe('https://example.org/page');
    });

    it('should skip anchor links', () => {
      const html = '<html><body><a href="#section">Section</a></body></html>';
      const links = discoverLinks(html, baseUrl);
      expect(links.length).toBe(0);
    });

    it('should skip javascript links', () => {
      const html = '<html><body><a href="javascript:void(0)">Click</a></body></html>';
      const links = discoverLinks(html, baseUrl);
      expect(links.length).toBe(0);
    });

    it('should skip mailto links', () => {
      const html = '<html><body><a href="mailto:test@example.com">Email</a></body></html>';
      const links = discoverLinks(html, baseUrl);
      expect(links.length).toBe(0);
    });
  });

  describe('link classification', () => {
    it('should classify contact links', () => {
      const html = '<html><body><a href="/contact-us">Contact Us</a></body></html>';
      const links = discoverLinks(html, baseUrl);
      const contactLink = links.find((l: DiscoveredLinkResult) => l.type === 'contact');
      expect(contactLink).toBeDefined();
      expect(contactLink!.confidence).toBeGreaterThan(0.5);
    });

    it('should classify apply links', () => {
      const html = '<html><body><a href="/apply-now">Apply Now</a></body></html>';
      const links = discoverLinks(html, baseUrl);
      const applyLink = links.find((l: DiscoveredLinkResult) => l.type === 'apply');
      expect(applyLink).toBeDefined();
    });

    it('should classify eligibility links', () => {
      const html = '<html><body><a href="/eligibility">Who We Serve</a></body></html>';
      const links = discoverLinks(html, baseUrl);
      const eligLink = links.find((l: DiscoveredLinkResult) => l.type === 'eligibility');
      expect(eligLink).toBeDefined();
    });

    it('should classify PDF links', () => {
      const html = '<html><body><a href="/docs/brochure.pdf">Download Brochure</a></body></html>';
      const links = discoverLinks(html, baseUrl);
      const pdfLink = links.find((l: DiscoveredLinkResult) => l.type === 'pdf');
      expect(pdfLink).toBeDefined();
      expect(pdfLink!.confidence).toBeGreaterThan(0.9);
    });

    it('should classify hours links', () => {
      const html = '<html><body><a href="/hours">Hours &amp; Location</a></body></html>';
      const links = discoverLinks(html, baseUrl);
      const hoursLink = links.find((l: DiscoveredLinkResult) => l.type === 'hours');
      expect(hoursLink).toBeDefined();
    });
  });

  describe('deduplication', () => {
    it('should deduplicate identical URLs', () => {
      const html = `
        <html><body>
          <a href="/contact">Contact</a>
          <a href="/contact">Contact Us</a>
        </body></html>
      `;
      const links = discoverLinks(html, baseUrl);
      const contactLinks = links.filter((l: DiscoveredLinkResult) => l.url.includes('/contact'));
      expect(contactLinks.length).toBe(1);
    });
  });

  describe('options', () => {
    it('should respect maxLinks option', () => {
      const html = `
        <html><body>
          <a href="/a">A</a>
          <a href="/b">B</a>
          <a href="/c">C</a>
          <a href="/d">D</a>
          <a href="/e">E</a>
        </body></html>
      `;
      const links = discoverLinks(html, baseUrl, { maxLinks: 2 });
      expect(links.length).toBeLessThanOrEqual(2);
    });

    it('should filter by minConfidence', () => {
      const html = '<html><body><a href="/random-page">Random</a></body></html>';
      const links = discoverLinks(html, baseUrl, { minConfidence: 0.9 });
      // Random links should be classified as 'other' with low confidence
      expect(links.length).toBe(0);
    });
  });

  describe('factory functions', () => {
    it('createLinkDiscovery should create instance', () => {
      const discovery = createLinkDiscovery({ maxLinks: 10 });
      expect(discovery).toBeInstanceOf(LinkDiscovery);
    });
  });
});

// ============================================================================
// Evidence Builder Tests
// ============================================================================

describe('EvidenceBuilder', () => {
  const mockFetchResult = {
    requestedUrl: 'https://example.com/page',
    canonicalUrl: 'https://www.example.com/page',
    httpStatus: 200,
    contentType: 'text/html',
    contentHashSha256: 'a'.repeat(64),
    body: '<html>test</html>',
    contentLength: 17,
    fetchedAt: '2024-01-01T00:00:00.000Z',
    redirectChain: ['https://example.com/page'],
    headers: {},
  };

  describe('generateEvidenceId', () => {
    it('should generate deterministic IDs', () => {
      const builder = createEvidenceBuilder();
      const id1 = builder.generateEvidenceId('https://example.com', 'hash1');
      const id2 = builder.generateEvidenceId('https://example.com', 'hash1');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different inputs', () => {
      const builder = createEvidenceBuilder();
      const id1 = builder.generateEvidenceId('https://example.com', 'hash1');
      const id2 = builder.generateEvidenceId('https://example.com', 'hash2');
      expect(id1).not.toBe(id2);
    });

    it('should generate 32-character IDs', () => {
      const builder = createEvidenceBuilder();
      const id = builder.generateEvidenceId('https://example.com', 'a'.repeat(64));
      expect(id).toHaveLength(32);
    });
  });

  describe('buildFromFetchResult', () => {
    it('should create valid EvidenceSnapshot', () => {
      const builder = createEvidenceBuilder();
      const snapshot = builder.buildFromFetchResult(mockFetchResult);

      // Validate against schema
      expect(() => EvidenceSnapshotSchema.parse(snapshot)).not.toThrow();

      expect(snapshot.canonicalUrl).toBe(mockFetchResult.canonicalUrl);
      expect(snapshot.httpStatus).toBe(200);
      expect(snapshot.contentHashSha256).toBe(mockFetchResult.contentHashSha256);
    });

    it('should include blobUri when provided', () => {
      const builder = createEvidenceBuilder();
      const blobUri = 'https://storage.example.com/blob/123';
      const snapshot = builder.buildFromFetchResult(mockFetchResult, blobUri);
      expect(snapshot.blobUri).toBe(blobUri);
    });
  });

  describe('convertDiscoveredLinks', () => {
    it('should convert links to contract format', () => {
      const builder = createEvidenceBuilder();
      const links = [
        { url: 'https://example.com/contact', type: 'contact' as const, confidence: 0.9 },
        { url: 'https://example.com/apply', type: 'apply' as const, label: 'Apply Now', confidence: 0.85 },
      ];

      const converted = builder.convertDiscoveredLinks(links, 'evidence123');

      expect(converted).toHaveLength(2);
      converted.forEach((link: DiscoveredLink) => {
        expect(() => DiscoveredLinkSchema.parse(link)).not.toThrow();
        expect(link.evidenceId).toBe('evidence123');
      });
    });
  });

  describe('buildEvidencePackage', () => {
    it('should return snapshot and converted links', () => {
      const builder = createEvidenceBuilder();
      const links = [{ url: 'https://example.com/contact', type: 'contact' as const, confidence: 0.9 }];

      const result = builder.buildEvidencePackage(mockFetchResult, links);

      expect(result.snapshot).toBeDefined();
      expect(result.links).toHaveLength(1);
      expect(result.links[0].evidenceId).toBe(result.snapshot.evidenceId);
    });
  });

  describe('convenience functions', () => {
    it('buildEvidenceSnapshot should work', () => {
      const snapshot = buildEvidenceSnapshot(mockFetchResult);
      expect(snapshot.canonicalUrl).toBe(mockFetchResult.canonicalUrl);
    });
  });
});

// ============================================================================
// Dedup Checker Tests
// ============================================================================

describe('DedupChecker', () => {
  let checker: DedupChecker;

  beforeEach(() => {
    checker = createDedupChecker();
  });

  describe('fetch tracking', () => {
    it('should track fetched URLs', async () => {
      const fetchKey = computeFetchKeySha256('https://example.com');
      expect(await checker.hasFetchedUrl(fetchKey)).toBe(false);

      checker.markFetched(fetchKey);
      expect(await checker.hasFetchedUrl(fetchKey)).toBe(true);
    });

    it('should track multiple URLs independently', async () => {
      const key1 = computeFetchKeySha256('https://example.com/a');
      const key2 = computeFetchKeySha256('https://example.com/b');

      checker.markFetched(key1);

      expect(await checker.hasFetchedUrl(key1)).toBe(true);
      expect(await checker.hasFetchedUrl(key2)).toBe(false);
    });
  });

  describe('extract tracking', () => {
    it('should track extracted content', async () => {
      const extractKey = computeExtractKeySha256('https://example.com', 'hash123');
      expect(await checker.hasExtracted(extractKey)).toBe(false);

      checker.markExtracted(extractKey);
      expect(await checker.hasExtracted(extractKey)).toBe(true);
    });
  });

  describe('reset', () => {
    it('should clear all tracked items', async () => {
      const fetchKey = computeFetchKeySha256('https://example.com');
      const extractKey = computeExtractKeySha256('https://example.com', 'hash');

      checker.markFetched(fetchKey);
      checker.markExtracted(extractKey);

      checker.reset();

      expect(await checker.hasFetchedUrl(fetchKey)).toBe(false);
      expect(await checker.hasExtracted(extractKey)).toBe(false);
    });
  });

  describe('getCounts', () => {
    it('should return accurate counts', () => {
      expect(checker.getCounts()).toEqual({ fetchedUrls: 0, extractedItems: 0 });

      checker.markFetched(computeFetchKeySha256('url1'));
      checker.markFetched(computeFetchKeySha256('url2'));
      checker.markExtracted(computeExtractKeySha256('url1', 'hash'));

      expect(checker.getCounts()).toEqual({ fetchedUrls: 2, extractedItems: 1 });
    });
  });
});

// ============================================================================
// Hash Function Tests
// ============================================================================

describe('Hash Functions', () => {
  describe('computeFetchKeySha256', () => {
    it('should produce consistent hashes', () => {
      const url = 'https://example.com/page';
      const hash1 = computeFetchKeySha256(url);
      const hash2 = computeFetchKeySha256(url);
      expect(hash1).toBe(hash2);
    });

    it('should produce 64-character hex strings', () => {
      const hash = computeFetchKeySha256('https://example.com');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different URLs', () => {
      const hash1 = computeFetchKeySha256('https://example.com/a');
      const hash2 = computeFetchKeySha256('https://example.com/b');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('computeExtractKeySha256', () => {
    it('should combine URL and content hash', () => {
      const hash1 = computeExtractKeySha256('https://example.com', 'content-hash-1');
      const hash2 = computeExtractKeySha256('https://example.com', 'content-hash-2');
      const hash3 = computeExtractKeySha256('https://other.com', 'content-hash-1');

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });
});

// ============================================================================
// PageFetcher Tests (Factory Only - network tests require mocking)
// ============================================================================

describe('PageFetcher', () => {
  describe('factory', () => {
    it('createPageFetcher should create instance with defaults', () => {
      const fetcher = createPageFetcher();
      expect(fetcher).toBeDefined();
    });

    it('createPageFetcher should accept custom options', () => {
      const fetcher = createPageFetcher({
        timeoutMs: 5000,
        maxRedirects: 3,
      });
      expect(fetcher).toBeDefined();
    });
  });
});
