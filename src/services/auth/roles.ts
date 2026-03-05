import type { OranRole } from '@/domain/types';

/**
 * Role privilege levels (higher = more access).
 * Kept in a standalone module so client bundles can import role checks
 * without pulling in server-only auth guard helpers.
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
 */
export function isRoleAtLeast(userRole: OranRole, minRole: OranRole): boolean {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[minRole];
}
