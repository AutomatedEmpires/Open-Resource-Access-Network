/**
 * Unit tests for organization service caps
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecuteQuery = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  executeQuery: mockExecuteQuery,
}));

import {
  getOrgServiceCapStatus,
  canOrgAddService,
  setOrgMaxServices,
  DEFAULT_ORG_MAX_SERVICES,
} from '../serviceCaps';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteQuery.mockResolvedValue([{ active_count: 0, max_services: null }]);
});

describe('getOrgServiceCapStatus', () => {
  it('returns status with default cap when no settings row exists', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ active_count: 10, max_services: null }]);

    const status = await getOrgServiceCapStatus(ORG_ID);

    expect(status.organizationId).toBe(ORG_ID);
    expect(status.activeServiceCount).toBe(10);
    expect(status.maxServices).toBe(DEFAULT_ORG_MAX_SERVICES);
    expect(status.remaining).toBe(90);
    expect(status.atCapacity).toBe(false);
  });

  it('returns status with custom cap from organization_settings', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ active_count: 50, max_services: 50 }]);

    const status = await getOrgServiceCapStatus(ORG_ID);

    expect(status.maxServices).toBe(50);
    expect(status.remaining).toBe(0);
    expect(status.atCapacity).toBe(true);
  });

  it('returns atCapacity=true when over cap', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ active_count: 55, max_services: 50 }]);

    const status = await getOrgServiceCapStatus(ORG_ID);

    expect(status.atCapacity).toBe(true);
    expect(status.remaining).toBe(0);
  });

  it('handles zero active services', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ active_count: 0, max_services: null }]);

    const status = await getOrgServiceCapStatus(ORG_ID);

    expect(status.activeServiceCount).toBe(0);
    expect(status.remaining).toBe(DEFAULT_ORG_MAX_SERVICES);
    expect(status.atCapacity).toBe(false);
  });
});

describe('canOrgAddService', () => {
  it('returns true when under cap', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ active_count: 5, max_services: 10 }]);
    expect(await canOrgAddService(ORG_ID)).toBe(true);
  });

  it('returns false when at cap', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ active_count: 10, max_services: 10 }]);
    expect(await canOrgAddService(ORG_ID)).toBe(false);
  });

  it('returns false when over cap', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ active_count: 12, max_services: 10 }]);
    expect(await canOrgAddService(ORG_ID)).toBe(false);
  });
});

describe('setOrgMaxServices', () => {
  it('upserts organization_settings row', async () => {
    mockExecuteQuery.mockResolvedValueOnce([]);

    await setOrgMaxServices(ORG_ID, 200);

    expect(mockExecuteQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      [ORG_ID, 200],
    );
  });

  it('throws when maxServices is less than 1', async () => {
    await expect(setOrgMaxServices(ORG_ID, 0)).rejects.toThrow('maxServices must be between 1 and 10,000');
  });

  it('throws when maxServices exceeds 10,000', async () => {
    await expect(setOrgMaxServices(ORG_ID, 10001)).rejects.toThrow('maxServices must be between 1 and 10,000');
  });

  it('accepts boundary value of 1', async () => {
    mockExecuteQuery.mockResolvedValueOnce([]);
    await expect(setOrgMaxServices(ORG_ID, 1)).resolves.not.toThrow();
  });

  it('accepts boundary value of 10,000', async () => {
    mockExecuteQuery.mockResolvedValueOnce([]);
    await expect(setOrgMaxServices(ORG_ID, 10000)).resolves.not.toThrow();
  });
});
