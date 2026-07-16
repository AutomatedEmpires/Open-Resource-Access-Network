import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
const buildExtractionMessagesMock = vi.hoisted(() => vi.fn(() => [
  { role: 'system', content: 'you are an extractor' },
  { role: 'user', content: 'extract' },
]));
const buildCategorizationMessagesMock = vi.hoisted(() => vi.fn(() => [{ role: 'user', content: 'categorize' }]));
const extractionParseMock = vi.hoisted(() => vi.fn((value: unknown) => ({ ...(value as Record<string, unknown>) })));
const categorizationParseMock = vi.hoisted(() => vi.fn((value: unknown) => ({ ...(value as Record<string, unknown>) })));

vi.mock('../../prompts/extraction', () => ({
  buildExtractionMessages: buildExtractionMessagesMock,
}));
vi.mock('../../prompts/categorization', () => ({
  buildCategorizationMessages: buildCategorizationMessagesMock,
}));
vi.mock('../../types', () => ({
  ExtractionResultSchema: { parse: extractionParseMock },
  CategorizationResultSchema: { parse: categorizationParseMock },
}));

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
  };
}

async function loadProviderModule() {
  return import('../anthropic');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.stubGlobal('fetch', fetchMock);
  buildExtractionMessagesMock.mockImplementation(() => [
    { role: 'system', content: 'you are an extractor' },
    { role: 'user', content: 'extract' },
  ]);
  buildCategorizationMessagesMock.mockImplementation(() => [{ role: 'user', content: 'categorize' }]);
  extractionParseMock.mockImplementation((value: unknown) => ({ ...(value as Record<string, unknown>) }));
  categorizationParseMock.mockImplementation((value: unknown) => ({ ...(value as Record<string, unknown>) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AnthropicClient', () => {
  it('extracts fenced JSON, separates the system prompt, and attaches metadata', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      model: 'claude-opus-4-8',
      content: [{ type: 'text', text: '```json\n{"serviceName":"Food Pantry"}\n```' }],
      usage: { input_tokens: 100, output_tokens: 21 },
    }));
    const { AnthropicClient } = await loadProviderModule();
    const client = new AnthropicClient({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'k' });

    const result = await client.extract({
      content: 'page body',
      sourceUrl: 'https://example.org/feed',
    } as never);

    expect(result).toEqual({
      success: true,
      data: { serviceName: 'Food Pantry', modelId: 'claude-opus-4-8', tokensUsed: 121 },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const payload = JSON.parse((init as { body: string }).body);
    // The system prompt rides the top-level field, never the messages array.
    expect(payload.system).toBe('you are an extractor');
    expect(payload.messages).toEqual([{ role: 'user', content: 'extract' }]);
    expect((init as { headers: Record<string, string> }).headers['x-api-key']).toBe('k');
  });

  it('retries rate-limited requests honoring Retry-After', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'rate limited' } }, { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(jsonResponse({
        model: 'claude-opus-4-8',
        content: [{ type: 'text', text: '{"ok":true}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    const { AnthropicClient } = await loadProviderModule();
    const client = new AnthropicClient({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'k' });

    const pending = client.categorize({ service: { name: 'X' } } as never);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  it('does not retry auth errors and reports them as auth_error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'bad key' } }, { status: 401 }));
    const { AnthropicClient } = await loadProviderModule();
    const client = new AnthropicClient({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'k' });

    const result = await client.extract({ content: 'x', sourceUrl: 'https://e.org' } as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, error: { code: 'auth_error', retryable: false } });
  });

  it('reports non-JSON output as parse_error without retrying', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      content: [{ type: 'text', text: 'sorry, I cannot do that' }],
    }));
    const { AnthropicClient } = await loadProviderModule();
    const client = new AnthropicClient({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'k' });

    const result = await client.extract({ content: 'x', sourceUrl: 'https://e.org' } as never);

    expect(result).toMatchObject({ success: false, error: { code: 'parse_error' } });
  });

  it('factory requires an api key and swaps GPT-shaped defaults for the Claude default', async () => {
    const { createAnthropicClient } = await loadProviderModule();

    await expect(createAnthropicClient({ provider: 'anthropic', model: 'gpt-4o' }))
      .rejects.toThrow('Anthropic requires an API key');

    const swapped = await createAnthropicClient({ provider: 'anthropic', model: 'gpt-4o', apiKey: 'k' });
    expect(swapped.model).toBe('claude-opus-4-8');

    const explicit = await createAnthropicClient({ provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'k' });
    expect(explicit.model).toBe('claude-sonnet-5');
  });

  it('registers itself so LLM_PROVIDER=anthropic resolves from the factory', async () => {
    const client = await import('../../client');
    await loadProviderModule();
    expect(client.getRegisteredLLMProviders()).toContain('anthropic');
  });

  it('healthCheck returns true only for an ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
    const { AnthropicClient } = await loadProviderModule();
    const client = new AnthropicClient({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'k' });
    await expect(client.healthCheck()).resolves.toBe(true);

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(client.healthCheck()).resolves.toBe(false);
  });
});
