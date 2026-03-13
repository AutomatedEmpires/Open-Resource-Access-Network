/**
 * Unit tests for GET /api/hsds/services
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeCount: vi.fn(),
  executeQuery: vi.fn(),
}));

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

import { NextRequest } from 'next/server';

function createRequest(query = ''): NextRequest {
  const url = `http://localhost/api/hsds/services${query ? `?${query}` : ''}`;
  return new NextRequest(url, { method: 'GET' });
}

function mockPublicationRows(queryResults: Record<string, { rows: unknown[] }>) {
  dbMocks.executeCount.mockResolvedValue(Number((queryResults.count.rows[0] as { total: number }).total));
  dbMocks.executeQuery.mockResolvedValue(queryResults.data.rows);
}

const sampleRow = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  organization_id: '660e8400-e29b-41d4-a716-446655440001',
  name: 'Food Assistance',
  alternate_name: null,
  description: 'Provides food assistance',
  url: 'https://example.org',
  email: 'food@example.org',
  status: 'active',
  interpretation_services: null,
  fees: null,
  accreditations: null,
  licenses: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
});

describe('GET /api/hsds/services', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(503);
  });

  it('returns paginated list of services', async () => {
    mockPublicationRows({
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
    expect(body.contents[0].name).toBe('Food Assistance');
  });

  it('respects page and per_page query params', async () => {
    mockPublicationRows({
      count: { rows: [{ total: 50 }] },
      data: { rows: [] },
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest('page=3&per_page=5'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page_number).toBe(3);
    expect(body.per_page).toBe(5);
    expect(body.total_pages).toBe(10);
    // Verify offset = (3-1)*5 = 10
    expect(dbMocks.executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT $1 OFFSET $2'),
      [5, 10]
    );
  });

  it('clamps per_page to MAX_PAGE_SIZE=100', async () => {
    mockPublicationRows({
      count: { rows: [{ total: 0 }] },
      data: { rows: [] },
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest('per_page=999'));
    const body = await res.json();
    expect(body.per_page).toBe(100);
  });

  it('returns empty list when no services', async () => {
    mockPublicationRows({
      count: { rows: [{ total: 0 }] },
      data: { rows: [] },
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    const body = await res.json();
    expect(body.total_items).toBe(0);
    expect(body.contents).toEqual([]);
  });

  it('returns 500 and calls captureException on db error', async () => {
    const err = new Error('db down');
    dbMocks.executeCount.mockRejectedValue(err);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(err);
  });
});
