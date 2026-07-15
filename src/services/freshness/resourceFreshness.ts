import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import {
  RESOURCE_FRESHNESS_SCANNER_ACTOR,
  requiredActionForResourceFreshnessSignal,
  resourceFreshnessOutcomeError,
  resourceFreshnessReviewPacketSchema,
  resourceFreshnessReviewSchema,
  type ResourceFreshnessReview,
  type ResourceFreshnessReviewPacket,
  type ResourceFreshnessSignal,
} from '@/domain/resourceFreshnessReview';
import { withTransaction } from '@/services/db/postgres';
import {
  acquireProtectedMaintenanceGatesShared,
  assertAuthoritativeEntitiesMutable,
  findProtectedAuthoritativeEntities,
} from '@/services/publication/protectedAuthoritativeMutation';
import {
  buildCanonicalAuthoritativeServiceRowsQuery,
  buildPublishedServicePredicate,
} from '@/services/search/publication';
import {
  appendLifecycleEvent,
  buildPublicationLifecycleWindow,
} from '@/services/publication/livePublication';
import { acquireLivePublicationGateShared } from '@/services/publication/liveEntityMerge';

export const DEFAULT_FRESHNESS_SCAN_LIMIT = 100;
export const MAX_FRESHNESS_SCAN_LIMIT = 100;
export const CANONICAL_STALE_AFTER_DAYS = 180;
export const UNKNOWN_SOURCE_STALE_AFTER_DAYS = 365;

// Reuse only untouched queue work. Claimed work and first-approved work have a
// content/audit boundary that the scanner must never mutate behind a reviewer.
const LINKABLE_VERIFICATION_STATUSES = [
  'needs_review',
] as const;

interface FreshnessCandidateRow {
  service_id: string;
  service_name: string;
  organization_id: string;
  signal_type: ResourceFreshnessSignal;
  signal_observed_at: string | Date;
  freshness_threshold_days: number | null;
  service_updated_at: string | Date;
  last_source_refresh_at: string | Date | null;
  last_candidate_verified_at: string | Date | null;
  last_manual_verification_at: string | Date | null;
  jurisdiction_state: string | null;
  jurisdiction_county_state: string | null;
  jurisdiction_county: string | null;
  reverify_at: string | Date | null;
  schedule_count: number;
  dated_schedule_count: number;
  max_valid_to: string | Date | null;
  existing_submission_id: string | null;
}

export interface ResourceFreshnessScanOptions {
  limit?: number;
  asOf?: Date;
}

export interface ResourceFreshnessScanResult {
  checkedCount: number;
  findingCount: number;
  blockedCount: number;
  expiredBlockedCount: number;
  staleBlockedCount: number;
  reverificationDueBlockedCount: number;
  staleSourceBlockedCount: number;
  unknownSourceBlockedCount: number;
  protectedAuthoritySkippedCount: number;
  enqueuedCount: number;
  linkedToExistingCount: number;
  resolvedCount: number;
  confirmedUnavailableCount: number;
}

