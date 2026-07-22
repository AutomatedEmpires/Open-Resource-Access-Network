import crypto from 'node:crypto';

export const HRSA_SITE_CSV_URL =
  'https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv';
export const HRSA_DATASET_PAGE_URL = 'https://data.hrsa.gov/topics/health-centers';
export const HRSA_TERMS_URL = 'https://data.hrsa.gov/data/data-sources';
export const HRSA_SOURCE_LICENSE =
  'HRSA public data; the HRSA data-source catalog states "Usage limitations: None."';

export const HRSA_WA_INCLUDED_SITE_TYPES = new Set([
  'Service Delivery Site',
  'Administrative/Service Delivery Site',
]);
export const HRSA_WA_ADMIN_ONLY_SITE_TYPE = 'Administrative';
export const HRSA_RELEASE_ACTOR = 'system:hrsa-wa-release';
export const HRSA_ADMIN_HOLD_REASON_PREFIX =
  'source_scope:excluded:hrsa_wa_administrative_only:';
export const HRSA_WITHDRAWAL_HOLD_REASON_PREFIX =
  'source_scope:withdrawn:hrsa_wa_snapshot:';

const IMPORT_NAMESPACE = 'a3f1c2e4-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const REQUIRED_HEADERS = [
  'Health Center Number',
  'BPHC Assigned Number',
  'Site Name',
  'Site Address',
  'Site City',
  'Site State Abbreviation',
  'Site Postal Code',
  'Site Telephone Number',
  'Site Web Address',
  'Operating Hours per Week',
  'Site Status Description',
  'Health Center Type Description',
  'Health Center Name',
  'Geocoding Artifact Address Primary X Coordinate',
  'Geocoding Artifact Address Primary Y Coordinate',
  'Complete County Name',
  'Data Warehouse Record Create Date',
] as const;

export type HrsaRawRow = Record<string, string>;

export interface HrsaSnapshotMetadata {
  retrievedAt: string;
  sha256: string;
  etag: string | null;
  lastModified: string | null;
  sourceUrl: string;
  datasetPageUrl: string;
  termsUrl: string;
  sourceLicense: string;
}

export interface HrsaWaSiteIdentity {
  siteId: string;
  healthCenterNumber: string;
  healthCenterName: string;
  siteName: string;
  siteType: string;
  siteStatus: string;
  sourceVersion: string | null;
  raw: HrsaRawRow;
}

export interface HrsaWaSite extends HrsaWaSiteIdentity {
  addressLine1: string;
  city: string;
  region: 'WA';
  postalCode: string;
  county: string;
  phone: string;
  explicitUrl: string | null;
  latitude: number;
  longitude: number;
  operatingHoursPerWeek: number;
}

export interface HrsaWaAdminOnlySite extends HrsaWaSiteIdentity {
  addressLine1: string | null;
  city: string | null;
  region: 'WA';
  postalCode: string | null;
  county: string | null;
  phone: string | null;
  explicitUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  operatingHoursPerWeek: number | null;
}

export interface HrsaWaCohort {
  included: HrsaWaSite[];
  adminOnly: HrsaWaAdminOnlySite[];
  inactiveWashingtonRows: HrsaRawRow[];
  inactiveWashingtonSites: HrsaWaAdminOnlySite[];
  unexpectedActiveSiteTypes: string[];
  totalRows: number;
  totalWashingtonRows: number;
}

export interface HrsaOrganizationFact {
  healthCenterNumber: string;
  name: string;
  url: null;
}

export interface HrsaSourceAssertion {
  sourceRecordId: string;
  sourceVersion: string | null;
  canonicalSourceUrl: string;
  payloadSha256: string;
  rawPayload: HrsaRawRow;
  parsedPayload: Record<string, unknown>;
  sourceLicense: string;
  sourceConfidenceSignals: Record<string, unknown>;
}

function requireText(row: HrsaRawRow, key: string, siteLabel: string): string {
  const value = row[key]?.trim() ?? '';
  if (!value) {
    throw new Error(`HRSA row ${siteLabel} is missing required field: ${key}`);
  }
  return value;
}

