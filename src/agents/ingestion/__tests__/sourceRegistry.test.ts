import { describe, expect, test } from 'vitest';

import { buildBootstrapRegistry, canonicalizeUrl, matchSourceForUrl } from '../sourceRegistry';

describe('source registry', () => {
  test('canonicalizeUrl strips fragments and normalizes host', () => {
    const c = canonicalizeUrl('HTTPS://Example.GOV/path/#frag');
    expect(c).toBe('https://example.gov/path');
  });

  test('bootstrap allows .gov and .mil, quarantines others', () => {
    const registry = buildBootstrapRegistry('2026-03-02T00:00:00Z');

    expect(matchSourceForUrl('https://example.gov/a', registry)).toEqual({
      allowed: true,
      trustLevel: 'allowlisted',
      sourceId: 'bootstrap-gov',
    });

    expect(matchSourceForUrl('https://example.mil/a', registry)).toEqual({
      allowed: true,
      trustLevel: 'allowlisted',
      sourceId: 'bootstrap-mil',
    });

    const other = matchSourceForUrl('https://example.com/a', registry);
    expect(other.allowed).toBe(false);
    expect(other.trustLevel).toBe('quarantine');
  });
});
