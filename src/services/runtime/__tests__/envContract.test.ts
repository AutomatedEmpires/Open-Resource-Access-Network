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
        REDIS_URL: 'redis://localhost:6379',
        AZURE_MAPS_KEY: 'maps-key',
        AZURE_MAPS_SAS_TOKEN: 'sas-token',
        AZURE_TRANSLATOR_KEY: 'trans-key',
        AZURE_TRANSLATOR_ENDPOINT: 'https://api.example.com',
        AZURE_TRANSLATOR_REGION: 'eastus',
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
      'AZURE_MAPS_KEY',
      'AZURE_MAPS_SAS_TOKEN',
      'AZURE_TRANSLATOR_ENDPOINT',
      'AZURE_TRANSLATOR_KEY',
      'AZURE_TRANSLATOR_REGION',
      'REDIS_URL',
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
      NEXTAUTH_SECRET: 'secret',
      NEXTAUTH_URL: 'https://oran.test',
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
      NEXTAUTH_SECRET: 'secret',
      NEXTAUTH_URL: 'https://oran.test',
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
    expect(result.warnings).toEqual(['APPLICATIONINSIGHTS_CONNECTION_STRING']);
  });
});
