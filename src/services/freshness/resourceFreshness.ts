import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { withTransaction } from '@/services/db/postgres';

export const DEFAULT_FRESHNESS_SCAN_LIMIT = 100;
export const MAX_FRESHNESS_SCAN_LIMIT = 100;
export const CANONICAL_STALE_AFTER_DAYS = 180;
export const UNKNOWN_SOURCE_STALE_AFTER_DAYS = 365;

const SCANNER_ACTOR = 'system:resource-freshness-scan';
const ACTIVE_VERIFICATION_STATUSES = [
  'needs_review',
  'under_review',
  'escalated',
  'pending_second_approval',
] as const;

export type ResourceFreshnessSignal =
  | 'explicit_expiry'
  | 'reverification_due'
  | 'stale_source'
  | 'unknown_source';

interface FreshnessCandidateRow {
  service_id: string;
  service_name: string;
  organization_id: string;
  signal_type: ResourceFreshnessSignal;
  signal_observed_at: string;
  freshness_threshold_days: number | null;
  service_updated_at: string;
  last_source_refresh_at: string | null;
  last_candidate_verified_at: string | null;
  last_manual_verification_at: string | null;
  reverify_at: string | null;
  schedule_count: number;
  dated_schedule_count: number;
  max_valid_to: string | null;
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
  enqueuedCount: number;
  linkedToExistingCount: number;
  resolvedCount: number;
  confirmedUnavailableCount: number;
}

