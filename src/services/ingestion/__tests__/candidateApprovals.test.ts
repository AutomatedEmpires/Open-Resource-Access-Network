import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  executeQuery: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);

import {
  assertCandidatePublishApprovalEvidence,
  claimCandidateApproval,
  decideCandidateApproval,
  isCandidateApprovalEvidenceProvisioned,
} from '../candidateApprovals';

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222';

function createTransactionQuery(
  approvalCount: number,
  rejectionCount: number,
  options: {
    expiresAt?: string | null;
    assignmentStatus?: 'pending' | 'claimed';
    escalationCount?: number;
    reviewerRole?: string;
    readiness?: Partial<{
      has_required_fields: boolean;
      has_required_tags: boolean;
      tags_confirmed: boolean;
      meets_score_threshold: boolean;
      pending_tag_count: number;
      blockers: unknown;
    }>;
  } = {},
) {
  return vi.fn(async (query: string, _params?: unknown[]) => {
    if (query.includes('FROM public.extracted_candidates') && query.includes('FOR UPDATE')) {
      return {
        rows: [{
          candidate_id: CANDIDATE_ID,
          review_status: 'in_review',
          published_service_id: null,
        }],
      };
    }
    if (query.includes('FROM public.admin_review_profiles reviewer')) {
      return {
        rows: [{
          id: 'reviewer-profile-1',
          user_id: 'reviewer-user-1',
          is_active: true,
          is_accepting_new: true,
          in_review_count: 0,
          max_in_review: 5,
          account_status: 'active',
          role: options.reviewerRole ?? 'community_admin',
        }],
      };
    }
    if (query.includes('FROM public.candidate_admin_assignments') && query.includes('FOR UPDATE')) {
      return {
        rows: [{
          id: ASSIGNMENT_ID,
          candidate_id: CANDIDATE_ID,
          admin_profile_id: 'reviewer-profile-1',
          status: options.assignmentStatus ?? 'claimed',
          expires_at: options.expiresAt ?? null,
        }],
      };
    }
    if (query.includes('public.evaluate_candidate_readiness')) {
      return { rows: [{ is_ready: false }] };
    }
    if (query.includes('FROM public.candidate_readiness') && query.includes('FOR UPDATE')) {
      return {
        rows: [{
          has_required_fields: true,
          has_required_tags: true,
          tags_confirmed: true,
          meets_score_threshold: true,
          pending_tag_count: 0,
          blockers: ['missing_two_person_approval'],
          ...options.readiness,
        }],
      };
    }
    if (query.includes("SET status = 'claimed'")) return { rows: [{ id: ASSIGNMENT_ID }] };
    if (query.includes("SET status = 'completed'")) return { rows: [{ id: ASSIGNMENT_ID }] };
    if (query.includes('AS rejection_count')) {
      return {
        rows: [{
          approval_count: approvalCount,
          rejection_count: rejectionCount,
          escalation_count: options.escalationCount ?? 0,
        }],
      };
    }
    if (query.includes('UPDATE public.candidate_readiness')) {
      return { rows: [{ candidate_id: CANDIDATE_ID }] };
    }
    if (query.includes('UPDATE public.extracted_candidates')) {
      return { rows: [{ candidate_id: CANDIDATE_ID }] };
    }
    return { rows: [] };
  });
}

async function decide(
  decision: 'approved' | 'rejected' | 'escalated',
  approvalCount: number,
  rejectionCount: number,
  options?: Parameters<typeof createTransactionQuery>[2],
) {
  const query = createTransactionQuery(approvalCount, rejectionCount, options);
  dbMocks.withTransaction.mockImplementationOnce(async (callback) => callback({ query }));
  const result = await decideCandidateApproval({
    candidateId: CANDIDATE_ID,
    assignmentId: ASSIGNMENT_ID,
    actorUserId: 'reviewer-user-1',
    decision,
    ...(decision === 'approved'
      ? {}
      : { notes: 'Verified conflict requiring further independent review.' }),
  });
  return { query, result };
}

