import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  RESOURCE_FRESHNESS_OUTCOME_DECISION_MAP,
  resourceFreshnessOutcomeError,
  resourceFreshnessReviewPacketSchema,
  resourceFreshnessReviewSchema,
} from '@/domain/resourceFreshnessReview';
import {
  CANONICAL_STALE_AFTER_DAYS,
  RESOURCE_FRESHNESS_CANDIDATE_SQL,
  UNKNOWN_SOURCE_STALE_AFTER_DAYS,
  reconcileResourceFreshnessReview,
  runResourceFreshnessScan,
} from '../resourceFreshness';

type Candidate = {
  service_id: string;
  service_name: string;
  organization_id: string;
  signal_type: 'explicit_expiry' | 'reverification_due' | 'stale_source' | 'unknown_source';
  signal_observed_at: string | Date;
  freshness_threshold_days: number | null;
  service_updated_at: string | Date;
  last_source_refresh_at: string | Date | null;
  last_candidate_verified_at: string | Date | null;
  last_manual_verification_at: string | Date | null;
  jurisdiction_state: string | null;
  jurisdiction_county_state: string | null;
  jurisdiction_county: string | null;
  reverify_at: string | Date | null;
  schedule_count: number;
  dated_schedule_count: number;
  max_valid_to: string | Date | null;
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
    jurisdiction_state: 'CA',
    jurisdiction_county_state: 'CA',
    jurisdiction_county: 'Los Angeles',
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
  linkSucceeds?: boolean;
  reconciliationSubmissionIds?: string[];
  protectedServiceIds?: string[];
  protectedOpenCount?: number;
} = {}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('AS protected_count')) {
      return { rows: [{ protected_count: options.protectedOpenCount ?? 0 }] };
    }
    if (sql.includes('SELECT finding.submission_id')) {
      return {
        rows: (options.reconciliationSubmissionIds ?? []).map((submissionId) => ({
          submission_id: submissionId,
          service_id: '10000000-0000-4000-8000-000000000001',
        })),
      };
    }
    if (sql.includes('protected_authority')) {
      const requestedServiceIds = (params?.[1] as string[] | undefined) ?? [];
      return {
        rows: (options.protectedServiceIds ?? [])
          .filter((serviceId) => requestedServiceIds.includes(serviceId))
          .map((serviceId) => ({
            workflow: 'verified_hotline',
            entity_type: 'service',
            entity_id: serviceId,
          })),
      };
    }
    if (
      options.reconciliationSubmissionIds?.length
      && sql.includes('FOR UPDATE OF finding, sub, service')
    ) {
      return { rows: [reconciliationTarget()] };
    }
    if (sql === RESOURCE_FRESHNESS_CANDIDATE_SQL) {
      return { rows: options.candidates ?? [] };
    }
    if (sql.includes('INSERT INTO oran_internal.resource_freshness_findings')) {
      return { rows: [{ id: params?.[0] as string }] };
    }
    if (
      sql.includes('UPDATE oran_internal.resource_freshness_findings')
      && sql.includes('SET submission_id = $1')
      && sql.includes('RETURNING id')
    ) {
      return { rows: [{ id: params?.[1] as string }] };
    }
    if (sql.includes('UPDATE public.services') && sql.includes('integrity_hold_at = $1')) {
      return options.holdSucceeds === false
        ? { rows: [] }
        : { rows: [{ id: params?.[3] as string }] };
    }
    if (
      options.reconciliationSubmissionIds?.length
      && sql.includes('UPDATE public.services')
      && sql.includes('integrity_hold_at = NULL')
    ) {
      return { rows: [{ id: params?.[1] as string }] };
    }
    if (
      sql.includes('UPDATE public.submissions')
      && sql.includes("'resourceFreshness'")
      && sql.includes('RETURNING id')
    ) {
      return options.linkSucceeds === false
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
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "expired_location.status = 'active'",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "current_location.status = 'active'",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "location.status = 'active'",
    );
  });

  it('uses conservative freshness windows and the seeker publication provenance boundary', () => {
    expect(CANONICAL_STALE_AFTER_DAYS).toBe(180);
    expect(UNKNOWN_SOURCE_STALE_AFTER_DAYS).toBe(365);
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "publication_system.resource_purpose IN ('service_catalog', 'program_navigation')",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('canonical_provenance publication_provenance');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain("publication_record.processing_status = 'published'");
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "publication_submission.status IN ('approved', 'archived')",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('service.integrity_hold_at IS NULL');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain("open_finding.status = 'open'");
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('LIMIT greatest($1::int * 20, 100)');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      'public.submission_transitions approved_transition',
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "approved_transition.to_status = 'approved'",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).not.toContain('public.confidence_scores score');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('public.form_instances form_instance');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      'manual_verification.jurisdiction_county',
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('service_geography.jurisdiction_state');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('address.state_province');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).not.toContain(
      "service_area.extent_type = 'county'",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      'canonical_publication_authority AS NOT MATERIALIZED',
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "publication_provenance.decision_status = 'accepted'",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "publication_record.processing_status = 'published'",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('publication_feed.is_active IS TRUE');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain("publication_system.family <> 'manual'");
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "publication_system.trust_tier IN (",
    );
  });

  it('persists derived jurisdiction on scanner-created and linked review work', async () => {
    const client = createClient({ candidates: [explicitExpiryCandidate()] });

    await runResourceFreshnessScan(client, { asOf, limit: 1 });

    const insertCall = vi.mocked(client.query).mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO public.submissions'),
    );
    expect(String(insertCall?.[0])).toContain('jurisdiction_state, jurisdiction_county');
    expect(insertCall?.[1]).toEqual(expect.arrayContaining(['CA', 'Los Angeles']));

    const linkedClient = createClient({
      candidates: [explicitExpiryCandidate({
        existing_submission_id: '30000000-0000-4000-8000-000000000002',
      })],
    });
    await runResourceFreshnessScan(linkedClient, { asOf, limit: 1 });
    const updateCall = vi.mocked(linkedClient.query).mock.calls.find(
      ([sql]) => typeof sql === 'string'
        && sql.includes('UPDATE public.submissions')
        && sql.includes('jurisdiction_state = CASE'),
    );
    expect(String(updateCall?.[0])).toContain('jurisdiction_county = CASE');
    expect(updateCall?.[1]).toEqual(expect.arrayContaining(['CA', 'Los Angeles']));
  });

  it('never combines a state-only fallback with an unrelated county', async () => {
    const mixedSourceClient = createClient({
      candidates: [explicitExpiryCandidate({
        jurisdiction_state: 'CA',
        jurisdiction_county_state: 'WA',
        jurisdiction_county: 'King',
      })],
    });

    await runResourceFreshnessScan(mixedSourceClient, { asOf, limit: 1 });
    const insertCall = vi.mocked(mixedSourceClient.query).mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO public.submissions'),
    );
    expect(insertCall?.[1]?.[2]).toBe('WA');
    expect(insertCall?.[1]?.[3]).toBe('King');

    const stateOnlyClient = createClient({
      candidates: [explicitExpiryCandidate({
        jurisdiction_state: 'CA',
        jurisdiction_county_state: null,
        jurisdiction_county: 'King',
      })],
    });
    await runResourceFreshnessScan(stateOnlyClient, { asOf, limit: 1 });
    const stateOnlyInsert = vi.mocked(stateOnlyClient.query).mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO public.submissions'),
    );
    expect(stateOnlyInsert?.[1]?.[2]).toBe('CA');
    expect(stateOnlyInsert?.[1]?.[3]).toBeNull();

    const linkedClient = createClient({
      candidates: [explicitExpiryCandidate({
        existing_submission_id: '30000000-0000-4000-8000-000000000002',
        jurisdiction_state: 'CA',
        jurisdiction_county_state: 'WA',
        jurisdiction_county: 'King',
      })],
    });
    await runResourceFreshnessScan(linkedClient, { asOf, limit: 1 });
    const linkedUpdate = vi.mocked(linkedClient.query).mock.calls.find(
      ([sql]) => typeof sql === 'string'
        && sql.includes('UPDATE public.submissions')
        && sql.includes('jurisdiction_state = CASE'),
    );
    expect(String(linkedUpdate?.[0])).toContain(
      'upper(trim(jurisdiction_state)) = upper(trim($6::text))',
    );
    expect(linkedUpdate?.[1]).toEqual(expect.arrayContaining(['WA', 'King']));
  });

  it('applies publication eligibility before every bounded signal seed', () => {
    const eligibilityStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf(
      'eligible_published_services AS NOT MATERIALIZED',
    );
    const expiredRowsStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('expired_schedule_rows AS');
    const explicitStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('explicit_expiry AS');
    const reverifyStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('due_reverification AS');
    const staleStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('stale_canonical AS');
    const unknownStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('unknown_source AS');
    const seedsEnd = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('signal_seeds AS');

    expect(eligibilityStart).toBeGreaterThanOrEqual(0);
    expect(eligibilityStart).toBeLessThan(expiredRowsStart);

    const eligibility = RESOURCE_FRESHNESS_CANDIDATE_SQL.slice(
      eligibilityStart,
      expiredRowsStart,
    );
    expect(eligibility).toContain('service.integrity_hold_at IS NULL');
    expect(eligibility).toContain("organization.status = 'active'");
    expect(eligibility).toContain("service.name = 'SNAP/EBT accepted here'");
    expect(eligibility).toContain("open_finding.status = 'open'");

    const expiredRows = RESOURCE_FRESHNESS_CANDIDATE_SQL.slice(expiredRowsStart, explicitStart);
    expect(expiredRows.match(/JOIN eligible_published_services eligible_service/g)).toHaveLength(2);

    const reverify = RESOURCE_FRESHNESS_CANDIDATE_SQL.slice(reverifyStart, staleStart);
    expect(reverify.indexOf('JOIN eligible_published_services eligible_service'))
      .toBeLessThan(reverify.indexOf('LIMIT greatest($1::int * 20, 100)'));

    const stale = RESOURCE_FRESHNESS_CANDIDATE_SQL.slice(staleStart, unknownStart);
    expect(stale.indexOf('JOIN eligible_published_services eligible_service'))
      .toBeLessThan(stale.indexOf('LIMIT greatest($1::int * 20, 100)'));

    const unknown = RESOURCE_FRESHNESS_CANDIDATE_SQL.slice(unknownStart, seedsEnd);
    expect(unknown.indexOf('FROM eligible_published_services s'))
      .toBeLessThan(unknown.indexOf('LIMIT greatest($1::int * 20, 100)'));
    expect(unknown).toContain('FROM canonical_publication_authority canonical_authority');
    expect(unknown).toContain('canonical_authority.service_id = s.id');
  });

  it('keeps archived submissions with a passed approval in manual freshness evidence', () => {
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "approved_submission.status IN ('approved', 'archived')",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "approved_transition.to_status = 'approved'",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      'approved_transition.gates_passed = true',
    );
  });

  it('derives freshness only from immutable, exactly bound verification events', () => {
    const candidateStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf(
      'durable_candidate_verifications AS NOT MATERIALIZED',
    );
    const manualStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf(
      'durable_manual_verifications AS NOT MATERIALIZED',
    );
    const expiryStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('expired_schedule_rows AS');
    const latestStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf(
      'latest_service_verifications AS',
    );
    const dueStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('due_reverification AS');
    const staleStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('stale_canonical AS');

    const candidateEvidence = RESOURCE_FRESHNESS_CANDIDATE_SQL.slice(candidateStart, manualStart);
    const manualEvidence = RESOURCE_FRESHNESS_CANDIDATE_SQL.slice(manualStart, expiryStart);
    const latestWindow = RESOURCE_FRESHNESS_CANDIDATE_SQL.slice(latestStart, dueStart);
    const dueWindow = RESOURCE_FRESHNESS_CANDIDATE_SQL.slice(dueStart, staleStart);

    expect(candidateEvidence).toContain('public.lifecycle_events verification_event');
    expect(candidateEvidence).toContain('public.hsds_export_snapshots publication_snapshot');
    expect(candidateEvidence).toContain('publication_snapshot.generated_at = verification_event.created_at');
    expect(candidateEvidence).toContain("publication_snapshot.status = 'current'");
    expect(candidateEvidence).toContain("incomingAuthority' = 'candidate_allowlisted'");
    expect(candidateEvidence).toContain("overwriteSuppressed' = 'false'");

    expect(manualEvidence).toContain("verificationApplied' = 'true'");
    expect(manualEvidence).toContain("approvalTransitionId'");
    expect(manualEvidence).toContain("projectionApprovalTransitionId'");
    expect(manualEvidence).toContain("projectionSourceRecordId'");
    expect(manualEvidence).toContain("projection_record.processing_status = 'published'");
    expect(manualEvidence).toContain("publication_snapshot.status = 'current'");
    expect(manualEvidence).toContain("{meta,sourceSubmissionId}");
    expect(manualEvidence).toContain(
      'approved_transition.actor_user_id = verification_event.actor_id',
    );

    expect(latestWindow).toContain('DISTINCT ON (verification_window.service_id)');
    expect(latestWindow).toContain('verification_window.verified_at DESC');
    expect(dueWindow).toContain('FROM latest_service_verifications verification_window');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).not.toContain('FROM public.extracted_candidates');
  });

  it('uses an immutable publication or verification clock for unknown-source age', () => {
    const unknownStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('unknown_source AS');
    const seedsStart = RESOURCE_FRESHNESS_CANDIDATE_SQL.indexOf('signal_seeds AS');
    const unknownSource = RESOURCE_FRESHNESS_CANDIDATE_SQL.slice(unknownStart, seedsStart);

    expect(unknownSource).toContain(
      'greatest(s.created_at, latest_verification.verified_at)',
    );
    expect(unknownSource).toContain('LEFT JOIN latest_service_verifications');
    expect(unknownSource).not.toContain('s.updated_at <=');
  });

  it('uses weighted fair ordering so lower-priority signal lanes cannot starve', () => {
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('fair_signals AS');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      'PARTITION BY detail.signal_type',
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      "WHEN 'explicit_expiry' THEN 2",
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      '((detail.signal_rank - 1) / detail.signal_weight)',
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('FROM fair_signals detail');
  });
});

