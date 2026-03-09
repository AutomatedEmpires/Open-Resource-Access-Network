/**
 * Unit tests for GET /api/hsds/services/[id]
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

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_UUID = '660e8400-e29b-41d4-a716-446655440001';
const LOC_UUID = '770e8400-e29b-41d4-a716-446655440002';

function createRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/hsds/services/${id}`, {
    method: 'GET',
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const svcRow = {
  id: VALID_UUID,
  organization_id: ORG_UUID,
  name: 'Food Assistance',
  alternate_name: null,
  description: 'Provides food',
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

const orgRow = {
  id: ORG_UUID,
  name: 'Help Org',
  description: 'Helping',
  url: 'https://help.org',
  email: 'info@help.org',
  status: 'active',
  phone: '555-0001',
};

const locRow = {
  id: LOC_UUID,
  name: 'Main Office',
  description: null,
  latitude: 47.6,
  longitude: -117.4,
  transportation: null,
  status: 'active',
};

const phoneRow = {
  id: '880e8400-e29b-41d4-a716-446655440003',
  number: '555-9999',
  extension: null,
  type: 'voice',
  language: 'en',
  description: 'Main line',
};

const addressRow = {
  id: '990e8400-e29b-41d4-a716-446655440004',
  location_id: LOC_UUID,
  address_1: '123 Main St',
  city: 'Spokane',
  state_province: 'WA',
  postal_code: '99201',
  country: 'US',
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
});

function setupPool(rows: Record<string, unknown[]>) {
  const queryFn = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('FROM services')) return { rows: rows['service'] ?? [] };
    if (sql.includes('FROM organizations')) return { rows: rows['org'] ?? [] };
    if (sql.includes('FROM service_at_location')) return { rows: rows['locations'] ?? [] };
    if (sql.includes('FROM phones')) return { rows: rows['phones'] ?? [] };
    if (sql.includes('FROM addresses')) return { rows: rows['addresses'] ?? [] };
    return { rows: [] };
  });
  dbMocks.getPgPool.mockReturnValue({ query: queryFn });
  return queryFn;
}

describe('GET /api/hsds/services/[id]', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    expect(res.status).toBe(503);
  });

  it('returns 400 for invalid UUID', async () => {
    const { GET } = await import('../route');
    const res = await GET(createRequest('not-a-uuid'), makeParams('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when service not found', async () => {
    setupPool({ service: [] });
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it('returns full service detail with related entities', async () => {
    setupPool({
      service: [svcRow],
      org: [orgRow],
      locations: [locRow],
      phones: [phoneRow],
      addresses: [addressRow],
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.name).toBe('Food Assistance');
    expect(body.organization.name).toBe('Help Org');
    expect(body.locations).toHaveLength(1);
    expect(body.locations[0].name).toBe('Main Office');
    expect(body.phones).toHaveLength(1);
    expect(body.phones[0].number).toBe('555-9999');
    expect(body.addresses).toHaveLength(1);
    expect(body.addresses[0].city).toBe('Spokane');
  });

  it('returns null organization when not found', async () => {
    setupPool({
      service: [svcRow],
      org: [],
      locations: [],
      phones: [],
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    const body = await res.json();
    expect(body.organization).toBeNull();
  });

  it('skips address query when no locations', async () => {
    const queryFn = setupPool({
      service: [svcRow],
      org: [orgRow],
      locations: [],
      phones: [],
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    const body = await res.json();
    expect(body.addresses).toEqual([]);
    // Should NOT have called addresses query
    const addressCalls = queryFn.mock.calls.filter(
      (c: string[]) => typeof c[0] === 'string' && c[0].includes('FROM addresses')
    );
    expect(addressCalls).toHaveLength(0);
  });

  it('returns 500 and calls captureException on error', async () => {
    const err = new Error('db error');
    dbMocks.getPgPool.mockReturnValue({
      query: vi.fn().mockRejectedValue(err),
    });
    const { GET } = await import('../route');
    const res = await GET(createRequest(VALID_UUID), makeParams(VALID_UUID));
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(err);
  });
});
