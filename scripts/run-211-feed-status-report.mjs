import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseArgs(argv) {
  const parsed = {
    feedId: '',
    hours: 72,
    format: 'plain',
    out: '',
    includeInactive: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--feed-id') {
      parsed.feedId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--hours') {
      parsed.hours = toInt(argv[index + 1], 72);
      index += 1;
      continue;
    }

    if (arg === '--format') {
      parsed.format = argv[index + 1] ?? 'plain';
      index += 1;
      continue;
    }

    if (arg === '--out') {
      parsed.out = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--include-inactive') {
      parsed.includeInactive = true;
    }
  }

  return parsed;
}

export function summarizeDecisionReasons(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value)
    .filter(([, count]) => Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count: Number(count) }));
}

export function classifyFeedHealth(feed, now = new Date()) {
  if (feed.emergencyPause) {
    return { status: 'paused', reason: 'emergency_pause', ageHours: null };
  }

  if (!feed.isActive) {
    return { status: 'inactive', reason: 'feed_inactive', ageHours: null };
  }

  if (!feed.lastAttemptCompletedAt) {
    return { status: 'attention', reason: 'never_polled', ageHours: null };
  }

  const completedAt = new Date(feed.lastAttemptCompletedAt);
  const ageHours = (now.getTime() - completedAt.getTime()) / (1000 * 60 * 60);
  const refreshIntervalHours = Math.max(Number(feed.refreshIntervalHours ?? 24), 1);
  const overdueThresholdHours = Math.max(refreshIntervalHours * 2, refreshIntervalHours + 1);

  if (feed.lastAttemptStatus === 'failed') {
    return { status: 'degraded', reason: 'last_attempt_failed', ageHours };
  }

  if (feed.replayFromCursor) {
    return { status: 'attention', reason: 'replay_pending', ageHours };
  }

  if (ageHours > overdueThresholdHours) {
    return { status: 'attention', reason: 'poll_overdue', ageHours };
  }

  return { status: 'healthy', reason: 'recent_success', ageHours };
}

function printUsageAndExit() {
  console.error([
    'Usage:',
    '  node scripts/run-211-feed-status-report.mjs [--feed-id <uuid>] [--hours 72] [--format plain|json|markdown] [--out path] [--include-inactive]',
    '',
    'Required env:',
    '  DATABASE_URL',
  ].join('\n'));
  process.exit(1);
}

async function queryFeeds(pool, args) {
  const result = await pool.query(
    `SELECT
      sf.id,
      sf.feed_name,
      sf.feed_type,
      sf.feed_handler,
      sf.base_url,
      sf.refresh_interval_hours,
      sf.is_active,
      sf.last_polled_at,
      sf.last_success_at,
      sf.last_error,
      sf.error_count,
      ss.id AS source_system_id,
      ss.name AS source_system_name,
      ss.family,
      ss.trust_tier,
      sfs.publication_mode,
      sfs.emergency_pause,
      sfs.checkpoint_cursor,
      sfs.replay_from_cursor,
      sfs.last_attempt_status,
      sfs.last_attempt_started_at,
      sfs.last_attempt_completed_at,
      sfs.last_attempt_summary,
      sfs.auto_publish_approved_at,
      sfs.auto_publish_approved_by,
      sfs.included_data_owners,
      sfs.excluded_data_owners,
      sfs.max_organizations_per_poll,
      sfs.notes
    FROM source_feeds sf
    JOIN source_systems ss ON ss.id = sf.source_system_id
    LEFT JOIN source_feed_states sfs ON sfs.source_feed_id = sf.id
    WHERE sf.feed_handler IN ('hsds_api', 'ndp_211')
      AND ($1::uuid IS NULL OR sf.id = $1::uuid)
      AND ($2::boolean OR sf.is_active)
    ORDER BY ss.name, sf.feed_name`,
    [args.feedId || null, args.includeInactive],
  );

  return result.rows;
}