function requireCoordinate(row: HrsaRawRow, key: string, siteLabel: string): number {
  const value = Number(requireText(row, key, siteLabel));
  if (!Number.isFinite(value) || value === 0) {
    throw new Error(`HRSA row ${siteLabel} has invalid coordinate: ${key}`);
  }
  return value;
}

function requirePositiveNumber(row: HrsaRawRow, key: string, siteLabel: string): number {
  const value = Number(requireText(row, key, siteLabel));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`HRSA row ${siteLabel} has invalid positive number: ${key}`);
  }
  return value;
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function uuidV5(name: string, namespace = IMPORT_NAMESPACE): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const digest = crypto
    .createHash('sha1')
    // codeql[js/weak-cryptographic-algorithm] UUIDv5 mandates SHA-1 for a stable public-record ID, never a security digest.
    .update(Buffer.concat([namespaceBytes, Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function legacyHrsaIds(site: Pick<HrsaWaSiteIdentity, 'siteId' | 'healthCenterNumber'>) {
  const sourceKey = `hrsa:${site.siteId}`;
  return {
    organizationId: uuidV5(`org:hrsa:${site.healthCenterNumber}`),
    serviceId: uuidV5(`svc:${sourceKey}`),
    locationId: uuidV5(`loc:${sourceKey}`),
    addressId: uuidV5(`addr:${sourceKey}`),
    phoneId: uuidV5(`ph:${sourceKey}:0`),
    serviceLocationId: uuidV5(`sal:${sourceKey}`),
    confidenceScoreId: uuidV5(`cs:${sourceKey}`),
    serviceTaxonomyId: uuidV5(`stx:${sourceKey}:healthcare`),
  };
}

export function canonicalHrsaIds(site: Pick<HrsaWaSiteIdentity, 'siteId' | 'healthCenterNumber'>) {
  return {
    organizationId: uuidV5(`canonical-org:hrsa:${site.healthCenterNumber}`),
    serviceId: uuidV5(`canonical-service:hrsa:${site.siteId}`),
    locationId: uuidV5(`canonical-location:hrsa:${site.siteId}`),
    serviceLocationId: uuidV5(`canonical-service-location:hrsa:${site.siteId}`),
  };
}

/** Accept only an explicit HTTP(S) source value. Never infer a URL scheme. */
export function sourceProvidedHttpUrl(raw: string | null | undefined): string | null {
  const candidate = raw?.trim() ?? '';
  if (!/^https?:\/\//iu.test(candidate)) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.hostname ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** RFC-4180-compatible parsing for the HRSA CSV (including quoted newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (quoted) throw new Error('HRSA CSV ended inside a quoted field');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowObject(headers: string[], values: string[]): HrsaRawRow {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
}

function parseSite(row: HrsaRawRow): HrsaWaSite {
  const siteId = requireText(row, 'BPHC Assigned Number', '(unknown site)');
  const siteName = requireText(row, 'Site Name', siteId);
  const siteType = requireText(row, 'Health Center Type Description', siteId);
  return {
    siteId,
    healthCenterNumber: requireText(row, 'Health Center Number', siteId),
    healthCenterName: requireText(row, 'Health Center Name', siteId),
    siteName,
    siteType,
    siteStatus: requireText(row, 'Site Status Description', siteId),
    addressLine1: requireText(row, 'Site Address', siteId),
    city: requireText(row, 'Site City', siteId),
    region: 'WA',
    postalCode: requireText(row, 'Site Postal Code', siteId),
    county: requireText(row, 'Complete County Name', siteId),
    phone: requireText(row, 'Site Telephone Number', siteId),
    explicitUrl: sourceProvidedHttpUrl(row['Site Web Address']),
    latitude: requireCoordinate(
      row,
      'Geocoding Artifact Address Primary Y Coordinate',
      siteId,
    ),
    longitude: requireCoordinate(
      row,
      'Geocoding Artifact Address Primary X Coordinate',
      siteId,
    ),
    operatingHoursPerWeek: requirePositiveNumber(
      row,
      'Operating Hours per Week',
      siteId,
    ),
    sourceVersion: row['Data Warehouse Record Create Date']?.trim() || null,
    raw: row,
  };
}

function optionalNumber(raw: string | undefined): number | null {
  const value = Number(raw?.trim());
  return Number.isFinite(value) && value !== 0 ? value : null;
}

function parseAdminOnlySite(row: HrsaRawRow): HrsaWaAdminOnlySite {
  const siteId = requireText(row, 'BPHC Assigned Number', '(unknown site)');
  return {
    siteId,
    healthCenterNumber: requireText(row, 'Health Center Number', siteId),
    healthCenterName: requireText(row, 'Health Center Name', siteId),
    siteName: requireText(row, 'Site Name', siteId),
    siteType: requireText(row, 'Health Center Type Description', siteId),
    siteStatus: requireText(row, 'Site Status Description', siteId),
    sourceVersion: row['Data Warehouse Record Create Date']?.trim() || null,
    raw: row,
    addressLine1: row['Site Address']?.trim() || null,
    city: row['Site City']?.trim() || null,
    region: 'WA',
    postalCode: row['Site Postal Code']?.trim() || null,
    county: row['Complete County Name']?.trim() || null,
    phone: row['Site Telephone Number']?.trim() || null,
    explicitUrl: sourceProvidedHttpUrl(row['Site Web Address']),
    latitude: optionalNumber(row['Geocoding Artifact Address Primary Y Coordinate']),
    longitude: optionalNumber(row['Geocoding Artifact Address Primary X Coordinate']),
    operatingHoursPerWeek: optionalNumber(row['Operating Hours per Week']),
  };
}

function assertUniqueSiteIds(sites: HrsaWaSiteIdentity[], label: string): void {
  const seen = new Set<string>();
  for (const site of sites) {
    if (seen.has(site.siteId)) {
      throw new Error(`HRSA ${label} cohort contains duplicate BPHC ID ${site.siteId}`);
    }
    seen.add(site.siteId);
  }
}

export function parseHrsaWaSnapshot(text: string): HrsaWaCohort {
  const parsedRows = parseCsv(text);
  if (parsedRows.length < 2) throw new Error('HRSA CSV has no data rows');

  const headers = parsedRows[0].map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/u, '').trim() : header.trim(),
  );
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`HRSA CSV is missing required headers: ${missingHeaders.join(', ')}`);
  }

  const included: HrsaWaSite[] = [];
  const adminOnly: HrsaWaAdminOnlySite[] = [];
  const inactiveWashingtonRows: HrsaRawRow[] = [];
  const inactiveWashingtonSites: HrsaWaAdminOnlySite[] = [];
  const unexpectedTypes = new Set<string>();
  let totalWashingtonRows = 0;

  for (const values of parsedRows.slice(1)) {
    if (values.every((value) => value.trim() === '')) continue;
    const row = rowObject(headers, values);
    if (row['Site State Abbreviation']?.trim().toUpperCase() !== 'WA') continue;
    totalWashingtonRows += 1;

    if (row['Site Status Description']?.trim().toLowerCase() !== 'active') {
      inactiveWashingtonRows.push(row);
      inactiveWashingtonSites.push(parseAdminOnlySite(row));
      continue;
    }

    const type = row['Health Center Type Description']?.trim() ?? '';
    if (HRSA_WA_INCLUDED_SITE_TYPES.has(type)) {
      included.push(parseSite(row));
    } else if (type === HRSA_WA_ADMIN_ONLY_SITE_TYPE) {
      adminOnly.push(parseAdminOnlySite(row));
    } else {
      unexpectedTypes.add(type || '(blank)');
    }
  }

  assertUniqueSiteIds(included, 'included');
  assertUniqueSiteIds(adminOnly, 'administrative-only');
  assertUniqueSiteIds(inactiveWashingtonSites, 'inactive');
  const includedIds = new Set(included.map((site) => site.siteId));
  const overlap = adminOnly.find((site) => includedIds.has(site.siteId));
  if (overlap) throw new Error(`HRSA site ${overlap.siteId} appears in both release cohorts`);
  const inactiveOverlap = inactiveWashingtonSites.find(
    (site) => includedIds.has(site.siteId) || adminOnly.some((admin) => admin.siteId === site.siteId),
  );
  if (inactiveOverlap) {
    throw new Error(`HRSA site ${inactiveOverlap.siteId} appears in multiple release cohorts`);
  }

  return {
    included,
    adminOnly,
    inactiveWashingtonRows,
    inactiveWashingtonSites,
    unexpectedActiveSiteTypes: [...unexpectedTypes].sort(),
    totalRows: parsedRows.length - 1,
    totalWashingtonRows,
  };
}

