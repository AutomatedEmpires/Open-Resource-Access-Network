import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const createCompletionMock = vi.hoisted(() => vi.fn());
const azureOpenAIConfigs = vi.hoisted(() => [] as unknown[]);
const buildExtractionMessagesMock = vi.hoisted(() => vi.fn(() => [{ role: 'user', content: 'extract' }]));
const buildCategorizationMessagesMock = vi.hoisted(() => vi.fn(() => [{ role: 'user', content: 'categorize' }]));
const extractionParseMock = vi.hoisted(() => vi.fn((value: unknown) => ({ ...(value as Record<string, unknown>) })));
const categorizationParseMock = vi.hoisted(() => vi.fn((value: unknown) => ({ ...(value as Record<string, unknown>) })));

vi.mock('openai', () => ({
  AzureOpenAI: class MockAzureOpenAI {
    config: unknown;
    chat: { completions: { create: typeof createCompletionMock } };

    constructor(config: unknown) {
      this.config = config;
      this.chat = {
        completions: {
          create: createCompletionMock,
        },
      };
      azureOpenAIConfigs.push(config);
    }
  },
}));
vi.mock('../../prompts/extraction', () => ({
  buildExtractionMessages: buildExtractionMessagesMock,
}));
vi.mock('../../prompts/categorization', () => ({
  buildCategorizationMessages: buildCategorizationMessagesMock,
}));
vi.mock('../../types', () => ({
  ExtractionResultSchema: {
    parse: extractionParseMock,
  },
  CategorizationResultSchema: {
    parse: categorizationParseMock,
  },
}));

