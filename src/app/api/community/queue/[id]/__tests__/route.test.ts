import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const advanceInTransactionMock = vi.hoisted(() => vi.fn());
const sendTerminalStatusEmailMock = vi.hoisted(() => vi.fn());
const reconcileFreshnessMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
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
vi.mock('@/services/freshness/resourceFreshness', () => ({
  reconcileResourceFreshnessReview: reconcileFreshnessMock,
}));

function createRequest(options: {
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
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

function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

async function loadRoute() {
  return import('../route');
}

const VALID_ID = '11111111-1111-4111-8111-111111111111';
const FINDING_ID = '40000000-0000-4000-8000-000000000001';
const SERVICE_ID = '50000000-0000-4000-8000-000000000001';
const DIRECT_SCHEDULE_ID = '60000000-0000-4000-8000-000000000001';
const SECOND_DIRECT_SCHEDULE_ID = '60000000-0000-4000-8000-000000000002';
const SHARED_SCHEDULE_ID = '60000000-0000-4000-8000-000000000003';

interface TestSubmission {
  id: string;
  submission_type: string;
  status: string;
  assigned_to_user_id: string | null;
  is_locked: boolean;
  locked_by_user_id: string | null;
  service_id: string | null;
  payload: Record<string, unknown>;
  has_open_freshness_finding?: boolean;
  has_form_instance?: boolean;
}

interface TestSchedule {
  id: string;
  service_id: string | null;
  location_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  current_date: string;
}

function submission(overrides: Partial<TestSubmission> = {}): TestSubmission {
  return {
    id: VALID_ID,
    submission_type: 'service_verification',
    status: 'under_review',
    assigned_to_user_id: 'community-1',
    is_locked: true,
    locked_by_user_id: 'community-1',
    service_id: SERVICE_ID,
    payload: {},
    has_open_freshness_finding: false,
    ...overrides,
  };
}

function installPutTransaction(options: {
  submission?: TestSubmission;
  directSchedules?: TestSchedule[];
  sharedSchedules?: TestSchedule[];
  scopeRows?: Record<string, unknown>[];
  serviceMutationSucceeds?: boolean;
  protectedWorkflow?: 'verified_hotline' | 'resource_quarantine';
} = {}) {
  const lockedSubmission = options.submission ?? submission();
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FOR UPDATE OF sub')) {
        return { rows: [lockedSubmission] };
      }
      if (sql.includes('FROM services service') && sql.includes('FOR UPDATE OF service')) {
        return {
          rows: lockedSubmission.service_id ? [{ id: lockedSubmission.service_id }] : [],
        };
      }
      if (sql.includes('FROM locations location') && sql.includes('FOR UPDATE OF location, sal')) {
        return { rows: [] };
      }
      if (sql.includes('FROM schedules schedule') && sql.includes('WHERE schedule.service_id = $1')) {
        return { rows: options.directSchedules ?? [] };
      }
      if (sql.includes('JOIN service_at_location sal ON sal.location_id = schedule.location_id')) {
        return { rows: options.sharedSchedules ?? [] };
      }
      if (sql.includes('SELECT submission_type, service_id, payload')) {
        return {
          rows: [{
            submission_type: lockedSubmission.submission_type,
            service_id: lockedSubmission.service_id,
            payload: lockedSubmission.payload,
          }],
        };
      }
      if (sql.includes('FROM oran_internal.hotline_authority_members')) {
        return {
          rows: options.protectedWorkflow && lockedSubmission.service_id
            ? [{
                workflow: options.protectedWorkflow,
                entity_type: 'service',
                entity_id: lockedSubmission.service_id,
              }]
            : [],
        };
      }
      if (sql.includes('SELECT service_id FROM submissions')) {
        return {
          rows: lockedSubmission.service_id
            ? [{ service_id: lockedSubmission.service_id }]
            : [],
        };
      }
      if (sql.includes('UPDATE services') && sql.includes('RETURNING id')) {
        return {
          rows: lockedSubmission.service_id && options.serviceMutationSucceeds !== false
            ? [{ id: lockedSubmission.service_id }]
            : [],
        };
      }
      if (sql.includes("'{resourceFreshnessFirstReview}'") && sql.includes('RETURNING id')) {
        return { rows: [{ id: lockedSubmission.id }] };
      }
      return { rows: [] };
    }),
  };

  dbMocks.executeQuery
    .mockResolvedValueOnce(options.scopeRows ?? [])
    .mockResolvedValueOnce([lockedSubmission]);
  dbMocks.withTransaction.mockImplementationOnce(
    async (callback: (transactionClient: typeof client) => Promise<unknown>) => callback(client),
  );

  return client;
}