describe('resource freshness review contract', () => {
  it('requires structured evidence while keeping contact details out of the packet', () => {
    const valid = {
      schemaVersion: 1,
      outcome: 'confirmed_current',
      verificationMethod: 'provider_phone',
      checkedAt: '2026-07-13T12:00:00.000Z',
      contactChannel: 'phone',
      reviewerSummary: 'Provider confirmed the service details and current availability.',
    };

    expect(resourceFreshnessReviewSchema.safeParse(valid).success).toBe(true);
    expect(resourceFreshnessReviewSchema.safeParse({
      ...valid,
      contactDetails: '+1-555-0100',
    }).success).toBe(false);
    expect(resourceFreshnessReviewSchema.safeParse({
      ...valid,
      contactChannel: undefined,
    }).success).toBe(false);
    expect(() => resourceFreshnessReviewSchema.safeParse({
      ...valid,
      evidenceUrl: 'not a URL',
    })).not.toThrow();
    expect(resourceFreshnessReviewSchema.safeParse({
      ...valid,
      evidenceUrl: 'not a URL',
    }).success).toBe(false);
  });

  it('maps every structured outcome to one deterministic workflow decision', () => {
    expect(RESOURCE_FRESHNESS_OUTCOME_DECISION_MAP).toEqual({
      confirmed_current: 'approved',
      corrected: 'approved',
      confirmed_unavailable: 'denied',
      unable_to_verify: 'escalated',
    });
  });

  it('rejects evidence that predates the finding and duplicate schedule corrections', () => {
    const findingId = '40000000-0000-4000-8000-000000000001';
    const holdReason = `resource_freshness:explicit_expiry:${findingId}`;
    const packet = resourceFreshnessReviewPacketSchema.parse(
      structuredPacket('explicit_expiry', findingId, holdReason),
    );
    const predatingReview = resourceFreshnessReviewSchema.parse({
      ...structuredReview('corrected'),
      checkedAt: '2026-07-13T11:59:59.000Z',
    });
    expect(resourceFreshnessOutcomeError(packet, predatingReview)).toContain(
      'on or after this freshness finding was detected',
    );

    const scheduleId = '50000000-0000-4000-8000-000000000001';
    expect(resourceFreshnessReviewSchema.safeParse({
      ...structuredReview('corrected'),
      scheduleCorrections: [
        { scheduleId, validFrom: null, validTo: null },
        { scheduleId, validFrom: null, validTo: '2027-01-01' },
      ],
    }).success).toBe(false);
  });

  it('binds the scanner packet action and hold to its exact signal and finding', () => {
    const findingId = '40000000-0000-4000-8000-000000000001';
    const holdReason = `resource_freshness:stale_source:${findingId}`;
    const packet = structuredPacket('stale_source', findingId, holdReason);

    expect(resourceFreshnessReviewPacketSchema.safeParse({
      ...packet,
      requiredAction: 'reverify_service_availability',
    }).success).toBe(false);
    expect(resourceFreshnessReviewPacketSchema.safeParse({
      ...packet,
      hold: {
        ...packet.hold,
        reason: `resource_freshness:stale_source:50000000-0000-4000-8000-000000000001`,
      },
    }).success).toBe(false);
  });
});

