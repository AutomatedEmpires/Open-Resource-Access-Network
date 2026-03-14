import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { Pool } from 'pg';

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function normalizeComparable(value) {
  return String(value ?? '').trim().toLowerCase();
}

function diffSets(leftValues, rightValues) {
  const rightIndex = new Map(rightValues.map((value) => [normalizeComparable(value), value]));
  const matched = [];
  const missing = [];

  for (const value of leftValues) {
    const key = normalizeComparable(value);
    if (rightIndex.has(key)) {
      matched.push(value);
      rightIndex.delete(key);
      continue;
    }
    missing.push(value);
  }

  return {
    matched,
    missing,
    extra: Array.from(rightIndex.values()),
  };
}

export function parseArgs(argv) {
  const parsed = {
    feedId: '',
    hours: 24,
    sampleSize: 5,
    format: 'plain',
    out: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--feed-id') {
      parsed.feedId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--hours') {
      parsed.hours = toInt(argv[index + 1], 24);
      index += 1;
      continue;
    }
    if (arg === '--sample-size') {
      parsed.sampleSize = toInt(argv[index + 1], 5);
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
    }
  }

  return parsed;
}

export function extractSourceSnapshot(sourceRecord) {
  const payload = sourceRecord.parsedPayload ?? sourceRecord.rawPayload ?? {};

  if (sourceRecord.sourceRecordType === 'organization_bundle') {
    const serviceNames = dedupeStrings(ensureArray(payload.services).map((service) => service?.name));
    const cities = dedupeStrings(
      ensureArray(payload.locations).flatMap((location) => {
        const addressCities = ensureArray(location?.addresses).map((address) => address?.city);
        return [location?.city, location?.address_city, ...addressCities];
      }),
    );

    return {
      organizationName: stringOrNull(payload.name),
      serviceNames,
      cities,
    };
  }

  if (sourceRecord.sourceRecordType === 'service') {
    return {
      organizationName: stringOrNull(payload.organization_name),
      serviceNames: dedupeStrings([payload.name]),
      cities: [],
    };
  }

  if (sourceRecord.sourceRecordType === 'location') {
    return {
      organizationName: stringOrNull(payload.organization_name),
      serviceNames: [],
      cities: dedupeStrings([payload.city, payload.address_city, payload.addressRegion, payload.region]),
    };
  }

  return {
    organizationName: stringOrNull(payload.name ?? payload.organization_name),
    serviceNames: dedupeStrings(ensureArray(payload.services).map((service) => service?.name)),
    cities: dedupeStrings([payload.city, payload.address_city, payload.region]),
  };
}

export function buildSampleReconciliation(sourceRecord, canonicalSnapshot) {
  const sourceSnapshot = extractSourceSnapshot(sourceRecord);
  const organizationNames = dedupeStrings(canonicalSnapshot.organizations.map((org) => org.name));
  const serviceNames = dedupeStrings(canonicalSnapshot.services.map((service) => service.name));
  const cities = dedupeStrings(canonicalSnapshot.locations.map((location) => location.addressCity));

  return {
    source: sourceSnapshot,
    canonical: {
      organizationNames,
      serviceNames,
      cities,
      servicePublicationStatuses: canonicalSnapshot.services.map((service) => ({
        id: service.id,
        name: service.name,
        publicationStatus: service.publicationStatus,
      })),
    },
    verdict: {
      organizationNameMatched:
        sourceSnapshot.organizationName === null
          ? null
          : organizationNames.some((value) => normalizeComparable(value) === normalizeComparable(sourceSnapshot.organizationName)),
      services: diffSets(sourceSnapshot.serviceNames, serviceNames),
      cities: diffSets(sourceSnapshot.cities, cities),
      provenanceFieldCount: canonicalSnapshot.provenanceFieldCount,
      acceptedFieldCount: canonicalSnapshot.acceptedFieldCount,
    },
  };
}

function printUsageAndExit() {
  console.error([
    'Usage:',
    '  node scripts/run-211-canary-report.mjs --feed-id <uuid> [--hours 24] [--sample-size 5] [--format plain|json|markdown] [--out path]',
    '',
    'Required env:',
    '  DATABASE_URL',
  ].join('\n'));
  process.exit(1);
}

async function queryCountMap(pool, query, values) {
  const result = await pool.query(query, values);
  return Object.fromEntries(result.rows.map((row) => [row.key, Number(row.count)]));
}

