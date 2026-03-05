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
    outputs: { assignmentsCreated },
    evidenceRefs: [],
  });
}