describe('runResourceFreshnessScan', () => {
  it('takes the shared scanner lock and returns no work when no candidate is due', async () => {
    const client = createClient();
    const result = await runResourceFreshnessScan(client, { asOf, limit: 10 });

    expect(result).toEqual({
      checkedCount: 0,
      findingCount: 0,
      blockedCount: 0,
      expiredBlockedCount: 0,
      staleBlockedCount: 0,
      reverificationDueBlockedCount: 0,
      staleSourceBlockedCount: 0,
      unknownSourceBlockedCount: 0,
      protectedAuthoritySkippedCount: 0,
      enqueuedCount: 0,
      linkedToExistingCount: 0,
      resolvedCount: 0,
      confirmedUnavailableCount: 0,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls[0]?.[0]).toContain('oran:live-publication-merge');
    expect(query.mock.calls[1]?.[0]).toContain('oran:resource-freshness-scan');
    expect(query.mock.calls[2]?.[0]).toContain(
      'oran:authority:verified-national-hotlines',
    );
    expect(query.mock.calls[3]?.[0]).toContain(
      'oran:quarantine:usda-fns-snap-retailer',
    );
    const catchUpCall = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('FROM oran_internal.resource_freshness_findings finding')
      && sql.includes("? 'resourceFreshnessReview'")
    ));
    expect(catchUpCall?.[0]).toContain("sub.status = 'approved'");
    expect(catchUpCall?.[0]).toContain("sub.status = 'denied'");
    expect(catchUpCall?.[0]).toContain("sub.status = 'archived'");
    expect(catchUpCall?.[0]).not.toContain("sub.status = 'escalated'");
    expect(catchUpCall?.[0]).toContain('oran_internal.hotline_authority_members');
    expect(catchUpCall?.[0]).toContain('oran_internal.resource_quarantine_members');
    expect(catchUpCall?.[0]).toContain('LIMIT $1');
    expect(catchUpCall?.[1]).toEqual([10]);
    const candidateCall = query.mock.calls.find(([sql]) => sql === RESOURCE_FRESHNESS_CANDIDATE_SQL);
    expect(candidateCall?.[1]).toEqual([
      10,
      asOf.toISOString(),
      180,
      365,
      ['needs_review'],
    ]);
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      'sub.assigned_to_user_id IS NULL',
    );
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('sub.is_locked = false');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain('sub.locked_at IS NULL');
    expect(RESOURCE_FRESHNESS_CANDIDATE_SQL).toContain(
      'sub.locked_by_user_id IS NULL',
    );
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
    expect(submissionCall?.[1]?.[8]).toBe(100);
    expect(submissionCall?.[1]?.[6]).toContain('Correct the schedule before approving');
    const payload = JSON.parse(String(submissionCall?.[1]?.[7])) as Record<string, unknown>;
    const packet = resourceFreshnessReviewPacketSchema.parse(payload.resourceFreshness);
    expect(packet).toMatchObject({
      schemaVersion: 1,
      signal: 'explicit_expiry',
      requiredAction: 'correct_expired_schedule',
      hold: { actor: 'system:resource-freshness-scan' },
      observed: {
        schedule: { totalCount: 2, datedCount: 2, maxValidTo: '2026-07-01' },
      },
      reviewRequirements: {
        evidenceRequired: true,
        scheduleCorrectionRequiredBeforeApproval: true,
      },
    });

    const transitionCall = query.mock.calls.find(([sql]) => (
      typeof sql === 'string' && sql.includes('INSERT INTO public.submission_transitions')
    ));
    expect(transitionCall?.[0]).toContain("'submitted', 'needs_review'");
  });

  it('shares one bounded service budget between catch-up and new discovery', async () => {
    const client = createClient({
      candidates: [explicitExpiryCandidate()],
      reconciliationSubmissionIds: ['30000000-0000-4000-8000-000000000099'],
    });

    const result = await runResourceFreshnessScan(client, { asOf, limit: 1 });

    expect(result).toMatchObject({
      checkedCount: 1,
      resolvedCount: 1,
      findingCount: 0,
      enqueuedCount: 0,
    });
    expect(vi.mocked(client.query).mock.calls.some(
      ([sql]) => sql === RESOURCE_FRESHNESS_CANDIDATE_SQL,
    )).toBe(false);
  });

  it('never auto-holds or routes a protected authority resource', async () => {
    const candidate = explicitExpiryCandidate();
    const client = createClient({
      candidates: [candidate],
      protectedServiceIds: [candidate.service_id],
    });

    const result = await runResourceFreshnessScan(client, { asOf, limit: 10 });

    expect(result).toMatchObject({
      checkedCount: 1,
      protectedAuthoritySkippedCount: 1,
      findingCount: 0,
      blockedCount: 0,
      enqueuedCount: 0,
    });
    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE public.services')
      && sql.includes('integrity_hold_at = $1')
    ))).toBe(false);
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('INSERT INTO public.submissions')
    ))).toBe(false);
  });

  it('reports protected open work without letting it consume discovery budget', async () => {
    const client = createClient({
      candidates: [explicitExpiryCandidate()],
      protectedOpenCount: 3,
    });

    const result = await runResourceFreshnessScan(client, { asOf, limit: 1 });

    expect(result).toMatchObject({
      checkedCount: 1,
      protectedAuthoritySkippedCount: 3,
      findingCount: 1,
    });
    const candidateCall = vi.mocked(client.query).mock.calls.find(
      ([sql]) => sql === RESOURCE_FRESHNESS_CANDIDATE_SQL,
    );
    expect(candidateCall?.[1]?.[0]).toBe(1);
  });

  it('normalizes node-postgres Date objects before building the review packet', async () => {
    const postgresDate = new Date(2026, 6, 1);
    const client = createClient({
      candidates: [explicitExpiryCandidate({
        signal_observed_at: new Date('2026-07-01T00:00:00.000Z'),
        service_updated_at: new Date('2026-06-01T00:00:00.000Z'),
        last_source_refresh_at: new Date('2026-06-02T03:04:05.000Z'),
        last_candidate_verified_at: new Date('2026-06-03T03:04:05.000Z'),
        last_manual_verification_at: new Date('2026-06-04T03:04:05.000Z'),
        reverify_at: new Date('2026-07-10T03:04:05.000Z'),
        max_valid_to: postgresDate,
      })],
    });

    await runResourceFreshnessScan(client, { asOf });

    const query = client.query as ReturnType<typeof vi.fn>;
    const submissionCall = query.mock.calls.find(([sql]) => (
      typeof sql === 'string' && sql.includes('INSERT INTO public.submissions')
    ));
    const payload = JSON.parse(String(submissionCall?.[1]?.[7])) as Record<string, unknown>;
    const packet = resourceFreshnessReviewPacketSchema.parse(payload.resourceFreshness);

    expect(packet.observed).toMatchObject({
      signalObservedAt: '2026-07-01T00:00:00.000Z',
      serviceUpdatedAt: '2026-06-01T00:00:00.000Z',
      lastSourceRefreshAt: '2026-06-02T03:04:05.000Z',
      lastCandidateVerifiedAt: '2026-06-03T03:04:05.000Z',
      lastManualVerificationAt: '2026-06-04T03:04:05.000Z',
      reverifyAt: '2026-07-10T03:04:05.000Z',
      schedule: { maxValidTo: '2026-07-01' },
    });
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
    expect(linkedCall?.[0]).toContain('status = ANY($5::text[])');
    expect(linkedCall?.[1]?.[4]).toEqual(['needs_review']);
    expect(linkedCall?.[0]).toContain('assigned_to_user_id IS NULL');
    expect(linkedCall?.[0]).toContain('is_locked = false');
    expect(linkedCall?.[0]).toContain('locked_at IS NULL');
    expect(linkedCall?.[0]).toContain('locked_by_user_id IS NULL');
    expect(linkedCall?.[0]).toContain("'changeType', 'requestedChanges', 'resourceFreshness'");
    expect(linkedCall?.[0]).toContain("'variant', 'channel'");
    expect(linkedCall?.[0]).toContain('public.form_instances form_instance');
  });

  it('creates dedicated scanner work when an existing verification cannot be safely linked', async () => {
    const client = createClient({
      candidates: [explicitExpiryCandidate({
        signal_type: 'stale_source',
        freshness_threshold_days: 180,
        schedule_count: 0,
        dated_schedule_count: 0,
        max_valid_to: null,
        existing_submission_id: '30000000-0000-4000-8000-000000000002',
      })],
      linkSucceeds: false,
    });

    const result = await runResourceFreshnessScan(client, { asOf });
    expect(result).toMatchObject({ enqueuedCount: 1, linkedToExistingCount: 0 });
    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('INSERT INTO public.submissions')
    ))).toBe(true);
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

