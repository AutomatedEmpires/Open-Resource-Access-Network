/**
 * Tests for src/services/ingestion/docIntelligence.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeDocument,
  isDocIntelligenceConfigured,
  isPdfUrl,
} from '../docIntelligence';

// ============================================================
// Helpers
// ============================================================

/** Build a mock fetch that returns 202 on first call and a poll response on subsequent calls. */
function buildFetchSequence(pollResponses: object[]): ReturnType<typeof vi.fn> {
  let call = 0;
  return vi.fn(async (_url: string) => {
    const i = call++;
    if (i === 0) {
      // Initial POST — 202 Accepted
      return {
        status: 202,
        ok: true,
        headers: {
          get: (h: string) =>
            h === 'Operation-Location'
              ? 'https://test.cognitiveservices.azure.com/operations/abc123'
              : null,
        },
      };
    }
    // Subsequent GETs — poll responses
    const pollData = pollResponses[i - 1] ?? { status: 'running' };
    return {
      ok: true,
      status: 200,
      json: async () => pollData,
    };
  });
}

const SUCCEEDED_RESPONSE = {
  status: 'succeeded',
  analyzeResult: {
    content: 'This is the extracted PDF text.',
    pages: [{ pageNumber: 1 }, { pageNumber: 2 }],
    modelId: 'prebuilt-layout',
  },
};

// ============================================================
// isPdfUrl
// ============================================================

describe('isPdfUrl', () => {
  it('returns true for a .pdf URL', () => {
    expect(isPdfUrl('https://example.org/docs/report.pdf')).toBe(true);
  });

  it('returns true for .PDF (case-insensitive) URL', () => {
    expect(isPdfUrl('https://example.org/docs/REPORT.PDF')).toBe(true);
  });

  it('returns false for .html URL', () => {
    expect(isPdfUrl('https://example.org/page.html')).toBe(false);
  });

  it('returns false for an invalid URL', () => {
    expect(isPdfUrl('not a url')).toBe(false);
  });

  it('returns false for URL with pdf in query string but not extension', () => {
    expect(isPdfUrl('https://example.org/document?type=pdf')).toBe(false);
  });
});

// ============================================================
// isDocIntelligenceConfigured
// ============================================================

describe('isDocIntelligenceConfigured', () => {
  it('returns false when env vars are absent', () => {
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    expect(isDocIntelligenceConfigured()).toBe(false);
  });

  it('returns true when both env vars are set', () => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT =
      'https://test.cognitiveservices.azure.com/';
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'key-abc';
    expect(isDocIntelligenceConfigured()).toBe(true);
  });
});

// ============================================================
// analyzeDocument
// ============================================================

describe('analyzeDocument', () => {
  const originalEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const originalKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  beforeEach(() => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT =
      'https://test.cognitiveservices.azure.com/';
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'test-key';
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = originalEndpoint;
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = originalKey;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns null when not configured', async () => {
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    const result = await analyzeDocument('https://example.org/report.pdf');
    expect(result).toBeNull();
  });

  it('returns null when submit returns non-202', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 400, ok: false }),
    );
    const result = await analyzeDocument('https://example.org/report.pdf');
    expect(result).toBeNull();
  });

  it('returns null when Operation-Location header is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 202,
        ok: true,
        headers: { get: () => null },
      }),
    );
    const result = await analyzeDocument('https://example.org/report.pdf');
    expect(result).toBeNull();
  });

  it('returns null on submit network error (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await analyzeDocument('https://example.org/report.pdf');
    expect(result).toBeNull();
  });

  it('returns DocAnalysisResult when polling succeeds immediately', async () => {
    const fetchMock = buildFetchSequence([SUCCEEDED_RESPONSE]);
    vi.stubGlobal('fetch', fetchMock);

    const promise = analyzeDocument('https://example.org/report.pdf');
    // Advance timer past the first poll interval
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).not.toBeNull();
    expect(result!.text).toBe('This is the extracted PDF text.');
    expect(result!.pages).toBe(2);
    expect(result!.modelId).toBe('prebuilt-layout');
  });

  it('returns result after one "running" poll then "succeeded"', async () => {
    const fetchMock = buildFetchSequence([
      { status: 'running' },
      SUCCEEDED_RESPONSE,
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const promise = analyzeDocument('https://example.org/report.pdf');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).not.toBeNull();
    expect(result!.text).toBe('This is the extracted PDF text.');
  });

  it('returns null when status is "failed"', async () => {
    const fetchMock = buildFetchSequence([{ status: 'failed' }]);
    vi.stubGlobal('fetch', fetchMock);

    const promise = analyzeDocument('https://example.org/report.pdf');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
  });

  it('returns null when poll response is not ok (fail-open)', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (call++ === 0) {
          return {
            status: 202,
            ok: true,
            headers: {
              get: (h: string) =>
                h === 'Operation-Location' ? 'https://test.cognitiveservices.azure.com/op/1' : null,
            },
          };
        }
        return { ok: false, status: 500 };
      }),
    );

    const promise = analyzeDocument('https://example.org/report.pdf');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
  });

  it('caps extracted text at 50 000 characters', async () => {
    const longText = 'A'.repeat(60_000);
    const fetchMock = buildFetchSequence([
      {
        status: 'succeeded',
        analyzeResult: {
          content: longText,
          pages: [{}],
          modelId: 'prebuilt-layout',
        },
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const promise = analyzeDocument('https://example.org/report.pdf');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).not.toBeNull();
    expect(result!.text.length).toBe(50_000);
  });

  it('sends Ocp-Apim-Subscription-Key (not api-key) header', async () => {
    const fetchMock = buildFetchSequence([SUCCEEDED_RESPONSE]);
    vi.stubGlobal('fetch', fetchMock);

    const promise = analyzeDocument('https://example.org/report.pdf');
    await vi.runAllTimersAsync();
    await promise;

    const firstCallHeaders = fetchMock.mock.calls[0][1].headers;
    expect(firstCallHeaders['Ocp-Apim-Subscription-Key']).toBe('test-key');
    expect(firstCallHeaders['api-key']).toBeUndefined();
  });
});
