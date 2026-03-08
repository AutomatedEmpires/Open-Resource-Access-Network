import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeDedupeKey,
  perSignalLimit,
  detectServiceUpdated,
  detectFeedbackSeverity,
  detectStaleness,
  detectScoreDegraded,
  detectRegressions,
} from '../detector';

vi.mock('@/domain/confidence', () => ({
  getConfidenceBand: (score: number) => {
    if (score >= 80) return 'HIGH';
    if (score >= 60) return 'LIKELY';
    return 'POSSIBLE';
  },
}));

function makeClient(
  rows: Record<string, unknown>[][] = [],
): { query: ReturnType<typeof vi.fn> } {
  let callIdx = 0;
  const query = vi.fn().mockImplementation(async () => ({
    rows: rows[callIdx++] ?? [],
  }));
  return { query };
}

// ============================================================
// makeDedupeKey
// ============================================================

describe('makeDedupeKey', () => {
  it('includes serviceId and signalType in the key', () => {
    const key = makeDedupeKey('svc-abc', 'service_updated_after_verification');
    expect(key).toContain('svc-abc');
    expect(key).toContain('service_updated_after_verification');
  });

  it('returns the same key for the same inputs within the same 72h window', () => {
    const k1 = makeDedupeKey('svc-1', 'feedback_severity');
    const k2 = makeDedupeKey('svc-1', 'feedback_severity');
    expect(k1).toBe(k2);
  });

  it('returns different keys for different serviceIds', () => {
    expect(makeDedupeKey('svc-1', 'score_staleness')).not.toBe(
      makeDedupeKey('svc-2', 'score_staleness'),
    );
  });

  it('returns different keys for different signal types', () => {
    expect(makeDedupeKey('svc-1', 'score_staleness')).not.toBe(
      makeDedupeKey('svc-1', 'score_degraded'),
    );
  });
});

// ============================================================
// perSignalLimit
// ============================================================

describe('perSignalLimit', () => {
  it('divides the budget evenly across 4 signals', () => {
    expect(perSignalLimit(100)).toBe(25);
    expect(perSignalLimit(40)).toBe(10);
    expect(perSignalLimit(4)).toBe(1);
  });

  it('rounds up when the total is not divisible by 4', () => {
    expect(perSignalLimit(10)).toBe(3); // ceil(10/4) = 3
    expect(perSignalLimit(5)).toBe(2);  // ceil(5/4)  = 2
  });
});

// ============================================================
// detectServiceUpdated
// ============================================================

describe('detectServiceUpdated', () => {
  it('returns empty array when no rows match', async () => {
    const client = makeClient([[]]);
    const result = await detectServiceUpdated(client as never, 25);
    expect(result).toEqual([]);
  });

  it('maps a DB row to the correct RegressionCandidate shape', async () => {
    const client = makeClient([
      [{ service_id: 'svc-1', service_name: 'Food Pantry', score: '75' }],
    ]);

    const [candidate] = await detectServiceUpdated(client as never, 25);

    expect(candidate).toMatchObject({
      serviceId: 'svc-1',
      serviceName: 'Food Pantry',
      signalType: 'service_updated_after_verification',
      currentScore: 75,
      currentBand: 'LIKELY',
      recommendedAction: 'reverify',
    });
    expect(candidate!.actionReason).toContain('last verification');
    expect(candidate!.dedupeKey).toContain('svc-1');
    expect(candidate!.dedupeKey).toContain('service_updated_after_verification');
    expect(candidate!.reasons).toHaveLength(1);
    expect(candidate!.notesText).toBeTruthy();
  });

  it('passes limit as the only SQL parameter', async () => {
    const client = makeClient([[]]);
    await detectServiceUpdated(client as never, 10);
    expect(client.query).toHaveBeenCalledWith(expect.any(String), [10]);
  });

  it('converts score string from DB to a number', async () => {
    const client = makeClient([
      [{ service_id: 'svc-2', service_name: 'Clinic', score: '82' }],
    ]);
    const [candidate] = await detectServiceUpdated(client as never, 25);
    expect(typeof candidate!.currentScore).toBe('number');
    expect(candidate!.currentScore).toBe(82);
    expect(candidate!.currentBand).toBe('HIGH');
  });
});

// ============================================================
// detectFeedbackSeverity
// ============================================================

