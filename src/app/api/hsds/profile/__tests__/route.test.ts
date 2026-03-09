/**
 * Unit tests for GET /api/hsds/profile
 */
import { describe, expect, it } from 'vitest';

describe('GET /api/hsds/profile', () => {
  it('returns profile metadata with correct structure', async () => {
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe('oran-hsds-profile');
    expect(body.name).toBe('ORAN HSDS Profile');
    expect(body.profile_uri).toBe('https://openreferral.org/imls/hsds/');
    expect(body.hsds_version).toBe('3.0');
  });

  it('lists expected HSDS endpoints', async () => {
    const { GET } = await import('../route');
    const res = await GET();
    const body = await res.json();

    expect(body.endpoints).toBeInstanceOf(Array);
    expect(body.endpoints.length).toBeGreaterThanOrEqual(5);

    const paths = body.endpoints.map((e: { path: string }) => e.path);
    expect(paths).toContain('/api/hsds/services');
    expect(paths).toContain('/api/hsds/services/{id}');
    expect(paths).toContain('/api/hsds/organizations');
    expect(paths).toContain('/api/hsds/organizations/{id}');
    expect(paths).toContain('/api/hsds/profile');
  });

  it('declares canonical-approved-only publication policy', async () => {
    const { GET } = await import('../route');
    const res = await GET();
    const body = await res.json();

    expect(body.publication_policy).toEqual({
      source: 'canonical_approved_only',
      raw_source_records_exposed: false,
      extracted_candidates_exposed: false,
    });
  });

  it('sets cache-control header', async () => {
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });
});
