import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);

import { decideCandidateApproval } from '../candidateApprovals';

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
