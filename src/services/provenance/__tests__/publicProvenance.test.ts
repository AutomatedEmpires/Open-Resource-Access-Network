import { describe, expect, it, vi } from 'vitest';

import { getPublicProvenanceSummaries } from '../publicProvenance';

const SERVICE_A = '11111111-1111-4111-8111-111111111111';
const SERVICE_B = '22222222-2222-4222-8222-222222222222';
const SERVICE_C = '33333333-3333-4333-8333-333333333333';
const SERVICE_D = '44444444-4444-4444-8444-444444444444';

type Row = Record<string, unknown>;

function makeDeps(rows: { canonical?: Row[]; manual?: Row[]; base?: Row[] }) {
  const executeQuery = vi.fn(async (sql: string, params: unknown[]) => {
    expect(params).toHaveLength(1);
    expect(Array.isArray(params[0])).toBe(true);
    if (sql.includes('canonical_services')) return rows.canonical ?? [];
    if (sql.includes('hsds_export_snapshots')) return rows.manual ?? [];
    if (sql.includes('FROM public.services')) return rows.base ?? [];
    throw new Error(`Unexpected SQL: ${sql.slice(0, 60)}`);
  });
  return { executeQuery: executeQuery as <T>(sql: string, params: unknown[]) => Promise<T[]>, mock: executeQuery };
}

describe('getPublicProvenanceSummaries', () => {
  it('returns an empty map without querying when no ids are given', async () => {
    const deps = makeDeps({});
    const result = await getPublicProvenanceSummaries(deps, []);
    expect(result.size).toBe(0);
    expect(deps.mock).not.toHaveBeenCalled();
  });

  it('maps canonical feed attribution through trust tiers with feed precedence', async () => {
    const deps = makeDeps({
      canonical: [{
        service_id: SERVICE_A,
        source_name: '211 National Data Platform',
        trust_tier: 'verified_publisher',
        source_count: 3,
        first_seen_at: new Date('2026-01-05T00:00:00Z'),
        last_refreshed_at: new Date('2026-07-01T00:00:00Z'),
      }],
      // Manual evidence also exists but canonical attribution wins.
      manual: [{
        service_id: SERVICE_A,
        source_kind: 'community_review',
        last_approved_at: new Date('2026-06-01T00:00:00Z'),
      }],
      base: [{ service_id: SERVICE_A, created_by_user_id: null, updated_at: new Date('2026-07-02T00:00:00Z') }],
    });

    const result = await getPublicProvenanceSummaries(deps, [SERVICE_A]);
    expect(result.get(SERVICE_A)).toEqual({
      serviceId: SERVICE_A,
      origin: 'official_feed',
      sourceName: '211 National Data Platform',
      sourceCount: 3,
      firstSeenAt: '2026-01-05T00:00:00.000Z',
      informationUpdatedAt: '2026-07-01T00:00:00.000Z',
      lastHumanReviewAt: null,
    });
  });

  it('distinguishes provider and community submissions and records the approval date as human review', async () => {
    const deps = makeDeps({
      manual: [
        { service_id: SERVICE_A, source_kind: 'host_submission', last_approved_at: '2026-06-20T10:00:00Z' },
        { service_id: SERVICE_B, source_kind: 'community_review', last_approved_at: '2026-06-21T10:00:00Z' },
      ],
      base: [
        { service_id: SERVICE_A, created_by_user_id: 'user-1', updated_at: '2026-06-25T00:00:00Z' },
        { service_id: SERVICE_B, created_by_user_id: 'anon_abc', updated_at: '2026-06-25T00:00:00Z' },
      ],
    });

    const result = await getPublicProvenanceSummaries(deps, [SERVICE_A, SERVICE_B]);
    expect(result.get(SERVICE_A)?.origin).toBe('provider_submission');
    expect(result.get(SERVICE_A)?.lastHumanReviewAt).toBe('2026-06-20T10:00:00.000Z');
    expect(result.get(SERVICE_B)?.origin).toBe('community_submission');
    // Contributor identity must never leak into the public-safe label.
    expect(result.get(SERVICE_B)?.sourceName).not.toContain('anon_abc');
  });

  it('labels bulk imports from the created_by marker and falls back to unknown honestly', async () => {
    const deps = makeDeps({
      base: [
        { service_id: SERVICE_C, created_by_user_id: 'import:hrsa', updated_at: '2026-05-01T00:00:00Z' },
        { service_id: SERVICE_D, created_by_user_id: 'user-99', updated_at: '2026-05-02T00:00:00Z' },
      ],
    });

    const result = await getPublicProvenanceSummaries(deps, [SERVICE_C, SERVICE_D]);
    expect(result.get(SERVICE_C)).toMatchObject({
      origin: 'curated_import',
      sourceName: 'HRSA Health Center Program data',
      informationUpdatedAt: '2026-05-01T00:00:00.000Z',
      lastHumanReviewAt: null,
    });
    // No evidence => unknown origin, no invented source, record-update date only.
    expect(result.get(SERVICE_D)).toMatchObject({
      origin: 'unknown',
      sourceName: null,
      firstSeenAt: null,
      lastHumanReviewAt: null,
      informationUpdatedAt: '2026-05-02T00:00:00.000Z',
    });
  });

  it('keeps the latest approval when a service has multiple approved manual snapshots', async () => {
    const deps = makeDeps({
      manual: [
        { service_id: SERVICE_A, source_kind: 'community_review', last_approved_at: '2026-03-01T00:00:00Z' },
        { service_id: SERVICE_A, source_kind: 'host_submission', last_approved_at: '2026-06-01T00:00:00Z' },
      ],
      base: [{ service_id: SERVICE_A, created_by_user_id: null, updated_at: '2026-06-02T00:00:00Z' }],
    });

    const result = await getPublicProvenanceSummaries(deps, [SERVICE_A]);
    expect(result.get(SERVICE_A)?.origin).toBe('provider_submission');
    expect(result.get(SERVICE_A)?.lastHumanReviewAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('maps an unrecognized trust tier to unknown rather than inventing a class', async () => {
    const deps = makeDeps({
      canonical: [{
        service_id: SERVICE_A,
        source_name: 'Mystery Feed',
        trust_tier: 'brand_new_tier',
        source_count: 1,
        first_seen_at: null,
        last_refreshed_at: '2026-07-01T00:00:00Z',
      }],
      base: [{ service_id: SERVICE_A, created_by_user_id: null, updated_at: '2026-07-01T00:00:00Z' }],
    });

    const result = await getPublicProvenanceSummaries(deps, [SERVICE_A]);
    expect(result.get(SERVICE_A)?.origin).toBe('unknown');
    expect(result.get(SERVICE_A)?.sourceName).toBe('Mystery Feed');
  });

  it('parameterizes service ids (no interpolation into SQL)', async () => {
    const deps = makeDeps({ base: [] });
    await getPublicProvenanceSummaries(deps, [SERVICE_A]);
    for (const call of deps.mock.mock.calls) {
      const [sql, params] = call as [string, unknown[]];
      expect(sql).not.toContain(SERVICE_A);
      expect(params[0]).toEqual([SERVICE_A]);
    }
  });
});
