import { describe, expect, it } from 'vitest';
import { validateRuntimeEnv } from '@/services/runtime/envContract';

describe('validateRuntimeEnv', () => {
  it('accepts a production web app contract when required settings are present', () => {
    const result = validateRuntimeEnv(
      'webapp',
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
        CLERK_SECRET_KEY: 'sk_test_123',
        INTERNAL_API_KEY: 'internal-key',
        REDIS_URL: 'redis://localhost:6379',
        AZURE_TRANSLATOR_KEY: 'trans-key',
        AZURE_TRANSLATOR_ENDPOINT: 'https://api.example.com',
        AZURE_TRANSLATOR_REGION: 'eastus',
        NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
        RESEND_API_KEY: 're_test',
        OPENAI_API_KEY: 'sk-test',
      },
    );

    expect(result.ok).toBe(true);
    expect(result.missingCritical).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('flags missing Clerk auth keys as critical in production', () => {
    const result = validateRuntimeEnv(
      'webapp',
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
        INTERNAL_API_KEY: 'internal-key',
      },
    );

    expect(result.ok).toBe(false);
    expect(result.missingCritical).toEqual([
      'CLERK_SECRET_KEY',
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    ]);
    expect(result.warnings).toEqual([
      'AZURE_TRANSLATOR_ENDPOINT',
      'AZURE_TRANSLATOR_KEY',
      'AZURE_TRANSLATOR_REGION',
      'NEXT_PUBLIC_SENTRY_DSN',
      'OPENAI_API_KEY',
      'REDIS_URL',
      'RESEND_API_KEY',
    ]);
  });

  it('skips production-only requirements outside production', () => {
    const result = validateRuntimeEnv('webapp', {
      NODE_ENV: 'development',
    });

    expect(result.ok).toBe(true);
    expect(result.missingCritical).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('requires 211 polling secrets when production web polling is enabled', () => {
    const result = validateRuntimeEnv('webapp', {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
      CLERK_SECRET_KEY: 'sk_test_123',
      INTERNAL_API_KEY: 'internal-key',
      NDP_211_POLLING_ENABLED: 'true',
    });

    expect(result.ok).toBe(false);
    expect(result.missingCritical).toEqual([
      'NDP_211_DATA_OWNERS',
      'NDP_211_SUBSCRIPTION_KEY',
    ]);
  });

  it('does not require 211 polling secrets when the flag is disabled', () => {
    const result = validateRuntimeEnv('webapp', {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
      CLERK_SECRET_KEY: 'sk_test_123',
      INTERNAL_API_KEY: 'internal-key',
      NDP_211_POLLING_ENABLED: 'false',
    });

    expect(result.ok).toBe(true);
    expect(result.missingCritical).toEqual([]);
  });

  it('validates Azure Functions contracts from names-only sources', () => {
    const result = validateRuntimeEnv(
      'functions',
      [
        'AzureWebJobsStorage',
        'FUNCTIONS_WORKER_RUNTIME',
        'ORAN_APP_URL',
        'INTERNAL_API_KEY',
      ],
      { nodeEnv: 'production' },
    );

    expect(result.ok).toBe(true);
    expect(result.missingCritical).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