function structuredReview(
  outcome: 'confirmed_current' | 'corrected' | 'confirmed_unavailable' | 'unable_to_verify',
) {
  return {
    schemaVersion: 1,
    outcome,
    verificationMethod: 'provider_website',
    checkedAt: '2026-07-13T12:00:00.000Z',
    evidenceUrl: 'https://provider.example/services/current',
    reviewerSummary: 'The provider publication was checked against the current service record.',
  };
}

function structuredPacket(
  signal: 'explicit_expiry' | 'reverification_due' | 'stale_source',
  findingId: string,
  holdReason: string,
) {
  const explicit = signal === 'explicit_expiry';
  const requiredAction = signal === 'explicit_expiry'
    ? 'correct_expired_schedule'
    : signal === 'reverification_due'
      ? 'reverify_service_availability'
      : 'refresh_authoritative_source';
  return {
    schemaVersion: 1,
    findingId,
    signal,
    requiredAction,
    hold: {
      actor: 'system:resource-freshness-scan',
      reason: holdReason,
    },
    observed: {
      detectedAsOf: '2026-07-13T12:00:00.000Z',
      signalObservedAt: '2026-07-01T00:00:00.000Z',
      freshnessThresholdDays: explicit || signal === 'reverification_due' ? null : 180,
      serviceUpdatedAt: '2026-06-01T00:00:00.000Z',
      lastSourceRefreshAt: '2026-06-01T00:00:00.000Z',
      lastCandidateVerifiedAt: null,
      lastManualVerificationAt: null,
      reverifyAt: signal === 'reverification_due' ? '2026-07-01T00:00:00.000Z' : null,
      schedule: explicit
        ? { totalCount: 1, datedCount: 1, maxValidTo: '2026-07-01' }
        : { totalCount: 0, datedCount: 0, maxValidTo: null },
    },
    reviewRequirements: {
      evidenceRequired: true,
      scheduleCorrectionRequiredBeforeApproval: explicit,
    },
  };
}

