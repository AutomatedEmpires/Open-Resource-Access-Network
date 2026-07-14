export const ORAN_BACKEND_DATABASE_ROLE = 'oran_backend_runtime' as const;

const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

/**
 * Production must authenticate as the reviewed, dedicated backend login.
 * Supavisor intentionally ignores arbitrary PostgreSQL startup options, so the
 * application validates the actual URI username instead of relying on SET ROLE.
 * Missing or unexpected production configuration fails closed.
 */
export function buildRuntimeDatabaseConnectionString(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredRole = env.ORAN_DATABASE_ROLE?.trim();

  if (!configuredRole) {
    if (env.NODE_ENV === 'production') {
      throw new Error('ORAN_DATABASE_ROLE is required in production');
    }
    return connectionString;
  }

  if (configuredRole !== ORAN_BACKEND_DATABASE_ROLE) {
    throw new Error('ORAN_DATABASE_ROLE is not an approved ORAN backend role');
  }

  const configuredProjectRef = env.ORAN_SUPABASE_PROJECT_REF?.trim();
  if (
    env.NODE_ENV === 'production'
    && (!configuredProjectRef || !SUPABASE_PROJECT_REF_PATTERN.test(configuredProjectRef))
  ) {
    throw new Error('ORAN_SUPABASE_PROJECT_REF is required in production');
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  }

  if (Array.from(parsed.searchParams.keys()).some((key) => key.toLowerCase() === 'options')) {
    throw new Error('DATABASE_URL must not include PostgreSQL startup options');
  }

  let username: string;
  try {
    username = decodeURIComponent(parsed.username);
  } catch {
    throw new Error('DATABASE_URL contains an invalid database username');
  }
  const directLogin = username === ORAN_BACKEND_DATABASE_ROLE;
  const poolerPrefix = `${ORAN_BACKEND_DATABASE_ROLE}.`;
  const poolerProjectRef = username.startsWith(poolerPrefix)
    ? username.slice(poolerPrefix.length)
    : '';
  const poolerLogin = SUPABASE_PROJECT_REF_PATTERN.test(poolerProjectRef);

  if (!directLogin && !poolerLogin) {
    throw new Error('DATABASE_URL must authenticate as the dedicated ORAN backend role');
  }

  if (env.NODE_ENV === 'production') {
    if (!parsed.password) {
      throw new Error('DATABASE_URL must include the ORAN backend role credential');
    }
    if (
      !poolerLogin
      || poolerProjectRef !== configuredProjectRef
      || !parsed.hostname.endsWith('.pooler.supabase.com')
      || parsed.port !== '6543'
      || parsed.pathname !== '/postgres'
      || parsed.searchParams.get('sslmode') !== 'require'
    ) {
      throw new Error('DATABASE_URL must use the isolated ORAN Supabase transaction pooler');
    }
  }

  return connectionString;
}