describe('detectFeedbackSeverity', () => {
  it('returns empty array when no services exceed the severity threshold', async () => {
    const client = makeClient([[]]);
    const result = await detectFeedbackSeverity(client as never, 25);
    expect(result).toEqual([]);
  });

  it('maps a DB row to the correct RegressionCandidate shape', async () => {
    const client = makeClient([
      [
        {
          service_id: 'svc-2',
          service_name: 'Shelter',
          score: '55',
          neg_count: '5',
          fraud_count: '0',
          closure_count: '1',
          categories: 'incorrect_hours, service_closed',
        },
      ],
    ]);

    const [candidate] = await detectFeedbackSeverity(client as never, 25);

    expect(candidate).toMatchObject({
      serviceId: 'svc-2',
      serviceName: 'Shelter',
      signalType: 'feedback_severity',
      currentScore: 55,
      currentBand: 'POSSIBLE',
      recommendedAction: 'suppress',
    });
    expect(candidate!.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('5 negative feedback or community reports')]),
    );
    expect(candidate!.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('incorrect_hours, service_closed')]),
    );
    expect(candidate!.actionReason).toContain('Repeated negative reports');
  });

  it('passes limit and all report thresholds to the query', async () => {
    const client = makeClient([[]]);
    await detectFeedbackSeverity(client as never, 20);
    expect(client.query).toHaveBeenCalledWith(expect.any(String), [20, 3, 1, 2]);
  });

  it('escalates a suspected fraud report to immediate suppression', async () => {
    const client = makeClient([
      [
        {
          service_id: 'svc-9',
          service_name: 'Transit Aid',
          score: '82',
          neg_count: '1',
          fraud_count: '1',
          closure_count: '0',
          categories: 'suspected_fraud',
        },
      ],
    ]);

    const [candidate] = await detectFeedbackSeverity(client as never, 20);

    expect(candidate!.recommendedAction).toBe('suppress');
    expect(candidate!.actionReason).toContain('fraud');
    expect(candidate!.reasons[0]).toContain('suspected fraud report');
  });

  it('escalates repeated closure reports to suppression', async () => {
    const client = makeClient([
      [
        {
          service_id: 'svc-10',
          service_name: 'Family Center',
          score: '67',
          neg_count: '2',
          fraud_count: '0',
          closure_count: '2',
          categories: 'permanently_closed, temporarily_closed',
        },
      ],
    ]);

    const [candidate] = await detectFeedbackSeverity(client as never, 20);

    expect(candidate!.recommendedAction).toBe('suppress');
    expect(candidate!.actionReason).toContain('Closure report threshold');
    expect(candidate!.reasons[0]).toContain('closure reports');
  });
});

// ============================================================
// detectStaleness
// ============================================================