function reconciliationTarget(overrides: Record<string, unknown> = {}) {
  const findingId = '40000000-0000-4000-8000-000000000001';
  const signal = (overrides.signal_type ?? 'stale_source') as
    'explicit_expiry' | 'reverification_due' | 'stale_source';
  const holdReason = `resource_freshness:${signal}:${findingId}`;
  return {
    finding_id: findingId,
    service_id: '10000000-0000-4000-8000-000000000001',
    signal_type: signal,
    hold_reason: holdReason,
    submission_status: 'approved',
    payload: {
      resourceFreshness: structuredPacket(signal, findingId, holdReason),
      resourceFreshnessReview: structuredReview('confirmed_current'),
    },
    service_status: 'active',
    integrity_hold_at: '2026-07-13T12:00:00.000Z',
    integrity_hold_reason: holdReason,
    integrity_held_by_user_id: 'system:resource-freshness-scan',
    still_expired: false,
    has_approved_transition: true,
    has_denied_transition: false,
    has_escalated_transition: false,
    first_destructive_transition_id: null,
    first_destructive_actor_user_id: null,
    approved_transition_id: '60000000-0000-4000-8000-000000000001',
    denied_transition_id: null,
    approved_actor_user_id: 'community-reviewer-1',
    denied_actor_user_id: 'community-reviewer-1',
    ...overrides,
  };
}

