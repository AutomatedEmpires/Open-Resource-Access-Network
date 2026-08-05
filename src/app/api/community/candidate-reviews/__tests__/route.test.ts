import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => vi.fn());
const roleMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimitShared: rateLimitMock }));
vi.mock('@/services/auth/session', () => ({ getAuthContext: authMock }));
vi.mock('@/services/auth/guards', () => ({ requireRole: roleMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));

function request(search = '', ip = '198.51.100.42') {
  const nextUrl = new URL(`https://oran.test/api/community/candidate-reviews${search}`);
  return {
    headers: new Headers({ 'x-forwarded-for': ip }),
    nextUrl,
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockReset();
  rateLimitMock.mockResolvedValue({
    exceeded: false,
    backendUnavailable: false,
    retryAfterSeconds: 0,
  });
  authMock.mockResolvedValue({ userId: 'community-reviewer-1', role: 'community_admin' });
  roleMock.mockImplementation(
    (context: { role?: string }, role: string) => context.role === role,
  );
});

describe('GET /api/community/candidate-reviews', () => {
  it('fails closed for unavailable database and limiter backends', async () => {
    const { GET } = await import('../route');

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    expect((await GET(request())).status).toBe(503);

    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    rateLimitMock.mockResolvedValueOnce({
      exceeded: false,
      backendUnavailable: true,
      retryAfterSeconds: 17,
    });
    const unavailable = await GET(request());
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('Retry-After')).toBe('17');

    rateLimitMock.mockResolvedValueOnce({
      exceeded: true,
      backendUnavailable: false,
      retryAfterSeconds: 6,
    });
    const limited = await GET(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('6');
  });

  it('requires an authenticated community admin and validates pagination', async () => {
    const { GET } = await import('../route');

    authMock.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);

    roleMock.mockReturnValueOnce(false);
    expect((await GET(request())).status).toBe(403);

    const invalid = await GET(request('?status=completed&page=0&limit=1000'));
    expect(invalid.status).toBe(400);
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('denies ORAN-admin oversight identities from the reviewer inbox', async () => {
    authMock.mockResolvedValueOnce({ userId: 'oran-admin-1', role: 'oran_admin' });
    const { GET } = await import('../route');

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('lists only the signed-in reviewer open assignments without peer evidence', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{
        candidate_id: '11111111-1111-4111-8111-111111111111',
        assignment_id: '22222222-2222-4222-8222-222222222222',
        assignment_status: 'pending',
        expires_at: '2026-07-15T00:00:00.000Z',
        organization_name: 'Community Bridge',
        service_name: 'Emergency housing',
        description: 'Short-term placement.',
        website_url: 'https://example.org/housing',
        jurisdiction_state: 'WA',
        jurisdiction_county: 'King',
        jurisdiction_city: 'Seattle',
        confidence_tier: 'green',
        confidence_score: 91,
        candidate_updated_at: '2026-07-14T00:00:00.000Z',
      }]);
    const { GET } = await import('../route');

    const response = await GET(request('?status=open&page=1&limit=20'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      total: 1,
      results: [expect.objectContaining({
        candidate_id: '11111111-1111-4111-8111-111111111111',
        assignment_status: 'pending',
      })],
    }));

    const listCall = dbMocks.executeQuery.mock.calls[1] as [string, unknown[]];
    expect(listCall[0]).toContain('WHERE reviewer.user_id = $1');
    expect(listCall[0]).toContain("account.role = 'community_admin'");
    expect(listCall[0]).not.toContain("'oran_admin'");
    expect(listCall[0]).toContain("assignment.status IN ('pending', 'claimed')");
    expect(listCall[1]).toEqual(['community-reviewer-1', 20, 0]);
    const selectedColumns = listCall[0].split('FROM public.candidate_admin_assignments')[0];
    expect(selectedColumns).not.toMatch(/outcome|notes|admin_profile_id|reviewer\.user_id|candidate\.review_status/i);
  });

  it('uses parameterized status filtering and returns a generic failure', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('postgres://secret/raw failure'));
    const { GET } = await import('../route');

    const failed = await GET(request('?status=claimed'));

    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: 'Internal server error.' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error));
    expect(dbMocks.executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('assignment.status = $2'),
      ['community-reviewer-1', 'claimed'],
    );
  });
});
