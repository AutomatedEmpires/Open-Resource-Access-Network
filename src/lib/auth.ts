/**
 * NextAuth.js Configuration
 *
 * Supports Microsoft Entra ID by default.
 * Optional Google OAuth and email/password auth are fail-closed in production
 * unless explicitly enabled with server-side env flags.
 *
 * Stores role claim in the JWT so middleware can enforce RBAC without DB lookups.
 * On sign-in, the DB user_profiles.role is the source of truth (falls back to Entra claims).
 *
 * Required environment variables:
 * - NEXTAUTH_SECRET
 * - NEXTAUTH_URL (production only — auto-detected in dev)
 * - AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET, AZURE_AD_TENANT_ID (optional)
 * - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (optional when ORAN_ENABLE_GOOGLE_AUTH=1)
 */

import type { AuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import AppleProvider from 'next-auth/providers/apple';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import type { AccountStatus, OranRole } from '@/domain/types';
import { getPgPool } from '@/services/db/postgres';

// ============================================================
// ROLE MAPPING
// ============================================================

/**
 * Maps Entra ID app role values to ORAN roles.
 * Configure app roles in Azure Portal → App Registration → App Roles.
 * Users are assigned to roles via Enterprise Applications → Users and Groups.
 */
const ENTRA_ROLE_MAP: Record<string, OranRole> = {
  'OranAdmin': 'oran_admin',
  'CommunityAdmin': 'community_admin',
  'HostAdmin': 'host_admin',
  'HostMember': 'host_member',
  'Seeker': 'seeker',
};

export function isCredentialsAuthEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ORAN_ENABLE_CREDENTIALS_AUTH === '1';
}

export function isGoogleAuthEnabled(): boolean {
  return process.env.ORAN_ENABLE_GOOGLE_AUTH === '1' && Boolean(process.env.GOOGLE_CLIENT_ID);
}

export function isAppleAuthEnabled(): boolean {
  return process.env.ORAN_ENABLE_APPLE_AUTH === '1' && Boolean(process.env.APPLE_CLIENT_ID);
}

let userProfileSchemaPromise: Promise<{ hasAccountStatus: boolean }> | null = null;

