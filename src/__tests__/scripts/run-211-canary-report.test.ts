import { describe, expect, it } from 'vitest';

import {
  buildSampleReconciliation,
  extractSourceSnapshot,
  parseArgs,
} from '../../../scripts/run-211-canary-report.mjs';

describe('run-211-canary-report helpers', () => {
  it('parses command line flags', () => {
    expect(
      parseArgs(['--feed-id', 'feed-1', '--hours', '48', '--sample-size', '8', '--format', 'markdown', '--out', 'report.md']),
    ).toEqual({
      feedId: 'feed-1',
      hours: 48,
      sampleSize: 8,
      format: 'markdown',
      out: 'report.md',
    });
  });

  it('extracts source snapshot from 211 organization bundle records', () => {
    expect(
      extractSourceSnapshot({
        sourceRecordType: 'organization_bundle',
        parsedPayload: {
          name: 'Community Support Center',
          services: [{ name: 'Food Pantry' }, { name: 'Housing Navigation' }],
          locations: [{ addresses: [{ city: 'Oakland' }] }, { city: 'Berkeley' }],
        },
      }),
    ).toEqual({
      organizationName: 'Community Support Center',
      serviceNames: ['Food Pantry', 'Housing Navigation'],
      cities: ['Oakland', 'Berkeley'],
    });
  });

  it('builds reconciliation verdicts from source and canonical snapshots', () => {
    const reconciliation = buildSampleReconciliation(
      {
        sourceRecordType: 'organization_bundle',
        parsedPayload: {
          name: 'Community Support Center',
          services: [{ name: 'Food Pantry' }, { name: 'Housing Navigation' }],
          locations: [{ addresses: [{ city: 'Oakland' }] }],
        },
      },
      {
        organizations: [{ id: 'org-1', name: 'Community Support Center' }],
        services: [
          { id: 'svc-1', name: 'Food Pantry', publicationStatus: 'pending_review' },
          { id: 'svc-2', name: 'Benefits Enrollment', publicationStatus: 'pending_review' },
        ],
        locations: [{ id: 'loc-1', addressCity: 'Oakland', publicationStatus: 'unpublished' }],
        provenanceFieldCount: 12,
        acceptedFieldCount: 4,
      },
    );

    expect(reconciliation.verdict.organizationNameMatched).toBe(true);
    expect(reconciliation.verdict.services.matched).toEqual(['Food Pantry']);
    expect(reconciliation.verdict.services.missing).toEqual(['Housing Navigation']);
    expect(reconciliation.verdict.services.extra).toEqual(['Benefits Enrollment']);
    expect(reconciliation.verdict.cities.matched).toEqual(['Oakland']);
    expect(reconciliation.verdict.provenanceFieldCount).toBe(12);
    expect(reconciliation.verdict.acceptedFieldCount).toBe(4);
  });
});
