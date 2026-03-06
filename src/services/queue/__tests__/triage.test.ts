import { describe, expect, it } from 'vitest';
import {
  computeTriagePriority,
  scoreToTier,
  TRIAGE_TIER_THRESHOLDS,
  type TriageInput,
} from '../triage';

// Fixed "now" so tests are deterministic regardless of wall clock
const NOW = new Date('2024-06-01T12:00:00Z').getTime();

function input(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    dbPriority: 0,
    createdAt: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
    status: 'submitted',
    slaDeadline: null,
    slaBreached: false,
    nowMs: NOW,
    ...overrides,
  };
}

// ============================================================
// scoreToTier
// ============================================================

describe('scoreToTier', () => {
  it('maps scores at tier boundaries correctly', () => {
    expect(scoreToTier(TRIAGE_TIER_THRESHOLDS.URGENT)).toBe('urgent');
    expect(scoreToTier(TRIAGE_TIER_THRESHOLDS.HIGH)).toBe('high');
    expect(scoreToTier(TRIAGE_TIER_THRESHOLDS.NORMAL)).toBe('normal');
    expect(scoreToTier(TRIAGE_TIER_THRESHOLDS.NORMAL - 1)).toBe('low');
  });

  it('caps urgent at 100', () => {
    expect(scoreToTier(100)).toBe('urgent');
  });

  it('maps 0 to low', () => {
    expect(scoreToTier(0)).toBe('low');
  });
});

// ============================================================
// computeTriagePriority — SLA signals
// ============================================================

describe('computeTriagePriority — SLA signals', () => {
  it('adds maximum urgency when SLA is breached', () => {
    const result = computeTriagePriority(input({ slaBreached: true }));
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.tier).toBe('urgent');
    expect(result.explanations).toContain('SLA has been breached');
  });

  it('slaBreached takes priority over slaDeadline logic', () => {
    const future = new Date(NOW + 100 * 60 * 60 * 1000).toISOString();
    const result = computeTriagePriority(input({ slaBreached: true, slaDeadline: future }));
    expect(result.explanations).toContain('SLA has been breached');
    expect(result.explanations).not.toContain('SLA deadline within 24 hours');
    expect(result.explanations).not.toContain('SLA deadline within 72 hours');
  });

  it('adds critical signal when SLA is within 24 hours', () => {
    const deadline = new Date(NOW + 12 * 60 * 60 * 1000).toISOString(); // 12 h ahead
    const result = computeTriagePriority(input({ slaDeadline: deadline }));
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.explanations).toContain('SLA deadline within 24 hours');
  });

  it('adds warning signal when SLA is within 72 hours', () => {
    const deadline = new Date(NOW + 48 * 60 * 60 * 1000).toISOString(); // 48 h ahead
    const result = computeTriagePriority(input({ slaDeadline: deadline }));
    expect(result.score).toBeGreaterThanOrEqual(15);
    expect(result.explanations).toContain('SLA deadline within 72 hours');
  });

  it('does NOT add SLA signal when deadline is far in the future', () => {
    const deadline = new Date(NOW + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days
    const result = computeTriagePriority(input({ slaDeadline: deadline }));
    expect(result.explanations).not.toContain('SLA deadline within 24 hours');
    expect(result.explanations).not.toContain('SLA deadline within 72 hours');
  });

  it('does NOT add SLA approaching signal when no deadline', () => {
    const result = computeTriagePriority(input({ slaDeadline: null }));
    expect(result.explanations).not.toContain('SLA deadline within 24 hours');
    expect(result.explanations).not.toContain('SLA deadline within 72 hours');
  });
});

// ============================================================
// computeTriagePriority — Status signal
// ============================================================

describe('computeTriagePriority — status signal', () => {
  it('adds escalation signal for escalated status', () => {
    const result = computeTriagePriority(input({ status: 'escalated' }));
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.explanations).toContain('Submission has been escalated');
  });

  it('does NOT add escalation signal for submitted status', () => {
    const result = computeTriagePriority(input({ status: 'submitted' }));
    expect(result.explanations).not.toContain('Submission has been escalated');
  });

  it('does NOT add escalation signal for under_review status', () => {
    const result = computeTriagePriority(input({ status: 'under_review' }));
    expect(result.explanations).not.toContain('Submission has been escalated');
  });
});

