import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  executeQuery: executeQueryMock,
}));

import { getCandidateReviewReadAccess } from '../candidateReviewAccess';

describe('candidate review read access', () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
  });

  it('gives ORAN oversight read access without surfacing a legacy assignment', async () => {
    await expect(getCandidateReviewReadAccess({
      candidateId: 'candidate-1',
      actorUserId: 'oran-admin-1',
      hasOranOversight: true,
    })).resolves.toEqual({ allowed: true, assignment: null });

    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  it('returns only an active community-admin reviewer assignment', async () => {
    executeQueryMock.mockResolvedValueOnce([{
      id: 'assignment-1',
      status: 'claimed',
      outcome: null,
      expires_at: null,
    }]);

    await expect(getCandidateReviewReadAccess({
      candidateId: 'candidate-1',
      actorUserId: 'community-admin-1',
      hasOranOversight: false,
    })).resolves.toEqual({
      allowed: true,
      assignment: {
        id: 'assignment-1',
        status: 'claimed',
        outcome: null,
        expires_at: null,
      },
    });

    const [statement, params] = executeQueryMock.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain("account.role = 'community_admin'");
    expect(statement).not.toContain("'oran_admin'");
    expect(params).toEqual(['candidate-1', 'community-admin-1']);
  });
});
