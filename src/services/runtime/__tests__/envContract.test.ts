import { describe, expect, it } from 'vitest';
import { validateRuntimeEnv } from '@/services/runtime/envContract';

describe('validateRuntimeEnv', () => {
  it('accepts a production web app contract when required settings are present', () => {
    const result = validateRuntimeEnv(
      'webapp',
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
        NEXT_PUBLIC_SITE_URL: 'https://openresourceaccessnetwork.com',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
        CLERK_SECRET_KEY: 'sk_test_123',
        INTERNAL_API_KEY: 'internal-key',
        CRON_SECRET: 'cron-key',
        REDIS_URL: 'redis://localhost:6379',
        NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
        RESEND_API_KEY: 're_test',
        RESEND_FROM: 'ORAN <notifications@example.com>',
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
        NEXT_PUBLIC_SITE_URL: 'https://openresourceaccessnetwork.com',
        INTERNAL_API_KEY: 'internal-key',
        CRON_SECRET: 'cron-key',
      },
    );

    expect(result.ok).toBe(false);
    expect(result.missingCritical).toEqual([
      'CLERK_SECRET_KEY',
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    ]);
    expect(result.warnings).toEqual([
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
      NEXT_PUBLIC_SITE_URL: 'https://openresourceaccessnetwork.com',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
      CLERK_SECRET_KEY: 'sk_test_123',
      INTERNAL_API_KEY: 'internal-key',
      CRON_SECRET: 'cron-key',
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
      NEXT_PUBLIC_SITE_URL: 'https://openresourceaccessnetwork.com',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
      CLERK_SECRET_KEY: 'sk_test_123',
      INTERNAL_API_KEY: 'internal-key',
      CRON_SECRET: 'cron-key',
      NDP_211_POLLING_ENABLED: 'false',
    });

    expect(result.ok).toBe(true);
    expect(result.missingCritical).toEqual([]);
  });

  it('requires the Vercel cron secret in production', () => {
    const result = validateRuntimeEnv('webapp', {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
      NEXT_PUBLIC_SITE_URL: 'https://openresourceaccessnetwork.com',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
      CLERK_SECRET_KEY: 'sk_test_123',
      INTERNAL_API_KEY: 'internal-key',
    });

    expect(result.ok).toBe(false);
    expect(result.missingCritical).toEqual(['CRON_SECRET']);
  });

  it('requires an explicit sender whenever Resend is enabled', () => {
    const result = validateRuntimeEnv('webapp', {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
      NEXT_PUBLIC_SITE_URL: 'https://openresourceaccessnetwork.com',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
      CLERK_SECRET_KEY: 'sk_test_123',
      INTERNAL_API_KEY: 'internal-key',
      CRON_SECRET: 'cron-key',
      RESEND_API_KEY: 're_test',
    });

    expect(result.ok).toBe(false);
    expect(result.missingCritical).toEqual(['RESEND_FROM']);
  });
});