export function assertExpectedHrsaWaCohort(
  cohort: HrsaWaCohort,
  expectedIncluded: number,
  expectedAdminOnly: number,
  expectedInactive = 0,
): void {
  if (cohort.unexpectedActiveSiteTypes.length > 0) {
    throw new Error(
      `HRSA WA contains unexpected active site types: ${cohort.unexpectedActiveSiteTypes.join(', ')}`,
    );
  }
  if (cohort.inactiveWashingtonRows.length !== expectedInactive) {
    throw new Error(
      `HRSA WA inactive cohort drift: expected ${expectedInactive}, found ${cohort.inactiveWashingtonRows.length}`,
    );
  }
  if (cohort.included.length !== expectedIncluded) {
    throw new Error(
      `HRSA WA included cohort drift: expected ${expectedIncluded}, found ${cohort.included.length}`,
    );
  }
  if (cohort.adminOnly.length !== expectedAdminOnly) {
    throw new Error(
      `HRSA WA administrative-only cohort drift: expected ${expectedAdminOnly}, found ${cohort.adminOnly.length}`,
    );
  }
}

/**
 * HRSA's file exposes a Site Web Address, not an organization-homepage field.
 * Preserve those URLs on services/source assertions, but never promote a
 * site-scoped value to the organization entity by inference.
 */
