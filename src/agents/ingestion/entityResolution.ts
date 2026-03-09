/**
 * Entity resolution — deterministic matching of source records
 * to existing canonical entities.
 *
 * Strategies (in priority order):
 *  1. **Identifier match**: exact match on entity_identifiers
 *     (e.g. same source system + source record id).
 *  2. **URL + phone match**: if the service has the same URL and phone.
 *  3. **Normalized name + address match**: cleaned name + address locality.
 *
 * Returns either found canonical entity IDs or null (new entity).
 */

import type {
  CanonicalOrganizationStore,
  CanonicalServiceStore,
  EntityIdentifierStore,
} from './stores';

// ── Confidence thresholds (configurable) ──────────────────────

export interface EntityResolutionConfig {
  /** Confidence for exact identifier match on a service (default 100). */
  identifierServiceConfidence: number;
  /** Confidence for exact identifier match on an organization (default 95). */
  identifierOrgConfidence: number;
  /** Confidence for URL-based match (default 80). */
  urlMatchConfidence: number;
  /** Confidence for name-based match (default 70). */
  nameMatchConfidence: number;
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env[name] : undefined;
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DEFAULT_RESOLUTION_CONFIG: EntityResolutionConfig = {
  identifierServiceConfidence: parseEnvInt('ORAN_ER_IDENTIFIER_SERVICE_CONFIDENCE', 100),
  identifierOrgConfidence: parseEnvInt('ORAN_ER_IDENTIFIER_ORG_CONFIDENCE', 95),
  urlMatchConfidence: parseEnvInt('ORAN_ER_URL_MATCH_CONFIDENCE', 80),
  nameMatchConfidence: parseEnvInt('ORAN_ER_NAME_MATCH_CONFIDENCE', 70),
};

// ── Public types ──────────────────────────────────────────────

export interface ResolvedEntity {
  canonicalOrganizationId: string | null;
  canonicalServiceId: string | null;
  strategy: 'identifier' | 'url_phone' | 'name_address' | 'none';
  confidence: number;
}

export interface EntityResolutionInput {
  /** Source system ID for scoped identifier lookup. */
  sourceSystemId: string;
  /** Original source record ID from the external system. */
  sourceRecordId?: string;
  /** Extracted org data from the source. */
  org?: {
    name?: string;
    url?: string;
    phone?: string;
  };
  /** Extracted service data from the source. */
  service?: {
    name?: string;
    url?: string;
    phone?: string;
  };
  /** Extracted location for name+address matching. */
  location?: {
    locality?: string;
    region?: string;
    postalCode?: string;
  };
}

export interface EntityResolutionStores {
  entityIdentifiers: EntityIdentifierStore;
  canonicalOrganizations: CanonicalOrganizationStore;
  canonicalServices: CanonicalServiceStore;
  /** Optional overrides for confidence thresholds. */
  config?: Partial<EntityResolutionConfig>;
}

// ── Normalisation helpers ─────────────────────────────────────

/** Normalize a name for deterministic comparison. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a phone to digits only. */
function _normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Normalize URL: drop protocol, trailing slash. */
function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .trim();
}

// ── Resolution strategies ─────────────────────────────────────

/**
 * Strategy 1: Match via entity_identifiers table.
 * Looks up by source_system_id scheme + source_record_id.
 */
