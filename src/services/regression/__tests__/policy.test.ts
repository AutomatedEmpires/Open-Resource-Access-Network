import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import {
  applyRegressionVisibilityPolicies,
  shouldSuppressService,
} from '../policy';
import type { RegressionCandidate } from '../detector';

function buildCandidate(
  overrides: Partial<RegressionCandidate> = {},
): RegressionCandidate {
  return {
    serviceId: 'svc-1',
    serviceName: 'Shelter',
    signalType: 'feedback_severity',
    currentScore: 35,
    currentBand: 'POSSIBLE',
    reasons: ['Repeated negative reports'],
    recommendedAction: 'suppress',
    actionReason: 'Repeated negative reports require reverification',
    dedupeKey: 'svc-1:feedback_severity:123',
    notesText: 'Auto-flagged',
    ...overrides,
  };
}

describe('shouldSuppressService', () => {
  it('returns true only for suppress actions', () => {
    expect(shouldSuppressService(buildCandidate())).toBe(true);
    expect(
      shouldSuppressService(
        buildCandidate({ recommendedAction: 'reverify', signalType: 'score_staleness' }),
      ),
    ).toBe(false);
  });
});

describe('applyRegressionVisibilityPolicies', () => {
  it('returns an empty summary when no candidates require suppression', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;

    const summary = await applyRegressionVisibilityPolicies(client, [
      buildCandidate({ serviceId: 'svc-2', recommendedAction: 'reverify' }),
    ]);

    expect(summary).toEqual({ suppressedCount: 0, suppressedServiceIds: [] });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('deduplicates service ids and inactivates active listings', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'svc-1' }, { id: 'svc-3' }],
      }),
    } as unknown as PoolClient;

    const summary = await applyRegressionVisibilityPolicies(client, [
      buildCandidate(),
      buildCandidate({ serviceId: 'svc-1', signalType: 'score_degraded' }),
      buildCandidate({ serviceId: 'svc-2', recommendedAction: 'reverify' }),
      buildCandidate({ serviceId: 'svc-3', signalType: 'score_degraded' }),
    ]);

    expect(client.query).toHaveBeenCalledWith(expect.any(String), [['svc-1', 'svc-3']]);
    expect(summary).toEqual({
      suppressedCount: 2,
      suppressedServiceIds: ['svc-1', 'svc-3'],
    });
  });
});