function storedDestructiveReview(
  reviewerUserId: string,
  recordedAt: string,
  transitionId: string,
) {
  return {
    transitionId,
    reviewerUserId,
    recordedAt,
    review: structuredReview('confirmed_unavailable'),
  };
}

function createReconciliationClient(
  target: Record<string, unknown>,
  clearSucceeds = true,
  protectedWorkflow: 'verified_hotline' | 'resource_quarantine' | null = null,
) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('protected_authority')) {
      return protectedWorkflow
        ? {
            rows: [{
              workflow: protectedWorkflow,
              entity_type: 'service',
              entity_id: target.service_id,
            }],
          }
        : { rows: [] };
    }
    if (sql.includes('FOR UPDATE OF finding, sub, service')) {
      return { rows: [target] };
    }
    if (sql.includes('UPDATE public.services') && sql.includes('integrity_hold_at = NULL')) {
      return { rows: clearSucceeds ? [{ id: target.service_id }] : [] };
    }
    if (sql.includes('UPDATE public.services') && sql.includes('integrity_hold_at = now()')) {
      return { rows: [{ id: target.service_id }] };
    }
    if (sql.includes('FROM public.schedules schedule') && sql.includes('schedule.service_id = $1')) {
      return target.still_expired
        ? {
            rows: [{
              id: '50000000-0000-4000-8000-000000000001',
              service_id: target.service_id,
              location_id: null,
              valid_from: '2026-01-01',
              valid_to: (target.schedule_valid_to as string | undefined) ?? '2026-07-01',
              current_date: (target.current_date as string | undefined) ?? '2026-07-13',
            }],
          }
        : { rows: [] };
    }
    if (sql.includes('JOIN public.service_at_location sal')) return { rows: [] };
    if (sql.includes('UPDATE public.schedules') && sql.includes('RETURNING id')) {
      return { rows: [{ id: params?.[3] }] };
    }
    return { rows: [] };
  });
  return { query } as unknown as PoolClient;
}

