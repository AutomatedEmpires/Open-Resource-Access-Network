import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));
const transactionQueryMock = vi.hoisted(() => vi.fn());

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const advanceInTransactionMock = vi.hoisted(() => vi.fn());
const sendTerminalStatusEmailMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: requireMinRoleMock,
}));
vi.mock('@/services/workflow/engine', () => ({
  advanceInTransaction: advanceInTransactionMock,
  sendTerminalStatusEmail: sendTerminalStatusEmailMock,
}));

function createRequest(options: { jsonBody?: unknown; jsonError?: boolean; ip?: string } = {}) {
  const headers = new Headers();
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

async function loadRoute() {
  return import('../route');
}

const ID_ONE = '11111111-1111-4111-8111-111111111111';
const ID_TWO = '22222222-2222-4222-8222-222222222222';

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
            id: ID_ONE, submission_type: 'appeal', status: 'under_review',
            assigned_to_user_id: 'community-1', is_locked: true,
            locked_by_user_id: 'community-1', service_id: 'svc-1', payload: {},
          },
          {
            id: ID_TWO, submission_type: 'appeal', status: 'under_review',
            assigned_to_user_id: 'community-1', is_locked: true,
            locked_by_user_id: 'community-1', service_id: 'svc-2', payload: {},
          },
        ],
      };
    }
    return { rows: [] };
  });
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
  requireMinRoleMock.mockReturnValue(true);
  advanceInTransactionMock.mockImplementation(async (_client: unknown, request: { submissionId: string; toStatus: string }) => ({
    submissionId: request.submissionId,
    success: true,
    fromStatus: 'under_review',
    toStatus: request.toStatus,
    transitionId: `tx-${request.submissionId}`,
    gateResults: [],
  }));
  sendTerminalStatusEmailMock.mockResolvedValue(undefined);
});

describe('PATCH /api/community/queue/bulk', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { PATCH } = await loadRoute();

    const res = await PATCH(createRequest());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'Database not configured.' });
  });

  it('enforces rate limiting and authz gates', async () => {
    const { PATCH } = await loadRoute();

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await PATCH(createRequest({ ip: '203.0.113.9' }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauthenticated = await PATCH(createRequest());
    expect(unauthenticated.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await PATCH(createRequest());
    expect(forbidden.status).toBe(403);
  });

  it('fails closed before auth or mutation when the shared limiter is unavailable', async () => {
    rateLimitMock.mockResolvedValueOnce({
      exceeded: true,
      retryAfterSeconds: 60,
      backendUnavailable: true,
    });
    const { PATCH } = await loadRoute();

    const response = await PATCH(createRequest({
      jsonBody: { ids: [ID_ONE], decision: 'approved' },
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('60');
    await expect(response.json()).resolves.toEqual({ error: 'Rate limit service unavailable.' });
    expect(authMocks.getAuthContext).not.toHaveBeenCalled();
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid json and invalid payload', async () => {
    const { PATCH } = await loadRoute();

    const invalidJson = await PATCH(createRequest({ jsonError: true }));
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({ error: 'Invalid JSON body' });

    const invalidPayload = await PATCH(
      createRequest({
        jsonBody: { ids: ['bad-id'], decision: 'approved' },
      }),
    );
    expect(invalidPayload.status).toBe(400);
    const body = await invalidPayload.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('applies bulk denials without changing confidence scores', async () => {
    const { PATCH } = await loadRoute();

    const res = await PATCH(
      createRequest({
        jsonBody: {
          ids: [ID_ONE, ID_TWO],
          decision: 'denied',
          notes: 'Bulk denial completed',
        },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      succeeded: [ID_ONE, ID_TWO],
      failed: [],
    });
    expect(transactionQueryMock.mock.calls.some((call) => String(call[0]).includes('reviewer_notes'))).toBe(true);
    expect(transactionQueryMock.mock.calls.some((call) => String(call[0]).includes('confidence_scores'))).toBe(false);
    expect(sendTerminalStatusEmailMock).toHaveBeenCalledTimes(2);
  });

  it('rolls back the whole batch when any transition fails', async () => {
    advanceInTransactionMock.mockResolvedValueOnce({ success: false, error: 'Transition denied' });

    const { PATCH } = await loadRoute();

    const res = await PATCH(
      createRequest({
        jsonBody: {
          ids: [ID_ONE, ID_TWO],
          decision: 'denied',
        },
      }),
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Bulk decision failed; no changes were applied',
      succeeded: [],
      failed: [{ id: ID_ONE, error: 'Transition denied' }],
    });
    expect(advanceInTransactionMock).toHaveBeenCalledTimes(1);
    expect(sendTerminalStatusEmailMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
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
  ])('fails closed for %s bulk approval before workflow mutation', async (submissionType) => {
    transactionQueryMock.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM submissions sub') ? [{
        id: ID_ONE,
        submission_type: submissionType,
        status: 'under_review',
        assigned_to_user_id: 'community-1',
        is_locked: true,
        locked_by_user_id: 'community-1',
        service_id: 'svc-1',
        payload: {},
        has_open_freshness_finding: false,
        has_form_instance: false,
      }] : [],
    }));
    const { PATCH } = await loadRoute();

    const response = await PATCH(createRequest({
      jsonBody: { ids: [ID_ONE], decision: 'approved' },
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Bulk approval is unavailable for submissions with dedicated review effects',
      blockedIds: [ID_ONE],
      succeeded: [],
    });
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
    expect(transactionQueryMock.mock.calls.some(([sql]) => (
      String(sql).includes('confidence_scores')
    ))).toBe(false);
  });

  it.each([
    ['valid', { schemaVersion: 1, findingId: ID_ONE }],
    ['malformed', { schemaVersion: 99 }],
  ])('blocks %s structured freshness packets before any bulk transition', async (_label, packet) => {
    transactionQueryMock.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM submissions sub') ? [
        {
          id: ID_ONE, submission_type: 'appeal', status: 'under_review',
          assigned_to_user_id: 'community-1', is_locked: true,
          locked_by_user_id: 'community-1', service_id: 'svc-1', payload: {},
        },
        {
          id: ID_TWO, submission_type: 'appeal', status: 'under_review',
          assigned_to_user_id: 'community-1', is_locked: true,
          locked_by_user_id: 'community-1', service_id: 'svc-2',
          payload: { resourceFreshness: packet },
        },
      ] : [],
    }));
    const { PATCH } = await loadRoute();

    const res = await PATCH(createRequest({
      jsonBody: { ids: [ID_ONE, ID_TWO], decision: 'approved' },
    }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Structured freshness reviews require individual evidence review',
      blockedIds: [ID_TWO],
      succeeded: [],
    });
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
    expect(sendTerminalStatusEmailMock).not.toHaveBeenCalled();
    expect(transactionQueryMock.mock.calls.filter(([sql]) => (
      String(sql).includes('FROM submissions sub')
    ))).toHaveLength(1);
  });

  it('blocks an authoritative open finding even when its packet key is missing', async () => {
    transactionQueryMock.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM submissions sub') ? [{
        id: ID_ONE,
        submission_type: 'appeal',
        status: 'under_review',
        assigned_to_user_id: 'community-1',
        is_locked: true,
        locked_by_user_id: 'community-1',
        service_id: 'svc-1',
        payload: {},
        has_open_freshness_finding: true,
      }] : [],
    }));
    const { PATCH } = await loadRoute();

    const res = await PATCH(createRequest({
      jsonBody: { ids: [ID_ONE], decision: 'approved' },
    }));

    expect(res.status).toBe(409);
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
    expect(sendTerminalStatusEmailMock).not.toHaveBeenCalled();
  });
});
