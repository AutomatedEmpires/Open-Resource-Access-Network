import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));
const transactionQueryMock = vi.hoisted(() => vi.fn());

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authSessionMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const guardsMocks = vi.hoisted(() => ({
  requireMinRole: vi.fn(),
}));
const mergeServiceMocks = vi.hoisted(() => ({
  mergeOrganizations: vi.fn(),
  previewOrganizationMerge: vi.fn(),
  mergeServices: vi.fn(),
}));
const workflowMocks = vi.hoisted(() => ({
  bulkAdvance: vi.fn(),
  advanceInTransaction: vi.fn(),
  sendTerminalStatusEmail: vi.fn(),
}));
const acquireLivePublicationGateSharedMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authSessionMocks);
vi.mock('@/services/auth/guards', () => guardsMocks);
vi.mock('@/services/merge/service', () => mergeServiceMocks);
vi.mock('@/services/workflow/engine', () => workflowMocks);
vi.mock('@/services/publication/liveEntityMerge', () => ({
  acquireLivePublicationGateShared: acquireLivePublicationGateSharedMock,
}));

type RequestOptions = {
  search?: string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
};

function createRequest(options: RequestOptions = {}) {
  const url = new URL(`https://oran.test${options.search ?? ''}`);
  const headers = new Headers();
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    nextUrl: url,
    url: url.toString(),
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

async function loadOrgMergeRoute() {
  return import('../merge/organizations/route');
}

async function loadServiceMergeRoute() {
  return import('../merge/services/route');
}

async function loadBulkAdvanceRoute() {
  return import('../bulk/advance/route');
}

const BULK_ID_ONE = '11111111-1111-4111-8111-111111111111';
const BULK_ID_TWO = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => callback({ query: transactionQueryMock }));
  transactionQueryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM submissions sub') && sql.includes('FOR UPDATE OF sub')) {
      return {
        rows: [
          {
            id: BULK_ID_ONE, submission_type: 'appeal', status: 'under_review',
            assigned_to_user_id: 'oran-admin-1', is_locked: true,
            locked_by_user_id: 'oran-admin-1', service_id: 'svc-1', payload: {},
          },
          {
            id: BULK_ID_TWO, submission_type: 'appeal', status: 'under_review',
            assigned_to_user_id: 'oran-admin-1', is_locked: true,
            locked_by_user_id: 'oran-admin-1', service_id: 'svc-2', payload: {},
          },
        ],
      };
    }
    return { rows: [] };
  });
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authSessionMocks.getAuthContext.mockResolvedValue({
    userId: 'oran-admin-1',
    role: 'oran_admin',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardsMocks.requireMinRole.mockReturnValue(true);

  mergeServiceMocks.previewOrganizationMerge.mockResolvedValue({
    targetId: '11111111-1111-4111-8111-111111111111',
    sourceId: '22222222-2222-4222-8222-222222222222',
    movedServices: 2,
  });
  mergeServiceMocks.mergeOrganizations.mockResolvedValue({ success: true });
  mergeServiceMocks.mergeServices.mockResolvedValue({ success: true });
  workflowMocks.advanceInTransaction.mockImplementation(async (_client: unknown, request: { submissionId: string; toStatus: string }) => ({
    submissionId: request.submissionId,
    success: true,
    fromStatus: 'under_review',
    toStatus: request.toStatus,
    transitionId: `tx-${request.submissionId}`,
    gateResults: [],
  }));
  workflowMocks.sendTerminalStatusEmail.mockResolvedValue(undefined);
  acquireLivePublicationGateSharedMock.mockResolvedValue(undefined);
});

