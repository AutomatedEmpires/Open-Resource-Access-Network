import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockGetAuthContext = vi.fn();
const mockCheckRateLimit = vi.fn(() => ({ exceeded: false }));

const triageServiceMocks = {
  getTriageQueue: vi.fn(),
  scoreAllPendingSubmissions: vi.fn(),
  getTriageScore: vi.fn(),
  scoreSubmission: vi.fn(),
  getTriageSummary: vi.fn(),
};

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: mockIsDatabaseConfigured,
}));

vi.mock('@/services/auth/session', () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock('@/services/auth/guards', () => ({
  requireMinRole: vi.fn((ctx: { role: string }, minRole: string) => {
    const levels: Record<string, number> = {
      seeker: 0, host_member: 1, host_admin: 2, community_admin: 3, oran_admin: 4,
    };
    return (levels[ctx.role] ?? 0) >= (levels[minRole] ?? 0);
  }),
}));

vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/services/triage/triage', () => triageServiceMocks);

const getStatus = (res: unknown): number | undefined => {
  const candidate = res as { status?: number; statusCode?: number; init?: { status?: number } };
  return candidate?.status ?? candidate?.statusCode ?? candidate?.init?.status;
};

const adminAuthCtx = {
  userId: 'admin-1',
  email: 'admin@example.org',
  role: 'oran_admin',
  name: 'Admin',
  orgId: null,
};

describe('GET /api/admin/triage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockGetAuthContext.mockResolvedValue(adminAuthCtx);
    mockCheckRateLimit.mockReturnValue({ exceeded: false });
  });

  it('returns 503 when database is not configured', async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('@/app/api/admin/triage/route');

    const req = new NextRequest('http://localhost/api/admin/triage?queue_type=pending_verification');
    const res = await GET(req);

    expect(getStatus(res)).toBe(503);
  });


  it('returns queue entries and total', async () => {
    triageServiceMocks.getTriageQueue.mockResolvedValue({
      entries: [
        {
          submission_id: 'sub-1',
          submission_type: 'service_verification',
          status: 'needs_review',
          title: 'Submission 1',
          service_id: 'svc-1',
          service_name: 'Service 1',
          created_at: new Date().toISOString(),
          sla_deadline: null,
          sla_breached: false,
          triage_priority: 74,
          triage_explanations: ['Recent negative feedback'],
          scored_at: new Date().toISOString(),
        },
      ],
      total: 1,
    });

    const { GET } = await import('@/app/api/admin/triage/route');
    const req = new NextRequest('http://localhost/api/admin/triage?queue_type=pending_verification&limit=10&offset=0');
    const res = await GET(req);

    expect(getStatus(res) ?? 200).toBe(200);
  });

});

describe('POST /api/admin/triage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockGetAuthContext.mockResolvedValue(adminAuthCtx);
    mockCheckRateLimit.mockReturnValue({ exceeded: false });
  });

  it('returns scored count', async () => {
    triageServiceMocks.scoreAllPendingSubmissions.mockResolvedValue(7);
    const { POST } = await import('@/app/api/admin/triage/route');
    const req = new NextRequest('http://localhost/api/admin/triage', { method: 'POST' });
    const res = await POST(req);

    expect(getStatus(res) ?? 200).toBe(200);
  });

});

describe('GET /api/admin/triage/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockGetAuthContext.mockResolvedValue(adminAuthCtx);
    mockCheckRateLimit.mockReturnValue({ exceeded: false });
  });

  it('returns score when found', async () => {
    triageServiceMocks.getTriageScore.mockResolvedValue({
      id: 'ts-1',
      submission_id: 'sub-1',
      triage_priority: 80,
      signal_traffic: 0.2,
      signal_trust: 1,
      signal_feedback: 0.4,
      signal_staleness: 0.6,
      signal_crisis: 1,
      signal_sla_breach: 0,
      triage_explanations: ['Very low confidence score'],
      scored_at: new Date().toISOString(),
    });
    const { GET } = await import('@/app/api/admin/triage/[id]/route');
    const req = new NextRequest('http://localhost/api/admin/triage/sub-1');
    const res = await GET(req, { params: Promise.resolve({ id: 'sub-1' }) });
    expect(getStatus(res) ?? 200).toBe(200);
  });
});

describe('POST /api/admin/triage/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockGetAuthContext.mockResolvedValue(adminAuthCtx);
    mockCheckRateLimit.mockReturnValue({ exceeded: false });
  });

  it('returns rescored record when found', async () => {
    triageServiceMocks.scoreSubmission.mockResolvedValue({
      id: 'ts-2',
      submission_id: 'sub-2',
      triage_priority: 64,
      signal_traffic: 0.3,
      signal_trust: 0.2,
      signal_feedback: 0.1,
      signal_staleness: 0.5,
      signal_crisis: 0,
      signal_sla_breach: 0,
      triage_explanations: ['Aging in queue'],
      scored_at: new Date().toISOString(),
    });
    const { POST } = await import('@/app/api/admin/triage/[id]/route');
    const req = new NextRequest('http://localhost/api/admin/triage/sub-2', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'sub-2' }) });
    expect(getStatus(res) ?? 200).toBe(200);
  });
});

describe('GET /api/admin/triage/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockGetAuthContext.mockResolvedValue(adminAuthCtx);
    mockCheckRateLimit.mockReturnValue({ exceeded: false });
  });

  it('returns summary', async () => {
    triageServiceMocks.getTriageSummary.mockResolvedValue([
      {
        queue_type: 'pending_verification',
        label: 'Pending Verification',
        total: 10,
        high_priority: 5,
        critical: 2,
        avg_priority: 68.5,
      },
    ]);

    const { GET } = await import('@/app/api/admin/triage/summary/route');
    const req = new NextRequest('http://localhost/api/admin/triage/summary');
    const res = await GET(req);

    expect(getStatus(res) ?? 200).toBe(200);
  });

});
