/**
 * 211 NDP (National Data Platform) Feed Connector.
 *
 * Polls the 211 NDP Export V2 API and decomposes organization bundles
 * into individual source records in the source assertion layer (Zone A).
 *
 * Architecture:
 *  1. Fetch organization bundles from Export V2 endpoint.
 *  2. Validate each bundle against Ndp211OrganizationSchema.
 *  3. Persist one bundle-level source record (type: organization_bundle).
 *  4. Decompose into child source records:
 *     - organization
 *     - service (per service)
 *     - location (per location)
 *     - service_at_location (per junction)
 *  5. Preserve external taxonomy, eligibility, and 211-specific metadata.
 *  6. Attach taxonomy codes to source_record_taxonomy for crosswalk.
 *
 * This connector follows the ingest method recommended in
 * reports/ingestion_run_audit.md.
 */

import type { IngestionStores } from './stores';
import type {
  SourceFeedRow,
  SourceSystemRow,
  NewSourceRecordRow,
  NewSourceRecordTaxonomyRow,
} from '@/db/schema';
import {
  Ndp211OrganizationSchema,
  type Ndp211Organization,
  type Ndp211Service,
  type Ndp211Location,
  type Ndp211ServiceAtLocation,
  type Ndp211Taxonomy,
} from './ndp211Types';
import { sha256, stableStringify, isTransient, buildUrl } from './connectorUtils';

// ── Public types ──────────────────────────────────────────────

export interface Ndp211ConnectorOptions {
  stores: IngestionStores;
  sourceSystem: SourceSystemRow;
  feed: SourceFeedRow;
  /** Override fetch for testing or custom HTTP. */
  fetchFn?: typeof fetch;
  /** Correlation ID for tracing. */
  correlationId?: string;
  /** Request timeout ms (default 30 000). */
  timeoutMs?: number;
  /** Max retry attempts on transient failures (default 3). */
  maxRetries?: number;
  /** 211 API subscription key (Ocp-Apim-Subscription-Key header). */
  subscriptionKey?: string;
  /**
   * 211 data owner filter (dataOwners header).
   * Comma-separated list of data owners (e.g. "211ventura,211monterey").
   */
  dataOwners?: string;
  /**
   * Organization IDs to fetch. If empty, uses the search/export
   * list endpoint to discover IDs.
   */
  organizationIds?: string[];
  /** Max orgs to fetch per poll (pagination guard). Default 100. */
  maxOrganizations?: number;
}

export interface Ndp211ConnectorResult {
  organizationBundlesFetched: number;
  recordsCreated: number;
  recordsSkippedDuplicate: number;
  taxonomyCodesAttached: number;
  errors: string[];
}

// ── Helpers ───────────────────────────────────────────────────

function buildHeaders(
  subscriptionKey?: string,
  dataOwners?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (subscriptionKey) {
    headers['Ocp-Apim-Subscription-Key'] = subscriptionKey;
  }
  if (dataOwners) {
    headers['dataOwners'] = dataOwners;
  }
  return headers;
}