describe('candidate approval consensus', () => {
  beforeEach(() => {
    dbMocks.withTransaction.mockReset();
  });

  it('rejects unreasoned negative decisions before opening a transaction', async () => {
    await expect(decideCandidateApproval({
      candidateId: CANDIDATE_ID,
      assignmentId: ASSIGNMENT_ID,
      actorUserId: 'reviewer-user-1',
      decision: 'rejected',
      notes: 'too short',
    })).rejects.toThrow('substantive review note');
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects ORAN-admin oversight profiles before recording a reviewer decision', async () => {
    const query = createTransactionQuery(0, 0, { reviewerRole: 'oran_admin' });
    dbMocks.withTransaction.mockImplementationOnce(async (callback) => callback({ query }));

    await expect(decideCandidateApproval({
      candidateId: CANDIDATE_ID,
      assignmentId: ASSIGNMENT_ID,
      actorUserId: 'reviewer-user-1',
      decision: 'approved',
    })).rejects.toThrow('Only an active assigned reviewer');

    expect(query.mock.calls.some(([sql]) => sql.includes("SET status = 'completed'"))).toBe(false);
  });

  it('enforces the claim deadline in the database update', async () => {
    const query = createTransactionQuery(0, 0, {
      assignmentStatus: 'pending',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    dbMocks.withTransaction.mockImplementationOnce(async (callback) => callback({ query }));

    await expect(claimCandidateApproval({
      candidateId: CANDIDATE_ID,
      assignmentId: ASSIGNMENT_ID,
      actorUserId: 'reviewer-user-1',
    })).resolves.toEqual({ status: 'claimed' });

    const claimSql = String(query.mock.calls.find(([sql]) => (
      sql.includes("SET status = 'claimed'")
    ))?.[0]);
    expect(claimSql).toContain('expires_at IS NULL OR expires_at > NOW()');
  });

  it('keeps a single rejection nonterminal and escalates for another independent review', async () => {
    const { query, result } = await decide('rejected', 0, 1);

    expect(result).toEqual({
      status: 'escalated', approvalCount: 0, rejectionCount: 1, escalationCount: 0,
    });
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'reassigned'"),
      expect.anything(),
    );
  });

  it('treats one approval and one rejection as disagreement, never authorization', async () => {
    const { query, result } = await decide('rejected', 1, 1);

    expect(result).toEqual({
      status: 'escalated', approvalCount: 1, rejectionCount: 1, escalationCount: 0,
    });
    const readinessCall = query.mock.calls.find(([sql]) => sql.includes('UPDATE public.candidate_readiness'));
    expect(readinessCall?.[1]).toEqual([
      CANDIDATE_ID,
      1,
      false,
      'escalated',
      true,
    ]);
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'reassigned'"),
      expect.anything(),
    );
    const aggregateDecisionSql = String(query.mock.calls.find(([sql]) => (
      sql.includes('AS rejection_count')
    ))?.[0]);
    expect(aggregateDecisionSql).toContain('approval.decision_reviewer_profile_id');
    expect(aggregateDecisionSql).not.toContain('reviewer.user_id');
    expect(aggregateDecisionSql).not.toMatch(/outcome_notes|completed_at|admin_profile_id/);
  });

  it('records an independent approval after a rejection without treating peer outcomes as safety blockers', async () => {
    const { query, result } = await decide('approved', 1, 1, {
      readiness: {
        blockers: [
          'candidate_rejected',
          'candidate_escalated',
          'candidate_review_disagreement',
          'missing_two_person_approval',
        ],
      },
    });

    expect(result).toEqual({
      status: 'escalated', approvalCount: 1, rejectionCount: 1, escalationCount: 0,
    });
    expect(query.mock.calls.some(([sql]) => sql.includes("SET status = 'completed'"))).toBe(true);
  });

  it('records an independent approval after an escalation without revealing it as a static blocker', async () => {
    const { query, result } = await decide('approved', 1, 0, {
      escalationCount: 1,
      readiness: {
        blockers: ['candidate_escalated', 'missing_two_person_approval'],
      },
    });

    expect(result).toEqual({
      status: 'escalated', approvalCount: 1, rejectionCount: 0, escalationCount: 1,
    });
    expect(query.mock.calls.some(([sql]) => sql.includes("SET status = 'completed'"))).toBe(true);
  });

  it('requires two independent matching rejections before terminal rejection', async () => {
    const { query, result } = await decide('rejected', 0, 2);

    expect(result).toEqual({
      status: 'rejected', approvalCount: 0, rejectionCount: 2, escalationCount: 0,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'reassigned'"),
      [CANDIDATE_ID],
    );
  });

  it('verifies only after two matching approvals with no rejection', async () => {
    const { query, result } = await decide('approved', 2, 0);

    expect(result).toEqual({
      status: 'verified', approvalCount: 2, rejectionCount: 0, escalationCount: 0,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'reassigned'"),
      [CANDIDATE_ID],
    );
    const evaluationIndex = query.mock.calls.findIndex(([sql]) => (
      sql.includes('public.evaluate_candidate_readiness')
    ));
    const completionIndex = query.mock.calls.findIndex(([sql]) => (
      sql.includes("SET status = 'completed'")
    ));
    expect(evaluationIndex).toBeGreaterThan(-1);
    expect(completionIndex).toBeGreaterThan(evaluationIndex);
    const completionCall = query.mock.calls[completionIndex];
    expect(String(completionCall?.[0])).toContain('decision_reviewer_profile_id = $4');
    expect(String(completionCall?.[0])).toContain(
      'expires_at IS NULL OR expires_at > NOW()',
    );
    expect(completionCall?.[1]).toEqual([
      ASSIGNMENT_ID,
      'verified',
      null,
      'reviewer-profile-1',
    ]);
  });

  it('keeps two approvals non-authoritative while any escalation remains', async () => {
    const { query, result } = await decide('approved', 2, 0, { escalationCount: 1 });

    expect(result).toEqual({
      status: 'escalated', approvalCount: 2, rejectionCount: 0, escalationCount: 1,
    });
    const readinessCall = query.mock.calls.find(([sql]) => (
      sql.includes('UPDATE public.candidate_readiness')
    ));
    expect(readinessCall?.[1]).toEqual([
      CANDIDATE_ID,
      2,
      false,
      'escalated',
      false,
    ]);
  });

  it('blocks approval while any non-approval readiness evidence is unresolved', async () => {
    const query = createTransactionQuery(0, 0, {
      readiness: {
        tags_confirmed: false,
        pending_tag_count: 1,
        blockers: ['pending_tag_confirmation', 'missing_two_person_approval'],
      },
    });
    dbMocks.withTransaction.mockImplementationOnce(async (callback) => callback({ query }));

    await expect(decideCandidateApproval({
      candidateId: CANDIDATE_ID,
      assignmentId: ASSIGNMENT_ID,
      actorUserId: 'reviewer-user-1',
      decision: 'approved',
    })).rejects.toThrow('complete, confirmed, and safety-cleared');

    expect(query.mock.calls.some(([sql]) => sql.includes("SET status = 'completed'"))).toBe(false);
  });

  it('rejects a decision after the claimed assignment evidence window expires', async () => {
    const query = createTransactionQuery(0, 0, {
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    dbMocks.withTransaction.mockImplementationOnce(async (callback) => callback({ query }));

    await expect(decideCandidateApproval({
      candidateId: CANDIDATE_ID,
      assignmentId: ASSIGNMENT_ID,
      actorUserId: 'reviewer-user-1',
      decision: 'approved',
    })).rejects.toThrow('expired and must be rerouted');

    expect(query.mock.calls.some(([sql]) => sql.includes("SET status = 'completed'"))).toBe(false);
  });
});

describe('evidence schema probe', () => {
  beforeEach(() => {
    dbMocks.executeQuery.mockReset();
  });

  it('fails closed when the probe query errors', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('connection lost'));
    await expect(isCandidateApprovalEvidenceProvisioned()).resolves.toBe(false);
  });

  it('requires BOTH the evidence column and the protection trigger', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([]);
    await expect(isCandidateApprovalEvidenceProvisioned()).resolves.toBe(false);

    dbMocks.executeQuery.mockResolvedValueOnce([]);
    await expect(isCandidateApprovalEvidenceProvisioned()).resolves.toBe(false);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ exists: true }]);
    await expect(isCandidateApprovalEvidenceProvisioned()).resolves.toBe(true);
    expect(dbMocks.executeQuery.mock.calls.some(([sql]) => (
      String(sql).includes("attname = 'decision_reviewer_profile_id'")
    ))).toBe(true);
    const activationSql = String(dbMocks.executeQuery.mock.calls.at(-1)?.[0]);
    expect(activationSql).toContain("tgenabled IN ('O', 'A')");
    expect(activationSql).toContain('trg_enforce_candidate_revision_lineage');
    expect(activationSql).toContain('candidate_admin_assignments_decision_reviewer_check');
    expect(activationSql).toContain('convalidated IS TRUE');
    expect(activationSql).toContain('idx_extracted_candidates_lineage_revision');
  });
});

