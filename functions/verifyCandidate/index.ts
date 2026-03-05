/**
 * verifyCandidate — Queue-triggered function.
 *
 * Receives a candidate from `ingestion-verify` queue,
 * runs an optional Phi-4 discrepancy check against the live source URL,
 * adjusts the confidence score, and enqueues to `ingestion-route`.
 *
 * Azure Function binding:
 *   trigger: queue  queueName: "ingestion-verify"
 *   output:  queue  queueName: "ingestion-route"
 *
 * Idea 4 — Foundry Integration: Phi-4-mini-instruct discrepancy detection.
 * When FOUNDRY_ENDPOINT + FOUNDRY_KEY are set, the function re-fetches the
 * source URL and uses Phi-4 to compare the extracted candidate fields against
 * the current page, applying a confidence penalty for significant mismatches.
 * Falls back gracefully to the input score when Foundry is not configured.
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
// Helpers
// ---------------------------------------------------------------------------

const DISCREPANCY_PENALTY = 20;
const MAX_PAGE_CHARS = 1800;

function scoreToTier(score: number): 'green' | 'yellow' | 'orange' | 'red' {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  if (score >= 40) return 'orange';
  return 'red';
}

/**
 * Calls Phi-4-mini-instruct via Azure AI Foundry to detect discrepancies
 * between the extracted candidate fields and the current live page text.
 * Returns a penalty (0–30) to subtract from the confidence score.
 *
 * Security note: candidate fields are user-visible public web data;
 * no PII beyond what's on the source page is included in the prompt.
 */
async function runPhi4DiscrepancyCheck(
  candidateFields: {
    organizationName: string;
    serviceName: string;
    phone?: string;
    websiteUrl?: string;
  },
  livePageText: string
): Promise<number> {
  const { AzureOpenAI } = await import('openai');

  const endpoint = process.env.FOUNDRY_ENDPOINT;
  const apiKey = process.env.FOUNDRY_KEY;
  const deployment =
    process.env.FOUNDRY_EXTRACT_DEPLOYMENT ?? 'phi-4-mini-instruct';

  if (!endpoint || !apiKey) return 0;

  const client = new AzureOpenAI({
    endpoint,
    apiKey,
    apiVersion: process.env.FOUNDRY_API_VERSION ?? '2024-08-01-preview',
  });

  const pageExcerpt = livePageText.slice(0, MAX_PAGE_CHARS);
  const systemMessage =
    'You are a data verification assistant. Compare an extracted service record ' +
    'with the current web page and identify factual discrepancies. ' +
    'Respond ONLY with valid JSON: {"discrepancy":true/false,"penalty":0-30,"reason":"..."}';
  const userMessage =
    `Extracted record:\n` +
    `  Organization: ${candidateFields.organizationName}\n` +
    `  Service: ${candidateFields.serviceName}\n` +
    (candidateFields.phone ? `  Phone: ${candidateFields.phone}\n` : '') +
    (candidateFields.websiteUrl ? `  Website: ${candidateFields.websiteUrl}\n` : '') +
    `\nCurrent page excerpt:\n${pageExcerpt}\n\n` +
    `Does the page contradict the extracted record? Reply with JSON only.`;

  const response = await client.chat.completions.create({
    model: deployment,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 120,
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content ?? '{}';

  try {
    const parsed = JSON.parse(raw) as { discrepancy?: boolean; penalty?: number };
    if (parsed.discrepancy === true) {
      const penalty = typeof parsed.penalty === 'number'
        ? Math.min(30, Math.max(0, Math.round(parsed.penalty)))
        : DISCREPANCY_PENALTY;
      return penalty;
    }
  } catch {
    // Malformed JSON — treat as no discrepancy
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Verifies a candidate by optionally checking the current live source page
 * against the extracted fields using Phi-4-mini-instruct. The confidence
 * score is penalised for detected factual discrepancies.
 *
 * Steps:
 *   1. Load candidate from store
 *   2. Count checklist items for pass/total metrics
 *   3. If FOUNDRY configured, re-fetch source URL and run Phi-4 discrepancy
 *   4. Update confidence score in store
 *   5. Enqueue RouteQueueMessage
 */
export async function verifyCandidate(
  message: VerifyQueueMessage
): Promise<RouteQueueMessage | null> {
  const { getDrizzle } = await import('@/services/db/drizzle');
  const { createIngestionStores } = await import(
    '@/agents/ingestion/persistence/storeFactory'
  );

  const db = getDrizzle();
  const stores = createIngestionStores(db);

  const candidate = await stores.candidates.getById(message.candidateId);
  if (!candidate) {
    console.warn(
      `[verifyCandidate] Candidate ${message.candidateId} not found`
    );
    return null;
  }

  // --- Checklist metrics (pass/total from existing checklist) ---
  const checklist = candidate.review?.checklist ?? [];
  const verificationsTotal = checklist.length;
  const verificationsPassed = checklist.filter(
    (item) => item.status === 'satisfied'
  ).length;

  // --- Phi-4 discrepancy check (Idea 4) ---
  let penalty = 0;

  if (process.env.FOUNDRY_ENDPOINT && process.env.FOUNDRY_KEY) {
    try {
      const { createPageFetcher, isFetchError, createHtmlTextExtractor } =
        await import('@/agents/ingestion/fetcher');

      const fetcher = createPageFetcher({ timeoutMs: 20_000 });
      const fetchResult = await fetcher.fetch(message.sourceUrl);

      if (!isFetchError(fetchResult) && fetchResult.body) {
        const extractor = createHtmlTextExtractor();
        const { text } = extractor.extract(fetchResult.body);

        penalty = await runPhi4DiscrepancyCheck(
          {
            organizationName: candidate.fields.organizationName,
            serviceName: candidate.fields.serviceName,
            phone: candidate.fields.phone,
            websiteUrl: candidate.fields.websiteUrl,
          },
          text
        );

        if (penalty > 0) {
          console.log(
            `[verifyCandidate] Phi-4 discrepancy penalty=${penalty} ` +
              `for candidate ${message.candidateId}`
          );
        }
      }
    } catch (err) {
      // Non-critical — discrepancy check failure does not block routing
      console.warn(
        `[verifyCandidate] Phi-4 discrepancy check failed (non-fatal): ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  const finalScore = Math.max(0, message.confidenceScore - penalty);
  const finalTier = scoreToTier(finalScore);

  // Persist updated score
  await stores.candidates.updateConfidenceScore(message.candidateId, finalScore);

  console.log(
    `[verifyCandidate] Candidate ${message.candidateId}: ` +
      `score ${message.confidenceScore} → ${finalScore} (tier=${finalTier}, ` +
      `checks=${verificationsPassed}/${verificationsTotal})`
  );

  return {
    candidateId: message.candidateId,
    correlationId: message.correlationId,
    confidenceScore: finalScore,
    confidenceTier: finalTier,
    verificationsPassed,
    verificationsTotal,
    enqueuedAt: new Date().toISOString(),
  };
}
