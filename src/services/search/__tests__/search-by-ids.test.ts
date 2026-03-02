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
});
