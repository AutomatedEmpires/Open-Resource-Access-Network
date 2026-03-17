import { describe, expect, test } from 'vitest';

import { buildBootstrapRegistry, canonicalizeUrl, matchSourceForUrl } from '../sourceRegistry';

describe('source registry', () => {
  test('canonicalizeUrl strips fragments and normalizes host', () => {
    const c = canonicalizeUrl('HTTPS://Example.GOV/path/#frag');
    expect(c).toBe('https://example.gov/path');
  });

  test('canonicalizeUrl strips common tracking parameters', () => {
    const c = canonicalizeUrl(
      'https://example.gov/path?utm_source=newsletter&gclid=abc123&keep=ok#frag'
    );
    expect(c).toBe('https://example.gov/path?keep=ok');
  });

  test('bootstrap quarantines .gov and .edu (LB10 hardening), quarantines .mil and blocks unregistered domains', () => {
    const registry = buildBootstrapRegistry('2026-03-02T00:00:00Z');

    expect(matchSourceForUrl('https://example.gov/a', registry)).toEqual({
      allowed: true,
      trustLevel: 'quarantine',
      sourceId: 'bootstrap-gov',
    });

    expect(matchSourceForUrl('https://example.edu/a', registry)).toEqual({
      allowed: true,
      trustLevel: 'quarantine',
      sourceId: 'bootstrap-edu',
    });

    expect(matchSourceForUrl('https://example.mil/a', registry)).toEqual({
      allowed: true,
      trustLevel: 'quarantine',
      sourceId: 'bootstrap-mil',
    });

    const other = matchSourceForUrl('https://example.com/a', registry);
    expect(other.allowed).toBe(false);
    expect(other.trustLevel).toBe('quarantine');
  });
});
