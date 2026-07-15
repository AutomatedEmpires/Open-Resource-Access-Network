/**
 * Normalization Bridge — source_record → canonical entity.
 *
 * Takes a parsed source record (Zone A) and creates the corresponding
 * canonical organization, service, and location(s) (Zone B). Records
 * field-level provenance for every mapped field.
 *
 * Materialization is deliberately single-shot: the source assertion is locked
 * and claimed in the same transaction as every canonical write. Canonical IDs
 * are UUIDv5 values derived from the immutable source-record identity, so a
 * rolled-back attempt and its retry target exactly the same rows.
 */

import { createHash } from 'node:crypto';

import type { IngestionStores } from './stores';
import type {
  SourceRecordRow,
  NewCanonicalOrganizationRow,
  NewCanonicalServiceRow,
  NewCanonicalLocationRow,
  NewCanonicalProvenanceRow,
  NewCanonicalServiceLocationRow,
} from '@/db/schema';

// ── Public types ──────────────────────────────────────────────

export interface NormalizationResult {
  canonicalOrganizationId: string;
  canonicalServiceIds: string[];
  canonicalLocationIds: string[];
  provenanceRecordsCreated: number;
}

export interface NormalizeSourceRecordOptions {
  stores: IngestionStores;
  sourceRecord: SourceRecordRow;
  /** Source system trust tier (for confidence hint). */
  trustTier?: string;
  /** Optional overrides for trust tier → confidence mapping. */
  trustTierConfidence?: Record<string, number>;
}

interface SourceRecordNormalizationClaimKey {
  id: string;
  sourceFeedId: string;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
}

interface NormalizationClaimStore {
  claimPendingForNormalization(
    expected: SourceRecordNormalizationClaimKey,
  ): Promise<{ claimed: boolean; sourceRecord: SourceRecordRow }>;
}

interface PlannedEntity {
  id: string;
  ordinal: number;
  mappedFields: Record<string, unknown>;
}

interface PlannedOrganization extends PlannedEntity {
  name: string;
}

interface PlannedService extends PlannedEntity {
  name: string;
}

interface NormalizationPlan {
  organization: PlannedOrganization;
  services: PlannedService[];
  locations: PlannedEntity[];
}

// This stable namespace is owned by ORAN's source-record normalization bridge.
// Changing it would change every materialized canonical ID.
const NORMALIZATION_ID_NAMESPACE = 'e27f3f0c-1dc8-5c47-8c35-60c4f1861ae3';

// ── Field mapping helpers ─────────────────────────────────────

/** Standard HSDS organization fields we extract from payloads. */
const ORG_FIELDS = [
  'name', 'alternate_name', 'description', 'url', 'email',
  'phone', 'tax_status', 'tax_id', 'year_incorporated', 'legal_status',
] as const;

/** Standard HSDS service fields. */
const SERVICE_FIELDS = [
  'name', 'alternate_name', 'description', 'url', 'email', 'phone',
  'status', 'interpretation_services', 'application_process',
  'wait_time', 'fees', 'accreditations', 'licenses',
] as const;

/** Standard location fields. */
const LOCATION_FIELDS = [
  'name', 'alternate_name', 'description', 'transportation',
  'latitude', 'longitude',
  'address_1', 'address_2', 'city', 'region', 'postal_code', 'country',
] as const;

const SNAKE_TO_CAMEL: Record<string, string> = {
  alternate_name: 'alternateName',
  tax_status: 'taxStatus',
  tax_id: 'taxId',
  year_incorporated: 'yearIncorporated',
  legal_status: 'legalStatus',
  interpretation_services: 'interpretationServices',
  application_process: 'applicationProcess',
  wait_time: 'waitTime',
  address_1: 'addressLine1',
  address_2: 'addressLine2',
  city: 'addressCity',
  region: 'addressRegion',
  postal_code: 'addressPostalCode',
  country: 'addressCountry',
};

function snakeToCamel(field: string): string {
  return SNAKE_TO_CAMEL[field] ?? field;
}

