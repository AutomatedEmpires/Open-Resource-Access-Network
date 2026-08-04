export interface PublicationDeps {
  executeQuery: <T>(sql: string, params: unknown[]) => Promise<T[]>;
  executeCount: (sql: string, params: unknown[]) => Promise<number>;
}

export const PUBLISHED_RECORD_STATUS = 'active' as const;
export const DEFAULT_PUBLICATION_PAGE_SIZE = 20;
export const MAX_PUBLICATION_PAGE_SIZE = 100;
export const SEEKER_PUBLISHABLE_RESOURCE_PURPOSES = [
  'service_catalog',
  'program_navigation',
] as const;
export const PUBLICATION_SAFETY_MODES = [
  'positive_authority',
  'deny_all',
] as const;

export type PublicationSafetyMode = (typeof PUBLICATION_SAFETY_MODES)[number];

/**
 * The only runtime override is a one-way emergency brake. Empty configuration
 * uses the affirmative authority gate; any unknown value fails closed.
 */
export function resolvePublicationSafetyMode(
  rawMode = process.env.ORAN_PUBLICATION_SAFETY_MODE,
): PublicationSafetyMode {
  const normalized = rawMode?.trim().toLowerCase();
  return !normalized || normalized === 'positive_authority'
    ? 'positive_authority'
    : 'deny_all';
}

export function buildIntegrityHoldPredicate(serviceAlias = 's'): string {
  return `${serviceAlias}.integrity_hold_at IS NULL`;
}

/**
 * Defense for the historical USDA retailer import that predates canonical
 * source-purpose provenance. New imports are stopped by purpose classification;
 * this signature keeps already-materialized retailer rows off every public path.
 */
export function buildLegacyRetailerExclusionPredicate(serviceAlias = 's'): string {
  return `NOT (
    ${serviceAlias}.name = 'SNAP/EBT accepted here'
    AND ${serviceAlias}.description LIKE '%Source: USDA FNS SNAP Retailer Locator.%'
    AND ${serviceAlias}.description LIKE '%place to SPEND SNAP benefits (not a free-food or food-bank site)%'
  )`;
}

function buildCanonicalAuthoritativeServiceIdsQuery(): string {
  const purposes = SEEKER_PUBLISHABLE_RESOURCE_PURPOSES
    .map((purpose) => `'${purpose}'`)
    .join(', ');

  return `SELECT publication_source.published_service_id AS service_id
    FROM public.canonical_services publication_source
    JOIN public.canonical_provenance publication_provenance
      ON publication_provenance.canonical_entity_type = 'service'
     AND publication_provenance.canonical_entity_id = publication_source.id
     AND publication_provenance.decision_status = 'accepted'
    JOIN public.source_records publication_record
      ON publication_record.id = publication_provenance.source_record_id
     AND publication_record.processing_status = 'published'
    JOIN public.source_feeds publication_feed
      ON publication_feed.id = publication_record.source_feed_id
     AND publication_feed.is_active IS TRUE
    JOIN public.source_systems publication_system
      ON publication_system.id = publication_feed.source_system_id
     AND publication_system.id = publication_source.winning_source_system_id
    WHERE publication_source.published_service_id IS NOT NULL
      AND publication_source.status = 'active'
      AND publication_source.lifecycle_status = 'active'
      AND publication_source.publication_status = 'published'
      AND publication_source.last_refreshed_at IS NOT NULL
      AND publication_system.is_active IS TRUE
      AND publication_system.family <> 'manual'
      AND publication_system.trust_tier IN (
        'verified_publisher',
        'trusted_partner',
        'curated',
        'community'
      )
      AND publication_system.resource_purpose IN (${purposes})`;
}

