import type { PoolClient } from 'pg';

export interface LivePublicationIdentityInput {
  ownerOrganizationId?: string | null;
  existingServiceId?: string | null;
  organizationName?: string | null;
  organizationUrl?: string | null;
  serviceName?: string | null;
  serviceUrl?: string | null;
}

export interface LivePublicationLocationInput {
  name?: string | null;
  address1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

function normalizeMatchText(value?: string | null): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(value?: string | null): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

function buildPublicationFingerprint(input: LivePublicationIdentityInput): string {
  return [
    input.ownerOrganizationId ?? '',
    input.existingServiceId ?? '',
    normalizeUrl(input.organizationUrl),
    normalizeMatchText(input.organizationName),
    normalizeUrl(input.serviceUrl),
    normalizeMatchText(input.serviceName),
  ]
    .filter(Boolean)
    .join('|') || 'unscoped';
}

export async function acquireLivePublicationAdvisoryLock(
  client: PoolClient,
  input: LivePublicationIdentityInput,
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    [`live-publication:${buildPublicationFingerprint(input)}`],
  );
}

export async function resolveExistingLiveOrganizationId(
  client: PoolClient,
  input: LivePublicationIdentityInput,
): Promise<string | null> {
  if (input.ownerOrganizationId) {
    return input.ownerOrganizationId;
  }

  const organizationUrl = normalizeUrl(input.organizationUrl);
  if (organizationUrl) {
    const urlMatch = await client.query<{ id: string }>(
      `SELECT id
         FROM organizations
        WHERE status = 'active'
          AND lower(regexp_replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/+$', '')) = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [organizationUrl],
    );
    if (urlMatch.rows[0]?.id) {
      return urlMatch.rows[0].id;
    }
  }

  const organizationName = normalizeMatchText(input.organizationName);
  if (!organizationName) {
    return null;
  }

  const nameMatch = await client.query<{ id: string }>(
    `SELECT id
       FROM organizations
      WHERE status = 'active'
        AND lower(regexp_replace(name, '[^a-z0-9]+', ' ', 'gi')) = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [organizationName],
  );

  return nameMatch.rows[0]?.id ?? null;
}

export async function resolveExistingLiveServiceId(
  client: PoolClient,
  organizationId: string,
  input: LivePublicationIdentityInput,
): Promise<string | null> {
  if (input.existingServiceId) {
    return input.existingServiceId;
  }

  const serviceUrl = normalizeUrl(input.serviceUrl);
  if (serviceUrl) {
    const urlMatch = await client.query<{ id: string }>(
      `SELECT id
         FROM services
        WHERE organization_id = $1
          AND status = 'active'
          AND lower(regexp_replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/+$', '')) = $2
        ORDER BY updated_at DESC
        LIMIT 1`,
      [organizationId, serviceUrl],
    );
    if (urlMatch.rows[0]?.id) {
      return urlMatch.rows[0].id;
    }
  }

  const serviceName = normalizeMatchText(input.serviceName);
  if (!serviceName) {
    return null;
  }

  const nameMatch = await client.query<{ id: string }>(
    `SELECT id
       FROM services
      WHERE organization_id = $1
        AND status = 'active'
        AND lower(regexp_replace(name, '[^a-z0-9]+', ' ', 'gi')) = $2
      ORDER BY updated_at DESC
      LIMIT 1`,
    [organizationId, serviceName],
  );

  return nameMatch.rows[0]?.id ?? null;
}

export async function resolveExistingLiveLocationId(
  client: PoolClient,
  serviceId: string,
  input: LivePublicationLocationInput,
): Promise<string | null> {
  const normalizedAddress1 = normalizeMatchText(input.address1);
  const normalizedCity = normalizeMatchText(input.city);
  const postalCode = (input.postalCode ?? '').trim();
  if (normalizedAddress1 && normalizedCity) {
    const addressMatch = await client.query<{ id: string }>(
      `SELECT l.id
         FROM service_at_location sal
         JOIN locations l ON l.id = sal.location_id
         LEFT JOIN addresses a ON a.location_id = l.id
        WHERE sal.service_id = $1
          AND l.status = 'active'
          AND lower(regexp_replace(coalesce(a.address_1, ''), '[^a-z0-9]+', ' ', 'gi')) = $2
          AND lower(regexp_replace(coalesce(a.city, ''), '[^a-z0-9]+', ' ', 'gi')) = $3
          AND coalesce(a.postal_code, '') = $4
        ORDER BY l.updated_at DESC
        LIMIT 1`,
      [serviceId, normalizedAddress1, normalizedCity, postalCode],
    );
    if (addressMatch.rows[0]?.id) {
      return addressMatch.rows[0].id;
    }
  }

  const locationName = normalizeMatchText(input.name);
  if (!locationName) {
    return null;
  }

  const nameMatch = await client.query<{ id: string }>(
    `SELECT l.id
       FROM service_at_location sal
       JOIN locations l ON l.id = sal.location_id
      WHERE sal.service_id = $1
        AND l.status = 'active'
        AND lower(regexp_replace(coalesce(l.name, ''), '[^a-z0-9]+', ' ', 'gi')) = $2
      ORDER BY l.updated_at DESC
      LIMIT 1`,
    [serviceId, locationName],
  );

  return nameMatch.rows[0]?.id ?? null;
}