async function getUserProfileSchema(): Promise<{ hasAccountStatus: boolean }> {
  if (!userProfileSchemaPromise) {
    userProfileSchemaPromise = (async () => {
      try {
        const pool = getPgPool();
        const result = await pool.query<{ column_name: string }>(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'user_profiles'`,
        );
        const columnNames = new Set(result.rows.map((row) => row.column_name));
        return { hasAccountStatus: columnNames.has('account_status') };
      } catch {
        return { hasAccountStatus: true };
      }
    })();
  }

  return userProfileSchemaPromise;
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhoneNumber(value: string): string | null {
  const trimmed = value.trim();
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

/**
 * Determine the highest ORAN role from Entra ID app role claims.
 * Entra can assign multiple roles — we pick the highest-privilege one.
 */
export function resolveOranRole(roles?: string[]): OranRole {
  if (!roles || roles.length === 0) return 'seeker';

  const ROLE_PRIORITY: OranRole[] = [
    'oran_admin',
    'community_admin',
    'host_admin',
    'host_member',
    'seeker',
  ];

  const mapped = roles
    .map((r) => ENTRA_ROLE_MAP[r])
    .filter((r): r is OranRole => r !== undefined);

  for (const role of ROLE_PRIORITY) {
    if (mapped.includes(role)) return role;
  }

  return 'seeker';
}

/**
 * Look up a user's role from user_profiles in the DB.
 * Returns the DB role if found, otherwise null.
 */
async function getDbAccountState(userId: string): Promise<{ role: OranRole | null; accountStatus: AccountStatus }> {
  try {
    const { hasAccountStatus } = await getUserProfileSchema();
    const pool = getPgPool();
    const result = await pool.query<{ role: OranRole; account_status?: AccountStatus | null }>(
      hasAccountStatus
        ? `SELECT role, account_status FROM user_profiles WHERE user_id = $1`
        : `SELECT role FROM user_profiles WHERE user_id = $1`,
      [userId],
    );
    return {
      role: result.rows[0]?.role ?? null,
      accountStatus: hasAccountStatus ? (result.rows[0]?.account_status ?? 'active') : 'active',
    };
  } catch {
    return { role: null, accountStatus: 'active' };
  }
}

async function ensureUserProfile(user: {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: OranRole;
}, provider?: string): Promise<void> {
  if (!user.id) {
    return;
  }

  try {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO user_profiles (user_id, display_name, email, auth_provider, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
             email = COALESCE(EXCLUDED.email, user_profiles.email),
             auth_provider = EXCLUDED.auth_provider`,
      [
        user.id,
        user.name?.trim() || null,
        user.email?.trim().toLowerCase() || null,
        provider ?? 'azure-ad',
        user.role ?? 'seeker',
      ],
    );
  } catch {
    // Non-blocking: auth still works even if profile sync fails.
  }
}

// ============================================================
// AUTH OPTIONS
// ============================================================

export const authOptions: AuthOptions = {
  providers: [
    // ── Test provider (dev/CI only) ──────────────────────
    ...(process.env.ORAN_TEST_AUTH_ENABLED === '1' && process.env.NODE_ENV !== 'production'
      ? [
          CredentialsProvider({
            id: 'oran-test',
            name: 'ORAN Test Auth',
            credentials: {
              userId: { label: 'User ID', type: 'text' },
              role: { label: 'Role', type: 'text' },
            },
            async authorize(credentials) {
              const userId = credentials?.userId?.trim() || 'oran-e2e-user';
              const role = (credentials?.role?.trim() || 'seeker') as OranRole;
              const allowed: OranRole[] = [
                'seeker',
                'host_member',
                'host_admin',
                'community_admin',
                'oran_admin',
              ];
              if (!allowed.includes(role)) {
                return null;
              }
              return {
                id: userId,
                name: `Test ${role}`,
                email: `${userId}@oran.test`,
                role,
              } as unknown as { id: string; name: string; email: string; role: OranRole };
            },
          }),
        ]
      : []),

    // ── Microsoft Entra ID (Azure AD) ────────────────────
    ...(process.env.AZURE_AD_CLIENT_ID
      ? [
          AzureADProvider({
            clientId: process.env.AZURE_AD_CLIENT_ID,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET ?? '',
            tenantId: process.env.AZURE_AD_TENANT_ID ?? 'common',
            authorization: {
              params: {
                scope: 'openid profile email',
              },
            },
            profile(profile) {
              return {
                id: profile.sub ?? profile.oid,
                name: profile.name,
                email: profile.email,
                role: resolveOranRole(profile.roles),
              };
            },
          }),
        ]
      : []),

    // ── Google OAuth ─────────────────────────────────────
    ...(isGoogleAuthEnabled()
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID ?? '',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
          }),
        ]
      : []),

    // ── Apple OAuth ──────────────────────────────────────
    ...(isAppleAuthEnabled()
      ? [
          AppleProvider({
            clientId: process.env.APPLE_CLIENT_ID ?? '',
            clientSecret: process.env.APPLE_CLIENT_SECRET ?? '',
          }),
        ]
      : []),

    // ── Email + Password (credentials) ───────────────────
    ...(isCredentialsAuthEnabled()
      ? [
          CredentialsProvider({
            id: 'credentials',
            name: 'Email, Username, or Phone',
            credentials: {
              identifier: { label: 'Email, Username, or Phone', type: 'text' },
              password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials) {
              if (!credentials?.identifier || !credentials?.password) return null;

              const identifier = credentials.identifier.trim();
              const password = credentials.password;
              const normalizedEmail = identifier.toLowerCase();
              const normalizedUsername = normalizeUsername(identifier);
              const normalizedPhone = normalizePhoneNumber(identifier) ?? '__oran_no_phone__';

              try {
                const { hasAccountStatus } = await getUserProfileSchema();
                const pool = getPgPool();
                const result = await pool.query<{
                  user_id: string;
                  display_name: string | null;
                  email: string | null;
                  username: string | null;
                  phone: string | null;
                  password_hash: string;
                  role: OranRole;
                  account_status?: AccountStatus | null;
                }>(
                  `SELECT user_id, display_name, email, username, phone, password_hash, role${hasAccountStatus ? ', account_status' : ''}
                   FROM user_profiles
                   WHERE COALESCE(password_hash, '') <> ''
                     AND (
                       LOWER(COALESCE(email, '')) = $1
                       OR LOWER(COALESCE(username, '')) = $2
                       OR regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = $3
                     )
                   LIMIT 1`,
                  [normalizedEmail, normalizedUsername, normalizedPhone],
                );

                const user = result.rows[0];
                if (!user || !user.password_hash) return null;
                if ((user.account_status ?? 'active') === 'frozen') return null;

                const isValid = await bcrypt.compare(password, user.password_hash);
                if (!isValid) return null;

                return {
                  id: user.user_id,
                  name: user.display_name ?? user.username ?? user.email ?? user.phone ?? identifier,
                  email: user.email ?? undefined,
                  role: user.role,
                  accountStatus: user.account_status ?? 'active',
                } as unknown as { id: string; name: string; email: string; role: OranRole };
              } catch {
                return null;
              }
            },
          }),
        ]
      : []),
  ],

  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },

  callbacks: {
    async signIn({ user, account }) {
      if (user?.id && account?.provider && account.provider !== 'credentials') {
        await ensureUserProfile(user, account.provider);
      }

      if (user?.id) {
        const state = await getDbAccountState(user.id);
        if (state.accountStatus === 'frozen') {
          return false;
        }
        user.accountStatus = state.accountStatus;
      }

      return true;
    },

    /**
     * JWT callback — runs on sign-in and on every session access.
     * Persists the ORAN role into the JWT so middleware can read it
     * without a DB lookup on every request.
     *
     * On initial sign-in:
     *   1. Check DB for existing user_profiles.role (source of truth).
     *   2. Fall back to Entra app role claims if present.
     *   3. Default to 'seeker'.
     */
    async jwt({ token, user, account }) {
      // On initial sign-in, resolve role from DB first
      if (user) {
        token.sub = user.id;

        const state = await getDbAccountState(user.id);
        token.accountStatus = state.accountStatus;
        if (state.role) {
          token.role = state.role;
        } else {
          // Fall back to provider-supplied role
          token.role = user.role ?? 'seeker';
        }
      } else if (typeof token.sub === 'string') {
        const state = await getDbAccountState(token.sub);
        token.accountStatus = state.accountStatus;
        if (state.role) {
          token.role = state.role;
        }
      }

      // If the account has id_token_claims with Entra roles, use those
      // (only when no DB role exists — Entra roles bootstrap new users)
      if (account?.id_token && !token.role) {
        try {
          const payload = JSON.parse(
            Buffer.from(account.id_token.split('.')[1], 'base64').toString()
          ) as { roles?: string[] };
          if (payload.roles) {
            token.role = resolveOranRole(payload.roles);
          }
        } catch {
          // If decoding fails, keep existing role
        }
      }

      // Ensure role is always set
      if (!token.role) {
        token.role = 'seeker';
      }
      if (!token.accountStatus) {
        token.accountStatus = 'active';
      }

      return token;
    },

    /**
     * Session callback — shapes what getServerSession() returns.
     * Exposes userId and role to the application.
     */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
        session.user.role = token.role ?? 'seeker';
        session.user.accountStatus = token.accountStatus ?? 'active';
      }
      return session;
    },
  },

  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
};

export default authOptions;