async function resolveByIdentifier(
  input: EntityResolutionInput,
  stores: EntityResolutionStores
): Promise<ResolvedEntity | null> {
  if (!input.sourceRecordId) return null;

  const config = { ...DEFAULT_RESOLUTION_CONFIG, ...stores.config };

  // Look for an existing identifier with scheme = source_system:{sourceSystemId}
  const scheme = `source_system:${input.sourceSystemId}`;
  const existing = await stores.entityIdentifiers.findByScheme(scheme, input.sourceRecordId);

  if (!existing) return null;

  // The identifier points to a canonical entity
  if (existing.entityType === 'canonical_service') {
    // Load the service to get its org
    const svc = await stores.canonicalServices.getById(existing.entityId);
    if (!svc) {
      // Service was deleted — orphaned identifier; clean up and fall through
      console.warn(
        `[entityResolution] Orphaned identifier: service ${existing.entityId} no longer exists. Cleaning up.`,
      );
      await stores.entityIdentifiers.deleteByEntity('canonical_service', existing.entityId);
      return null;
    }
    if (!svc.canonicalOrganizationId) {
      console.warn(
        `[entityResolution] Identifier links to service ${existing.entityId} which has no canonicalOrganizationId`,
      );
    }
    return {
      canonicalOrganizationId: svc.canonicalOrganizationId ?? null,
      canonicalServiceId: existing.entityId,
      strategy: 'identifier',
      confidence: config.identifierServiceConfidence,
    };
  }

  if (existing.entityType === 'canonical_organization') {
    const org = await stores.canonicalOrganizations.getById(existing.entityId);
    if (!org) {
      console.warn(
        `[entityResolution] Orphaned identifier: organization ${existing.entityId} no longer exists. Cleaning up.`,
      );
      await stores.entityIdentifiers.deleteByEntity('canonical_organization', existing.entityId);
      return null;
    }
    return {
      canonicalOrganizationId: existing.entityId,
      canonicalServiceId: null,
      strategy: 'identifier',
      confidence: config.identifierOrgConfidence,
    };
  }

  return null;
}

/**
 * Strategy 2: Match by URL on canonical services.
 * Uses indexed lookup instead of scanning all active services.
 */
async function resolveByUrlPhone(
  input: EntityResolutionInput,
  stores: EntityResolutionStores
): Promise<ResolvedEntity | null> {
  const svcUrl = input.service?.url;

  if (!svcUrl) return null;

  const normalUrl = normalizeUrl(svcUrl);
  if (!normalUrl) return null;

  const config = { ...DEFAULT_RESOLUTION_CONFIG, ...stores.config };

  // Use indexed URL lookup if available on the store
  const candidate = await stores.canonicalServices.findActiveByUrl(svcUrl);

  if (candidate) {
    return {
      canonicalOrganizationId: candidate.canonicalOrganizationId,
      canonicalServiceId: candidate.id,
      strategy: 'url_phone',
      confidence: config.urlMatchConfidence,
    };
  }

  return null;
}

/**
 * Strategy 3: Match by service name (+ optional locality).
 * Uses indexed lookup instead of scanning all active services.
 */
async function resolveByNameAddress(
  input: EntityResolutionInput,
  stores: EntityResolutionStores
): Promise<ResolvedEntity | null> {
  if (!input.service?.name) return null;

  const serviceName = input.service.name;
  if (!serviceName.trim()) return null;

  const config = { ...DEFAULT_RESOLUTION_CONFIG, ...stores.config };

  const candidate = await stores.canonicalServices.findActiveByName(serviceName);

  if (candidate) {
    return {
      canonicalOrganizationId: candidate.canonicalOrganizationId,
      canonicalServiceId: candidate.id,
      strategy: 'name_address',
      confidence: config.nameMatchConfidence,
    };
  }

  return null;
}

// ── Main entry point ──────────────────────────────────────────

export async function resolveEntity(
  input: EntityResolutionInput,
  stores: EntityResolutionStores
): Promise<ResolvedEntity> {
  // Try strategies in priority order
  const byId = await resolveByIdentifier(input, stores);
  if (byId) return byId;

  const byUrlPhone = await resolveByUrlPhone(input, stores);
  if (byUrlPhone) return byUrlPhone;

  const byName = await resolveByNameAddress(input, stores);
  if (byName) return byName;

  return {
    canonicalOrganizationId: null,
    canonicalServiceId: null,
    strategy: 'none',
    confidence: 0,
  };
}
