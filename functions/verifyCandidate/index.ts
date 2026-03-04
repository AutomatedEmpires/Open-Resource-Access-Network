/**
 * verifyCandidate — Queue-triggered function.
 *
 * Receives a candidate from `ingestion-verify` queue,
 * runs automated verification checks (phone, address, URL, license),
 * updates the candidate's confidence score, and enqueues to `ingestion-route`.
 *
 * Azure Function binding:
 *   trigger: queue  queueName: "ingestion-verify"
 *   output:  queue  queueName: "ingestion-route"
 *
 * @module functions/verifyCandidate
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerifyQueueMessage {
  candidateId: string;
  sourceUrl: string;
  correlationId: string;
  confidenceScore: number;
  confidenceTier: string;
  enqueuedAt: string;
}

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
 * 1. Loads the candidate and its extracted fields
 * 2. Runs verification checks (phone validation, address geocoding, URL liveness, etc.)
 * 3. Records check results in the verification_checks store
 * 4. Updates candidate confidence score based on verification results
 * 5. Enqueues to `ingestion-route` for admin routing
 *
 * Current status: STUB — verification logic lives in
 *   src/agents/ingestion/pipeline/stages/verify.ts
 */
export async function verifyCandidate(
  message: VerifyQueueMessage
): Promise<RouteQueueMessage | null> {
  // TODO: Wire to actual verification pipeline
  //
  // Implementation outline:
  //   const db = getDrizzle();
  //   const stores = createIngestionStores(db);
  //
  //   const candidate = await stores.candidates.getById(message.candidateId);
  //   if (!candidate) return null;
  //
  //   // Run verification checks
  //   const checks = [
  //     { type: 'url_liveness', field: 'websiteUrl' },
  //     { type: 'phone_format', field: 'phone' },
  //     { type: 'address_geocode', field: 'address' },
  //   ];
  //
  //   let passed = 0;
  //   for (const check of checks) {
  //     const result = await runVerificationCheck(candidate, check);
  //     await stores.checks.create({
  //       id: crypto.randomUUID(),
  //       candidateId: message.candidateId,
  //       checkType: check.type,
  //       status: result.passed ? 'passed' : 'failed',
  //       details: result.details,
  //       checkedAt: new Date().toISOString(),
  //     });
  //     if (result.passed) passed++;
  //   }
  //
  //   return {
  //     candidateId: message.candidateId,
  //     correlationId: message.correlationId,
  //     confidenceScore: message.confidenceScore,
  //     confidenceTier: message.confidenceTier,
  //     verificationsPassed: passed,
  //     verificationsTotal: checks.length,
  //     enqueuedAt: new Date().toISOString(),
  //   };

  console.log(`[verifyCandidate] Verifying candidate ${message.candidateId} — stub, no-op`);
  return null;
}