// ============================================================
// computeTriagePriority — Staleness signal
// ============================================================

describe('computeTriagePriority — staleness signal', () => {
  it('adds high staleness signal when entry is older than 14 days', () => {
    const old = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();
    const result = computeTriagePriority(input({ createdAt: old }));
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.explanations.some((e) => e.startsWith('In queue for'))).toBe(true);
  });

  it('adds medium staleness signal for entries 8–14 days old', () => {
    const old = new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = computeTriagePriority(input({ createdAt: old }));
    expect(result.score).toBeGreaterThanOrEqual(5);
    const msg = result.explanations.find((e) => e.startsWith('In queue for'));
    expect(msg).toBeDefined();
  });

  it('does NOT add staleness signal for fresh entries', () => {
    const fresh = new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day
    const result = computeTriagePriority(input({ createdAt: fresh }));
    expect(result.explanations.some((e) => e.startsWith('In queue for'))).toBe(false);
  });
});

// ============================================================
// computeTriagePriority — DB priority signal
// ============================================================

describe('computeTriagePriority — DB priority signal', () => {
  it('high dbPriority adds explanation', () => {
    const result = computeTriagePriority(input({ dbPriority: 100 }));
    expect(result.explanations).toContain('High base priority');
    expect(result.score).toBeGreaterThan(0);
  });

  it('zero dbPriority adds no contribution', () => {
    const result = computeTriagePriority(input({ dbPriority: 0 }));
    expect(result.explanations).not.toContain('High base priority');
  });

  it('clamps dbPriority contribution between 0 and 20', () => {
    const high = computeTriagePriority(input({ dbPriority: 100 }));
    const low  = computeTriagePriority(input({ dbPriority:   0 }));
    const diff = high.score - low.score;
    expect(diff).toBeLessThanOrEqual(20);
  });
});

// ============================================================
// computeTriagePriority — Combined signals + tier assignment
// ============================================================

describe('computeTriagePriority — combined signals', () => {
  it('returns low tier for a fresh submitted entry with no SLA and zero priority', () => {
    const result = computeTriagePriority(input());
    expect(result.tier).toBe('low');
    expect(result.explanations).toHaveLength(0);
  });

  it('stacks signals up to 100 maximum', () => {
    const deadline = new Date(NOW + 6 * 60 * 60 * 1000).toISOString();
    const result = computeTriagePriority(input({
      slaBreached: true,
      status: 'escalated',
      dbPriority: 100,
      slaDeadline: deadline,
    }));
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.tier).toBe('urgent');
  });

  it('escalated + SLA critical yields urgent tier', () => {
    const deadline = new Date(NOW + 10 * 60 * 60 * 1000).toISOString();
    const result = computeTriagePriority(input({
      status: 'escalated',
      slaDeadline: deadline,
    }));
    // 30 (escalated) + 25 (SLA critical) = 55 → high tier minimum
    expect(result.score).toBeGreaterThanOrEqual(55);
    expect(['urgent', 'high']).toContain(result.tier);
  });

  it('SLA breached alone yields urgent tier', () => {
    const result = computeTriagePriority(input({ slaBreached: true }));
    expect(result.tier).toBe('urgent');
  });

  it('explanations are ordered — highest-weight signals appear first', () => {
    const result = computeTriagePriority(input({ slaBreached: true, status: 'escalated' }));
    expect(result.explanations[0]).toBe('SLA has been breached');
    expect(result.explanations[1]).toBe('Submission has been escalated');
  });

  it('score is deterministic across multiple calls with same input', () => {
    const i = input({ slaBreached: true, dbPriority: 60 });
    const a = computeTriagePriority(i);
    const b = computeTriagePriority(i);
    expect(a.score).toBe(b.score);
    expect(a.tier).toBe(b.tier);
    expect(a.explanations).toEqual(b.explanations);
  });
});