async function loadProviderModule() {
  return import('../azureOpenai');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useRealTimers();

  buildExtractionMessagesMock.mockImplementation(() => [{ role: 'user', content: 'extract' }]);
  buildCategorizationMessagesMock.mockImplementation(() => [{ role: 'user', content: 'categorize' }]);
  extractionParseMock.mockImplementation((value: unknown) => ({ ...(value as Record<string, unknown>) }));
  categorizationParseMock.mockImplementation((value: unknown) => ({ ...(value as Record<string, unknown>) }));
  azureOpenAIConfigs.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AzureOpenAIClient', () => {
  it('extracts structured JSON responses and attaches model metadata', async () => {
    createCompletionMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '```json\n{"serviceName":"Food Pantry"}\n```',
          },
        },
      ],
      model: 'deployment-1',
      usage: { total_tokens: 321 },
    });
    const { AzureOpenAIClient } = await loadProviderModule();
    const client = new AzureOpenAIClient(
      { chat: { completions: { create: createCompletionMock } } } as never,
      { provider: 'azure_openai', model: 'gpt-4o', useStructuredOutput: true },
    );

    const result = await client.extract({
      content: 'page body',
      sourceUrl: 'https://example.org/feed',
    } as never);

    expect(buildExtractionMessagesMock).toHaveBeenCalledWith({
      content: 'page body',
      sourceUrl: 'https://example.org/feed',
    });
    expect(createCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
      }),
    );
    expect(result).toEqual({
      success: true,
      data: {
        serviceName: 'Food Pantry',
        modelId: 'deployment-1',
        tokensUsed: 321,
      },
    });
  });

  it('retries rate-limited extraction requests and respects Retry-After delays', async () => {
    vi.useFakeTimers();
    createCompletionMock
      .mockRejectedValueOnce(
        Object.assign(new Error('rate limit exceeded'), {
          status: 429,
          headers: { 'retry-after': '1' },
        }),
      )
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { total_tokens: 12 },
      });
    const { AzureOpenAIClient } = await loadProviderModule();
    const client = new AzureOpenAIClient(
      { chat: { completions: { create: createCompletionMock } } } as never,
      { provider: 'azure_openai', model: 'gpt-4o' },
    );

    const resultPromise = client.extract({
      content: 'retry body',
      sourceUrl: 'https://example.org/retry',
    } as never);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(createCompletionMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      success: true,
      data: {
        ok: true,
        modelId: 'gpt-4o',
        tokensUsed: 12,
      },
    });
  });

  it('returns parse_error for non-JSON categorization responses', async () => {
    createCompletionMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'this is not json' } }],
    });
    const { AzureOpenAIClient } = await loadProviderModule();
    const client = new AzureOpenAIClient(
      { chat: { completions: { create: createCompletionMock } } } as never,
      { provider: 'azure_openai', model: 'gpt-4o' },
    );

    const result = await client.categorize({
      service: { id: 'svc-1' },
    } as never);

    expect(buildCategorizationMessagesMock).toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: 'parse_error',
        retryable: false,
      }),
    });
  });

  it('maps empty model responses to invalid_response', async () => {
    createCompletionMock.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
    });
    const { AzureOpenAIClient } = await loadProviderModule();
    const client = new AzureOpenAIClient(
      { chat: { completions: { create: createCompletionMock } } } as never,
      { provider: 'azure_openai', model: 'gpt-4o' },
    );

    const result = await client.extract({
      content: 'body',
      sourceUrl: 'https://example.org/empty',
    } as never);

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: 'invalid_response',
        retryable: false,
      }),
    });
  });

  it('sends response_format undefined when structured output is disabled', async () => {
    createCompletionMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"serviceName":"Plain"}' } }],
      usage: { total_tokens: 9 },
    });
    const { AzureOpenAIClient } = await loadProviderModule();
    const client = new AzureOpenAIClient(
      { chat: { completions: { create: createCompletionMock } } } as never,
      { provider: 'azure_openai', model: 'gpt-4o', useStructuredOutput: false },
    );

    const result = await client.extract({
      content: 'plain body',
      sourceUrl: 'https://example.org/plain',
    } as never);

    expect(createCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: undefined,
      }),
    );
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        serviceName: 'Plain',
        modelId: 'gpt-4o',
      }),
    });
  });

  it.each([
    [{ status: 401 }, 'auth_error'],
    [{ message: 'context_length_exceeded' }, 'context_too_long'],
    [{ message: 'blocked by content management policy' }, 'content_filtered'],
  ] as const)('classifies provider errors: %s -> %s', async (shape, expectedCode) => {
    const baseError = new Error(('message' in shape ? shape.message : undefined) ?? 'provider failed');
    createCompletionMock.mockRejectedValueOnce(Object.assign(baseError, shape));
    const { AzureOpenAIClient } = await loadProviderModule();
    const client = new AzureOpenAIClient(
      { chat: { completions: { create: createCompletionMock } } } as never,
      { provider: 'azure_openai', model: 'gpt-4o' },
    );

    const result = await client.extract({
      content: 'body',
      sourceUrl: 'https://example.org/error',
    } as never);

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: expectedCode,
      }),
    });
  });

  it('retries timeout errors before returning timeout classification', async () => {
    vi.useFakeTimers();
    createCompletionMock.mockRejectedValue(new Error('request timed out'));
    const { AzureOpenAIClient } = await loadProviderModule();
    const client = new AzureOpenAIClient(
      { chat: { completions: { create: createCompletionMock } } } as never,
      { provider: 'azure_openai', model: 'gpt-4o' },
    );

    const resultPromise = client.extract({
      content: 'body',
      sourceUrl: 'https://example.org/timeout',
    } as never);

    await vi.advanceTimersByTimeAsync(15_000);
    const result = await resultPromise;

    expect(createCompletionMock).toHaveBeenCalledTimes(4);
    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: 'timeout',
        retryable: true,
        retryAfterMs: 5000,
      }),
    });
  });

  it('classifies non-Error throwables as unknown', async () => {
    createCompletionMock.mockRejectedValueOnce('opaque failure');
    const { AzureOpenAIClient } = await loadProviderModule();
    const client = new AzureOpenAIClient(
      { chat: { completions: { create: createCompletionMock } } } as never,
      { provider: 'azure_openai', model: 'gpt-4o' },
    );

    const result = await client.extract({
      content: 'body',
      sourceUrl: 'https://example.org/unknown',
    } as never);

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: 'unknown',
        retryable: false,
      }),
    });
  });

  it('maps schema failures to invalid_response without retrying', async () => {
    extractionParseMock.mockImplementationOnce(() => {
      throw new ZodError([]);
    });
    createCompletionMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"serviceName":"Needs validation"}' } }],
    });
    const { AzureOpenAIClient } = await loadProviderModule();
    const client = new AzureOpenAIClient(
      { chat: { completions: { create: createCompletionMock } } } as never,
      { provider: 'azure_openai', model: 'gpt-4o' },
    );

    const result = await client.extract({
      content: 'body',
      sourceUrl: 'https://example.org/validation',
    } as never);

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: 'invalid_response',
        retryable: false,
      }),
    });
    expect(createCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('reports health check pass and fail states', async () => {
    createCompletionMock
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'OK' } }],
      })
      .mockRejectedValueOnce(new Error('network down'));
    const { AzureOpenAIClient } = await loadProviderModule();
    const client = new AzureOpenAIClient(
      { chat: { completions: { create: createCompletionMock } } } as never,
      { provider: 'azure_openai', model: 'gpt-4o' },
    );

    await expect(client.healthCheck()).resolves.toBe(true);
    await expect(client.healthCheck()).resolves.toBe(false);
  });

  it('creates AzureOpenAI clients with defaults and validates required endpoint config', async () => {
    const { createAzureOpenAIClient } = await loadProviderModule();

    await expect(
      createAzureOpenAIClient({
        provider: 'azure_openai',
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('Azure OpenAI requires an endpoint');

    const client = await createAzureOpenAIClient({
      provider: 'azure_openai',
      model: 'gpt-4o',
      endpoint: 'https://example.openai.azure.com',
      apiKey: 'secret',
    });

    expect(azureOpenAIConfigs[0]).toEqual(
      expect.objectContaining({
        apiKey: 'secret',
        endpoint: 'https://example.openai.azure.com',
        apiVersion: '2024-08-01-preview',
        deployment: 'gpt-4o',
        timeout: 60000,
      }),
    );
    expect(client).toMatchObject({
      provider: 'azure_openai',
      model: 'gpt-4o',
    });
  });
});
