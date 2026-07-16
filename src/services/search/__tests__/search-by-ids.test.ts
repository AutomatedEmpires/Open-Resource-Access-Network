/**
 * Search Engine By IDs Tests
 *
 * Tests for the searchByIds method.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceSearchEngine } from '../engine';

describe('ServiceSearchEngine.searchByIds', () => {
  const mockExecuteQuery = vi.fn();
  const mockExecuteCount = vi.fn();

  const engine = new ServiceSearchEngine({
    executeQuery: mockExecuteQuery,
    executeCount: mockExecuteCount,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array for empty ids', async () => {
    const result = await engine.searchByIds([]);
    expect(result).toEqual([]);
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it('throws error if more than 50 IDs provided', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `00000000-0000-0000-0000-00000000000${i.toString().padStart(1, '0')}`);
    await expect(engine.searchByIds(ids)).rejects.toThrow('Maximum 50 IDs allowed per request');
  });

  it('queries database with provided IDs', async () => {
    const ids = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'];
    mockExecuteQuery.mockResolvedValue([]);

    await engine.searchByIds(ids);

    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecuteQuery.mock.calls[0];
    expect(sql).toContain('WHERE s.id = ANY($1::uuid[])');
    expect(sql).toContain('o.verified_at AS organization_verified_at');
    expect(params).toEqual([ids]);
  });

  it('maps results correctly', async () => {
    const ids = ['00000000-0000-0000-0000-000000000001'];
    mockExecuteQuery.mockResolvedValue([
      {
        id: '00000000-0000-0000-0000-000000000001',
        organization_id: 'org-1',
        name: 'Test Service',
        description: 'A test service',
        status: 'active',
        url: 'https://example.com',
        email: 'test@example.com',
        organization_name: 'Test Org',
        organization_description: 'A test org',
        organization_verified_at: new Date('2026-01-15T12:00:00.000Z'),
        organization_created_at: new Date(),
        organization_updated_at: new Date(),
        location_id: null,
        confidence_score: 85,
        verification_confidence: 80,
        eligibility_match: 70,
        constraint_fit: 90,
        confidence_id: 'cs-1',
        confidence_computed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        distance_meters: null,
      },
    ]);

    const results = await engine.searchByIds(ids);

    expect(results).toHaveLength(1);
    expect(results[0].service.service.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(results[0].service.service.name).toBe('Test Service');
    expect(results[0].service.organization.name).toBe('Test Org');
    expect(results[0].service.organization.verifiedAt).toBe('2026-01-15T12:00:00.000Z');
    expect(results[0].service.confidenceScore?.verificationConfidence).toBe(80);
  });

  it('accepts exactly 50 IDs', async () => {
    const ids = Array.from({ length: 50 }, (_, i) =>
      `00000000-0000-0000-0000-${i.toString().padStart(12, '0')}`
    );
    mockExecuteQuery.mockResolvedValue([]);

    await expect(engine.searchByIds(ids)).resolves.toEqual([]);
    expect(mockExecuteQuery).toHaveBeenCalled();
  });

  it('maps joined location/address rows and default statuses', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    mockExecuteQuery.mockResolvedValue([
      {
        id: '00000000-0000-0000-0000-000000000003',
        organization_id: 'org-1',
        name: 'Mapped Service',
        description: null,
        status: undefined,
        url: null,
        email: null,
        interpretation_services: null,
        application_process: null,
        wait_time: null,
        fees: null,
        accreditations: null,
        licenses: null,
        organization_name: null,
        organization_description: null,
        organization_status: undefined,
        organization_created_at: now,
        organization_updated_at: now,
        location_id: 'loc-1',
        location_organization_id: 'org-1',
        location_name: null,
        location_status: undefined,
        latitude: null,
        longitude: null,
        location_created_at: now,
        location_updated_at: now,
        address_id: 'addr-1',
        address_location_id: 'loc-1',
        address_1: null,
        address_2: null,
        city: null,
        region: null,
        state_province: null,
        postal_code: null,
        country: null,
        address_created_at: now,
        address_updated_at: now,
        confidence_score: 50,
        confidence_id: null,
        verification_confidence: null,
        eligibility_match: null,
        constraint_fit: null,
        confidence_computed_at: null,
        created_at: now,
        updated_at: now,
        distance_meters: 0,
      },
    ]);

    const result = await engine.searchByIds(['00000000-0000-0000-0000-000000000003']);
    const row = result[0];

    expect(row.service.service.status).toBe('active');
    expect(row.service.organization.name).toBe('');
    expect(row.service.organization.status).toBe('active');
    expect(row.service.organization.verifiedAt).toBeNull();
    expect(row.service.location?.status).toBe('active');
    expect(row.service.address?.address1).toBeNull();
    expect(row.service.confidenceScore?.id).toBe('');
    expect(row.service.confidenceScore?.verificationConfidence).toBe(0);
    expect(row.distanceMeters).toBe(0);
  });

  it('collapses location fanout to one result per service and hydrates relations', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const serviceId = '00000000-0000-0000-0000-000000000005';
    const baseRow = {
      id: serviceId,
      organization_id: 'org-1',
      name: 'Multi Location Service',
      description: null,
      organization_name: 'Org Name',
      organization_description: null,
      organization_created_at: now,
      organization_updated_at: now,
      address_id: null,
      confidence_score: null,
      created_at: now,
      updated_at: now,
      distance_meters: null,
    };

    mockExecuteQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('WHERE s.id = ANY($1::uuid[])') && sql.includes('organization_verified_at')) {
        // Two active locations => two joined rows for the same service.
        return [
          { ...baseRow, location_id: 'loc-1', location_organization_id: 'org-1', location_created_at: now, location_updated_at: now },
          { ...baseRow, location_id: 'loc-2', location_organization_id: 'org-1', location_created_at: now, location_updated_at: now },
        ];
      }
      if (sql.includes('FROM phones')) {
        return [{ id: 'p1', service_id: serviceId, number: '555-0100', type: 'voice' }];
      }
      if (sql.includes('FROM schedules')) {
        return [{ id: 's1', service_id: serviceId, description: 'Mon-Fri 9-5' }];
      }
      return [];
    });

    const results = await engine.searchByIds([serviceId]);

    expect(results).toHaveLength(1);
    expect(results[0].service.location?.id).toBe('loc-1');
    expect(results[0].service.phones).toHaveLength(1);
    expect(results[0].service.phones[0].number).toBe('555-0100');
    expect(results[0].service.schedules[0].description).toBe('Mon-Fri 9-5');
  });

  it('maps missing joins to nulls and keeps distance undefined', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    mockExecuteQuery.mockResolvedValue([
      {
        id: '00000000-0000-0000-0000-000000000004',
        organization_id: 'org-1',
        name: 'No Joins Service',
        description: null,
        organization_name: 'Org Name',
        organization_description: null,
        organization_created_at: now,
        organization_updated_at: now,
        location_id: null,
        address_id: null,
        confidence_score: null,
        created_at: now,
        updated_at: now,
        distance_meters: null,
      },
    ]);

    const result = await engine.searchByIds(['00000000-0000-0000-0000-000000000004']);
    const row = result[0];

    expect(row.service.location).toBeNull();
    expect(row.service.address).toBeNull();
    expect(row.service.confidenceScore).toBeNull();
    expect(row.distanceMeters).toBeUndefined();
  });
});