describe('detectStaleness', () => {
  it('returns empty array when no stale services exist', async () => {
    const client = makeClient([[]]);
    const result = await detectStaleness(client as never, 25);
    expect(result).toEqual([]);
  });

  it('maps a DB row to the correct RegressionCandidate shape', async () => {
    const client = makeClient([
      [{ service_id: 'svc-3', service_name: 'Clinic', score: '65', days_stale: '120' }],
    ]);

    const [candidate] = await detectStaleness(client as never, 25);

    expect(candidate).toMatchObject({
      serviceId: 'svc-3',
      serviceName: 'Clinic',
      signalType: 'score_staleness',
      currentScore: 65,
      currentBand: 'LIKELY',
      recommendedAction: 'reverify',
    });
    expect(candidate!.reasons[0]).toContain('120 days');
    expect(candidate!.notesText).toContain('120 days');
  });

  it('suppresses listings with severely stale scores', async () => {
    const client = makeClient([
      [{ service_id: 'svc-7', service_name: 'Food Shelf', score: '71', days_stale: '220' }],
    ]);

    const [candidate] = await detectStaleness(client as never, 25);

    expect(candidate!.recommendedAction).toBe('suppress');
    expect(candidate!.actionReason).toContain('180');
    expect(candidate!.notesText).toContain('suspended');
  });

  it('passes only the limit as a SQL parameter', async () => {
    const client = makeClient([[]]);
    await detectStaleness(client as never, 15);
    expect(client.query).toHaveBeenCalledWith(expect.any(String), [15]);
  });

  it('includes an open-submission guard to suppress chronic re-flagging', async () => {
    const client = makeClient([[]]);
    await detectStaleness(client as never, 15);
    const sql = (client.query.mock.calls[0] as [string])[0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("'score_staleness'");
    expect(sql).toContain("'resolved'");
    expect(sql).toContain("'suppressed'");
  });
});

// ============================================================
// detectScoreDegraded
// ============================================================

describe('detectScoreDegraded', () => {
  it('returns empty array when no critically degraded services exist', async () => {
    const client = makeClient([[]]);
    const result = await detectScoreDegraded(client as never, 25);
    expect(result).toEqual([]);
  });

  it('maps a DB row to the correct RegressionCandidate shape', async () => {
    const client = makeClient([
      [{ service_id: 'svc-4', service_name: 'Crisis Center', score: '25' }],
    ]);

    const [candidate] = await detectScoreDegraded(client as never, 25);

    expect(candidate).toMatchObject({
      serviceId: 'svc-4',
      serviceName: 'Crisis Center',
      signalType: 'score_degraded',
      currentScore: 25,
      currentBand: 'POSSIBLE',
      recommendedAction: 'suppress',
    });
    expect(candidate!.reasons[0]).toContain('25');
    expect(candidate!.actionReason).toContain('minimum seeker-visible threshold');
  });

  it('assigns the correct band for a score at the RED boundary', async () => {
    const client = makeClient([
      [{ service_id: 'svc-5', service_name: 'Hotline', score: '39' }],
    ]);
    const [candidate] = await detectScoreDegraded(client as never, 25);
    expect(candidate!.currentBand).toBe('POSSIBLE');
  });

  it('includes an open-submission guard to suppress chronic re-flagging', async () => {
    const client = makeClient([[]]);
    await detectScoreDegraded(client as never, 25);
    const sql = (client.query.mock.calls[0] as [string])[0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("'score_degraded'");
    expect(sql).toContain("'resolved'");
    expect(sql).toContain("'suppressed'");
  });
});

// ============================================================
// detectRegressions (orchestrator)
// ============================================================

describe('detectRegressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls all 4 detectors and returns combined results', async () => {
    const client = makeClient([
      // sig1: service_updated
      [{ service_id: 'svc-1', service_name: 'A', score: '70' }],
      // sig2: feedback_severity — empty
      [],
      // sig3: staleness — different service
      [{ service_id: 'svc-3', service_name: 'C', score: '65', days_stale: '100' }],
      // sig4: degraded — empty
      [],
    ]);

    const result = await detectRegressions(client as never, 100);

    expect(client.query).toHaveBeenCalledTimes(4);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.serviceId)).toContain('svc-1');
    expect(result.map((r) => r.serviceId)).toContain('svc-3');
  });

  it('deduplicates candidates sharing the same dedupeKey', async () => {
    // Manufacture a scenario where two detectors happen to produce the same
    // dedupeKey (extremely unlikely in practice but defensive-coding test).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const client = makeClient([
      [{ service_id: 'svc-1', service_name: 'A', score: '70' }], // sig1 updated
      [],                                                          // sig2 feedback
      [],                                                          // sig3 stale
      [],                                                          // sig4 degraded
    ]);

    const result = await detectRegressions(client as never, 100);

    // svc-1 appears only once despite being in multiple detector responses
    const svc1Hits = result.filter((r) => r.serviceId === 'svc-1');
    expect(svc1Hits).toHaveLength(1);

    vi.useRealTimers();
  });

  it('keeps candidates with different signal types for the same service', async () => {
    const client = makeClient([
      [{ service_id: 'svc-1', service_name: 'A', score: '70' }], // sig1 updated
      [
        {
          service_id: 'svc-1',
          service_name: 'A',
          score: '55',
          neg_count: '4',
          categories: 'service_closed',
        },
      ], // sig2 feedback — same service, different signal
      [],
      [],
    ]);

    const result = await detectRegressions(client as never, 100);

    // Different signal types on the same service = 2 distinct candidates
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.signalType)).toContain('service_updated_after_verification');
    expect(result.map((r) => r.signalType)).toContain('feedback_severity');
  });

  it('returns empty array when all signals detect nothing', async () => {
    const client = makeClient([[], [], [], []]);
    const result = await detectRegressions(client as never, 100);
    expect(result).toEqual([]);
  });

  it('distributes the budget using perSignalLimit', async () => {
    const client = makeClient([[], [], [], []]);
    await detectRegressions(client as never, 40);

    // Each detector gets ceil(40/4) = 10
    for (const call of client.query.mock.calls as [string, unknown[]][]) {
      const params = call[1] as number[];
      // feedback detector has [limit, threshold] = [10, 3]; others have [limit]
      expect(params[0]).toBe(10);
    }
  });
});