function getPayload(record: SourceRecordRow): Record<string, unknown> {
  const parsed = record.parsedPayload as Record<string, unknown> | null;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }
  const raw = record.rawPayload as Record<string, unknown>;
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function extractSection(
  payload: Record<string, unknown>,
  section: string,
): Record<string, unknown> | null {
  const val = payload[section];
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return null;
}

function extractArray(
  payload: Record<string, unknown>,
  section: string,
): Array<Record<string, unknown>> {
  const val = payload[section];
  if (Array.isArray(val)) {
    return val.filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object' && !Array.isArray(item),
    );
  }
  const single = extractSection(payload, section);
  return single ? [single] : [];
}

function envInt(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env[name] : undefined;
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Default confidence scores per trust tier. Export for overrides. */
export const TRUST_TIER_CONFIDENCE: Record<string, number> = {
  verified_publisher: envInt('ORAN_TRUST_VERIFIED_PUBLISHER', 90),
  trusted_partner: envInt('ORAN_TRUST_TRUSTED_PARTNER', 80),
  curated: envInt('ORAN_TRUST_CURATED', 75),
  community: envInt('ORAN_TRUST_COMMUNITY', 50),
  quarantine: envInt('ORAN_TRUST_QUARANTINE', 30),
  blocked: 0,
};

function confidenceForTrustTier(
  tier?: string,
  overrides?: Record<string, number>,
): number {
  const map = overrides ? { ...TRUST_TIER_CONFIDENCE, ...overrides } : TRUST_TIER_CONFIDENCE;
  return tier && tier in map ? map[tier] : (map['community'] ?? 50);
}

function mapFields(
  source: Record<string, unknown>,
  fieldNames: readonly string[],
  camelCase: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fieldNames) {
    const value = source[field];
    if (value !== undefined && value !== null && value !== '') {
      const key = camelCase ? snakeToCamel(field) : field;
      result[key] = value;
    }
  }
  return result;
}

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error(`Invalid UUID namespace: ${uuid}`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** RFC 4122 UUIDv5 without adding a runtime dependency. */
function deterministicUuid(name: string): string {
  const digest = createHash('sha1')
    .update(uuidBytes(NORMALIZATION_ID_NAMESPACE))
    .update(name, 'utf8')
    .digest();

  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;

  const hex = digest.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function entityId(sourceRecordId: string, entityType: string, ordinal: number): string {
  return deterministicUuid(`source-record:${sourceRecordId}:${entityType}:${ordinal}`);
}

function buildNormalizationPlan(sourceRecord: SourceRecordRow): NormalizationPlan {
  const payload = getPayload(sourceRecord);

  const orgPayload = extractSection(payload, 'organization') ?? payload;
  const rawOrgName = (orgPayload['name'] as string) ?? (payload['organization_name'] as string);
  const orgName = rawOrgName?.trim() || null;
  if (!orgName) {
    throw new Error(
      `Source record ${sourceRecord.id} has no organization name — cannot normalize`,
    );
  }

  const orgMapped = mapFields(orgPayload, ORG_FIELDS, true);
  const organization: PlannedOrganization = {
    id: entityId(sourceRecord.id, 'organization', 0),
    ordinal: 0,
    name: orgName,
    // Include normalized fallback names in provenance, not only source fields.
    mappedFields: { ...orgMapped, name: orgName },
  };

  const servicePayloads = extractArray(payload, 'services');
  if (servicePayloads.length === 0) {
    const singleService = extractSection(payload, 'service') ?? payload;
    const svcName = (singleService['name'] as string)
      ?? (payload['service_name'] as string)
      ?? orgName;
    if (svcName) {
      servicePayloads.push({ name: svcName, ...singleService });
    }
  }

  const services = servicePayloads.map((svcPayload, ordinal): PlannedService => {
    const svcMapped = mapFields(svcPayload, SERVICE_FIELDS, true);
    const rawSvcName = (svcMapped['name'] as string)?.trim() || null;
    const name = rawSvcName ?? `[Service] ${orgName}`;
    return {
      id: entityId(sourceRecord.id, 'service', ordinal),
      ordinal,
      name,
      mappedFields: { ...svcMapped, name },
    };
  });

  const locationPayloads = extractArray(payload, 'locations');
  if (locationPayloads.length === 0) {
    const singleLocation = extractSection(payload, 'location');
    if (singleLocation) locationPayloads.push(singleLocation);
  }

  const locations = locationPayloads.flatMap((locPayload, ordinal): PlannedEntity[] => {
    const mappedFields = mapFields(locPayload, LOCATION_FIELDS, true);
    const hasContent = mappedFields['name']
      || mappedFields['addressLine1']
      || mappedFields['latitude'];
    if (!hasContent) return [];
    return [{
      id: entityId(sourceRecord.id, 'location', ordinal),
      ordinal,
      mappedFields,
    }];
  });

  return { organization, services, locations };
}

function buildProvenanceRows(
  entityType: string,
  entity: PlannedEntity,
  sourceRecordId: string,
  confidenceHint: number,
): NewCanonicalProvenanceRow[] {
  return Object.entries(entity.mappedFields).map(([fieldName, value]) => ({
    id: deterministicUuid(
      `source-record:${sourceRecordId}:provenance:${entityType}:${entity.ordinal}:${fieldName}`,
    ),
    canonicalEntityType: entityType,
    canonicalEntityId: entity.id,
    fieldName,
    assertedValue: value as Record<string, unknown> | string | number | boolean,
    sourceRecordId,
    confidenceHint,
    decisionStatus: 'accepted' as const,
    decidedAt: new Date(),
    decidedBy: 'normalization-bridge',
  }));
}

function requireClaimStore(stores: IngestionStores): NormalizationClaimStore {
  const sourceRecords = stores.sourceRecords as typeof stores.sourceRecords
    & Partial<NormalizationClaimStore>;
  if (typeof sourceRecords.claimPendingForNormalization !== 'function') {
    throw new Error(
      'Normalization requires a transaction-bound source-record store with row-lock claiming',
    );
  }
  return sourceRecords as typeof stores.sourceRecords & NormalizationClaimStore;
}

function resultForPlan(plan: NormalizationPlan, provenanceRecordsCreated: number): NormalizationResult {
  return {
    canonicalOrganizationId: plan.organization.id,
    canonicalServiceIds: plan.services.map(({ id }) => id),
    canonicalLocationIds: plan.locations.map(({ id }) => id),
    provenanceRecordsCreated,
  };
}

function normalizationClaimKey(sourceRecord: SourceRecordRow): SourceRecordNormalizationClaimKey {
  return {
    id: sourceRecord.id,
    sourceFeedId: sourceRecord.sourceFeedId,
    sourceRecordType: sourceRecord.sourceRecordType,
    sourceRecordId: sourceRecord.sourceRecordId,
    payloadSha256: sourceRecord.payloadSha256,
  };
}

function assertCreatedId(entityType: string, expectedId: string, actualId: string): void {
  if (actualId !== expectedId) {
    throw new Error(
      `Canonical ${entityType} store did not preserve deterministic ID ${expectedId}`,
    );
  }
}

// ── Main function ─────────────────────────────────────────────

/**
 * Normalize a raw source record into canonical entities (org, services, locations).
 *
 * A normalized/published assertion is a successful idempotent replay and returns
 * the same deterministic IDs without performing writes. All other non-pending
 * states fail closed; callers must explicitly return failed assertions to pending
 * before retrying them.
 */
export async function normalizeSourceRecord(
  options: NormalizeSourceRecordOptions,
): Promise<NormalizationResult> {
  const { stores, sourceRecord, trustTier } = options;
  if (typeof stores.runAtomically !== 'function') {
    throw new Error('Normalization requires an atomic multi-store transaction');
  }

  // Build from the caller's view before locking. The 211 normalizer deliberately
  // supplies a reshaped parsed payload while retaining the immutable DB identity.
  const plan = buildNormalizationPlan(sourceRecord);
  const confidenceHint = confidenceForTrustTier(trustTier, options.trustTierConfidence);
  const provenanceRows = [
    ...buildProvenanceRows(
      'organization',
      plan.organization,
      sourceRecord.id,
      confidenceHint,
    ),
    ...plan.services.flatMap((service) => buildProvenanceRows(
      'service',
      service,
      sourceRecord.id,
      confidenceHint,
    )),
    ...plan.locations.flatMap((location) => buildProvenanceRows(
      'location',
      location,
      sourceRecord.id,
      confidenceHint,
    )),
  ];
  const plannedResult = resultForPlan(plan, provenanceRows.length);

  const result = await stores.runAtomically(async (atomicStores) => {
    const claim = await requireClaimStore(atomicStores)
      .claimPendingForNormalization(normalizationClaimKey(sourceRecord));

    if (!claim.claimed) {
      if (
        claim.sourceRecord.processingStatus === 'normalized'
        || claim.sourceRecord.processingStatus === 'published'
      ) {
        return plannedResult;
      }
      throw new Error(
        `Source record ${sourceRecord.id} cannot normalize from status `
        + `${claim.sourceRecord.processingStatus}`,
      );
    }

    const sourceFeed = await atomicStores.sourceFeeds.getById(claim.sourceRecord.sourceFeedId);
    if (!sourceFeed) {
      throw new Error(
        `Source record ${sourceRecord.id} references missing source feed `
        + `${claim.sourceRecord.sourceFeedId}`,
      );
    }
    const winningSourceSystemId = sourceFeed.sourceSystemId;

    const orgRow: NewCanonicalOrganizationRow = {
      ...(plan.organization.mappedFields as Partial<NewCanonicalOrganizationRow>),
      id: plan.organization.id,
      name: plan.organization.name,
      lifecycleStatus: 'active',
      publicationStatus: 'unpublished',
      winningSourceSystemId,
      sourceCount: 1,
      sourceConfidenceSummary: { overall: confidenceHint },
    };
    const canonicalOrg = await atomicStores.canonicalOrganizations.create(orgRow);
    assertCreatedId('organization', plan.organization.id, canonicalOrg.id);

    for (const service of plan.services) {
      const serviceRow: NewCanonicalServiceRow = {
        ...(service.mappedFields as Partial<NewCanonicalServiceRow>),
        id: service.id,
        canonicalOrganizationId: plan.organization.id,
        name: service.name,
        lifecycleStatus: 'active',
        publicationStatus: 'unpublished',
        winningSourceSystemId,
        sourceCount: 1,
        sourceConfidenceSummary: { overall: confidenceHint },
      };
      const createdService = await atomicStores.canonicalServices.create(serviceRow);
      assertCreatedId('service', service.id, createdService.id);
    }

    for (const location of plan.locations) {
      const locationRow: NewCanonicalLocationRow = {
        ...(location.mappedFields as Partial<NewCanonicalLocationRow>),
        id: location.id,
        canonicalOrganizationId: plan.organization.id,
        lifecycleStatus: 'active',
        publicationStatus: 'unpublished',
        winningSourceSystemId,
        sourceCount: 1,
        sourceConfidenceSummary: { overall: confidenceHint },
      };
      const createdLocation = await atomicStores.canonicalLocations.create(locationRow);
      assertCreatedId('location', location.id, createdLocation.id);

      const junctionRows: NewCanonicalServiceLocationRow[] = plan.services.map((service) => ({
        id: deterministicUuid(
          `source-record:${sourceRecord.id}:service-location:`
          + `${service.ordinal}:${location.ordinal}`,
        ),
        canonicalServiceId: service.id,
        canonicalLocationId: location.id,
      }));
      if (junctionRows.length > 0) {
        await atomicStores.canonicalServiceLocations.bulkCreate(junctionRows);
      }
    }

    if (provenanceRows.length > 0) {
      await atomicStores.canonicalProvenance.bulkCreate(provenanceRows);
    }

    await atomicStores.sourceRecords.updateStatus(sourceRecord.id, 'normalized');
    return plannedResult;
  });

  if (result.canonicalLocationIds.length === 0) {
    console.warn(
      `[normalizeSourceRecord] Source record ${sourceRecord.id} produced zero locations`,
    );
  }

  return result;
}