async function queryFeedWindowSummary(pool, feedId, hours) {
  const values = [feedId, hours];

  const sourceTotals = await pool.query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE processing_status = 'normalized')::int AS normalized,
      COUNT(*) FILTER (WHERE processing_error IS NOT NULL)::int AS errored,
      MAX(fetched_at) AS latest_fetch_at
    FROM source_records
    WHERE source_feed_id = $1
      AND fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')`,
    values,
  );

  const sourceByType = await pool.query(
    `SELECT source_record_type AS key, COUNT(*)::int AS count
     FROM source_records
     WHERE source_feed_id = $1
       AND fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')
     GROUP BY source_record_type
     ORDER BY source_record_type`,
    values,
  );

  const canonicalByType = await pool.query(
    `SELECT cp.canonical_entity_type AS key, COUNT(DISTINCT cp.canonical_entity_id)::int AS count
     FROM canonical_provenance cp
     JOIN source_records sr ON sr.id = cp.source_record_id
     WHERE sr.source_feed_id = $1
       AND sr.fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')
     GROUP BY cp.canonical_entity_type
     ORDER BY cp.canonical_entity_type`,
    values,
  );

  const publicationByType = await pool.query(
    `SELECT entity_type AS key, publication_status, COUNT(*)::int AS count
     FROM (
       SELECT 'canonical_organization'::text AS entity_type, publication_status
       FROM canonical_organizations
       WHERE winning_source_system_id = (SELECT source_system_id FROM source_feeds WHERE id = $1)
       UNION ALL
       SELECT 'canonical_service'::text AS entity_type, publication_status
       FROM canonical_services
       WHERE winning_source_system_id = (SELECT source_system_id FROM source_feeds WHERE id = $1)
       UNION ALL
       SELECT 'canonical_location'::text AS entity_type, publication_status
       FROM canonical_locations
       WHERE winning_source_system_id = (SELECT source_system_id FROM source_feeds WHERE id = $1)
     ) statuses
     GROUP BY entity_type, publication_status
     ORDER BY entity_type, publication_status`,
    [feedId],
  );

  const recentErrors = await pool.query(
    `SELECT source_record_type, source_record_id, processing_error, fetched_at
     FROM source_records
     WHERE source_feed_id = $1
       AND processing_error IS NOT NULL
       AND fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')
     ORDER BY fetched_at DESC
     LIMIT 5`,
    values,
  );

  return {
    sourceRecords: sourceTotals.rows[0] ?? { total: 0, normalized: 0, errored: 0, latest_fetch_at: null },
    sourceByType: sourceByType.rows,
    canonicalByType: canonicalByType.rows,
    publicationByType: publicationByType.rows,
    recentErrors: recentErrors.rows,
  };
}

function buildFeedReport(feed, windowSummary, now = new Date()) {
  const health = classifyFeedHealth(
    {
      emergencyPause: feed.emergency_pause,
      isActive: feed.is_active,
      lastAttemptStatus: feed.last_attempt_status,
      lastAttemptCompletedAt: feed.last_attempt_completed_at,
      refreshIntervalHours: feed.refresh_interval_hours,
      replayFromCursor: feed.replay_from_cursor,
    },
    now,
  );

  const lastAttemptSummary = feed.last_attempt_summary && typeof feed.last_attempt_summary === 'object'
    ? feed.last_attempt_summary
    : {};

  return {
    feedId: feed.id,
    feedName: feed.feed_name,
    sourceSystemName: feed.source_system_name,
    family: feed.family,
    trustTier: feed.trust_tier,
    feedHandler: feed.feed_handler,
    publicationMode: feed.publication_mode ?? 'review_required',
    baseUrl: feed.base_url,
    isActive: feed.is_active,
    emergencyPause: feed.emergency_pause ?? false,
    refreshIntervalHours: feed.refresh_interval_hours,
    health,
    lastAttemptStatus: feed.last_attempt_status,
    lastAttemptStartedAt: toIsoString(feed.last_attempt_started_at),
    lastAttemptCompletedAt: toIsoString(feed.last_attempt_completed_at),
    lastPolledAt: toIsoString(feed.last_polled_at),
    lastSuccessAt: toIsoString(feed.last_success_at),
    lastError: feed.last_error,
    errorCount: Number(feed.error_count ?? 0),
    replayFromCursor: feed.replay_from_cursor,
    checkpointCursor: feed.checkpoint_cursor,
    autoPublishApprovedAt: toIsoString(feed.auto_publish_approved_at),
    autoPublishApprovedBy: feed.auto_publish_approved_by,
    includedDataOwners: Array.isArray(feed.included_data_owners) ? feed.included_data_owners : [],
    excludedDataOwners: Array.isArray(feed.excluded_data_owners) ? feed.excluded_data_owners : [],
    maxOrganizationsPerPoll: feed.max_organizations_per_poll,
    notes: feed.notes ?? null,
    recentWindow: {
      sourceRecordTotal: Number(windowSummary.sourceRecords.total ?? 0),
      sourceRecordNormalized: Number(windowSummary.sourceRecords.normalized ?? 0),
      sourceRecordErrored: Number(windowSummary.sourceRecords.errored ?? 0),
      latestFetchAt: toIsoString(windowSummary.sourceRecords.latest_fetch_at),
      sourceRecordTypes: windowSummary.sourceByType,
      canonicalEntityTypes: windowSummary.canonicalByType,
      publicationStatuses: windowSummary.publicationByType,
      recentErrors: windowSummary.recentErrors.map((row) => ({
        sourceRecordType: row.source_record_type,
        sourceRecordId: row.source_record_id,
        processingError: row.processing_error,
        fetchedAt: toIsoString(row.fetched_at),
      })),
    },
    pollDecision: {
      publicationReason:
        typeof lastAttemptSummary.publicationReason === 'string'
          ? lastAttemptSummary.publicationReason
          : null,
      decisionReasons: summarizeDecisionReasons(lastAttemptSummary.decisionReasons),
    },
  };
}

