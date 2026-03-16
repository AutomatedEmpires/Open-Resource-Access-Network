/**
 * GET /api/admin/ingestion/overview — Cross-family ingestion operations summary.
 *
 * ORAN-admin only. Read-only aggregation across feed operations,
 * candidate pipeline activity, submission backlog, and publication activity.
 */

import { NextRequest, NextResponse } from 'next/server';

import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import { assessIngestionDegradedMode } from '@/services/ingestion/feedHealth';
import { assessIngestionWorkforceHealth } from '@/services/ingestion/workforceHealth';

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function toInt(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  return Number.parseInt(value ?? '0', 10) || 0;
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(ip, {
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  try {
    const authCtx = await getAuthContext();
    if (!authCtx) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!requireMinRole(authCtx, 'oran_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const [feedRows, sourceRecordRows, jobRows, candidateRows, readinessRows, submissionRows, workforceRows, incidentRows, incidentActionRows, publicationRows] = await Promise.all([
      executeQuery<{
        active_systems: string;
        active_feeds: string;
        paused_feeds: string;
        auto_publish_feeds: string;
        failed_feeds: string;
        running_feeds: string;
        silent_feeds: string;
        silent_auto_publish_feeds: string;
      }>(
        `SELECT
           COUNT(DISTINCT ss.id) FILTER (WHERE ss.is_active) AS active_systems,
           COUNT(sf.id) FILTER (WHERE sf.is_active) AS active_feeds,
           COUNT(sfs.source_feed_id) FILTER (WHERE sfs.emergency_pause) AS paused_feeds,
           COUNT(sfs.source_feed_id) FILTER (WHERE sfs.publication_mode = 'auto_publish') AS auto_publish_feeds,
           COUNT(sfs.source_feed_id) FILTER (WHERE sfs.last_attempt_status = 'failed') AS failed_feeds,
           COUNT(sfs.source_feed_id) FILTER (WHERE sfs.last_attempt_status = 'running') AS running_feeds,
           COUNT(sf.id) FILTER (
             WHERE sf.is_active
               AND COALESCE(sfs.last_successful_sync_completed_at, sfs.last_attempt_completed_at, sf.last_polled_at)
                   < NOW() - INTERVAL '72 hours'
           ) AS silent_feeds,
           COUNT(sf.id) FILTER (
             WHERE sf.is_active
               AND sfs.publication_mode = 'auto_publish'
               AND COALESCE(sfs.last_successful_sync_completed_at, sfs.last_attempt_completed_at, sf.last_polled_at)
                   < NOW() - INTERVAL '72 hours'
           ) AS silent_auto_publish_feeds
         FROM source_systems ss
         LEFT JOIN source_feeds sf ON sf.source_system_id = ss.id
         LEFT JOIN source_feed_states sfs ON sfs.source_feed_id = sf.id`,
        [],
      ),
      executeQuery<{
        pending_source_records: string;
        errored_source_records: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE processing_status = 'pending') AS pending_source_records,
           COUNT(*) FILTER (WHERE processing_status = 'error') AS errored_source_records
         FROM source_records`,
        [],
      ),
      executeQuery<{
        queued_jobs: string;
        running_jobs: string;
        failed_jobs: string;
        completed_jobs_24h: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'queued') AS queued_jobs,
           COUNT(*) FILTER (WHERE status = 'running') AS running_jobs,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed_jobs,
           COUNT(*) FILTER (WHERE completed_at >= NOW() - INTERVAL '24 hours') AS completed_jobs_24h
         FROM ingestion_jobs`,
        [],
      ),
      executeQuery<{
        pending_candidates: string;
        in_review_candidates: string;
        published_candidates: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE review_status = 'pending') AS pending_candidates,
           COUNT(*) FILTER (WHERE review_status = 'in_review') AS in_review_candidates,
           COUNT(*) FILTER (WHERE review_status = 'published') AS published_candidates
         FROM extracted_candidates`,
        [],
      ),
      executeQuery<{
        ready_candidates: string;
      }>(
        `SELECT COUNT(*) FILTER (WHERE is_ready) AS ready_candidates
         FROM candidate_readiness`,
        [],
      ),
      executeQuery<{
        submitted_submissions: string;
        under_review_submissions: string;
        pending_decision_submissions: string;
        sla_breached_submissions: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'submitted') AS submitted_submissions,
           COUNT(*) FILTER (WHERE status = 'under_review') AS under_review_submissions,
           COUNT(*) FILTER (WHERE status IN ('submitted', 'auto_checking', 'needs_review', 'under_review', 'pending_second_approval')) AS pending_decision_submissions,
           COUNT(*) FILTER (WHERE sla_breached) AS sla_breached_submissions
         FROM submissions`,
        [],
      ),
      executeQuery<{
        silent_reviewers: string;
        stalled_reviewer_assignments: string;
        silent_host_admins: string;
        silent_owner_organizations: string;
      }>(
        `WITH pending_submissions AS (
           SELECT assigned_to_user_id, created_at, updated_at
           FROM submissions
           WHERE status IN ('submitted', 'auto_checking', 'needs_review', 'under_review', 'pending_second_approval')
         ),
         reviewer_activity AS (
           SELECT actor_user_id, MAX(created_at) AS last_review_at
           FROM submission_transitions
           WHERE actor_role IN ('community_admin', 'oran_admin')
           GROUP BY actor_user_id
         ),
         silent_reviewers AS (
           SELECT p.assigned_to_user_id AS user_id, COUNT(*) AS assigned_count
           FROM pending_submissions p
           LEFT JOIN reviewer_activity ra ON ra.actor_user_id = p.assigned_to_user_id
           WHERE p.assigned_to_user_id IS NOT NULL
             AND COALESCE(ra.last_review_at, p.updated_at, p.created_at) < NOW() - INTERVAL '14 days'
             AND COALESCE(p.updated_at, p.created_at) < NOW() - INTERVAL '72 hours'
           GROUP BY p.assigned_to_user_id
         ),
         host_admin_activity AS (
           SELECT
             om.organization_id,
             om.user_id,
             GREATEST(
               COALESCE(om.updated_at, om.created_at),
               COALESCE(up.updated_at, up.created_at),
               COALESCE(MAX(host_sub.created_at), TIMESTAMPTZ 'epoch')
             ) AS last_owner_activity
           FROM organization_members om
           LEFT JOIN user_profiles up ON up.user_id = om.user_id
           LEFT JOIN submissions host_sub
             ON host_sub.submitted_by_user_id = om.user_id
            AND host_sub.submission_type IN ('service_verification', 'new_service', 'org_claim')
           WHERE om.role = 'host_admin'
             AND om.status = 'active'
           GROUP BY om.organization_id, om.user_id, om.updated_at, om.created_at, up.updated_at, up.created_at
         ),
         silent_owner_orgs AS (
           SELECT
             ha.organization_id,
             COUNT(*) FILTER (WHERE ha.last_owner_activity < NOW() - INTERVAL '30 days') AS silent_admins,
             COUNT(*) AS total_admins
           FROM host_admin_activity ha
           GROUP BY ha.organization_id
         ),
         fully_silent_owner_orgs AS (
           SELECT so.organization_id, so.silent_admins
           FROM silent_owner_orgs so
           WHERE so.total_admins > 0
             AND so.silent_admins = so.total_admins
             AND EXISTS (
               SELECT 1
               FROM services s
               WHERE s.organization_id = so.organization_id
                 AND s.status = 'active'
             )
         )
         SELECT
           (SELECT COUNT(*) FROM silent_reviewers) AS silent_reviewers,
           (SELECT COALESCE(SUM(assigned_count), 0) FROM silent_reviewers) AS stalled_reviewer_assignments,
           (SELECT COALESCE(SUM(silent_admins), 0) FROM fully_silent_owner_orgs) AS silent_host_admins,
           (SELECT COUNT(*) FROM fully_silent_owner_orgs) AS silent_owner_organizations`,
        [],
      ),
      executeQuery<{
        reclaimed_assignments_24h: string;
        owner_outreach_alerts_24h: string;
        integrity_held_services: string;
        integrity_holds_24h: string;
      }>(
        `SELECT
           COUNT(*) FILTER (
             WHERE event_type = 'system_alert'
               AND idempotency_key LIKE 'silent_reassign_%_marker'
               AND created_at >= NOW() - INTERVAL '24 hours'
           ) AS reclaimed_assignments_24h,
           COUNT(*) FILTER (
             WHERE event_type = 'system_alert'
               AND idempotency_key LIKE 'silent_owner_org_%_marker'
               AND created_at >= NOW() - INTERVAL '24 hours'
           ) AS owner_outreach_alerts_24h,
           (SELECT COUNT(*) FROM services WHERE integrity_hold_at IS NOT NULL AND status = 'active') AS integrity_held_services,
           (SELECT COUNT(*) FROM services WHERE integrity_hold_at >= NOW() - INTERVAL '24 hours' AND status = 'active') AS integrity_holds_24h
         FROM notification_events`,
        [],
      ),
      executeQuery<{
        kind: string;
        title: string;
        resource_type: string | null;
        resource_id: string | null;
        created_at: string;
      }>(
        `SELECT
           CASE
             WHEN idempotency_key LIKE 'silent_reassign_%_marker' THEN 'silent_reassignment'
             WHEN idempotency_key LIKE 'silent_owner_org_%_marker' THEN 'owner_continuity'
             ELSE 'integrity_intervention'
           END AS kind,
           title,
           resource_type,
           resource_id,
           created_at
         FROM notification_events
         WHERE event_type = 'system_alert'
           AND (
             idempotency_key LIKE 'silent_reassign_%_marker'
             OR idempotency_key LIKE 'silent_owner_org_%_marker'
           )
         ORDER BY created_at DESC
         LIMIT 8`,
        [],
      ),
      executeQuery<{
        lifecycle_events_24h: string;
        export_snapshots_24h: string;
        approved_submissions_24h: string;
      }>(
        `SELECT
           (SELECT COUNT(*)
              FROM lifecycle_events
             WHERE created_at >= NOW() - INTERVAL '24 hours'
               AND to_status = 'published') AS lifecycle_events_24h,
           (SELECT COUNT(*)
              FROM hsds_export_snapshots
             WHERE created_at >= NOW() - INTERVAL '24 hours') AS export_snapshots_24h,
           (SELECT COUNT(*)
              FROM submission_transitions
             WHERE created_at >= NOW() - INTERVAL '24 hours'
               AND to_status = 'approved') AS approved_submissions_24h`,
        [],
      ),
    ]);

    const feed = feedRows[0] ?? {
      active_systems: '0', active_feeds: '0', paused_feeds: '0', auto_publish_feeds: '0', failed_feeds: '0', running_feeds: '0', silent_feeds: '0', silent_auto_publish_feeds: '0',
    };
    const sourceRecords = sourceRecordRows[0] ?? { pending_source_records: '0', errored_source_records: '0' };
    const jobs = jobRows[0] ?? { queued_jobs: '0', running_jobs: '0', failed_jobs: '0', completed_jobs_24h: '0' };
    const candidates = candidateRows[0] ?? { pending_candidates: '0', in_review_candidates: '0', published_candidates: '0' };
    const readiness = readinessRows[0] ?? { ready_candidates: '0' };
    const submissions = submissionRows[0] ?? {
      submitted_submissions: '0', under_review_submissions: '0', pending_decision_submissions: '0', sla_breached_submissions: '0',
    };
    const workforce = workforceRows[0] ?? {
      silent_reviewers: '0', stalled_reviewer_assignments: '0', silent_host_admins: '0', silent_owner_organizations: '0',
    };
    const incidents = incidentRows[0] ?? {
      reclaimed_assignments_24h: '0', owner_outreach_alerts_24h: '0', integrity_held_services: '0', integrity_holds_24h: '0',
    };
    const incidentActions = incidentActionRows ?? [];
    const publication = publicationRows[0] ?? {
      lifecycle_events_24h: '0', export_snapshots_24h: '0', approved_submissions_24h: '0',
    };

    const feedHealth = {
      activeFeeds: toInt(feed.active_feeds),
      pausedFeeds: toInt(feed.paused_feeds),
      failedFeeds: toInt(feed.failed_feeds),
      autoPublishFeeds: toInt(feed.auto_publish_feeds),
      silentFeeds: toInt(feed.silent_feeds),
      silentAutoPublishFeeds: toInt(feed.silent_auto_publish_feeds),
    };
    const degradedMode = assessIngestionDegradedMode(feedHealth);
    const workforceHealth = {
      pendingDecisionSubmissions: toInt(submissions.pending_decision_submissions),
      slaBreachedSubmissions: toInt(submissions.sla_breached_submissions),
      silentReviewers: toInt(workforce.silent_reviewers),
      stalledReviewerAssignments: toInt(workforce.stalled_reviewer_assignments),
      silentHostAdmins: toInt(workforce.silent_host_admins),
      silentOwnerOrganizations: toInt(workforce.silent_owner_organizations),
    };
    const workforceStatus = assessIngestionWorkforceHealth(workforceHealth);
    const severityOrder = { normal: 0, elevated: 1, degraded: 2 } as const;
    const combinedSeverity = severityOrder[workforceStatus.severity] > severityOrder[degradedMode.severity]
      ? workforceStatus.severity
      : degradedMode.severity;

    return NextResponse.json({
      overview: {
        feeds: {
          activeSystems: toInt(feed.active_systems),
          ...feedHealth,
          runningFeeds: toInt(feed.running_feeds),
          pendingSourceRecords: toInt(sourceRecords.pending_source_records),
          erroredSourceRecords: toInt(sourceRecords.errored_source_records),
        },
        jobs: {
          queued: toInt(jobs.queued_jobs),
          running: toInt(jobs.running_jobs),
          failed: toInt(jobs.failed_jobs),
          completed24h: toInt(jobs.completed_jobs_24h),
        },
        candidates: {
          pending: toInt(candidates.pending_candidates),
          inReview: toInt(candidates.in_review_candidates),
          published: toInt(candidates.published_candidates),
          ready: toInt(readiness.ready_candidates),
        },
        submissions: {
          submitted: toInt(submissions.submitted_submissions),
          underReview: toInt(submissions.under_review_submissions),
          pendingDecision: toInt(submissions.pending_decision_submissions),
          slaBreached: toInt(submissions.sla_breached_submissions),
          silentReviewers: workforceHealth.silentReviewers,
          stalledReviewerAssignments: workforceHealth.stalledReviewerAssignments,
        },
        workforce: {
          silentHostAdmins: workforceHealth.silentHostAdmins,
          silentOwnerOrganizations: workforceHealth.silentOwnerOrganizations,
        },
        incidents: {
          reclaimedAssignments24h: toInt(incidents.reclaimed_assignments_24h),
          ownerOutreachAlerts24h: toInt(incidents.owner_outreach_alerts_24h),
          integrityHeldServices: toInt(incidents.integrity_held_services),
          integrityHolds24h: toInt(incidents.integrity_holds_24h),
          recentActions: incidentActions.map((action) => ({
            kind: action.kind,
            title: action.title,
            resourceType: action.resource_type,
            resourceId: action.resource_id,
            createdAt: action.created_at,
          })),
        },
        publication: {
          lifecycleEvents24h: toInt(publication.lifecycle_events_24h),
          exportSnapshots24h: toInt(publication.export_snapshots_24h),
          approvedSubmissions24h: toInt(publication.approved_submissions_24h),
        },
        health: {
          degradedModeRecommended: degradedMode.recommended || workforceStatus.recommended,
          degradedModeSeverity: combinedSeverity,
          degradedModeReasons: [...degradedMode.reasons, ...workforceStatus.reasons],
          freezeAutoPublish: degradedMode.freezeAutoPublish,
          requireReviewOnly: degradedMode.requireReviewOnly || workforceStatus.requireReviewOnly,
          requireOwnerOutreach: workforceStatus.requireOwnerOutreach,
        },
      },
    });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
