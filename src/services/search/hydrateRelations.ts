/**
 * Batch relation hydration for detail-style retrieval paths.
 *
 * The paged search() hot path intentionally returns lean rows; consumers that
 * present a full record (service detail via /api/services, chat cards) need
 * phones, schedules, taxonomy, eligibility, documents, languages, service
 * areas, contacts, attributes, and location accessibility. Without this step
 * those fields are structurally empty on the live path and the UI renders
 * "not listed" states even when data exists.
 *
 * All lookups are parameterized batch queries over indexed foreign keys.
 */

import type {
  AccessibilityForDisabilities,
  Contact,
  Eligibility,
  EnrichedService,
  Language,
  Phone,
  RequiredDocument,
  Schedule,
  ServiceArea,
  ServiceAttribute,
  TaxonomyTerm,
} from '@/domain/types';

export interface HydrationDeps {
  executeQuery: <T>(sql: string, params: unknown[]) => Promise<T[]>;
}

type Row = Record<string, unknown>;

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function groupBy<T>(rows: Row[], key: string, map: (row: Row) => T): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const groupKey = row[key];
    if (typeof groupKey !== 'string') continue;
    const bucket = grouped.get(groupKey);
    if (bucket) {
      bucket.push(map(row));
    } else {
      grouped.set(groupKey, [map(row)]);
    }
  }
  return grouped;
}

const PHONES_SQL = `SELECT id, service_id, location_id, organization_id, number, extension, type, language, description
  FROM phones WHERE service_id = ANY($1::uuid[])`;

const SCHEDULES_SQL = `SELECT id, service_id, location_id, valid_from, valid_to, dtstart, until, wkst, days, opens_at, closes_at, description
  FROM schedules WHERE service_id = ANY($1::uuid[])`;

const TAXONOMY_SQL = `SELECT st.service_id, tt.id, tt.term, tt.description, tt.parent_id, tt.taxonomy, tt.created_at
  FROM service_taxonomy st
  JOIN taxonomy_terms tt ON tt.id = st.taxonomy_term_id
  WHERE st.service_id = ANY($1::uuid[])`;

const ELIGIBILITY_SQL = `SELECT id, service_id, description, minimum_age, maximum_age, eligible_values, household_size_min, household_size_max, created_at, updated_at
  FROM eligibility WHERE service_id = ANY($1::uuid[])`;

const DOCUMENTS_SQL = `SELECT id, service_id, document, type, uri, created_at, updated_at
  FROM required_documents WHERE service_id = ANY($1::uuid[])`;

const LANGUAGES_SQL = `SELECT id, service_id, location_id, language, note, created_at, updated_at
  FROM languages WHERE service_id = ANY($1::uuid[])`;

const SERVICE_AREAS_SQL = `SELECT id, service_id, name, description, extent_type, created_at, updated_at
  FROM service_areas WHERE service_id = ANY($1::uuid[])`;

const CONTACTS_SQL = `SELECT id, service_id, location_id, organization_id, name, title, department, email, created_at, updated_at
  FROM contacts WHERE service_id = ANY($1::uuid[])`;

const ATTRIBUTES_SQL = `SELECT id, service_id, taxonomy, tag, details, created_at, updated_at
  FROM service_attributes WHERE service_id = ANY($1::uuid[])`;

const ACCESSIBILITY_SQL = `SELECT id, location_id, accessibility, details, created_at, updated_at
  FROM accessibility_for_disabilities WHERE location_id = ANY($1::uuid[])`;

/** Card-tier caps — the paged path ships only what a result card renders. */
const CARD_TIER_MAX_TAXONOMY_TERMS = 3;

const CARD_PHONES_SQL = `SELECT id, service_id, location_id, organization_id, number, extension, type, language, description
  FROM phones
  WHERE service_id = ANY($1::uuid[])
     OR location_id = ANY($2::uuid[])
     OR organization_id = ANY($3::uuid[])
  ORDER BY id`;

const CARD_SCHEDULES_SQL = `SELECT id, service_id, location_id, description
  FROM schedules
  WHERE (service_id = ANY($1::uuid[]) OR location_id = ANY($2::uuid[]))
    AND description IS NOT NULL
  ORDER BY id`;

