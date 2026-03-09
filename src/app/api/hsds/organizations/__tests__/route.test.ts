/**
 * Unit tests for GET /api/hsds/organizations
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  getPgPool: vi.fn(),
}));

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

import { NextRequest } from 'next/server';

function createRequest(query = ''): NextRequest {
  const url = `http://localhost/api/hsds/organizations${query ? `?${query}` : ''}`;
  return new NextRequest(url, { method: 'GET' });
}

function mockPool(queryResults: Record<string, { rows: unknown[] }>) {
  const queryFn = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('COUNT(*)')) return queryResults['count'];
    return queryResults['data'];
  });
  dbMocks.getPgPool.mockReturnValue({ query: queryFn });
  return queryFn;
}

const sampleRow = {
  id: '660e8400-e29b-41d4-a716-446655440001',
  name: 'Help Foundation',
  description: 'Non-profit assistance',
  url: 'https://helpfoundation.org',
  email: 'info@helpfoundation.org',
  tax_status: '501c3',
  tax_id: '12-3456789',
  year_incorporated: 2010,
  legal_status: 'Non-profit',
  logo_url: null,
  uri: null,
  status: 'active',
  phone: '555-0001',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
});

describe('GET /api/hsds/organizations', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(503);
  });

  it('returns paginated list of organizations', async () => {
    mockPool({
      count: { rows: [{ total: 1 }] },
      data: { rows: [sampleRow] },
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_items).toBe(1);
    expect(body.total_pages).toBe(1);
    expect(body.page_number).toBe(1);
    expect(body.per_page).toBe(20);
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].name).toBe('Help Foundation');
  });

  it('respects custom pagination', async () => {
    const queryFn = mockPool({
      count: { rows: [{ total: 30 }] },
      data: { rows: [] },
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest('page=2&per_page=10'));
    const body = await res.json();
    expect(body.page_number).toBe(2);
    expect(body.per_page).toBe(10);
    expect(body.total_pages).toBe(3);
    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT'),
      [10, 10]
    );
  });

  it('clamps per_page to 100', async () => {
    mockPool({
      count: { rows: [{ total: 0 }] },
      data: { rows: [] },
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest('per_page=500'));
    const body = await res.json();
    expect(body.per_page).toBe(100);
  });

  it('returns 500 on db error', async () => {
    const err = new Error('connection lost');
    dbMocks.getPgPool.mockReturnValue({
      query: vi.fn().mockRejectedValue(err),
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(err);
  });
});