export const RESOURCE_FRESHNESS_CANDIDATE_SQL = `
WITH eligible_published_services AS NOT MATERIALIZED (
  SELECT service.id,
         service.name,
         service.organization_id,
         service.created_at,
         service.updated_at
  FROM public.services service
  JOIN public.organizations organization
    ON organization.id = service.organization_id
  WHERE ${buildPublishedServicePredicate('service', 'organization')}
    AND NOT EXISTS (
      SELECT 1
      FROM oran_internal.resource_freshness_findings open_finding
      WHERE open_finding.service_id = service.id
        AND open_finding.status = 'open'
    )
),
canonical_publication_authority AS NOT MATERIALIZED (
  ${buildCanonicalAuthoritativeServiceRowsQuery()}
),
durable_candidate_verifications AS NOT MATERIALIZED (
  SELECT verification_event.id AS event_id,
         verification_event.entity_id AS service_id,
         verification_event.created_at AS verified_at,
         CASE
           WHEN verification_event.metadata ->> 'reverifyAt'
             ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
             THEN (verification_event.metadata ->> 'reverifyAt')::timestamptz
           ELSE NULL
         END AS reverify_at
  FROM public.lifecycle_events verification_event
  JOIN eligible_published_services eligible_service
    ON eligible_service.id = verification_event.entity_id
  WHERE verification_event.entity_type = 'service'
    AND verification_event.event_type IN ('published', 'republished')
    AND verification_event.actor_type = 'human'
    AND verification_event.metadata ->> 'incomingAuthority' = 'candidate_allowlisted'
    AND verification_event.metadata ->> 'overwriteSuppressed' = 'false'
    AND nullif(verification_event.metadata ->> 'candidateId', '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.hsds_export_snapshots publication_snapshot
      WHERE publication_snapshot.entity_type = 'service'
        AND publication_snapshot.entity_id = verification_event.entity_id
        AND publication_snapshot.status = 'current'
        AND publication_snapshot.generated_at = verification_event.created_at
        AND publication_snapshot.hsds_payload #>> '{meta,sourceCandidateId}'
          = verification_event.metadata ->> 'candidateId'
        AND publication_snapshot.hsds_payload #>> '{meta,publicationSourceKind}'
          = 'candidate_allowlisted'
    )
),
durable_manual_verifications AS NOT MATERIALIZED (
  SELECT verification_event.id AS event_id,
         verification_event.entity_id AS service_id,
         CASE
           WHEN verification_event.event_type = 'verified'
            AND verification_event.metadata ->> 'verifiedAt'
              ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
             THEN (verification_event.metadata ->> 'verifiedAt')::timestamptz
           ELSE verification_event.created_at
         END AS verified_at,
         CASE
           WHEN verification_event.metadata ->> 'reverifyAt'
             ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
             THEN (verification_event.metadata ->> 'reverifyAt')::timestamptz
           ELSE NULL
         END AS reverify_at,
         approved_submission.jurisdiction_state,
         approved_submission.jurisdiction_county
  FROM public.lifecycle_events verification_event
  JOIN public.submissions approved_submission
    ON approved_submission.id::text = verification_event.metadata ->> 'submissionId'
   AND approved_submission.service_id = verification_event.entity_id
  JOIN eligible_published_services eligible_service
    ON eligible_service.id = verification_event.entity_id
  WHERE verification_event.entity_type = 'service'
    AND verification_event.actor_type = 'human'
    AND approved_submission.status IN ('approved', 'archived')
    AND approved_submission.submission_type IN (
      'new_service',
      'service_verification',
      'data_correction'
    )
    AND EXISTS (
      SELECT 1
      FROM public.submission_transitions approved_transition
      WHERE approved_transition.submission_id = approved_submission.id
        AND approved_transition.to_status = 'approved'
        AND approved_transition.gates_passed = true
        AND approved_transition.actor_user_id = verification_event.actor_id
        AND (
          (
            verification_event.event_type = 'verified'
            AND verification_event.metadata ->> 'approvalTransitionId'
              = approved_transition.id::text
          )
          OR (
            verification_event.event_type IN ('published', 'republished')
            AND approved_submission.payload ->> 'projectionApprovalTransitionId'
              = approved_transition.id::text
          )
        )
    )
    AND (
      (
        verification_event.event_type = 'verified'
        AND verification_event.metadata ->> 'verificationApplied' = 'true'
      )
      OR (
        verification_event.event_type IN ('published', 'republished')
        AND verification_event.metadata ->> 'overwriteSuppressed' = 'false'
        AND verification_event.metadata ->> 'incomingAuthority'
          IN ('host_submission', 'community_review')
        AND EXISTS (
          SELECT 1
          FROM public.hsds_export_snapshots publication_snapshot
          WHERE publication_snapshot.entity_type = 'service'
            AND publication_snapshot.entity_id = verification_event.entity_id
            AND publication_snapshot.status = 'current'
            AND publication_snapshot.generated_at = verification_event.created_at
            AND publication_snapshot.hsds_payload #>> '{meta,sourceSubmissionId}'
              = approved_submission.id::text
            AND publication_snapshot.hsds_payload #>> '{meta,publicationSourceKind}'
              = verification_event.metadata ->> 'incomingAuthority'
        )
        AND EXISTS (
          SELECT 1
          FROM public.source_records projection_record
          WHERE projection_record.id::text = approved_submission.payload ->> 'projectionSourceRecordId'
            AND projection_record.source_record_id = approved_submission.id::text
            AND projection_record.source_record_type = 'mixed_bundle'
            AND projection_record.processing_status = 'published'
            AND projection_record.parsed_payload #>> '{projection,serviceId}'
              = verification_event.entity_id::text
        )
      )
    )
),
expired_schedule_rows AS (
  SELECT sch.service_id, sch.valid_to
  FROM public.schedules sch
  JOIN eligible_published_services eligible_service
    ON eligible_service.id = sch.service_id
  WHERE sch.service_id IS NOT NULL
    AND sch.valid_to < $2::date

  UNION ALL

  SELECT sal.service_id, sch.valid_to
  FROM public.schedules sch
  JOIN public.service_at_location sal ON sal.location_id = sch.location_id
  JOIN public.locations expired_location
    ON expired_location.id = sal.location_id
   AND expired_location.status = 'active'
  JOIN eligible_published_services eligible_service
    ON eligible_service.id = sal.service_id
  WHERE sch.service_id IS NULL
    AND sch.location_id IS NOT NULL
    AND sch.valid_to < $2::date
),
explicit_expiry AS (
  SELECT expired.service_id,
         'explicit_expiry'::text AS signal_type,
         max(expired.valid_to)::timestamptz AS signal_observed_at,
         NULL::int AS freshness_threshold_days,
         count(*)::int AS schedule_count,
         count(*)::int AS dated_schedule_count,
         max(expired.valid_to) AS max_valid_to,
         1 AS signal_priority
  FROM expired_schedule_rows expired
  WHERE NOT EXISTS (
      SELECT 1
      FROM public.schedules current_schedule
      WHERE current_schedule.service_id = expired.service_id
        AND (
          current_schedule.valid_to IS NULL
          OR current_schedule.valid_to >= $2::date
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.service_at_location sal
      JOIN public.locations current_location
        ON current_location.id = sal.location_id
       AND current_location.status = 'active'
      JOIN public.schedules current_schedule
        ON current_schedule.location_id = sal.location_id
       AND current_schedule.service_id IS NULL
      WHERE sal.service_id = expired.service_id
        AND (
          current_schedule.valid_to IS NULL
          OR current_schedule.valid_to >= $2::date
        )
    )
  GROUP BY expired.service_id
  ORDER BY max(expired.valid_to), expired.service_id
  LIMIT greatest($1::int * 20, 100)
),
latest_service_verifications AS (
  SELECT DISTINCT ON (verification_window.service_id)
         verification_window.service_id,
         verification_window.reverify_at,
         verification_window.verified_at,
         verification_window.event_id
  FROM (
    SELECT candidate.service_id,
           candidate.reverify_at,
           candidate.verified_at,
           candidate.event_id
    FROM durable_candidate_verifications candidate

    UNION ALL

    SELECT manual.service_id,
           manual.reverify_at,
           manual.verified_at,
           manual.event_id
    FROM durable_manual_verifications manual
  ) verification_window
  ORDER BY verification_window.service_id,
           verification_window.verified_at DESC,
           verification_window.event_id DESC
),
due_reverification AS (
  SELECT verification_window.service_id,
         'reverification_due'::text AS signal_type,
         verification_window.reverify_at AS signal_observed_at,
         NULL::int AS freshness_threshold_days,
         0::int AS schedule_count,
         0::int AS dated_schedule_count,
         NULL::date AS max_valid_to,
         2 AS signal_priority
  FROM latest_service_verifications verification_window
  WHERE verification_window.reverify_at IS NOT NULL
    AND verification_window.reverify_at <= $2::timestamptz
  ORDER BY verification_window.reverify_at, verification_window.service_id
  LIMIT greatest($1::int * 20, 100)
),
stale_canonical AS (
  SELECT canonical_authority.service_id,
         'stale_source'::text AS signal_type,
         max(canonical_authority.last_refreshed_at) AS signal_observed_at,
         $3::int AS freshness_threshold_days,
         0::int AS schedule_count,
         0::int AS dated_schedule_count,
         NULL::date AS max_valid_to,
         3 AS signal_priority
  FROM canonical_publication_authority canonical_authority
  JOIN eligible_published_services eligible_service
    ON eligible_service.id = canonical_authority.service_id
  WHERE canonical_authority.last_refreshed_at <= $2::timestamptz - ($3::int * interval '1 day')
    AND NOT EXISTS (
      SELECT 1
      FROM canonical_publication_authority newer
      WHERE newer.service_id = canonical_authority.service_id
        AND newer.last_refreshed_at > $2::timestamptz - ($3::int * interval '1 day')
    )
  GROUP BY canonical_authority.service_id
  ORDER BY max(canonical_authority.last_refreshed_at), canonical_authority.service_id
  LIMIT greatest($1::int * 20, 100)
),
unknown_source AS (
  SELECT s.id AS service_id,
         'unknown_source'::text AS signal_type,
         greatest(s.created_at, latest_verification.verified_at) AS signal_observed_at,
         $4::int AS freshness_threshold_days,
         0::int AS schedule_count,
         0::int AS dated_schedule_count,
         NULL::date AS max_valid_to,
         4 AS signal_priority
  FROM eligible_published_services s
  LEFT JOIN latest_service_verifications latest_verification
    ON latest_verification.service_id = s.id
  WHERE greatest(s.created_at, latest_verification.verified_at)
      <= $2::timestamptz - ($4::int * interval '1 day')
    AND NOT EXISTS (
      SELECT 1
      FROM canonical_publication_authority canonical_authority
      WHERE canonical_authority.service_id = s.id
    )
  ORDER BY greatest(s.created_at, latest_verification.verified_at), s.id
  LIMIT greatest($1::int * 20, 100)
),
signal_seeds AS (
  SELECT * FROM explicit_expiry
  UNION ALL
  SELECT * FROM due_reverification
  UNION ALL
  SELECT * FROM stale_canonical
  UNION ALL
  SELECT * FROM unknown_source
),
ranked_signals AS (
  SELECT DISTINCT ON (seed.service_id)
         seed.service_id,
         seed.signal_type,
         seed.signal_observed_at,
         seed.freshness_threshold_days,
         seed.schedule_count,
         seed.dated_schedule_count,
         seed.max_valid_to,
         seed.signal_priority
  FROM signal_seeds seed
  ORDER BY seed.service_id, seed.signal_priority, seed.signal_observed_at
),
signal_details AS (
  SELECT signal.*,
         service.name AS service_name,
         service.organization_id,
         service.updated_at AS service_updated_at,
         source_freshness.last_source_refresh_at,
         candidate_verification.last_candidate_verified_at,
         manual_verification.last_manual_verification_at,
         coalesce(
           service_geography.jurisdiction_state,
           manual_verification.jurisdiction_state
         ) AS jurisdiction_state,
         CASE
           WHEN service_geography.jurisdiction_state IS NULL
             THEN manual_verification.jurisdiction_county_state
           ELSE NULL
         END AS jurisdiction_county_state,
         CASE
           WHEN service_geography.jurisdiction_state IS NULL
             THEN manual_verification.jurisdiction_county
           ELSE NULL
         END AS jurisdiction_county,
         CASE
           WHEN signal.signal_type = 'reverification_due'
             THEN signal.signal_observed_at
           ELSE NULL
         END AS reverify_at,
         greatest(
           source_freshness.last_source_refresh_at,
           candidate_verification.last_candidate_verified_at,
           manual_verification.last_manual_verification_at
         ) AS effective_verified_at
  FROM ranked_signals signal
  JOIN eligible_published_services service ON service.id = signal.service_id
  LEFT JOIN LATERAL (
    SELECT max(canonical_authority.last_refreshed_at) AS last_source_refresh_at
    FROM canonical_publication_authority canonical_authority
    WHERE canonical_authority.service_id = signal.service_id
  ) source_freshness ON true
  LEFT JOIN LATERAL (
    SELECT max(candidate.verified_at) AS last_candidate_verified_at
    FROM durable_candidate_verifications candidate
    WHERE candidate.service_id = signal.service_id
  ) candidate_verification ON true
  LEFT JOIN LATERAL (
    SELECT max(verification.verified_at) AS last_manual_verification_at,
           (
             array_agg(
               nullif(trim(verification.jurisdiction_state), '')
               ORDER BY verification.verified_at DESC, verification.event_id
             ) FILTER (
               WHERE nullif(trim(verification.jurisdiction_state), '') IS NOT NULL
             )
           )[1] AS jurisdiction_state,
           (
             array_agg(
               nullif(trim(verification.jurisdiction_state), '')
               ORDER BY verification.verified_at DESC, verification.event_id
             ) FILTER (
               WHERE nullif(trim(verification.jurisdiction_state), '') IS NOT NULL
                 AND nullif(trim(verification.jurisdiction_county), '') IS NOT NULL
             )
           )[1] AS jurisdiction_county_state,
           (
             array_agg(
               nullif(trim(verification.jurisdiction_county), '')
               ORDER BY verification.verified_at DESC, verification.event_id
             ) FILTER (
               WHERE nullif(trim(verification.jurisdiction_state), '') IS NOT NULL
                 AND nullif(trim(verification.jurisdiction_county), '') IS NOT NULL
             )
           )[1] AS jurisdiction_county
    FROM durable_manual_verifications verification
    WHERE verification.service_id = signal.service_id
  ) manual_verification ON true
  LEFT JOIN LATERAL (
    SELECT (
             SELECT nullif(trim(address.state_province), '')
             FROM public.service_at_location sal
             JOIN public.locations location ON location.id = sal.location_id
             JOIN public.addresses address ON address.location_id = location.id
             WHERE sal.service_id = signal.service_id
               AND location.status = 'active'
               AND nullif(trim(address.state_province), '') IS NOT NULL
             ORDER BY address.updated_at DESC, address.id
             LIMIT 1
           ) AS jurisdiction_state
  ) service_geography ON true
),
eligible_signals AS (
  SELECT detail.*
  FROM signal_details detail
  WHERE detail.signal_type = 'explicit_expiry'
     OR (
       detail.signal_type = 'reverification_due'
       AND (
         detail.effective_verified_at IS NULL
         OR detail.effective_verified_at < detail.signal_observed_at
       )
     )
     OR (
       detail.signal_type = 'stale_source'
       AND detail.effective_verified_at <= $2::timestamptz - ($3::int * interval '1 day')
     )
     OR (
       detail.signal_type = 'unknown_source'
       AND detail.signal_observed_at <= $2::timestamptz - ($4::int * interval '1 day')
     )
),
fair_signals AS (
  SELECT detail.*,
         row_number() OVER (
           PARTITION BY detail.signal_type
           ORDER BY detail.signal_observed_at, detail.service_id
         ) AS signal_rank,
         CASE detail.signal_type
           WHEN 'explicit_expiry' THEN 2
           ELSE 1
         END AS signal_weight
  FROM eligible_signals detail
)
SELECT detail.service_id,
       detail.service_name,
       detail.organization_id,
       detail.signal_type,
       detail.signal_observed_at,
       detail.freshness_threshold_days,
       detail.service_updated_at,
       detail.last_source_refresh_at,
       detail.last_candidate_verified_at,
       detail.last_manual_verification_at,
       detail.jurisdiction_state,
       detail.jurisdiction_county_state,
       detail.jurisdiction_county,
       detail.reverify_at,
       detail.schedule_count,
       detail.dated_schedule_count,
       detail.max_valid_to,
       existing_submission.id AS existing_submission_id
FROM fair_signals detail
LEFT JOIN LATERAL (
  SELECT sub.id
  FROM public.submissions sub
  WHERE sub.service_id = detail.service_id
    AND sub.submission_type = 'service_verification'
    AND sub.status = ANY($5::text[])
    AND sub.assigned_to_user_id IS NULL
    AND sub.is_locked = false
    AND sub.locked_at IS NULL
    AND sub.locked_by_user_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.form_instances form_instance
      WHERE form_instance.submission_id = sub.id
    )
  ORDER BY sub.created_at ASC
  LIMIT 1
) existing_submission ON true
ORDER BY
  ((detail.signal_rank - 1) / detail.signal_weight),
  detail.signal_priority,
  detail.signal_observed_at ASC,
  detail.service_id ASC
LIMIT $1`;

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_FRESHNESS_SCAN_LIMIT;
  return Math.max(1, Math.min(MAX_FRESHNESS_SCAN_LIMIT, Math.floor(limit!)));
}

