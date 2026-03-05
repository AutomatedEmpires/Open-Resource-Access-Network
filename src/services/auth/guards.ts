/**
 * Authorization Guards
 *
 * Route-level authorization helpers for checking roles and org access.
 * Use these in API route handlers after calling getAuthContext().
 */

import type { OranRole } from '@/domain/types';
import type { AuthContext } from './session';
import { ROLE_LEVELS, isRoleAtLeast } from './roles';

// ============================================================
// ROLE HIERARCHY
// ============================================================

export { ROLE_LEVELS, isRoleAtLeast };

// ============================================================
// GUARDS
// ============================================================

/**
 * Check if user has at least one of the required roles.
 *
 * @example
 * if (!requireRole(authCtx, 'host_admin', 'oran_admin')) {
 *   return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
 * }
 */
export function requireRole(ctx: AuthContext, ...roles: OranRole[]): boolean {
  return roles.includes(ctx.role);
}

/**
 * Check if user has at least the specified role level.
 * Uses role hierarchy: seeker < host_member < host_admin < community_admin < oran_admin
 *
 * @example
 * if (!requireMinRole(authCtx, 'host_member')) {
 *   return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
 * }
 */
export function requireMinRole(ctx: AuthContext, minRole: OranRole): boolean {
  return ROLE_LEVELS[ctx.role] >= ROLE_LEVELS[minRole];
}

/**
 * Check if user has access to a specific organization.
 * Returns true if:
 * - User is a member of the organization (any role)
 * - User is oran_admin (bypasses all org checks)
 *
 * @example
 * if (!requireOrgAccess(authCtx, orgId)) {
 *   return NextResponse.json({ error: 'Access denied' }, { status: 403 });
 * }
 */
export function requireOrgAccess(ctx: AuthContext, orgId: string): boolean {
  // oran_admin can access any org
  if (ctx.role === 'oran_admin') {
    return true;
  }

  return ctx.orgIds.includes(orgId);
}

/**
 * Check if user has a specific role for an organization.
 *
 * @example
 * if (!requireOrgRole(authCtx, orgId, 'host_admin')) {
 *   return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
 * }
 */
export function requireOrgRole(
  ctx: AuthContext,
  orgId: string,
  role: 'host_member' | 'host_admin',
): boolean {
  // oran_admin can do anything
  if (ctx.role === 'oran_admin') {
    return true;
  }

  const userOrgRole = ctx.orgRoles.get(orgId);
  if (!userOrgRole) {
    return false;
  }

  // host_admin can do everything host_member can do
  if (role === 'host_member') {
    return userOrgRole === 'host_member' || userOrgRole === 'host_admin';
  }

  return userOrgRole === role;
}

/**
 * Check if user is an oran_admin (platform-wide superuser).
 *
 * @example
 * if (!isOranAdmin(authCtx)) {
 *   return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
 * }
 */
export function isOranAdmin(ctx: AuthContext): boolean {
  return ctx.role === 'oran_admin';
}

/**
 * Check if user can write to an organization's resources.
 * Requires host_member+ role for the specific org, or oran_admin.
 *
 * @example
 * if (!canWriteToOrg(authCtx, orgId)) {
 *   return NextResponse.json({ error: 'Write access denied' }, { status: 403 });
 * }
 */
export function canWriteToOrg(ctx: AuthContext, orgId: string): boolean {
  return requireOrgRole(ctx, orgId, 'host_member');
}

/**
 * Check if user can manage team members for an organization.
 * Requires host_admin role for the specific org, or oran_admin.
 *
 * @example
 * if (!canManageTeam(authCtx, orgId)) {
 *   return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
 * }
 */
export function canManageTeam(ctx: AuthContext, orgId: string): boolean {
  return requireOrgRole(ctx, orgId, 'host_admin');
}

// ============================================================
// SCOPE-BASED GUARDS (Universal Pipeline)
// ============================================================

/**
 * Check if a user has a specific scope grant (direct or via role).
 * Queries the database — use sparingly in hot paths.
 * For role-only checks, prefer requireMinRole() which is in-memory.
 */
export async function hasScope(
  userId: string,
  scopeName: string,
  organizationId?: string | null,
): Promise<boolean> {
  // Import dynamically to avoid circular dependency
  const { userHasScope } = await import('@/services/workflow/two-person');
  return userHasScope(userId, scopeName, organizationId);
}

/**
 * Guard: require a scope for the current user.
 * Returns true if the user has the scope, false otherwise.
 */
export async function requireScope(
  ctx: AuthContext,
  scopeName: string,
  organizationId?: string | null,
): Promise<boolean> {
  // oran_admin bypasses scope checks
  if (ctx.role === 'oran_admin') return true;

  return hasScope(ctx.userId, scopeName, organizationId);
}
