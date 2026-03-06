/**
 * Organization Service Caps
 *
 * Enforces a configurable maximum number of active services per organization.
 * Default cap: 100 services. ORAN admins can adjust per organization.
 *
 * Uses pure SQL queries — no schema migration needed (reads count from services table,
 * cap stored as an org-level setting or defaults to DEFAULT_ORG_MAX_SERVICES).
 *
 * @module services/organizations/serviceCaps
 */

import { executeQuery } from '@/services/db/postgres';

// ============================================================
// CONSTANTS
// ============================================================

/** Default maximum active services per organization */
export const DEFAULT_ORG_MAX_SERVICES = 100;

// ============================================================
// TYPES
// ============================================================

export interface OrgServiceCapStatus {
  organizationId: string;
  activeServiceCount: number;
  maxServices: number;
  remaining: number;
  atCapacity: boolean;
}

// ============================================================
// QUERIES
// ============================================================

/**
 * Get the current service count and capacity status for an organization.
 *
 * Reads `max_services` from `organization_settings` if it exists,
 * otherwise falls back to DEFAULT_ORG_MAX_SERVICES.
 */
export async function getOrgServiceCapStatus(
  organizationId: string,
): Promise<OrgServiceCapStatus> {
  const rows = await executeQuery<{
    active_count: number;
    max_services: number | null;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM services s
        WHERE s.organization_id = $1 AND s.status = 'active') AS active_count,
       (SELECT os.max_services FROM organization_settings os
        WHERE os.organization_id = $1) AS max_services`,
    [organizationId],
  );

  const row = rows[0];
  const activeServiceCount = row?.active_count ?? 0;
  const maxServices = row?.max_services ?? DEFAULT_ORG_MAX_SERVICES;
  const remaining = Math.max(0, maxServices - activeServiceCount);

  return {
    organizationId,
    activeServiceCount,
    maxServices,
    remaining,
    atCapacity: activeServiceCount >= maxServices,
  };
}

/**
 * Check whether an organization can add more services.
 * Returns true if under cap, false if at or over cap.
 */
export async function canOrgAddService(organizationId: string): Promise<boolean> {
  const status = await getOrgServiceCapStatus(organizationId);
  return !status.atCapacity;
}

/**
 * Update the max_services cap for an organization.
 * Creates the settings row if it doesn't exist (upsert).
 */
export async function setOrgMaxServices(
  organizationId: string,
  maxServices: number,
): Promise<void> {
  if (maxServices < 1 || maxServices > 10000) {
    throw new Error('maxServices must be between 1 and 10,000');
  }

  await executeQuery(
    `INSERT INTO organization_settings (organization_id, max_services)
     VALUES ($1, $2)
     ON CONFLICT (organization_id)
     DO UPDATE SET max_services = EXCLUDED.max_services, updated_at = NOW()`,
    [organizationId, maxServices],
  );
}
