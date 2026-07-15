import { describe, expect, it } from 'vitest';
import { validateRuntimeEnv } from '@/services/runtime/envContract';

describe('validateRuntimeEnv', () => {
  it('accepts a production web app contract when required settings are present', () => {
    const result = validateRuntimeEnv(
      'webapp',
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
        ORAN_DATABASE_ROLE: 'oran_backend_runtime',
        ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
        CRON_SECRET: 'vercel-cron-secret',
        NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
        CLERK_SECRET_KEY: 'sk_test_example',
        RESEND_API_KEY: 're_test',
        RESEND_FROM: 'ORAN <notifications@openresourceaccessnetwork.com>',
        REDIS_URL: 'redis://localhost:6379',
      },
    );

    expect(result.ok).toBe(true);
    expect(result.missingCritical).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('requires the reviewed backend capability role in production', () => {
    const result = validateRuntimeEnv('webapp', {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
      ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
      CRON_SECRET: 'vercel-cron-secret',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
    });

    expect(result.ok).toBe(false);
    expect(result.missingCritical).toEqual(['ORAN_DATABASE_ROLE']);
  });

  it('requires both Clerk identity keys in production', () => {
    const result = validateRuntimeEnv(
      'webapp',
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
        ORAN_DATABASE_ROLE: 'oran_backend_runtime',
        ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
        CRON_SECRET: 'vercel-cron-secret',
      },
    );

    expect(result.ok).toBe(false);
    expect(result.missingCritical).toEqual([
      'CLERK_SECRET_KEY',
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    ]);
    expect(result.warnings).toEqual([
      'NEXT_PUBLIC_SENTRY_DSN',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_URL',
      'REDIS_URL',
    ]);
  });

  it('requires the Vercel Cron credential in production', () => {
    const result = validateRuntimeEnv('webapp', {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
      ORAN_DATABASE_ROLE: 'oran_backend_runtime',
      ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
    });

    expect(result.ok).toBe(false);
    expect(result.missingCritical).toEqual(['CRON_SECRET']);
  });

  it('requires Resend credentials as a complete pair when email is enabled', () => {
    const missingSender = validateRuntimeEnv('webapp', {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
      ORAN_DATABASE_ROLE: 'oran_backend_runtime',
      ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
      CRON_SECRET: 'vercel-cron-secret',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
      RESEND_API_KEY: 're_test',
    });

    expect(missingSender.ok).toBe(false);
    expect(missingSender.missingCritical).toContain('RESEND_FROM');

    const missingKey = validateRuntimeEnv('webapp', {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://oran:test@localhost:5432/oran',
      ORAN_DATABASE_ROLE: 'oran_backend_runtime',
      ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
      CRON_SECRET: 'vercel-cron-secret',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
      RESEND_FROM: 'ORAN <notifications@openresourceaccessnetwork.com>',
    });

    expect(missingKey.ok).toBe(false);
    expect(missingKey.missingCritical).toContain('RESEND_API_KEY');
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
      ORAN_DATABASE_ROLE: 'oran_backend_runtime',
      ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
      CRON_SECRET: 'vercel-cron-secret',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
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
      ORAN_DATABASE_ROLE: 'oran_backend_runtime',
      ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
      CRON_SECRET: 'vercel-cron-secret',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
      NDP_211_POLLING_ENABLED: 'false',
    });

    expect(result.ok).toBe(true);
    expect(result.missingCritical).toEqual([]);
  });

  it('validates legacy Functions contracts from names-only sources', () => {
    const result = validateRuntimeEnv(
      'functions',
      [
        'AzureWebJobsStorage',
        'FUNCTIONS_WORKER_RUNTIME',
        'ORAN_APP_URL',
        'INTERNAL_API_KEY',
        'NEXT_PUBLIC_SENTRY_DSN',
      ],
      { nodeEnv: 'production' },
    );

    expect(result.ok).toBe(true);
    expect(result.missingCritical).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
