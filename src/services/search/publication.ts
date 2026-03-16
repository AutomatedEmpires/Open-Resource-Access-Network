export interface PublicationDeps {
  executeQuery: <T>(sql: string, params: unknown[]) => Promise<T[]>;
  executeCount: (sql: string, params: unknown[]) => Promise<number>;
}

export const PUBLISHED_RECORD_STATUS = 'active' as const;
export const DEFAULT_PUBLICATION_PAGE_SIZE = 20;
export const MAX_PUBLICATION_PAGE_SIZE = 100;

export function buildIntegrityHoldPredicate(serviceAlias = 's'): string {
  return `${serviceAlias}.integrity_hold_at IS NULL`;
}

export function buildPublishedServicePredicate(
  serviceAlias = 's',
  organizationAlias = 'o',
): string {
  return `${serviceAlias}.status = '${PUBLISHED_RECORD_STATUS}' AND ${organizationAlias}.status = '${PUBLISHED_RECORD_STATUS}' AND ${buildIntegrityHoldPredicate(serviceAlias)}`;
}

export function buildPublishedOrganizationPredicate(organizationAlias = 'o'): string {
  return `${organizationAlias}.status = '${PUBLISHED_RECORD_STATUS}'`;
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
            o.uri, o.status, o.created_at, o.updated_at
     FROM organizations o
     WHERE o.id = $1 AND ${buildPublishedOrganizationPredicate('o')}`,
    [organizationId],
  );

  const organization = organizationRows[0];
  if (!organization) {
    return null;
  }

  const services = await deps.executeQuery<Record<string, unknown>>(
    `SELECT id, name, alternate_name, description, url, email,
            status, integrity_hold_at, integrity_hold_reason, created_at, updated_at
     FROM services
     WHERE organization_id = $1
       AND status = '${PUBLISHED_RECORD_STATUS}'
       AND integrity_hold_at IS NULL
     ORDER BY name`,
    [organizationId],
  );

  const phones = await deps.executeQuery<Record<string, unknown>>(
    `SELECT id, number, extension, type, language, description
     FROM phones
     WHERE organization_id = $1`,
    [organizationId],
  );

  return {
    ...organization,
    services,
    phones,
  };
}
