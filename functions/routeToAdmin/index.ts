/**
 * routeToAdmin — Queue-triggered function.
 *
 * Receives a verified candidate from `ingestion-route` queue,
 * applies admin routing rules to assign the candidate to the
 * appropriate community admin for review.
 *
 * Azure Function binding:
 *   trigger: queue  queueName: "ingestion-route"
 *
 * @module functions/routeToAdmin
 */
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouteQueueMessage {
  candidateId: string;
  correlationId: string;
  confidenceScore: number;
  confidenceTier: string;
  verificationsPassed: number;
  verificationsTotal: number;
  enqueuedAt: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Routes a verified candidate to the appropriate admin reviewer by:
 *   1. Looking up jurisdiction from the candidate record
 *   2. Finding the best matching routing rule (country/state/county)
 *   3. Resolving the target admin profile by user ID
 *   4. Creating a pending assignment in the admin_assignments table
 *   5. Appending a `review.assigned` audit event
 *
 * If no routing rule matches, a `review.assigned` audit event is still
 * written with `assignmentsCreated: 0` so the gap is visible in telemetry.
 */
export async function routeToAdmin(message: RouteQueueMessage): Promise<void> {
  const { getDrizzle } = await import('@/services/db/drizzle');
  const { createIngestionStores } = await import(
    '@/agents/ingestion/persistence/storeFactory'
  );

  const db = getDrizzle();
  const stores = createIngestionStores(db);

  // --- Load candidate ---
  const candidate = await stores.candidates.getById(message.candidateId);
  if (!candidate) {
    console.warn(`[routeToAdmin] Candidate ${message.candidateId} not found`);
    return;
  }

  const jurisdiction = candidate.review?.jurisdiction;
  const stateProvince = jurisdiction?.stateProvince;
  const countyOrRegion = jurisdiction?.countyOrRegion;

  // --- Find best routing rule ---
  const rule = await stores.routing.findBestMatch(
    'US',
    stateProvince,
    countyOrRegion
  );

  let assignmentsCreated = 0;
  let routingFallback = false;

  if (rule?.assignedUserId) {
    const profile = await stores.adminProfiles.getByUserId(rule.assignedUserId);

    if (profile?.id) {
      await stores.assignments.create({
        candidateId: message.candidateId,
        adminProfileId: profile.id,
        assignmentRank: 1,
        assignmentStatus: 'pending',
        assignedAt: new Date().toISOString(),
        decisionDueBy: new Date(
          Date.now() + 72 * 60 * 60 * 1000 // 72-hour SLA default
        ).toISOString(),
      });

      assignmentsCreated = 1;

      console.log(
        `[routeToAdmin] Assigned candidate ${message.candidateId} to ` +
          `admin profile ${profile.id} (user ${rule.assignedUserId})`
      );
    } else {
      console.warn(
        `[routeToAdmin] Routing rule matched but admin profile not found ` +
          `for userId=${rule.assignedUserId}`
      );
    }
  } else {
    console.warn(
      `[routeToAdmin] No routing rule matched for candidate ` +
        `${message.candidateId} ` +
        `(state=${stateProvince ?? 'any'}, county=${countyOrRegion ?? 'any'})`
    );
  }

  // --- Fallback: route to ORAN admin when no assignment was created ---
  if (assignmentsCreated === 0) {
    const { findOranAdmins } = await import('@/services/escalation/engine');
    const oranAdmins = await findOranAdmins();

    if (oranAdmins.length > 0) {
      const fallbackAdmin = oranAdmins[0];
      const fallbackProfile = await stores.adminProfiles.getByUserId(
        fallbackAdmin.user_id
      );

      if (fallbackProfile?.id) {
        await stores.assignments.create({
          candidateId: message.candidateId,
          adminProfileId: fallbackProfile.id,
          assignmentRank: 1,
          assignmentStatus: 'pending',
          assignedAt: new Date().toISOString(),
          decisionDueBy: new Date(
            Date.now() + 48 * 60 * 60 * 1000 // 48-hour SLA for fallback
          ).toISOString(),
        });

        assignmentsCreated = 1;
        routingFallback = true;

        // Notify the ORAN admin
        const { executeQuery } = await import('@/services/db/postgres');
        await executeQuery(
          `INSERT INTO notification_events
             (recipient_user_id, event_type, title, body,
              resource_type, resource_id, action_url, idempotency_key)
           VALUES ($1, 'submission_assigned',
                   'Fallback assignment: No regional admin available',
                   'Candidate ' || $2 || ' has been assigned to you because no regional admin covers this area.',
                   'candidate', $2, '/verify?candidateId=' || $2, $3)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            fallbackAdmin.user_id,
            message.candidateId,
            `fallback_assign_${message.candidateId}`,
          ],
        );

        console.log(
          `[routeToAdmin] Fallback: assigned candidate ${message.candidateId} ` +
            `to ORAN admin ${fallbackAdmin.user_id}`
        );
      }
    } else {
      // No ORAN admins available — fire system alert
      const { executeQuery } = await import('@/services/db/postgres');
      await executeQuery(
        `INSERT INTO notification_events
           (recipient_user_id, event_type, title, body,
            resource_type, resource_id, idempotency_key)
         SELECT up.user_id, 'system_alert',
                'Unrouted candidate: No admin available',
                'Candidate ' || $1 || ' could not be assigned to any admin. All admins are at capacity or no admins exist.',
                'candidate', $1,
                'unrouted_' || $1 || '_' || up.user_id
         FROM user_profiles up WHERE up.role = 'oran_admin'
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [message.candidateId],
      );

      console.error(
        `[routeToAdmin] CRITICAL: No admin available for candidate ` +
          `${message.candidateId} — system alert sent`
      );
    }
  }

  // --- Audit event ---
  await stores.audit.append({
    eventId: crypto.randomUUID(),
    correlationId: message.correlationId,
    eventType: 'review.assigned',
    actorType: 'system',
    actorId: 'route-to-admin-function',
    targetType: 'candidate',
    targetId: message.candidateId,
    timestamp: new Date().toISOString(),
    inputs: {
      confidenceTier: message.confidenceTier,
      confidenceScore: message.confidenceScore,
      verificationsPassed: message.verificationsPassed,
      verificationsTotal: message.verificationsTotal,
    },
    outputs: { assignmentsCreated, routingFallback },
    evidenceRefs: [],
  });
}
