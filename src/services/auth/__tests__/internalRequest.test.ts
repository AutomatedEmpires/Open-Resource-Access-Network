import { describe, expect, it } from 'vitest';

import { authorizeInternalRequest } from '@/services/auth/internalRequest';

function requestWith(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) };
}

const configuredEnv = {
  CRON_SECRET: 'vercel-cron-secret',
  INTERNAL_API_KEY: 'rollback-internal-key',
};

describe('authorizeInternalRequest', () => {
  it('fails closed when neither internal credential is configured', () => {
    expect(authorizeInternalRequest(requestWith(), {
      CRON_SECRET: '',
      INTERNAL_API_KEY: '',
    })).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('accepts the Vercel Cron Bearer credential', () => {
    expect(authorizeInternalRequest(requestWith({
      authorization: 'Bearer vercel-cron-secret',
    }), configuredEnv)).toEqual({ ok: true, method: 'vercel_cron' });
  });

  it('accepts the separate rollback header credential', () => {
    expect(authorizeInternalRequest(requestWith({
      'x-oran-internal-key': 'rollback-internal-key',
    }), configuredEnv)).toEqual({ ok: true, method: 'internal_header' });
  });

  it('temporarily accepts the legacy rollback Bearer credential', () => {
    expect(authorizeInternalRequest(requestWith({
      authorization: 'Bearer rollback-internal-key',
    }), configuredEnv)).toEqual({ ok: true, method: 'legacy_bearer' });
  });

  it('rejects missing, malformed, and incorrect credentials', () => {
    expect(authorizeInternalRequest(requestWith(), configuredEnv)).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
    expect(authorizeInternalRequest(requestWith({
      authorization: 'vercel-cron-secret',
    }), configuredEnv)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(authorizeInternalRequest(requestWith({
      authorization: 'Bearer wrong-secret',
      'x-oran-internal-key': 'wrong-key',
    }), configuredEnv)).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('does not accept CRON_SECRET through the rollback-only header', () => {
    expect(authorizeInternalRequest(requestWith({
      'x-oran-internal-key': 'vercel-cron-secret',
    }), configuredEnv)).toEqual({ ok: false, reason: 'unauthorized' });
  });
});
