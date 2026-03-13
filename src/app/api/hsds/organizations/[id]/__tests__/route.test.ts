/**
 * Unit tests for GET /api/hsds/organizations/[id]
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

const VALID_UUID = '660e8400-e29b-41d4-a716-446655440001';

function createRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/hsds/organizations/${id}`, {
    method: 'GET',
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const orgRow = {
  id: VALID_UUID,
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

const svcRow = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Food Assistance',
  alternate_name: null,
  description: 'Provides food',
  url: null,
  email: null,
  status: 'active',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
};

const phoneRow = {
  id: '880e8400-e29b-41d4-a716-446655440003',
  number: '555-0001',
  extension: null,
  type: 'voice',
  language: 'en',
  description: 'Front desk',
};

function setupPool(rows: Record<string, unknown[]>) {
  dbMocks.executeQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM organizations o')) {
      return rows['org'] ?? [];
    }
    if (sql.includes('FROM services')) {
      return rows['services'] ?? [];
    }
    if (sql.includes('FROM phones')) {
      return rows['phones'] ?? [];
    }
    return [];
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
});

describe('GET /api/hsds/organizations/[id]', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    expect(res.status).toBe(503);
  });

  it('returns 400 for invalid UUID', async () => {
    const { GET } = await import('../route');
    const res = await GET(createRequest('bad-id'), makeParams('bad-id'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when organization not found', async () => {
    setupPool({ org: [] });
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it('returns full organization detail with services and phones', async () => {
    setupPool({
      org: [orgRow],
      services: [svcRow],
      phones: [phoneRow],
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.name).toBe('Help Foundation');
    expect(body.services).toHaveLength(1);
    expect(body.services[0].name).toBe('Food Assistance');
    expect(body.phones).toHaveLength(1);
    expect(body.phones[0].number).toBe('555-0001');
  });

  it('returns empty arrays when no services or phones', async () => {
    setupPool({
      org: [orgRow],
      services: [],
      phones: [],
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    const body = await res.json();
    expect(body.services).toEqual([]);
    expect(body.phones).toEqual([]);
  });

  it('returns 500 and calls captureException on error', async () => {
    const err = new Error('query failed');
    dbMocks.executeQuery.mockRejectedValue(err);
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(err);
  });
});
