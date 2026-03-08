import { executeQuery } from '@/services/db/postgres';
import type { ChatContext, UserProfile } from '@/services/chat/types';
import { normalizeSeekerProfile, type SeekerProfile, type ServiceInterestId } from './contracts';

interface ChatHydrationRow {
  user_id: string;
  approximate_city: string | null;
  service_interests: string[] | null;
  age_group: string | null;
  household_type: string | null;
  housing_situation: string | null;
  self_identifiers: string[] | null;
  current_services: string[] | null;
  accessibility_needs: string[] | null;
  transportation_barrier: boolean | null;
  preferred_delivery_modes: string[] | null;
  urgency_window: string | null;
  documentation_barriers: string[] | null;
  digital_access_barrier: boolean | null;
}

interface ChatHydrationDeps {
  executeQuery?: typeof executeQuery;
}

export async function hydrateChatContext(
  context: ChatContext,
  deps: ChatHydrationDeps = {}
): Promise<ChatContext> {
  if (!context.userId) {
    return context;
  }

  try {
    const runQuery = deps.executeQuery ?? executeQuery;
    const rows = await runQuery<ChatHydrationRow>(
      `SELECT
         COALESCE(up.user_id, sp.user_id) AS user_id,
         up.approximate_city,
         sp.service_interests,
         sp.age_group,
         sp.household_type,
         sp.housing_situation,
         sp.self_identifiers,
         sp.current_services,
         sp.accessibility_needs,
         sp.transportation_barrier,
         sp.preferred_delivery_modes,
         sp.urgency_window,
         sp.documentation_barriers,
         sp.digital_access_barrier
       FROM user_profiles up
       FULL OUTER JOIN seeker_profiles sp
         ON sp.user_id = up.user_id
       WHERE COALESCE(up.user_id, sp.user_id) = $1
       LIMIT 1`,
      [context.userId]
    );

    const row = rows[0];
    if (!row) {
      return context;
    }

    const seekerProfile = normalizeSeekerProfile({
      serviceInterests: row.service_interests as ServiceInterestId[] | undefined ?? undefined,
      ageGroup: row.age_group ?? undefined,
      householdType: row.household_type ?? undefined,
      housingSituation: row.housing_situation ?? undefined,
      selfIdentifiers: row.self_identifiers ?? undefined,
      currentServices: row.current_services ?? undefined,
      accessibilityNeeds: row.accessibility_needs ?? undefined,
      transportationBarrier: row.transportation_barrier ?? undefined,
      preferredDeliveryModes: (row.preferred_delivery_modes as SeekerProfile['preferredDeliveryModes'] | undefined) ?? undefined,
      urgencyWindow: (row.urgency_window as SeekerProfile['urgencyWindow'] | undefined) ?? undefined,
      documentationBarriers: (row.documentation_barriers as SeekerProfile['documentationBarriers'] | undefined) ?? undefined,
      digitalAccessBarrier: row.digital_access_barrier ?? undefined,
    });

    const userProfile: UserProfile = {
      ...(context.userProfile ?? { userId: context.userId }),
      userId: context.userId,
      locationCity: row.approximate_city ?? context.userProfile?.locationCity,
      categoryPreferences: seekerProfile.serviceInterests,
      accessibilityNeeds: seekerProfile.accessibilityNeeds,
      audienceTags: seekerProfile.selfIdentifiers,
      serviceInterests: seekerProfile.serviceInterests,
      currentServices: seekerProfile.currentServices,
      selfIdentifiers: seekerProfile.selfIdentifiers,
      ageGroup: seekerProfile.ageGroup || undefined,
      householdType: seekerProfile.householdType || undefined,
      housingSituation: seekerProfile.housingSituation || undefined,
      transportationBarrier: seekerProfile.transportationBarrier,
      preferredDeliveryModes: seekerProfile.preferredDeliveryModes,
      urgencyWindow: seekerProfile.urgencyWindow || undefined,
      documentationBarriers: seekerProfile.documentationBarriers,
      digitalAccessBarrier: seekerProfile.digitalAccessBarrier,
    };

    return {
      ...context,
      userProfile,
      approximateLocation: {
        ...context.approximateLocation,
        city: row.approximate_city ?? context.approximateLocation?.city,
      },
    };
  } catch {
    return context;
  }
}
