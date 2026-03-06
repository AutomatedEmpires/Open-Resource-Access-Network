/**
 * Admin profile management for the approval workflow.
 *
 * Each admin/org has a profile that tracks:
 * - Geographic location (for finding closest admins)
 * - Capacity (max pending reviews)
 * - Jurisdiction coverage
 * - Category expertise
 */
import { z } from 'zod';

import { ROLE_CAPACITY_DEFAULTS } from '@/domain/constants';

// ============================================================
// Admin Profile Types
// ============================================================

export const AdminProfileTypeSchema = z.enum(['admin', 'org']);
export type AdminProfileType = z.infer<typeof AdminProfileTypeSchema>;

export const AdminProfileSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().min(1),
  profileType: AdminProfileTypeSchema,
  displayName: z.string().min(1),
  email: z.string().email().optional(),

  // Capacity settings
  maxPendingReviews: z.number().int().min(1).max(100).default(10),
  maxInReview: z.number().int().min(1).max(50).default(5),

  // Location for geographic routing
  location: z.object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
  }).optional(),

  // Jurisdiction coverage
  jurisdictionCountry: z.string().default('US'),
  jurisdictionStates: z.array(z.string()).default([]),
  jurisdictionCounties: z.array(z.string()).default([]),

  // Category expertise
  categoryExpertise: z.array(z.string()).default([]),

  // Status flags
  isActive: z.boolean().default(true),
  isAcceptingReviews: z.boolean().default(true),

  // Stats (read-only)
  totalReviewsCompleted: z.number().int().min(0).default(0),
  avgReviewHours: z.number().min(0).optional(),

  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type AdminProfile = z.infer<typeof AdminProfileSchema>;

// ============================================================
// Admin Profile with capacity (from view)
// ============================================================

export const AdminWithCapacitySchema = AdminProfileSchema.extend({
  currentPendingCount: z.number().int().min(0),
  availableCapacity: z.number().int(),
});

export type AdminWithCapacity = z.infer<typeof AdminWithCapacitySchema>;

// ============================================================
// Closest admin result (from geographic query)
// ============================================================

export const ClosestAdminSchema = z.object({
  adminProfileId: z.string().uuid(),
  userId: z.string(),
  displayName: z.string(),
  profileType: AdminProfileTypeSchema,
  distanceMeters: z.number().min(0),
  availableCapacity: z.number().int(),
});

export type ClosestAdmin = z.infer<typeof ClosestAdminSchema>;

// ============================================================
// Factory functions
// ============================================================

export function createAdminProfile(
  userId: string,
  displayName: string,
  options: Partial<Omit<AdminProfile, 'userId' | 'displayName' | 'id'>> & {
    role?: 'oran_admin' | 'community_admin' | 'host_admin';
  } = {}
): AdminProfile {
  const roleDefaults = options.role
    ? ROLE_CAPACITY_DEFAULTS[options.role]
    : ROLE_CAPACITY_DEFAULTS.community_admin;

  return {
    userId,
    displayName,
    profileType: options.profileType ?? 'admin',
    maxPendingReviews: options.maxPendingReviews ?? roleDefaults.maxPending,
    maxInReview: options.maxInReview ?? roleDefaults.maxInReview,
    jurisdictionCountry: options.jurisdictionCountry ?? 'US',
    jurisdictionStates: options.jurisdictionStates ?? [],
    jurisdictionCounties: options.jurisdictionCounties ?? [],
    categoryExpertise: options.categoryExpertise ?? [],
    isActive: options.isActive ?? true,
    isAcceptingReviews: options.isAcceptingReviews ?? true,
    totalReviewsCompleted: 0,
    ...(options.location ? { location: options.location } : {}),
    ...(options.email ? { email: options.email } : {}),
  };
}

// ============================================================
// Capacity helpers
// ============================================================

/**
 * Check if an admin has capacity for more reviews.
 */
export function hasCapacity(admin: AdminWithCapacity): boolean {
  return (
    admin.isActive &&
    admin.isAcceptingReviews &&
    admin.availableCapacity > 0
  );
}

/**
 * Filter admins to only those with available capacity.
 */
export function filterByCapacity(admins: AdminWithCapacity[]): AdminWithCapacity[] {
  return admins.filter(hasCapacity);
}

/**
 * Sort closest admins prioritizing:
 * 1. Orgs first (if needed)
 * 2. Then by distance
 */
export function sortClosestAdmins(
  admins: ClosestAdmin[],
  options: { prioritizeOrgs?: boolean } = {}
): ClosestAdmin[] {
  const sorted = [...admins].sort((a, b) => {
    if (options.prioritizeOrgs) {
      // Orgs first
      if (a.profileType === 'org' && b.profileType !== 'org') return -1;
      if (a.profileType !== 'org' && b.profileType === 'org') return 1;
    }
    // Then by distance
    return a.distanceMeters - b.distanceMeters;
  });
  return sorted;
}

/**
 * Select admins for assignment (2-3 admins + 1-2 orgs).
 * Returns up to targetCount admins, balanced between admins and orgs.
 */
export function selectAdminsForAssignment(
  closestAdmins: ClosestAdmin[],
  targetCount: number = 5
): ClosestAdmin[] {
  if (targetCount <= 0) return [];

  const admins = closestAdmins.filter(a => a.profileType === 'admin');
  const orgs = closestAdmins.filter(a => a.profileType === 'org');

  // Target: ~3 admins + ~2 orgs (or whatever is available)
  const targetAdmins = Math.min(3, admins.length);
  const targetOrgs = Math.min(2, orgs.length);

  // Fill remaining slots with whichever type has more
  const selected: ClosestAdmin[] = [
    ...admins.slice(0, targetAdmins),
    ...orgs.slice(0, targetOrgs),
  ];

  // If we haven't hit targetCount, add more of whatever's left
  const remaining = targetCount - selected.length;
  if (remaining > 0) {
    const remainingAdmins = admins.slice(targetAdmins);
    const remainingOrgs = orgs.slice(targetOrgs);
    const moreAdmins = [...remainingAdmins, ...remainingOrgs]
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, remaining);
    selected.push(...moreAdmins);
  }

  // Sort final selection by distance
  return selected
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, targetCount);
}
