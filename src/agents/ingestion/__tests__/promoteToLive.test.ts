import { beforeEach, describe, expect, it, vi } from 'vitest';

const withTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  withTransaction: withTransactionMock,
}));

async function loadModule() {
  return import('../promoteToLive');
}

const VERSION = new Date('2026-07-14T20:00:00.000Z');

function buildCanonicalOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'canon-org-1',
    name: 'Acme Nonprofit',
    alternateName: null,
    description: 'Helps the community.',
    url: 'https://acme.org',
    email: 'info@acme.org',
    phone: '(206) 555-0100',
    taxStatus: '501c3',
    taxId: '12-3456789',
    yearIncorporated: 2010,
    legalStatus: 'nonprofit',
    lifecycleStatus: 'active',
    publicationStatus: 'unpublished',
    winningSourceSystemId: 'src-sys-1',
    sourceCount: 2,
    sourceConfidenceSummary: { overall: 85 },
    publishedOrganizationId: null,
    firstSeenAt: VERSION,
    lastRefreshedAt: VERSION,
    createdAt: VERSION,
    updatedAt: VERSION,
    ...overrides,
  };
}

function buildCanonicalService(overrides: Record<string, unknown> = {}) {
  return {
    id: 'canon-svc-1',
    canonicalOrganizationId: 'canon-org-1',
    name: 'Food Pantry',
    alternateName: null,
    description: 'Emergency food distribution.',
    url: 'https://acme.org/pantry',
    email: 'pantry@acme.org',
    status: 'active',
    interpretationServices: null,
    applicationProcess: 'Walk-in',
    waitTime: 'Under 30 min',
    fees: 'Free',
    accreditations: null,
    licenses: null,
    lifecycleStatus: 'active',
    publicationStatus: 'unpublished',
    winningSourceSystemId: 'src-sys-1',
    sourceCount: 2,
    sourceConfidenceSummary: { overall: 85 },
    publishedServiceId: null,
    firstSeenAt: VERSION,
    lastRefreshedAt: VERSION,
    createdAt: VERSION,
    updatedAt: VERSION,
    ...overrides,
  };
}

function buildCanonicalLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'canon-loc-1',
    canonicalOrganizationId: 'canon-org-1',
    name: 'Main Office',
    alternateName: null,
    description: null,
    transportation: 'Bus',
    latitude: 47.62,
    longitude: -122.33,
    geom: null,
    addressLine1: '123 Main St',
    addressLine2: null,
    addressCity: 'Seattle',
    addressRegion: 'WA',
    addressPostalCode: '98101',
    addressCountry: 'US',
    lifecycleStatus: 'active',
    publicationStatus: 'unpublished',
    winningSourceSystemId: 'src-sys-1',
    sourceCount: 1,
    sourceConfidenceSummary: {},
    publishedLocationId: null,
    firstSeenAt: VERSION,
    lastRefreshedAt: VERSION,
    createdAt: VERSION,
    updatedAt: VERSION,
    ...overrides,
  };
}

interface HarnessOptions {
  service?: ReturnType<typeof buildCanonicalService> | null;
  organization?: ReturnType<typeof buildCanonicalOrg> | null;
  locations?: Array<ReturnType<typeof buildCanonicalLocation>>;
  source?: {
    id: string;
    family: string;
    trust_tier: string;
    resource_purpose: string | null;
    is_active: boolean;
  } | null;
  acceptedSourceRecordIds?: string[];
  finalLocationIds?: string[];
  failCanonicalCas?: 'organization' | 'service' | 'location';
  matchedOrganizationId?: string;
  matchedServiceId?: string;
  matchedLocationId?: string;
  currentAuthority?: 'host_submission' | 'canonical_feed';
}

