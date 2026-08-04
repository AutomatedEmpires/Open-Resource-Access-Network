import { beforeEach, describe, expect, it, vi } from 'vitest';

const withTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  withTransaction: withTransactionMock,
}));

async function loadModule() {
  return import('../livePublish');
}

function buildCandidateHint() {
  return {
    extractionId: 'extract-1',
    candidateId: 'cand-1',
    extractKeySha256: 'a'.repeat(64),
    extractedAt: '2026-07-14T19:00:00.000Z',
    updatedAt: '2026-07-14T20:00:00.000Z',
    lineageRootCandidateId: 'cand-1',
    revisionNumber: 1,
    review: { status: 'verified' },
    investigation: {
      canonicalUrl: 'https://example.gov/pantry',
      discoveredLinks: [],
      importantArtifacts: [],
    },
    fields: {
      organizationName: 'Example Community Action',
      serviceName: 'Pantry Program',
      description: 'Emergency pantry support.',
      websiteUrl: 'https://example.gov/pantry',
      phone: '(206) 555-0100',
      address: {
        line1: '123 Main St',
        city: 'Seattle',
        region: 'WA',
        postalCode: '98101',
        country: 'US',
      },
      isRemoteService: false,
    },
  };
}

function buildLockedCandidate(overrides: Record<string, unknown> = {}) {
  return {
    candidate_id: 'cand-1',
    extraction_id: 'extract-1',
    extract_key_sha256: 'a'.repeat(64),
    lineage_root_candidate_id: 'cand-1',
    revision_number: 1,
    review_status: 'verified',
    published_service_id: null,
    confidence_score: 88,
    organization_name: 'Example Community Action',
    service_name: 'Pantry Program',
    description: 'Emergency pantry support.',
    website_url: 'https://example.gov/pantry',
    phone: '(206) 555-0100',
    address_line1: '123 Main St',
    address_line2: null,
    address_city: 'Seattle',
    address_region: 'WA',
    address_postal_code: '98101',
    address_country: 'US',
    is_remote_service: false,
    investigation_pack: { canonicalUrl: 'https://example.gov/pantry' },
    extracted_at: '2026-07-14T19:00:00.000Z',
    updated_at: '2026-07-14T20:00:00.000Z',
    is_ready: true,
    has_required_fields: true,
    has_required_tags: true,
    tags_confirmed: true,
    meets_score_threshold: true,
    has_admin_approval: true,
    pending_tag_count: 0,
    admin_approval_count: 2,
    blockers: [],
    has_newer_revision: false,
    ...overrides,
  };
}

function createStores() {
  return {
    candidates: {
      getById: vi.fn().mockResolvedValue(buildCandidateHint()),
    },
    sourceRegistry: { findForUrl: vi.fn() },
    llmSuggestions: { getAcceptedValues: vi.fn() },
    tags: { listFor: vi.fn() },
    tagConfirmations: { listConfirmed: vi.fn() },
  };
}

interface HarnessOptions {
  candidate?: ReturnType<typeof buildLockedCandidate> | null;
  sourceRows?: Array<{
    id: string;
    trust_tier: string;
    resource_purpose: string | null;
    domain_rules: unknown;
    is_active: boolean;
  }>;
  acceptedSuggestions?: Array<Record<string, unknown>>;
  candidateTags?: Array<Record<string, unknown>>;
  tagConfirmations?: Array<Record<string, unknown>>;
  approvalReviewerProfileIds?: string[];
  rejectedReviewerProfileIds?: string[];
  escalatedReviewerProfileIds?: string[];
  publisherActive?: boolean;
  matchedOrganizationId?: string;
  matchedServiceId?: string;
  matchedLocationId?: string;
  currentAuthority?: 'host_submission' | 'canonical_feed' | 'candidate_two_person_authoritative';
  currentPayload?: Record<string, unknown>;
  priorLineagePublication?: {
    candidateId: string;
    serviceId: string;
    organizationId: string;
    serviceStatus?: string;
    organizationStatus?: string;
  };
  failCandidateCas?: boolean;
  failLocationCas?: boolean;
  publicationActivated?: boolean;
  readinessReady?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const candidate = options.candidate === undefined ? buildLockedCandidate() : options.candidate;
  const sourceRows = options.sourceRows ?? [{
    id: 'source-1',
    trust_tier: 'curated',
    resource_purpose: 'service_catalog',
    domain_rules: [{ type: 'suffix', value: 'example.gov' }],
    is_active: true,
  }];
  const approvalReviewerProfileIds = options.approvalReviewerProfileIds
    ?? ['reviewer-profile-a', 'reviewer-profile-b'];
  let rolledBack = false;

