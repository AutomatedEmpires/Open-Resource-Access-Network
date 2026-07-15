import { executeQuery } from '@/services/db/postgres';

export interface CommunityAdminScope {
  userId: string;
  profileExists: boolean;
  isActive: boolean;
  isAcceptingNew: boolean;
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
    profile_id: string;
    is_active: boolean;
    is_accepting_new: boolean;
    coverage_zone_id: string | null;
    coverage_zone_name: string | null;
    coverage_zone_description: string | null;
    coverage_states: string[] | null;
    coverage_counties: string[] | null;
    has_geometry: boolean | null;
  }>(
    `SELECT
       arp.id AS profile_id,
       arp.is_active,
       arp.is_accepting_new,
       CASE WHEN cz.id IS NOT NULL THEN arp.coverage_zone_id END AS coverage_zone_id,
       cz.name AS coverage_zone_name,
       cz.description AS coverage_zone_description,
       arp.coverage_states,
       arp.coverage_counties,
       (cz.geometry IS NOT NULL) AS has_geometry
     FROM admin_review_profiles arp
     LEFT JOIN coverage_zones cz
       ON cz.id = arp.coverage_zone_id
      AND cz.status = 'active'
     WHERE arp.user_id = $1
     LIMIT 1`,
    [userId],
  );

  const row = rows[0];
  const coverageStates = [...new Set(
    (row?.coverage_states ?? [])
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  )];
  const coverageCounties = [...new Set(
    (row?.coverage_counties ?? [])
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  )];

  return {
    userId,
    profileExists: Boolean(row?.profile_id),
    isActive: Boolean(row?.is_active),
    isAcceptingNew: Boolean(row?.is_accepting_new),
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
  options: { requireAcceptingNew?: boolean } = {},
): string | null {
  const geographicClauses: string[] = [];

  if (scope.coverageZoneId) {
    params.push(scope.coverageZoneId);
    const zoneParam = `$${params.length}`;
    const geographicZoneClauses = scope.hasGeometry
      ? `
           OR EXISTS (
             SELECT 1
             FROM public.service_at_location sal
             JOIN public.locations location ON location.id = sal.location_id
             WHERE sal.service_id = ${submissionAlias}.service_id
               AND location.status = 'active'
               AND (
                 location.geom IS NOT NULL
                 OR (location.longitude IS NOT NULL AND location.latitude IS NOT NULL)
               )
               AND public.ST_Covers(
                 zone.geometry,
                 public.ST_SetSRID(
                   coalesce(
                     location.geom,
                     public.ST_MakePoint(location.longitude, location.latitude)
                   ),
                   4326
                 )
               )
           )
           OR EXISTS (
             SELECT 1
             FROM public.service_areas service_area
             WHERE service_area.service_id = ${submissionAlias}.service_id
               AND service_area.extent IS NOT NULL
               AND public.ST_Intersects(
                 zone.geometry,
                 public.ST_SetSRID(service_area.extent, 4326)
               )
           )`
      : '';
    geographicClauses.push(
      `EXISTS (
         SELECT 1
         FROM public.coverage_zones zone
         WHERE zone.id = ${zoneParam}
           AND zone.status = 'active'
           AND (
             EXISTS (
               SELECT 1
               FROM public.form_instances fi
               WHERE fi.submission_id = ${submissionAlias}.id
                 AND fi.coverage_zone_id = zone.id
             )${geographicZoneClauses}
           )
       )`,
    );
  }

  if (scope.coverageStates.length > 0) {
    params.push(scope.coverageStates);
    geographicClauses.push(
      `(
         upper(trim(${submissionAlias}.jurisdiction_state)) = ANY($${params.length}::text[])
         OR EXISTS (
           SELECT 1
           FROM service_at_location sal
           JOIN locations l ON l.id = sal.location_id
           LEFT JOIN addresses a ON a.location_id = l.id
           WHERE sal.service_id = ${submissionAlias}.service_id
             AND l.status = 'active'
             AND upper(trim(a.state_province)) = ANY($${params.length}::text[])
         )
       )`,
    );
  }

  if (scope.coverageCounties.length > 0) {
    params.push(scope.coverageCounties);
    geographicClauses.push(
      `(
         ${submissionAlias}.jurisdiction_state IS NOT NULL
         AND ${submissionAlias}.jurisdiction_county IS NOT NULL
         AND upper(trim(${submissionAlias}.jurisdiction_state))
             || '_'
             || upper(trim(${submissionAlias}.jurisdiction_county))
             = ANY($${params.length}::text[])
       )`,
    );
  }
  // Profile availability is rechecked by every SQL statement that embeds this
  // predicate, not merely trusted from the earlier scope read. An inactive
  // profile gets no access (including assigned work). A paused active profile
  // retains assigned work but loses geographic queue visibility. A missing
  // profile remains assignment-only. Claim paths opt into requireAcceptingNew
  // so vacation mode cannot acquire additional work.
  params.push(scope.userId);
  const reviewerParam = `$${params.length}`;
  const assigned = `${submissionAlias}.assigned_to_user_id = ${reviewerParam}`;
  const geographic = geographicClauses.length > 0
    ? `(${geographicClauses.join(' OR ')})`
    : 'false';
  const availableProfileAccess = options.requireAcceptingNew
    ? `review_profile.is_accepting_new = true
           AND (${assigned} OR ${geographic})`
    : `(
             ${assigned}
             OR (review_profile.is_accepting_new = true AND ${geographic})
           )`;

  return `(
    EXISTS (
      SELECT 1
      FROM public.admin_review_profiles review_profile
      WHERE review_profile.user_id = ${reviewerParam}
        AND review_profile.is_active = true
        AND ${availableProfileAccess}
    )
    OR (
      NOT EXISTS (
        SELECT 1
        FROM public.admin_review_profiles review_profile
        WHERE review_profile.user_id = ${reviewerParam}
      )
      AND ${assigned}
    )
  )`;
}