function buildApprovedManualAuthoritativeServiceIdsQuery(): string {
  return `SELECT publication_snapshot.entity_id AS service_id
    FROM public.hsds_export_snapshots publication_snapshot
    JOIN public.submissions publication_submission
      ON publication_submission.id::text = (publication_snapshot.hsds_payload #>> '{meta,sourceSubmissionId}')
     AND publication_submission.service_id = publication_snapshot.entity_id
     AND publication_submission.status = 'approved'
     AND publication_submission.submission_type IN (
       'new_service',
       'service_verification',
       'data_correction'
    )
    JOIN public.source_records publication_record
      ON publication_record.id::text = (publication_submission.payload ->> 'projectionSourceRecordId')
     AND publication_record.source_record_id = publication_submission.id::text
     AND publication_record.source_record_type = 'mixed_bundle'
     AND publication_record.processing_status = 'published'
     AND publication_record.parsed_payload #>> '{projection,serviceId}' = publication_snapshot.entity_id::text
    JOIN public.source_feeds publication_feed
      ON publication_feed.id = publication_record.source_feed_id
     AND publication_feed.is_active IS TRUE
     AND publication_feed.feed_type = 'manual_entry'
    JOIN public.source_systems publication_system
      ON publication_system.id = publication_feed.source_system_id
     AND publication_system.is_active IS TRUE
     AND publication_system.family = 'manual'
     AND publication_system.resource_purpose = 'service_catalog'
    WHERE publication_snapshot.entity_type = 'service'
      AND publication_snapshot.status = 'current'
      AND (
        (
          (publication_snapshot.hsds_payload #>> '{meta,publicationSourceKind}') = 'host_submission'
          AND publication_system.trust_tier = 'trusted_partner'
        )
        OR (
          (publication_snapshot.hsds_payload #>> '{meta,publicationSourceKind}') = 'community_review'
          AND publication_system.trust_tier = 'community'
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.submission_transitions publication_approval
        WHERE publication_approval.submission_id = publication_submission.id
          AND publication_approval.to_status = 'approved'
          AND publication_approval.gates_passed IS TRUE
          AND publication_approval.actor_role IN ('community_admin', 'oran_admin')
          AND publication_approval.actor_user_id <> publication_submission.submitted_by_user_id
      )`;
}

function buildTwoPersonCandidateAuthoritativeServiceIdsQuery(): string {
  const purposes = SEEKER_PUBLISHABLE_RESOURCE_PURPOSES
    .map((purpose) => `'${purpose}'`)
    .join(', ');

  // Read the additive decision column through the row JSON shape. Before 0077
  // the key is absent (count = 0) instead of making every seeker query fail at
  // SQL parse time; after 0078 only trigger-bound immutable values can qualify.
  return `SELECT candidate_snapshot.entity_id AS service_id
    FROM public.hsds_export_snapshots candidate_snapshot
    JOIN public.extracted_candidates published_candidate
      ON published_candidate.candidate_id = (candidate_snapshot.hsds_payload #>> '{meta,sourceCandidateId}')
     AND published_candidate.published_service_id = candidate_snapshot.entity_id
     AND published_candidate.review_status = 'published'
    JOIN public.source_systems candidate_system
      ON candidate_system.id::text = (candidate_snapshot.hsds_payload #>> '{meta,sourceSystemId}')
     AND candidate_system.is_active IS TRUE
    WHERE candidate_snapshot.entity_type = 'service'
      AND candidate_snapshot.status = 'current'
      AND (candidate_snapshot.hsds_payload #>> '{meta,publicationSourceKind}') = 'candidate_two_person_authoritative'
      AND CASE
        WHEN jsonb_typeof(candidate_snapshot.hsds_payload #> '{meta,approvalCount}') = 'number'
          THEN (candidate_snapshot.hsds_payload #>> '{meta,approvalCount}')::integer
        ELSE 0
      END >= 2
      AND candidate_system.trust_tier IN (
        'verified_publisher',
        'trusted_partner',
        'curated',
        'community'
      )
      AND candidate_system.resource_purpose IN (${purposes})
      AND (
        SELECT count(DISTINCT (
          to_jsonb(candidate_approval) ->> 'decision_reviewer_profile_id'
        ))
        FROM public.candidate_admin_assignments candidate_approval
        WHERE candidate_approval.candidate_id = published_candidate.candidate_id
          AND candidate_approval.status = 'completed'
          AND candidate_approval.outcome = 'verified'
      ) >= 2
      AND NOT EXISTS (
        SELECT 1
        FROM public.candidate_admin_assignments candidate_rejection
        WHERE candidate_rejection.candidate_id = published_candidate.candidate_id
          AND candidate_rejection.status = 'completed'
          AND candidate_rejection.outcome IN ('rejected', 'escalated')
      )`;
}

/**
 * Requires affirmative publication authority. A live row is not seeker-visible
 * merely because canonical provenance is absent: it must prove either the
 * canonical feed path, the approved manual-submission path, or immutable
 * two-person candidate publication evidence.
 */
export function buildPublishableSourcePredicate(
  serviceAlias = 's',
  safetyMode = resolvePublicationSafetyMode(),
): string {
  if (safetyMode === 'deny_all') {
    return 'FALSE /* ORAN_PUBLICATION_SAFETY_MODE deny_all */';
  }

  return `${serviceAlias}.id IN (
    ${buildCanonicalAuthoritativeServiceIdsQuery()}
    UNION
    ${buildApprovedManualAuthoritativeServiceIdsQuery()}
    UNION
    ${buildTwoPersonCandidateAuthoritativeServiceIdsQuery()}
  )`;
}