  const query = vi.fn(async (sqlValue: string, params?: unknown[]) => {
    const sql = String(sqlValue);
    if (sql.includes('trg_protect_completed_candidate_approval')) {
      return {
        rows: [{ activated: options.publicationActivated !== false }],
        rowCount: 1,
      };
    }
    if (
      sql.includes('SELECT candidate_id')
      && sql.includes('FROM public.extracted_candidates')
      && sql.includes('FOR UPDATE')
    ) {
      return { rows: [{ candidate_id: 'cand-1' }], rowCount: 1 };
    }
    if (sql.includes('public.evaluate_candidate_readiness')) {
      return { rows: [{ is_ready: options.readinessReady !== false }], rowCount: 1 };
    }
    if (sql.includes('JOIN candidate_readiness readiness')) {
      return { rows: candidate ? [candidate] : [], rowCount: candidate ? 1 : 0 };
    }
    if (sql.includes('SELECT role, account_status') && sql.includes('FROM public.user_profiles')) {
      return options.publisherActive === false
        ? { rows: [], rowCount: 0 }
        : { rows: [{ role: 'oran_admin', account_status: 'active' }], rowCount: 1 };
    }
    if (sql.includes('FROM public.llm_suggestions')) {
      return { rows: options.acceptedSuggestions ?? [], rowCount: options.acceptedSuggestions?.length ?? 0 };
    }
    if (sql.includes('FROM public.resource_tags')) {
      return { rows: options.candidateTags ?? [], rowCount: options.candidateTags?.length ?? 0 };
    }
    if (sql.includes('FROM public.tag_confirmation_queue')) {
      return { rows: options.tagConfirmations ?? [], rowCount: options.tagConfirmations?.length ?? 0 };
    }
    if (sql.includes('FROM public.candidate_admin_assignments approval')) {
      const rejectedReviewerProfileIds = options.rejectedReviewerProfileIds ?? [];
      const escalatedReviewerProfileIds = options.escalatedReviewerProfileIds ?? [];
      return {
        rows: [
          ...approvalReviewerProfileIds.map((reviewer_profile_id, index) => ({
            assignment_id: `approval-${index + 1}`,
            reviewer_profile_id,
            outcome: 'verified',
          })),
          ...rejectedReviewerProfileIds.map((reviewer_profile_id, index) => ({
            assignment_id: `rejection-${index + 1}`,
            reviewer_profile_id,
            outcome: 'rejected',
          })),
          ...escalatedReviewerProfileIds.map((reviewer_profile_id, index) => ({
            assignment_id: `escalation-${index + 1}`,
            reviewer_profile_id,
            outcome: 'escalated',
          })),
        ],
        rowCount: approvalReviewerProfileIds.length
          + rejectedReviewerProfileIds.length
          + escalatedReviewerProfileIds.length,
      };
    }
    if (sql.includes('FROM public.source_systems') && sql.includes('FOR SHARE')) {
      return { rows: sourceRows, rowCount: sourceRows.length };
    }
    if (sql.includes('prior_candidate.lineage_root_candidate_id')) {
      const prior = options.priorLineagePublication;
      return prior
        ? {
            rows: [{
              candidate_id: prior.candidateId,
              published_service_id: prior.serviceId,
              live_service_id: prior.serviceId,
              organization_id: prior.organizationId,
              service_status: prior.serviceStatus ?? 'active',
              organization_status: prior.organizationStatus ?? 'active',
            }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('SELECT id') && sql.includes('FROM organizations') && sql.includes("status = 'active'")) {
      return {
        rows: options.matchedOrganizationId ? [{ id: options.matchedOrganizationId }] : [],
        rowCount: options.matchedOrganizationId ? 1 : 0,
      };
    }
    if (sql.includes('SELECT id') && sql.includes('FROM services') && sql.includes("status = 'active'")) {
      return {
        rows: options.matchedServiceId ? [{ id: options.matchedServiceId }] : [],
        rowCount: options.matchedServiceId ? 1 : 0,
      };
    }
    if (sql.includes('UPDATE locations') && sql.includes('RETURNING id')) {
      return options.failLocationCas
        ? { rows: [], rowCount: 0 }
        : { rows: [{ id: String(params?.[0]) }], rowCount: 1 };
    }
    if (sql.includes('FROM service_at_location sal')) {
      return {
        rows: options.matchedLocationId ? [{ id: options.matchedLocationId }] : [],
        rowCount: options.matchedLocationId ? 1 : 0,
      };
    }
    if (sql.includes('FROM hsds_export_snapshots') && sql.includes("status = 'current'")) {
      return options.currentAuthority
        ? {
            rows: [{
              hsds_payload: {
                ...(options.currentPayload ?? {}),
                meta: {
                  ...((options.currentPayload?.meta as Record<string, unknown> | undefined) ?? {}),
                  publicationSourceKind: options.currentAuthority,
                },
              },
              generated_at: '2026-07-14T20:00:00.000Z',
            }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('UPDATE services') && sql.includes('RETURNING id')) {
      return { rows: [{ id: String(params?.[0]) }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO service_at_location') && sql.includes('RETURNING id')) {
      return { rows: [{ id: 'owned-relation-1' }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO addresses') && sql.includes('RETURNING id')) {
      return { rows: [{ id: 'owned-address-1' }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO phones') && sql.includes('RETURNING id')) {
      return { rows: [{ id: 'owned-phone-1' }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO resource_tags') && sql.includes('RETURNING id')) {
      const values = params ?? [];
      const rows = Array.from({ length: Math.floor(values.length / 6) }, (_, index) => ({
        id: `owned-tag-${index + 1}`,
        tag_type: String(values[index * 6 + 1]),
        tag_value: String(values[index * 6 + 2]),
      }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('INSERT INTO service_attributes') && sql.includes('RETURNING id')) {
      const values = params ?? [];
      const rows = Array.from({ length: Math.floor(values.length / 3) }, (_, index) => ({
        id: `owned-attribute-${index + 1}`,
        taxonomy: String(values[index * 3 + 1]),
        tag: String(values[index * 3 + 2]),
      }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('WITH inserted_taxonomy AS')) {
      const terms = (params?.[1] as string[] | undefined) ?? [];
      return {
        rows: terms.map((term, index) => ({ id: `owned-taxonomy-${index + 1}`, term })),
        rowCount: terms.length,
      };
    }
    if (sql.includes('UPDATE extracted_candidates publication_candidate')) {
      return options.failCandidateCas
        ? { rows: [], rowCount: 0 }
        : { rows: [{ candidate_id: 'cand-1' }], rowCount: 1 };
    }
    if (sql.includes('SELECT COALESCE(MAX(snapshot_version)')) {
      return { rows: [{ next_version: 1 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });

  withTransactionMock.mockImplementation(async (callback: (client: { query: typeof query }) => unknown) => {
    try {
      return await callback({ query });
    } catch (error) {
      rolledBack = true;
      throw error;
    }
  });

  return { query, wasRolledBack: () => rolledBack };
}

describe('publishCandidateToLiveService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('evaluates source purpose from the locked transaction state', async () => {
    const stores = createStores();
    const harness = createHarness({
      sourceRows: [{
        id: 'source-1',
        trust_tier: 'curated',
        resource_purpose: 'supporting_reference',
        domain_rules: [{ type: 'suffix', value: 'example.gov' }],
        is_active: true,
      }],
    });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('supporting_reference sources may enrich services');

    expect(withTransactionMock).toHaveBeenCalledOnce();
    expect(stores.sourceRegistry.findForUrl).not.toHaveBeenCalled();
    expect(harness.wasRolledBack()).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(false);
  });

  it('fails closed before lineage activation without querying new columns', async () => {
    const stores = createStores();
    const harness = createHarness({ publicationActivated: false });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('publication is not activated');

    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('JOIN candidate_readiness readiness')
    ))).toBe(false);
    expect(harness.wasRolledBack()).toBe(true);
  });

  it('publishes only a two-person-authoritative snapshot without staff identifiers', async () => {
    const stores = createStores();
    const harness = createHarness({
      acceptedSuggestions: [{
        field: 'service_name',
        suggested_value: 'Pantry Program Updated',
        original_value: null,
        reviewed_by: 'reviewer-a',
        reviewed_at: '2026-07-14T19:30:00.000Z',
      }],
      candidateTags: [{
        id: 'tag-1',
        tag_type: 'category',
        tag_value: 'food',
        confidence: 96,
        source: 'agent',
        added_by: null,
      }],
    });
    const geocode = vi.fn().mockResolvedValue([{
      lat: 47.62,
      lon: -122.33,
      formattedAddress: '123 Main St, Seattle, WA',
      confidence: 'High',
    }]);
    const { publishCandidateToLiveService } = await loadModule();

    const result = await publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
      geocode,
    });

    expect(result.serviceId).toEqual(expect.any(String));
    expect(harness.query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('JOIN candidate_readiness readiness') && String(sql).includes('FOR UPDATE OF candidate, readiness')
    ))).toBe(true);
    const activationSql = String(harness.query.mock.calls.find(([sql]) => (
      String(sql).includes('trg_protect_completed_candidate_approval')
    ))?.[0]);
    expect(activationSql).toContain("tgenabled IN ('O', 'A')");
    expect(activationSql).toContain('trg_enforce_candidate_revision_lineage');
    expect(activationSql).toContain('candidate_admin_assignments_decision_reviewer_check');
    expect(activationSql).toContain('idx_extracted_candidates_lineage_revision');
    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('candidate_admin_assignments approval') && String(sql).includes('FOR SHARE OF approval')
    ))).toBe(true);
    const approvalLockIndex = harness.query.mock.calls.findIndex(([sql]) => (
      String(sql).includes('candidate_admin_assignments approval')
    ));
    const readinessEvaluationIndex = harness.query.mock.calls.findIndex(([sql]) => (
      String(sql).includes('public.evaluate_candidate_readiness')
    ));
    expect(approvalLockIndex).toBeGreaterThan(-1);
    expect(readinessEvaluationIndex).toBeGreaterThan(approvalLockIndex);
    const snapshotParams = harness.query.mock.calls.find(
      ([sql]) => String(sql).includes('INSERT INTO hsds_export_snapshots'),
    )?.[1] as unknown[];
    const snapshotJson = String(snapshotParams[3]);
    expect(snapshotJson).toContain('"publicationSourceKind":"candidate_two_person_authoritative"');
    expect(snapshotJson).toContain('"approvalCount":2');
    expect(snapshotJson).toContain('"oranProjectionOwnership"');
    expect(snapshotJson).toContain('"owned-phone-1"');
    expect(snapshotJson).not.toContain('reviewer-a');
    expect(snapshotJson).not.toContain('reviewer-b');
    expect(stores.llmSuggestions.getAcceptedValues).not.toHaveBeenCalled();
    expect(stores.tags.listFor).not.toHaveBeenCalled();
    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('SET investigation_pack')
    ))).toBe(false);
  });

  it('rejects malformed reviewed contact suggestions before any live write', async () => {
    const stores = createStores();
    const harness = createHarness({
      acceptedSuggestions: [{
        field: 'website_url',
        suggested_value: 'javascript:alert(1)',
        original_value: null,
        reviewed_by: 'reviewer-a',
        reviewed_at: '2026-07-14T19:30:00.000Z',
      }],
    });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('invalid reviewed suggestion value');
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(false);
  });

  it('uses immutable time-of-decision reviewer identity after later deactivation', async () => {
    const stores = createStores();
    const harness = createHarness();
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).resolves.toEqual(expect.objectContaining({ serviceId: expect.any(String) }));

    const approvalSql = String(harness.query.mock.calls.find(([sql]) => (
      String(sql).includes('candidate_admin_assignments approval')
    ))?.[0]);
    expect(approvalSql).toContain('approval.decision_reviewer_profile_id');
    expect(approvalSql).not.toContain('JOIN public.user_profiles account');
    expect(approvalSql).not.toContain('reviewer.is_active');
  });

  it('rejecting one low-confidence tag does not suppress a different confirmed type peer', async () => {
    const stores = createStores();
    const harness = createHarness({
      candidateTags: [
        {
          id: 'tag-category-high',
          tag_type: 'category',
          tag_value: 'food',
          confidence: 95,
          source: 'agent',
          added_by: null,
        },
        {
          id: 'tag-category-low',
          tag_type: 'category',
          tag_value: 'retail_food',
          confidence: 40,
          source: 'agent',
          added_by: null,
        },
        {
          id: 'tag-geographic',
          tag_type: 'geographic',
          tag_value: 'us:wa:seattle',
          confidence: 100,
          source: 'system',
          added_by: null,
        },
      ],
      tagConfirmations: [{
        resource_tag_id: 'tag-category-low',
        tag_type: 'category',
        tag_value: 'retail_food',
        original_confidence: 40,
        status: 'rejected',
        modified_tag_value: null,
        reviewed_by_user_id: 'reviewer-a',
        reviewed_at: '2026-07-14T19:30:00.000Z',
      }],
    });
    const { publishCandidateToLiveService } = await loadModule();

    await publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    });

    const snapshotParams = harness.query.mock.calls.find(
      ([sql]) => String(sql).includes('INSERT INTO hsds_export_snapshots'),
    )?.[1] as unknown[];
    const snapshotJson = String(snapshotParams[3]);
    expect(snapshotJson).toContain('"type":"category","value":"food"');
    expect(snapshotJson).toContain('"type":"geographic","value":"us:wa:seattle"');
    expect(snapshotJson).not.toContain('retail_food');
  });

  it('does not publish when the only category tag has rejected evidence', async () => {
    const stores = createStores();
    const harness = createHarness({
      readinessReady: false,
      candidateTags: [
        {
          id: 'tag-category-only',
          tag_type: 'category',
          tag_value: 'retail_food',
          confidence: 40,
          source: 'agent',
          added_by: null,
        },
        {
          id: 'tag-geographic',
          tag_type: 'geographic',
          tag_value: 'us:wa:seattle',
          confidence: 100,
          source: 'system',
          added_by: null,
        },
      ],
      tagConfirmations: [{
        resource_tag_id: 'tag-category-only',
        tag_type: 'category',
        tag_value: 'retail_food',
        original_confidence: 40,
        status: 'rejected',
        modified_tag_value: null,
        reviewed_by_user_id: 'reviewer-a',
        reviewed_at: '2026-07-14T19:30:00.000Z',
      }],
    });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('no longer meets publish readiness');

    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO hsds_export_snapshots')
    ))).toBe(false);
  });

  it('rejects duplicate or insufficient reviewer evidence before live writes', async () => {
    const stores = createStores();
    const harness = createHarness({
      approvalReviewerProfileIds: ['reviewer-profile-a', 'reviewer-profile-a'],
    });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('lacks two version-bound independent approvals');

    expect(harness.wasRolledBack()).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(false);
  });

  it('rejects a transactionally recomputed not-ready candidate before live writes', async () => {
    const stores = createStores();
    const harness = createHarness({ readinessReady: false });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('no longer meets publish readiness');

    expect(harness.wasRolledBack()).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(false);
  });

  it('rejects publication when immutable reviewer evidence contains a rejection', async () => {
    const stores = createStores();
    const harness = createHarness({ rejectedReviewerProfileIds: ['reviewer-profile-c'] });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('lacks two version-bound independent approvals');

    expect(harness.wasRolledBack()).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(false);
  });

  it('rejects publication when immutable reviewer evidence contains an escalation', async () => {
    const stores = createStores();
    const harness = createHarness({ escalatedReviewerProfileIds: ['reviewer-profile-c'] });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('lacks two version-bound independent approvals');

    expect(harness.wasRolledBack()).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(false);
  });

  it('rejects accepted LLM values that lack a human review version', async () => {
    const stores = createStores();
    const harness = createHarness({
      acceptedSuggestions: [{
        field: 'description',
        suggested_value: 'Unreviewed',
        original_value: null,
        reviewed_by: null,
        reviewed_at: null,
      }],
    });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('unbound accepted LLM evidence');
    expect(harness.wasRolledBack()).toBe(true);
  });

  it('rolls back materialization when the final candidate CAS loses a race', async () => {
    const stores = createStores();
    const harness = createHarness({ failCandidateCas: true });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('publication claim was lost');

    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(true);
    expect(harness.wasRolledBack()).toBe(true);
  });

  it('does not compare a JavaScript-rounded update clock when claiming a locked candidate', async () => {
    const stores = createStores();
    const harness = createHarness({
      candidate: buildLockedCandidate({
        extracted_at: '2026-07-14T19:00:00.123456Z',
        // node-postgres parses timestamptz to a Date and drops the database's
        // remaining microseconds. The row is already held FOR UPDATE.
        updated_at: new Date('2026-07-14T20:00:00.123Z'),
      }),
    });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).resolves.toEqual(expect.objectContaining({ serviceId: expect.any(String) }));

    const candidateClaim = harness.query.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE extracted_candidates publication_candidate')
    ));
    expect(String(candidateClaim?.[0])).not.toContain('AND updated_at =');
    expect(candidateClaim?.[1]).not.toContain('2026-07-14T20:00:00.123Z');
  });

  it('keeps stored extraction provenance distinct from the candidate review clock', async () => {
    const stores = createStores();
    const harness = createHarness({
      candidate: buildLockedCandidate({
        extracted_at: '2026-07-13T08:09:10.123Z',
        updated_at: '2026-07-14T20:00:00.000Z',
      }),
    });
    const { publishCandidateToLiveService } = await loadModule();

    await publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    });

    const snapshotParams = harness.query.mock.calls.find(
      ([sql]) => String(sql).includes('INSERT INTO hsds_export_snapshots'),
    )?.[1] as unknown[];
    expect(String(snapshotParams[3])).toContain('2026-07-13T08:09:10.123Z');
    expect(String(harness.query.mock.calls.find(([sql]) => (
      String(sql).includes('JOIN candidate_readiness readiness')
    ))?.[0])).toContain('candidate.extracted_at');
  });

  it('links a new service to an existing organization without rewriting organization fields', async () => {
    const stores = createStores();
    const harness = createHarness({ matchedOrganizationId: 'org-shared' });
    const { publishCandidateToLiveService } = await loadModule();

    const result = await publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    });

    expect(result.organizationId).toBe('org-shared');
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE organizations'))).toBe(false);
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO organizations'))).toBe(false);
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO services'),
      expect.arrayContaining([expect.any(String), 'org-shared']),
    );
  });

  it('updates a matched location only while ownership and service linkage still match', async () => {
    const stores = createStores();
    const harness = createHarness({
      matchedOrganizationId: 'org-existing',
      matchedServiceId: 'svc-existing',
      matchedLocationId: 'location-existing',
    });
    const { publishCandidateToLiveService } = await loadModule();

    await publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    });

    const locationUpdate = harness.query.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE locations')
    ));
    expect(String(locationUpdate?.[0])).toContain("status = 'active'");
    expect(String(locationUpdate?.[0])).toContain('organization_id = $2');
    expect(String(locationUpdate?.[0])).toContain('matched_relation.service_id = $6');
    expect(String(locationUpdate?.[0])).toContain('RETURNING id');
    expect(locationUpdate?.[1]).toEqual([
      'location-existing',
      'org-existing',
      'Pantry Program',
      null,
      null,
      'svc-existing',
    ]);
    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO service_at_location')
    ))).toBe(false);
  });

  it('rolls back when a matched location is retired, reassigned, or unlinked', async () => {
    const stores = createStores();
    const harness = createHarness({
      matchedOrganizationId: 'org-existing',
      matchedServiceId: 'svc-existing',
      matchedLocationId: 'location-existing',
      failLocationCas: true,
    });
    const { publishCandidateToLiveService } = await loadModule();

    await expect(publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    })).rejects.toThrow('retired, reassigned, or unlinked');

    expect(harness.wasRolledBack()).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE extracted_candidates publication_candidate')
    ))).toBe(false);
  });

  it('links a host-managed duplicate without overwriting its stronger data', async () => {
    const stores = createStores();
    const harness = createHarness({
      matchedOrganizationId: 'org-host',
      matchedServiceId: 'svc-host',
      currentAuthority: 'host_submission',
    });
    const { publishCandidateToLiveService } = await loadModule();

    const result = await publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    });

    expect(result.serviceId).toBe('svc-host');
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE services'))).toBe(false);
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO hsds_export_snapshots'))).toBe(false);
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lifecycle_events'),
      expect.arrayContaining(['linked_existing']),
    );
  });

  it('publishes a corrected child revision onto the prior lineage service', async () => {
    const stores = createStores();
    const harness = createHarness({
      candidate: buildLockedCandidate({
        candidate_id: 'cand-1',
        lineage_root_candidate_id: 'cand-root',
        revision_of_candidate_id: 'cand-root',
        revision_number: 2,
        organization_name: 'Corrected Community Organization',
        service_name: 'Corrected Pantry Name',
        website_url: 'https://example.gov/corrected-pantry',
        investigation_pack: { canonicalUrl: 'https://example.gov/corrected-pantry' },
      }),
      priorLineagePublication: {
        candidateId: 'cand-root',
        serviceId: 'svc-lineage',
        organizationId: 'org-lineage',
      },
      currentAuthority: 'candidate_two_person_authoritative',
      currentPayload: { meta: { oranProjectionOwnership: { version: 1 } } },
    });
    const { publishCandidateToLiveService } = await loadModule();

    const result = await publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    });

    expect(result).toEqual(expect.objectContaining({
      serviceId: 'svc-lineage',
      organizationId: 'org-lineage',
    }));
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(false);
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE services'),
      expect.arrayContaining(['svc-lineage', 'org-lineage', 'Corrected Pantry Name']),
    );
    const snapshotParams = harness.query.mock.calls.find(
      ([sql]) => String(sql).includes('INSERT INTO hsds_export_snapshots'),
    )?.[1] as unknown[];
    expect(String(snapshotParams[3])).toContain('"id":"svc-lineage"');
    expect(String(snapshotParams[3])).toContain('Corrected Pantry Name');
  });

  it('replaces only exact rows owned by the prior candidate projection', async () => {
    const stores = createStores();
    const harness = createHarness({
      candidate: buildLockedCandidate({
        website_url: null,
        phone: null,
        address_line1: null,
        address_line2: null,
        address_city: null,
        address_region: null,
        address_postal_code: null,
        address_country: null,
        is_remote_service: true,
      }),
      matchedOrganizationId: 'org-existing',
      matchedServiceId: 'svc-existing',
      currentAuthority: 'candidate_two_person_authoritative',
      currentPayload: {
        meta: {
          oranProjectionOwnership: {
            version: 1,
            phoneRows: [{ id: 'prior-phone', normalizedNumber: '2065550100' }],
            addressRows: [{ id: 'prior-address', locationId: 'prior-location' }],
            locationRelations: [{ id: 'prior-relation', locationId: 'prior-location' }],
            resourceTags: [{ id: 'prior-tag', tagType: 'category', tagValue: 'food' }],
            serviceAttributes: [
              { id: 'prior-attribute-phone', taxonomy: 'delivery', tag: 'phone' },
              { id: 'prior-attribute-place', taxonomy: 'delivery', tag: 'in_person' },
            ],
            serviceTaxonomy: [{ id: 'prior-taxonomy', term: 'food' }],
          },
        },
      },
      candidateTags: [{
        id: 'tag-geographic',
        tag_type: 'geographic',
        tag_value: 'us:wa',
        confidence: 100,
        source: 'system',
        added_by: null,
      }],
    });
    const { publishCandidateToLiveService } = await loadModule();

    await publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
    });

    expect(harness.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM phones[\s\S]*WHERE id = \$1/),
      ['prior-phone', 'svc-existing'],
    );
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM service_at_location[\s\S]*WHERE id = \$1/),
      ['prior-relation', 'svc-existing', 'prior-location'],
    );
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM addresses[\s\S]*WHERE id = \$1/),
      ['prior-address', 'prior-location', 'svc-existing'],
    );
    const addressDeleteSql = String(harness.query.mock.calls.find(([sql]) => (
      String(sql).includes('DELETE FROM addresses')
    ))?.[0]);
    expect(addressDeleteSql).toContain('shared_relation.service_id <> $3');
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM resource_tags[\s\S]*WHERE id = \$1/),
      ['prior-tag', 'svc-existing'],
    );
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM service_taxonomy[\s\S]*WHERE id = \$1/),
      ['prior-taxonomy', 'svc-existing'],
    );
    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('DELETE FROM addresses WHERE location_id')
      || (String(sql).includes('DELETE FROM resource_tags') && String(sql).includes('tag_type ='))
    ))).toBe(false);

    const serviceUpdate = harness.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE services'));
    expect(serviceUpdate?.[1]).toEqual(expect.arrayContaining([
      'svc-existing',
      'org-existing',
      'Pantry Program',
      'Emergency pantry support.',
      null,
      null,
      null,
      true,
    ]));
    const snapshotParams = harness.query.mock.calls.find(
      ([sql]) => String(sql).includes('INSERT INTO hsds_export_snapshots'),
    )?.[1] as unknown[];
    const snapshotJson = String(snapshotParams[3]);
    expect(snapshotJson).not.toContain('prior-phone');
    expect(snapshotJson).not.toContain('prior-address');
    expect(snapshotJson).not.toContain('prior-tag');
    expect(snapshotJson).toContain('"tagValue":"us:wa"');
    expect(snapshotJson).toContain('"tag":"virtual"');
  });
});
