import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const BCRYPT_ROUNDS = 12;
const BOOTSTRAP_ACTOR = 'bootstrap:provision-owner-access';
const ORAN_ADMIN_CAPACITY = { maxPending: 50, maxInReview: 20 };

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizePhone(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    return null;
  }

  return hasLeadingPlus ? `+${digits}` : digits;
}

function deriveUsername(email, fallback) {
  const explicit = String(fallback ?? '').trim().toLowerCase();
  if (explicit) {
    return explicit;
  }

  const localPart = normalizeEmail(email).split('@')[0] ?? '';
  const collapsed = localPart.replace(/[^a-z0-9._-]/g, '.').replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '');
  return collapsed || `owner.${Math.random().toString(36).slice(2, 8)}`;
}

function domainToUrl(domainOrUrl) {
  const trimmed = String(domainOrUrl ?? '').trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function parseArgs(argv) {
  const parsed = {
    primaryEmail: '',
    primaryUserId: '',
    primaryDisplayName: '',
    primaryUsername: '',
    primaryPhone: '',
    primaryPassword: '',
    backupEmail: '',
    backupUserId: '',
    backupDisplayName: '',
    backupUsername: '',
    backupPassword: '',
    orgName: '',
    orgUrl: '',
    orgEmail: '',
    orgPhone: '',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      continue;
    }
    const rawKey = arg.slice(2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!(key in parsed)) {
      continue;
    }
    parsed[key] = argv[index + 1] ?? '';
    index += 1;
  }

  return parsed;
}

function usage(exitCode = 1) {
  const lines = [
    'Usage:',
    '  node scripts/provision-owner-access.mjs \\',
    '    --primary-email <email> [--primary-user-id <entra-object-id>] [--primary-password <password>] [--primary-phone <phone>] \\',
    '    [--backup-email <email> --backup-user-id <entra-object-id> --backup-password <password>] \\',
    '    --org-name <name> [--org-url <domain-or-url>] [--org-email <email>] [--org-phone <phone>]',
    '',
    'Behavior:',
    '  - Upgrades matching user_profiles rows to oran_admin and active account status.',
    '  - Can pre-provision Entra-backed users by explicit user/object ID before first sign-in.',
    '  - Creates credentials-backed accounts when a matching email does not yet exist and a password is supplied.',
    '  - Creates or updates an organization and grants host_admin membership to provisioned users.',
    '  - Provisions admin_review_profiles with oran_admin capacity defaults.',
    '',
    'Important:',
    '  - DATABASE_URL is required.',
    '  - Phone is stored as a credentials sign-in identifier only. ORAN does not implement SMS/OTP 2SV in-app.',
  ];
  const output = lines.join('\n');
  if (exitCode === 0) {
    console.log(output);
  } else {
    console.error(output);
  }
  process.exit(exitCode);
}

async function ensureOrganization(client, options) {
  const normalizedUrl = domainToUrl(options.orgUrl || (options.primaryEmail ? normalizeEmail(options.primaryEmail).split('@')[1] : ''));
  const normalizedName = String(options.orgName ?? '').trim();
  const normalizedEmail = normalizeEmail(options.orgEmail || options.primaryEmail);
  const normalizedPhone = normalizePhone(options.orgPhone || options.primaryPhone);

  const existing = await client.query(
    `SELECT id
     FROM organizations
     WHERE LOWER(COALESCE(url, '')) = LOWER(COALESCE($1, ''))
        OR LOWER(name) = LOWER($2)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [normalizedUrl, normalizedName],
  );

  if (existing.rows[0]?.id) {
    await client.query(
      `UPDATE organizations
       SET name = $2,
           url = COALESCE($3, url),
           email = COALESCE($4, email),
           phone = COALESCE($5, phone),
           status = 'active',
           updated_at = NOW(),
           updated_by_user_id = $6
       WHERE id = $1`,
      [
        existing.rows[0].id,
        normalizedName,
        normalizedUrl,
        normalizedEmail || null,
        normalizedPhone,
        BOOTSTRAP_ACTOR,
      ],
    );
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO organizations
       (name, url, email, phone, status, created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3, $4, 'active', $5, $5)
     RETURNING id`,
    [normalizedName, normalizedUrl, normalizedEmail || null, normalizedPhone, BOOTSTRAP_ACTOR],
  );
  return inserted.rows[0]?.id ?? null;
}

