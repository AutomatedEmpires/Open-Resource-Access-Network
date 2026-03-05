import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptAssignment,
  AdminAssignmentSchema,
  AdminDecisionSchema,
  AssignmentStatusSchema,
  calculateSlaDuration,
  completeAssignment,
  countApprovals,
  countRejections,
  createAssignment,
  expireAssignment,
  getNextPriorityAdmin,
  getOverdueAssignments,
  getPendingAssignments,
  hasOrgApproval,
  isOverdue,
  isTerminalStatus,
  isValidTransition,
  skipAssignment,
  withdrawAssignment,
} from '../adminAssignments';

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const ORG_ID = '33333333-3333-4333-8333-333333333333';

describe('adminAssignments edge coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('validates status and decision schemas', () => {
    expect(AssignmentStatusSchema.parse('expired')).toBe('expired');
    expect(AdminDecisionSchema.parse('escalate')).toBe('escalate');
    expect(() => AssignmentStatusSchema.parse('invalid')).toThrow();
    expect(() => AdminDecisionSchema.parse('invalid')).toThrow();
  });

  it('validates assignment schema for happy and unhappy paths', () => {
    const parsed = AdminAssignmentSchema.parse({
      candidateId: CANDIDATE_ID,
      adminProfileId: ADMIN_ID,
      assignmentRank: 1,
      assignmentStatus: 'pending',
      assignedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.assignmentStatus).toBe('pending');

    expect(() =>
      AdminAssignmentSchema.parse({
        candidateId: CANDIDATE_ID,
        adminProfileId: ADMIN_ID,
        assignmentRank: 0,
        assignmentStatus: 'pending',
        assignedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('creates assignments with SLA defaults and optional distance', () => {
    const base = createAssignment(CANDIDATE_ID, ADMIN_ID, 2);
    expect(base.assignmentStatus).toBe('pending');
    expect(base.assignedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(base.decisionDueBy).toBe('2026-01-03T00:00:00.000Z');
    expect(base).not.toHaveProperty('distanceMeters');

    const withDistance = createAssignment(CANDIDATE_ID, ADMIN_ID, 3, {
      distanceMeters: 1250,
      slaDurationHours: 12,
    });
    expect(withDistance.distanceMeters).toBe(1250);
    expect(withDistance.decisionDueBy).toBe('2026-01-01T12:00:00.000Z');
  });

  it('accepts and completes assignments including acceptedAt fallback branch', () => {
    const pending = createAssignment(CANDIDATE_ID, ADMIN_ID, 1);
    const accepted = acceptAssignment(pending);
    expect(accepted.assignmentStatus).toBe('accepted');
    expect(accepted.acceptedAt).toBe('2026-01-01T00:00:00.000Z');

    vi.setSystemTime(new Date('2026-01-01T00:02:05.000Z'));
    const completedWithAcceptedAt = completeAssignment(accepted, 'approve', 'Looks good');
    expect(completedWithAcceptedAt.assignmentStatus).toBe('completed');
    expect(completedWithAcceptedAt.reviewDurationSecs).toBe(125);
    expect(completedWithAcceptedAt.decision).toBe('approve');
    expect(completedWithAcceptedAt.decisionNotes).toBe('Looks good');

    vi.setSystemTime(new Date('2026-01-01T01:00:00.000Z'));
    const acceptedWithoutTimestamp = {
      ...createAssignment(CANDIDATE_ID, ADMIN_ID, 1),
      assignmentStatus: 'accepted' as const,
    };
    const completedFallback = completeAssignment(acceptedWithoutTimestamp, 'needs_more_info');
    expect(completedFallback.reviewDurationSecs).toBe(0);
    expect(completedFallback.decision).toBe('needs_more_info');
  });

  it('throws for invalid status transitions', () => {
    const pending = createAssignment(CANDIDATE_ID, ADMIN_ID, 1);
    const accepted = acceptAssignment(pending);
    const completed = completeAssignment(accepted, 'reject');

    expect(() => acceptAssignment(accepted)).toThrow('Cannot accept assignment in status: accepted');
    expect(() => completeAssignment(pending, 'approve')).toThrow(
      'Cannot complete assignment in status: pending',
    );
    expect(() => skipAssignment(completed)).toThrow('Cannot skip assignment in status: completed');
    expect(() => expireAssignment(completed)).toThrow('Cannot expire assignment in status: completed');
    expect(() => withdrawAssignment(completed)).toThrow(
      'Cannot withdraw assignment in terminal status: completed',
    );
  });

  it('handles skip/expire/withdraw for non-terminal states', () => {
    const pending = createAssignment(CANDIDATE_ID, ADMIN_ID, 1);
    const accepted = acceptAssignment(pending);

    expect(skipAssignment(pending).assignmentStatus).toBe('skipped');
    expect(skipAssignment(accepted).assignmentStatus).toBe('skipped');
    expect(expireAssignment(pending).assignmentStatus).toBe('expired');
    expect(expireAssignment(accepted).assignmentStatus).toBe('expired');
    expect(withdrawAssignment(pending).assignmentStatus).toBe('withdrawn');
    expect(withdrawAssignment(accepted).assignmentStatus).toBe('withdrawn');
  });

  it('evaluates transitions and terminal states', () => {
    expect(isValidTransition('pending', 'accepted')).toBe(true);
    expect(isValidTransition('accepted', 'completed')).toBe(true);
    expect(isValidTransition('completed', 'pending')).toBe(false);
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('withdrawn')).toBe(true);
  });

  it('computes SLA duration across tiers and default fallback', () => {
    expect(calculateSlaDuration('green')).toBe(72);
    expect(calculateSlaDuration('yellow')).toBe(48);
    expect(calculateSlaDuration('orange')).toBe(24);
    expect(calculateSlaDuration('red')).toBe(12);
    expect(calculateSlaDuration('mystery' as never)).toBe(48);
  });

  it('computes overdue state and extracts overdue assignments', () => {
    const pending = createAssignment(CANDIDATE_ID, ADMIN_ID, 1, { slaDurationHours: 1 });
    expect(isOverdue({ ...pending, decisionDueBy: undefined })).toBe(false);

    vi.setSystemTime(new Date('2026-01-01T02:00:00.000Z'));
    expect(isOverdue(pending)).toBe(true);

    const terminal = { ...pending, assignmentStatus: 'completed' as const };
    expect(isOverdue(terminal)).toBe(false);

    const notOverdue = createAssignment(CANDIDATE_ID, ADMIN_ID, 2, { slaDurationHours: 12 });
    const overdue = getOverdueAssignments([pending, terminal, notOverdue]);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].assignmentRank).toBe(1);
  });

  it('aggregates approval/rejection/pending/priority helpers', () => {
    const assignments = [
      {
        ...createAssignment(CANDIDATE_ID, ADMIN_ID, 3),
        assignmentStatus: 'completed' as const,
        decision: 'approve' as const,
      },
      {
        ...createAssignment(CANDIDATE_ID, ORG_ID, 2),
        assignmentStatus: 'completed' as const,
        decision: 'approve' as const,
      },
      {
        ...createAssignment(CANDIDATE_ID, ADMIN_ID, 4),
        assignmentStatus: 'completed' as const,
        decision: 'reject' as const,
      },
      {
        ...createAssignment(CANDIDATE_ID, ADMIN_ID, 1),
        assignmentStatus: 'pending' as const,
      },
      {
        ...createAssignment(CANDIDATE_ID, ORG_ID, 5),
        assignmentStatus: 'pending' as const,
      },
    ];

    expect(countApprovals(assignments)).toBe(2);
    expect(countRejections(assignments)).toBe(1);
    expect(getPendingAssignments(assignments).map((a) => a.assignmentRank)).toEqual([1, 5]);
    expect(getNextPriorityAdmin(assignments)?.assignmentRank).toBe(1);

    const getProfileType = vi.fn((id: string) => (id === ORG_ID ? 'org' : 'admin'));
    expect(hasOrgApproval(assignments, getProfileType)).toBe(true);

    const shortCircuitGetType = vi.fn(() => 'org' as const);
    expect(
      hasOrgApproval(
        [{ ...createAssignment(CANDIDATE_ID, ADMIN_ID, 7), assignmentStatus: 'pending' }],
        shortCircuitGetType,
      ),
    ).toBe(false);
    expect(shortCircuitGetType).not.toHaveBeenCalled();

    expect(getNextPriorityAdmin([])).toBeUndefined();
  });
});