export function buildPublishableServiceRecordPredicate(serviceAlias = 's'): string {
  return `${serviceAlias}.status = '${PUBLISHED_RECORD_STATUS}' AND ${buildIntegrityHoldPredicate(serviceAlias)} AND ${buildPublishableSourcePredicate(serviceAlias)} AND ${buildLegacyRetailerExclusionPredicate(serviceAlias)}`;
}

export function buildPublishedServicePredicate(
  serviceAlias = 's',
  organizationAlias = 'o',
): string {
  return `${buildPublishableServiceRecordPredicate(serviceAlias)} AND ${organizationAlias}.status = '${PUBLISHED_RECORD_STATUS}'`;
}

export function buildPublishedOrganizationPredicate(organizationAlias = 'o'): string {
  return `${organizationAlias}.status = '${PUBLISHED_RECORD_STATUS}' AND EXISTS (
    SELECT 1
    FROM services published_service
    WHERE published_service.organization_id = ${organizationAlias}.id
      AND ${buildPublishableServiceRecordPredicate('published_service')}
  )`;
}

export function normalizePublicationPagination(
  rawPage: string | null,
  rawPerPage: string | null,
): { page: number; perPage: number; offset: number } {
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);
  const perPage = Math.min(
    MAX_PUBLICATION_PAGE_SIZE,
    Math.max(
      1,
      Number.parseInt(rawPerPage ?? String(DEFAULT_PUBLICATION_PAGE_SIZE), 10) || DEFAULT_PUBLICATION_PAGE_SIZE,
    ),
  );

  return {
    page,
    perPage,
    offset: (page - 1) * perPage,
  };
}

export async function listPublishedServicesPage(
  deps: PublicationDeps,
  pagination: { page: number; perPage: number; offset: number },
) {
  const totalItems = await deps.executeCount(
    `SELECT COUNT(DISTINCT s.id)::int AS count
     FROM services s
     JOIN organizations o ON o.id = s.organization_id
     WHERE ${buildPublishedServicePredicate('s', 'o')}`,
    [],
  );

  const contents = await deps.executeQuery<Record<string, unknown>>(
    `SELECT s.id, s.organization_id, s.name, s.alternate_name, s.description,
            s.url, s.email, s.status, s.interpretation_services, s.fees,
            s.accreditations, s.licenses, s.created_at, s.updated_at
     FROM services s
     JOIN organizations o ON o.id = s.organization_id
     WHERE ${buildPublishedServicePredicate('s', 'o')}
     ORDER BY s.updated_at DESC
     LIMIT $1 OFFSET $2`,
    [pagination.perPage, pagination.offset],
  );

  return {
    totalItems,
    totalPages: Math.ceil(totalItems / pagination.perPage),
    page: pagination.page,
    perPage: pagination.perPage,
    contents,
  };
}

export async function listPublishedOrganizationsPage(
  deps: PublicationDeps,
  pagination: { page: number; perPage: number; offset: number },
) {
  const totalItems = await deps.executeCount(
    `SELECT COUNT(*)::int AS count
     FROM organizations o
     WHERE ${buildPublishedOrganizationPredicate('o')}`,
    [],
  );

  const contents = await deps.executeQuery<Record<string, unknown>>(
    `SELECT o.id, o.name, o.description, o.url, o.email, o.tax_status,
            o.tax_id, o.year_incorporated, o.legal_status, o.logo_url,
            o.uri, o.status, o.created_at, o.updated_at
     FROM organizations o
     WHERE ${buildPublishedOrganizationPredicate('o')}
     ORDER BY o.updated_at DESC
     LIMIT $1 OFFSET $2`,
    [pagination.perPage, pagination.offset],
  );

  return {
    totalItems,
    totalPages: Math.ceil(totalItems / pagination.perPage),
    page: pagination.page,
    perPage: pagination.perPage,
    contents,
  };
}

