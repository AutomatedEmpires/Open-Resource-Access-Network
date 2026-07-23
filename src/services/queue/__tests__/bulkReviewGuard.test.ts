import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { CommunityAdminScope } from '@/services/community/scope';
import {
  BULK_APPROVAL_SAFE_GENERIC_SUBMISSION_TYPES,
  lockBulkReviewSubmissions,
  payloadHasResourceFreshness,
} from '@/services/queue/bulkReviewGuard';

const ACTOR = 'reviewer-1';

interface RowOverrides {
  id?: string;
  submission_type?: string;
  status?: string;
  assigned_to_user_id?: string | null;
  is_locked?: boolean;
  locked_by_user_id?: string | null;
  service_id?: string | null;
  payload?: unknown;
  has_open_freshness_finding?: boolean;
  has_form_instance?: boolean;
}

function row(overrides: RowOverrides = {}) {
  return {
    id: 'sub-1',
    submission_type: 'community_report',
    status: 'under_review',
    assigned_to_user_id: ACTOR,
    is_locked: true,
    locked_by_user_id: ACTOR,
    service_id: 'svc-1',
    payload: {},
    has_open_freshness_finding: false,
    has_form_instance: false,
    ...overrides,
  };
}

function scopeFor(overrides: Partial<CommunityAdminScope> = {}): CommunityAdminScope {
  return {
    userId: ACTOR,
    coverageZoneId: null,
    coverageZoneName: null,
    coverageZoneDescription: null,
    coverageStates: [],
    coverageCounties: [],
    hasGeometry: false,
    hasExplicitScope: false,
    ...overrides,
  };
}

