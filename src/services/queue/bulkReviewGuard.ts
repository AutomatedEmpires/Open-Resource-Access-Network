import type { PoolClient } from 'pg';
import {
  buildCommunitySubmissionScope,
  type CommunityAdminScope,
} from '@/services/community/scope';

interface BulkReviewRow {
  id: string;
  submission_type: string;
  status: string;
  assigned_to_user_id: string | null;
  is_locked: boolean;
  locked_by_user_id: string | null;
  service_id: string | null;
  payload: unknown;
  has_open_freshness_finding: boolean;
  has_form_instance: boolean;
}

export interface LockedBulkReviewSubmission {
  id: string;
  serviceId: string | null;
}

export interface BulkReviewPreflight {
  submissions: LockedBulkReviewSubmission[];
  inaccessibleIds: string[];
  reviewOwnershipConflictIds: string[];
  structuredFreshnessIds: string[];
  individualReviewRequiredIds: string[];
}

/**
 * Approval is intentionally fail-closed. Every currently supported submission
 * type has a dedicated projection, policy, or evidence side effect that the
 * generic bulk workflow endpoint cannot safely apply. A type may only be added
 * here after its approval is proven to be a status-only operation.
 */
export const BULK_APPROVAL_SAFE_GENERIC_SUBMISSION_TYPES = [] as const;
const bulkApprovalSafeGenericSubmissionTypes = new Set<string>(
  BULK_APPROVAL_SAFE_GENERIC_SUBMISSION_TYPES,
);

export function payloadHasResourceFreshness(payload: unknown): boolean {
  return typeof payload === 'object'
    && payload !== null
    && !Array.isArray(payload)
    && Object.prototype.hasOwnProperty.call(payload, 'resourceFreshness');
}

/**
 * Lock and inspect every requested submission before a bulk workflow mutation.
 * The same guard is shared by community and admin bulk routes so structured
 * freshness evidence can never be bypassed through a second bulk endpoint.
 */
export async function lockBulkReviewSubmissions(
  client: PoolClient,
  submissionIds: string[],
  scope: CommunityAdminScope,
  unrestricted: boolean,
  actorUserId: string,
): Promise<BulkReviewPreflight> {
  const uniqueIds = [...new Set(submissionIds)];
  const params: unknown[] = [uniqueIds];
  const scopeCondition = unrestricted
    ? null
    : buildCommunitySubmissionScope('sub', scope, params);
  const result = await client.query<BulkReviewRow>(
    `SELECT sub.id, sub.submission_type, sub.status, sub.assigned_to_user_id,
            sub.is_locked, sub.locked_by_user_id,
            sub.service_id, sub.payload,
            EXISTS (
              SELECT 1
              FROM oran_internal.resource_freshness_findings finding
              WHERE finding.submission_id = sub.id
                AND finding.status = 'open'
            ) AS has_open_freshness_finding,
            EXISTS (
              SELECT 1
              FROM form_instances form_instance
              WHERE form_instance.submission_id = sub.id
            ) AS has_form_instance
     FROM submissions sub
     WHERE sub.id = ANY($1::uuid[])
       ${scopeCondition ? `AND ${scopeCondition}` : ''}
     ORDER BY sub.id
     FOR UPDATE OF sub`,
    params,
  );

  const visibleIds = new Set(result.rows.map((row) => row.id));
  return {
    submissions: result.rows.map((row) => ({
      id: row.id,
      serviceId: row.service_id,
    })),
    inaccessibleIds: uniqueIds.filter((id) => !visibleIds.has(id)),
    reviewOwnershipConflictIds: result.rows
      .filter((row) => (
        !['under_review', 'pending_second_approval'].includes(row.status)
        || row.assigned_to_user_id !== actorUserId
        || !row.is_locked
        || row.locked_by_user_id !== actorUserId
      ))
      .map((row) => row.id),
    structuredFreshnessIds: result.rows
      .filter((row) => (
        row.has_open_freshness_finding || payloadHasResourceFreshness(row.payload)
      ))
      .map((row) => row.id),
    individualReviewRequiredIds: result.rows
      .filter((row) => (
        !bulkApprovalSafeGenericSubmissionTypes.has(row.submission_type)
        || row.has_form_instance
      ))
      .map((row) => row.id),
  };
}
