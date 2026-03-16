/**
 * Session Helper
 *
 * Extracts authenticated user context from NextAuth.js sessions.
 * Looks up org memberships from organization_members table (if available).
 * Falls back gracefully when table doesn't exist or user isn't a member of any org.
 */

import { getServerSession } from 'next-auth';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import type { AccountStatus, OranRole } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

export interface AuthContext {
  /** User ID from NextAuth (e.g., Entra Object ID or email-based ID) */
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
  // If session has oran_admin or community_admin, trust it
  if (sessionRole === 'oran_admin' || sessionRole === 'community_admin') {
    return sessionRole as OranRole;
  }

  // Check if user is host_admin in any org
  for (const role of orgRoles.values()) {
    if (role === 'host_admin') return 'host_admin';
  }

  // Check if user is host_member in any org
  if (orgRoles.size > 0) return 'host_member';

  // Default to seeker
  return sessionRole as OranRole ?? 'seeker';
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

async function getAccountStatus(userId: string): Promise<AccountStatus> {
  if (!isDatabaseConfigured()) {
    return 'active';
  }

  try {
    const rows = await executeQuery<UserSecurityRow>(
      `SELECT account_status FROM user_profiles WHERE user_id = $1`,
      [userId],
    );
    return rows[0]?.account_status ?? 'active';
  } catch {
    return 'active';
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
    // Get NextAuth session
    const session = await getServerSession();

    if (!session?.user) {
      return null;
    }

    // Extract user ID (prefer sub/id, fallback to email)
    const userId = (session.user as { id?: string; sub?: string }).id
      ?? (session.user as { id?: string; sub?: string }).sub
      ?? session.user.email
      ?? null;

    if (!userId) {
      return null;
    }

    const accountStatus = await getAccountStatus(userId);
    if (accountStatus !== 'active') {
      return null;
    }

    // Extract role from session metadata if available
    const sessionRole = (session.user as { role?: string }).role;

    // If oran_admin, skip org membership lookup (full access)
    if (sessionRole === 'oran_admin') {
      return {
        userId,
        role: 'oran_admin',
        accountStatus,
        orgIds: [],
        orgRoles: new Map(),
      };
    }

    // If community_admin, skip org membership lookup
    if (sessionRole === 'community_admin') {
      return {
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

    const role = determineHighestRole(orgRoles, sessionRole);

    return {
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
 * Check if auth is currently configured (Entra ID client ID present).
 * Useful for conditional behavior in dev vs. prod.
 */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.AZURE_AD_CLIENT_ID);
}

/**
 * Whether auth enforcement should be active for the current environment.
 * Returns true if Entra ID is configured **or** if running in production (fail-closed).
 * Dev-mode bypass only applies when `AZURE_AD_CLIENT_ID` is absent AND `NODE_ENV !== 'production'`.
 */
export function shouldEnforceAuth(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  return isAuthConfigured();
}