function freshnessPacket(signal: 'explicit_expiry' | 'stale_source' = 'stale_source') {
  const explicit = signal === 'explicit_expiry';
  return {
    schemaVersion: 1,
    findingId: FINDING_ID,
    signal,
    requiredAction: explicit ? 'correct_expired_schedule' : 'refresh_authoritative_source',
    hold: {
      actor: 'system:resource-freshness-scan',
      reason: `resource_freshness:${signal}:${FINDING_ID}`,
    },
    observed: {
      detectedAsOf: '2026-07-13T12:00:00.000Z',
      signalObservedAt: '2026-07-01T00:00:00.000Z',
      freshnessThresholdDays: explicit ? null : 180,
      serviceUpdatedAt: '2026-06-01T00:00:00.000Z',
      lastSourceRefreshAt: '2026-06-01T00:00:00.000Z',
      lastCandidateVerifiedAt: null,
      lastManualVerificationAt: null,
      reverifyAt: null,
      schedule: explicit
        ? { totalCount: 2, datedCount: 2, maxValidTo: '2026-07-01' }
        : { totalCount: 0, datedCount: 0, maxValidTo: null },
    },
    reviewRequirements: {
      evidenceRequired: true,
      scheduleCorrectionRequiredBeforeApproval: explicit,
    },
  };
}

function freshnessReview(
  outcome: 'confirmed_current' | 'corrected' | 'confirmed_unavailable' | 'unable_to_verify',
) {
  return {
    schemaVersion: 1,
    outcome,
    verificationMethod: 'provider_website',
    checkedAt: new Date().toISOString(),
    evidenceUrl: 'https://provider.example/current-services',
    reviewerSummary: 'The current provider publication was checked against this service record.',
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    return callback(client);
  });
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  captureExceptionMock.mockResolvedValue(undefined);
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'community-1',
    role: 'community_admin',
  });
  requireMinRoleMock.mockReturnValue(true);
  advanceInTransactionMock.mockImplementation(
    async (_client: unknown, request: { toStatus: string }) => ({
      success: true,
      fromStatus: 'submitted',
      toStatus: request.toStatus,
      transitionId: 'tx-1',
    }),
  );
  sendTerminalStatusEmailMock.mockResolvedValue(undefined);
  reconcileFreshnessMock.mockResolvedValue({
    state: 'hold_cleared',
    findingId: '40000000-0000-4000-8000-000000000001',
    holdCleared: true,
  });
});