describe('admin organization merge route', () => {
  it('fails closed on GET when the shared limiter is unavailable', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      backendUnavailable: true,
      retryAfterSeconds: 60,
    });
    const { GET } = await loadOrgMergeRoute();

    const response = await GET(createRequest({
      search: '?targetId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222',
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('60');
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit service unavailable. Please try again later.',
    });
    expect(authSessionMocks.getAuthContext).not.toHaveBeenCalled();
    expect(mergeServiceMocks.previewOrganizationMerge).not.toHaveBeenCalled();
  });

  it('rejects unavailable DB, rate limits, and invalid preview params', async () => {
    const { GET } = await loadOrgMergeRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const unavailable = await GET(createRequest());
    expect(unavailable.status).toBe(503);

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 19 });
    const limited = await GET(
      createRequest({
        search: '?targetId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('19');

    rateLimitMock.mockReturnValueOnce({ exceeded: false, retryAfterSeconds: 0 });
    const invalid = await GET(createRequest({ search: '?targetId=bad-id' }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual(
      expect.objectContaining({ error: 'Validation failed' }),
    );
  });

  it('enforces auth/role and returns preview payload', async () => {
    const { GET } = await loadOrgMergeRoute();

    authSessionMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await GET(createRequest());
    expect(unauth.status).toBe(401);

    authSessionMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'community-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    guardsMocks.requireMinRole.mockReturnValueOnce(false);
    const forbidden = await GET(createRequest());
    expect(forbidden.status).toBe(403);

    const ok = await GET(
      createRequest({
        search: '?targetId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({
      targetId: '11111111-1111-4111-8111-111111111111',
      sourceId: '22222222-2222-4222-8222-222222222222',
      movedServices: 2,
    });
  });

  it('executes merge on POST and handles domain + server failures', async () => {
    const { POST } = await loadOrgMergeRoute();

    const ok = await POST(
      createRequest({
        jsonBody: {
          targetId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ success: true });

    mergeServiceMocks.mergeOrganizations.mockResolvedValueOnce({
      success: false,
      error: 'cannot merge archived source',
    });
    const unprocessable = await POST(
      createRequest({
        jsonBody: {
          targetId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );
    expect(unprocessable.status).toBe(422);
    await expect(unprocessable.json()).resolves.toEqual({
      error: 'cannot merge archived source',
    });

    mergeServiceMocks.mergeOrganizations.mockRejectedValueOnce(new Error('merge exploded'));
    const failed = await POST(
      createRequest({
        jsonBody: {
          targetId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it('fails closed on POST when the shared limiter is unavailable', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      backendUnavailable: true,
      retryAfterSeconds: 45,
    });
    const { POST } = await loadOrgMergeRoute();

    const response = await POST(createRequest({
      jsonBody: {
        targetId: '11111111-1111-4111-8111-111111111111',
        sourceId: '22222222-2222-4222-8222-222222222222',
      },
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('45');
    expect(authSessionMocks.getAuthContext).not.toHaveBeenCalled();
    expect(mergeServiceMocks.mergeOrganizations).not.toHaveBeenCalled();
  });
});

describe('admin service merge route', () => {
  it('fails closed when the shared limiter is unavailable', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      backendUnavailable: true,
      retryAfterSeconds: 30,
    });
    const { POST } = await loadServiceMergeRoute();

    const response = await POST(createRequest({
      jsonBody: {
        targetId: '11111111-1111-4111-8111-111111111111',
        sourceId: '22222222-2222-4222-8222-222222222222',
      },
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(authSessionMocks.getAuthContext).not.toHaveBeenCalled();
    expect(mergeServiceMocks.mergeServices).not.toHaveBeenCalled();
  });

  it('validates auth, input, and executes merge', async () => {
    const { POST } = await loadServiceMergeRoute();

    const badBody = await POST(createRequest({ jsonBody: { targetId: 'bad' } }));
    expect(badBody.status).toBe(400);

    const ok = await POST(
      createRequest({
        jsonBody: {
          targetId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ success: true });

    mergeServiceMocks.mergeServices.mockResolvedValueOnce({
      success: false,
      error: 'source already merged',
    });
    const unprocessable = await POST(
      createRequest({
        jsonBody: {
          targetId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );
    expect(unprocessable.status).toBe(422);
  });
});

describe('admin bulk advance route', () => {
  it('enforces role, validates payload, and returns aggregate counts', async () => {
    const { POST } = await loadBulkAdvanceRoute();

    authSessionMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'host-1',
      role: 'host_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    guardsMocks.requireMinRole.mockReturnValueOnce(false);
    const forbidden = await POST(createRequest({ jsonBody: {} }));
    expect(forbidden.status).toBe(403);

    const invalid = await POST(createRequest({ jsonBody: {} }));
    expect(invalid.status).toBe(400);

    const ok = await POST(
      createRequest({
        jsonBody: {
          submissionIds: [BULK_ID_ONE, BULK_ID_TWO],
          toStatus: 'under_review',
          reason: 'batch move',
        },
        ip: '203.0.113.5',
      }),
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({
      total: 2,
      succeeded: 2,
      failed: 0,
      results: [
        {
          submissionId: BULK_ID_ONE,
          success: true,
          fromStatus: 'under_review',
          toStatus: 'under_review',
          transitionId: `tx-${BULK_ID_ONE}`,
          gateResults: [],
        },
        {
          submissionId: BULK_ID_TWO,
          success: true,
          fromStatus: 'under_review',
          toStatus: 'under_review',
          transitionId: `tx-${BULK_ID_TWO}`,
          gateResults: [],
        },
      ],
    });
    expect(rateLimitMock).toHaveBeenLastCalledWith(
      'admin:bulk:advance:write:203.0.113.5',
      expect.any(Object),
    );
    expect(workflowMocks.sendTerminalStatusEmail).toHaveBeenCalledTimes(2);
  });

  it('enforces community scope while ORAN admins remain unrestricted', async () => {
    const { POST } = await loadBulkAdvanceRoute();
    authSessionMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'community-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{
      coverage_zone_id: 'zone-1',
      coverage_zone_name: 'Central',
      coverage_zone_description: null,
      coverage_states: ['TX'],
      coverage_counties: [],
      has_geometry: false,
    }]);
    transactionQueryMock.mockResolvedValueOnce({ rows: [] });

    const denied = await POST(createRequest({
      jsonBody: { submissionIds: [BULK_ID_ONE], toStatus: 'approved' },
    }));

    expect(denied.status).toBe(403);
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('service_at_location');
    expect(workflowMocks.advanceInTransaction).not.toHaveBeenCalled();

    vi.clearAllMocks();
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
    guardsMocks.requireMinRole.mockReturnValue(true);
    authSessionMocks.getAuthContext.mockResolvedValue({
      userId: 'oran-admin-1',
      role: 'oran_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{
      coverage_zone_id: 'legacy-zone',
      coverage_zone_name: 'Legacy',
      coverage_zone_description: null,
      coverage_states: ['CA'],
      coverage_counties: [],
      has_geometry: false,
    }]);
    dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => callback({ query: transactionQueryMock }));
    transactionQueryMock.mockResolvedValueOnce({
      rows: [{
        id: BULK_ID_ONE, submission_type: 'appeal', status: 'under_review',
        assigned_to_user_id: 'oran-admin-1', is_locked: true,
        locked_by_user_id: 'oran-admin-1', service_id: 'svc-1', payload: {},
      }],
    });
    workflowMocks.advanceInTransaction.mockResolvedValueOnce({
      submissionId: BULK_ID_ONE,
      success: true,
      fromStatus: 'needs_review',
      toStatus: 'under_review',
      transitionId: 'tx-oran',
      gateResults: [],
    });

    const allowed = await POST(createRequest({
      jsonBody: { submissionIds: [BULK_ID_ONE], toStatus: 'under_review' },
    }));

    expect(allowed.status).toBe(200);
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).not.toContain('service_at_location');
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('form_instances');
  });

  it.each([
    ['valid', { schemaVersion: 1, findingId: BULK_ID_ONE }],
    ['malformed', { schemaVersion: 99 }],
  ])('blocks %s freshness payloads before admin bulk advance', async (_label, packet) => {
    transactionQueryMock.mockResolvedValueOnce({
      rows: [{
        id: BULK_ID_ONE,
        submission_type: 'appeal',
        status: 'under_review',
        assigned_to_user_id: 'oran-admin-1',
        is_locked: true,
        locked_by_user_id: 'oran-admin-1',
        service_id: 'svc-1',
        payload: { resourceFreshness: packet },
      }],
    });
    const { POST } = await loadBulkAdvanceRoute();

    const response = await POST(createRequest({
      jsonBody: { submissionIds: [BULK_ID_ONE], toStatus: 'approved' },
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Structured freshness reviews require individual evidence review',
      blockedIds: [BULK_ID_ONE],
    });
    expect(workflowMocks.advanceInTransaction).not.toHaveBeenCalled();
    expect(workflowMocks.sendTerminalStatusEmail).not.toHaveBeenCalled();
  });

  it.each([
    'service_verification',
    'confidence_regression',
    'ingestion_control_change',
    'org_claim',
    'data_correction',
    'new_service',
    'removal_request',
    'community_report',
    'appeal',
    'managed_form',
    'ownership_transfer',
    'future_dedicated_type',
  ])('fails closed for %s admin bulk approval', async (submissionType) => {
    transactionQueryMock.mockResolvedValueOnce({
      rows: [{
        id: BULK_ID_ONE,
        submission_type: submissionType,
        status: 'under_review',
        assigned_to_user_id: 'oran-admin-1',
        is_locked: true,
        locked_by_user_id: 'oran-admin-1',
        service_id: 'svc-1',
        payload: {},
        has_open_freshness_finding: false,
        has_form_instance: true,
      }],
    });
    const { POST } = await loadBulkAdvanceRoute();

    const response = await POST(createRequest({
      jsonBody: { submissionIds: [BULK_ID_ONE], toStatus: 'approved' },
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Bulk approval is unavailable for submissions with dedicated review effects',
      blockedIds: [BULK_ID_ONE],
    });
    expect(workflowMocks.advanceInTransaction).not.toHaveBeenCalled();
    expect(acquireLivePublicationGateSharedMock).toHaveBeenCalledOnce();
    expect(acquireLivePublicationGateSharedMock.mock.invocationCallOrder[0]).toBeLessThan(
      transactionQueryMock.mock.invocationCallOrder[0]!,
    );
  });

  it('blocks admin bulk advance when an open finding has lost its packet key', async () => {
    transactionQueryMock.mockResolvedValueOnce({
      rows: [{
        id: BULK_ID_ONE,
        submission_type: 'appeal',
        status: 'under_review',
        assigned_to_user_id: 'oran-admin-1',
        is_locked: true,
        locked_by_user_id: 'oran-admin-1',
        service_id: 'svc-1',
        payload: {},
        has_open_freshness_finding: true,
      }],
    });
    const { POST } = await loadBulkAdvanceRoute();

    const response = await POST(createRequest({
      jsonBody: { submissionIds: [BULK_ID_ONE], toStatus: 'approved' },
    }));

    expect(response.status).toBe(409);
    expect(workflowMocks.advanceInTransaction).not.toHaveBeenCalled();
    expect(workflowMocks.sendTerminalStatusEmail).not.toHaveBeenCalled();
  });

  it('fails the entire admin batch before post-commit effects when one transition is rejected', async () => {
    workflowMocks.advanceInTransaction
      .mockResolvedValueOnce({
        submissionId: BULK_ID_ONE,
        success: true,
        fromStatus: 'needs_review',
        toStatus: 'under_review',
        transitionId: 'tx-one',
        gateResults: [],
      })
      .mockResolvedValueOnce({
        submissionId: BULK_ID_TWO,
        success: false,
        error: 'Transition denied',
      });
    const { POST } = await loadBulkAdvanceRoute();

    const response = await POST(createRequest({
      jsonBody: {
        submissionIds: [BULK_ID_ONE, BULK_ID_TWO],
        toStatus: 'under_review',
      },
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Bulk transition failed; no changes were applied',
      failedSubmissionId: BULK_ID_TWO,
      reason: 'Transition denied',
    });
    expect(workflowMocks.advanceInTransaction).toHaveBeenCalledTimes(2);
    expect(workflowMocks.sendTerminalStatusEmail).not.toHaveBeenCalled();
  });
});