export function buildHrsaOrganizationFacts(cohort: HrsaWaCohort): HrsaOrganizationFact[] {
  const grouped = new Map<string, HrsaOrganizationFact>();
  for (const site of cohort.included) {
    const current = grouped.get(site.healthCenterNumber);
    if (current && current.name !== site.healthCenterName) {
      throw new Error(`HRSA organization-name drift for ${site.healthCenterNumber}`);
    }
    grouped.set(site.healthCenterNumber, {
      healthCenterNumber: site.healthCenterNumber,
      name: site.healthCenterName,
      url: null,
    });
  }
  return [...grouped.values()];
}

export function hrsaServiceName(site: HrsaWaSiteIdentity): string {
  return site.siteName;
}

export function hrsaServiceDescription(site: HrsaWaSiteIdentity): string {
  const sourceStatus = site.siteStatus.trim();
  const statusDescription = sourceStatus.toLowerCase() === 'active'
    ? `as an active ${site.siteType.toLowerCase()} in the Health Center Program.`
    : `with source type ${JSON.stringify(site.siteType)} and source status ${JSON.stringify(sourceStatus)}.`;
  return [
    `${site.siteName} is listed by the U.S. Health Resources and Services Administration`,
    statusDescription,
    'Contact the site to confirm current services, hours, costs, eligibility, and availability.',
  ].join(' ');
}