describe('reconcileResourceFreshnessReview', () => {
  it('immediately compare-clears only the exact scanner-owned hold', async () => {
    const target = reconciliationTarget();
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-1')).resolves.toEqual({
      state: 'hold_cleared',
      findingId: target.finding_id,
      holdCleared: true,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls[0]?.[0]).toContain('oran:live-publication-merge');
    expect(query.mock.calls[1]?.[0]).toContain('oran:resource-freshness-scan');
    expect(query.mock.calls[2]?.[0]).toContain(
      'oran:authority:verified-national-hotlines',
    );
    expect(query.mock.calls[3]?.[0]).toContain(
      'oran:quarantine:usda-fns-snap-retailer',
    );
    expect(query.mock.calls[4]?.[0]).toContain('sub.service_id = finding.service_id');
    const clear = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE public.services')
      && sql.includes('integrity_hold_at = NULL')
    ));
    expect(clear?.[0]).toContain('integrity_hold_reason = $3');
    expect(clear?.[0]).toContain('integrity_held_by_user_id = $1');
    expect(clear?.[1]).toEqual([
      'system:resource-freshness-scan',
      target.service_id,
      target.hold_reason,
    ]);
  });

  it('resolves scanner work without clearing a replacement manual hold', async () => {
    const target = reconciliationTarget({
      integrity_hold_reason: 'admin_report:confirmed-risk',
      integrity_held_by_user_id: 'oran-admin-1',
    });
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-2')).resolves.toEqual({
      state: 'non_scanner_hold_retained',
      findingId: target.finding_id,
      holdCleared: false,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE public.services')
      && sql.includes('integrity_hold_at = NULL')
    ))).toBe(false);
    const findingUpdate = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE oran_internal.resource_freshness_findings')
      && sql.includes("status = 'resolved'")
    ));
    expect(findingUpdate?.[1]?.[1]).toContain('non_scanner_hold_retained');
  });

  it('recovers a missing active-service hold before approved compare-clear', async () => {
    const target = reconciliationTarget({
      integrity_hold_at: null,
      integrity_hold_reason: null,
      integrity_held_by_user_id: null,
    });
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-drift')).resolves.toEqual({
      state: 'hold_cleared',
      findingId: target.finding_id,
      holdCleared: true,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    const recovered = query.mock.calls.find(([sql]) => (
      typeof sql === 'string' && sql.includes('integrity_hold_at = now()')
    ));
    expect(recovered?.[0]).toContain("status = 'active'");
    expect(recovered?.[0]).toContain('integrity_hold_at IS NULL');
    expect(recovered?.[1]).toEqual([
      target.hold_reason,
      'system:resource-freshness-scan',
      target.service_id,
    ]);
    const findingUpdate = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE oran_internal.resource_freshness_findings')
      && sql.includes("status = 'resolved'")
    ));
    expect(findingUpdate?.[1]?.[1]).toContain(
      'missing_scanner_hold_recovered_and_cleared',
    );
  });

  it('makes a partial alternate hold effective without erasing its metadata', async () => {
    const target = reconciliationTarget({
      integrity_hold_at: null,
      integrity_hold_reason: 'admin_report:pending-investigation',
      integrity_held_by_user_id: null,
    });
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-partial-hold')).resolves.toEqual({
      state: 'non_scanner_hold_retained',
      findingId: target.finding_id,
      holdCleared: false,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    const recovered = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('SET integrity_hold_at = now(),')
      && sql.includes('updated_at = now()')
      && !sql.includes('integrity_hold_reason = $1')
    ));
    expect(recovered?.[1]).toEqual([target.service_id]);
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('integrity_hold_at = NULL')
    ))).toBe(false);
    const findingUpdate = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE oran_internal.resource_freshness_findings')
      && sql.includes("status = 'resolved'")
    ));
    expect(findingUpdate?.[1]?.[1]).toContain(
      'partial_alternate_hold_recovered_and_retained',
    );
  });

  it('keeps explicit-expiry work and its hold open until schedules are corrected', async () => {
    const findingId = '40000000-0000-4000-8000-000000000001';
    const holdReason = `resource_freshness:explicit_expiry:${findingId}`;
    const target = reconciliationTarget({
      signal_type: 'explicit_expiry',
      payload: {
        resourceFreshness: structuredPacket('explicit_expiry', findingId, holdReason),
        resourceFreshnessReview: structuredReview('corrected'),
      },
      still_expired: true,
    });
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-3')).resolves.toEqual({
      state: 'awaiting_schedule_correction',
      findingId: target.finding_id,
      holdCleared: false,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('UPDATE public.services')
    ))).toBe(false);
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('UPDATE oran_internal.resource_freshness_findings')
    ))).toBe(false);
  });

  it('applies typed direct-schedule corrections before clearing an explicit-expiry hold', async () => {
    const findingId = '40000000-0000-4000-8000-000000000001';
    const holdReason = `resource_freshness:explicit_expiry:${findingId}`;
    const scheduleId = '50000000-0000-4000-8000-000000000001';
    const target = reconciliationTarget({
      signal_type: 'explicit_expiry',
      payload: {
        resourceFreshness: structuredPacket('explicit_expiry', findingId, holdReason),
        resourceFreshnessReview: {
          ...structuredReview('corrected'),
          scheduleCorrections: [{
            scheduleId,
            validFrom: '2026-01-01',
            validTo: null,
          }],
        },
      },
      still_expired: true,
    });
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-3b')).resolves.toEqual({
      state: 'hold_cleared',
      findingId,
      holdCleared: true,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    const scheduleUpdate = query.mock.calls.find(([sql]) => (
      typeof sql === 'string' && sql.includes('UPDATE public.schedules')
    ));
    expect(scheduleUpdate?.[1]).toEqual([
      '2026-01-01',
      null,
      'community-reviewer-1',
      scheduleId,
      target.service_id,
    ]);
  });

  it('does not partially write a correction that expired while catch-up was pending', async () => {
    const findingId = '40000000-0000-4000-8000-000000000001';
    const holdReason = `resource_freshness:explicit_expiry:${findingId}`;
    const scheduleId = '50000000-0000-4000-8000-000000000001';
    const target = reconciliationTarget({
      signal_type: 'explicit_expiry',
      payload: {
        resourceFreshness: structuredPacket('explicit_expiry', findingId, holdReason),
        resourceFreshnessReview: {
          ...structuredReview('corrected'),
          scheduleCorrections: [{
            scheduleId,
            validFrom: '2026-01-01',
            validTo: '2026-07-14',
          }],
        },
      },
      still_expired: true,
      schedule_valid_to: '2026-07-01',
      current_date: '2026-07-15',
    });
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-3c')).resolves.toEqual({
      state: 'awaiting_schedule_correction',
      findingId,
      holdCleared: false,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('UPDATE public.schedules')
    ))).toBe(false);
  });

  it('records a durable service-level lifecycle window without rewriting candidate provenance', async () => {
    const findingId = '40000000-0000-4000-8000-000000000001';
    const holdReason = `resource_freshness:reverification_due:${findingId}`;
    const target = reconciliationTarget({
      signal_type: 'reverification_due',
      payload: {
        resourceFreshness: structuredPacket('reverification_due', findingId, holdReason),
        resourceFreshnessReview: structuredReview('confirmed_current'),
      },
    });
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-reverify')).resolves.toEqual({
      state: 'hold_cleared',
      findingId,
      holdCleared: true,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    const candidateMutation = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE public.extracted_candidates')
    ));
    expect(candidateMutation).toBeUndefined();
    const lifecycleEvent = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('INSERT INTO lifecycle_events')
    ));
    expect(lifecycleEvent?.[1]?.[0]).toBe('service');
    expect(lifecycleEvent?.[1]?.[1]).toBe(target.service_id);
    expect(lifecycleEvent?.[1]?.[2]).toBe('verified');
    expect(lifecycleEvent?.[1]?.[6]).toBe('community-reviewer-1');
    expect(lifecycleEvent?.[1]?.[7]).toContain(
      '"approvalTransitionId":"60000000-0000-4000-8000-000000000001"',
    );
    expect(lifecycleEvent?.[1]?.[7]).toContain('"verificationApplied":true');
  });

  it('moves a confirmed-unavailable service to a reversible inactive state', async () => {
    const findingId = '40000000-0000-4000-8000-000000000001';
    const holdReason = `resource_freshness:stale_source:${findingId}`;
    const target = reconciliationTarget({
      submission_status: 'denied',
      payload: {
        resourceFreshness: structuredPacket('stale_source', findingId, holdReason),
        resourceFreshnessReview: structuredReview('confirmed_unavailable'),
        resourceFreshnessFirstReview: storedDestructiveReview(
          'community-reviewer-1',
          '2026-07-13T12:10:00.000Z',
          '60000000-0000-4000-8000-000000000002',
        ),
        resourceFreshnessSecondReview: storedDestructiveReview(
          'community-reviewer-2',
          '2026-07-13T12:20:00.000Z',
          '60000000-0000-4000-8000-000000000003',
        ),
      },
      has_approved_transition: false,
      has_denied_transition: true,
      first_destructive_transition_id: '60000000-0000-4000-8000-000000000002',
      first_destructive_actor_user_id: 'community-reviewer-1',
      denied_transition_id: '60000000-0000-4000-8000-000000000003',
      denied_actor_user_id: 'community-reviewer-2',
    });
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-4')).resolves.toEqual({
      state: 'confirmed_unavailable',
      findingId: target.finding_id,
      holdCleared: true,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    const serviceUpdate = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE public.services')
      && sql.includes("status = CASE WHEN status = 'active' THEN 'inactive'")
    ));
    expect(serviceUpdate?.[0]).toContain('integrity_hold_at = NULL');
    expect(serviceUpdate?.[0]).toContain("status <> 'defunct'");
    expect(serviceUpdate?.[1]).toEqual([
      'community-reviewer-2',
      target.service_id,
      target.hold_reason,
      'system:resource-freshness-scan',
    ]);
    const lifecycleEvent = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes('INSERT INTO public.lifecycle_events')
      && sql.includes("'verification_lost'")
    ));
    expect(lifecycleEvent?.[1]?.[0]).toBe(target.service_id);
    const findingUpdate = query.mock.calls.find(([sql]) => (
      typeof sql === 'string'
      && sql.includes("status = 'confirmed_unavailable'")
    ));
    expect(findingUpdate?.[1]?.[1]).toContain(
      'service_inactive_scanner_hold_cleared',
    );
  });

  it('never rewrites a defunct service while closing unavailable audit work', async () => {
    const target = reconciliationTarget({
      submission_status: 'denied',
      service_status: 'defunct',
      payload: {
        resourceFreshness: structuredPacket(
          'stale_source',
          '40000000-0000-4000-8000-000000000001',
          'resource_freshness:stale_source:40000000-0000-4000-8000-000000000001',
        ),
        resourceFreshnessReview: structuredReview('confirmed_unavailable'),
        resourceFreshnessFirstReview: storedDestructiveReview(
          'community-reviewer-1',
          '2026-07-13T12:10:00.000Z',
          '60000000-0000-4000-8000-000000000002',
        ),
        resourceFreshnessSecondReview: storedDestructiveReview(
          'community-reviewer-2',
          '2026-07-13T12:20:00.000Z',
          '60000000-0000-4000-8000-000000000003',
        ),
      },
      has_approved_transition: false,
      has_denied_transition: true,
      first_destructive_transition_id: '60000000-0000-4000-8000-000000000002',
      first_destructive_actor_user_id: 'community-reviewer-1',
      denied_transition_id: '60000000-0000-4000-8000-000000000003',
      denied_actor_user_id: 'community-reviewer-2',
    });
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-defunct')).resolves.toEqual({
      state: 'confirmed_unavailable',
      findingId: target.finding_id,
      holdCleared: false,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('UPDATE public.services')
    ))).toBe(false);
    const findingUpdate = query.mock.calls.find(([sql]) => (
      typeof sql === 'string' && sql.includes("status = 'confirmed_unavailable'")
    ));
    expect(findingUpdate?.[1]?.[1]).toContain('service_already_defunct');
  });

  it('rejects destructive evidence that is not bound to the exact two transitions', async () => {
    const findingId = '40000000-0000-4000-8000-000000000001';
    const holdReason = `resource_freshness:stale_source:${findingId}`;
    const target = reconciliationTarget({
      submission_status: 'denied',
      payload: {
        resourceFreshness: structuredPacket('stale_source', findingId, holdReason),
        resourceFreshnessReview: structuredReview('confirmed_unavailable'),
        resourceFreshnessFirstReview: storedDestructiveReview(
          'community-reviewer-1',
          '2026-07-13T12:10:00.000Z',
          'forged-first-transition',
        ),
        resourceFreshnessSecondReview: storedDestructiveReview(
          'community-reviewer-2',
          '2026-07-13T12:20:00.000Z',
          '60000000-0000-4000-8000-000000000003',
        ),
      },
      has_approved_transition: false,
      has_denied_transition: true,
      first_destructive_transition_id: '60000000-0000-4000-8000-000000000002',
      first_destructive_actor_user_id: 'community-reviewer-1',
      denied_transition_id: '60000000-0000-4000-8000-000000000003',
      denied_actor_user_id: 'community-reviewer-2',
    });
    const client = createReconciliationClient(target);

    await expect(
      reconcileResourceFreshnessReview(client, 'submission-forged-transition'),
    ).resolves.toEqual({
      state: 'awaiting_workflow',
      findingId,
      holdCleared: false,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('UPDATE public.services')
    ))).toBe(false);
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE oran_internal.resource_freshness_findings')
    ))).toBe(false);
  });

  it('refuses to reconcile work after its service enters protected authority', async () => {
    const target = reconciliationTarget();
    const client = createReconciliationClient(target, true, 'verified_hotline');

    await expect(
      reconcileResourceFreshnessReview(client, 'submission-protected'),
    ).rejects.toThrow('controlled by an active verified-hotline authority');

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('integrity_hold_at = NULL')
    ))).toBe(false);
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE oran_internal.resource_freshness_findings')
    ))).toBe(false);
  });

  it('does not treat a generic denial without structured evidence as unavailable', async () => {
    const target = reconciliationTarget({
      submission_status: 'denied',
      payload: {},
      has_approved_transition: false,
      has_denied_transition: true,
    });
    const client = createReconciliationClient(target);

    await expect(reconcileResourceFreshnessReview(client, 'submission-5')).resolves.toEqual({
      state: 'awaiting_workflow',
      findingId: target.finding_id,
      holdCleared: false,
    });

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string' && sql.includes('UPDATE public.services')
    ))).toBe(false);
    expect(query.mock.calls.some(([sql]) => (
      typeof sql === 'string'
      && sql.includes('UPDATE oran_internal.resource_freshness_findings')
    ))).toBe(false);
  });
});
