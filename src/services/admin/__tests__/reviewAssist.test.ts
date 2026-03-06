/**
 * Tests for src/services/admin/reviewAssist.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reviewCandidateWithLLM,
  isReviewAssistConfigured,
  type CandidateForReview,
} from '../reviewAssist';

// ============================================================
// Helpers
// ============================================================

function minCandidate(overrides: Partial<CandidateForReview> = {}): CandidateForReview {
  return {
    id: 'test-id',
    serviceName: 'City Food Bank',
    description: 'Provides emergency food assistance to low-income residents.',
    organizationName: 'City Charity',
    phone: '(555) 123-4567',
    websiteUrl: 'https://example.org',
    addressLine1: '123 Main St',
    addressCity: 'Springfield',
    addressRegion: 'IL',
    addressPostalCode: '62701',
    ...overrides,
  };
}

function mockOkResponse(result: object): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(result) } }],
      }),
    }),
  );
}

// ============================================================
// isReviewAssistConfigured
// ============================================================

describe('isReviewAssistConfigured', () => {
  it('returns false when env vars missing', () => {
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_KEY;
    expect(isReviewAssistConfigured()).toBe(false);
  });

  it('returns true when both env vars set', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com/';
    process.env.AZURE_OPENAI_KEY = 'key-abc';
    expect(isReviewAssistConfigured()).toBe(true);
  });
});

// ============================================================
// reviewCandidateWithLLM
// ============================================================

describe('reviewCandidateWithLLM', () => {
  const originalEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const originalKey = process.env.AZURE_OPENAI_KEY;

  beforeEach(() => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com/';
    process.env.AZURE_OPENAI_KEY = 'test-key';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.AZURE_OPENAI_ENDPOINT = originalEndpoint;
    process.env.AZURE_OPENAI_KEY = originalKey;
  });

  it('throws when OpenAI is not configured', async () => {
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_KEY;
    await expect(reviewCandidateWithLLM(minCandidate())).rejects.toThrow(
      'Azure OpenAI is not configured',
    );
  });

  it('returns valid ReviewAssistResult for a well-formed candidate', async () => {
    mockOkResponse({
      completenessScore: 85,
      warnings: ['Description could be more specific'],
      suggestions: [{ field: 'hours', suggestion: 'Add operating hours' }],
    });

    const result = await reviewCandidateWithLLM(minCandidate());

    expect(result.completenessScore).toBe(85);
    expect(result.warnings).toHaveLength(1);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].field).toBe('hours');
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('includes missing fields in the user prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                completenessScore: 40,
                warnings: ['Missing phone number', 'Missing address'],
                suggestions: [],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await reviewCandidateWithLLM(
      minCandidate({ phone: null, addressLine1: null }),
    );

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody.messages[1].content).toContain('Missing critical fields');
    expect(callBody.messages[1].content).toContain('phone');
    expect(callBody.messages[1].content).toContain('addressLine1');
  });

  it('uses temperature 0.1 and json_object response format', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ completenessScore: 90, warnings: [], suggestions: [] }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await reviewCandidateWithLLM(minCandidate());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.temperature).toBe(0.1);
    expect(body.response_format.type).toBe('json_object');
  });

  it('throws when Azure OpenAI returns an HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    );
    await expect(reviewCandidateWithLLM(minCandidate())).rejects.toThrow(
      'Azure OpenAI returned HTTP 429',
    );
  });

  it('throws when response has empty content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '' } }] }),
      }),
    );
    await expect(reviewCandidateWithLLM(minCandidate())).rejects.toThrow(
      'Empty response from LLM review assist',
    );
  });

  it('throws when LLM returns malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'not valid json' } }],
        }),
      }),
    );
    await expect(reviewCandidateWithLLM(minCandidate())).rejects.toThrow(
      'LLM review assist returned invalid JSON',
    );
  });

  it('throws when result fails schema validation', async () => {
    mockOkResponse({ completenessScore: 'not a number', warnings: [], suggestions: [] });
    await expect(reviewCandidateWithLLM(minCandidate())).rejects.toThrow(
      'LLM review assist result failed schema validation',
    );
  });

  it('caps description and eligibility sent to LLM at safe lengths', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ completenessScore: 70, warnings: [], suggestions: [] }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const longDescription = 'A'.repeat(2000);
    await reviewCandidateWithLLM(minCandidate({ description: longDescription }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const userContent = body.messages[1].content as string;
    // Should be capped at 500 chars
    expect(userContent).not.toContain('A'.repeat(501));
  });
});
