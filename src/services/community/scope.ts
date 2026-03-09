import { executeQuery } from '@/services/db/postgres';

export interface CommunityAdminScope {
  userId: string;
  coverageZoneId: string | null;
  coverageZoneName: string | null;
  coverageZoneDescription: string | null;
  coverageStates: string[];
  coverageCounties: string[];
  hasGeometry: boolean;
  hasExplicitScope: boolean;
}

export async function getCommunityAdminScope(userId: string): Promise<CommunityAdminScope> {
  const rows = await executeQuery<{
    coverage_zone_id: string | null;
    coverage_zone_name: string | null;
    coverage_zone_description: string | null;
    coverage_states: string[] | null;
    coverage_counties: string[] | null;
    has_geometry: boolean | null;
  }>(
    `SELECT
       arp.coverage_zone_id,
       cz.name AS coverage_zone_name,
       cz.description AS coverage_zone_description,
       arp.coverage_states,
       arp.coverage_counties,
       (cz.geometry IS NOT NULL) AS has_geometry
     FROM admin_review_profiles arp
     LEFT JOIN coverage_zones cz ON cz.id = arp.coverage_zone_id
     WHERE arp.user_id = $1
     LIMIT 1`,
    [userId],
  );

  const row = rows[0];
  const coverageStates = (row?.coverage_states ?? []).filter(Boolean);
  const coverageCounties = (row?.coverage_counties ?? []).filter(Boolean);

  return {
    userId,
    coverageZoneId: row?.coverage_zone_id ?? null,
    coverageZoneName: row?.coverage_zone_name ?? null,
    coverageZoneDescription: row?.coverage_zone_description ?? null,
    coverageStates,
    coverageCounties,
    hasGeometry: Boolean(row?.has_geometry),
    hasExplicitScope: Boolean(row?.coverage_zone_id) || coverageStates.length > 0 || coverageCounties.length > 0,
  };
}

export function buildCommunitySubmissionScope(
  submissionAlias: string,
  scope: CommunityAdminScope,
  params: unknown[],
): string | null {
  if (!scope.hasExplicitScope) {
    return null;
  }

  const clauses: string[] = [];

  if (scope.coverageZoneId) {
    params.push(scope.coverageZoneId);
    clauses.push(
      `EXISTS (
         SELECT 1
         FROM form_instances fi
         WHERE fi.submission_id = ${submissionAlias}.id
           AND fi.coverage_zone_id = $${params.length}
       )`,
    );
  }

  if (scope.coverageStates.length > 0) {
    params.push(scope.coverageStates);
    clauses.push(
      `EXISTS (
         SELECT 1
         FROM service_at_location sal
         JOIN locations l ON l.id = sal.location_id
         LEFT JOIN addresses a ON a.location_id = l.id
         WHERE sal.service_id = ${submissionAlias}.service_id
           AND a.state_province = ANY($${params.length}::text[])
       )`,
    );
  }
  params.push(scope.userId);
  clauses.push(`${submissionAlias}.assigned_to_user_id = $${params.length}`);

  return clauses.length > 0 ? `(${clauses.join(' OR ')})` : null;
}