async function queryFeedMetadata(pool, feedId) {
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
      ss.id AS source_system_id,
      ss.name AS source_system_name,
      ss.trust_tier,
      sfs.publication_mode,
      sfs.emergency_pause,
      sfs.included_data_owners,
      sfs.excluded_data_owners,
      sfs.max_organizations_per_poll,
      sfs.checkpoint_cursor,
      sfs.replay_from_cursor,
      sfs.last_attempt_status,
      sfs.last_attempt_completed_at,
      sfs.last_attempt_summary,
      sfs.notes
    FROM source_feeds sf
    JOIN source_systems ss ON ss.id = sf.source_system_id
    LEFT JOIN source_feed_states sfs ON sfs.source_feed_id = sf.id
    WHERE sf.id = $1
    LIMIT 1`,
    [feedId],
  );

  return result.rows[0] ?? null;
}

async function queryCanarySummary(pool, feedId, hours) {
  const windowValues = [feedId, hours];
  const totalsResult = await pool.query(
    `SELECT
      COUNT(*)::int AS total,
      MIN(fetched_at) AS window_start,
      MAX(fetched_at) AS window_end,
      COUNT(*) FILTER (WHERE processing_error IS NOT NULL)::int AS error_count
    FROM source_records
    WHERE source_feed_id = $1
      AND fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')`,
    windowValues,
  );

  const statusCounts = await queryCountMap(
    pool,
    `SELECT processing_status AS key, COUNT(*)::int AS count
     FROM source_records
     WHERE source_feed_id = $1
       AND fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')
     GROUP BY processing_status`,
    windowValues,
  );

  const typeCounts = await queryCountMap(
    pool,
    `SELECT source_record_type AS key, COUNT(*)::int AS count
     FROM source_records
     WHERE source_feed_id = $1
       AND fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')
     GROUP BY source_record_type`,
    windowValues,
  );

  const canonicalEntityCounts = await queryCountMap(
    pool,
    `SELECT cp.canonical_entity_type AS key, COUNT(DISTINCT cp.canonical_entity_id)::int AS count
     FROM canonical_provenance cp
     JOIN source_records sr ON sr.id = cp.source_record_id
     WHERE sr.source_feed_id = $1
       AND sr.fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')
     GROUP BY cp.canonical_entity_type`,
    windowValues,
  );

  const publicationCounts = await queryCountMap(
    pool,
    `WITH recent_services AS (
       SELECT DISTINCT cp.canonical_entity_id
       FROM canonical_provenance cp
       JOIN source_records sr ON sr.id = cp.source_record_id
       WHERE cp.canonical_entity_type = 'service'
         AND sr.source_feed_id = $1
         AND sr.fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')
     )
     SELECT cs.publication_status AS key, COUNT(*)::int AS count
     FROM canonical_services cs
     JOIN recent_services rs ON rs.canonical_entity_id = cs.id
     GROUP BY cs.publication_status`,
    windowValues,
  );

  const normalizedResult = await pool.query(
    `SELECT COUNT(DISTINCT cp.source_record_id)::int AS normalized_count
     FROM canonical_provenance cp
     JOIN source_records sr ON sr.id = cp.source_record_id
     WHERE sr.source_feed_id = $1
       AND sr.fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')`,
    windowValues,
  );

  const topErrorsResult = await pool.query(
    `SELECT processing_error, COUNT(*)::int AS count
     FROM source_records
     WHERE source_feed_id = $1
       AND fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')
       AND processing_error IS NOT NULL
     GROUP BY processing_error
     ORDER BY count DESC, processing_error ASC
     LIMIT 5`,
    windowValues,
  );

  const totals = totalsResult.rows[0] ?? {
    total: 0,
    window_start: null,
    window_end: null,
    error_count: 0,
  };
  const total = Number(totals.total ?? 0);
  const normalizedCount = Number(normalizedResult.rows[0]?.normalized_count ?? 0);

  return {
    totalSourceRecords: total,
    windowStart: totals.window_start,
    windowEnd: totals.window_end,
    statusCounts,
    typeCounts,
    canonicalEntityCounts,
    publicationCounts,
    topErrors: topErrorsResult.rows.map((row) => ({
      error: row.processing_error,
      count: Number(row.count),
    })),
    normalizedSourceRecords: normalizedCount,
    normalizationCoveragePercent: total === 0 ? 0 : Number(((normalizedCount / total) * 100).toFixed(1)),
  };
}

