import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Mocks (hoisted so vi.mock can reference them)
// ============================================================

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

const engineMocks = vi.hoisted(() => ({
  applySla: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/workflow/engine', () => engineMocks);

// ============================================================
// Helpers
// ============================================================

function createRequest(options: {
  search?: string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const url = new URL(`https://oran.test/api/submissions/appeal${options.search ?? ''}`);
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

async function loadRoute() {
  return import('../../submissions/appeal/route');
}

function createMockClient() {
  return { query: vi.fn() };
}

// ============================================================
// Setup
// ============================================================

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (fn: (c: ReturnType<typeof createMockClient>) => unknown) =>
    fn(createMockClient()),
  );
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue(null);
  captureExceptionMock.mockResolvedValue(undefined);
  engineMocks.applySla.mockResolvedValue(undefined);
});

// ============================================================
// POST /api/submissions/appeal
// ============================================================

describe('POST /api/submissions/appeal', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();
    const response = await POST(createRequest());
    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 45 });
    const { POST } = await loadRoute();
    const response = await POST(createRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('45');
  });

  it('returns 401 when unauthenticated', async () => {
    const { POST } = await loadRoute();
    const response = await POST(createRequest());
    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonError: true }));
    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid body (missing fields)', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: { submissionId: 'not-uuid' },
    }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when reason is too short', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        submissionId: '11111111-1111-4111-8111-111111111111',
        reason: 'short',
      },
    }));
    expect(response.status).toBe(400);
  });

  it('returns 404 when original submission not found', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const client = createMockClient();
    client.query.mockResolvedValueOnce({ rows: [] }); // submission not found
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        submissionId: '11111111-1111-4111-8111-111111111111',
        reason: 'I was wrongly denied and have evidence',
      },
    }));
    expect(response.status).toBe(404);
  });

  it('returns 403 when user does not own the submission', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const client = createMockClient();
    client.query.mockResolvedValueOnce({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'denied',
        submitted_by_user_id: 'other-user',
        submission_type: 'org_claim',
        target_type: 'organization',
        target_id: 'org-1',
        service_id: null,
        title: 'Org Claim',
      }],
    });
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        submissionId: '11111111-1111-4111-8111-111111111111',
        reason: 'I was wrongly denied and have evidence',
      },
    }));
    expect(response.status).toBe(403);
  });

  it('returns 409 when submission is not denied', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const client = createMockClient();
    client.query.mockResolvedValueOnce({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'approved',
        submitted_by_user_id: 'user-1',
        submission_type: 'org_claim',
        target_type: 'organization',
        target_id: 'org-1',
        service_id: null,
        title: 'Org Claim',
      }],
    });
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        submissionId: '11111111-1111-4111-8111-111111111111',
        reason: 'I was wrongly denied and have evidence',
      },
    }));
    expect(response.status).toBe(409);
  });

  it('returns 409 when an appeal is already pending', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const client = createMockClient();
    // Original submission found & denied
    client.query.mockResolvedValueOnce({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'denied',
        submitted_by_user_id: 'user-1',
        submission_type: 'org_claim',
        target_type: 'organization',
        target_id: 'org-1',
        service_id: null,
        title: 'Org Claim',
      }],
    });
    // Existing pending appeal found
    client.query.mockResolvedValueOnce({ rows: [{ id: 'existing-appeal' }] });
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        submissionId: '11111111-1111-4111-8111-111111111111',
        reason: 'I was wrongly denied and have evidence',
      },
    }));
    expect(response.status).toBe(409);
  });

  it('creates an appeal successfully', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const client = createMockClient();
    // 1. Original submission (denied, owned by user)
    client.query.mockResolvedValueOnce({
      rows: [{
        id: '22222222-2222-4222-8222-222222222222',
        status: 'denied',
        submitted_by_user_id: 'user-1',
        submission_type: 'org_claim',
        target_type: 'organization',
        target_id: 'org-1',
        service_id: null,
        title: 'Org Claim',
      }],
    });
    // 2. No existing appeal
    client.query.mockResolvedValueOnce({ rows: [] });
    // 3. INSERT appeal returning id
    client.query.mockResolvedValueOnce({ rows: [{ id: 'appeal-new' }] });
    // 4. INSERT transition
    client.query.mockResolvedValueOnce({ rows: [] });
    // 5. SELECT assignee for notification
    client.query.mockResolvedValueOnce({ rows: [{ assigned_to_user_id: 'reviewer-1' }] });
    // 6. INSERT notification to assignee
    client.query.mockResolvedValueOnce({ rows: [] });
    // 7. INSERT admin pool notification
    client.query.mockResolvedValueOnce({ rows: [] });

    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        submissionId: '22222222-2222-4222-8222-222222222222',
        reason: 'I was wrongly denied and have new evidence to support my claim',
      },
    }));
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.appealId).toBe('appeal-new');
    expect(body.message).toContain('Appeal submitted');
  });

  it('creates appeal without notification when no assignee', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const client = createMockClient();
    // 1. Original submission
    client.query.mockResolvedValueOnce({
      rows: [{
        id: '22222222-2222-4222-8222-222222222222',
        status: 'denied',
        submitted_by_user_id: 'user-1',
        submission_type: 'org_claim',
        target_type: 'organization',
        target_id: 'org-1',
        service_id: null,
        title: 'Org Claim',
      }],
    });
    // 2. No existing appeal
    client.query.mockResolvedValueOnce({ rows: [] });
    // 3. INSERT appeal
    client.query.mockResolvedValueOnce({ rows: [{ id: 'appeal-new' }] });
    // 4. INSERT transition
    client.query.mockResolvedValueOnce({ rows: [] });
    // 5. SELECT assignee — no assignee
    client.query.mockResolvedValueOnce({ rows: [] });
    // 6. INSERT admin pool notification
    client.query.mockResolvedValueOnce({ rows: [] });

    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        submissionId: '22222222-2222-4222-8222-222222222222',
        reason: 'I was wrongly denied and have new evidence to support my claim',
      },
    }));
    expect(response.status).toBe(201);

    // 6 queries: original, existing appeal, INSERT appeal, INSERT transition, SELECT assignee, admin pool notification
    expect(client.query).toHaveBeenCalledTimes(6);
  });
});

// ============================================================
// GET /api/submissions/appeal
// ============================================================

describe('GET /api/submissions/appeal', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 20 });
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('20');
  });

  it('returns 401 when unauthenticated', async () => {
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });

  it('lists user appeals', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'appeal-1',
        status: 'submitted',
        title: 'Appeal: org_claim',
        notes: 'Wrongly denied',
        reviewer_notes: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        original_submission_id: 'sub-1',
      },
    ]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.appeals).toHaveLength(1);
    expect(body.appeals[0].id).toBe('appeal-1');
    expect(body.appeals[0].original_submission_id).toBe('sub-1');
  });

  it('returns empty list when user has no appeals', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.appeals).toHaveLength(0);
  });
});
