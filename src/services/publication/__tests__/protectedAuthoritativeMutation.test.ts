import { describe, expect, it, vi } from 'vitest';

import {
  acquireAuthoritativeMutationGatesShared,
  acquireFreshnessSensitiveAuthoritativeMutationGates,
  assertAuthoritativeEntitiesMutable,
  findProtectedAuthoritativeEntities,
} from '../protectedAuthoritativeMutation';

describe('protected authoritative mutation guard', () => {
  it('takes publication, hotline, and quarantine shared locks in global order', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await acquireAuthoritativeMutationGatesShared({ query } as never);

    expect(query).toHaveBeenCalledTimes(3);
    expect(String(query.mock.calls[0]?.[0])).toContain('oran:live-publication-merge');
    expect(String(query.mock.calls[1]?.[0])).toContain('verified-national-hotlines');
    expect(String(query.mock.calls[2]?.[0])).toContain('usda-fns-snap-retailer');
    for (const [sql] of query.mock.calls) {
      expect(String(sql)).toContain('pg_advisory_xact_lock_shared');
    }
  });

  it('serializes freshness-sensitive live writes before protected maintenance gates', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await acquireFreshnessSensitiveAuthoritativeMutationGates({ query } as never);

    expect(query).toHaveBeenCalledTimes(4);
    expect(String(query.mock.calls[0]?.[0])).toContain('oran:live-publication-merge');
    expect(String(query.mock.calls[0]?.[0])).toContain('pg_advisory_xact_lock_shared');
    expect(String(query.mock.calls[1]?.[0])).toContain('oran:resource-freshness-scan');
    expect(String(query.mock.calls[1]?.[0])).toContain('pg_advisory_xact_lock(');
    expect(String(query.mock.calls[2]?.[0])).toContain('verified-national-hotlines');
    expect(String(query.mock.calls[3]?.[0])).toContain('usda-fns-snap-retailer');
  });

  it('rejects an active protected service without mutating it', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        workflow: 'verified_hotline',
        entity_type: 'service',
        entity_id: '11111111-1111-4111-8111-111111111111',
      }],
    });

    await expect(assertAuthoritativeEntitiesMutable({ query } as never, {
      serviceIds: ['11111111-1111-4111-8111-111111111111'],
    })).rejects.toThrow('verified-hotline authority');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns all protected matches for batch suppression filtering', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          workflow: 'resource_quarantine',
          entity_type: 'organization',
          entity_id: '22222222-2222-4222-8222-222222222222',
        },
        {
          workflow: 'verified_hotline',
          entity_type: 'service',
          entity_id: '11111111-1111-4111-8111-111111111111',
        },
      ],
    });

    const matches = await findProtectedAuthoritativeEntities({ query } as never, {
      organizationIds: ['22222222-2222-4222-8222-222222222222'],
      serviceIds: ['11111111-1111-4111-8111-111111111111'],
    });

    expect(matches).toEqual([
      {
        workflow: 'resource_quarantine',
        entityType: 'organization',
        entityId: '22222222-2222-4222-8222-222222222222',
      },
      {
        workflow: 'verified_hotline',
        entityType: 'service',
        entityId: '11111111-1111-4111-8111-111111111111',
      },
    ]);
  });

  it('does not query membership when no existing target IDs are supplied', async () => {
    const query = vi.fn();
    await expect(assertAuthoritativeEntitiesMutable({ query } as never, {})).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});
