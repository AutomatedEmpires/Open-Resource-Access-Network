import { Pool } from 'pg';

function parseArgs(argv) {
  const parsed = {
    name: '',
    family: 'partner_api',
    trustTier: 'trusted_partner',
    homepageUrl: '',
    termsUrl: '',
    licenseNotes: '',
    hsdsProfileUri: '',
    notes: '',
    isActive: 'true',
    jurisdictionKind: 'national',
    country: 'US',
    stateProvince: '',
    feedName: '',
    feedType: 'api',
    feedHandler: 'ndp_211',
    baseUrl: '',
    healthcheckUrl: '',
    authType: 'api_key',
    feedProfileUri: '',
    feedIsActive: 'true',
    refreshIntervalHours: '24',
    publicationMode: 'review_required',
    emergencyPause: 'false',
    includedDataOwners: '',
    excludedDataOwners: '',
    maxOrganizationsPerPoll: '',
    stateNotes: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (!(key in parsed)) continue;
    parsed[key] = argv[index + 1] ?? '';
    index += 1;
  }

  return parsed;
}

function usageAndExit() {
  console.error([
    'Usage:',
    '  node scripts/bootstrap-source-feed.mjs --name <source-system-name> --feed-name <feed-name> --base-url <url> [options]',
    '',
    'Required env:',
    '  DATABASE_URL',
  ].join('\n'));
  process.exit(1);
}

function toBool(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function toStringArray(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL || !options.name || !options.feedName || !options.baseUrl) {
  usageAndExit();
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const jurisdictionScope = {
  kind: options.jurisdictionKind || undefined,
  country: options.country || undefined,
  stateProvince: options.stateProvince || undefined,
};

try {
  const systemResult = await pool.query(
    `INSERT INTO source_systems
      (name, family, homepage_url, license_notes, terms_url, trust_tier, hsds_profile_uri, domain_rules, crawl_policy, jurisdiction_scope, contact_info, is_active, notes)
     VALUES
      ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), $6, NULLIF($7, ''), '[]'::jsonb, '{}'::jsonb, $8::jsonb, '{}'::jsonb, $9, NULLIF($10, ''))
     ON CONFLICT (name)
     DO UPDATE SET
      family = EXCLUDED.family,
      homepage_url = EXCLUDED.homepage_url,
      license_notes = EXCLUDED.license_notes,
      terms_url = EXCLUDED.terms_url,
      trust_tier = EXCLUDED.trust_tier,
      hsds_profile_uri = EXCLUDED.hsds_profile_uri,
      jurisdiction_scope = EXCLUDED.jurisdiction_scope,
      is_active = EXCLUDED.is_active,
      notes = EXCLUDED.notes,
      updated_at = NOW()
     RETURNING id`,
    [
      options.name,
      options.family,
      options.homepageUrl,
      options.licenseNotes,
      options.termsUrl,
      options.trustTier,
      options.hsdsProfileUri,
      JSON.stringify(jurisdictionScope),
      toBool(options.isActive),
      options.notes,
    ],
  );

  const sourceSystemId = systemResult.rows[0]?.id;
  if (!sourceSystemId) {
    throw new Error('Failed to resolve source system id');
  }

  const existingFeedResult = await pool.query(
    `SELECT id FROM source_feeds WHERE source_system_id = $1 AND feed_name = $2 LIMIT 1`,
    [sourceSystemId, options.feedName],
  );

  if (existingFeedResult.rowCount && existingFeedResult.rows[0]?.id) {
    const feedId = existingFeedResult.rows[0].id;
    await pool.query(
      `UPDATE source_feeds
       SET feed_type = $3,
           feed_handler = $4,
           base_url = $5,
           healthcheck_url = NULLIF($6, ''),
           auth_type = NULLIF($7, ''),
           profile_uri = NULLIF($8, ''),
           jurisdiction_scope = $9::jsonb,
           refresh_interval_hours = $10,
           is_active = $11,
           updated_at = NOW()
       WHERE id = $1`,
      [
        feedId,
        options.feedType,
        options.feedHandler,
        options.baseUrl,
        options.healthcheckUrl,
        options.authType,
        options.feedProfileUri,
        JSON.stringify(jurisdictionScope),
        Number.parseInt(options.refreshIntervalHours, 10),
        toBool(options.feedIsActive),
      ],
    );
    await pool.query(
      `INSERT INTO source_feed_states
        (source_feed_id, publication_mode, emergency_pause, included_data_owners, excluded_data_owners, max_organizations_per_poll, notes)
       VALUES
        ($1, $2, $3, $4::jsonb, $5::jsonb, $6, NULLIF($7, ''))
       ON CONFLICT (source_feed_id)
       DO UPDATE SET
        publication_mode = EXCLUDED.publication_mode,
        emergency_pause = EXCLUDED.emergency_pause,
        included_data_owners = EXCLUDED.included_data_owners,
        excluded_data_owners = EXCLUDED.excluded_data_owners,
        max_organizations_per_poll = EXCLUDED.max_organizations_per_poll,
        notes = EXCLUDED.notes,
        updated_at = NOW()`,
      [
        feedId,
        options.publicationMode,
        toBool(options.emergencyPause),
        JSON.stringify(toStringArray(options.includedDataOwners)),
        JSON.stringify(toStringArray(options.excludedDataOwners)),
        options.maxOrganizationsPerPoll ? Number.parseInt(options.maxOrganizationsPerPoll, 10) : null,
        options.stateNotes,
      ],
    );
    console.log(`Updated source system "${options.name}" and feed "${options.feedName}".`);
  } else {
    const insertResult = await pool.query(
      `INSERT INTO source_feeds
        (source_system_id, feed_name, feed_type, feed_handler, base_url, healthcheck_url, auth_type, profile_uri, jurisdiction_scope, refresh_interval_hours, is_active)
       VALUES
        ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), $9::jsonb, $10, $11)
       RETURNING id`,
      [
        sourceSystemId,
        options.feedName,
        options.feedType,
        options.feedHandler,
        options.baseUrl,
        options.healthcheckUrl,
        options.authType,
        options.feedProfileUri,
        JSON.stringify(jurisdictionScope),
        Number.parseInt(options.refreshIntervalHours, 10),
        toBool(options.feedIsActive),
      ],
    );
    const feedId = insertResult.rows[0]?.id;
    if (!feedId) {
      throw new Error('Failed to resolve source feed id');
    }
    await pool.query(
      `INSERT INTO source_feed_states
        (source_feed_id, publication_mode, emergency_pause, included_data_owners, excluded_data_owners, max_organizations_per_poll, notes)
       VALUES
        ($1, $2, $3, $4::jsonb, $5::jsonb, $6, NULLIF($7, ''))`,
      [
        feedId,
        options.publicationMode,
        toBool(options.emergencyPause),
        JSON.stringify(toStringArray(options.includedDataOwners)),
        JSON.stringify(toStringArray(options.excludedDataOwners)),
        options.maxOrganizationsPerPoll ? Number.parseInt(options.maxOrganizationsPerPoll, 10) : null,
        options.stateNotes,
      ],
    );
    console.log(`Created source system "${options.name}" and feed "${options.feedName}".`);
  }
} finally {
  await pool.end();
}
