import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LLMClient, LLMClientConfig } from '@/agents/ingestion/llm/client';
import {
  createLLMClient,
  DEFAULT_LLM_CONFIG,
  getLLMConfigFromEnv,
  getRegisteredLLMProviders,
  registerLLMClientProvider,
} from '@/agents/ingestion/llm/client';

const originalEnv = { ...process.env };

function makeClient(provider: string, model: string): LLMClient {
  return {
    provider,
    model,
    extract: vi.fn(),
    categorize: vi.fn(),
    healthCheck: vi.fn(),
  };
}

describe('llm client factory + env config', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('registers providers and constructs with defaults merged', async () => {
    const constructor = vi.fn(async (config: LLMClientConfig) => makeClient(config.provider, config.model));
    registerLLMClientProvider('azure_openai', constructor);

    const client = await createLLMClient({
      provider: 'azure_openai',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    expect(client.provider).toBe('azure_openai');
    expect(client.model).toBe('gpt-4o-mini');
    expect(constructor).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'azure_openai',
      model: 'gpt-4o-mini',
      maxExtractionTokens: DEFAULT_LLM_CONFIG.maxExtractionTokens,
      maxCategorizationTokens: DEFAULT_LLM_CONFIG.maxCategorizationTokens,
      timeoutMs: DEFAULT_LLM_CONFIG.timeoutMs,
      useStructuredOutput: DEFAULT_LLM_CONFIG.useStructuredOutput,
      temperature: 0.3,
    }));
  });

  it('throws when provider is not registered', async () => {
    await expect(createLLMClient({ provider: 'openai', model: 'gpt-x' }))
      .rejects
      .toThrow('LLM provider "openai" is not registered.');
  });

  it('lists registered providers', () => {
    registerLLMClientProvider('anthropic', async (config) => makeClient(config.provider, config.model));
    registerLLMClientProvider('openai', async (config) => makeClient(config.provider, config.model));

    const providers = getRegisteredLLMProviders();
    expect(providers).toEqual(expect.arrayContaining(['anthropic', 'openai']));
  });

  it('builds config from environment defaults and overrides', () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_VERSION;

    const defaults = getLLMConfigFromEnv();
    expect(defaults.provider).toBe('azure_openai');
    expect(defaults.model).toBe('gpt-4o');
    expect(defaults.apiVersion).toBe('2024-08-01-preview');

    process.env.LLM_PROVIDER = 'openai';
    process.env.LLM_MODEL = 'gpt-4.1';
    process.env.LLM_ENDPOINT = 'https://example.openai.test';
    process.env.LLM_API_KEY = 'secret';
    process.env.LLM_API_VERSION = '2024-09-01';
    process.env.LLM_TEMPERATURE = '0.75';
    process.env.LLM_TIMEOUT_MS = '45000';

    const config = getLLMConfigFromEnv();
    expect(config).toEqual({
      provider: 'openai',
      model: 'gpt-4.1',
      endpoint: 'https://example.openai.test',
      apiKey: 'secret',
      apiVersion: '2024-09-01',
      temperature: 0.75,
      timeoutMs: 45000,
    });
  });
});
