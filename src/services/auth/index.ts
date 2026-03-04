/**
 * Auth Service
 *
 * Authentication and authorization helpers for ORAN API routes.
 *
 * @example
 * import { getAuthContext, requireRole, requireOrgAccess } from '@/services/auth';
 *
 * const authCtx = await getAuthContext();
 * if (!authCtx) {
 *   return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
 * }
 * if (!requireRole(authCtx, 'host_admin', 'oran_admin')) {
 *   return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
 * }
 */

export {
  getAuthContext,
  isAuthConfigured,
  shouldEnforceAuth,
  type AuthContext,
} from './session';

export {
  requireRole,
  requireMinRole,
  requireOrgAccess,
  requireOrgRole,
  isOranAdmin,
  canWriteToOrg,
  canManageTeam,
} from './guards';