function mapPhoneRow(row: Row): Phone {
  return {
    id: row.id as string,
    serviceId: (row.service_id as string | null) ?? null,
    locationId: (row.location_id as string | null) ?? null,
    organizationId: (row.organization_id as string | null) ?? null,
    number: row.number as string,
    extension: (row.extension as string | null) ?? null,
    type: (row.type as Phone['type']) ?? null,
    language: (row.language as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

/**
 * Card-tier hydration for the paged search path.
 *
 * Result cards need a callable phone number, an hours line, and a few
 * category labels — without this the directory/map/scroll cards could NEVER
 * show a phone or hours while the identical component was fully populated on
 * saved/detail (and live records resorted to pasting hotline numbers into
 * descriptions).
 *
 * Honest phone fallback chain per record: a service-scoped phone first, else
 * a phone on the record's own location, else an organization phone. Schedules
 * fall back service → location. Taxonomy labels are capped at
 * CARD_TIER_MAX_TAXONOMY_TERMS. Everything is a bounded parameterized batch
 * over the page's ids (three queries per uncached page).
 */
export async function hydrateCardTier(
  deps: HydrationDeps,
  services: EnrichedService[],
): Promise<EnrichedService[]> {
  if (services.length === 0) {
    return [];
  }

  const serviceIds = [...new Set(services.map((s) => s.service.id))];
  const locationIds = [...new Set(
    services.map((s) => s.location?.id).filter((id): id is string => Boolean(id)),
  )];
  const organizationIds = [...new Set(services.map((s) => s.organization.id))];

  const [phoneRows, scheduleRows, taxonomyRows] = await Promise.all([
    deps.executeQuery<Row>(CARD_PHONES_SQL, [serviceIds, locationIds, organizationIds]),
    deps.executeQuery<Row>(CARD_SCHEDULES_SQL, [serviceIds, locationIds]),
    deps.executeQuery<Row>(TAXONOMY_SQL, [serviceIds]),
  ]);

  const phonesByService = new Map<string, Phone>();
  const phonesByLocation = new Map<string, Phone>();
  const phonesByOrganization = new Map<string, Phone>();
  for (const row of phoneRows) {
    const phone = mapPhoneRow(row);
    if (phone.serviceId && !phonesByService.has(phone.serviceId)) {
      phonesByService.set(phone.serviceId, phone);
    } else if (phone.locationId && !phonesByLocation.has(phone.locationId)) {
      phonesByLocation.set(phone.locationId, phone);
    } else if (phone.organizationId && !phonesByOrganization.has(phone.organizationId)) {
      phonesByOrganization.set(phone.organizationId, phone);
    }
  }

  const scheduleByService = new Map<string, Schedule>();
  const scheduleByLocation = new Map<string, Schedule>();
  for (const row of scheduleRows) {
    const schedule: Schedule = {
      id: row.id as string,
      serviceId: (row.service_id as string | null) ?? null,
      locationId: (row.location_id as string | null) ?? null,
      validFrom: null,
      validTo: null,
      dtstart: null,
      until: null,
      wkst: null,
      days: null,
      opensAt: null,
      closesAt: null,
      description: (row.description as string | null) ?? null,
      createdAt: asDate(row.created_at),
      updatedAt: asDate(row.updated_at),
    };
    if (schedule.serviceId && !scheduleByService.has(schedule.serviceId)) {
      scheduleByService.set(schedule.serviceId, schedule);
    } else if (schedule.locationId && !scheduleByLocation.has(schedule.locationId)) {
      scheduleByLocation.set(schedule.locationId, schedule);
    }
  }

  const taxonomyByService = groupBy<TaxonomyTerm>(taxonomyRows, 'service_id', (row) => ({
    id: row.id as string,
    term: row.term as string,
    description: (row.description as string | null) ?? null,
    parentId: (row.parent_id as string | null) ?? null,
    taxonomy: (row.taxonomy as string | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  return services.map((service) => {
    const serviceId = service.service.id;
    const locationId = service.location?.id ?? null;
    const organizationId = service.organization.id;

    const phone =
      phonesByService.get(serviceId)
      ?? (locationId ? phonesByLocation.get(locationId) : undefined)
      ?? phonesByOrganization.get(organizationId);

    const schedule =
      scheduleByService.get(serviceId)
      ?? (locationId ? scheduleByLocation.get(locationId) : undefined);

    return {
      ...service,
      phones: phone ? [phone] : [],
      schedules: schedule ? [schedule] : [],
      taxonomyTerms: (taxonomyByService.get(serviceId) ?? []).slice(0, CARD_TIER_MAX_TAXONOMY_TERMS),
    };
  });
}

/**
 * Hydrate relation collections for a batch of enriched services. Returns new
 * objects in the same order; input is not mutated. Intended for by-ids /
 * card-assembly paths only (bounded batch sizes), never the paged search.
 */
export async function hydrateEnrichedServices(
  deps: HydrationDeps,
  services: EnrichedService[],
): Promise<EnrichedService[]> {
  if (services.length === 0) {
    return [];
  }

  const serviceIds = [...new Set(services.map((s) => s.service.id))];
  const locationIds = [...new Set(
    services.map((s) => s.location?.id).filter((id): id is string => Boolean(id)),
  )];

  const [
    phoneRows, scheduleRows, taxonomyRows, eligibilityRows, documentRows,
    languageRows, areaRows, contactRows, attributeRows, accessibilityRows,
  ] = await Promise.all([
    deps.executeQuery<Row>(PHONES_SQL, [serviceIds]),
    deps.executeQuery<Row>(SCHEDULES_SQL, [serviceIds]),
    deps.executeQuery<Row>(TAXONOMY_SQL, [serviceIds]),
    deps.executeQuery<Row>(ELIGIBILITY_SQL, [serviceIds]),
    deps.executeQuery<Row>(DOCUMENTS_SQL, [serviceIds]),
    deps.executeQuery<Row>(LANGUAGES_SQL, [serviceIds]),
    deps.executeQuery<Row>(SERVICE_AREAS_SQL, [serviceIds]),
    deps.executeQuery<Row>(CONTACTS_SQL, [serviceIds]),
    deps.executeQuery<Row>(ATTRIBUTES_SQL, [serviceIds]),
    locationIds.length > 0
      ? deps.executeQuery<Row>(ACCESSIBILITY_SQL, [locationIds])
      : Promise.resolve([] as Row[]),
  ]);

  const phones = groupBy<Phone>(phoneRows, 'service_id', (row) => ({
    id: row.id as string,
    serviceId: (row.service_id as string | null) ?? null,
    locationId: (row.location_id as string | null) ?? null,
    organizationId: (row.organization_id as string | null) ?? null,
    number: row.number as string,
    extension: (row.extension as string | null) ?? null,
    type: (row.type as Phone['type']) ?? null,
    language: (row.language as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  const schedules = groupBy<Schedule>(scheduleRows, 'service_id', (row) => ({
    id: row.id as string,
    serviceId: (row.service_id as string | null) ?? null,
    locationId: (row.location_id as string | null) ?? null,
    validFrom: row.valid_from ? asDate(row.valid_from) : null,
    validTo: row.valid_to ? asDate(row.valid_to) : null,
    dtstart: (row.dtstart as string | null) ?? null,
    until: (row.until as string | null) ?? null,
    wkst: (row.wkst as string | null) ?? null,
    days: (row.days as string[] | null) ?? null,
    opensAt: (row.opens_at as string | null) ?? null,
    closesAt: (row.closes_at as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  const taxonomyTerms = groupBy<TaxonomyTerm>(taxonomyRows, 'service_id', (row) => ({
    id: row.id as string,
    term: row.term as string,
    description: (row.description as string | null) ?? null,
    parentId: (row.parent_id as string | null) ?? null,
    taxonomy: (row.taxonomy as string | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  const eligibility = groupBy<Eligibility>(eligibilityRows, 'service_id', (row) => ({
    id: row.id as string,
    serviceId: row.service_id as string,
    description: row.description as string,
    minimumAge: (row.minimum_age as number | null) ?? null,
    maximumAge: (row.maximum_age as number | null) ?? null,
    eligibleValues: (row.eligible_values as string[] | null) ?? null,
    householdSizeMin: (row.household_size_min as number | null) ?? null,
    householdSizeMax: (row.household_size_max as number | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  const requiredDocuments = groupBy<RequiredDocument>(documentRows, 'service_id', (row) => ({
    id: row.id as string,
    serviceId: row.service_id as string,
    document: row.document as string,
    type: (row.type as string | null) ?? null,
    uri: (row.uri as string | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  const languages = groupBy<Language>(languageRows, 'service_id', (row) => ({
    id: row.id as string,
    serviceId: (row.service_id as string | null) ?? null,
    locationId: (row.location_id as string | null) ?? null,
    language: row.language as string,
    note: (row.note as string | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  const serviceAreas = groupBy<ServiceArea>(areaRows, 'service_id', (row) => ({
    id: row.id as string,
    serviceId: row.service_id as string,
    name: (row.name as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    extentType: (row.extent_type as ServiceArea['extentType']) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  const contacts = groupBy<Contact>(contactRows, 'service_id', (row) => ({
    id: row.id as string,
    serviceId: (row.service_id as string | null) ?? null,
    locationId: (row.location_id as string | null) ?? null,
    organizationId: (row.organization_id as string | null) ?? null,
    name: (row.name as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    department: (row.department as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  const attributes = groupBy<ServiceAttribute>(attributeRows, 'service_id', (row) => ({
    id: row.id as string,
    serviceId: row.service_id as string,
    taxonomy: row.taxonomy as ServiceAttribute['taxonomy'],
    tag: row.tag as string,
    details: (row.details as string | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  const accessibility = groupBy<AccessibilityForDisabilities>(accessibilityRows, 'location_id', (row) => ({
    id: row.id as string,
    locationId: row.location_id as string,
    accessibility: row.accessibility as string,
    details: (row.details as string | null) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  return services.map((service) => {
    const serviceId = service.service.id;
    const locationId = service.location?.id;
    return {
      ...service,
      phones: phones.get(serviceId) ?? [],
      schedules: schedules.get(serviceId) ?? [],
      taxonomyTerms: taxonomyTerms.get(serviceId) ?? [],
      eligibility: eligibility.get(serviceId) ?? [],
      requiredDocuments: requiredDocuments.get(serviceId) ?? [],
      languages: languages.get(serviceId) ?? [],
      serviceAreas: serviceAreas.get(serviceId) ?? [],
      contacts: contacts.get(serviceId) ?? [],
      attributes: attributes.get(serviceId) ?? [],
      accessibility: locationId ? (accessibility.get(locationId) ?? []) : [],
    };
  });
}
