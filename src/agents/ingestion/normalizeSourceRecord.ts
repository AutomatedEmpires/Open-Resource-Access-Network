/**
 * Normalization Bridge — source_record → canonical entity.
 *
 * Takes a parsed source record (Zone A) and creates or updates the
 * corresponding canonical organization, service, and location(s)
 * (Zone B). Records field-level provenance for every mapped field.
 *
 * Supports HSDS-compatible payloads and generic key/value payloads.
 */

import type { IngestionStores } from './stores';
import type {
  SourceRecordRow,
  NewCanonicalOrganizationRow,
  NewCanonicalServiceRow,
  NewCanonicalLocationRow,
  NewCanonicalProvenanceRow,
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
  // Single object → wrap in array
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

function buildProvenanceRows(
  entityType: string,
  entityId: string,
  mappedFields: Record<string, unknown>,
  sourceRecordId: string,
  confidenceHint: number,
): NewCanonicalProvenanceRow[] {
  return Object.entries(mappedFields).map(([fieldName, value]) => ({
    canonicalEntityType: entityType,
    canonicalEntityId: entityId,
    fieldName,
    assertedValue: value as Record<string, unknown> | string | number | boolean,
    sourceRecordId,
    confidenceHint,
    decisionStatus: 'accepted' as const,
    decidedAt: new Date(),
    decidedBy: 'normalization-bridge',
  }));
}

// ── Main function ─────────────────────────────────────────────

/**
 * Normalize a raw source record into canonical entities (org, services, locations).
 *
 * Note: It is valid for a source record to produce zero services (e.g. an
 * organization-only listing) or zero locations (e.g. a virtual/remote service).
 * Both cases emit a diagnostic `console.warn` but are **not** errors.
 */
export async function normalizeSourceRecord(
  options: NormalizeSourceRecordOptions,
): Promise<NormalizationResult> {
  const { stores, sourceRecord, trustTier } = options;
  const payload = getPayload(sourceRecord);
  const confidenceHint = confidenceForTrustTier(trustTier, options.trustTierConfidence);

  const provenanceRows: NewCanonicalProvenanceRow[] = [];
  const canonicalServiceIds: string[] = [];
  const canonicalLocationIds: string[] = [];

  // ── 1. Organization ───────────────────────────────────────
  const orgPayload = extractSection(payload, 'organization') ?? payload;
  const rawOrgName = (orgPayload['name'] as string) ?? (payload['organization_name'] as string);
  const orgName = rawOrgName?.trim() || null;
  if (!orgName) {
    throw new Error(
      `Source record ${sourceRecord.id} has no organization name — cannot normalize`,
    );
  }

  const orgMapped = mapFields(orgPayload, ORG_FIELDS, true);
  const orgRow: NewCanonicalOrganizationRow = {
    name: orgName,
    ...(orgMapped as Partial<NewCanonicalOrganizationRow>),
    lifecycleStatus: 'active',
    publicationStatus: 'unpublished',
    sourceCount: 1,
    sourceConfidenceSummary: { overall: confidenceHint },
  };

  const canonicalOrg = await stores.canonicalOrganizations.create(orgRow);

  provenanceRows.push(
    ...buildProvenanceRows(
      'organization',
      canonicalOrg.id,
      orgMapped,
      sourceRecord.id,
      confidenceHint,
    ),
  );

  // ── 2. Service(s) ────────────────────────────────────────
  const servicePayloads = extractArray(payload, 'services');
  // Fallback: if top-level keys have service-like shape, treat as single service
  if (servicePayloads.length === 0) {
    const singleService = extractSection(payload, 'service') ?? payload;
    const svcName = (singleService['name'] as string) ??
      (payload['service_name'] as string) ?? orgName;
    if (svcName) {
      servicePayloads.push({ name: svcName, ...singleService });
    }
  }

  for (const svcPayload of servicePayloads) {
    const svcMapped = mapFields(svcPayload, SERVICE_FIELDS, true);
    const rawSvcName = (svcMapped['name'] as string)?.trim() || null;
    const svcName = rawSvcName ?? `[Service] ${orgName}`;

    const svcRow: NewCanonicalServiceRow = {
      canonicalOrganizationId: canonicalOrg.id,
      name: svcName,
      ...(svcMapped as Partial<NewCanonicalServiceRow>),
      lifecycleStatus: 'active',
      publicationStatus: 'unpublished',
      sourceCount: 1,
      sourceConfidenceSummary: { overall: confidenceHint },
    };

    const canonicalSvc = await stores.canonicalServices.create(svcRow);
    canonicalServiceIds.push(canonicalSvc.id);

    provenanceRows.push(
      ...buildProvenanceRows(
        'service',
        canonicalSvc.id,
        svcMapped,
        sourceRecord.id,
        confidenceHint,
      ),
    );
  }

  // ── 3. Location(s) ───────────────────────────────────────
  const locationPayloads = extractArray(payload, 'locations');
  if (locationPayloads.length === 0) {
    const singleLoc = extractSection(payload, 'location');
    if (singleLoc) {
      locationPayloads.push(singleLoc);
    }
  }

  for (const locPayload of locationPayloads) {
    const locMapped = mapFields(locPayload, LOCATION_FIELDS, true);

    // Only create if we have at least a name or an address
    const hasContent = locMapped['name'] || locMapped['addressLine1'] ||
      locMapped['latitude'];
    if (!hasContent) continue;

    const locRow: NewCanonicalLocationRow = {
      canonicalOrganizationId: canonicalOrg.id,
      ...(locMapped as Partial<NewCanonicalLocationRow>),
      lifecycleStatus: 'active',
      publicationStatus: 'unpublished',
      sourceCount: 1,
      sourceConfidenceSummary: {},
    };

    const canonicalLoc = await stores.canonicalLocations.create(locRow);
    canonicalLocationIds.push(canonicalLoc.id);

    provenanceRows.push(
      ...buildProvenanceRows(
        'location',
        canonicalLoc.id,
        locMapped,
        sourceRecord.id,
        confidenceHint,
      ),
    );

    // Link each service to each location (batch)
    const junctionRows = canonicalServiceIds.flatMap((svcId) =>
      [{ canonicalServiceId: svcId, canonicalLocationId: canonicalLoc.id }],
    );
    if (junctionRows.length > 0) {
      await stores.canonicalServiceLocations.bulkCreate(junctionRows);
    }
  }

  // ── 4. Persist provenance ─────────────────────────────────
  if (provenanceRows.length > 0) {
    await stores.canonicalProvenance.bulkCreate(provenanceRows);
  }

  // ── 5. Warn if no locations were extracted ────────────────
  if (canonicalLocationIds.length === 0) {
    console.warn(
      `[normalizeSourceRecord] Source record ${sourceRecord.id} produced zero locations`,
    );
  }

  // ── 6. Mark source record as processed ────────────────────
  await stores.sourceRecords.updateStatus(sourceRecord.id, 'normalized');

  return {
    canonicalOrganizationId: canonicalOrg.id,
    canonicalServiceIds,
    canonicalLocationIds,
    provenanceRecordsCreated: provenanceRows.length,
  };
}
