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
// Handler stub
// ---------------------------------------------------------------------------

/**
 * When deployed as an Azure Function, this handler:
 * 1. Loads the candidate and its metadata
 * 2. Evaluates admin routing rules (jurisdiction, category, expertise)
 * 3. Creates admin assignments with deadlines
 * 4. Sends notifications to assigned admins
 * 5. Logs audit event for the routing decision
 *
 * Current status: STUB — routing logic lives in
 *   src/agents/ingestion/persistence/adminRoutingStore.ts
 *   src/agents/ingestion/persistence/adminAssignmentStore.ts
 */
export async function routeToAdmin(
  message: RouteQueueMessage
): Promise<void> {
  // TODO: Wire to actual routing logic
  //
  // Implementation outline:
  //   const db = getDrizzle();
  //   const stores = createIngestionStores(db);
  //
  //   const candidate = await stores.candidates.getById(message.candidateId);
  //   if (!candidate) return;
  //
  //   // Find matching routing rules
  //   const rules = await stores.adminRouting.listActive();
  //   const matchedRules = rules.filter(rule =>
  //     evaluateRoutingRule(rule, candidate)
  //   );
  //
  //   // Create assignments for matched admins
  //   for (const rule of matchedRules) {
  //     const dueDate = new Date();
  //     dueDate.setHours(dueDate.getHours() + (rule.slaHours ?? 72));
  //
  //     await stores.assignments.create({
  //       id: crypto.randomUUID(),
  //       candidateId: message.candidateId,
  //       assigneeId: rule.assignToUserId,
  //       assignedAt: new Date().toISOString(),
  //       dueAt: dueDate.toISOString(),
  //       status: 'pending',
  //     });
  //   }
  //
  //   // Audit event
  //   await stores.audit.append({
  //     eventId: crypto.randomUUID(),
  //     correlationId: message.correlationId,
  //     eventType: 'routing.assigned',
  //     actorType: 'system',
  //     actorId: 'route-to-admin-function',
  //     targetType: 'candidate',
  //     targetId: message.candidateId,
  //     timestamp: new Date().toISOString(),
  //     inputs: { confidenceTier: message.confidenceTier },
  //     outputs: { assignmentsCreated: matchedRules.length },
  //     evidenceRefs: [],
  //   });

  console.log(`[routeToAdmin] Routing candidate ${message.candidateId} — stub, no-op`);
}
