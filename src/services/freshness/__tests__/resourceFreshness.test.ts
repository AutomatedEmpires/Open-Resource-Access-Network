import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  CANONICAL_STALE_AFTER_DAYS,
  RESOURCE_FRESHNESS_CANDIDATE_SQL,
  UNKNOWN_SOURCE_STALE_AFTER_DAYS,
  runResourceFreshnessScan,
} from '../resourceFreshness';

type Candidate = {
  service_id: string;
  service_name: string;
  organization_id: string;
  signal_type: 'explicit_expiry' | 'reverification_due' | 'stale_source' | 'unknown_source';
  signal_observed_at: string;
  freshness_threshold_days: number | null;
  service_updated_at: string;
  last_source_refresh_at: string | null;
  last_candidate_verified_at: string | null;
  last_manual_verification_at: string | null;
  reverify_at: string | null;
  schedule_count: number;
  dated_schedule_count: number;
  max_valid_to: string | null;
  existing_submission_id: string | null;
};

const asOf = new Date('2026-07-13T12:00:00.000Z');

function explicitExpiryCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    service_id: '10000000-0000-4000-8000-000000000001',
    service_name: 'Seasonal cooling center',
    organization_id: '20000000-0000-4000-8000-000000000001',
    signal_type: 'explicit_expiry',
    signal_observed_at: '2026-07-01T00:00:00.000Z',
    freshness_threshold_days: null,
    service_updated_at: '2026-06-01T00:00:00.000Z',
    last_source_refresh_at: '2026-06-01T00:00:00.000Z',
    last_candidate_verified_at: null,
    last_manual_verification_at: null,
    reverify_at: null,
    schedule_count: 2,
    dated_schedule_count: 2,
    max_valid_to: '2026-07-01',
    existing_submission_id: null,
    ...overrides,
  };
}

function createClient(options: {
  candidates?: Candidate[];
  holdSucceeds?: boolean;
  resolvedCount?: number;
  confirmedCount?: number;
} = {}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql === RESOURCE_FRESHNESS_CANDIDATE_SQL) {
      return { rows: options.candidates ?? [] };
    }
    if (sql.includes("resolution = 'submission_approved_and_expiry_cleared'")) {
      return { rows: Array.from({ length: options.resolvedCount ?? 0 }, (_, i) => ({ id: `resolved-${i}` })) };
    }
    if (sql.includes("resolution = 'submission_denied_publication_hold_retained'")) {
      return { rows: Array.from({ length: options.confirmedCount ?? 0 }, (_, i) => ({ id: `confirmed-${i}` })) };
    }
    if (sql.includes('INSERT INTO oran_internal.resource_freshness_findings')) {
      return { rows: [{ id: params?.[0] as string }] };
    }
    if (sql.includes('UPDATE public.services') && sql.includes('integrity_hold_at = $1')) {
      return options.holdSucceeds === false
        ? { rows: [] }
        : { rows: [{ id: params?.[3] as string }] };
    }
    return { rows: [] };
  });

  return { query } as unknown as PoolClient;
}

describe('resource freshness candidate policy', () => {
  it('requires all attached schedules to carry a past valid-to date before treating expiry as explicit', () => {
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('sch.valid_to < $2::date');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('current_schedule.valid_to IS NULL');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('current_schedule.valid_to >= $2::date');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('sch.service_id IS NULL');
  });

  it('uses conservative freshness windows and the seeker publication provenance boundary', () => {
    expect(CANONICAL_STALE_AFTER_DAYS).toBe(180);
    expect(UNKNOWN_SOURCE_STALE_AFTER_DAYS).toBe(365);
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain("ss.resource_purpose IN ('service_catalog', 'program_navigation')");
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('canonical_provenance publication_provenance');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain("publication_record.processing_status = 'published'");
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain("publication_submission.status = 'approved'");
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('service.integrity_hold_at IS NULL');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain("open_finding.status = 'open'");
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('LIMIT greatest($1::int * 20, 100)');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('public.submission_transitions transition');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain("transition.to_status = 'approved'");
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).not.toContain('public.confidence_scores score');
  });
});

