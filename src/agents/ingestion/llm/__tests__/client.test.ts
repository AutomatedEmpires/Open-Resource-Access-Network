import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LLMClient, LLMClientConfig } from '@/agents/ingestion/llm/client';
import {
  createLLMClient,
  DEFAULT_LLM_CONFIG,
  getLLMConfigFromEnv,
  getRegisteredLLMProviders,
  isLLMConfigReady,
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
    registerLLMClientProvider('anthropic', constructor);

    const client = await createLLMClient({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      temperature: 0.3,
    });

    expect(client.provider).toBe('anthropic');
    expect(client.model).toBe('claude-sonnet-4-5');
    expect(constructor).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      maxExtractionTokens: DEFAULT_LLM_CONFIG.maxExtractionTokens,
      maxCategorizationTokens: DEFAULT_LLM_CONFIG.maxCategorizationTokens,
      timeoutMs: DEFAULT_LLM_CONFIG.timeoutMs,
      useStructuredOutput: DEFAULT_LLM_CONFIG.useStructuredOutput,
      temperature: 0.3,
    }));
  });

  it('throws when provider is not registered', async () => {
    await expect(createLLMClient({
      provider: 'unregistered' as LLMClientConfig['provider'],
      model: 'unknown',
    }))
      .rejects
      .toThrow('LLM provider "unregistered" is not registered.');
  });

  it('lists registered providers', () => {
    registerLLMClientProvider('anthropic', async (config) => makeClient(config.provider, config.model));
    registerLLMClientProvider('test_provider', async (config) => makeClient(config.provider, config.model));

    const providers = getRegisteredLLMProviders();
    expect(providers).toEqual(expect.arrayContaining(['anthropic', 'test_provider']));
  });

  it('builds config from environment defaults and overrides', () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;

    const defaults = getLLMConfigFromEnv();
    expect(defaults.provider).toBe('disabled');
    expect(defaults.model).toBe('unconfigured');

    process.env.LLM_PROVIDER = 'anthropic';
    process.env.LLM_MODEL = 'claude-sonnet-4-5';
    process.env.LLM_API_KEY = 'secret';
    process.env.LLM_TEMPERATURE = '0.75';
    process.env.LLM_TIMEOUT_MS = '45000';

    const config = getLLMConfigFromEnv();
    expect(config).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'secret',
      temperature: 0.75,
      timeoutMs: 45000,
    });

    process.env.LLM_PROVIDER = 'azure_openai';
    expect(() => getLLMConfigFromEnv()).toThrow('LLM_PROVIDER must be disabled or anthropic');
  });

  it('treats an Anthropic API key as ready', () => {
    expect(isLLMConfigReady({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'configured',
    })).toBe(true);
    expect(isLLMConfigReady({
      provider: 'disabled',
      model: 'unconfigured',
      apiKey: 'configured',
    })).toBe(false);
  });

});
