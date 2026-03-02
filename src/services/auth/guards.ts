/**
 * Authorization Guards
 *
 * Route-level authorization helpers for checking roles and org access.
 * Use these in API route handlers after calling getAuthContext().
 */

import type { OranRole } from '@/domain/types';
import type { AuthContext } from './session';

// ============================================================
// ROLE HIERARCHY
// ============================================================

/**
 * Role privilege levels (higher = more access)
 */
export const ROLE_LEVELS: Record<OranRole, number> = {
  seeker: 0,
  host_member: 1,
  host_admin: 2,
  community_admin: 3,
  oran_admin: 4,
};

/**
 * Check if a role meets or exceeds a minimum role level.
 * Pure function suitable for Edge middleware (no AuthContext required).
 *
 * @example
 * if (!isRoleAtLeast('seeker', 'host_member')) {
 *   // seeker does not meet host_member minimum
 * }
 */
export function isRoleAtLeast(userRole: OranRole, minRole: OranRole): boolean {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[minRole];
}

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
