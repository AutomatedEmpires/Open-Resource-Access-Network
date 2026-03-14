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

    const [feedRows, sourceRecordRows, jobRows, candidateRows, readinessRows, submissionRows, publicationRows] = await Promise.all([
      executeQuery<{
        active_systems: string;
        active_feeds: string;
        paused_feeds: string;
        auto_publish_feeds: string;
        failed_feeds: string;
        running_feeds: string;
      }>(
        `SELECT
           COUNT(DISTINCT ss.id) FILTER (WHERE ss.is_active) AS active_systems,
           COUNT(sf.id) FILTER (WHERE sf.is_active) AS active_feeds,
           COUNT(sfs.source_feed_id) FILTER (WHERE sfs.emergency_pause) AS paused_feeds,
           COUNT(sfs.source_feed_id) FILTER (WHERE sfs.publication_mode = 'auto_publish') AS auto_publish_feeds,
           COUNT(sfs.source_feed_id) FILTER (WHERE sfs.last_attempt_status = 'failed') AS failed_feeds,
           COUNT(sfs.source_feed_id) FILTER (WHERE sfs.last_attempt_status = 'running') AS running_feeds
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
      active_systems: '0', active_feeds: '0', paused_feeds: '0', auto_publish_feeds: '0', failed_feeds: '0', running_feeds: '0',
    };
    const sourceRecords = sourceRecordRows[0] ?? { pending_source_records: '0', errored_source_records: '0' };
    const jobs = jobRows[0] ?? { queued_jobs: '0', running_jobs: '0', failed_jobs: '0', completed_jobs_24h: '0' };
    const candidates = candidateRows[0] ?? { pending_candidates: '0', in_review_candidates: '0', published_candidates: '0' };
    const readiness = readinessRows[0] ?? { ready_candidates: '0' };
    const submissions = submissionRows[0] ?? {
      submitted_submissions: '0', under_review_submissions: '0', pending_decision_submissions: '0', sla_breached_submissions: '0',
    };
    const publication = publicationRows[0] ?? {
      lifecycle_events_24h: '0', export_snapshots_24h: '0', approved_submissions_24h: '0',
    };

    return NextResponse.json({
      overview: {
        feeds: {
          activeSystems: toInt(feed.active_systems),
          activeFeeds: toInt(feed.active_feeds),
          pausedFeeds: toInt(feed.paused_feeds),
          autoPublishFeeds: toInt(feed.auto_publish_feeds),
          failedFeeds: toInt(feed.failed_feeds),
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
        },
        publication: {
          lifecycleEvents24h: toInt(publication.lifecycle_events_24h),
          exportSnapshots24h: toInt(publication.export_snapshots_24h),
          approvedSubmissions24h: toInt(publication.approved_submissions_24h),
        },
      },
    });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
