/**
 * Tests for auto-publish policy engine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluatePolicy, autoPublish, type AutoPublishPolicy } from '../autoPublish';
import type { CanonicalServiceRow, SourceSystemRow } from '@/db/schema';

vi.mock('../promoteToLive', () => ({
  promoteToLive: vi.fn().mockResolvedValue({
    organizationId: 'org-live-1',
    serviceId: 'svc-live-1',
    locationIds: [],
    isUpdate: false,
  }),
}));

// ── Fixtures ──────────────────────────────────────────────

function makeSvc(overrides: Partial<CanonicalServiceRow> = {}): CanonicalServiceRow {
  return {
    id: 'svc-c-1',
    canonicalOrganizationId: 'org-c-1',
    name: 'Test Service',
    alternateName: null,
    description: null,
    url: null,
    email: null,
    status: 'active',
    interpretationServices: null,
    fees: null,
    accreditations: null,
    licenses: null,
    lifecycleStatus: 'active',
    publicationStatus: 'unpublished',
    winningSourceSystemId: 'src-sys-1',
    sourceCount: 1,
    sourceConfidenceSummary: { overall: 85 },
    publishedServiceId: null,
    firstSeenAt: new Date(),
    lastRefreshedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as CanonicalServiceRow;
}

function makeSrcSys(overrides: Partial<SourceSystemRow> = {}): SourceSystemRow {
  return {
    id: 'src-sys-1',
    name: 'HSDS Publisher',
    family: 'hsds',
    trustTier: 'verified_publisher',
    crawlFrequencyHours: 24,
    baseUrl: 'https://example.com',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as SourceSystemRow;
}

const DEFAULT_POLICY: AutoPublishPolicy = {
  eligibleTiers: ['verified_publisher', 'curated'],
  curatedMinConfidence: 70,
  allowRepublish: true,
};

// ── evaluatePolicy unit tests ─────────────────────────────

describe('evaluatePolicy', () => {
  it('approves active verified_publisher service', () => {
    const decision = evaluatePolicy(makeSvc(), makeSrcSys(), DEFAULT_POLICY);
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toContain('auto-publish');
  });

  it('rejects non-active lifecycle', () => {
    const svc = makeSvc({ lifecycleStatus: 'draft' } as Partial<CanonicalServiceRow>);
    const decision = evaluatePolicy(svc, makeSrcSys(), DEFAULT_POLICY);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain("lifecycle_status is 'draft'");
  });

  it('rejects ineligible trust tier', () => {
    const decision = evaluatePolicy(
      makeSvc(),
      makeSrcSys({ trustTier: 'community' } as Partial<SourceSystemRow>),
      DEFAULT_POLICY
    );
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain('not in eligible tiers');
  });

  it('approves curated source above confidence threshold', () => {
    const svc = makeSvc({ sourceConfidenceSummary: { overall: 80 } } as Partial<CanonicalServiceRow>);
    const decision = evaluatePolicy(svc, makeSrcSys({ trustTier: 'curated' } as Partial<SourceSystemRow>), DEFAULT_POLICY);
    expect(decision.eligible).toBe(true);
  });

  it('rejects curated source below confidence threshold', () => {
    const svc = makeSvc({ sourceConfidenceSummary: { overall: 50 } } as Partial<CanonicalServiceRow>);
    const decision = evaluatePolicy(svc, makeSrcSys({ trustTier: 'curated' } as Partial<SourceSystemRow>), DEFAULT_POLICY);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain('curated source confidence 50 < minimum 70');
  });

  it('approves republish when allowRepublish=true', () => {
    const svc = makeSvc({ publicationStatus: 'published' } as Partial<CanonicalServiceRow>);
    const decision = evaluatePolicy(svc, makeSrcSys(), DEFAULT_POLICY);
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toContain('auto-republish');
  });

  it('rejects republish when allowRepublish=false', () => {
    const svc = makeSvc({ publicationStatus: 'published' } as Partial<CanonicalServiceRow>);
    const decision = evaluatePolicy(svc, makeSrcSys(), { ...DEFAULT_POLICY, allowRepublish: false });
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain('republish not allowed');
  });

  it('rejects publication_status retracted', () => {
    const svc = makeSvc({ publicationStatus: 'retracted' } as Partial<CanonicalServiceRow>);
    const decision = evaluatePolicy(svc, makeSrcSys(), DEFAULT_POLICY);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain("publication_status is 'retracted'");
  });
});

// ── autoPublish integration tests ─────────────────────────

function makeMockStores() {
  return {
    canonicalServices: {
      getById: vi.fn(),
      listByOrganization: vi.fn(),
      listByLifecycle: vi.fn().mockResolvedValue([]),
      listByPublication: vi.fn(),
      listByWinningSource: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateLifecycleStatus: vi.fn(),
      updatePublicationStatus: vi.fn(),
    },
    sourceSystems: {
      getById: vi.fn(),
      listActive: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deactivate: vi.fn(),
    },
    // all others are unused stubs
    canonicalOrganizations: {} as never,
    canonicalLocations: {} as never,
    canonicalServiceLocations: {} as never,
    canonicalProvenance: {} as never,
    sourceRegistry: {} as never,
    jobs: {} as never,
    evidence: {} as never,
    candidates: {} as never,
    tags: {} as never,
    checks: {} as never,
    links: {} as never,
    audit: {} as never,
    feeds: {} as never,
    routing: {} as never,
    adminProfiles: {} as never,
    assignments: {} as never,
    tagConfirmations: {} as never,
    llmSuggestions: {} as never,
    publishThresholds: {} as never,
    publishReadiness: {} as never,
    sourceFeeds: {} as never,
    sourceRecords: {} as never,
    entityIdentifiers: {} as never,
    hsdsExportSnapshots: {} as never,
    lifecycleEvents: {} as never,
    taxonomyRegistries: {} as never,
    taxonomyTermsExt: {} as never,
    canonicalConcepts: {} as never,
    taxonomyCrosswalks: {} as never,
    conceptTagDerivations: {} as never,
  };
}

describe('autoPublish', () => {
  let stores: ReturnType<typeof makeMockStores>;

  beforeEach(() => {
    stores = makeMockStores();
    vi.clearAllMocks();
  });

  it('publishes eligible services from explicit IDs', async () => {
    const svc = makeSvc();
    stores.canonicalServices.getById.mockResolvedValue(svc);
    stores.sourceSystems.getById.mockResolvedValue(makeSrcSys());

    const result = await autoPublish({
      stores: stores as never,
      canonicalServiceIds: ['svc-c-1'],
    });

    expect(result.published).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.decisions[0].eligible).toBe(true);
  });

  it('skips services with no winning source system', async () => {
    const svc = makeSvc({ winningSourceSystemId: null } as Partial<CanonicalServiceRow>);
    stores.canonicalServices.getById.mockResolvedValue(svc);

    const result = await autoPublish({
      stores: stores as never,
      canonicalServiceIds: ['svc-c-1'],
    });

    expect(result.published).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.decisions[0].eligible).toBe(false);
    expect(result.decisions[0].reason).toContain('no winning source system');
  });

  it('discovers and processes unpublished active services', async () => {
    const svc = makeSvc();
    stores.canonicalServices.listByLifecycle.mockResolvedValue([svc]);
    stores.sourceSystems.getById.mockResolvedValue(makeSrcSys());

    const result = await autoPublish({ stores: stores as never });

    expect(result.evaluated).toBe(1);
    expect(result.published).toBe(1);
    expect(stores.canonicalServices.listByLifecycle).toHaveBeenCalledWith('active', 100);
  });

  it('records errors when promoteToLive throws', async () => {
    const { promoteToLive } = await import('../promoteToLive');
    (promoteToLive as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('tx failure'));

    const svc = makeSvc();
    stores.canonicalServices.getById.mockResolvedValue(svc);
    stores.sourceSystems.getById.mockResolvedValue(makeSrcSys());

    const result = await autoPublish({
      stores: stores as never,
      canonicalServiceIds: ['svc-c-1'],
    });

    expect(result.published).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('tx failure');
  });
});