function formatPlain(report) {
  const lines = [
    'ORAN 211 Feed Status Report',
    `Generated: ${report.generatedAt}`,
    `Window hours: ${report.hours}`,
    '',
  ];

  for (const feed of report.feeds) {
    lines.push(`${feed.sourceSystemName} :: ${feed.feedName}`);
    lines.push(`  Health: ${feed.health.status} (${feed.health.reason})`);
    lines.push(`  Handler: ${feed.feedHandler} | Publication: ${feed.publicationMode} | Active: ${feed.isActive} | Paused: ${feed.emergencyPause}`);
    lines.push(`  Last attempt: ${feed.lastAttemptStatus ?? 'none'} | Completed: ${feed.lastAttemptCompletedAt ?? 'never'} | Replay: ${feed.replayFromCursor ?? 'none'}`);
    lines.push(`  Source records (${report.hours}h): total=${feed.recentWindow.sourceRecordTotal}, normalized=${feed.recentWindow.sourceRecordNormalized}, errored=${feed.recentWindow.sourceRecordErrored}`);
    lines.push(`  Canonical entities (${report.hours}h): ${feed.recentWindow.canonicalEntityTypes.map((row) => `${row.key}=${row.count}`).join(', ') || 'none'}`);
    if (feed.pollDecision.publicationReason) {
      lines.push(`  Publication reason: ${feed.pollDecision.publicationReason}`);
    }
    if (feed.pollDecision.decisionReasons.length > 0) {
      lines.push(`  Decision reasons: ${feed.pollDecision.decisionReasons.map((row) => `${row.reason}=${row.count}`).join(', ')}`);
    }
    if (feed.recentWindow.recentErrors.length > 0) {
      lines.push(`  Recent errors: ${feed.recentWindow.recentErrors.map((row) => `${row.sourceRecordType}:${row.sourceRecordId}`).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function formatMarkdown(report) {
  const lines = [
    '# ORAN 211 Feed Status Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Window hours: ${report.hours}`,
    '',
  ];

  for (const feed of report.feeds) {
    lines.push(`## ${feed.sourceSystemName} / ${feed.feedName}`);
    lines.push('');
    lines.push(`- Health: ${feed.health.status} (${feed.health.reason})`);
    lines.push(`- Handler: ${feed.feedHandler}`);
    lines.push(`- Publication mode: ${feed.publicationMode}`);
    lines.push(`- Active: ${feed.isActive}`);
    lines.push(`- Emergency pause: ${feed.emergencyPause}`);
    lines.push(`- Last attempt status: ${feed.lastAttemptStatus ?? 'none'}`);
    lines.push(`- Last attempt completed: ${feed.lastAttemptCompletedAt ?? 'never'}`);
    lines.push(`- Replay from cursor: ${feed.replayFromCursor ?? 'none'}`);
    lines.push(`- Source records in window: ${feed.recentWindow.sourceRecordTotal}`);
    lines.push(`- Normalized in window: ${feed.recentWindow.sourceRecordNormalized}`);
    lines.push(`- Errors in window: ${feed.recentWindow.sourceRecordErrored}`);
    if (feed.pollDecision.publicationReason) {
      lines.push(`- Poll publication reason: ${feed.pollDecision.publicationReason}`);
    }
    if (feed.pollDecision.decisionReasons.length > 0) {
      lines.push(`- Decision reasons: ${feed.pollDecision.decisionReasons.map((row) => `${row.reason}=${row.count}`).join(', ')}`);
    }
    lines.push('');
    lines.push('| Canonical entity type | Count |');
    lines.push('| --- | ---: |');
    if (feed.recentWindow.canonicalEntityTypes.length === 0) {
      lines.push('| none | 0 |');
    } else {
      for (const row of feed.recentWindow.canonicalEntityTypes) {
        lines.push(`| ${row.key} | ${row.count} |`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function formatReport(report, format) {
  if (format === 'json') {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (format === 'markdown') {
    return `${formatMarkdown(report)}\n`;
  }

  return `${formatPlain(report)}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    printUsageAndExit();
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const feeds = await queryFeeds(pool, args);
    if (feeds.length === 0) {
      throw new Error(args.feedId ? `No 211 feed found for id ${args.feedId}` : 'No 211-compatible feeds found');
    }

    const reportFeeds = [];
    for (const feed of feeds) {
      const windowSummary = await queryFeedWindowSummary(pool, feed.id, args.hours);
      reportFeeds.push(buildFeedReport(feed, windowSummary));
    }

    const report = {
      generatedAt: new Date().toISOString(),
      hours: args.hours,
      feedCount: reportFeeds.length,
      feeds: reportFeeds,
    };

    const output = formatReport(report, args.format);
    if (args.out) {
      writeFileSync(args.out, output, 'utf8');
      console.log(`Wrote 211 feed status report to ${args.out}`);
      return;
    }

    process.stdout.write(output);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