// ── Retry helper ──────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  timeoutMs: number,
  maxRetries: number,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchFn(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`211 NDP API ${url} returned ${response.status}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(`211 NDP API ${url} returned invalid JSON`);
      }
      return body;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isTransient(err)) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ── Source record creation ────────────────────────────────────

async function createSourceRecord(
  stores: IngestionStores,
  feed: SourceFeedRow,
  sourceSystem: SourceSystemRow,
  recordType: string,
  sourceRecordId: string,
  payload: Record<string, unknown>,
  correlationId: string | undefined,
): Promise<{ status: 'created'; id: string } | { status: 'duplicate' }> {
  const payloadStr = stableStringify(payload);
  const payloadHash = sha256(payloadStr);

  const existing = await stores.sourceRecords.findByDedup(
    feed.id,
    recordType,
    sourceRecordId,
    payloadHash,
  );

  if (existing) return { status: 'duplicate' };

  const row: NewSourceRecordRow = {
    sourceFeedId: feed.id,
    sourceRecordType: recordType,
    sourceRecordId,
    fetchedAt: new Date(),
    payloadSha256: payloadHash,
    rawPayload: payload,
    parsedPayload: payload,
    sourceConfidenceSignals: {
      trustTier: sourceSystem.trustTier,
      family: sourceSystem.family,
      source: '211_ndp',
    },
    processingStatus: 'pending',
    correlationId: correlationId ?? null,
    sourceLicense: sourceSystem.licenseNotes ?? null,
  };

  const created = await stores.sourceRecords.create(row);
  return { status: 'created', id: created.id };
}

// ── Taxonomy attachment ───────────────────────────────────────

function buildTaxonomyRows(
  sourceRecordId: string,
  taxonomyEntries: Ndp211Taxonomy[],
): NewSourceRecordTaxonomyRow[] {
  return taxonomyEntries
    .filter((t) => t.taxonomyCode)
    .map((t, idx) => ({
      sourceRecordId,
      taxonomyName: 'airs_211',
      termCode: t.taxonomyCode!,
      termName: t.taxonomyTerm ?? null,
      termUri: null,
      isPrimary: idx === 0,
    }));
}

// ── 211 NDP → ORAN normalised payload mappers ─────────────────

/**
 * Normalise a 211 NDP organization into ORAN's HSDS-aligned parsed_payload.
 * We flatten 211-specific nested shapes into HSDS-aligned keys while
 * preserving all original data in raw_payload.
 */
function normalizeOrgPayload(org: Ndp211Organization): Record<string, unknown> {
  const mainPhone = org.phones?.find((p) => p.isMain) ?? org.phones?.[0];
  return {
    name: org.name,
    alternate_name: org.alternateNames?.join('; ') || null,
    description: org.description,
    url: org.url,
    email: org.email,
    phone: mainPhone?.number ?? null,
    tax_status: org.taxStatus,
    tax_id: org.taxId,
    year_incorporated: org.yearIncorporated,
    legal_status: org.legalStatus,
    _211_data_owner: org.dataOwner,
    _211_data_owner_display: org.dataOwnerDisplayName,
    _211_data_steward: org.dataSteward,
    _211_meta: org.meta,
  };
}

function normalizeServicePayload(svc: Ndp211Service): Record<string, unknown> {
  const mainPhone = svc.phones?.find((p) => p.isMain) ?? svc.phones?.[0];
  const feeDescription =
    svc.fees?.type === 'no_fee' ? 'Free' :
      svc.fees?.description ?? null;

  return {
    name: svc.name,
    alternate_name: svc.alternateNames?.join('; ') || null,
    description: svc.description,
    url: svc.url,
    email: svc.email,
    phone: mainPhone?.number ?? null,
    status: svc.meta?.status ?? 'active',
    interpretation_services: svc.interpretationServices,
    application_process: svc.applicationProcess,
    wait_time: svc.waitTime,
    fees: feeDescription,
    _211_fees_detail: svc.fees,
    _211_eligibility: svc.eligibility,
    _211_documents: svc.documents,
    _211_service_areas: svc.serviceAreas,
    _211_languages: svc.languages,
    _211_taxonomy: svc.taxonomy,
    _211_meta: svc.meta,
    _211_location_ids: svc.locationIds,
    _211_id_organization: svc.idOrganization,
  };
}

function normalizeLocationPayload(loc: Ndp211Location): Record<string, unknown> {
  const physicalAddr = loc.addresses?.find((a) => a.type === 'physical') ?? loc.addresses?.[0];
  return {
    name: loc.name,
    alternate_name: loc.alternateNames?.join('; ') || null,
    description: loc.description,
    latitude: loc.latitude,
    longitude: loc.longitude,
    transportation: loc.transportation,
    address_1: physicalAddr?.street ?? null,
    city: physicalAddr?.city ?? null,
    region: physicalAddr?.state ?? null,
    postal_code: physicalAddr?.postalCode ?? null,
    country: physicalAddr?.country ?? 'US',
    _211_addresses: loc.addresses,
    _211_accessibility: loc.accessibility,
    _211_languages: loc.languages,
    _211_meta: loc.meta,
  };
}

function normalizeServiceAtLocationPayload(
  sal: Ndp211ServiceAtLocation,
): Record<string, unknown> {
  return {
    _211_id_service: sal.idService,
    _211_id_location: sal.idLocation,
    _211_id_organization: sal.idOrganization,
    _211_schedules: sal.schedules,
    _211_phones: sal.phones,
    _211_contacts: sal.contacts,
    _211_meta: sal.meta,
    url: sal.url,
    email: sal.email,
  };
}

// ── Main connector function ──────────────────────────────────

export async function poll211NdpFeed(
  options: Ndp211ConnectorOptions,
): Promise<Ndp211ConnectorResult> {
  const {
    stores,
    sourceSystem,
    feed,
    correlationId,
    organizationIds,
    dataOwners,
  } = options;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 3;
  const maxOrgs = options.maxOrganizations ?? 100;
  const subscriptionKey = options.subscriptionKey ?? process.env.NDP_211_SUBSCRIPTION_KEY;

  const headers = buildHeaders(subscriptionKey, dataOwners);
  const baseUrl = (feed.baseUrl ?? 'https://api.211.org/resources/v2').replace(/\/+$/, '');

  const result: Ndp211ConnectorResult = {
    organizationBundlesFetched: 0,
    recordsCreated: 0,
    recordsSkippedDuplicate: 0,
    taxonomyCodesAttached: 0,
    errors: [],
  };
  const sourceFeedState = await stores.sourceFeedStates.getByFeedId(feed.id);
  const cursorValue = sourceFeedState?.replayFromCursor ?? sourceFeedState?.checkpointCursor;
  const checkpointOffset = cursorValue ? Number.parseInt(cursorValue, 10) : 0;
  const safeCheckpointOffset = Number.isFinite(checkpointOffset) && checkpointOffset >= 0 ? checkpointOffset : 0;
  let batchOffset = safeCheckpointOffset;
  let nextCheckpointCursor = String(safeCheckpointOffset);
  let usedDiscoveredIds = false;

  // ── Resolve organization IDs to fetch ─────────────────────
  let idsToFetch = organizationIds ?? [];

  if (idsToFetch.length === 0) {
    // Use Search V2 to discover org IDs if no explicit list provided
    try {
      const searchUrl = buildUrl(baseUrl, '/search');
      const searchBody = await fetchWithRetry(
        searchUrl, headers, fetchFn, timeoutMs, maxRetries,
      );

      // Search V2 returns array of result items with id fields
      const searchResults = Array.isArray(searchBody)
        ? searchBody
        : (searchBody as Record<string, unknown>)?.results
          ? (searchBody as Record<string, unknown>).results as unknown[]
          : (searchBody as Record<string, unknown>)?.data
            ? (searchBody as Record<string, unknown>).data as unknown[]
            : [];

      idsToFetch = searchResults
        .map((r) => {
          if (typeof r === 'string') return r;
          if (r && typeof r === 'object' && 'id' in r) return String((r as Record<string, unknown>).id);
          return null;
        })
        .filter((id): id is string => id !== null);

      usedDiscoveredIds = true;
      if (batchOffset >= idsToFetch.length) {
        batchOffset = 0;
      }
      nextCheckpointCursor = String(
        batchOffset + maxOrgs >= idsToFetch.length ? 0 : batchOffset + maxOrgs,
      );
      idsToFetch = idsToFetch.slice(batchOffset, batchOffset + maxOrgs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`search discovery: ${msg}`);
    }
  }

  // ── Fetch and decompose each organization bundle ──────────
  for (const orgId of idsToFetch.slice(0, maxOrgs)) {
    let orgBundle: Ndp211Organization;
    try {
      const exportUrl = buildUrl(baseUrl, `/export/organizations/${encodeURIComponent(orgId)}`);
      const rawBody = await fetchWithRetry(
        exportUrl, headers, fetchFn, timeoutMs, maxRetries,
      );

      // Export V2 returns an array with one organization
      const rawOrg = Array.isArray(rawBody) ? rawBody[0] : rawBody;
      if (!rawOrg) {
        result.errors.push(`org ${orgId}: empty response`);
        continue;
      }

      const parseResult = Ndp211OrganizationSchema.safeParse(rawOrg);
      if (!parseResult.success) {
        result.errors.push(
          `org ${orgId}: validation failed — ${parseResult.error.issues.map((i) => i.message).join('; ')}`,
        );
        continue;
      }
      orgBundle = parseResult.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`org ${orgId}: ${msg}`);
      continue;
    }

    result.organizationBundlesFetched++;

    // ── 1. Bundle-level source record ─────────────────────
    const bundleResult = await createSourceRecord(
      stores, feed, sourceSystem,
      'organization_bundle',
      orgBundle.id,
      orgBundle as unknown as Record<string, unknown>,
      correlationId,
    );
    if (bundleResult.status === 'created') result.recordsCreated++;
    else result.recordsSkippedDuplicate++;

    // ── 2. Organization child record ──────────────────────
    const orgPayload = normalizeOrgPayload(orgBundle);
    const orgResult = await createSourceRecord(
      stores, feed, sourceSystem,
      'organization',
      orgBundle.id,
      orgPayload,
      correlationId,
    );
    if (orgResult.status === 'created') result.recordsCreated++;
    else result.recordsSkippedDuplicate++;

    // ── 3. Service child records ──────────────────────────
    for (const svc of orgBundle.services) {
      const svcPayload = normalizeServicePayload(svc);
      const svcResult = await createSourceRecord(
        stores, feed, sourceSystem,
        'service',
        svc.id,
        svcPayload,
        correlationId,
      );
      if (svcResult.status === 'created') {
        result.recordsCreated++;

        // Attach taxonomy codes using the DB-generated UUID
        if (svc.taxonomy.length > 0) {
          const taxRows = buildTaxonomyRows(svcResult.id, svc.taxonomy);
          if (taxRows.length > 0) {
            try {
              await stores.sourceRecords.addTaxonomy(taxRows);
              result.taxonomyCodesAttached += taxRows.length;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              result.errors.push(`taxonomy attach svc ${svc.id}: ${msg}`);
            }
          }
        }
      } else {
        result.recordsSkippedDuplicate++;
      }
    }

    // ── 4. Location child records ─────────────────────────
    for (const loc of orgBundle.locations) {
      const locPayload = normalizeLocationPayload(loc);
      const locResult = await createSourceRecord(
        stores, feed, sourceSystem,
        'location',
        loc.id,
        locPayload,
        correlationId,
      );
      if (locResult.status === 'created') result.recordsCreated++;
      else result.recordsSkippedDuplicate++;
    }

    // ── 5. ServiceAtLocation junction records ─────────────
    for (const sal of orgBundle.servicesAtLocations) {
      const salPayload = normalizeServiceAtLocationPayload(sal);
      const salResult = await createSourceRecord(
        stores, feed, sourceSystem,
        'service_at_location',
        sal.id,
        salPayload,
        correlationId,
      );
      if (salResult.status === 'created') result.recordsCreated++;
      else result.recordsSkippedDuplicate++;
    }
  }

  // ── Update feed poll status ─────────────────────────────
  const now = new Date().toISOString();
  const hasErrors = result.errors.length > 0;

  await stores.sourceFeeds.updateAfterPoll(feed.id, {
    lastPolledAt: now,
    ...(hasErrors
      ? { lastError: result.errors.join('; ').slice(0, 2000), errorCount: (feed.errorCount ?? 0) + 1 }
      : { lastSuccessAt: now, errorCount: 0 }),
  });

  if (usedDiscoveredIds) {
    const nextState = {
      sourceFeedId: feed.id,
      checkpointCursor: hasErrors ? String(batchOffset) : nextCheckpointCursor,
      replayFromCursor: hasErrors ? String(batchOffset) : null,
    };

    if (sourceFeedState) {
      await stores.sourceFeedStates.update(feed.id, nextState);
    } else {
      await stores.sourceFeedStates.upsert(nextState);
    }
  }

  return result;
}