export async function getPublishedServiceDetail(deps: PublicationDeps, serviceId: string) {
  const serviceRows = await deps.executeQuery<Record<string, unknown>>(
    `SELECT s.id, s.organization_id, s.name, s.alternate_name, s.description,
            s.url, s.email, s.status, s.interpretation_services, s.fees,
            s.accreditations, s.licenses, s.created_at, s.updated_at
     FROM services s
     JOIN organizations o ON o.id = s.organization_id
     WHERE s.id = $1 AND ${buildPublishedServicePredicate('s', 'o')}`,
    [serviceId],
  );

  const service = serviceRows[0];
  if (!service) {
    return null;
  }

  const organizationRows = await deps.executeQuery<Record<string, unknown>>(
    `SELECT o.id, o.name, o.description, o.url, o.email, o.status
     FROM organizations o
     WHERE o.id = $1 AND ${buildPublishedOrganizationPredicate('o')}`,
    [service.organization_id],
  );

  const locations = await deps.executeQuery<Record<string, unknown>>(
    `SELECT l.id, l.name, l.description, l.latitude, l.longitude,
            l.transportation, l.status
     FROM service_at_location sal
     JOIN locations l ON l.id = sal.location_id
     WHERE sal.service_id = $1
       AND l.status = '${PUBLISHED_RECORD_STATUS}'`,
    [serviceId],
  );

  const phones = await deps.executeQuery<Record<string, unknown>>(
    `SELECT id, number, extension, type, language, description
     FROM phones
     WHERE service_id = $1`,
    [serviceId],
  );

  const locationIds = locations.map((location) => location.id as string);
  const addresses = locationIds.length > 0
    ? await deps.executeQuery<Record<string, unknown>>(
        `SELECT id, location_id, address_1, city, state_province,
                postal_code, country
         FROM addresses WHERE location_id = ANY($1::uuid[])`,
        [locationIds],
      )
    : [];

  return {
    ...service,
    organization: organizationRows[0] ?? null,
    locations,
    phones,
    addresses,
  };
}

export async function getPublishedOrganizationDetail(deps: PublicationDeps, organizationId: string) {
  const organizationRows = await deps.executeQuery<Record<string, unknown>>(
    `SELECT o.id, o.name, o.description, o.url, o.email, o.tax_status,
            o.tax_id, o.year_incorporated, o.legal_status, o.logo_url,
            o.uri, o.status, o.verified_at, o.created_at, o.updated_at
     FROM organizations o
     WHERE o.id = $1 AND ${buildPublishedOrganizationPredicate('o')}`,
    [organizationId],
  );

  const organization = organizationRows[0];
  if (!organization) {
    return null;
  }

  const services = await deps.executeQuery<Record<string, unknown>>(
    `SELECT s.id, s.name, s.alternate_name, s.description, s.url, s.email,
            s.status, s.created_at, s.updated_at
     FROM services s
     WHERE s.organization_id = $1
       AND ${buildPublishableServiceRecordPredicate('s')}
     ORDER BY s.name`,
    [organizationId],
  );

  // Attach city/state summaries so the public profile can show where each
  // service operates. Hotline/remote services legitimately have none.
  const serviceIds = services.map((service) => service.id as string);
  // DISTINCT ON one row per (service, location): a location can carry more
  // than one address row, and the fan-out would duplicate city/state lines.
  const serviceLocations = serviceIds.length > 0
    ? await deps.executeQuery<Record<string, unknown>>(
        `SELECT DISTINCT ON (sal.service_id, l.id)
                sal.service_id, a.address_1, a.city, a.state_province, a.postal_code
         FROM service_at_location sal
         JOIN locations l ON l.id = sal.location_id AND l.status = '${PUBLISHED_RECORD_STATUS}'
         LEFT JOIN addresses a ON a.location_id = l.id
         WHERE sal.service_id = ANY($1::uuid[])
         ORDER BY sal.service_id, l.id, a.id ASC NULLS LAST`,
        [serviceIds],
      )
    : [];

  const locationsByService = new Map<string, Array<Record<string, unknown>>>();
  for (const row of serviceLocations) {
    const serviceId = row.service_id as string;
    const list = locationsByService.get(serviceId) ?? [];
    list.push({
      address_1: row.address_1 ?? null,
      city: row.city ?? null,
      state_province: row.state_province ?? null,
      postal_code: row.postal_code ?? null,
    });
    locationsByService.set(serviceId, list);
  }

  const servicesWithLocations = services.map((service) => ({
    ...service,
    locations: locationsByService.get(service.id as string) ?? [],
  }));

  const phones = await deps.executeQuery<Record<string, unknown>>(
    `SELECT id, number, extension, type, language, description
     FROM phones
     WHERE organization_id = $1`,
    [organizationId],
  );

  return {
    ...organization,
    services: servicesWithLocations,
    phones,
  };
}
