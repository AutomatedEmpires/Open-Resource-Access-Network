/**
 * Tests for GET /api/admin/ingestion/candidates/[id]/ai-review
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Hoisted mocks
// ============================================================

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const isEnabledMock = vi.hoisted(() => vi.fn());
const reviewMocks = vi.hoisted(() => ({
  reviewCandidateWithLLM: vi.fn(),
  isReviewAssistConfigured: vi.fn(),
}));
const captureExceptionMock = vi.hoisted(() => vi.fn());
const isDatabaseConfiguredMock = vi.hoisted(() => vi.fn());
const getCandidateMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: vi.fn((ctx: unknown) => ctx !== null),
}));
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/flags/flags', () => ({
  flagService: { isEnabled: isEnabledMock },
}));
vi.mock('@/services/admin/reviewAssist', () => reviewMocks);
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: isDatabaseConfiguredMock,
  executeQuery: vi.fn(),
}));
vi.mock('@/agents/ingestion/persistence/storeFactory', () => ({
  createIngestionStores: vi.fn(() => ({
    candidates: { getById: getCandidateMock },
  })),
}));
vi.mock('@/services/db/drizzle', () => ({
  getDrizzle: vi.fn(() => ({})),
}));

// ============================================================
// Test helpers
// ============================================================

const VALID_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function makeRequest(_id?: string) {
  return {
    headers: new Headers({ 'x-forwarded-for': '10.0.0.1' }),
  } as never;
}

function makeParams(id: string = VALID_ID) {
  return { params: Promise.resolve({ id }) };
}

const ADMIN_CTX = { userId: 'admin-1', roles: ['community_admin'] };

const MOCK_CANDIDATE = {
  candidateId: VALID_ID,
  fields: {
    serviceName: 'City Food Bank',
    description: 'Provides emergency food assistance.',
    organizationName: 'City Charity',
    phone: '(555) 123-4567',
    websiteUrl: 'https://example.org',
    address: {
      line1: '123 Main St',
      city: 'Springfield',
      region: 'IL',
      postalCode: '62701',
    },
  },
};

const MOCK_RESULT = {
  completenessScore: 85,
  warnings: ['Description could be more specific'],
  suggestions: [{ field: 'hours', suggestion: 'Add operating hours' }],
  model: 'gpt-4o-mini',
};

async function loadRoute() {
  return import('../route');
}

// ============================================================
// Setup
// ============================================================

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  isDatabaseConfiguredMock.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue(ADMIN_CTX);
  isEnabledMock.mockResolvedValue(true);
  reviewMocks.isReviewAssistConfigured.mockReturnValue(true);
  getCandidateMock.mockResolvedValue(MOCK_CANDIDATE);
  reviewMocks.reviewCandidateWithLLM.mockResolvedValue(MOCK_RESULT);
  captureExceptionMock.mockResolvedValue(undefined);
});

// ============================================================
// Tests
// ============================================================

describe('GET /api/admin/ingestion/candidates/[id]/ai-review', () => {
  it('returns 503 when database is not configured', async () => {
    isDatabaseConfiguredMock.mockReturnValueOnce(false);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(503);
  });

  it('returns 429 when rate limit exceeded', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 30 });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('returns 401 when not authenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has insufficient role', async () => {
    const { requireMinRole } = await import('@/services/auth/guards');
    vi.mocked(requireMinRole).mockReturnValueOnce(false);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: 'Insufficient permissions.' });
  });

  it('returns 403 when llm_admin_assist flag is disabled', async () => {
    isEnabledMock.mockResolvedValueOnce(false);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: 'AI review feature not enabled.' });
  });

  it('returns 503 when review assist is not configured', async () => {
    reviewMocks.isReviewAssistConfigured.mockReturnValueOnce(false);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'AI review service not configured.' });
  });

  it('returns 400 for an invalid UUID', async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeRequest('not-a-uuid'), makeParams('not-a-uuid'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid candidate ID.' });
  });

  it('returns 404 when candidate does not exist', async () => {
    getCandidateMock.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'Candidate not found.' });
  });

  it('returns 200 with ReviewAssistResult on success', async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(res.json()).resolves.toEqual(MOCK_RESULT);
  });

  it('passes correct CandidateForReview to reviewCandidateWithLLM', async () => {
    const { GET } = await loadRoute();
    await GET(makeRequest(), makeParams());

    expect(reviewMocks.reviewCandidateWithLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        id: VALID_ID,
        serviceName: 'City Food Bank',
        description: 'Provides emergency food assistance.',
        organizationName: 'City Charity',
        phone: '(555) 123-4567',
        websiteUrl: 'https://example.org',
        addressLine1: '123 Main St',
        addressCity: 'Springfield',
        addressRegion: 'IL',
        addressPostalCode: '62701',
      }),
    );
  });

  it('returns 500 on LLM error', async () => {
    reviewMocks.reviewCandidateWithLLM.mockRejectedValueOnce(new Error('LLM timeout'));
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
