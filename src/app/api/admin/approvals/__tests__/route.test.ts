import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const engineMocks = vi.hoisted(() => ({
  advance: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));
const resourceSubmissionMocks = vi.hoisted(() => ({
  projectApprovedResourceSubmission: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({ requireMinRole: requireMinRoleMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/workflow/engine', () => engineMocks);
vi.mock('@/services/resourceSubmissions/service', () => resourceSubmissionMocks);

import { GET, POST } from '../route';

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';

function request(options: { search?: string; body?: unknown } = {}) {
  const url = new URL(`https://oran.test/api/admin/approvals${options.search ?? ''}`);
  return {
    headers: new Headers(),
    nextUrl: url,
    url: url.toString(),
    json: vi.fn().mockResolvedValue(options.body),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (
    callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>,
  ) => callback({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
  rateLimitMock.mockResolvedValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-reviewer', role: 'oran_admin' });
  requireMinRoleMock.mockReturnValue(true);
  captureExceptionMock.mockResolvedValue(undefined);
  engineMocks.acquireLock.mockResolvedValue(true);
  engineMocks.releaseLock.mockResolvedValue(true);
  resourceSubmissionMocks.projectApprovedResourceSubmission.mockResolvedValue({
    organizationId: 'projected-org-1',
    serviceId: null,
  });
});

describe('admin organization claim approvals', () => {
  it('lists claims filtered by needs_review', async () => {
    const claimRow = {
      id: SUBMISSION_ID,
      status: 'needs_review',
      organization_name: 'Exact Claim Organization',
      organization_url: 'https://example.org',
      organization_email: 'claim@example.org',
    };
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([claimRow]);

    const response = await GET(request({ search: '?status=needs_review&page=1&limit=20' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total: 1,
      results: [claimRow],
    });
    expect(dbMocks.executeQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('sub.status = $1'),
      ['needs_review'],
    );
    expect(dbMocks.executeQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("fi.form_data #>> '{draft,organization,name}'"),
      ['needs_review', 20, 0],
    );
    expect(dbMocks.executeQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('LEFT JOIN form_instances fi ON fi.submission_id = sub.id'),
      ['needs_review', 20, 0],
    );
    const listSql = dbMocks.executeQuery.mock.calls[1]?.[0] as string;
    expect(listSql).toContain(
      "COALESCE(\n                NULLIF(fi.form_data #>> '{draft,organization,name}', ''),\n                o.name",
    );
    expect(listSql).toContain(
      "CASE WHEN sub.target_type = 'organization' THEN sub.target_id END",
    );
  });

  it('moves a needs_review approval to second approval and releases the claim', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{
      status: 'needs_review',
      account_status: 'active',
    }]);
    engineMocks.advance
      .mockResolvedValueOnce({
        success: true,
        fromStatus: 'needs_review',
        toStatus: 'under_review',
        transitionId: 'transition-review',
      })
      .mockResolvedValueOnce({
        success: true,
        fromStatus: 'under_review',
        toStatus: 'pending_second_approval',
        transitionId: 'transition-pending',
      });

    const response = await POST(request({
      body: { submissionId: SUBMISSION_ID, decision: 'approved' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      id: SUBMISSION_ID,
      fromStatus: 'needs_review',
      toStatus: 'pending_second_approval',
      pendingSecondApproval: true,
    });
    expect(engineMocks.advance).toHaveBeenNthCalledWith(1, expect.objectContaining({
      submissionId: SUBMISSION_ID,
      toStatus: 'under_review',
      actorUserId: 'admin-reviewer',
    }));
    expect(engineMocks.advance).toHaveBeenNthCalledWith(2, expect.objectContaining({
      submissionId: SUBMISSION_ID,
      toStatus: 'pending_second_approval',
      actorUserId: 'admin-reviewer',
    }));
    expect(engineMocks.releaseLock).toHaveBeenCalledWith(
      SUBMISSION_ID,
      'admin-reviewer',
      false,
    );
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when the id is missing or is not an organization claim', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const response = await POST(request({
      body: { submissionId: SUBMISSION_ID, decision: 'denied' },
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Organization claim not found',
    });
    expect(engineMocks.releaseLock).toHaveBeenCalledWith(
      SUBMISSION_ID,
      'admin-reviewer',
      false,
    );
    expect(engineMocks.advance).not.toHaveBeenCalled();
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns an escalated approval to review before requesting second approval', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{
      status: 'escalated',
      account_status: 'active',
    }]);
    engineMocks.advance
      .mockResolvedValueOnce({
        success: true,
        fromStatus: 'escalated',
        toStatus: 'under_review',
        transitionId: 'transition-resumed',
      })
      .mockResolvedValueOnce({
        success: true,
        fromStatus: 'under_review',
        toStatus: 'pending_second_approval',
        transitionId: 'transition-pending',
      });

    const response = await POST(request({
      body: { submissionId: SUBMISSION_ID, decision: 'approved' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: SUBMISSION_ID,
      fromStatus: 'escalated',
      toStatus: 'pending_second_approval',
    });
    expect(engineMocks.advance).toHaveBeenNthCalledWith(1, expect.objectContaining({
      toStatus: 'under_review',
    }));
    expect(engineMocks.advance).toHaveBeenNthCalledWith(2, expect.objectContaining({
      toStatus: 'pending_second_approval',
    }));
  });

  it('does not allow an auto-checking claim to bypass first review', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{
      status: 'auto_checking',
      account_status: 'active',
    }]);

    const response = await POST(request({
      body: { submissionId: SUBMISSION_ID, decision: 'approved' },
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Claim must complete first review before final approval',
    });
    expect(engineMocks.advance).not.toHaveBeenCalled();
    expect(engineMocks.releaseLock).toHaveBeenCalledWith(
      SUBMISSION_ID,
      'admin-reviewer',
      false,
    );
  });

  it('allows a second admin to finalize the exact pending claim', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'admin-approver',
      role: 'oran_admin',
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{
      status: 'pending_second_approval',
      account_status: 'active',
    }]);
    engineMocks.advance.mockResolvedValueOnce({
      success: true,
      fromStatus: 'pending_second_approval',
      toStatus: 'approved',
      transitionId: 'transition-approved',
    });

    const response = await POST(request({
      body: {
        submissionId: SUBMISSION_ID,
        decision: 'approved',
        notes: 'Independent final review complete.',
      },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      id: SUBMISSION_ID,
      fromStatus: 'pending_second_approval',
      toStatus: 'approved',
      projection: {
        organizationId: 'projected-org-1',
        serviceId: null,
      },
    });
    expect(engineMocks.advance).toHaveBeenCalledTimes(1);
    expect(engineMocks.advance).toHaveBeenCalledWith(expect.objectContaining({
      submissionId: SUBMISSION_ID,
      toStatus: 'approved',
      actorUserId: 'admin-approver',
    }));
    expect(resourceSubmissionMocks.projectApprovedResourceSubmission).toHaveBeenCalledWith(
      SUBMISSION_ID,
      'admin-approver',
    );
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('idempotently repairs an approved canonical claim for its recorded approver', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'admin-approver',
      role: 'oran_admin',
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{
      status: 'approved',
      account_status: 'active',
      final_approver_user_id: 'admin-approver',
      final_approval_transition_id: 'transition-approved',
    }]);

    const response = await POST(request({
      body: { submissionId: SUBMISSION_ID, decision: 'approved' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      id: SUBMISSION_ID,
      fromStatus: 'approved',
      toStatus: 'approved',
      transitionId: 'transition-approved',
      projectionRepair: true,
      projection: {
        organizationId: 'projected-org-1',
        serviceId: null,
      },
    });
    expect(engineMocks.advance).not.toHaveBeenCalled();
    expect(resourceSubmissionMocks.projectApprovedResourceSubmission).toHaveBeenCalledWith(
      SUBMISSION_ID,
      'admin-approver',
    );
    expect(engineMocks.releaseLock).toHaveBeenCalledWith(
      SUBMISSION_ID,
      'admin-approver',
      false,
    );
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when canonical projection fails after approval', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'admin-approver',
      role: 'oran_admin',
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{
      status: 'pending_second_approval',
      account_status: 'active',
    }]);
    engineMocks.advance.mockResolvedValueOnce({
      success: true,
      fromStatus: 'pending_second_approval',
      toStatus: 'approved',
      transitionId: 'transition-approved',
    });
    resourceSubmissionMocks.projectApprovedResourceSubmission.mockRejectedValueOnce(
      new Error('projection transaction failed'),
    );

    const response = await POST(request({
      body: { submissionId: SUBMISSION_ID, decision: 'approved' },
    }));

    expect(response.status).toBe(500);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_approvals_decide',
    });
  });

  it('uses the legacy activation fallback only when projection returns null ids', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'admin-approver',
      role: 'oran_admin',
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{
      status: 'pending_second_approval',
      account_status: 'active',
    }]);
    engineMocks.advance.mockResolvedValueOnce({
      success: true,
      fromStatus: 'pending_second_approval',
      toStatus: 'approved',
      transitionId: 'transition-approved',
    });
    resourceSubmissionMocks.projectApprovedResourceSubmission.mockResolvedValueOnce({
      organizationId: null,
      serviceId: null,
    });
    const legacyQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          service_id: 'legacy-service-1',
          target_id: 'legacy-org-1',
          submitted_by_user_id: 'host-1',
        }],
      })
      .mockResolvedValue({ rows: [] });
    dbMocks.withTransaction.mockImplementationOnce(async (
      callback: (client: { query: typeof legacyQuery }) => Promise<unknown>,
    ) => callback({ query: legacyQuery }));

    const response = await POST(request({
      body: { submissionId: SUBMISSION_ID, decision: 'approved' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      projection: {
        organizationId: 'legacy-org-1',
        serviceId: 'legacy-service-1',
      },
    });
    expect(dbMocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(legacyQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE services SET status = 'active'"),
      ['legacy-service-1'],
    );
  });
});
