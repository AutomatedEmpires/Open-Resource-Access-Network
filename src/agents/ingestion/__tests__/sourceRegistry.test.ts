import { describe, expect, test } from 'vitest';

import {
  buildBootstrapRegistry,
  canonicalizeUrl,
  matchSourceForUrl,
  SourceRegistryEntrySchema,
} from '../sourceRegistry';

describe('source registry', () => {
  test('requires an explicit resource purpose for every registry entry', () => {
    expect(SourceRegistryEntrySchema.safeParse({
      id: 'unclassified-source',
      displayName: 'Unclassified source',
      trustLevel: 'allowlisted',
      domainRules: [{ type: 'exact_host', value: 'example.org' }],
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    }).success).toBe(false);
  });

  test('canonicalizeUrl strips fragments and normalizes host', () => {
    const c = canonicalizeUrl('HTTPS://Example.GOV/path/#frag');
    expect(c).toBe('https://example.gov/path');
  });

  test('prefers an exact source over a broad suffix source', () => {
    const now = '2026-03-02T00:00:00.000Z';
    const registry = [
      SourceRegistryEntrySchema.parse({
        id: 'broad-gov',
        displayName: 'All government',
        trustLevel: 'quarantine',
        resourcePurpose: 'program_navigation',
        domainRules: [{ type: 'suffix', value: '.gov' }],
        createdAt: now,
        updatedAt: now,
      }),
      SourceRegistryEntrySchema.parse({
        id: 'snap-retailers',
        displayName: 'SNAP retailer reference',
        trustLevel: 'allowlisted',
        resourcePurpose: 'supporting_reference',
        domainRules: [{ type: 'exact_host', value: 'snap-retailers.example.gov' }],
        createdAt: now,
        updatedAt: now,
      }),
    ];

    expect(matchSourceForUrl('https://snap-retailers.example.gov/list', registry)).toEqual({
      allowed: true,
      trustLevel: 'allowlisted',
      sourceId: 'snap-retailers',
    });
  });

  test('canonicalizeUrl strips common tracking parameters', () => {
    const c = canonicalizeUrl(
      'https://example.gov/path?utm_source=newsletter&gclid=abc123&keep=ok#frag'
    );
    expect(c).toBe('https://example.gov/path?keep=ok');
  });

  test('bootstrap quarantines .gov and .edu (LB10 hardening), quarantines .mil and blocks unregistered domains', () => {
    const registry = buildBootstrapRegistry('2026-03-02T00:00:00Z');

    expect(registry.find((entry) => entry.id === 'bootstrap-gov')?.resourcePurpose)
      .toBe('program_navigation');

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