async function queryCanonicalSnapshotForRecord(pool, sourceRecordId) {
  const provenanceResult = await pool.query(
    `SELECT canonical_entity_type, canonical_entity_id, field_name, decision_status
     FROM canonical_provenance
     WHERE source_record_id = $1
     ORDER BY created_at DESC`,
    [sourceRecordId],
  );

  const organizationIds = dedupeStrings(
    provenanceResult.rows
      .filter((row) => row.canonical_entity_type === 'organization')
      .map((row) => row.canonical_entity_id),
  );
  const serviceIds = dedupeStrings(
    provenanceResult.rows
      .filter((row) => row.canonical_entity_type === 'service')
      .map((row) => row.canonical_entity_id),
  );
  const locationIds = dedupeStrings(
    provenanceResult.rows
      .filter((row) => row.canonical_entity_type === 'location')
      .map((row) => row.canonical_entity_id),
  );

  const [organizations, services, locations] = await Promise.all([
    organizationIds.length > 0
      ? pool.query(
        `SELECT id, name, publication_status AS "publicationStatus"
         FROM canonical_organizations
         WHERE id = ANY($1::uuid[])`,
        [organizationIds],
      )
      : Promise.resolve({ rows: [] }),
    serviceIds.length > 0
      ? pool.query(
        `SELECT id, name, publication_status AS "publicationStatus"
         FROM canonical_services
         WHERE id = ANY($1::uuid[])`,
        [serviceIds],
      )
      : Promise.resolve({ rows: [] }),
    locationIds.length > 0
      ? pool.query(
        `SELECT id, address_city AS "addressCity", publication_status AS "publicationStatus"
         FROM canonical_locations
         WHERE id = ANY($1::uuid[])`,
        [locationIds],
      )
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    organizations: organizations.rows,
    services: services.rows,
    locations: locations.rows,
    provenanceFieldCount: provenanceResult.rows.length,
    acceptedFieldCount: provenanceResult.rows.filter((row) => row.decision_status === 'accepted').length,
  };
}

async function querySampleReconciliations(pool, feedId, hours, sampleSize) {
  const sourceRecordsResult = await pool.query(
    `SELECT id, source_record_type AS "sourceRecordType", source_record_id AS "sourceRecordId",
            fetched_at AS "fetchedAt", processing_status AS "processingStatus",
            processing_error AS "processingError", correlation_id AS "correlationId",
            parsed_payload AS "parsedPayload", raw_payload AS "rawPayload"
     FROM source_records
     WHERE source_feed_id = $1
       AND fetched_at >= NOW() - ($2::int * INTERVAL '1 hour')
     ORDER BY fetched_at DESC
     LIMIT $3`,
    [feedId, hours, sampleSize],
  );

  const samples = [];
  for (const sourceRecord of sourceRecordsResult.rows) {
    const canonicalSnapshot = await queryCanonicalSnapshotForRecord(pool, sourceRecord.id);
    samples.push({
      sourceRecordId: sourceRecord.id,
      externalSourceRecordId: sourceRecord.sourceRecordId,
      sourceRecordType: sourceRecord.sourceRecordType,
      fetchedAt: sourceRecord.fetchedAt,
      processingStatus: sourceRecord.processingStatus,
      processingError: sourceRecord.processingError,
      correlationId: sourceRecord.correlationId,
      ...buildSampleReconciliation(sourceRecord, canonicalSnapshot),
    });
  }

  return samples;
}

export async function generateCanaryReport(options) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const feed = await queryFeedMetadata(pool, options.feedId);
    if (!feed) {
      throw new Error(`Source feed ${options.feedId} not found`);
    }

    const [summary, samples] = await Promise.all([
      queryCanarySummary(pool, options.feedId, options.hours),
      querySampleReconciliations(pool, options.feedId, options.hours, options.sampleSize),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      input: {
        feedId: options.feedId,
        hours: options.hours,
        sampleSize: options.sampleSize,
      },
      feed: {
        id: feed.id,
        feedName: feed.feed_name,
        feedType: feed.feed_type,
        feedHandler: feed.feed_handler,
        baseUrl: feed.base_url,
        refreshIntervalHours: feed.refresh_interval_hours,
        isActive: feed.is_active,
        lastPolledAt: feed.last_polled_at,
        sourceSystemId: feed.source_system_id,
        sourceSystemName: feed.source_system_name,
        trustTier: feed.trust_tier,
      },
      state: {
        publicationMode: feed.publication_mode,
        emergencyPause: feed.emergency_pause,
        includedDataOwners: feed.included_data_owners ?? [],
        excludedDataOwners: feed.excluded_data_owners ?? [],
        maxOrganizationsPerPoll: feed.max_organizations_per_poll,
        checkpointCursor: feed.checkpoint_cursor,
        replayFromCursor: feed.replay_from_cursor,
        lastAttemptStatus: feed.last_attempt_status,
        lastAttemptCompletedAt: feed.last_attempt_completed_at,
        lastAttemptSummary: feed.last_attempt_summary ?? {},
        notes: feed.notes,
      },
      summary,
      samples,
    };
  } finally {
    await pool.end();
  }
}

