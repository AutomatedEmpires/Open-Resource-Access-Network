import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbConfiguredMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => vi.fn());
const roleMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const approvalMocks = vi.hoisted(() => {
  class CandidateApprovalConflict extends Error {}
  return {
    CandidateApprovalConflict,
    claimCandidateApproval: vi.fn(),
    decideCandidateApproval: vi.fn(),
    isCandidateApprovalEvidenceProvisioned: vi.fn(),
  };
});

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: dbConfiguredMock,
}));
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/auth/session', () => ({ getAuthContext: authMock }));
vi.mock('@/services/auth/guards', () => ({ requireRole: roleMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/ingestion/candidateApprovals', () => approvalMocks);

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222';

function request(body: unknown = {}, ip = '203.0.113.18') {
  return {
    headers: new Headers({ 'x-forwarded-for': ip }),
    json: vi.fn().mockResolvedValue(body),
  } as never;
}

function context(id = CANDIDATE_ID) {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbConfiguredMock.mockReturnValue(true);
  rateLimitMock.mockResolvedValue({
    exceeded: false,
    backendUnavailable: false,
    retryAfterSeconds: 0,
  });
  authMock.mockResolvedValue({ userId: 'reviewer-user-1', role: 'community_admin' });
  roleMock.mockImplementation(
    (context: { role?: string }, role: string) => context.role === role,
  );
  approvalMocks.claimCandidateApproval.mockResolvedValue({ status: 'claimed' });
  approvalMocks.decideCandidateApproval.mockResolvedValue({
    status: 'in_review',
    approvalCount: 1,
    rejectionCount: 0,
  });
  approvalMocks.isCandidateApprovalEvidenceProvisioned.mockResolvedValue(true);
});

describe('POST candidate approval route', () => {
  it('returns 503 and touches no approval service while the evidence schema is unprovisioned', async () => {
    const { POST } = await import('../route');
    approvalMocks.isCandidateApprovalEvidenceProvisioned.mockResolvedValueOnce(false);

    const res = await POST(
      request({ action: 'claim', assignmentId: ASSIGNMENT_ID }),
      context(),
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'Candidate approval evidence schema is not provisioned.',
    });
    expect(approvalMocks.claimCandidateApproval).not.toHaveBeenCalled();
    expect(approvalMocks.decideCandidateApproval).not.toHaveBeenCalled();
  });

  it('fails closed when database or rate-limit infrastructure is unavailable', async () => {
    const { POST } = await import('../route');

    dbConfiguredMock.mockReturnValueOnce(false);
    const databaseUnavailable = await POST(request(), context());
    expect(databaseUnavailable.status).toBe(503);

    dbConfiguredMock.mockReturnValue(true);
    rateLimitMock.mockResolvedValueOnce({
      exceeded: false,
      backendUnavailable: true,
      retryAfterSeconds: 31,
    });
    const limiterUnavailable = await POST(request(), context());
    expect(limiterUnavailable.status).toBe(503);
    expect(limiterUnavailable.headers.get('Retry-After')).toBe('31');

    rateLimitMock.mockResolvedValueOnce({
      exceeded: true,
      backendUnavailable: false,
      retryAfterSeconds: 9,
    });
    const limited = await POST(request(), context());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');
  });

  it('requires authentication and the exact community-admin reviewer role', async () => {
    const { POST } = await import('../route');

    authMock.mockResolvedValueOnce(null);
    expect((await POST(request(), context())).status).toBe(401);

    roleMock.mockReturnValueOnce(false);
    expect((await POST(request(), context())).status).toBe(403);
  });

  it('denies ORAN-admin oversight identities without calling approval services', async () => {
    authMock.mockResolvedValueOnce({ userId: 'oran-oversight-1', role: 'oran_admin' });
    const { POST } = await import('../route');

    const response = await POST(
      request({ action: 'claim', assignmentId: ASSIGNMENT_ID }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(roleMock).toHaveBeenCalledWith(
      { userId: 'oran-oversight-1', role: 'oran_admin' },
      'community_admin',
    );
    expect(approvalMocks.isCandidateApprovalEvidenceProvisioned).not.toHaveBeenCalled();
    expect(approvalMocks.claimCandidateApproval).not.toHaveBeenCalled();
    expect(approvalMocks.decideCandidateApproval).not.toHaveBeenCalled();
  });

  it('validates candidate IDs and discriminated action payloads', async () => {
    const { POST } = await import('../route');

    expect((await POST(request({ action: 'claim', assignmentId: ASSIGNMENT_ID }), context('bad-id'))).status)
      .toBe(400);

    const invalidPayload = await POST(
      request({ action: 'decide', assignmentId: 'bad-id', decision: 'verified' }),
      context(),
    );
    expect(invalidPayload.status).toBe(400);
    expect(approvalMocks.decideCandidateApproval).not.toHaveBeenCalled();

    const unreasonedRejection = await POST(
      request({ action: 'decide', assignmentId: ASSIGNMENT_ID, decision: 'rejected' }),
      context(),
    );
    expect(unreasonedRejection.status).toBe(400);
    expect(approvalMocks.decideCandidateApproval).not.toHaveBeenCalled();
  });

  it('claims the exact current-user assignment', async () => {
    const { POST } = await import('../route');
    const response = await POST(
      request({ action: 'claim', assignmentId: ASSIGNMENT_ID }),
      context(),
    );

    expect({ status: response.status, body: await response.clone().json() }).toEqual({
      status: 200,
      body: { success: true, status: 'claimed' },
    });
    expect(approvalMocks.claimCandidateApproval).toHaveBeenCalledWith({
      candidateId: CANDIDATE_ID,
      assignmentId: ASSIGNMENT_ID,
      actorUserId: 'reviewer-user-1',
    });
    await expect(response.json()).resolves.toEqual({ success: true, status: 'claimed' });
  });

  it('submits a bounded decision through the assigned-review transaction', async () => {
    const { POST } = await import('../route');
    const response = await POST(
      request({
        action: 'decide',
        assignmentId: ASSIGNMENT_ID,
        decision: 'approved',
        notes: '  Source and service details verified.  ',
      }),
      context(),
    );

    expect(approvalMocks.decideCandidateApproval).toHaveBeenCalledWith({
      candidateId: CANDIDATE_ID,
      assignmentId: ASSIGNMENT_ID,
      actorUserId: 'reviewer-user-1',
      decision: 'approved',
      notes: 'Source and service details verified.',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      status: 'completed',
    });
  });

  it('maps workflow conflicts to 409 without leaking unexpected errors', async () => {
    const { POST } = await import('../route');

    approvalMocks.claimCandidateApproval.mockRejectedValueOnce(
      new approvalMocks.CandidateApprovalConflict('Assignment has expired.'),
    );
    const conflict = await POST(
      request({ action: 'claim', assignmentId: ASSIGNMENT_ID }),
      context(),
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: 'This review changed and could not be completed. Refresh and try again.',
    });

    approvalMocks.claimCandidateApproval.mockRejectedValueOnce(
      new Error('postgres://secret-host/raw failure'),
    );
    const failed = await POST(
      request({ action: 'claim', assignmentId: ASSIGNMENT_ID }),
      context(),
    );
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: 'Internal server error.' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error));
  });
});