describe('api/community/queue/[id] route', () => {
  it('returns GET guard responses for db, id, rate, auth, and role checks', async () => {
    const { GET } = await loadRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    expect((await GET(createRequest(), ctx(VALID_ID))).status).toBe(503);

    expect((await GET(createRequest(), ctx('bad-id'))).status).toBe(400);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 15 });
    const limited = await GET(createRequest({ ip: '203.0.113.8' }), ctx(VALID_ID));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('15');

    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      backendUnavailable: true,
      retryAfterSeconds: 60,
    });
    expect((await GET(createRequest(), ctx(VALID_ID))).status).toBe(503);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await GET(createRequest(), ctx(VALID_ID))).status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await GET(createRequest(), ctx(VALID_ID))).status).toBe(403);
  });

  it('returns 404 when submission does not exist', async () => {
    const { GET } = await loadRoute();
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await GET(createRequest(), ctx(VALID_ID));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Submission not found' });
  });

  it('returns GET details for submissions without a linked service', async () => {
    const { GET } = await loadRoute();
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: VALID_ID,
          service_id: null,
          status: 'submitted',
          payload: {},
        },
      ])
      .mockResolvedValueOnce([{ id: 'tr-1', to_status: 'submitted' }]);

    const response = await GET(createRequest(), ctx(VALID_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.locations).toEqual([]);
    expect(body.phones).toEqual([]);
    expect(body.schedules).toEqual([]);
    expect(body.confidenceScore).toBeNull();
    expect(body.transitions).toEqual([{ id: 'tr-1', to_status: 'submitted' }]);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(3);
  });

  it('gives ORAN admins global GET detail access regardless of review-profile coverage', async () => {
    const { GET } = await loadRoute();
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'oran-admin-1',
      role: 'oran_admin',
    });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: VALID_ID,
        service_id: null,
        status: 'escalated',
        payload: { resourceFreshness: freshnessPacket() },
      }])
      .mockResolvedValueOnce([{ id: 'tr-escalated', to_status: 'escalated' }]);

    const response = await GET(createRequest(), ctx(VALID_ID));

    expect(response.status).toBe(200);
    const detailSql = String(dbMocks.executeQuery.mock.calls[0]?.[0]);
    expect(detailSql).toContain('WHERE sub.id = $1');
    expect(detailSql).not.toContain('admin_review_profiles');
    expect(detailSql).not.toContain('service_at_location');
    expect(dbMocks.executeQuery.mock.calls[0]?.[1]).toEqual([VALID_ID]);
  });

  it('returns GET details including locations, phones, confidence score, and transitions', async () => {
    const { GET } = await loadRoute();
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: VALID_ID,
          service_id: 'service-1',
          status: 'under_review',
          payload: { name: 'Service' },
        },
      ])
      .mockResolvedValueOnce([{ id: 'loc-1', city: 'Seattle' }])
      .mockResolvedValueOnce([{ id: 'ph-1', number: '555-123-4567' }])
      .mockResolvedValueOnce([{
        id: 'sch-1',
        valid_to: '2026-12-31',
        days: ['MO'],
      }])
      .mockResolvedValueOnce([{ score: 88 }])
      .mockResolvedValueOnce([{ id: 'tr-2', to_status: 'approved' }]);

    const response = await GET(createRequest(), ctx(VALID_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.locations).toEqual([{ id: 'loc-1', city: 'Seattle' }]);
    expect(body.phones).toEqual([{ id: 'ph-1', number: '555-123-4567' }]);
    expect(body.schedules).toEqual([{
      id: 'sch-1',
      valid_to: '2026-12-31',
      days: ['MO'],
    }]);
    expect(body.confidenceScore).toEqual({ score: 88 });
    expect(body.transitions).toEqual([{ id: 'tr-2', to_status: 'approved' }]);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(7);
  });

  it('returns 500 on GET errors and captures telemetry', async () => {
    const { GET } = await loadRoute();
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('query failed'));

    const response = await GET(createRequest(), ctx(VALID_ID));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_community_verify_get',
    });
  });

  it('returns PUT guard responses for db, id, rate, auth, and role checks', async () => {
    const { PUT } = await loadRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    expect((await PUT(createRequest(), ctx(VALID_ID))).status).toBe(503);

    expect((await PUT(createRequest(), ctx('bad-id'))).status).toBe(400);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await PUT(createRequest({ ip: '198.51.100.9' }), ctx(VALID_ID));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');

    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      backendUnavailable: true,
      retryAfterSeconds: 60,
    });
    expect((await PUT(createRequest(), ctx(VALID_ID))).status).toBe(503);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await PUT(createRequest(), ctx(VALID_ID))).status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await PUT(createRequest(), ctx(VALID_ID))).status).toBe(403);
  });

  it('returns 400 on invalid PUT JSON body and schema validation failures', async () => {
    const { PUT } = await loadRoute();

    const badJson = await PUT(createRequest({ jsonError: true }), ctx(VALID_ID));
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toEqual({ error: 'Invalid JSON body' });

    const invalid = await PUT(
      createRequest({
        jsonBody: { decision: 'invalid-status' },
      }),
      ctx(VALID_ID),
    );
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.json();
    expect(invalidBody.error).toBe('Validation failed');
    expect(Array.isArray(invalidBody.details)).toBe(true);
  });

  it('returns 404 when a PUT submission is outside the reviewer scope', async () => {
    const { PUT } = await loadRoute();
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'denied' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Submission not found' });
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('gives ORAN admins global PUT access regardless of review-profile coverage', async () => {
    const { PUT } = await loadRoute();
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'oran-admin-1',
      role: 'oran_admin',
    });
    const current = submission({
      submission_type: 'service_verification',
      service_id: null,
      assigned_to_user_id: 'oran-admin-1',
      locked_by_user_id: 'oran-admin-1',
    });
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FOR UPDATE OF sub')) return { rows: [current] };
        return { rows: [] };
      }),
    };
    dbMocks.executeQuery.mockResolvedValueOnce([current]);
    dbMocks.withTransaction.mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => Promise<unknown>) => callback(client),
    );

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'denied' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    const accessSql = String(dbMocks.executeQuery.mock.calls[0]?.[0]);
    expect(accessSql).toContain('WHERE sub.id = $1');
    expect(accessSql).not.toContain('admin_review_profiles');
    expect(accessSql).not.toContain('service_at_location');
    expect(dbMocks.executeQuery.mock.calls[0]?.[1]).toEqual([VALID_ID]);
    const lockedSql = String(client.query.mock.calls.find(([sql]) => (
      String(sql).includes('FOR UPDATE OF sub')
    ))?.[0]);
    expect(lockedSql).toContain('WHERE sub.id = $1');
    expect(lockedSql).not.toContain('service_at_location');
  });

  it('does not persist notes when the workflow transition is denied', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({ submission_type: 'service_verification', service_id: null }),
    });
    advanceInTransactionMock.mockResolvedValueOnce({
      success: false,
      error: 'Transition denied',
    });

    const response = await PUT(
      createRequest({
        jsonBody: {
          decision: 'denied',
          notes: 'Need more proof',
        },
      }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Transition denied' });
    expect(advanceInTransactionMock).toHaveBeenCalledWith(client, expect.objectContaining({
      submissionId: VALID_ID,
      toStatus: 'denied',
    }));
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE submissions SET reviewer_notes')
    ))).toBe(false);
  });

  it('lets a paused active reviewer complete work they already own', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      scopeRows: [{
        profile_id: 'profile-1',
        is_active: true,
        is_accepting_new: false,
        coverage_zone_id: null,
        coverage_states: ['CA'],
        coverage_counties: [],
        has_geometry: false,
      }],
    });

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'denied', notes: 'Provider unavailable.' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    const preliminarySql = String(dbMocks.executeQuery.mock.calls[1]?.[0]);
    expect(preliminarySql).toContain('review_profile.is_active = true');
    expect(preliminarySql).toContain('review_profile.is_accepting_new = true');
    expect(preliminarySql).toContain('sub.assigned_to_user_id');
    const lockedSql = String(client.query.mock.calls.find(([sql]) => (
      String(sql).includes('FOR UPDATE OF sub')
    ))?.[0]);
    expect(lockedSql).toContain('review_profile.is_active = true');
    expect(advanceInTransactionMock).toHaveBeenCalled();
  });

  it('hides assigned work from an inactive community reviewer', async () => {
    const { PUT } = await loadRoute();
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        profile_id: 'profile-1',
        is_active: false,
        is_accepting_new: true,
        coverage_zone_id: null,
        coverage_states: [],
        coverage_counties: [],
        has_geometry: false,
      }])
      .mockResolvedValueOnce([]);

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'denied', notes: 'Should not apply.' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(404);
    expect(String(dbMocks.executeQuery.mock.calls[1]?.[0])).toContain('review_profile.is_active = true');
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
  });

  it('updates confidence score for approved decisions when service exists', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction();

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'approved' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Record approved. Confidence score updated.');
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('oran:resource-freshness-scan')
    ))).toBe(true);
    const confidenceUpdate = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO confidence_scores')
    ));
    expect(confidenceUpdate?.[1]).toEqual([SERVICE_ID]);
    const verifiedEvent = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO lifecycle_events')
    ));
    expect(verifiedEvent?.[1]?.slice(0, 7)).toEqual([
      'service', SERVICE_ID, 'verified', 'active', 'active', 'human', 'community-1',
    ]);
    expect(JSON.parse(String(verifiedEvent?.[1]?.[7]))).toMatchObject({
      submissionId: VALID_ID,
      approvalTransitionId: 'tx-1',
      verificationApplied: true,
      verifiedAt: expect.any(String),
      reverifyAt: expect.any(String),
    });
  });

  it('does not emit verified lifecycle evidence for an archive approval', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({ payload: { changeType: 'host_service_archive' } }),
    });

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'approved' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO lifecycle_events')
    ))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO confidence_scores')
    ))).toBe(false);
  });

  it('rejects typed and form-backed submissions that must use the resource endpoint', async () => {
    const { PUT } = await loadRoute();
    const typed = submission({ submission_type: 'new_service' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([typed]);

    const typedResponse = await PUT(
      createRequest({ jsonBody: { decision: 'approved' } }),
      ctx(VALID_ID),
    );

    expect(typedResponse.status).toBe(409);
    await expect(typedResponse.json()).resolves.toMatchObject({
      error: 'This submission requires its dedicated typed review endpoint',
      submissionType: 'new_service',
    });
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
    expect(advanceInTransactionMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    requireMinRoleMock.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([submission({ has_form_instance: true })]);

    const formBackedResponse = await PUT(
      createRequest({ jsonBody: { decision: 'approved' } }),
      ctx(VALID_ID),
    );
    expect(formBackedResponse.status).toBe(409);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
  });

  it('applies approved host service verification payloads before updating confidence', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({ payload: { changeType: 'host_service_update' } }),
    });

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'approved' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    const serviceUpdate = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE services')
    ));
    expect(serviceUpdate?.[1]).toEqual(['active', 'community-1', SERVICE_ID]);
    const confidenceUpdate = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO confidence_scores')
    ));
    expect(confidenceUpdate?.[1]).toEqual([SERVICE_ID]);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(2);
  });

  it('does not reactivate an inactive service from a stale generic verification approval', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({ payload: { changeType: 'host_service_update' } }),
      serviceMutationSucceeds: false,
    });

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'approved' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('no longer active');
    const updateSql = String(client.query.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE services') && String(sql).includes('RETURNING id')
    ))?.[0]);
    expect(updateSql).toContain("status = 'active'");
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO confidence_scores')
    ))).toBe(false);
    expect(sendTerminalStatusEmailMock).not.toHaveBeenCalled();
  });

  it('routes protected service verification approval without mutating the live service', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({ protectedWorkflow: 'verified_hotline' });

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'approved' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('verified-hotline authority');
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE services')
    ))).toBe(false);
  });

  it('skips confidence score update when an approved decision has no linked service', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({ service_id: null }),
    });

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'approved' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO confidence_scores')
    ))).toBe(false);
  });

  it('requires valid structured evidence for scanner-created freshness work', async () => {
    const { PUT } = await loadRoute();
    installPutTransaction({
      submission: submission({ payload: { resourceFreshness: freshnessPacket() } }),
    });

    const missing = await PUT(
      createRequest({ jsonBody: { decision: 'approved' } }),
      ctx(VALID_ID),
    );
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: 'Structured freshness review evidence is required',
    });
    expect(advanceInTransactionMock).not.toHaveBeenCalled();

    const invalid = await PUT(
      createRequest({
        jsonBody: {
          freshnessReview: {
            ...freshnessReview('confirmed_current'),
            evidenceUrl: undefined,
          },
        },
      }),
      ctx(VALID_ID),
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe('Validation failed');
  });

  it('fails closed when scanner work carries an invalid lifecycle packet', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({
        payload: { resourceFreshness: { findingId: FINDING_ID } },
      }),
    });

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'escalated' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('oran:resource-freshness-scan')
    ))).toBe(true);
  });

  it('fails closed when an authoritative open finding has lost its payload packet', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({
        payload: {},
        has_open_freshness_finding: true,
      }),
    });

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'approved' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
    expect(sendTerminalStatusEmailMock).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('oran:resource-freshness-scan')
    ))).toBe(true);
  });

  it('uses one transaction client for evidence, workflow, and freshness reconciliation', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({ payload: { resourceFreshness: freshnessPacket() } }),
    });
    const review = freshnessReview('confirmed_current');

    const response = await PUT(
      createRequest({ jsonBody: { freshnessReview: review } }),
      ctx(VALID_ID),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(dbMocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('oran:resource-freshness-scan')
    ))).toBe(true);
    expect(advanceInTransactionMock).toHaveBeenCalledWith(client, expect.objectContaining({
      submissionId: VALID_ID,
      toStatus: 'approved',
      reason: review.reviewerSummary,
      metadata: {
        resourceFreshnessReview: review,
        resourceFreshnessFindingId: FINDING_ID,
      },
    }));
    const evidenceUpdate = client.query.mock.calls.find(([sql]) => (
      String(sql).includes("'{resourceFreshnessReview}'")
    ));
    expect(evidenceUpdate?.[1]?.[0]).toBe(review.reviewerSummary);
    expect(JSON.parse(String(evidenceUpdate?.[1]?.[1]))).toEqual(review);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('SELECT submission_type, service_id, payload')
    ))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO confidence_scores')
    ))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => (
      /SET\s+status\s*=\s*'active'/i.test(String(sql))
    ))).toBe(false);
    expect(reconcileFreshnessMock).toHaveBeenCalledWith(client, VALID_ID);
    expect(body.lifecycleReconciliation).toEqual({
      state: 'hold_cleared',
      findingId: FINDING_ID,
      holdCleared: true,
    });
  });

  it('rolls the decision back when lifecycle reconciliation does not reach the expected state', async () => {
    const { PUT } = await loadRoute();
    installPutTransaction({
      submission: submission({
        payload: { resourceFreshness: freshnessPacket() },
        has_open_freshness_finding: true,
      }),
    });
    reconcileFreshnessMock.mockResolvedValueOnce({
      state: 'awaiting_workflow',
      findingId: FINDING_ID,
      holdCleared: false,
    });

    const response = await PUT(
      createRequest({ jsonBody: { freshnessReview: freshnessReview('confirmed_current') } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Freshness review could not be safely finalized; no changes were applied',
    });
    expect(sendTerminalStatusEmailMock).not.toHaveBeenCalled();
  });

  it('does not persist freshness evidence when the workflow transition fails', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({ payload: { resourceFreshness: freshnessPacket() } }),
    });
    advanceInTransactionMock.mockResolvedValueOnce({
      success: false,
      error: 'Transition denied',
    });

    const response = await PUT(
      createRequest({
        jsonBody: { freshnessReview: freshnessReview('confirmed_current') },
      }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Transition denied' });
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes("'{resourceFreshnessReview}'")
    ))).toBe(false);
    expect(reconcileFreshnessMock).not.toHaveBeenCalled();
  });

  it('rejects evidence checked before the freshness finding was detected', async () => {
    const { PUT } = await loadRoute();
    installPutTransaction({
      submission: submission({ payload: { resourceFreshness: freshnessPacket() } }),
    });
    const review = {
      ...freshnessReview('confirmed_current'),
      checkedAt: '2026-07-13T11:59:59.000Z',
    };

    const response = await PUT(
      createRequest({ jsonBody: { freshnessReview: review } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Validation failed',
      details: [{ message: 'checkedAt must be on or after this freshness finding was detected' }],
    });
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
  });

  it('rejects a decision that contradicts the structured freshness outcome', async () => {
    const { PUT } = await loadRoute();
    installPutTransaction({
      submission: submission({ payload: { resourceFreshness: freshnessPacket() } }),
    });

    const response = await PUT(
      createRequest({
        jsonBody: {
          decision: 'approved',
          freshnessReview: freshnessReview('confirmed_unavailable'),
        },
      }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ expectedDecision: 'pending_second_approval' });
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
  });

  it('stages confirmed-unavailable work for a distinct second reviewer without reconciling', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({ payload: { resourceFreshness: freshnessPacket() } }),
    });
    const review = freshnessReview('confirmed_unavailable');

    const response = await PUT(
      createRequest({ jsonBody: { freshnessReview: review } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      toStatus: 'pending_second_approval',
      lifecycleReconciliation: null,
    });
    expect(advanceInTransactionMock).toHaveBeenCalledWith(client, expect.objectContaining({
      toStatus: 'pending_second_approval',
      metadata: expect.objectContaining({
        resourceFreshnessFindingId: FINDING_ID,
        resourceFreshnessFirstReview: expect.objectContaining({
          reviewerUserId: 'community-1',
          review,
        }),
      }),
    }));
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes("'{resourceFreshnessFirstReview}'")
    ))).toBe(true);
    const firstEvidence = client.query.mock.calls.find(([sql]) => (
      String(sql).includes("'{resourceFreshnessFirstReview}'")
    ));
    expect(JSON.parse(String(firstEvidence?.[1]?.[1]))).toMatchObject({
      transitionId: 'tx-1',
      reviewerUserId: 'community-1',
      review,
    });
    expect(reconcileFreshnessMock).not.toHaveBeenCalled();
  });

  it('requires a distinct second reviewer before confirmed-unavailable reconciliation', async () => {
    const { PUT } = await loadRoute();
    const firstReview = {
      transitionId: 'tx-first',
      reviewerUserId: 'community-1',
      recordedAt: '2026-07-14T12:00:00.000Z',
      review: freshnessReview('confirmed_unavailable'),
    };
    const secondReview = freshnessReview('confirmed_unavailable');
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'community-2',
      role: 'community_admin',
    });
    const client = installPutTransaction({
      submission: submission({
        status: 'pending_second_approval',
        assigned_to_user_id: 'community-2',
        locked_by_user_id: 'community-2',
        payload: {
          resourceFreshness: freshnessPacket(),
          resourceFreshnessFirstReview: firstReview,
        },
      }),
    });
    reconcileFreshnessMock.mockResolvedValueOnce({
      state: 'confirmed_unavailable',
      findingId: FINDING_ID,
      holdCleared: false,
    });

    const response = await PUT(
      createRequest({ jsonBody: { freshnessReview: secondReview } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    expect(advanceInTransactionMock).toHaveBeenCalledWith(client, expect.objectContaining({
      toStatus: 'denied',
      metadata: expect.objectContaining({
        resourceFreshnessReview: secondReview,
        resourceFreshnessSecondReview: expect.objectContaining({
          reviewerUserId: 'community-2',
          review: secondReview,
        }),
      }),
    }));
    expect(reconcileFreshnessMock).toHaveBeenCalledWith(client, VALID_ID);
    const secondEvidence = client.query.mock.calls.find(([sql]) => (
      String(sql).includes("'{resourceFreshnessSecondReview}'")
    ));
    expect(secondEvidence).toBeDefined();
    expect(JSON.parse(String(secondEvidence?.[1]?.[2]))).toMatchObject({
      transitionId: 'tx-1',
      reviewerUserId: 'community-2',
      review: secondReview,
    });
  });

  it('rejects the first reviewer attempting destructive freshness approval twice', async () => {
    const { PUT } = await loadRoute();
    const review = freshnessReview('confirmed_unavailable');
    installPutTransaction({
      submission: submission({
        status: 'pending_second_approval',
        payload: {
          resourceFreshness: freshnessPacket(),
          resourceFreshnessFirstReview: {
            transitionId: 'tx-first',
            reviewerUserId: 'community-1',
            recordedAt: '2026-07-14T12:00:00.000Z',
            review,
          },
        },
      }),
    });

    const response = await PUT(
      createRequest({ jsonBody: { freshnessReview: review } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'The second reviewer must be different from the first reviewer',
    });
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
    expect(reconcileFreshnessMock).not.toHaveBeenCalled();
  });

  it('accepts and forwards typed direct schedule corrections for explicit expiry', async () => {
    const { PUT } = await loadRoute();
    const client = installPutTransaction({
      submission: submission({
        payload: { resourceFreshness: freshnessPacket('explicit_expiry') },
      }),
      directSchedules: [{
        id: DIRECT_SCHEDULE_ID,
        service_id: SERVICE_ID,
        location_id: null,
        valid_from: '2026-01-01',
        valid_to: '2026-07-01',
        current_date: '2026-07-14',
      }],
    });
    const review = {
      ...freshnessReview('corrected'),
      scheduleCorrections: [{
        scheduleId: DIRECT_SCHEDULE_ID,
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
      }],
    };

    const response = await PUT(
      createRequest({ jsonBody: { freshnessReview: review } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    const evidenceUpdate = client.query.mock.calls.find(([sql]) => (
      String(sql).includes("'{resourceFreshnessReview}'")
    ));
    expect(JSON.parse(String(evidenceUpdate?.[1]?.[1]))).toEqual(review);
    expect(client.query.mock.calls.filter(([sql]) => (
      String(sql).includes('FROM schedules schedule')
    ))).toHaveLength(2);
    expect(advanceInTransactionMock).toHaveBeenCalledWith(client, expect.objectContaining({
      toStatus: 'approved',
    }));
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('SELECT submission_type, service_id, payload')
      || /SET\s+status\s*=\s*'active'/i.test(String(sql))
    ))).toBe(false);
    expect(reconcileFreshnessMock).toHaveBeenCalledWith(client, VALID_ID);
    const sharedScheduleSql = String(client.query.mock.calls.find(([sql]) => (
      String(sql).includes('JOIN service_at_location sal ON sal.location_id = schedule.location_id')
    ))?.[0]);
    expect(sharedScheduleSql).toContain('JOIN locations location');
    expect(sharedScheduleSql).toContain("location.status = 'active'");
  });

  it('rejects corrections to shared location schedules', async () => {
    const { PUT } = await loadRoute();
    installPutTransaction({
      submission: submission({
        payload: { resourceFreshness: freshnessPacket('explicit_expiry') },
      }),
      sharedSchedules: [{
        id: SHARED_SCHEDULE_ID,
        service_id: null,
        location_id: '70000000-0000-4000-8000-000000000001',
        valid_from: '2026-01-01',
        valid_to: '2026-07-01',
        current_date: '2026-07-14',
      }],
    });
    const review = {
      ...freshnessReview('corrected'),
      scheduleCorrections: [{
        scheduleId: SHARED_SCHEDULE_ID,
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
      }],
    };

    const response = await PUT(
      createRequest({ jsonBody: { freshnessReview: review } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Shared location schedules must be corrected by an authorized resource maintainer',
    });
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
  });

  it('rejects an incomplete set of direct schedule corrections', async () => {
    const { PUT } = await loadRoute();
    installPutTransaction({
      submission: submission({
        payload: { resourceFreshness: freshnessPacket('explicit_expiry') },
      }),
      directSchedules: [
        {
          id: DIRECT_SCHEDULE_ID,
          service_id: SERVICE_ID,
          location_id: null,
          valid_from: '2026-01-01',
          valid_to: '2026-07-01',
          current_date: '2026-07-14',
        },
        {
          id: SECOND_DIRECT_SCHEDULE_ID,
          service_id: SERVICE_ID,
          location_id: null,
          valid_from: '2026-01-01',
          valid_to: '2026-07-02',
          current_date: '2026-07-14',
        },
      ],
    });
    const review = {
      ...freshnessReview('corrected'),
      scheduleCorrections: [{
        scheduleId: DIRECT_SCHEDULE_ID,
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
      }],
    };

    const response = await PUT(
      createRequest({ jsonBody: { freshnessReview: review } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Every expired direct service schedule must be included in the correction',
    });
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
  });

  it('does not approve explicit expiry when attached schedules remain expired', async () => {
    const { PUT } = await loadRoute();
    installPutTransaction({
      submission: submission({
        payload: { resourceFreshness: freshnessPacket('explicit_expiry') },
      }),
      directSchedules: [{
        id: DIRECT_SCHEDULE_ID,
        service_id: SERVICE_ID,
        location_id: null,
        valid_from: '2026-01-01',
        valid_to: '2026-07-01',
        current_date: '2026-07-14',
      }],
    });

    const response = await PUT(
      createRequest({
        jsonBody: { freshnessReview: freshnessReview('corrected') },
      }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Attached schedules must be corrected before this listing can be approved',
    });
    expect(advanceInTransactionMock).not.toHaveBeenCalled();
    expect(reconcileFreshnessMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the atomic transaction throws and captures telemetry', async () => {
    const { PUT } = await loadRoute();
    const scopedSubmission = submission({
      submission_type: 'service_verification',
      service_id: null,
    });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([scopedSubmission]);
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('transaction failed'));

    const response = await PUT(
      createRequest({ jsonBody: { decision: 'returned' } }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_community_verify_decision',
    });
  });
});