describe('publish approval evidence gate', () => {
  beforeEach(() => {
    dbMocks.executeQuery.mockReset();
  });

  function provisionProbe(provisioned: boolean) {
    if (provisioned) {
      dbMocks.executeQuery
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([{ exists: true }]);
    } else {
      dbMocks.executeQuery.mockResolvedValueOnce([]);
    }
  }

  it('is inert while the evidence schema is unprovisioned (legacy regime)', async () => {
    provisionProbe(false);

    await expect(assertCandidatePublishApprovalEvidence(CANDIDATE_ID)).resolves.toBeUndefined();
    // One probe query, no evidence count: the legacy publish path stays live
    // until migration 0077 activates the stricter regime.
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('throws below two distinct approvals once provisioned', async () => {
    provisionProbe(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ approval_count: 1, rejection_count: 0 }]);

    await expect(assertCandidatePublishApprovalEvidence(CANDIDATE_ID))
      .rejects.toThrow('independent approvals');
  });

  it('throws when any distinct reviewer rejected, even with two approvals', async () => {
    provisionProbe(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ approval_count: 2, rejection_count: 1 }]);

    await expect(assertCandidatePublishApprovalEvidence(CANDIDATE_ID))
      .rejects.toThrow('independent approvals');
  });

  it('throws when any reviewer escalated, even with two approvals', async () => {
    provisionProbe(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{
      approval_count: 2,
      rejection_count: 0,
      escalation_count: 1,
    }]);

    await expect(assertCandidatePublishApprovalEvidence(CANDIDATE_ID))
      .rejects.toThrow(
        'approvals with no rejections or escalations (currently 2 approval(s), 0 rejection(s), 1 escalation(s))',
      );
  });

  it('resolves at two distinct approvals and zero rejections or escalations', async () => {
    provisionProbe(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ approval_count: 2, rejection_count: 0 }]);

    await expect(assertCandidatePublishApprovalEvidence(CANDIDATE_ID)).resolves.toBeUndefined();
    const evidenceSql = String(dbMocks.executeQuery.mock.calls[2]?.[0]);
    expect(evidenceSql).toContain('decision_reviewer_profile_id');
    expect(evidenceSql).toContain("approval.status = 'completed'");
    expect(evidenceSql).toContain("approval.outcome = 'escalated'");
  });
});
