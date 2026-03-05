/**
 * Tests for Azure AI Content Safety crisis detection layer.
 *
 * Safety-critical: tests cover fail-open semantics (API errors must NEVER
 * block legitimate crisis routing), true/false positive cases for the
 * distress-signal pre-filter, and the API integration contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hasDistressSignals,
  checkCrisisContentSafety,
  CRISIS_DISTRESS_SIGNALS,
} from '../contentSafety';

// ---------------------------------------------------------------------------
// hasDistressSignals (pre-filter — synchronous, no API)
// ---------------------------------------------------------------------------

describe('hasDistressSignals (pre-filter)', () => {
  it('returns false for normal help-seeking messages', () => {
    const normalMessages = [
      'I need help finding food',
      'Where is the nearest shelter?',
      'Can you help me with housing assistance?',
      'I need a doctor appointment',
      'Looking for childcare near me',
      'How do I apply for food stamps?',
      'Where can I get legal advice?',
      'I lost my job and need employment services',
    ];

    for (const msg of normalMessages) {
      expect(hasDistressSignals(msg), `Expected false for: "${msg}"`).toBe(false);
    }
  });

  it('returns true for indirect distress language', () => {
    const distressMessages = [
      'I feel hopeless about everything',
      "I want to disappear",
      "nobody would miss me if I was gone",
      "I can't do this anymore",
      "I don't see a way out",
      "I've given up on life",
      "I'm at my breaking point",
      "I just want to disappear",
      "nothing to live for anymore",
      "I lost the will to keep trying",
    ];

    for (const msg of distressMessages) {
      expect(hasDistressSignals(msg), `Expected true for: "${msg}"`).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(hasDistressSignals('I FEEL HOPELESS')).toBe(true);
    expect(hasDistressSignals('Feel Hopeless Right Now')).toBe(true);
  });

  it('detects signals as substrings within longer messages', () => {
    expect(hasDistressSignals('My friend said she feels hopeless and I am worried')).toBe(true);
    expect(hasDistressSignals('I told my therapist I want to disappear sometimes')).toBe(true);
  });

  it('CRISIS_DISTRESS_SIGNALS list is non-empty', () => {
    expect(CRISIS_DISTRESS_SIGNALS.length).toBeGreaterThan(0);
  });

  it('contains key indirect crisis phrases', () => {
    const signals = CRISIS_DISTRESS_SIGNALS.map((s) => s.toLowerCase());
    expect(signals.some((s) => s.includes('hopeless'))).toBe(true);
    expect(signals.some((s) => s.includes('miss me'))).toBe(true);
    expect(signals.some((s) => s.includes('way out'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkCrisisContentSafety (API integration — async)
// ---------------------------------------------------------------------------

describe('checkCrisisContentSafety', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Reset fetch mock before each test
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  // ---- No-op when not configured ----

  it('returns false immediately when AZURE_CONTENT_SAFETY_ENDPOINT is not set', async () => {
    delete process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
    delete process.env.AZURE_CONTENT_SAFETY_KEY;

    const result = await checkCrisisContentSafety('I feel hopeless');
    expect(result).toBe(false);
  });

  it('returns false immediately when AZURE_CONTENT_SAFETY_KEY is not set', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    delete process.env.AZURE_CONTENT_SAFETY_KEY;

    const result = await checkCrisisContentSafety('I feel hopeless');
    expect(result).toBe(false);
  });

  // ---- API detection ----

  it('returns true when API responds with SelfHarm severity >= 4 (medium)', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = 'test-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        categoriesAnalysis: [{ category: 'SelfHarm', severity: 4 }],
      }),
    }));

    const result = await checkCrisisContentSafety('nobody would miss me');
    expect(result).toBe(true);
  });

  it('returns true when API responds with SelfHarm severity 6 (high)', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = 'test-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        categoriesAnalysis: [{ category: 'SelfHarm', severity: 6 }],
      }),
    }));

    const result = await checkCrisisContentSafety('I want to hurt myself');
    expect(result).toBe(true);
  });

  it('returns false when API responds with SelfHarm severity 0 (safe)', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = 'test-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        categoriesAnalysis: [{ category: 'SelfHarm', severity: 0 }],
      }),
    }));

    const result = await checkCrisisContentSafety('I feel a bit hopeless about my job search');
    expect(result).toBe(false);
  });

  it('returns false when API responds with SelfHarm severity 2 (low)', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = 'test-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        categoriesAnalysis: [{ category: 'SelfHarm', severity: 2 }],
      }),
    }));

    const result = await checkCrisisContentSafety('feeling down');
    expect(result).toBe(false);
  });

  // ---- FAIL-OPEN semantics (safety-critical) ----

  it('returns false (fail-open) when fetch throws a network error', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = 'test-key';

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

    const result = await checkCrisisContentSafety('I want to disappear');
    expect(result).toBe(false);
  });

  it('returns false (fail-open) when API returns HTTP 429 rate limit', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = 'test-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 'TooManyRequests' } }),
    }));

    const result = await checkCrisisContentSafety('I want to disappear');
    expect(result).toBe(false);
  });

  it('returns false (fail-open) when API returns HTTP 500', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = 'test-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));

    const result = await checkCrisisContentSafety('I want to disappear');
    expect(result).toBe(false);
  });

  it('returns false (fail-open) when API response is malformed JSON', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = 'test-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    }));

    const result = await checkCrisisContentSafety('I want to disappear');
    expect(result).toBe(false);
  });

  it('returns false (fail-open) when API response is missing SelfHarm category', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = 'test-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        categoriesAnalysis: [],
      }),
    }));

    const result = await checkCrisisContentSafety('I want to disappear');
    expect(result).toBe(false);
  });

  // ---- API call shape ----

  it('sends only SelfHarm category to minimize API scanning cost', async () => {
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = 'test-key';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ categoriesAnalysis: [{ category: 'SelfHarm', severity: 0 }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await checkCrisisContentSafety('some message');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { categories: string[] };
    expect(body.categories).toEqual(['SelfHarm']);
  });

  it('sends Ocp-Apim-Subscription-Key header with the configured key', async () => {
    const apiKey = 'my-secret-key-12345';
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = 'https://example.cognitiveservices.azure.com';
    process.env.AZURE_CONTENT_SAFETY_KEY = apiKey;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ categoriesAnalysis: [{ category: 'SelfHarm', severity: 0 }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await checkCrisisContentSafety('some message');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Key']).toBe(apiKey);
  });
});
