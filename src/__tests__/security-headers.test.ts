import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production security headers', () => {
  const config = readFileSync(resolve(process.cwd(), 'next.config.mjs'), 'utf8');

  it('allows the first-party Clerk frontend API script and bot challenge', () => {
    expect(config).toMatch(/script-src[^\n]+https:\/\/clerk\.openresourceaccessnetwork\.com/);
    expect(config).toMatch(/script-src[^\n]+https:\/\/challenges\.cloudflare\.com/);
    expect(config).toContain("frame-src 'self' https://challenges.cloudflare.com");
  });

  it('supports Clerk workers and required runtime connections without broad wildcards', () => {
    expect(config).toContain("worker-src 'self' blob:");
    expect(config).toContain('https://clerk-telemetry.com');
    expect(config).toContain('https://*.supabase.co');
    expect(config).toContain('https://*.sentry.io');
    expect(config).not.toMatch(/script-src[^\n]+\shttps:\s/);
  });

  it('resolves the production CSP with the required Clerk sources', async () => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    const previousNodeEnv = mutableEnv.NODE_ENV;
    mutableEnv.NODE_ENV = 'production';

    try {
      const loaded = await import('../../next.config.mjs');
      const routes = await loaded.default.headers?.();
      const csp = routes?.[0]?.headers.find(
        (header: { key: string; value: string }) => header.key === 'Content-Security-Policy',
      )?.value ?? '';

      expect(csp).toContain("script-src 'self' 'unsafe-inline'");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).toContain('https://clerk.openresourceaccessnetwork.com');
      expect(csp).toContain('https://challenges.cloudflare.com');
      expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com");
    } finally {
      if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = previousNodeEnv;
    }
  });
});
