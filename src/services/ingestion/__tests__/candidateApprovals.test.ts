import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  executeQuery: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);

import {
  assertCandidatePublishApprovalEvidence,
  decideCandidateApproval,
  isCandidateApprovalEvidenceProvisioned,
} from '../candidateApprovals';

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222';

function createTransactionQuery(approvalCount: number, rejectionCount: number) {
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
          role: 'community_admin',
        }],
      };
    }
    if (query.includes('FROM public.candidate_admin_assignments') && query.includes('FOR UPDATE')) {
      return {
        rows: [{
          id: ASSIGNMENT_ID,
          candidate_id: CANDIDATE_ID,
          admin_profile_id: 'reviewer-profile-1',
          status: 'claimed',
          expires_at: null,
        }],
      };
    }
    if (query.includes("SET status = 'completed'")) return { rows: [{ id: ASSIGNMENT_ID }] };
    if (query.includes('AS rejection_count')) {
      return { rows: [{ approval_count: approvalCount, rejection_count: rejectionCount }] };
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
) {
  const query = createTransactionQuery(approvalCount, rejectionCount);
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

  it('keeps a single rejection nonterminal and escalates for another independent review', async () => {
    const { query, result } = await decide('rejected', 0, 1);

    expect(result).toEqual({ status: 'escalated', approvalCount: 0, rejectionCount: 1 });
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'reassigned'"),
      expect.anything(),
    );
  });

  it('treats one approval and one rejection as disagreement, never authorization', async () => {
    const { query, result } = await decide('rejected', 1, 1);

    expect(result).toEqual({ status: 'escalated', approvalCount: 1, rejectionCount: 1 });
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
    expect(aggregateDecisionSql).toContain('approval.decision_reviewer_user_id');
    expect(aggregateDecisionSql).not.toContain('reviewer.user_id');
    expect(aggregateDecisionSql).not.toMatch(/outcome_notes|completed_at|admin_profile_id/);
  });

  it('requires two independent matching rejections before terminal rejection', async () => {
    const { query, result } = await decide('rejected', 0, 2);

    expect(result).toEqual({ status: 'rejected', approvalCount: 0, rejectionCount: 2 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'reassigned'"),
      [CANDIDATE_ID],
    );
  });

  it('verifies only after two matching approvals with no rejection', async () => {
    const { query, result } = await decide('approved', 2, 0);

    expect(result).toEqual({ status: 'verified', approvalCount: 2, rejectionCount: 0 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'reassigned'"),
      [CANDIDATE_ID],
    );
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

  it('resolves at two distinct approvals and zero rejections', async () => {
    provisionProbe(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ approval_count: 2, rejection_count: 0 }]);

    await expect(assertCandidatePublishApprovalEvidence(CANDIDATE_ID)).resolves.toBeUndefined();
    const evidenceSql = String(dbMocks.executeQuery.mock.calls[2]?.[0]);
    expect(evidenceSql).toContain('decision_reviewer_user_id');
    expect(evidenceSql).toContain("approval.status = 'completed'");
  });
});