function createHarness(options: HarnessOptions = {}) {
  const service = options.service === undefined ? buildCanonicalService() : options.service;
  const organization = options.organization === undefined ? buildCanonicalOrg() : options.organization;
  const locations = options.locations ?? [buildCanonicalLocation()];
  const initialLocationIds = locations.map((location) => location.id).sort();
  const acceptedIds = options.acceptedSourceRecordIds ?? ['source-record-1'];
  const source = options.source === undefined
    ? {
        id: 'src-sys-1',
        family: 'hsds_api',
        trust_tier: 'curated',
        resource_purpose: 'service_catalog',
        is_active: true,
      }
    : options.source;
  let linkReadCount = 0;
  let rolledBack = false;

  const query = vi.fn(async (sqlValue: string, params?: unknown[]) => {
    const sql = String(sqlValue);
    if (sql.includes('FROM public.canonical_services') && sql.includes('FOR UPDATE')) {
      return { rows: service ? [service] : [], rowCount: service ? 1 : 0 };
    }
    if (sql.includes('FROM public.canonical_organizations') && sql.includes('FOR UPDATE')) {
      return { rows: organization ? [organization] : [], rowCount: organization ? 1 : 0 };
    }
    if (sql.includes('FROM public.canonical_service_locations')) {
      linkReadCount += 1;
      const ids = linkReadCount > 1 && options.finalLocationIds
        ? options.finalLocationIds
        : initialLocationIds;
      return {
        rows: ids.map((canonicalLocationId) => ({ canonicalLocationId })),
        rowCount: ids.length,
      };
    }
    if (sql.includes('FROM public.canonical_locations')) {
      return { rows: locations, rowCount: locations.length };
    }
    if (sql.includes('SELECT id, family, trust_tier, resource_purpose, is_active')) {
      return { rows: source ? [source] : [], rowCount: source ? 1 : 0 };
    }
    if (sql.includes('FROM public.canonical_provenance')) {
      return {
        rows: acceptedIds.map((source_record_id) => ({ source_record_id })),
        rowCount: acceptedIds.length,
      };
    }
    if (sql.includes('SELECT publication_record.id, publication_record.source_feed_id')) {
      return {
        rows: acceptedIds.map((id) => ({ id, source_feed_id: 'source-feed-1' })),
        rowCount: acceptedIds.length,
      };
    }
    if (sql.includes('UPDATE public.source_records publication_record')) {
      return { rows: acceptedIds.map((id) => ({ id })), rowCount: acceptedIds.length };
    }
    if (sql.includes('FROM public.organizations') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: params?.[0], status: 'active' }], rowCount: 1 };
    }
    if (sql.includes('FROM public.services') && sql.includes('FOR UPDATE')) {
      return {
        rows: [{ id: params?.[0], organization_id: organization?.publishedOrganizationId, status: 'active' }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM public.locations') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: params?.[0], status: 'active' }], rowCount: 1 };
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
    if (sql.includes('SELECT COALESCE(MAX(snapshot_version)')) {
      return { rows: [{ next_version: 1 }], rowCount: 1 };
    }
    if (sql.includes('UPDATE canonical_organizations')) {
      const failed = options.failCanonicalCas === 'organization';
      return { rows: failed ? [] : [{ id: 'canon-org-1' }], rowCount: failed ? 0 : 1 };
    }
    if (sql.includes('UPDATE canonical_services')) {
      const failed = options.failCanonicalCas === 'service';
      return { rows: failed ? [] : [{ id: 'canon-svc-1' }], rowCount: failed ? 0 : 1 };
    }
    if (sql.includes('UPDATE canonical_locations')) {
      const failed = options.failCanonicalCas === 'location';
      return { rows: failed ? [] : [{ id: String(params?.[0]) }], rowCount: failed ? 0 : 1 };
    }
    if (sql.includes('UPDATE organizations') && sql.includes('RETURNING id')) {
      return { rows: [{ id: String(params?.[0]) }], rowCount: 1 };
    }
    if (sql.includes('UPDATE services') && sql.includes('RETURNING id')) {
      return { rows: [{ id: String(params?.[0]) }], rowCount: 1 };
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

describe('promoteToLive', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('locks and version-binds canonical inputs before first publication', async () => {
    const harness = createHarness();
    const { promoteToLive } = await loadModule();

    const result = await promoteToLive({
      stores: {} as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    });

    expect(result.isUpdate).toBe(false);
    expect(result.locationIds).toHaveLength(1);
    expect(harness.query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('FROM public.canonical_services') && String(sql).includes('FOR UPDATE')
    ))).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('FROM public.canonical_organizations') && String(sql).includes('FOR UPDATE')
    ))).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => (
      String(sql).includes('FROM public.canonical_locations') && String(sql).includes('FOR UPDATE')
    ))).toBe(true);
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringContaining("SET processing_status = 'published'"),
      ['src-sys-1', ['source-record-1']],
    );
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE canonical_services'),
      expect.arrayContaining(['canon-svc-1', result.serviceId, VERSION]),
    );
    const serviceCas = String(harness.query.mock.calls.find(
      ([sql]) => String(sql).includes('UPDATE canonical_services'),
    )?.[0]);
    expect(serviceCas).toContain('published_service_id IS NOT DISTINCT FROM $6::uuid');
    expect(serviceCas).toContain('updated_at = $3::timestamptz');
  });

  it('fails closed inside the transaction for supporting-reference authority', async () => {
    const harness = createHarness({
      source: {
        id: 'src-sys-1',
        family: 'government_open_data',
        trust_tier: 'curated',
        resource_purpose: 'supporting_reference',
        is_active: true,
      },
    });
    const { promoteToLive } = await loadModule();

    await expect(promoteToLive({
      stores: {} as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    })).rejects.toThrow('supporting_reference sources may enrich services');

    expect(withTransactionMock).toHaveBeenCalledOnce();
    expect(harness.wasRolledBack()).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(false);
  });

  it('fails closed when the winning source or accepted assertion is missing', async () => {
    const sourceHarness = createHarness({ source: null });
    const { promoteToLive } = await loadModule();
    await expect(promoteToLive({
      stores: {} as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    })).rejects.toThrow('no active non-manual winning source authority');
    expect(sourceHarness.wasRolledBack()).toBe(true);

    vi.clearAllMocks();
    const assertionHarness = createHarness({ acceptedSourceRecordIds: [] });
    await expect(promoteToLive({
      stores: {} as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    })).rejects.toThrow('no accepted normalized assertion');
    expect(assertionHarness.wasRolledBack()).toBe(true);
    expect(assertionHarness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(false);
  });

  it('locks direct live pointers and safely re-promotes existing identities', async () => {
    const harness = createHarness({
      service: buildCanonicalService({ publishedServiceId: 'live-svc-1' }),
      organization: buildCanonicalOrg({ publishedOrganizationId: 'live-org-1' }),
      locations: [buildCanonicalLocation({ publishedLocationId: 'live-loc-1' })],
    });
    const { promoteToLive } = await loadModule();

    const result = await promoteToLive({
      stores: {} as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'admin-1',
    });

    expect(result).toEqual({
      organizationId: 'live-org-1',
      serviceId: 'live-svc-1',
      locationIds: ['live-loc-1'],
      isUpdate: true,
    });
    for (const table of ['organizations', 'services', 'locations']) {
      expect(harness.query.mock.calls.some(([sql]) => (
        String(sql).includes(`FROM public.${table}`) && String(sql).includes('FOR UPDATE')
      ))).toBe(true);
    }
  });

  it('rolls back staged live writes when a concurrent canonical pointer CAS wins', async () => {
    const harness = createHarness({ failCanonicalCas: 'service' });
    const { promoteToLive } = await loadModule();

    await expect(promoteToLive({
      stores: {} as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    })).rejects.toThrow('Canonical service publication pointer changed concurrently');

    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO services'))).toBe(true);
    expect(harness.wasRolledBack()).toBe(true);
  });

  it('rechecks the locked location-link set before committing pointers', async () => {
    const harness = createHarness({ finalLocationIds: ['canon-loc-1', 'canon-loc-2'] });
    const { promoteToLive } = await loadModule();

    await expect(promoteToLive({
      stores: {} as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    })).rejects.toThrow('location links changed during publication');

    expect(harness.wasRolledBack()).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE canonical_services'))).toBe(false);
  });

  it('links matching host-managed rows without overwriting their stronger snapshot', async () => {
    const harness = createHarness({
      matchedOrganizationId: 'live-org-host',
      matchedServiceId: 'live-svc-host',
      matchedLocationId: 'live-loc-host',
      currentAuthority: 'host_submission',
    });
    const { promoteToLive } = await loadModule();

    const result = await promoteToLive({
      stores: {} as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    });

    expect(result.serviceId).toBe('live-svc-host');
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE services'))).toBe(false);
    expect(harness.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO hsds_export_snapshots'))).toBe(false);
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lifecycle_events'),
      expect.arrayContaining(['linked_existing']),
    );
  });
});
