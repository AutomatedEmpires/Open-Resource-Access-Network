import { describe, expect, it } from 'vitest';
import { validateRuntimeEnv } from '@/services/runtime/envContract';

describe('validateRuntimeEnv', () => {
  it('accepts a production web app contract when required settings are present', () => {
    const result = validateRuntimeEnv(
      'webapp',
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
        NEXTAUTH_SECRET: 'secret',
        NEXTAUTH_URL: 'https://oran.test',
        INTERNAL_API_KEY: 'internal-key',
        APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=test',
      },
    );

    expect(result.ok).toBe(true);
    expect(result.missingCritical).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('flags conditional auth settings when a provider is partially configured', () => {
    const result = validateRuntimeEnv(
      'webapp',
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
        NEXTAUTH_SECRET: 'secret',
        NEXTAUTH_URL: 'https://oran.test',
        INTERNAL_API_KEY: 'internal-key',
        AZURE_AD_CLIENT_ID: 'entra-client-id',
      },
    );

    expect(result.ok).toBe(false);
    expect(result.missingCritical).toEqual(['AZURE_AD_CLIENT_SECRET']);
    expect(result.warnings).toEqual([
      'APPLICATIONINSIGHTS_CONNECTION_STRING',
      'AZURE_AD_TENANT_ID',
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
    expect(result.warnings).toEqual(['APPLICATIONINSIGHTS_CONNECTION_STRING']);
  });
});
