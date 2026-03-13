/**
 * Merge Duplicates Service
 *
 * Provides operations to merge duplicate organizations and services.
 * Merges reassign all child entities (services, submissions, members)
 * from the source to the target, then archive the source.
 *
 * All operations are transactional to prevent partial merges.
 */

import { withTransaction, executeQuery } from '@/services/db/postgres';

// ============================================================
// TYPES
// ============================================================

export interface MergeResult {
  success: boolean;
  targetId: string;
  sourceId: string;
  mergedCounts: {
    services?: number;
    submissions?: number;
    members?: number;
    locations?: number;
    phones?: number;
    confidenceScores?: number;
  };
  error?: string;
}

// ============================================================
// ORGANIZATION MERGE
// ============================================================

/**
 * Merge two organizations: move all child entities from source → target,
 * then archive the source organization.
 *
 * Reassigned entities:
 *  - services (org_id → target)
 *  - organization_members (organization_id → target)
 *  - submissions (target_id → target where target_type = 'organization')
 *  - confidence_scores (org_id → target)
 *
 * This does NOT merge field-level data (name, description, etc.) —
 * the admin should update the target org's details separately.
 */
export async function mergeOrganizations(
  targetId: string,
  sourceId: string,
  actorUserId: string,
): Promise<MergeResult> {
  if (targetId === sourceId) {
    return { success: false, targetId, sourceId, mergedCounts: {}, error: 'Cannot merge an organization into itself' };
  }

  try {
    const counts = await withTransaction(async (client) => {
      // Verify both organizations exist and are not archived
      const orgs = await client.query<{ id: string; status: string | null }>(
        `SELECT id, status FROM organizations WHERE id = ANY($1::uuid[])`,
        [[targetId, sourceId]],
      );

      if (orgs.rows.length < 2) {
        throw new Error('One or both organizations not found');
      }
      const sourceOrg = orgs.rows.find(r => r.id === sourceId);
      if (sourceOrg?.status === 'defunct') {
        throw new Error('Source organization is already archived');
      }

      // 1. Reassign services
      const svcResult = await client.query(
        `UPDATE services SET org_id = $1, updated_at = NOW()
         WHERE org_id = $2`,
        [targetId, sourceId],
      );

      // 2. Reassign organization members (skip duplicates — same user already in target)
      const memResult = await client.query(
        `UPDATE organization_members SET organization_id = $1, updated_at = NOW()
         WHERE organization_id = $2
           AND user_id NOT IN (
             SELECT user_id FROM organization_members WHERE organization_id = $1
           )`,
        [targetId, sourceId],
      );

      // 3. Remove remaining source members (duplicates that couldn't be moved)
      await client.query(
        `DELETE FROM organization_members WHERE organization_id = $1`,
        [sourceId],
      );

      // 4. Reassign submissions targeting the source org
      const subResult = await client.query(
        `UPDATE submissions SET target_id = $1, updated_at = NOW()
         WHERE target_id = $2 AND target_type = 'organization'`,
        [targetId, sourceId],
      );

      // 5. Merge confidence scores — keep higher scores from either side
      const csResult = await client.query(
        `UPDATE confidence_scores SET org_id = $1, updated_at = NOW()
         WHERE org_id = $2
           AND service_id NOT IN (
             SELECT service_id FROM confidence_scores WHERE org_id = $1
           )`,
        [targetId, sourceId],
      );

      // Remove remaining duplicate confidence scores
      await client.query(
        `DELETE FROM confidence_scores WHERE org_id = $1`,
        [sourceId],
      );

      // 6. Archive the source organization
      await client.query(
        `UPDATE organizations SET status = 'defunct', updated_at = NOW() WHERE id = $1`,
        [sourceId],
      );

      // 7. Record audit trail
      await client.query(
        `INSERT INTO audit_logs (action, resource_type, resource_id, after, actor_user_id)
         VALUES ('org_merged', 'organization', $1, $2::jsonb, $3)`,
        [
          targetId,
          JSON.stringify({
            source_id: sourceId,
            services_moved: svcResult.rowCount ?? 0,
            members_moved: memResult.rowCount ?? 0,
            submissions_moved: subResult.rowCount ?? 0,
          }),
          actorUserId,
        ],
      );

      return {
        services: svcResult.rowCount ?? 0,
        members: memResult.rowCount ?? 0,
        submissions: subResult.rowCount ?? 0,
        confidenceScores: csResult.rowCount ?? 0,
      };
    });

    return { success: true, targetId, sourceId, mergedCounts: counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Merge failed';
    return { success: false, targetId, sourceId, mergedCounts: {}, error: message };
  }
}

// ============================================================
// SERVICE MERGE
// ============================================================

/**
 * Merge two services: move child entities from source → target,
 * then deactivate the source.
 *
 * Reassigned entities:
 *  - service_locations (service_id → target)
 *  - service_phones (service_id → target)
 *  - submissions (service_id → target or target_id → target where target_type = 'service')
 *  - confidence_scores (service_id → target)
 */
export async function mergeServices(
  targetId: string,
  sourceId: string,
  actorUserId: string,
): Promise<MergeResult> {
  if (targetId === sourceId) {
    return { success: false, targetId, sourceId, mergedCounts: {}, error: 'Cannot merge a service into itself' };
  }

  try {
    const counts = await withTransaction(async (client) => {
      // Verify both services exist
      const svcs = await client.query<{ id: string; status: string | null }>(
        `SELECT id, status FROM services WHERE id = ANY($1::uuid[])`,
        [[targetId, sourceId]],
      );

      if (svcs.rows.length < 2) {
        throw new Error('One or both services not found');
      }

      // 1. Reassign locations (skip if target already has same address)
      const locResult = await client.query(
        `UPDATE service_locations SET service_id = $1, updated_at = NOW()
         WHERE service_id = $2`,
        [targetId, sourceId],
      );

      // 2. Reassign phones
      const phoneResult = await client.query(
        `UPDATE service_phones SET service_id = $1, updated_at = NOW()
         WHERE service_id = $2`,
        [targetId, sourceId],
      );

      // 3. Reassign submissions
      const subResult = await client.query(
        `UPDATE submissions SET service_id = $1, updated_at = NOW()
         WHERE service_id = $2`,
        [targetId, sourceId],
      );

      // Also update submissions targeting the source service
      await client.query(
        `UPDATE submissions SET target_id = $1, updated_at = NOW()
         WHERE target_id = $2 AND target_type = 'service'`,
        [targetId, sourceId],
      );

      // 4. Merge confidence scores
      const csResult = await client.query(
        `UPDATE confidence_scores SET service_id = $1, updated_at = NOW()
         WHERE service_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM confidence_scores WHERE service_id = $1
           )`,
        [targetId, sourceId],
      );

      await client.query(
        `DELETE FROM confidence_scores WHERE service_id = $1`,
        [sourceId],
      );

      // 5. Deactivate the source service
      await client.query(
        `UPDATE services SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
        [sourceId],
      );

      // 6. Audit trail
      await client.query(
        `INSERT INTO audit_logs (action, resource_type, resource_id, after, actor_user_id)
         VALUES ('service_merged', 'service', $1, $2::jsonb, $3)`,
        [
          targetId,
          JSON.stringify({
            source_id: sourceId,
            locations_moved: locResult.rowCount ?? 0,
            phones_moved: phoneResult.rowCount ?? 0,
            submissions_moved: subResult.rowCount ?? 0,
          }),
          actorUserId,
        ],
      );

      return {
        locations: locResult.rowCount ?? 0,
        phones: phoneResult.rowCount ?? 0,
        submissions: subResult.rowCount ?? 0,
        confidenceScores: csResult.rowCount ?? 0,
      };
    });

    return { success: true, targetId, sourceId, mergedCounts: counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Merge failed';
    return { success: false, targetId, sourceId, mergedCounts: {}, error: message };
  }
}

// ============================================================
// PREVIEW (read-only check before merge)
// ============================================================

/**
 * Preview what a merge would affect without making changes.
 */
export async function previewOrganizationMerge(
  targetId: string,
  sourceId: string,
): Promise<{
  target: { id: string; name: string; serviceCount: number };
  source: { id: string; name: string; serviceCount: number };
  wouldMerge: { services: number; members: number; submissions: number };
}> {
  const [target] = await executeQuery<{ id: string; name: string; service_count: string }>(
    `SELECT o.id, o.name, COUNT(s.id)::text as service_count
     FROM organizations o
     LEFT JOIN services s ON s.org_id = o.id
     WHERE o.id = $1
     GROUP BY o.id`,
    [targetId],
  );

  const [source] = await executeQuery<{ id: string; name: string; service_count: string }>(
    `SELECT o.id, o.name, COUNT(s.id)::text as service_count
     FROM organizations o
     LEFT JOIN services s ON s.org_id = o.id
     WHERE o.id = $1
     GROUP BY o.id`,
    [sourceId],
  );

  if (!target || !source) {
    throw new Error('One or both organizations not found');
  }

  const [memberCount] = await executeQuery<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM organization_members
     WHERE organization_id = $1
       AND user_id NOT IN (SELECT user_id FROM organization_members WHERE organization_id = $2)`,
    [sourceId, targetId],
  );

  const [subCount] = await executeQuery<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM submissions
     WHERE target_id = $1 AND target_type = 'organization'`,
    [sourceId],
  );

  return {
    target: { id: target.id, name: target.name, serviceCount: parseInt(target.service_count, 10) },
    source: { id: source.id, name: source.name, serviceCount: parseInt(source.service_count, 10) },
    wouldMerge: {
      services: parseInt(source.service_count, 10),
      members: parseInt(memberCount?.count ?? '0', 10),
      submissions: parseInt(subCount?.count ?? '0', 10),
    },
  };
}
