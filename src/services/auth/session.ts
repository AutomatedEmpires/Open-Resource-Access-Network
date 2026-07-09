/**
 * Session Helper
 *
 * Extracts authenticated user context from the Clerk session and resolves the
 * ORAN role / account status / org memberships from Postgres.
 *
 * Identity comes from Clerk; **authorization is DB-driven** — `user_profiles.role`
 * is the source of truth, and `organization_members` drives host-org access. The
 * `getAuthContext()` seam is the single server-side auth accessor used by every
 * API route, so the Clerk cutover is contained to this module.
 *
 * On first authed request a `user_profiles` row is created on demand (default
 * role `seeker`), so sign-ups work without a Clerk webhook.
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import type { AccountStatus, OranRole } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

export interface AuthContext {
  /** User ID from Clerk (the Clerk user id, e.g. "user_..."). */
  userId: string;
  /** User's primary role (highest privilege level) */
  role: OranRole;
  /** Effective account status from user_profiles */
  accountStatus: AccountStatus;
  /** Organization IDs this user is a member of (host_member or host_admin) */
  orgIds: string[];
  /** Role per organization (for fine-grained checks) */
  orgRoles: Map<string, 'host_member' | 'host_admin'>;
}

interface OrgMemberRow {
  organization_id: string;
  role: string;
  status: string;
}

interface UserProfileRow {
  role: OranRole | null;
  account_status: AccountStatus | null;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Determine highest role from user's org memberships
 */
function determineHighestRole(
  orgRoles: Map<string, 'host_member' | 'host_admin'>,
  sessionRole?: string,
): OranRole {
  // If profile role is oran_admin or community_admin, trust it
  if (sessionRole === 'oran_admin' || sessionRole === 'community_admin') {
    return sessionRole as OranRole;
  }

  // Check if user is host_admin in any org
  for (const role of orgRoles.values()) {
    if (role === 'host_admin') return 'host_admin';
  }

  // Check if user is host_member in any org
  if (orgRoles.size > 0) return 'host_member';

  // Default to the profile role or seeker
  return (sessionRole as OranRole) ?? 'seeker';
}

/**
 * Check if organization_members table exists
 */
async function orgMembersTableExists(): Promise<boolean> {
  try {
    const result = await executeQuery<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'organization_members'
      ) AS exists`,
      [],
    );
    return result[0]?.exists ?? false;
  } catch {
    return false;
  }
}

/**
 * Read (and, on first sight, create) the user's profile row.
 * Returns the DB role + account status. On DB error, fails closed (frozen).
 */
async function getOrCreateProfile(userId: string): Promise<{ role: OranRole | null; accountStatus: AccountStatus }> {
  if (!isDatabaseConfigured()) {
    return { role: null, accountStatus: 'active' };
  }

  try {
    const rows = await executeQuery<UserProfileRow>(
      `SELECT role, account_status FROM user_profiles WHERE user_id = $1`,
      [userId],
    );

    if (rows[0]) {
      return {
        role: rows[0].role ?? null,
        accountStatus: rows[0].account_status ?? 'active',
      };
    }

    // First authed request for this Clerk user — create a seeker profile on demand.
    const clerkUser = await currentUser().catch(() => null);
    const email = clerkUser?.primaryEmailAddress?.emailAddress ?? clerkUser?.emailAddresses?.[0]?.emailAddress ?? null;
    const displayName =
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ').trim() ||
      clerkUser?.username ||
      null;

    await executeQuery(
      `INSERT INTO user_profiles (user_id, display_name, email, auth_provider, role)
       VALUES ($1, $2, $3, 'clerk', 'seeker')
       ON CONFLICT (user_id) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
             email = COALESCE(EXCLUDED.email, user_profiles.email),
             auth_provider = 'clerk'`,
      [userId, displayName, email?.toLowerCase() ?? null],
    );

    return { role: 'seeker', accountStatus: 'active' };
  } catch {
    // B2 fix: deny access on DB error instead of assuming active —
    // prevents frozen users from authenticating during DB outages.
    return { role: null, accountStatus: 'frozen' };
  }
}

// ============================================================
// MAIN
// ============================================================

/**
 * Get authentication context for the current request.
 * Returns null if the user is not authenticated (or is not active).
 *
 * @example
 * const authCtx = await getAuthContext();
 * if (!authCtx) {
 *   return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
 * }
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return null;
    }

    const profile = await getOrCreateProfile(userId);
    if (profile.accountStatus !== 'active') {
      return null;
    }

    const profileRole = profile.role ?? undefined;

    // Platform admins skip the org-membership lookup (full access).
    if (profileRole === 'oran_admin') {
      return { userId, role: 'oran_admin', accountStatus: profile.accountStatus, orgIds: [], orgRoles: new Map() };
    }
    if (profileRole === 'community_admin') {
      return { userId, role: 'community_admin', accountStatus: profile.accountStatus, orgIds: [], orgRoles: new Map() };
    }

    // Look up org memberships from the database.
    const orgIds: string[] = [];
    const orgRoles = new Map<string, 'host_member' | 'host_admin'>();

    if (isDatabaseConfigured() && (await orgMembersTableExists())) {
      const rows = await executeQuery<OrgMemberRow>(
        `SELECT organization_id, role, status
         FROM organization_members
         WHERE user_id = $1 AND status = 'active'`,
        [userId],
      );

      for (const row of rows) {
        if (row.role === 'host_admin' || row.role === 'host_member') {
          orgIds.push(row.organization_id);
          orgRoles.set(row.organization_id, row.role);
        }
      }
    }

    const role = determineHighestRole(orgRoles, profileRole);

    return { userId, role, accountStatus: profile.accountStatus, orgIds, orgRoles };
  } catch {
    // Auth failure should not crash the app — return null (unauthenticated).
    return null;
  }
}

/**
 * Whether Clerk auth is configured (publishable key present).
 */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * Whether auth enforcement should be active for the current environment.
 * Fail-closed in production; in dev, enforced only when Clerk is configured.
 */
export function shouldEnforceAuth(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  return isAuthConfigured();
}