async function ensureUniquePhone(client, normalizedPhone, exemptUserId) {
  if (!normalizedPhone) {
    return;
  }

  const existing = await client.query(
    `SELECT user_id
     FROM user_profiles
     WHERE regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = $1
       AND ($2::text IS NULL OR user_id <> $2)
     LIMIT 1`,
    [normalizedPhone, exemptUserId ?? null],
  );

  if (existing.rows.length > 0) {
    throw new Error(`Phone number ${normalizedPhone} is already assigned to another account`);
  }
}

async function getUserProfileColumns(client) {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'user_profiles'`,
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function hasColumn(columns, columnName) {
  return columns.has(columnName);
}

async function ensureUser(client, account, profileColumns) {
  const email = normalizeEmail(account.email);
  if (!email) {
    return { status: 'skipped', email, reason: 'missing email' };
  }

  const displayName = String(account.displayName ?? '').trim() || email;
  const username = deriveUsername(email, account.username);
  const normalizedPhone = normalizePhone(account.phone);
  const explicitUserId = String(account.userId ?? '').trim();

  const existing = explicitUserId
    ? await client.query(
        `SELECT user_id, auth_provider, email
         FROM user_profiles
         WHERE user_id = $1 OR LOWER(COALESCE(email, '')) = $2
         ORDER BY CASE WHEN user_id = $1 THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`,
        [explicitUserId, email],
      )
    : await client.query(
        `SELECT user_id, auth_provider, email
         FROM user_profiles
         WHERE LOWER(COALESCE(email, '')) = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
        [email],
      );

  if (existing.rows[0]?.user_id) {
    const userId = existing.rows[0].user_id;
    await ensureUniquePhone(client, normalizedPhone, userId);
    const assignments = [
      `display_name = COALESCE($2, display_name)`,
      `username = COALESCE(username, $3)`,
      `email = $4`,
      `phone = COALESCE($5, phone)`,
      `role = 'oran_admin'`,
      `updated_at = NOW()`,
      `updated_by_user_id = $6`,
    ];
    if (hasColumn(profileColumns, 'account_status')) {
      assignments.splice(5, 0, `account_status = 'active'`);
    }
    if (hasColumn(profileColumns, 'security_note')) {
      assignments.splice(assignments.length - 2, 0, `security_note = NULL`);
    }
    if (hasColumn(profileColumns, 'restored_at')) {
      assignments.splice(assignments.length - 2, 0, `restored_at = NOW()`);
    }
    if (hasColumn(profileColumns, 'restored_by_user_id')) {
      assignments.splice(assignments.length - 2, 0, `restored_by_user_id = $6`);
    }

    await client.query(
      `UPDATE user_profiles
       SET ${assignments.join(',\n           ')}
       WHERE user_id = $1`,
      [userId, displayName, username, email, normalizedPhone, BOOTSTRAP_ACTOR],
    );
    return { status: 'updated', email, userId };
  }

  if (explicitUserId) {
    await ensureUniquePhone(client, normalizedPhone, explicitUserId);
    const columns = ['user_id', 'display_name', 'username', 'email', 'phone', 'auth_provider', 'role'];
    const values = ['$1', '$2', '$3', '$4', '$5', `'azure-ad'`, `'oran_admin'`];
    const params = [explicitUserId, displayName, username, email, normalizedPhone];
    let nextIndex = params.length + 1;

    if (hasColumn(profileColumns, 'account_status')) {
      columns.push('account_status');
      values.push(`'active'`);
    }
    if (hasColumn(profileColumns, 'created_by_user_id')) {
      columns.push('created_by_user_id');
      values.push(`$${nextIndex}`);
      params.push(BOOTSTRAP_ACTOR);
      nextIndex += 1;
    }
    if (hasColumn(profileColumns, 'updated_by_user_id')) {
      columns.push('updated_by_user_id');
      values.push(`$${nextIndex}`);
      params.push(BOOTSTRAP_ACTOR);
    }

    await client.query(
      `INSERT INTO user_profiles (${columns.join(', ')})
       VALUES (${values.join(', ')})`,
      params,
    );
    return { status: 'created', email, userId: explicitUserId, authProvider: 'azure-ad' };
  }

  if (!account.password) {
    return {
      status: 'skipped',
      email,
      reason: 'no existing account found and no credentials password supplied',
    };
  }

  await ensureUniquePhone(client, normalizedPhone, null);
  const userId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(account.password, BCRYPT_ROUNDS);
  const columns = ['user_id', 'display_name', 'username', 'email', 'password_hash', 'phone', 'auth_provider', 'role'];
  const values = ['$1', '$2', '$3', '$4', '$5', '$6', `'credentials'`, `'oran_admin'`];
  const params = [userId, displayName, username, email, passwordHash, normalizedPhone];
  let nextIndex = params.length + 1;

  if (hasColumn(profileColumns, 'account_status')) {
    columns.push('account_status');
    values.push(`'active'`);
  }
  if (hasColumn(profileColumns, 'created_by_user_id')) {
    columns.push('created_by_user_id');
    values.push(`$${nextIndex}`);
    params.push(BOOTSTRAP_ACTOR);
    nextIndex += 1;
  }
  if (hasColumn(profileColumns, 'updated_by_user_id')) {
    columns.push('updated_by_user_id');
    values.push(`$${nextIndex}`);
    params.push(BOOTSTRAP_ACTOR);
  }

  await client.query(
    `INSERT INTO user_profiles (${columns.join(', ')})
     VALUES (${values.join(', ')})`,
    params,
  );
  return { status: 'created', email, userId };
}