export const RESOURCE_FRESHNESS_CANDIDATE_SQL = `
WITH expired_schedule_rows AS (
  SELECT sch.service_id, sch.valid_to
  FROM public.schedules sch
  WHERE sch.service_id IS NOT NULL
    AND sch.valid_to < $2::date

  UNION ALL

  SELECT sal.service_id, sch.valid_to
  FROM public.schedules sch
  JOIN public.service_at_location sal ON sal.location_id = sch.location_id
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
due_reverification AS (
  SELECT ec.published_service_id AS service_id,
         'reverification_due'::text AS signal_type,
         min(ec.reverify_at) AS signal_observed_at,
         NULL::int AS freshness_threshold_days,
         0::int AS schedule_count,
         0::int AS dated_schedule_count,
         NULL::date AS max_valid_to,
         2 AS signal_priority
  FROM public.extracted_candidates ec
  WHERE ec.published_service_id IS NOT NULL
    AND ec.reverify_at <= $2::timestamptz
  GROUP BY ec.published_service_id
  ORDER BY min(ec.reverify_at), ec.published_service_id
  LIMIT greatest($1::int * 20, 100)
),
stale_canonical AS (
  SELECT cs.published_service_id AS service_id,
         'stale_source'::text AS signal_type,
         max(cs.last_refreshed_at) AS signal_observed_at,
         $3::int AS freshness_threshold_days,
         0::int AS schedule_count,
         0::int AS dated_schedule_count,
         NULL::date AS max_valid_to,
         3 AS signal_priority
  FROM public.canonical_services cs
  JOIN public.source_systems ss ON ss.id = cs.winning_source_system_id
  WHERE cs.published_service_id IS NOT NULL
    AND cs.lifecycle_status = 'active'
    AND cs.publication_status = 'published'
    AND ss.resource_purpose IN ('service_catalog', 'program_navigation')
    AND cs.last_refreshed_at <= $2::timestamptz - ($3::int * interval '1 day')
    AND NOT EXISTS (
      SELECT 1
      FROM public.canonical_services newer
      JOIN public.source_systems newer_system
        ON newer_system.id = newer.winning_source_system_id
      WHERE newer.published_service_id = cs.published_service_id
        AND newer.lifecycle_status = 'active'
        AND newer.publication_status = 'published'
        AND newer_system.resource_purpose IN ('service_catalog', 'program_navigation')
        AND newer.last_refreshed_at > $2::timestamptz - ($3::int * interval '1 day')
    )
  GROUP BY cs.published_service_id
  ORDER BY max(cs.last_refreshed_at), cs.published_service_id
  LIMIT greatest($1::int * 20, 100)
),
unknown_source AS (
  SELECT s.id AS service_id,
         'unknown_source'::text AS signal_type,
         s.updated_at AS signal_observed_at,
         $4::int AS freshness_threshold_days,
         0::int AS schedule_count,
         0::int AS dated_schedule_count,
         NULL::date AS max_valid_to,
         4 AS signal_priority
  FROM public.services s
  JOIN public.organizations o ON o.id = s.organization_id
  WHERE s.status = 'active'
    AND o.status = 'active'
    AND s.integrity_hold_at IS NULL
    AND s.updated_at <= $2::timestamptz - ($4::int * interval '1 day')
    AND NOT EXISTS (
      SELECT 1
      FROM public.canonical_services canonical
      WHERE canonical.published_service_id = s.id
    )
  ORDER BY s.updated_at, s.id
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
  JOIN public.services service ON service.id = signal.service_id
  JOIN public.organizations organization ON organization.id = service.organization_id
  LEFT JOIN LATERAL (
    SELECT max(canonical.last_refreshed_at) AS last_source_refresh_at
    FROM public.canonical_services canonical
    JOIN public.source_systems source_system
      ON source_system.id = canonical.winning_source_system_id
    WHERE canonical.published_service_id = signal.service_id
      AND canonical.lifecycle_status = 'active'
      AND canonical.publication_status = 'published'
      AND source_system.resource_purpose IN ('service_catalog', 'program_navigation')
  ) source_freshness ON true
  LEFT JOIN LATERAL (
    SELECT max(candidate.last_verified_at) AS last_candidate_verified_at
    FROM public.extracted_candidates candidate
    WHERE candidate.published_service_id = signal.service_id
  ) candidate_verification ON true
  LEFT JOIN LATERAL (
    SELECT max(score.computed_at) AS last_manual_verification_at
    FROM public.confidence_scores score
    WHERE score.service_id = signal.service_id
      AND score.verification_confidence > 0
  ) manual_verification ON true
  WHERE service.status = 'active'
    AND organization.status = 'active'
    AND service.integrity_hold_at IS NULL
    AND NOT (
      service.name = 'SNAP/EBT accepted here'
      AND service.description LIKE '%Source: USDA FNS SNAP Retailer Locator.%'
      AND service.description LIKE '%place to SPEND SNAP benefits (not a free-food or food-bank site)%'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.canonical_services publication_source
      LEFT JOIN public.source_systems publication_system
        ON publication_system.id = publication_source.winning_source_system_id
      WHERE publication_source.published_service_id = service.id
        AND (
          publication_source.lifecycle_status <> 'active'
          OR publication_source.publication_status <> 'published'
          OR publication_source.winning_source_system_id IS NULL
          OR publication_system.id IS NULL
          OR publication_system.resource_purpose IS NULL
          OR publication_system.resource_purpose NOT IN ('service_catalog', 'program_navigation')
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM oran_internal.resource_freshness_findings open_finding
      WHERE open_finding.service_id = service.id
        AND open_finding.status = 'open'
    )
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
       AND greatest(
         detail.service_updated_at,
         detail.last_candidate_verified_at,
         detail.last_manual_verification_at
       ) <= $2::timestamptz - ($4::int * interval '1 day')
     )
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
       detail.reverify_at,
       detail.schedule_count,
       detail.dated_schedule_count,
       detail.max_valid_to,
       existing_submission.id AS existing_submission_id
FROM eligible_signals detail
LEFT JOIN LATERAL (
  SELECT sub.id
  FROM public.submissions sub
  WHERE sub.service_id = detail.service_id
    AND sub.submission_type = 'service_verification'
    AND sub.status = ANY($5::text[])
  ORDER BY sub.created_at ASC
  LIMIT 1
) existing_submission ON true
ORDER BY
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

function buildEvidence(candidate: FreshnessCandidateRow, asOf: string) {
  return {
    scannerVersion: 1,
    signalType: candidate.signal_type,
    detectedAsOf: asOf,
    signalObservedAt: candidate.signal_observed_at,
    freshnessThresholdDays: candidate.freshness_threshold_days,
    serviceUpdatedAt: candidate.service_updated_at,
    lastSourceRefreshAt: candidate.last_source_refresh_at,
    lastCandidateVerifiedAt: candidate.last_candidate_verified_at,
    lastManualVerificationAt: candidate.last_manual_verification_at,
    reverifyAt: candidate.reverify_at,
    scheduleCount: candidate.schedule_count,
    datedScheduleCount: candidate.dated_schedule_count,
    maxValidTo: candidate.max_valid_to,
  };
}

async function reconcileCompletedReviews(client: PoolClient): Promise<{
  resolvedCount: number;
  confirmedUnavailableCount: number;
}> {
  const resolved = await client.query<{ id: string }>(
    `WITH review_targets AS (
       SELECT finding.id AS finding_id,
              finding.service_id,
              finding.signal_type,
              finding.hold_reason
       FROM oran_internal.resource_freshness_findings finding
       JOIN public.submissions sub ON sub.id = finding.submission_id
       WHERE finding.status = 'open'
         AND sub.status IN ('approved', 'archived')
         AND EXISTS (
           SELECT 1
           FROM public.submission_transitions transition
           WHERE transition.submission_id = sub.id
             AND transition.to_status = 'approved'
             AND transition.gates_passed = true
         )
     ),
     explicit_targets AS (
       SELECT DISTINCT service_id
       FROM review_targets
       WHERE signal_type = 'explicit_expiry'
     ),
     attached_schedules AS (
       SELECT sch.service_id, sch.valid_to
       FROM public.schedules sch
       JOIN explicit_targets target ON target.service_id = sch.service_id
       WHERE sch.service_id IS NOT NULL
       UNION ALL
       SELECT sal.service_id, sch.valid_to
       FROM public.schedules sch
       JOIN public.service_at_location sal ON sal.location_id = sch.location_id
       JOIN explicit_targets target ON target.service_id = sal.service_id
       WHERE sch.service_id IS NULL AND sch.location_id IS NOT NULL
     ),
     still_expired AS (
       SELECT service_id
       FROM attached_schedules
       GROUP BY service_id
       HAVING count(*) > 0
          AND count(valid_to) = count(*)
          AND max(valid_to) < current_date
     ),
     resolvable AS (
       SELECT target.finding_id,
              target.service_id,
              target.hold_reason
       FROM review_targets target
       WHERE (
           target.signal_type <> 'explicit_expiry'
           OR NOT EXISTS (
             SELECT 1 FROM still_expired expired
             WHERE expired.service_id = target.service_id
           )
         )
     ),
     cleared AS (
       UPDATE public.services service
       SET integrity_hold_at = NULL,
           integrity_hold_reason = NULL,
           integrity_held_by_user_id = NULL,
           updated_by_user_id = $1
       FROM resolvable
       WHERE service.id = resolvable.service_id
         AND service.integrity_hold_reason = resolvable.hold_reason
         AND service.integrity_held_by_user_id = $1
       RETURNING resolvable.finding_id
     )
     UPDATE oran_internal.resource_freshness_findings finding
     SET status = 'resolved',
         resolved_at = now(),
         resolution = 'submission_approved_and_expiry_cleared'
     FROM cleared
     WHERE finding.id = cleared.finding_id
     RETURNING finding.id`,
    [SCANNER_ACTOR],
  );

  const confirmed = await client.query<{ id: string }>(
    `UPDATE oran_internal.resource_freshness_findings finding
     SET status = 'confirmed_unavailable',
         resolved_at = now(),
         resolution = 'submission_denied_publication_hold_retained'
     FROM public.submissions sub
     WHERE finding.submission_id = sub.id
       AND finding.status = 'open'
       AND sub.status IN ('denied', 'archived')
       AND EXISTS (
         SELECT 1
         FROM public.submission_transitions transition
         WHERE transition.submission_id = sub.id
           AND transition.to_status = 'denied'
           AND transition.gates_passed = true
       )
     RETURNING finding.id`,
    [],
  );

  return {
    resolvedCount: resolved.rowCount ?? resolved.rows.length,
    confirmedUnavailableCount: confirmed.rowCount ?? confirmed.rows.length,
  };
}

export async function runResourceFreshnessScan(
  client: PoolClient,
  options: ResourceFreshnessScanOptions = {},
): Promise<ResourceFreshnessScanResult> {
  const limit = normalizeLimit(options.limit);
  const asOf = (options.asOf ?? new Date()).toISOString();

  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtextextended('oran:resource-freshness-scan', 0)
     )`,
  );

  const reconciliation = await reconcileCompletedReviews(client);
  const candidates = await client.query<FreshnessCandidateRow>(
    RESOURCE_FRESHNESS_CANDIDATE_SQL,
    [
      limit,
      asOf,
      CANONICAL_STALE_AFTER_DAYS,
      UNKNOWN_SOURCE_STALE_AFTER_DAYS,
      [...ACTIVE_VERIFICATION_STATUSES],
    ],
  );

  let findingCount = 0;
  let blockedCount = 0;
  let expiredBlockedCount = 0;
  let staleBlockedCount = 0;
  let enqueuedCount = 0;
  let linkedToExistingCount = 0;

  for (const candidate of candidates.rows) {
    const findingId = randomUUID();
    const holdReason = `resource_freshness:${candidate.signal_type}:${findingId}`;
    const evidence = buildEvidence(candidate, asOf);

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
        candidate.existing_submission_id,
        candidate.signal_type,
        candidate.signal_observed_at,
        candidate.freshness_threshold_days,
        JSON.stringify(evidence),
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
      [asOf, holdReason, SCANNER_ACTOR, candidate.service_id],
    );

    if (held.rows.length === 0) {
      await client.query(
        `DELETE FROM oran_internal.resource_freshness_findings WHERE id = $1`,
        [findingId],
      );
      continue;
    }

    const priority = priorityForSignal(candidate.signal_type);
    const reviewPayload = {
      resourceFreshness: {
        findingId,
        ...evidence,
      },
    };
    const note = candidate.signal_type === 'explicit_expiry'
      ? 'Every attached schedule has an explicit valid-to date in the past. Correct the schedule before approving this listing.'
      : 'Freshness evidence is beyond ORAN\'s conservative review threshold. Reverify the provider and current service availability.';

    if (candidate.existing_submission_id) {
      await client.query(
        `UPDATE public.submissions
         SET priority = greatest(priority, $1),
             payload = coalesce(payload, '{}'::jsonb) || $2::jsonb,
             notes = CASE
               WHEN coalesce(payload, '{}'::jsonb) ? 'resourceFreshness' THEN notes
               ELSE concat_ws(E'\\n\\n', nullif(notes, ''), $3)
             END,
             updated_at = now()
         WHERE id = $4`,
        [
          priority,
          JSON.stringify(reviewPayload),
          `Resource freshness scan: ${note}`,
          candidate.existing_submission_id,
        ],
      );
      linkedToExistingCount += 1;
    } else {
      const submissionId = randomUUID();
      await client.query(
        `INSERT INTO public.submissions
           (id, submission_type, status, target_type, target_id, service_id,
            submitted_by_user_id, title, notes, payload, priority, submitted_at)
         VALUES
           ($1, 'service_verification', 'needs_review', 'service', $2, $2,
            $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          submissionId,
          candidate.service_id,
          SCANNER_ACTOR,
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
          SCANNER_ACTOR,
          JSON.stringify({ findingId, signalType: candidate.signal_type }),
        ],
      );

      await client.query(
        `UPDATE oran_internal.resource_freshness_findings
         SET submission_id = $1
         WHERE id = $2 AND submission_id IS NULL`,
        [submissionId, findingId],
      );
      enqueuedCount += 1;
    }

    findingCount += 1;
    blockedCount += 1;
    if (candidate.signal_type === 'explicit_expiry') {
      expiredBlockedCount += 1;
    } else {
      staleBlockedCount += 1;
    }
  }

  return {
    checkedCount: candidates.rows.length,
    findingCount,
    blockedCount,
    expiredBlockedCount,
    staleBlockedCount,
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
