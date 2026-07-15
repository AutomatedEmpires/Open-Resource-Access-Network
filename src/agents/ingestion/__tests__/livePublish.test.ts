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
  approvalReviewerIds?: string[];
  publisherActive?: boolean;
  matchedOrganizationId?: string;
  matchedServiceId?: string;
  matchedLocationId?: string;
  currentAuthority?: 'host_submission' | 'canonical_feed';
  failCandidateCas?: boolean;
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
  const approvalReviewerIds = options.approvalReviewerIds ?? ['reviewer-a', 'reviewer-b'];
  let rolledBack = false;

  const query = vi.fn(async (sqlValue: string, params?: unknown[]) => {
    const sql = String(sqlValue);
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
      return {
        rows: approvalReviewerIds.map((reviewer_user_id, index) => ({
          assignment_id: `approval-${index + 1}`,
          reviewer_user_id,
          reviewer_role: index === 0 ? 'community_admin' : 'oran_admin',
          reviewer_account_status: 'active',
        })),
        rowCount: approvalReviewerIds.length,
      };
    }
    if (sql.includes('FROM public.source_systems') && sql.includes('FOR SHARE')) {
      return { rows: sourceRows, rowCount: sourceRows.length };
    }
    if (sql.includes('FROM organizations') && sql.includes("regexp_replace(regexp_replace(coalesce(url")) {
      return {
        rows: options.matchedOrganizationId ? [{ id: options.matchedOrganizationId }] : [],
        rowCount: options.matchedOrganizationId ? 1 : 0,
      };
    }
    if (sql.includes('FROM services') && sql.includes("regexp_replace(regexp_replace(coalesce(url")) {
      return {
        rows: options.matchedServiceId ? [{ id: options.matchedServiceId }] : [],
        rowCount: options.matchedServiceId ? 1 : 0,
      };
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
              hsds_payload: { meta: { publicationSourceKind: options.currentAuthority } },
              generated_at: '2026-07-14T20:00:00.000Z',
            }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('UPDATE organizations') && sql.includes('RETURNING id')) {
      return { rows: [{ id: String(params?.[0]) }], rowCount: 1 };
    }
    if (sql.includes('UPDATE services') && sql.includes('RETURNING id')) {
      return { rows: [{ id: String(params?.[0]) }], rowCount: 1 };
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

  it('publishes only a two-person-authoritative snapshot without staff identifiers', async () => {
    const stores = createStores();
    const harness = createHarness({
      acceptedSuggestions: [{
        field: 'name',
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
    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('candidate_admin_assignments approval') && String(sql).includes('FOR SHARE OF approval')
    ))).toBe(true);
    const snapshotParams = harness.query.mock.calls.find(
      ([sql]) => String(sql).includes('INSERT INTO hsds_export_snapshots'),
    )?.[1] as unknown[];
    const snapshotJson = String(snapshotParams[3]);
    expect(snapshotJson).toContain('"publicationSourceKind":"candidate_two_person_authoritative"');
    expect(snapshotJson).toContain('"approvalCount":2');
    expect(snapshotJson).not.toContain('reviewer-a');
    expect(snapshotJson).not.toContain('reviewer-b');
    expect(stores.llmSuggestions.getAcceptedValues).not.toHaveBeenCalled();
    expect(stores.tags.listFor).not.toHaveBeenCalled();
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
    expect(approvalSql).toContain('approval.decision_reviewer_user_id');
    expect(approvalSql).not.toContain('JOIN public.user_profiles account');
    expect(approvalSql).not.toContain('reviewer.is_active');
  });

  it('rejects duplicate or insufficient reviewer evidence before live writes', async () => {
    const stores = createStores();
    const harness = createHarness({ approvalReviewerIds: ['reviewer-a', 'reviewer-a'] });
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
});
