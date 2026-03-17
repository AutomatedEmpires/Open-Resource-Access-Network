import { describe, expect, it } from 'vitest';

import { getLinkedServiceExecutionWarnings } from '@/services/plans/snapshotTrust';

describe('linked execution snapshot trust warnings', () => {
  it('warns on old snapshots and lower-trust records', () => {
    const warnings = getLinkedServiceExecutionWarnings({
      serviceId: 'svc-1',
      serviceName: 'Food Pantry One',
      organizationName: 'Helping Hands',
      trustBand: 'POSSIBLE',
      capturedAt: '2026-03-01T08:00:00.000Z',
    }, new Date('2026-03-17T08:00:00.000Z'));

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('captured');
    expect(warnings[1]).toContain('Trust is Possible');
  });
});
