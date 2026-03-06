/**
 * NextAuth.js Configuration
 *
 * Supports three auth providers:
 *   1. Microsoft Entra ID (Azure AD) — OAuth
 *   2. Google — OAuth
 *   3. Credentials — email + password (DB-backed)
 *
 * Stores role claim in the JWT so middleware can enforce RBAC without DB lookups.
 * On sign-in, the DB user_profiles.role is the source of truth (falls back to Entra claims).
 *
 * Required environment variables:
 * - NEXTAUTH_SECRET
 * - NEXTAUTH_URL (production only — auto-detected in dev)
 * - AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET, AZURE_AD_TENANT_ID (optional)
 * - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (optional)
 */

import type { AuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import type { OranRole } from '@/domain/types';
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
async function getDbRole(userId: string): Promise<OranRole | null> {
  try {
    const pool = getPgPool();
    const result = await pool.query<{ role: OranRole }>(
      `SELECT role FROM user_profiles WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0]?.role ?? null;
  } catch {
    // If DB is unreachable, fall back to JWT/provider role
    return null;
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
    ...(process.env.GOOGLE_CLIENT_ID
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
          }),
        ]
      : []),

    // ── Email + Password (credentials) ───────────────────
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.trim().toLowerCase();
        const password = credentials.password;

        try {
          const pool = getPgPool();
          const result = await pool.query<{
            user_id: string;
            display_name: string | null;
            email: string;
            password_hash: string;
            role: OranRole;
          }>(
            `SELECT user_id, display_name, email, password_hash, role
             FROM user_profiles
             WHERE email = $1 AND auth_provider = 'credentials'`,
            [email],
          );

          const user = result.rows[0];
          if (!user || !user.password_hash) return null;

          const isValid = await bcrypt.compare(password, user.password_hash);
          if (!isValid) return null;

          return {
            id: user.user_id,
            name: user.display_name ?? email,
            email: user.email,
            role: user.role,
          } as unknown as { id: string; name: string; email: string; role: OranRole };
        } catch {
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },

  callbacks: {
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

        // DB role is the source of truth
        const dbRole = await getDbRole(user.id);
        if (dbRole) {
          token.role = dbRole;
        } else {
          // Fall back to provider-supplied role
          token.role = user.role ?? 'seeker';
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
