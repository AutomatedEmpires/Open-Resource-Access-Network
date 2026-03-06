/**
 * Drizzle ORM implementation of AdminProfileStore.
 *
 * Maps AdminProfile / AdminWithCapacity / ClosestAdmin domain objects
 * to the admin_review_profiles table.
 *
 * Spatial queries use raw SQL with PostGIS ST_Distance.
 */
import { eq, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { adminReviewProfiles } from '@/db/schema';
import type { AdminProfile, AdminWithCapacity, ClosestAdmin } from '../adminProfiles';
import type { AdminProfileStore } from '../stores';

/**
 * Convert a DB row to an AdminProfile domain object.
 */
function rowToProfile(row: typeof adminReviewProfiles.$inferSelect): AdminProfile {
  return {
    id: row.id,
    userId: row.userId,
    profileType: 'admin', // DB doesn't have profileType; default to admin
    displayName: row.userId, // DB doesn't have displayName; use userId
    maxPendingReviews: row.maxPending,
    maxInReview: row.maxInReview,
    jurisdictionCountry: 'US',
    jurisdictionStates: row.coverageStates ?? [],
    jurisdictionCounties: row.coverageCounties ?? [],
    categoryExpertise: row.categoryExpertise ?? [],
    isActive: row.isActive,
    isAcceptingReviews: row.isAcceptingNew,
    totalReviewsCompleted: row.totalVerified + row.totalRejected,
    avgReviewHours: row.avgReviewHours ? Number(row.avgReviewHours) : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Convert a DB row + capacity info to AdminWithCapacity.
 */
function rowToWithCapacity(row: typeof adminReviewProfiles.$inferSelect): AdminWithCapacity {
  const profile = rowToProfile(row);
  const currentPendingCount = row.pendingCount;
  return {
    ...profile,
    currentPendingCount,
    availableCapacity: Math.max(0, row.maxPending - currentPendingCount),
  };
}

/**
 * Creates an AdminProfileStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleAdminProfileStore(
  db: NodePgDatabase<Record<string, unknown>>
): AdminProfileStore {
  return {
    async create(profile: AdminProfile): Promise<void> {
      await db.insert(adminReviewProfiles).values({
        userId: profile.userId,
        maxPending: profile.maxPendingReviews ?? 10,
        maxInReview: profile.maxInReview ?? 5,
        isActive: profile.isActive ?? true,
        isAcceptingNew: profile.isAcceptingReviews ?? true,
        coverageStates: profile.jurisdictionStates ?? [],
        coverageCounties: profile.jurisdictionCounties ?? [],
        categoryExpertise: profile.categoryExpertise ?? [],
        // If location is provided, store as PostGIS geometry via raw SQL
        ...(profile.location
          ? {
              location: sql`ST_SetSRID(ST_MakePoint(${profile.location.longitude}, ${profile.location.latitude}), 4326)`,
            }
          : {}),
      });
    },

    async getByUserId(userId: string): Promise<AdminProfile | null> {
      const rows = await db
        .select()
        .from(adminReviewProfiles)
        .where(eq(adminReviewProfiles.userId, userId))
        .limit(1);
      return rows.length > 0 ? rowToProfile(rows[0]) : null;
    },

    async getById(profileId: string): Promise<AdminProfile | null> {
      const rows = await db
        .select()
        .from(adminReviewProfiles)
        .where(eq(adminReviewProfiles.id, profileId))
        .limit(1);
      return rows.length > 0 ? rowToProfile(rows[0]) : null;
    },

    async update(
      profileId: string,
      updates: Partial<AdminProfile>
    ): Promise<void> {
      const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };

      if (updates.maxPendingReviews !== undefined)
        dbUpdates.maxPending = updates.maxPendingReviews;
      if (updates.maxInReview !== undefined)
        dbUpdates.maxInReview = updates.maxInReview;
      if (updates.isActive !== undefined) dbUpdates.isActive = updates.isActive;
      if (updates.isAcceptingReviews !== undefined)
        dbUpdates.isAcceptingNew = updates.isAcceptingReviews;
      if (updates.jurisdictionStates !== undefined)
        dbUpdates.coverageStates = updates.jurisdictionStates;
      if (updates.jurisdictionCounties !== undefined)
        dbUpdates.coverageCounties = updates.jurisdictionCounties;
      if (updates.categoryExpertise !== undefined)
        dbUpdates.categoryExpertise = updates.categoryExpertise;

      if (updates.location) {
        dbUpdates.location = sql`ST_SetSRID(ST_MakePoint(${updates.location.longitude}, ${updates.location.latitude}), 4326)`;
      }

      await db
        .update(adminReviewProfiles)
        .set(dbUpdates)
        .where(eq(adminReviewProfiles.id, profileId));
    },

    async getWithCapacity(
      profileId: string
    ): Promise<AdminWithCapacity | null> {
      const rows = await db
        .select()
        .from(adminReviewProfiles)
        .where(eq(adminReviewProfiles.id, profileId))
        .limit(1);
      return rows.length > 0 ? rowToWithCapacity(rows[0]) : null;
    },

    async listWithCapacity(
      filters?: {
        isActive?: boolean;
        isAcceptingReviews?: boolean;
        profileType?: 'admin' | 'org';
      }
    ): Promise<AdminWithCapacity[]> {
      const conditions = [];

      if (filters?.isActive !== undefined) {
        conditions.push(eq(adminReviewProfiles.isActive, filters.isActive));
      }
      if (filters?.isAcceptingReviews !== undefined) {
        conditions.push(
          eq(adminReviewProfiles.isAcceptingNew, filters.isAcceptingReviews)
        );
      }

      const rows = await db
        .select()
        .from(adminReviewProfiles)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return rows.map(rowToWithCapacity);
    },

    async findClosestWithCapacity(
      location: { longitude: number; latitude: number },
      filters?: {
        jurisdictionState?: string;
        jurisdictionCounty?: string;
        category?: string;
      },
      limit?: number
    ): Promise<ClosestAdmin[]> {
      // Use PostGIS ST_Distance with geography cast for meters
      const point = sql`ST_SetSRID(ST_MakePoint(${location.longitude}, ${location.latitude}), 4326)`;

      const conditions = [
        eq(adminReviewProfiles.isActive, true),
        eq(adminReviewProfiles.isAcceptingNew, true),
        sql`${adminReviewProfiles.pendingCount} < ${adminReviewProfiles.maxPending}`,
        sql`${adminReviewProfiles.location} IS NOT NULL`,
      ];

      if (filters?.jurisdictionState) {
        conditions.push(
          sql`${filters.jurisdictionState} = ANY(${adminReviewProfiles.coverageStates})`
        );
      }
      if (filters?.jurisdictionCounty) {
        conditions.push(
          sql`${filters.jurisdictionCounty} = ANY(${adminReviewProfiles.coverageCounties})`
        );
      }
      if (filters?.category) {
        conditions.push(
          sql`${filters.category} = ANY(${adminReviewProfiles.categoryExpertise})`
        );
      }

      const rows = await db
        .select({
          id: adminReviewProfiles.id,
          userId: adminReviewProfiles.userId,
          maxPending: adminReviewProfiles.maxPending,
          pendingCount: adminReviewProfiles.pendingCount,
          distance: sql<number>`ST_Distance(${adminReviewProfiles.location}::geography, ${point}::geography)`,
        })
        .from(adminReviewProfiles)
        .where(and(...conditions))
        .orderBy(
          sql`ST_Distance(${adminReviewProfiles.location}::geography, ${point}::geography)`
        )
        .limit(limit ?? 10);

      return rows.map((row) => ({
        adminProfileId: row.id,
        userId: row.userId,
        displayName: row.userId,
        profileType: 'admin' as const,
        distanceMeters: row.distance,
        availableCapacity: Math.max(0, row.maxPending - row.pendingCount),
      }));
    },

    async incrementReviewCount(profileId: string): Promise<void> {
      await db
        .update(adminReviewProfiles)
        .set({
          totalVerified: sql`${adminReviewProfiles.totalVerified} + 1`,
          lastReviewAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(adminReviewProfiles.id, profileId));
    },

    async updateAvgReviewTime(
      profileId: string,
      durationSecs: number
    ): Promise<void> {
      const durationHours = durationSecs / 3600;
      // Running average: new_avg = old_avg + (new_value - old_avg) / count
      await db
        .update(adminReviewProfiles)
        .set({
          avgReviewHours: sql`COALESCE(${adminReviewProfiles.avgReviewHours}, 0) + (${durationHours} - COALESCE(${adminReviewProfiles.avgReviewHours}, 0)) / GREATEST(${adminReviewProfiles.totalVerified} + ${adminReviewProfiles.totalRejected}, 1)`,
          updatedAt: new Date(),
        })
        .where(eq(adminReviewProfiles.id, profileId));
    },
  };
}