async function ensureHostAdminMembership(client, organizationId, userId) {
  await client.query(
    `INSERT INTO organization_members (organization_id, user_id, role, status)
     VALUES ($1, $2, 'host_admin', 'active')
     ON CONFLICT (organization_id, user_id) DO UPDATE
       SET role = 'host_admin', status = 'active', updated_at = NOW()`,
    [organizationId, userId],
  );
}

async function ensureAdminReviewProfile(client, userId) {
  await client.query(
    `INSERT INTO admin_review_profiles (user_id, max_pending, max_in_review, is_active, is_accepting_new)
     VALUES ($1, $2, $3, true, true)
     ON CONFLICT (user_id) DO UPDATE
       SET max_pending = GREATEST(admin_review_profiles.max_pending, EXCLUDED.max_pending),
           max_in_review = GREATEST(admin_review_profiles.max_in_review, EXCLUDED.max_in_review),
           is_active = true,
           is_accepting_new = true,
           updated_at = NOW()`,
    [userId, ORAN_ADMIN_CAPACITY.maxPending, ORAN_ADMIN_CAPACITY.maxInReview],
  );
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  usage(0);
}

if (!process.env.DATABASE_URL || !normalizeEmail(options.primaryEmail) || !String(options.orgName ?? '').trim()) {
  usage(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const profileColumns = await getUserProfileColumns(client);
    const organizationId = await ensureOrganization(client, options);
    if (!organizationId) {
      throw new Error('Failed to create or locate organization');
    }

    const accounts = [
      {
        key: 'primary',
        email: options.primaryEmail,
        userId: options.primaryUserId,
        displayName: options.primaryDisplayName,
        username: options.primaryUsername,
        phone: options.primaryPhone,
        password: options.primaryPassword,
      },
      {
        key: 'backup',
        email: options.backupEmail,
        userId: options.backupUserId,
        displayName: options.backupDisplayName,
        username: options.backupUsername,
        phone: '',
        password: options.backupPassword,
      },
    ].filter((entry) => normalizeEmail(entry.email));

    const summary = [];
    for (const account of accounts) {
      const result = await ensureUser(client, account, profileColumns);
      if (result.userId) {
        await ensureHostAdminMembership(client, organizationId, result.userId);
        await ensureAdminReviewProfile(client, result.userId);
      }
      summary.push({ slot: account.key, ...result });
    }

    await client.query('COMMIT');

    console.log('Owner access bootstrap completed.');
    console.log(JSON.stringify({
      organizationId,
      primaryEmail: normalizeEmail(options.primaryEmail),
      backupEmail: normalizeEmail(options.backupEmail) || null,
      phoneStoredForPrimary: normalizePhone(options.primaryPhone),
      note: 'Phone is stored for credentials identifier login only. ORAN does not currently implement SMS/OTP 2SV in-app.',
      summary,
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
