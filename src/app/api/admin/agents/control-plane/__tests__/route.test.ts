import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const trackEventMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const controlPlaneMock = vi.hoisted(() => ({
  buildAgentControlPlaneSnapshot: vi.fn(),
}));

vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/telemetry/appInsights', () => ({
  trackEvent: trackEventMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: requireMinRoleMock,
}));
vi.mock('@/services/agentic/controlPlane', () => controlPlaneMock);

function createRequest() {
  return {
    headers: new Headers(),
    nextUrl: new URL('https://oran.test/api/admin/agents/control-plane'),
    url: 'https://oran.test/api/admin/agents/control-plane',
  } as never;
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  authMocks.getAuthContext.mockResolvedValue(null);
  requireMinRoleMock.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  trackEventMock.mockResolvedValue(undefined);
  controlPlaneMock.buildAgentControlPlaneSnapshot.mockResolvedValue({
    generatedAt: '2026-03-07T00:00:00.000Z',
    summary: {
      readinessScore: 81,
      posture: 'enterprise_foundation',
      activeOperators: 2,
      configuredIntegrations: 4,
      strengths: ['retrieval-first'],
      blockers: [],
      nextMoves: ['ship more trust'],
    },
    trustModel: {
      principles: [],
      enforcedControls: [],
      openGaps: [],
    },
    featureFlags: {
      implementation: 'in_memory',
      enabledCount: 1,
      disabledCount: 0,
      flags: [],
    },
    integrations: [],
    operators: [],
  });
});

describe('GET /api/admin/agents/control-plane', () => {
  it('returns 401 when unauthenticated', async () => {
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'community_admin' });
    requireMinRoleMock.mockReturnValue(false);
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'oran_admin' });
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
  });

  it('returns the control plane snapshot for ORAN admins', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'oran_admin' });
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');

    const body = await response.json();
    expect(body.summary.readinessScore).toBe(81);
    expect(trackEventMock).toHaveBeenCalledOnce();
  });

  it('returns 500 when snapshot generation fails', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'oran_admin' });
    controlPlaneMock.buildAgentControlPlaneSnapshot.mockRejectedValueOnce(new Error('boom'));
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