export function formatPlain(report) {
  const lines = [];
  lines.push(`211 canary report for ${report.feed.feedName} (${report.feed.id})`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Window: last ${report.input.hours}h`);
  lines.push(`Source system: ${report.feed.sourceSystemName} (${report.feed.trustTier})`);
  lines.push(`Publication mode: ${report.state.publicationMode} | Emergency pause: ${String(report.state.emergencyPause)}`);
  lines.push(`Source records: ${report.summary.totalSourceRecords} | Normalized: ${report.summary.normalizedSourceRecords} (${report.summary.normalizationCoveragePercent}%)`);
  lines.push(`Status counts: ${JSON.stringify(report.summary.statusCounts)}`);
  lines.push(`Record types: ${JSON.stringify(report.summary.typeCounts)}`);
  lines.push(`Canonical entities: ${JSON.stringify(report.summary.canonicalEntityCounts)}`);
  lines.push(`Service publication: ${JSON.stringify(report.summary.publicationCounts)}`);
  if (report.summary.topErrors.length > 0) {
    lines.push(`Top errors: ${report.summary.topErrors.map((error) => `${error.count}x ${error.error}`).join(' | ')}`);
  }
  lines.push('Samples:');
  for (const sample of report.samples) {
    lines.push(`- ${sample.sourceRecordType} ${sample.externalSourceRecordId} [${sample.processingStatus}]`);
    lines.push(`  org match: ${String(sample.verdict.organizationNameMatched)} | service matches: ${sample.verdict.services.matched.length}/${sample.source.serviceNames.length} | city matches: ${sample.verdict.cities.matched.length}/${sample.source.cities.length}`);
  }
  return lines.join('\n');
}

export function formatMarkdown(report) {
  const lines = [];
  lines.push(`# 211 Canary Report`);
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Feed: ${report.feed.feedName} (${report.feed.id})`);
  lines.push(`- Source system: ${report.feed.sourceSystemName} (${report.feed.trustTier})`);
  lines.push(`- Window: last ${report.input.hours}h`);
  lines.push(`- Publication mode: ${report.state.publicationMode ?? 'unset'}`);
  lines.push(`- Emergency pause: ${String(report.state.emergencyPause ?? false)}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Source records observed: ${report.summary.totalSourceRecords}`);
  lines.push(`- Normalized source records: ${report.summary.normalizedSourceRecords} (${report.summary.normalizationCoveragePercent}%)`);
  lines.push(`- Status counts: ${JSON.stringify(report.summary.statusCounts)}`);
  lines.push(`- Record types: ${JSON.stringify(report.summary.typeCounts)}`);
  lines.push(`- Canonical entities: ${JSON.stringify(report.summary.canonicalEntityCounts)}`);
  lines.push(`- Service publication counts: ${JSON.stringify(report.summary.publicationCounts)}`);
  if (report.summary.topErrors.length > 0) {
    lines.push(`- Top errors: ${report.summary.topErrors.map((error) => `${error.count}x ${error.error}`).join('; ')}`);
  }
  lines.push('');
  lines.push('## Sample Reconciliation');
  lines.push('');
  for (const sample of report.samples) {
    lines.push(`### ${sample.sourceRecordType} ${sample.externalSourceRecordId}`);
    lines.push('');
    lines.push(`- Processing status: ${sample.processingStatus}`);
    if (sample.processingError) {
      lines.push(`- Processing error: ${sample.processingError}`);
    }
    lines.push(`- Source organization: ${sample.source.organizationName ?? 'n/a'}`);
    lines.push(`- Canonical organizations: ${sample.canonical.organizationNames.join(', ') || 'n/a'}`);
    lines.push(`- Organization name matched: ${String(sample.verdict.organizationNameMatched)}`);
    lines.push(`- Source services: ${sample.source.serviceNames.join(', ') || 'n/a'}`);
    lines.push(`- Canonical services: ${sample.canonical.serviceNames.join(', ') || 'n/a'}`);
    lines.push(`- Matched services: ${sample.verdict.services.matched.join(', ') || 'none'}`);
    lines.push(`- Missing source services: ${sample.verdict.services.missing.join(', ') || 'none'}`);
    lines.push(`- Extra canonical services: ${sample.verdict.services.extra.join(', ') || 'none'}`);
    lines.push(`- Source cities: ${sample.source.cities.join(', ') || 'n/a'}`);
    lines.push(`- Canonical cities: ${sample.canonical.cities.join(', ') || 'n/a'}`);
    lines.push(`- Matched cities: ${sample.verdict.cities.matched.join(', ') || 'none'}`);
    lines.push(`- Provenance fields: ${sample.verdict.provenanceFieldCount}`);
    lines.push(`- Accepted fields: ${sample.verdict.acceptedFieldCount}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function formatReport(report, format) {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }
  if (format === 'markdown') {
    return formatMarkdown(report);
  }
  return formatPlain(report);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (!process.env.DATABASE_URL || !options.feedId) {
    printUsageAndExit();
  }

  const report = await generateCanaryReport(options);
  const output = formatReport(report, options.format);

  if (options.out) {
    writeFileSync(options.out, output);
    console.log(`Wrote 211 canary report to ${options.out}`);
    return;
  }

  console.log(output);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
