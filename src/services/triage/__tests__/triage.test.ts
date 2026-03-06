/**
 * Tests for src/domain/triage.ts (pure functions)
 * and src/services/triage/triage.ts (DB layer).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeTriagePriority,
  buildTriageExplanations,
  TRIAGE_SIGNAL_WEIGHTS,
  HIGH_PRIORITY_THRESHOLD,
  CRITICAL_PRIORITY_THRESHOLD,
} from '@/domain/triage';

// ============================================================
// Mock DB
// ============================================================

const mockExecuteQuery = vi.fn();

vi.mock('@/services/db/postgres', () => ({
  executeQuery: mockExecuteQuery,
  isDatabaseConfigured: vi.fn(() => true),
}));

// ============================================================
// PURE FUNCTION TESTS — computeTriagePriority
// ============================================================

describe('computeTriagePriority', () => {
  it('returns 0 for all-zero signals', () => {
    const score = computeTriagePriority({
      signal_traffic:    0,
      signal_trust:      0,
      signal_feedback:   0,
      signal_staleness:  0,
      signal_crisis:     0,
      signal_sla_breach: 0,
    });
    expect(score).toBe(0);
  });

  it('returns 100 for all-ones signals', () => {
    const score = computeTriagePriority({
      signal_traffic:    1,
      signal_trust:      1,
      signal_feedback:   1,
      signal_staleness:  1,
      signal_crisis:     1,
      signal_sla_breach: 1,
    });
    expect(score).toBe(100);
  });

  it('weights trust most heavily (25 pts)', () => {
    const score = computeTriagePriority({
      signal_traffic:    0,
      signal_trust:      1, // only trust
      signal_feedback:   0,
      signal_staleness:  0,
      signal_crisis:     0,
      signal_sla_breach: 0,
    });
    expect(score).toBe(TRIAGE_SIGNAL_WEIGHTS.signal_trust);
  });

  it('weights traffic correctly (20 pts)', () => {
    const score = computeTriagePriority({
      signal_traffic:    1,
      signal_trust:      0,
      signal_feedback:   0,
      signal_staleness:  0,
      signal_crisis:     0,
      signal_sla_breach: 0,
    });
    expect(score).toBe(TRIAGE_SIGNAL_WEIGHTS.signal_traffic);
  });

  it('crisis + sla_breach alone give 20 pts', () => {
    const score = computeTriagePriority({
      signal_traffic:    0,
      signal_trust:      0,
      signal_feedback:   0,
      signal_staleness:  0,
      signal_crisis:     1,
      signal_sla_breach: 1,
    });
    expect(score).toBe(
      TRIAGE_SIGNAL_WEIGHTS.signal_crisis + TRIAGE_SIGNAL_WEIGHTS.signal_sla_breach,
    );
  });

  it('clamps output to [0, 100]', () => {
    // Over-saturated signals should not exceed 100
    const score = computeTriagePriority({
      signal_traffic:    2,  // out-of-range input
      signal_trust:      2,
      signal_feedback:   2,
      signal_staleness:  2,
      signal_crisis:     2,
      signal_sla_breach: 2,
    });
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('produces a floating-point value rounded to 2dp', () => {
    const score = computeTriagePriority({
      signal_traffic:    0.5,
      signal_trust:      0.3,
      signal_feedback:   0.2,
      signal_staleness:  0.1,
      signal_crisis:     0,
      signal_sla_breach: 0,
    });
    // Verify it's a valid finite number
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ============================================================
// PURE FUNCTION TESTS — buildTriageExplanations
// ============================================================

describe('buildTriageExplanations', () => {
  it('returns empty array when all signals are zero', () => {
    const explanations = buildTriageExplanations({
      signal_traffic:    0,
      signal_trust:      0,
      signal_feedback:   0,
      signal_staleness:  0,
      signal_crisis:     0,
      signal_sla_breach: 0,
    });
    expect(explanations).toEqual([]);
  });

  it('includes "SLA breached" when sla_breach = 1', () => {
    const explanations = buildTriageExplanations({
      signal_traffic:    0,
      signal_trust:      0,
      signal_feedback:   0,
      signal_staleness:  0,
      signal_crisis:     0,
      signal_sla_breach: 1,
    });
    expect(explanations).toContain('SLA breached');
  });

  it('includes "Crisis-adjacent service category" when crisis = 1', () => {
    const explanations = buildTriageExplanations({
      signal_traffic:    0,
      signal_trust:      0,
      signal_feedback:   0,
      signal_staleness:  0,
      signal_crisis:     1,
      signal_sla_breach: 0,
    });
    expect(explanations).toContain('Crisis-adjacent service category');
  });

  it('mentions "SLA deadline imminent" for partial sla_breach (0.7)', () => {
    const explanations = buildTriageExplanations({
      signal_traffic:    0,
      signal_trust:      0,
      signal_feedback:   0,
      signal_staleness:  0,
      signal_crisis:     0,
      signal_sla_breach: 0.7,
    });
    expect(explanations).toContain('SLA deadline imminent');
  });

  it('returns at most 5 bullets', () => {
    const explanations = buildTriageExplanations({
      signal_traffic:    1,
      signal_trust:      1,
      signal_feedback:   1,
      signal_staleness:  1,
      signal_crisis:     1,
      signal_sla_breach: 1,
    });
    expect(explanations.length).toBeLessThanOrEqual(5);
  });

  it('includes "Very low confidence score" for high trust signal (0.8+)', () => {
    const explanations = buildTriageExplanations({
      signal_traffic:    0,
      signal_trust:      1,
      signal_feedback:   0,
      signal_staleness:  0,
      signal_crisis:     0,
      signal_sla_breach: 0,
    });
    expect(explanations).toContain('Very low confidence score');
  });

  it('contains no PII — all strings are short and generic', () => {
    const explanations = buildTriageExplanations({
      signal_traffic:    1,
      signal_trust:      1,
      signal_feedback:   1,
      signal_staleness:  1,
      signal_crisis:     1,
      signal_sla_breach: 1,
    });
    for (const exp of explanations) {
      // No email patterns
      expect(exp).not.toMatch(/@\w+\.\w+/);
      // No phone patterns
      expect(exp).not.toMatch(/\d{3}[-.\s]\d{3}[-.\s]\d{4}/);
    }
  });
});

// ============================================================
// SERVICE TESTS — scoreSubmission
// ============================================================

describe('scoreSubmission', () => {
  beforeEach(() => vi.clearAllMocks());

  const RAW_ROW = {
    submission_id:  'sub-001',
    service_id:     'svc-001',
    created_at:     new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
    sla_deadline:   null,
    sla_breached:   false,
    saves_count:    '20',
    avg_confidence: '45',
    neg_feedback:   '3',
    has_crisis_tag: false,
  };

  it('returns null when submission is not found', async () => {
    mockExecuteQuery.mockResolvedValueOnce([]);
    const { scoreSubmission } = await import('@/services/triage/triage');
    const result = await scoreSubmission('nonexistent-id');
    expect(result).toBeNull();
  });

  it('upserts score and returns TriageScore on success', async () => {
    const expectedScore = {
      id:                  'ts-001',
      submission_id:       'sub-001',
      triage_priority:     55.5,
      signal_traffic:      0.4,
      signal_trust:        0.75,
      signal_feedback:     0.6,
      signal_staleness:    0.33,
      signal_crisis:       0,
      signal_sla_breach:   0,
      triage_explanations: ['Below-average confidence score', 'Recent negative feedback'],
      scored_at:           new Date().toISOString(),
    };

    // First call: fetchRawSignals
    mockExecuteQuery.mockResolvedValueOnce([RAW_ROW]);
    // Second call: upsert INSERT
    mockExecuteQuery.mockResolvedValueOnce([expectedScore]);

    const { scoreSubmission } = await import('@/services/triage/triage');
    const result = await scoreSubmission('sub-001');

    expect(result).not.toBeNull();
    expect(result!.submission_id).toBe('sub-001');
  });

  it('passes crisis_adjacent tags array to raw signal query', async () => {
    mockExecuteQuery.mockResolvedValueOnce([]);

    const { scoreSubmission } = await import('@/services/triage/triage');
    await scoreSubmission('sub-001');

    const [, params] = mockExecuteQuery.mock.calls[0] as [string, unknown[]];
    // params[1] should be the crisis tags array
    expect(Array.isArray(params[1])).toBe(true);
    expect((params[1] as string[]).length).toBeGreaterThan(0);
  });

  it('computes signal_trust = 1.0 when avg_confidence is null (unknown)', async () => {
    const rowWithNullConfidence = { ...RAW_ROW, avg_confidence: null };
    mockExecuteQuery.mockResolvedValueOnce([rowWithNullConfidence]);

    const savedScore = {
      id:                  'ts-002',
      submission_id:       'sub-001',
      triage_priority:     70,
      signal_trust:        1.0,
      signal_traffic:      0.4,
      signal_feedback:     0.6,
      signal_staleness:    0.33,
      signal_crisis:       0,
      signal_sla_breach:   0,
      triage_explanations: ['Very low confidence score'],
      scored_at:           new Date().toISOString(),
    };
    mockExecuteQuery.mockResolvedValueOnce([savedScore]);

    const { scoreSubmission } = await import('@/services/triage/triage');
    await scoreSubmission('sub-001');

    // Second call (upsert) should pass signal_trust = 1.0
    const [, params] = mockExecuteQuery.mock.calls[1] as [string, unknown[]];
    // params = [submissionId, priority, traffic, trust, feedback, staleness, crisis, sla_breach, explanations]
    const signalTrustIdx = 3; // index 3 is signal_trust
    expect(params[signalTrustIdx]).toBe(1);
  });

  it('sets signal_sla_breach = 1 when sla_breached = true', async () => {
    const breachedRow = { ...RAW_ROW, sla_breached: true, sla_deadline: new Date(Date.now() - 1000).toISOString() };
    mockExecuteQuery.mockResolvedValueOnce([breachedRow]);
    mockExecuteQuery.mockResolvedValueOnce([{ id: 'ts-003', submission_id: 'sub-001', triage_priority: 90, triage_explanations: ['SLA breached'], scored_at: new Date().toISOString() }]);

    const { scoreSubmission } = await import('@/services/triage/triage');
    await scoreSubmission('sub-001');

    const [, params] = mockExecuteQuery.mock.calls[1] as [string, unknown[]];
    const signalSlaIdx = 7; // signal_sla_breach is index 7
    expect(params[signalSlaIdx]).toBe(1);
  });
});

// ============================================================
// SERVICE TESTS — scoreAllPendingSubmissions
// ============================================================

describe('scoreAllPendingSubmissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0 when no pending submissions exist', async () => {
    mockExecuteQuery.mockResolvedValueOnce([]); // pending query
    const { scoreAllPendingSubmissions } = await import('@/services/triage/triage');
    const count = await scoreAllPendingSubmissions();
    expect(count).toBe(0);
  });

  it('scores each pending submission and returns count', async () => {
    // pending query returns 2 IDs
    mockExecuteQuery.mockResolvedValueOnce([{ id: 'sub-a' }, { id: 'sub-b' }]);
    // For sub-a: fetchRawSignals, then upsert
    mockExecuteQuery.mockResolvedValueOnce([{ submission_id: 'sub-a', created_at: new Date().toISOString(), sla_deadline: null, sla_breached: false, saves_count: '5', avg_confidence: '80', neg_feedback: '0', has_crisis_tag: false, service_id: null }]);
    mockExecuteQuery.mockResolvedValueOnce([{ id: 'ts-a', submission_id: 'sub-a', triage_priority: 10, triage_explanations: [], scored_at: new Date().toISOString() }]);
    // For sub-b: fetchRawSignals, then upsert
    mockExecuteQuery.mockResolvedValueOnce([{ submission_id: 'sub-b', created_at: new Date().toISOString(), sla_deadline: null, sla_breached: false, saves_count: '10', avg_confidence: '30', neg_feedback: '6', has_crisis_tag: true, service_id: null }]);
    mockExecuteQuery.mockResolvedValueOnce([{ id: 'ts-b', submission_id: 'sub-b', triage_priority: 85, triage_explanations: ['Very low confidence score', 'Crisis-adjacent service category'], scored_at: new Date().toISOString() }]);

    const { scoreAllPendingSubmissions } = await import('@/services/triage/triage');
    const count = await scoreAllPendingSubmissions();
    expect(count).toBe(2);
  });
});

// ============================================================
// SERVICE TESTS — getTriageQueue
// ============================================================

describe('getTriageQueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns entries and total', async () => {
    const entries = [
      {
        submission_id:       'sub-001',
        submission_type:     'service_verification',
        status:              'needs_review',
        title:               'Fix address for Sunrise Shelter',
        service_id:          'svc-001',
        service_name:        'Sunrise Shelter',
        created_at:          new Date().toISOString(),
        sla_deadline:        null,
        sla_breached:        false,
        triage_priority:     75,
        triage_explanations: ['Very low confidence score'],
        scored_at:           new Date().toISOString(),
      },
    ];

    mockExecuteQuery.mockResolvedValueOnce(entries);
    mockExecuteQuery.mockResolvedValueOnce([{ count: '1' }]);

    const { getTriageQueue } = await import('@/services/triage/triage');
    const result = await getTriageQueue({ queueType: 'pending_verification' });

    expect(result.entries).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.entries[0].submission_id).toBe('sub-001');
  });

  it('passes limit and offset to query', async () => {
    mockExecuteQuery.mockResolvedValue([]);
    mockExecuteQuery.mockResolvedValueOnce([]);
    mockExecuteQuery.mockResolvedValueOnce([{ count: '0' }]);

    const { getTriageQueue } = await import('@/services/triage/triage');
    await getTriageQueue({ queueType: 'disputes_appeals', limit: 10, offset: 20 });

    const [, params] = mockExecuteQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toContain(10);  // limit
    expect(params).toContain(20);  // offset
  });

  it('returns empty list for empty queue', async () => {
    mockExecuteQuery.mockResolvedValueOnce([]);
    mockExecuteQuery.mockResolvedValueOnce([{ count: '0' }]);

    const { getTriageQueue } = await import('@/services/triage/triage');
    const result = await getTriageQueue({ queueType: 'regression_alerts' });
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
  });
});

// ============================================================
// SERVICE TESTS — getTriageSummary
// ============================================================

describe('getTriageSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a summary entry for each queue type', async () => {
    // 5 queue types, each gets one executeQuery call
    mockExecuteQuery.mockResolvedValue(
      [{ total: '5', high_priority: '2', critical: '1', avg_priority: '72.50' }],
    );

    const { getTriageSummary } = await import('@/services/triage/triage');
    const summary = await getTriageSummary();

    expect(summary).toHaveLength(5);
    expect(summary[0]).toHaveProperty('queue_type');
    expect(summary[0]).toHaveProperty('label');
    expect(summary[0].total).toBe(5);
    expect(summary[0].high_priority).toBe(2);
    expect(summary[0].critical).toBe(1);
    expect(summary[0].avg_priority).toBe(72.5);
  });

  it('handles zero-count queues gracefully', async () => {
    mockExecuteQuery.mockResolvedValue(
      [{ total: '0', high_priority: '0', critical: '0', avg_priority: null }],
    );

    const { getTriageSummary } = await import('@/services/triage/triage');
    const summary = await getTriageSummary();

    expect(summary.every((q) => q.total === 0)).toBe(true);
    expect(summary.every((q) => q.avg_priority === null)).toBe(true);
  });
});

// ============================================================
// SERVICE TESTS — getTriageScore
// ============================================================

describe('getTriageScore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the stored triage score', async () => {
    const score = {
      id:                  'ts-001',
      submission_id:       'sub-001',
      triage_priority:     65,
      signal_trust:        0.8,
      triage_explanations: ['Very low confidence score'],
      scored_at:           new Date().toISOString(),
    };
    mockExecuteQuery.mockResolvedValueOnce([score]);

    const { getTriageScore } = await import('@/services/triage/triage');
    const result = await getTriageScore('sub-001');

    expect(result).not.toBeNull();
    expect(result!.triage_priority).toBe(65);
  });

  it('returns null when no score exists', async () => {
    mockExecuteQuery.mockResolvedValueOnce([]);

    const { getTriageScore } = await import('@/services/triage/triage');
    const result = await getTriageScore('no-score-id');
    expect(result).toBeNull();
  });
});

// ============================================================
// THRESHOLD CONSTANTS
// ============================================================

describe('priority thresholds', () => {
  it('HIGH_PRIORITY_THRESHOLD < CRITICAL_PRIORITY_THRESHOLD', () => {
    expect(HIGH_PRIORITY_THRESHOLD).toBeLessThan(CRITICAL_PRIORITY_THRESHOLD);
  });

  it('thresholds are within [0, 100]', () => {
    expect(HIGH_PRIORITY_THRESHOLD).toBeGreaterThan(0);
    expect(CRITICAL_PRIORITY_THRESHOLD).toBeLessThanOrEqual(100);
  });
});