describe('runResourceFreshnessScan', () => {
  it('returns reconciliation counts without creating work when no candidate is due', async () => {
    const client = createClient({ resolvedCount: 2, confirmedCount: 1 });
    const result = await runResourceFreshnessScan(client, { asOf, limit: 10 });

    expect(result).toEqual({
      checkedCount: 0,
      findingCount: 0,
      blockedCount: 0,
      expiredBlockedCount: 0,
      staleBlockedCount: 0,
      enqueuedCount: 0,
      linkedToExistingCount: 0,
      resolvedCount: 2,
      confirmedUnavailableCount: 1,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock');
    const candidateCall = query.mock.calls.find(([sql]) => sql === RESOURCE_FRESHNESS_CANDIDATE_SQL);
    expect(candidateCall?.[1]).toEqual([
      10,
      asOf.toISOString(),
      180,
      365,
      ['needs_review', 'under_review', 'escalated', 'pending_second_approval'],
    ]);
  });

  it('blocks explicit expiry and creates one actionable service-verification submission', async () => {
    const client = createClient({ candidates: [explicitExpiryCandidate()] });
    const result = await runResourceFreshnessScan(client, { asOf });

    expect(result).toMatchObject({
      checkedCount: 1,
      findingCount: 1,
      blockedCount: 1,
      expiredBlockedCount: 1,
      staleBlockedCount: 0,
      enqueuedCount: 1,
      linkedToExistingCount: 0,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    const holdCall = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE public.services')
      && sql.includes('integrity_hold_at = $1')
    ));
    expect(holdCall?.[1]?.[1]).toMatch(/^resource_freshness:explicit_expiry:/);
    expect(holdCall?.[1]?.[2]).toBe('system:resource-freshness-scan');

    const submissionCall = query.mock.calls.find(([sql]) => (
      typeof sql === 'string' && sql.includes('INSERT INTO public.submissions')
    ));
    expect(submissionCall?.[0]).toContain("'needs_review'");
    expect(submissionCall?.[1]?.[6]).toBe(100);
    expect(submissionCall?.[1]?.[4]).toContain('Correct the schedule before approving');

    const transitionCall = query.mock.calls.find(([sql]) => (
      typeof sql === 'string' && sql.includes('INSERT INTO public.submission_transitions')
    ));
    expect(transitionCall?.[0]).toContain("'submitted', 'needs_review'");
  });

  it('links an open verification instead of creating a duplicate submission', async () => {
    const existingSubmissionId = '30000000-0000-4000-8000-000000000001';
    const client = createClient({
      candidates: [explicitExpiryCandidate({
        signal_type: 'stale_source',
        freshness_threshold_days: 180,
        schedule_count: 0,
        dated_schedule_count: 0,
        max_valid_to: null,
        existing_submission_id: existingSubmissionId,
      })],
    });

    const result = await runResourceFreshnessScan(client, { asOf });
    expect(result).toMatchObject({
      enqueuedCount: 0,
      linkedToExistingCount: 1,
      staleBlockedCount: 1,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('INSERT INTO public.submissions')
    ))).toBe(false);
    const linkedCall = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE public.submissions')
      && sql.includes("'resourceFreshness'")
    ));
    expect(linkedCall?.[1]?.[3]).toBe(existingSubmissionId);
  });

  it('removes an uncommitted finding when a concurrent service change prevents the hold', async () => {
    const client = createClient({
      candidates: [explicitExpiryCandidate()],
      holdSucceeds: false,
    });
    const result = await runResourceFreshnessScan(client, { asOf });

    expect(result).toMatchObject({ findingCount: 0, blockedCount: 0, enqueuedCount: 0 });
    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string'
      && sql.includes('DELETE FROM oran_internal.resource_freshness_findings')
    ))).toBe(true);
  });
});
