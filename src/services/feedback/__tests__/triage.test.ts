/**
 * Tests for src/services/feedback/triage.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triageFeedback, isFeedbackTriageConfigured } from '../triage';

// ============================================================
// Helpers
// ============================================================

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

const VALID_RESULT = {
  category: 'incorrect_phone',
  urgency: 'high',
  extractedFields: ['phone'],
};

// ============================================================
// isFeedbackTriageConfigured
// ============================================================

describe('isFeedbackTriageConfigured', () => {
  it('returns false when env vars are absent', () => {
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_KEY;
    expect(isFeedbackTriageConfigured()).toBe(false);
  });

  it('returns true when both env vars are set', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com/';
    process.env.AZURE_OPENAI_KEY = 'key-abc';
    expect(isFeedbackTriageConfigured()).toBe(true);
  });
});

// ============================================================
// triageFeedback
// ============================================================

describe('triageFeedback', () => {
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

  it('returns null when OpenAI is not configured', async () => {
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_KEY;
    const result = await triageFeedback('The phone number is wrong.');
    expect(result).toBeNull();
  });

  it('returns null for comments shorter than 5 characters', async () => {
    const result = await triageFeedback('ok');
    expect(result).toBeNull();
  });

  it('returns valid TriageResult for a well-formed comment', async () => {
    mockOkResponse(VALID_RESULT);
    const result = await triageFeedback('The phone number listed is disconnected.');

    expect(result).not.toBeNull();
    expect(result!.category).toBe('incorrect_phone');
    expect(result!.urgency).toBe('high');
    expect(result!.extractedFields).toEqual(['phone']);
  });

  it('returns null on HTTP error (fail-open)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const result = await triageFeedback('The service has moved locations.');
    expect(result).toBeNull();
  });

  it('returns null on fetch network error (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await triageFeedback('Great service, very helpful!');
    expect(result).toBeNull();
  });

  it('returns null when response JSON is invalid (fail-open)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{broken json' } }] }),
      }),
    );
    const result = await triageFeedback('This place is closed.');
    expect(result).toBeNull();
  });

  it('returns null when category is not in the allowed set (schema invalid)', async () => {
    mockOkResponse({ category: 'spam', urgency: 'normal', extractedFields: [] });
    const result = await triageFeedback('Spam comment.');
    expect(result).toBeNull();
  });

  it('returns null when urgency is invalid (schema invalid)', async () => {
    mockOkResponse({ category: 'positive', urgency: 'medium', extractedFields: [] });
    const result = await triageFeedback('Great service!');
    expect(result).toBeNull();
  });

  it('truncates comment to 600 characters before sending to LLM', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(VALID_RESULT) } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const longComment = 'X'.repeat(1000);
    await triageFeedback(longComment);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const userMsg = body.messages[1].content as string;
    // The comment in the prompt must not exceed 600 chars
    expect(userMsg).not.toContain('X'.repeat(601));
  });

  it('sets temperature 0.1 and json_object response format', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(VALID_RESULT) } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await triageFeedback('The address is wrong.');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.temperature).toBe(0.1);
    expect(body.response_format.type).toBe('json_object');
  });

  it('returns null when response has no choices (fail-open)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [] }),
      }),
    );
    const result = await triageFeedback('The hours are out of date.');
    expect(result).toBeNull();
  });
});
