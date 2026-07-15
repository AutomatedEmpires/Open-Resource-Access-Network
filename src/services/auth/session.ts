/**
 * Session Helper
 *
 * Resolves Clerk identity into ORAN-owned authorization context.
 * Looks up org memberships from organization_members table (if available).
 * Falls back gracefully when table doesn't exist or user isn't a member of any org.
 */

import { auth } from '@clerk/nextjs/server';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import type { AccountStatus, OranRole } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

export interface AuthContext {
  /** Authenticated Clerk subject for identity-provider operations. */
  clerkUserId: string;
  /** Canonical ORAN user ID. New accounts use their Clerk user ID. */
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

interface UserSecurityRow {
  user_id: string;
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
  profileRole?: string,
): OranRole {
  // Platform roles are owned by ORAN's database, not identity-provider claims.
  if (profileRole === 'oran_admin' || profileRole === 'community_admin') {
    return profileRole as OranRole;
  }

  // Check if user is host_admin in any org
  for (const role of orgRoles.values()) {
    if (role === 'host_admin') return 'host_admin';
  }

  // Check if user is host_member in any org
  if (orgRoles.size > 0) return 'host_member';

  // Default to seeker
  return profileRole as OranRole ?? 'seeker';
}

/**
 * Check if organization_members table exists
 */
async function orgMembersTableExists(): Promise<boolean> {
  const result = await executeQuery<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'organization_members'
    ) AS exists`,
    [],
  );
  return result[0]?.exists ?? false;
}

async function getUserSecurity(clerkUserId: string): Promise<UserSecurityRow> {
  if (!isDatabaseConfigured()) {
    // Local UI development can run without Postgres. Production authorization
    // cannot: roles and account status are owned by ORAN's database.
    return {
      user_id: clerkUserId,
      role: 'seeker',
      account_status: process.env.NODE_ENV === 'production' ? 'frozen' : 'active',
    };
  }

  try {
    const erasureRows = await executeQuery<{ erased: boolean }>(
      `SELECT oran_internal.is_account_erased($1::text) AS erased`,
      [clerkUserId],
    );
    if (erasureRows[0]?.erased) {
      return { user_id: clerkUserId, role: 'seeker', account_status: 'frozen' };
    }

    const rows = await executeQuery<UserSecurityRow>(
      `SELECT user_id, role, account_status
       FROM user_profiles
       WHERE clerk_user_id = $1
          OR (clerk_user_id IS NULL AND user_id = $1)
       ORDER BY (clerk_user_id = $1) DESC
       LIMIT 1`,
      [clerkUserId],
    );
    return rows[0] ?? { user_id: clerkUserId, role: 'seeker', account_status: 'active' };
  } catch {
    // Authorization must fail closed when the ORAN security record cannot be read.
    return { user_id: clerkUserId, role: 'seeker', account_status: 'frozen' };
  }
}

// ============================================================
// MAIN
// ============================================================

/**
 * Get authentication context for the current request.
 * Returns null if user is not authenticated.
 *
 * @example
 * const authCtx = await getAuthContext();
 * if (!authCtx) {
 *   return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
 * }
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  try {
    if (!isAuthConfigured()) {
      return null;
    }

    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return null;
    }

    const security = await getUserSecurity(clerkUserId);
    const userId = security.user_id;
    const accountStatus = security.account_status ?? 'frozen';
    if (accountStatus !== 'active') {
      return null;
    }

    const profileRole = security.role ?? 'seeker';

    // If oran_admin, skip org membership lookup (full access)
    if (profileRole === 'oran_admin') {
      return {
        clerkUserId,
        userId,
        role: 'oran_admin',
        accountStatus,
        orgIds: [],
        orgRoles: new Map(),
      };
    }

    // If community_admin, skip org membership lookup
    if (profileRole === 'community_admin') {
      return {
        clerkUserId,
        userId,
        role: 'community_admin',
        accountStatus,
        orgIds: [],
        orgRoles: new Map(),
      };
    }

    // Look up org memberships from database
    const orgIds: string[] = [];
    const orgRoles = new Map<string, 'host_member' | 'host_admin'>();

    if (isDatabaseConfigured()) {
      const tableExists = await orgMembersTableExists();

      if (tableExists) {
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
    }

    const role = determineHighestRole(orgRoles, profileRole);

    return {
      clerkUserId,
      userId,
      role,
      accountStatus,
      orgIds,
      orgRoles,
    };
  } catch {
    // Auth failure should not crash the app — return null (unauthenticated)
    return null;
  }
}

/**
 * Check whether Clerk identity is configured for this runtime.
 * Useful for conditional behavior in dev vs. prod.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    && process.env.CLERK_SECRET_KEY,
  );
}

/**
 * Whether auth enforcement should be active for the current environment.
 * Returns true if Clerk is configured **or** if running in production (fail-closed).
 */
export function shouldEnforceAuth(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  return isAuthConfigured();
}
