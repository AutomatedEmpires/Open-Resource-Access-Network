import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/services/workflow/engine', () => ({
  checkSlaBreaches: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: vi.fn(),
}));

vi.mock('@/services/telemetry/sentry', () => ({
  captureException: vi.fn(),
}));

import { checkSlaBreaches } from '@/services/workflow/engine';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { POST } from '../route';
import { NextRequest } from 'next/server';

const mockCheckSlaBreaches = vi.mocked(checkSlaBreaches);
const mockIsDatabaseConfigured = vi.mocked(isDatabaseConfigured);

function makeRequest(apiKey?: string): NextRequest {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (apiKey) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }
  return new NextRequest('http://localhost/api/internal/sla-check', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/internal/sla-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('INTERNAL_API_KEY', 'test-secret-key');
    mockIsDatabaseConfigured.mockReturnValue(true);
  });

  it('returns 503 when INTERNAL_API_KEY is not configured', async () => {
    vi.stubEnv('INTERNAL_API_KEY', '');
    const res = await POST(makeRequest('test-secret-key'));
    expect(res.status).toBe(503);
  });

  it('returns 401 when authorization header is missing', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when authorization header has wrong key', async () => {
    const res = await POST(makeRequest('wrong-key'));
    expect(res.status).toBe(401);
  });

  it('returns 503 when database is not configured', async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);
    const res = await POST(makeRequest('test-secret-key'));
    expect(res.status).toBe(503);
  });

  it('runs SLA check and returns breach count on success', async () => {
    mockCheckSlaBreaches.mockResolvedValueOnce(3);

    const res = await POST(makeRequest('test-secret-key'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.breachedCount).toBe(3);
    expect(body.checkedAt).toBeDefined();
  });

  it('returns 500 when SLA check throws', async () => {
    mockCheckSlaBreaches.mockRejectedValueOnce(new Error('DB error'));

    const res = await POST(makeRequest('test-secret-key'));
    expect(res.status).toBe(500);
  });
});