function clientReturning(rows: ReturnType<typeof row>[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { client: { query } as unknown as PoolClient, query };
}

describe('payloadHasResourceFreshness', () => {
  it('detects only object payloads that own a resourceFreshness key', () => {
    expect(payloadHasResourceFreshness({ resourceFreshness: {} })).toBe(true);
    // hasOwnProperty semantics: the key existing is what matters, not its value
    expect(payloadHasResourceFreshness({ resourceFreshness: null })).toBe(true);
    expect(payloadHasResourceFreshness({})).toBe(false);
    expect(payloadHasResourceFreshness(null)).toBe(false);
    expect(payloadHasResourceFreshness(undefined)).toBe(false);
    expect(payloadHasResourceFreshness('resourceFreshness')).toBe(false);
    expect(payloadHasResourceFreshness([{ resourceFreshness: {} }])).toBe(false);
    expect(payloadHasResourceFreshness({ other: 1 })).toBe(false);
  });
});

describe('lockBulkReviewSubmissions', () => {
  it('keeps the generic bulk-approval allow-list empty (fail closed)', async () => {
    // Widening this list requires proof that the type's approval is a pure
    // status-only operation — update this test alongside that proof.
    expect(BULK_APPROVAL_SAFE_GENERIC_SUBMISSION_TYPES).toHaveLength(0);

    const rows = [
      row({ id: 'sub-1', submission_type: 'service_verification' }),
      row({ id: 'sub-2', submission_type: 'community_report' }),
      row({ id: 'sub-3', submission_type: 'org_claim' }),
    ];
    const { client } = clientReturning(rows);

    const preflight = await lockBulkReviewSubmissions(
      client, ['sub-1', 'sub-2', 'sub-3'], scopeFor(), true, ACTOR,
    );

    expect(preflight.individualReviewRequiredIds).toEqual(['sub-1', 'sub-2', 'sub-3']);
  });

  it('requires individual review when a form instance exists, regardless of type', async () => {
    const { client } = clientReturning([row({ has_form_instance: true })]);

    const preflight = await lockBulkReviewSubmissions(client, ['sub-1'], scopeFor(), true, ACTOR);

    expect(preflight.individualReviewRequiredIds).toEqual(['sub-1']);
  });

  it('locks rows in stable order and dedupes requested ids', async () => {
    const { client, query } = clientReturning([row()]);

    await lockBulkReviewSubmissions(client, ['sub-1', 'sub-1', 'sub-2'], scopeFor(), true, ACTOR);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FOR UPDATE OF sub');
    expect(sql).toContain('ORDER BY sub.id');
    expect(sql).toContain('= ANY($1::uuid[])');
    expect(params[0]).toEqual(['sub-1', 'sub-2']);
  });

  it('omits scope SQL for unrestricted (oran_admin) callers', async () => {
    const { client, query } = clientReturning([row()]);

    await lockBulkReviewSubmissions(
      client, ['sub-1'], scopeFor({ hasExplicitScope: true, coverageZoneId: 'zone-1' }), true, ACTOR,
    );

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('form_instances fi');
    expect(sql).not.toContain('service_at_location');
    expect(params).toHaveLength(1);
  });

  it('appends the real scope clauses with ordered params for scoped reviewers', async () => {
    const { client, query } = clientReturning([row()]);
    const scope = scopeFor({
      hasExplicitScope: true,
      coverageZoneId: 'zone-1',
      coverageStates: ['WA', 'OR'],
    });

    await lockBulkReviewSubmissions(client, ['sub-1'], scope, false, ACTOR);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('form_instances fi');
    expect(sql).toContain('service_at_location');
    expect(sql).toContain('assigned_to_user_id = $4');
    expect(params).toEqual([['sub-1'], 'zone-1', ['WA', 'OR'], ACTOR]);
  });

  it('falls back to unscoped SQL when the reviewer has no explicit scope', async () => {
    const { client, query } = clientReturning([row()]);

    await lockBulkReviewSubmissions(client, ['sub-1'], scopeFor(), false, ACTOR);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('form_instances fi');
    expect(params).toHaveLength(1);
  });

  it('reports requested ids the query did not return as inaccessible', async () => {
    const { client } = clientReturning([row({ id: 'sub-1' })]);

    const preflight = await lockBulkReviewSubmissions(
      client, ['sub-1', 'sub-2'], scopeFor(), true, ACTOR,
    );

    expect(preflight.inaccessibleIds).toEqual(['sub-2']);
  });

  it.each([
    ['status outside review', row({ status: 'needs_review' })],
    ['assigned to someone else', row({ assigned_to_user_id: 'other' })],
    ['not locked', row({ is_locked: false })],
    ['locked by someone else', row({ locked_by_user_id: 'other' })],
  ])('flags an ownership conflict when %s', async (_label, conflictRow) => {
    const { client } = clientReturning([conflictRow]);

    const preflight = await lockBulkReviewSubmissions(client, ['sub-1'], scopeFor(), true, ACTOR);

    expect(preflight.reviewOwnershipConflictIds).toEqual(['sub-1']);
  });

  it('accepts a row the acting reviewer has claimed and locked', async () => {
    const { client } = clientReturning([
      row(),
      row({ id: 'sub-2', status: 'pending_second_approval' }),
    ]);

    const preflight = await lockBulkReviewSubmissions(
      client, ['sub-1', 'sub-2'], scopeFor(), true, ACTOR,
    );

    expect(preflight.reviewOwnershipConflictIds).toEqual([]);
  });

  it('blocks structured freshness evidence via the open finding or the payload key', async () => {
    const { client } = clientReturning([
      row({ id: 'sub-1', has_open_freshness_finding: true }),
      row({ id: 'sub-2', payload: { resourceFreshness: {} } }),
      row({ id: 'sub-3', has_open_freshness_finding: true, payload: { resourceFreshness: {} } }),
      row({ id: 'sub-4' }),
    ]);

    const preflight = await lockBulkReviewSubmissions(
      client, ['sub-1', 'sub-2', 'sub-3', 'sub-4'], scopeFor(), true, ACTOR,
    );

    expect(preflight.structuredFreshnessIds).toEqual(['sub-1', 'sub-2', 'sub-3']);
  });

  it('maps locked submissions to {id, serviceId} including null service ids', async () => {
    const { client } = clientReturning([
      row({ id: 'sub-1', service_id: 'svc-1' }),
      row({ id: 'sub-2', service_id: null }),
    ]);

    const preflight = await lockBulkReviewSubmissions(
      client, ['sub-1', 'sub-2'], scopeFor(), true, ACTOR,
    );

    expect(preflight.submissions).toEqual([
      { id: 'sub-1', serviceId: 'svc-1' },
      { id: 'sub-2', serviceId: null },
    ]);
  });
});