function priorityForSignal(signal: ResourceFreshnessSignal): number {
  switch (signal) {
    case 'explicit_expiry':
      return 100;
    case 'reverification_due':
      return 75;
    case 'stale_source':
      return 60;
    case 'unknown_source':
      return 40;
  }
}

function normalizeDatabaseDateTime(value: string | Date): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value.getTime())) {
    throw new Error('Resource freshness scan returned an invalid database timestamp');
  }
  return value.toISOString();
}

function normalizeNullableDatabaseDateTime(value: string | Date | null): string | null {
  return value === null ? null : normalizeDatabaseDateTime(value);
}

function normalizeDatabaseDate(value: string | Date | null): string | null {
  if (value === null || typeof value === 'string') return value;
  if (!Number.isFinite(value.getTime())) {
    throw new Error('Resource freshness scan returned an invalid database date');
  }

  // node-postgres parses a PostgreSQL DATE as local midnight. Preserve those
  // calendar components instead of converting through UTC, which can shift the
  // date in positive-offset runtimes.
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeJurisdictionValue(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

/**
 * County authorization is an atomic state/county fact. A state-only fallback
 * may aid state routing, but it must never be combined with a county obtained
 * from a different candidate, submission, or location.
 */
function routingJurisdiction(candidate: FreshnessCandidateRow): {
  state: string | null;
  county: string | null;
} {
  const countyState = normalizeJurisdictionValue(candidate.jurisdiction_county_state);
  const county = normalizeJurisdictionValue(candidate.jurisdiction_county);
  if (countyState && county) {
    return { state: countyState, county };
  }
  return {
    state: normalizeJurisdictionValue(candidate.jurisdiction_state),
    county: null,
  };
}

function buildReviewPacket(
  candidate: FreshnessCandidateRow,
  asOf: string,
  findingId: string,
  holdReason: string,
): ResourceFreshnessReviewPacket {
  return resourceFreshnessReviewPacketSchema.parse({
    schemaVersion: 1,
    findingId,
    signal: candidate.signal_type,
    requiredAction: requiredActionForResourceFreshnessSignal(candidate.signal_type),
    hold: {
      actor: RESOURCE_FRESHNESS_SCANNER_ACTOR,
      reason: holdReason,
    },
    observed: {
      detectedAsOf: asOf,
      signalObservedAt: normalizeDatabaseDateTime(candidate.signal_observed_at),
      freshnessThresholdDays: candidate.freshness_threshold_days,
      serviceUpdatedAt: normalizeDatabaseDateTime(candidate.service_updated_at),
      lastSourceRefreshAt: normalizeNullableDatabaseDateTime(candidate.last_source_refresh_at),
      lastCandidateVerifiedAt: normalizeNullableDatabaseDateTime(candidate.last_candidate_verified_at),
      lastManualVerificationAt: normalizeNullableDatabaseDateTime(candidate.last_manual_verification_at),
      reverifyAt: normalizeNullableDatabaseDateTime(candidate.reverify_at),
      schedule: {
        totalCount: candidate.schedule_count,
        datedCount: candidate.dated_schedule_count,
        maxValidTo: normalizeDatabaseDate(candidate.max_valid_to),
      },
    },
    reviewRequirements: {
      evidenceRequired: true,
      scheduleCorrectionRequiredBeforeApproval: candidate.signal_type === 'explicit_expiry',
    },
  });
}

interface ReconciliationRow {
  finding_id: string;
  service_id: string;
  signal_type: ResourceFreshnessSignal;
  hold_reason: string;
  submission_status: string;
  payload: Record<string, unknown> | null;
  service_status: string;
  integrity_hold_at: string | Date | null;
  integrity_hold_reason: string | null;
  integrity_held_by_user_id: string | null;
  has_approved_transition: boolean;
  has_denied_transition: boolean;
  has_escalated_transition: boolean;
  first_destructive_transition_id: string | null;
  first_destructive_actor_user_id: string | null;
  approved_transition_id: string | null;
  denied_transition_id: string | null;
  approved_actor_user_id: string | null;
  denied_actor_user_id: string | null;
}

export type ResourceFreshnessReconciliationState =
  | 'not_applicable'
  | 'awaiting_workflow'
  | 'awaiting_schedule_correction'
  | 'hold_cleared'
  | 'non_scanner_hold_retained'
  | 'confirmed_unavailable'
  | 'verification_inconclusive';

export interface ResourceFreshnessReconciliationResult {
  state: ResourceFreshnessReconciliationState;
  findingId: string | null;
  holdCleared: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

interface StoredDestructiveFreshnessReview {
  transitionId: string;
  reviewerUserId: string;
  recordedAt: string;
  review: ResourceFreshnessReview;
}

const ISO_OFFSET_DATE_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;

function parseStoredDestructiveFreshnessReview(
  value: unknown,
): StoredDestructiveFreshnessReview | null {
  const record = asRecord(value);
  if (
    Object.keys(record).sort().join(',') !== 'recordedAt,review,reviewerUserId,transitionId'
    || typeof record.transitionId !== 'string'
    || record.transitionId.length === 0
    || typeof record.reviewerUserId !== 'string'
    || record.reviewerUserId.length === 0
    || typeof record.recordedAt !== 'string'
    || !ISO_OFFSET_DATE_TIME.test(record.recordedAt)
    || !Number.isFinite(Date.parse(record.recordedAt))
  ) {
    return null;
  }
  const review = resourceFreshnessReviewSchema.safeParse(record.review);
  if (!review.success || review.data.outcome !== 'confirmed_unavailable') {
    return null;
  }
  return {
    transitionId: record.transitionId,
    reviewerUserId: record.reviewerUserId,
    recordedAt: record.recordedAt,
    review: review.data,
  };
}

interface LockedScheduleValidityRow {
  id: string;
  service_id: string | null;
  location_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  current_date: string;
}

async function applyAndValidateExplicitExpiryCorrections(
  client: PoolClient,
  serviceId: string,
  actorUserId: string,
  review: ResourceFreshnessReview,
): Promise<boolean> {
  // The reconciliation target query already holds FOR UPDATE on the service,
  // which blocks new direct schedules and service/location associations. Lock
  // attached locations too so a concurrent shared-schedule insert cannot
  // appear as a phantom between validation and scanner-hold clearance.
  await client.query(
    `SELECT location.id
     FROM public.locations location
     JOIN public.service_at_location sal ON sal.location_id = location.id
     WHERE sal.service_id = $1
       AND location.status = 'active'
     ORDER BY location.id
     FOR UPDATE OF location, sal`,
    [serviceId],
  );

  const direct = await client.query<LockedScheduleValidityRow>(
    `SELECT schedule.id, schedule.service_id, schedule.location_id,
            schedule.valid_from::text, schedule.valid_to::text,
            current_date::text AS current_date
     FROM public.schedules schedule
     WHERE schedule.service_id = $1
     ORDER BY schedule.id
     FOR UPDATE OF schedule`,
    [serviceId],
  );
  const shared = await client.query<LockedScheduleValidityRow>(
    `SELECT schedule.id, schedule.service_id, schedule.location_id,
            schedule.valid_from::text, schedule.valid_to::text,
            current_date::text AS current_date
     FROM public.schedules schedule
     JOIN public.service_at_location sal ON sal.location_id = schedule.location_id
     JOIN public.locations location
       ON location.id = sal.location_id
      AND location.status = 'active'
     WHERE schedule.service_id IS NULL
       AND schedule.location_id IS NOT NULL
       AND sal.service_id = $1
     ORDER BY schedule.id
     FOR UPDATE OF schedule, sal, location`,
    [serviceId],
  );

  const allRows = [...direct.rows, ...shared.rows];
  const currentDate = allRows[0]?.current_date ?? new Date().toISOString().slice(0, 10);
  const directById = new Map(direct.rows.map((row) => [row.id, row]));
  const corrections = review.scheduleCorrections ?? [];
  const correctionById = new Map(corrections.map((correction) => [
    correction.scheduleId,
    correction,
  ]));

  if (corrections.some((correction) => !directById.has(correction.scheduleId))) {
    return false;
  }
  if (corrections.some((correction) => (
    correction.validFrom !== null && correction.validFrom > currentDate
  ))) {
    return false;
  }
  if (corrections.some((correction) => (
    correction.validTo !== null && correction.validTo < currentDate
  ))) {
    return false;
  }
  if (shared.rows.some((row) => (
    row.valid_to !== null && row.valid_to < currentDate
  ))) {
    return false;
  }
  if (
    corrections.length > 0
    && direct.rows.some((row) => (
      row.valid_to !== null
      && row.valid_to < currentDate
      && !correctionById.has(row.id)
    ))
  ) {
    return false;
  }

  const projected = allRows.map((row) => {
    const correction = correctionById.get(row.id);
    return correction ? { ...row, valid_to: correction.validTo } : row;
  });
  if (projected.length > 0 && projected.every((row) => (
    row.valid_to !== null && row.valid_to < currentDate
  ))) {
    return false;
  }

  for (const correction of corrections) {
    const updated = await client.query<{ id: string }>(
      `UPDATE public.schedules
       SET valid_from = $1::date,
           valid_to = $2::date,
           updated_at = now(),
           updated_by_user_id = $3
       WHERE id = $4
         AND service_id = $5
       RETURNING id`,
      [
        correction.validFrom,
        correction.validTo,
        actorUserId,
        correction.scheduleId,
        serviceId,
      ],
    );
    if (updated.rows.length !== 1) return false;
  }

  return true;
}

async function advanceReverificationWindow(
  client: PoolClient,
  serviceId: string,
  checkedAt: string,
): Promise<ReturnType<typeof buildPublicationLifecycleWindow>> {
  const scoreResult = await client.query<{ score: number | string }>(
    `SELECT score
     FROM public.confidence_scores
     WHERE service_id = $1`,
    [serviceId],
  );
  const parsedScore = Number(scoreResult.rows[0]?.score);
  const score = Number.isFinite(parsedScore) ? parsedScore : 50;
  return buildPublicationLifecycleWindow(score, new Date(checkedAt));
}

async function reconcileResourceFreshnessReviewLocked(
  client: PoolClient,
  submissionId: string,
): Promise<ResourceFreshnessReconciliationResult> {
  const targetResult = await client.query<ReconciliationRow>(
    `SELECT finding.id AS finding_id,
            finding.service_id,
            finding.signal_type,
            finding.hold_reason,
            sub.status AS submission_status,
            sub.payload,
            service.status AS service_status,
            service.integrity_hold_at,
            service.integrity_hold_reason,
            service.integrity_held_by_user_id,
            EXISTS (
              SELECT 1 FROM public.submission_transitions transition
              WHERE transition.submission_id = sub.id
                AND transition.to_status = 'approved'
                AND transition.gates_passed = true
            ) AS has_approved_transition,
            EXISTS (
              SELECT 1 FROM public.submission_transitions transition
              WHERE transition.submission_id = sub.id
                AND transition.to_status = 'denied'
                AND transition.gates_passed = true
            ) AS has_denied_transition,
            EXISTS (
              SELECT 1 FROM public.submission_transitions transition
              WHERE transition.submission_id = sub.id
                AND transition.to_status = 'escalated'
                AND transition.gates_passed = true
            ) AS has_escalated_transition,
            (
              SELECT transition.id
              FROM public.submission_transitions transition
              WHERE transition.submission_id = sub.id
                AND transition.to_status = 'pending_second_approval'
                AND transition.gates_passed = true
              ORDER BY transition.created_at DESC, transition.id DESC
              LIMIT 1
            ) AS first_destructive_transition_id,
            (
              SELECT transition.actor_user_id
              FROM public.submission_transitions transition
              WHERE transition.submission_id = sub.id
                AND transition.to_status = 'pending_second_approval'
                AND transition.gates_passed = true
              ORDER BY transition.created_at DESC, transition.id DESC
              LIMIT 1
            ) AS first_destructive_actor_user_id,
            (
              SELECT transition.id
              FROM public.submission_transitions transition
              WHERE transition.submission_id = sub.id
                AND transition.to_status = 'approved'
                AND transition.gates_passed = true
              ORDER BY transition.created_at DESC, transition.id DESC
              LIMIT 1
            ) AS approved_transition_id,
            (
              SELECT transition.id
              FROM public.submission_transitions transition
              WHERE transition.submission_id = sub.id
                AND transition.to_status = 'denied'
                AND transition.gates_passed = true
              ORDER BY transition.created_at DESC, transition.id DESC
              LIMIT 1
            ) AS denied_transition_id,
            (
              SELECT transition.actor_user_id
              FROM public.submission_transitions transition
              WHERE transition.submission_id = sub.id
                AND transition.to_status = 'approved'
                AND transition.gates_passed = true
              ORDER BY transition.created_at DESC, transition.id DESC
              LIMIT 1
            ) AS approved_actor_user_id,
            (
              SELECT transition.actor_user_id
              FROM public.submission_transitions transition
              WHERE transition.submission_id = sub.id
                AND transition.to_status = 'denied'
                AND transition.gates_passed = true
              ORDER BY transition.created_at DESC, transition.id DESC
              LIMIT 1
            ) AS denied_actor_user_id
     FROM oran_internal.resource_freshness_findings finding
     JOIN public.submissions sub ON sub.id = finding.submission_id
     JOIN public.services service ON service.id = finding.service_id
     WHERE finding.submission_id = $1
       AND finding.status = 'open'
       AND sub.service_id = finding.service_id
     FOR UPDATE OF finding, sub, service`,
    [submissionId],
  );

  const target = targetResult.rows[0];
  if (!target) {
    return { state: 'not_applicable', findingId: null, holdCleared: false };
  }

  // Membership is stable because callers hold the shared hotline/quarantine
  // maintenance gates. Protected authority records require their owner-only
  // maintenance workflow; community review must never mutate or resolve them.
  await assertAuthoritativeEntitiesMutable(client, {
    serviceIds: [target.service_id],
  });

  const payload = asRecord(target.payload);
  const packet = resourceFreshnessReviewPacketSchema.safeParse(payload.resourceFreshness);
  const review = resourceFreshnessReviewSchema.safeParse(payload.resourceFreshnessReview);
  if (
    !packet.success
    || !review.success
    || packet.data.findingId !== target.finding_id
    || packet.data.signal !== target.signal_type
    || packet.data.hold.actor !== RESOURCE_FRESHNESS_SCANNER_ACTOR
    || packet.data.hold.reason !== target.hold_reason
    || resourceFreshnessOutcomeError(packet.data, review.data)
  ) {
    return { state: 'awaiting_workflow', findingId: target.finding_id, holdCleared: false };
  }

  if (review.data.outcome === 'unable_to_verify') {
    if (!target.has_escalated_transition || !['escalated', 'archived'].includes(target.submission_status)) {
      return { state: 'awaiting_workflow', findingId: target.finding_id, holdCleared: false };
    }
    return {
      state: 'verification_inconclusive',
      findingId: target.finding_id,
      holdCleared: false,
    };
  }

  if (review.data.outcome === 'confirmed_unavailable') {
    if (!target.has_denied_transition || !['denied', 'archived'].includes(target.submission_status)) {
      return { state: 'awaiting_workflow', findingId: target.finding_id, holdCleared: false };
    }
    const firstReview = parseStoredDestructiveFreshnessReview(
      payload.resourceFreshnessFirstReview,
    );
    const secondReview = parseStoredDestructiveFreshnessReview(
      payload.resourceFreshnessSecondReview,
    );
    const firstRecordedAt = firstReview ? Date.parse(firstReview.recordedAt) : Number.NaN;
    const secondRecordedAt = secondReview ? Date.parse(secondReview.recordedAt) : Number.NaN;
    if (
      !target.first_destructive_transition_id
      || !target.first_destructive_actor_user_id
      || !target.denied_transition_id
      || !target.denied_actor_user_id
      || !firstReview
      || !secondReview
      || firstReview.reviewerUserId !== target.first_destructive_actor_user_id
      || secondReview.reviewerUserId !== target.denied_actor_user_id
      || firstReview.transitionId !== target.first_destructive_transition_id
      || secondReview.transitionId !== target.denied_transition_id
      || firstReview.reviewerUserId === secondReview.reviewerUserId
      || secondRecordedAt <= firstRecordedAt
      || resourceFreshnessOutcomeError(packet.data, firstReview.review)
      || resourceFreshnessOutcomeError(packet.data, secondReview.review)
      || JSON.stringify(secondReview.review) !== JSON.stringify(review.data)
    ) {
      return { state: 'awaiting_workflow', findingId: target.finding_id, holdCleared: false };
    }
    const scannerOwnsCurrentHold =
      target.integrity_hold_reason === target.hold_reason
      && target.integrity_held_by_user_id === RESOURCE_FRESHNESS_SCANNER_ACTOR;
    const actorUserId = target.denied_actor_user_id ?? RESOURCE_FRESHNESS_SCANNER_ACTOR;
    let holdCleared = false;
    let serviceInactivated = false;

    if (scannerOwnsCurrentHold && target.service_status !== 'defunct') {
      const inactivated = await client.query<{ id: string }>(
        `UPDATE public.services
         SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE status END,
             integrity_hold_at = NULL,
             integrity_hold_reason = NULL,
             integrity_held_by_user_id = NULL,
             updated_at = now(),
             updated_by_user_id = $1
         WHERE id = $2
           AND status <> 'defunct'
           AND integrity_hold_reason = $3
           AND integrity_held_by_user_id = $4
         RETURNING id`,
        [
          actorUserId,
          target.service_id,
          target.hold_reason,
          RESOURCE_FRESHNESS_SCANNER_ACTOR,
        ],
      );
      holdCleared = inactivated.rows.length === 1;
      serviceInactivated = target.service_status === 'active' && holdCleared;
    } else if (target.service_status === 'active') {
      const inactivated = await client.query<{ id: string }>(
        `UPDATE public.services
         SET status = 'inactive',
             updated_at = now(),
             updated_by_user_id = $1
         WHERE id = $2
           AND status = 'active'
         RETURNING id`,
        [actorUserId, target.service_id],
      );
      serviceInactivated = inactivated.rows.length === 1;
    }

    if (serviceInactivated) {
      await client.query(
        `INSERT INTO public.lifecycle_events
           (entity_type, entity_id, event_type, from_status, to_status,
            actor_type, actor_id, reason, metadata)
         VALUES
           ('service', $1, 'verification_lost', 'active', 'inactive',
            'human', $2, 'Structured freshness review confirmed the service unavailable',
            $3::jsonb)`,
        [
          target.service_id,
          actorUserId,
          JSON.stringify({
            findingId: target.finding_id,
            signalType: target.signal_type,
            submissionId,
          }),
        ],
      );
    }

    const resolution = target.service_status === 'defunct'
      ? 'structured_review_confirmed_unavailable_service_already_defunct'
      : holdCleared
        ? 'structured_review_confirmed_unavailable_service_inactive_scanner_hold_cleared'
        : 'structured_review_confirmed_unavailable_service_inactive_non_scanner_hold_retained';
    await client.query(
      `UPDATE oran_internal.resource_freshness_findings
       SET status = 'confirmed_unavailable',
           resolved_at = now(),
           resolution = $2
       WHERE id = $1 AND status = 'open'`,
      [target.finding_id, resolution],
    );
    return {
      state: 'confirmed_unavailable',
      findingId: target.finding_id,
      holdCleared,
    };
  }

  if (
    !target.has_approved_transition
    || !target.approved_transition_id
    || !target.approved_actor_user_id
    || !['approved', 'archived'].includes(target.submission_status)
  ) {
    return { state: 'awaiting_workflow', findingId: target.finding_id, holdCleared: false };
  }

  if (target.signal_type === 'explicit_expiry') {
    const schedulesAreCurrent = await applyAndValidateExplicitExpiryCorrections(
      client,
      target.service_id,
      target.approved_actor_user_id ?? RESOURCE_FRESHNESS_SCANNER_ACTOR,
      review.data,
    );
    if (!schedulesAreCurrent) {
      return {
        state: 'awaiting_schedule_correction',
        findingId: target.finding_id,
        holdCleared: false,
      };
    }
  }

  const nextWindow = await advanceReverificationWindow(
    client,
    target.service_id,
    review.data.checkedAt,
  );
  await appendLifecycleEvent(client, {
    entityType: 'service',
    entityId: target.service_id,
    eventType: 'verified',
    fromStatus: target.service_status,
    toStatus: target.service_status,
    actorType: 'human',
    actorId: target.approved_actor_user_id,
    metadata: {
      submissionId,
      approvalTransitionId: target.approved_transition_id,
      findingId: target.finding_id,
      signalType: target.signal_type,
      verifiedAt: review.data.checkedAt,
      reverifyAt: nextWindow.reverifyAt,
      verificationApplied: true,
    },
  });

  let scannerOwnsCurrentHold =
    target.integrity_hold_reason === target.hold_reason
    && target.integrity_held_by_user_id === RESOURCE_FRESHNESS_SCANNER_ACTOR
    && target.integrity_hold_at !== null;
  let scannerHoldRecovered = false;
  let alternateHoldTimestampRecovered = false;

  // A live active service with no hold timestamp is visible to seekers. When
  // all hold metadata is absent, recover the exact scanner hold before
  // compare-clearing it. Partial metadata may belong to another policy: make
  // that hold effective without overwriting its reason or actor.
  if (
    !scannerOwnsCurrentHold
    && target.service_status === 'active'
    && target.integrity_hold_at === null
  ) {
    const hasPartialHoldMetadata = target.integrity_hold_reason !== null
      || target.integrity_held_by_user_id !== null;
    const recovered = hasPartialHoldMetadata
      ? await client.query<{ id: string }>(
          `UPDATE public.services
           SET integrity_hold_at = now(),
               updated_at = now()
           WHERE id = $1
             AND status = 'active'
             AND integrity_hold_at IS NULL
             AND (
               integrity_hold_reason IS NOT NULL
               OR integrity_held_by_user_id IS NOT NULL
             )
           RETURNING id`,
          [target.service_id],
        )
      : await client.query<{ id: string }>(
          `UPDATE public.services
           SET integrity_hold_at = now(),
               integrity_hold_reason = $1,
               integrity_held_by_user_id = $2,
               updated_by_user_id = $2
           WHERE id = $3
             AND status = 'active'
             AND integrity_hold_at IS NULL
             AND integrity_hold_reason IS NULL
             AND integrity_held_by_user_id IS NULL
           RETURNING id`,
          [target.hold_reason, RESOURCE_FRESHNESS_SCANNER_ACTOR, target.service_id],
        );
    if (recovered.rows.length !== 1) {
      throw new Error('Freshness reconciliation could not recover its missing publication hold');
    }
    if (hasPartialHoldMetadata) {
      alternateHoldTimestampRecovered = true;
    } else {
      scannerOwnsCurrentHold = true;
      scannerHoldRecovered = true;
    }
  }

  let holdCleared = false;
  if (scannerOwnsCurrentHold) {
    const cleared = await client.query<{ id: string }>(
      `UPDATE public.services
       SET integrity_hold_at = NULL,
           integrity_hold_reason = NULL,
           integrity_held_by_user_id = NULL,
           updated_by_user_id = $1
       WHERE id = $2
         AND integrity_hold_reason = $3
         AND integrity_held_by_user_id = $1
       RETURNING id`,
      [RESOURCE_FRESHNESS_SCANNER_ACTOR, target.service_id, target.hold_reason],
    );
    holdCleared = cleared.rows.length === 1;
  }

  const resolution = holdCleared
    ? scannerHoldRecovered
      ? `structured_review_${review.data.outcome}_missing_scanner_hold_recovered_and_cleared`
      : `structured_review_${review.data.outcome}_scanner_hold_cleared`
    : target.integrity_hold_at !== null || alternateHoldTimestampRecovered
      ? alternateHoldTimestampRecovered
        ? `structured_review_${review.data.outcome}_partial_alternate_hold_recovered_and_retained`
        : `structured_review_${review.data.outcome}_non_scanner_hold_retained`
      : `structured_review_${review.data.outcome}_inactive_or_defunct_service_retained`;
  await client.query(
    `UPDATE oran_internal.resource_freshness_findings
     SET status = 'resolved', resolved_at = now(), resolution = $2
     WHERE id = $1 AND status = 'open'`,
    [target.finding_id, resolution],
  );

  return {
    state: holdCleared ? 'hold_cleared' : 'non_scanner_hold_retained',
    findingId: target.finding_id,
    holdCleared,
  };
}

export async function reconcileResourceFreshnessReview(
  client: PoolClient,
  submissionId: string,
): Promise<ResourceFreshnessReconciliationResult> {
  await acquireLivePublicationGateShared(client);
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtextextended('oran:resource-freshness-scan', 0)
     )`,
  );
  await acquireProtectedMaintenanceGatesShared(client);
  return reconcileResourceFreshnessReviewLocked(client, submissionId);
}

async function reconcileCompletedReviews(
  client: PoolClient,
  limit: number,
): Promise<{
  attemptedCount: number;
  resolvedCount: number;
  confirmedUnavailableCount: number;
  protectedAuthoritySkippedCount: number;
}> {
  const protectedOpen = await client.query<{ protected_count: number | string }>(
    `SELECT count(*)::int AS protected_count
     FROM oran_internal.resource_freshness_findings finding
     WHERE finding.status = 'open'
       AND (
         EXISTS (
           SELECT 1
           FROM oran_internal.hotline_authority_members member
           JOIN oran_internal.hotline_authority_batches batch
             ON batch.id = member.batch_id
           WHERE batch.status IN ('staging', 'applied')
             AND member.service_id = finding.service_id
         )
         OR EXISTS (
           SELECT 1
           FROM oran_internal.resource_quarantine_members member
           JOIN oran_internal.resource_quarantine_batches batch
             ON batch.id = member.batch_id
           WHERE batch.status IN ('applying', 'applied', 'rolling_back')
             AND member.service_id = finding.service_id
         )
       )`,
  );
  const candidates = await client.query<{ submission_id: string; service_id: string }>(
    `SELECT finding.submission_id, finding.service_id
     FROM oran_internal.resource_freshness_findings finding
     JOIN public.submissions sub ON sub.id = finding.submission_id
     WHERE finding.status = 'open'
       AND finding.submission_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM oran_internal.hotline_authority_members member
         JOIN oran_internal.hotline_authority_batches batch
           ON batch.id = member.batch_id
         WHERE batch.status IN ('staging', 'applied')
           AND member.service_id = finding.service_id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM oran_internal.resource_quarantine_members member
         JOIN oran_internal.resource_quarantine_batches batch
           ON batch.id = member.batch_id
         WHERE batch.status IN ('applying', 'applied', 'rolling_back')
           AND member.service_id = finding.service_id
       )
       AND coalesce(sub.payload, '{}'::jsonb) ? 'resourceFreshnessReview'
       AND (
         (
           sub.status = 'approved'
           AND sub.payload #>> '{resourceFreshnessReview,outcome}'
             IN ('confirmed_current', 'corrected')
         )
         OR (
           sub.status = 'denied'
           AND sub.payload #>> '{resourceFreshnessReview,outcome}'
             = 'confirmed_unavailable'
         )
         OR (
           sub.status = 'archived'
           AND sub.payload #>> '{resourceFreshnessReview,outcome}'
             IN ('confirmed_current', 'corrected', 'confirmed_unavailable')
         )
       )
     ORDER BY finding.detected_at, finding.id
     LIMIT $1`,
    [limit],
  );

  const protectedServiceIds = new Set(
    (await findProtectedAuthoritativeEntities(client, {
      serviceIds: candidates.rows.map((candidate) => candidate.service_id),
    })).map((match) => match.entityId),
  );

  let resolvedCount = 0;
  let confirmedUnavailableCount = 0;
  let protectedAuthoritySkippedCount = Number(
    protectedOpen.rows[0]?.protected_count ?? 0,
  );
  for (const candidate of candidates.rows) {
    if (protectedServiceIds.has(candidate.service_id)) {
      protectedAuthoritySkippedCount += 1;
      continue;
    }
    const reconciliation = await reconcileResourceFreshnessReviewLocked(
      client,
      candidate.submission_id,
    );
    if (
      reconciliation.state === 'hold_cleared'
      || reconciliation.state === 'non_scanner_hold_retained'
    ) {
      resolvedCount += 1;
    } else if (reconciliation.state === 'confirmed_unavailable') {
      confirmedUnavailableCount += 1;
    }
  }

  return {
    attemptedCount: candidates.rows.length,
    resolvedCount,
    confirmedUnavailableCount,
    protectedAuthoritySkippedCount,
  };
}

export async function runResourceFreshnessScan(
  client: PoolClient,
  options: ResourceFreshnessScanOptions = {},
): Promise<ResourceFreshnessScanResult> {
  const limit = normalizeLimit(options.limit);
  const asOf = (options.asOf ?? new Date()).toISOString();

  // Global order for live visibility writers: publication -> freshness ->
  // protected maintenance gates -> entity rows.
  await acquireLivePublicationGateShared(client);
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtextextended('oran:resource-freshness-scan', 0)
     )`,
  );
  await acquireProtectedMaintenanceGatesShared(client);

  // Catch-up and discovery share one total service budget. Inconclusive
  // escalations remain intentionally open until an ORAN admin reclaims them,
  // so they are excluded from this retry lane instead of being locked and
  // re-parsed on every nationwide scan.
  const reconciliation = await reconcileCompletedReviews(client, limit);
  const remainingCandidateBudget = Math.max(0, limit - reconciliation.attemptedCount);
  const candidates = remainingCandidateBudget > 0
    ? await client.query<FreshnessCandidateRow>(
        RESOURCE_FRESHNESS_CANDIDATE_SQL,
        [
          remainingCandidateBudget,
          asOf,
          CANONICAL_STALE_AFTER_DAYS,
          UNKNOWN_SOURCE_STALE_AFTER_DAYS,
          [...LINKABLE_VERIFICATION_STATUSES],
        ],
      )
    : { rows: [] as FreshnessCandidateRow[] };
  const protectedServiceIds = new Set(
    (await findProtectedAuthoritativeEntities(client, {
      serviceIds: candidates.rows.map((candidate) => candidate.service_id),
    })).map((match) => match.entityId),
  );

  let findingCount = 0;
  let blockedCount = 0;
  let expiredBlockedCount = 0;
  let staleBlockedCount = 0;
  let reverificationDueBlockedCount = 0;
  let staleSourceBlockedCount = 0;
  let unknownSourceBlockedCount = 0;
  let protectedAuthoritySkippedCount = reconciliation.protectedAuthoritySkippedCount;
  let enqueuedCount = 0;
  let linkedToExistingCount = 0;

  for (const candidate of candidates.rows) {
    if (protectedServiceIds.has(candidate.service_id)) {
      protectedAuthoritySkippedCount += 1;
      continue;
    }
    const findingId = randomUUID();
    const holdReason = `resource_freshness:${candidate.signal_type}:${findingId}`;
    const reviewPacket = buildReviewPacket(candidate, asOf, findingId, holdReason);

    const insertedFinding = await client.query<{ id: string }>(
      `INSERT INTO oran_internal.resource_freshness_findings
         (id, service_id, submission_id, signal_type, signal_observed_at,
          freshness_threshold_days, evidence, status, hold_reason, blocked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'open', $8, $9)
       ON CONFLICT (service_id) WHERE status = 'open' DO NOTHING
       RETURNING id`,
      [
        findingId,
        candidate.service_id,
        null,
        candidate.signal_type,
        candidate.signal_observed_at,
        candidate.freshness_threshold_days,
        JSON.stringify(reviewPacket.observed),
        holdReason,
        asOf,
      ],
    );

    if (insertedFinding.rows.length === 0) continue;

    const held = await client.query<{ id: string }>(
      `UPDATE public.services
       SET integrity_hold_at = $1,
           integrity_hold_reason = $2,
           integrity_held_by_user_id = $3,
           updated_by_user_id = $3
       WHERE id = $4
         AND status = 'active'
         AND integrity_hold_at IS NULL
       RETURNING id`,
      [asOf, holdReason, RESOURCE_FRESHNESS_SCANNER_ACTOR, candidate.service_id],
    );

    if (held.rows.length === 0) {
      await client.query(
        `DELETE FROM oran_internal.resource_freshness_findings WHERE id = $1`,
        [findingId],
      );
      continue;
    }

    const priority = priorityForSignal(candidate.signal_type);
    const jurisdiction = routingJurisdiction(candidate);
    const reviewPayload = {
      resourceFreshness: reviewPacket,
    };
    const note = candidate.signal_type === 'explicit_expiry'
      ? 'Every attached schedule has an explicit valid-to date in the past. Correct the schedule before approving this listing.'
      : 'Freshness evidence is beyond ORAN\'s conservative review threshold. Reverify the provider and current service availability.';

    let linkedToExisting = false;
    if (candidate.existing_submission_id) {
      const linked = await client.query<{ id: string }>(
        `UPDATE public.submissions
         SET priority = greatest(priority, $1),
             payload = coalesce(payload, '{}'::jsonb) || $2::jsonb,
             jurisdiction_state = CASE
               WHEN jurisdiction_state IS NULL AND jurisdiction_county IS NULL THEN $6
               ELSE jurisdiction_state
             END,
             jurisdiction_county = CASE
               WHEN jurisdiction_state IS NULL AND jurisdiction_county IS NULL THEN $7
               WHEN jurisdiction_county IS NULL
                 AND $7::text IS NOT NULL
                 AND upper(trim(jurisdiction_state)) = upper(trim($6::text))
                 THEN $7
               ELSE jurisdiction_county
             END,
             notes = CASE
               WHEN coalesce(payload, '{}'::jsonb) ? 'resourceFreshness' THEN notes
               ELSE concat_ws(E'\\n\\n', nullif(notes, ''), $3)
             END,
             updated_at = now()
         WHERE id = $4
           AND status = ANY($5::text[])
           AND assigned_to_user_id IS NULL
           AND is_locked = false
           AND locked_at IS NULL
           AND locked_by_user_id IS NULL
           AND NOT (coalesce(payload, '{}'::jsonb) ?| ARRAY[
             'changeType', 'requestedChanges', 'resourceFreshness',
             'variant', 'channel'
           ])
           AND NOT EXISTS (
             SELECT 1
             FROM public.form_instances form_instance
             WHERE form_instance.submission_id = submissions.id
           )
         RETURNING id`,
        [
          priority,
          JSON.stringify(reviewPayload),
          `Resource freshness scan: ${note}`,
          candidate.existing_submission_id,
          [...LINKABLE_VERIFICATION_STATUSES],
          jurisdiction.state,
          jurisdiction.county,
        ],
      );
      if (linked.rows.length === 1) {
        const linkedFinding = await client.query<{ id: string }>(
          `UPDATE oran_internal.resource_freshness_findings
           SET submission_id = $1
           WHERE id = $2 AND submission_id IS NULL
           RETURNING id`,
          [candidate.existing_submission_id, findingId],
        );
        if (linkedFinding.rows.length !== 1) {
          throw new Error('Freshness finding could not be linked to existing review work');
        }
        linkedToExisting = true;
        linkedToExistingCount += 1;
      }
    }

    if (!linkedToExisting) {
      const submissionId = randomUUID();
      await client.query(
        `INSERT INTO public.submissions
         (id, submission_type, status, target_type, target_id, service_id,
            jurisdiction_state, jurisdiction_county, submitted_by_user_id,
            title, notes, payload, priority, submitted_at)
         VALUES
           ($1, 'service_verification', 'needs_review', 'service', $2, $2,
            $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        [
          submissionId,
          candidate.service_id,
          jurisdiction.state,
          jurisdiction.county,
          RESOURCE_FRESHNESS_SCANNER_ACTOR,
          `Freshness review: ${candidate.service_name}`,
          note,
          JSON.stringify(reviewPayload),
          priority,
          asOf,
        ],
      );

      await client.query(
        `INSERT INTO public.submission_transitions
           (submission_id, from_status, to_status, actor_user_id, actor_role,
            reason, gates_checked, gates_passed, metadata)
         VALUES
           ($1, 'draft', 'submitted', $2, 'system',
            'Scheduled resource freshness scan', '[]'::jsonb, true, $3::jsonb),
           ($1, 'submitted', 'needs_review', $2, 'system',
            'Deterministic freshness evidence requires community review', '[]'::jsonb, true, $3::jsonb)`,
        [
          submissionId,
          RESOURCE_FRESHNESS_SCANNER_ACTOR,
          JSON.stringify({ findingId, signalType: candidate.signal_type }),
        ],
      );

      const linkedFinding = await client.query<{ id: string }>(
        `UPDATE oran_internal.resource_freshness_findings
         SET submission_id = $1
         WHERE id = $2 AND submission_id IS NULL
         RETURNING id`,
        [submissionId, findingId],
      );
      if (linkedFinding.rows.length !== 1) {
        throw new Error('Freshness finding could not be linked to its review submission');
      }
      enqueuedCount += 1;
    }

    findingCount += 1;
    blockedCount += 1;
    if (candidate.signal_type === 'explicit_expiry') {
      expiredBlockedCount += 1;
    } else {
      staleBlockedCount += 1;
      if (candidate.signal_type === 'reverification_due') {
        reverificationDueBlockedCount += 1;
      } else if (candidate.signal_type === 'stale_source') {
        staleSourceBlockedCount += 1;
      } else {
        unknownSourceBlockedCount += 1;
      }
    }
  }

  return {
    checkedCount: reconciliation.attemptedCount + candidates.rows.length,
    findingCount,
    blockedCount,
    expiredBlockedCount,
    staleBlockedCount,
    reverificationDueBlockedCount,
    staleSourceBlockedCount,
    unknownSourceBlockedCount,
    protectedAuthoritySkippedCount,
    enqueuedCount,
    linkedToExistingCount,
    resolvedCount: reconciliation.resolvedCount,
    confirmedUnavailableCount: reconciliation.confirmedUnavailableCount,
  };
}

export async function scanResourceFreshness(
  options: ResourceFreshnessScanOptions = {},
): Promise<ResourceFreshnessScanResult> {
  return withTransaction((client) => runResourceFreshnessScan(client, options));
}
