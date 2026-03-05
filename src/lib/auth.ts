/**
 * NextAuth.js Configuration
 *
 * Configures Microsoft Entra ID (Azure AD) as the authentication provider.
 * Stores role claim in the JWT so middleware can enforce RBAC without DB lookups.
 *
 * Required environment variables:
 * - AZURE_AD_CLIENT_ID
 * - AZURE_AD_CLIENT_SECRET
 * - AZURE_AD_TENANT_ID
 * - NEXTAUTH_SECRET
 * - NEXTAUTH_URL (production only — auto-detected in dev)
 */

import type { AuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { OranRole } from '@/domain/types';

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

// ============================================================
// AUTH OPTIONS
// ============================================================

export const authOptions: AuthOptions = {
  providers: [
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
  ],

  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },

  callbacks: {
    /**
     * JWT callback — runs on sign-in and on every session access.
     * Persists the ORAN role into the JWT so middleware can read it
     * without a DB lookup.
     */
    async jwt({ token, user, account }) {
      // On initial sign-in, copy role from user profile
      if (user) {
        token.role = user.role ?? 'seeker';
        token.sub = user.id;
      }

      // If the account has id_token_claims with roles, use those
      if (account?.id_token) {
        try {
          // Decode the id_token to extract roles claim
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

  // Fail-safe: never store raw access tokens in the session
  // The JWT only contains id, role, name, email
};

export default authOptions;