export function buildHrsaSourceAssertion(
  site: HrsaWaSite | HrsaWaAdminOnlySite,
  snapshot: HrsaSnapshotMetadata,
): HrsaSourceAssertion {
  const parsedPayload = {
    organization: {
      name: site.healthCenterName,
    },
    services: [
      {
        name: hrsaServiceName(site),
        description: hrsaServiceDescription(site),
        url: site.explicitUrl,
        status: site.siteStatus.trim().toLowerCase() === 'active' ? 'active' : 'inactive',
      },
    ],
    locations: [
      {
        name: site.siteName,
        latitude: site.latitude,
        longitude: site.longitude,
        address_1: site.addressLine1,
        city: site.city,
        region: site.region,
        postal_code: site.postalCode,
        country: 'US',
      },
    ],
    contacts: {
      phones: [{ number: site.phone, type: 'voice' }],
      website: site.explicitUrl,
    },
    sourceFacts: {
      bphcAssignedNumber: site.siteId,
      healthCenterNumber: site.healthCenterNumber,
      siteType: site.siteType,
      county: site.county,
      operatingHoursPerWeek: site.operatingHoursPerWeek,
    },
  };
  const payloadSha256 = sha256Hex(
    JSON.stringify({ snapshotSha256: snapshot.sha256, rawPayload: site.raw }),
  );
  return {
    sourceRecordId: site.siteId,
    sourceVersion: site.sourceVersion ?? snapshot.lastModified,
    canonicalSourceUrl: snapshot.sourceUrl,
    payloadSha256,
    rawPayload: site.raw,
    parsedPayload,
    sourceLicense: snapshot.sourceLicense,
    sourceConfidenceSignals: {
      authorityClass: 'government_service',
      trustTier: 'verified_publisher',
      family: 'government_open_data',
      jurisdiction: { country: 'US', state: 'WA' },
      snapshot: {
        sha256: snapshot.sha256,
        retrievedAt: snapshot.retrievedAt,
        etag: snapshot.etag,
        lastModified: snapshot.lastModified,
        sourceUrl: snapshot.sourceUrl,
        datasetPageUrl: snapshot.datasetPageUrl,
        termsUrl: snapshot.termsUrl,
        sourceLicense: snapshot.sourceLicense,
      },
    },
  };
}

export function buildHrsaSnapshotMetadata(input: {
  bytes: Buffer;
  retrievedAt: string;
  expectedSha256?: string;
  etag?: string | null;
  lastModified?: string | null;
}): HrsaSnapshotMetadata {
  const retrievedAt = new Date(input.retrievedAt);
  if (Number.isNaN(retrievedAt.valueOf())) throw new Error('retrievedAt must be an ISO timestamp');
  const sha256 = sha256Hex(input.bytes);
  if (input.expectedSha256 && sha256 !== input.expectedSha256.toLowerCase()) {
    throw new Error(`HRSA snapshot checksum drift: expected ${input.expectedSha256}, found ${sha256}`);
  }
  return {
    retrievedAt: retrievedAt.toISOString(),
    sha256,
    etag: input.etag?.trim() || null,
    lastModified: input.lastModified?.trim() || null,
    sourceUrl: HRSA_SITE_CSV_URL,
    datasetPageUrl: HRSA_DATASET_PAGE_URL,
    termsUrl: HRSA_TERMS_URL,
    sourceLicense: HRSA_SOURCE_LICENSE,
  };
}

export function hrsaHoldBatchSlug(snapshotSha256: string): string {
  return `hrsa-wa-administrative-only-${snapshotSha256.slice(0, 16)}`;
}

export function hrsaHoldReason(snapshotSha256: string): string {
  return `${HRSA_ADMIN_HOLD_REASON_PREFIX}${snapshotSha256.slice(0, 16)}`;
}

export function hrsaWithdrawalReason(snapshotSha256: string): string {
  return `${HRSA_WITHDRAWAL_HOLD_REASON_PREFIX}${snapshotSha256.slice(0, 16)}`;
}

export function isHrsaManagedHold(input: {
  status: string;
  integrityHoldReason: string | null;
  integrityHeldByUserId: string | null;
}): boolean {
  return input.status === 'inactive'
    && input.integrityHeldByUserId === HRSA_RELEASE_ACTOR
    && Boolean(
      input.integrityHoldReason?.startsWith(HRSA_ADMIN_HOLD_REASON_PREFIX)
      || input.integrityHoldReason?.startsWith(HRSA_WITHDRAWAL_HOLD_REASON_PREFIX),
    );
}
