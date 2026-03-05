/**
 * Azure AI Content Safety — Crisis Detection Second Layer
 *
 * Provides semantic crisis detection as a second gate after keyword matching.
 * Catches indirect, metaphorical, and culturally varied self-harm language that
 * a keyword list cannot — e.g., "I don't see a way out" or "nobody would miss me".
 *
 * Design constraints (all must hold):
 *  1. FAIL-OPEN: any API error returns false — never blocks legitimate crisis routing.
 *  2. KEYWORD GATE IS STILL FIRST: this module only runs after the keyword check misses.
 *  3. PRE-FILTER: a free local distress-signal check gates the API call to minimize cost.
 *  4. NO PII LOGGED: message content is never written to logs/telemetry.
 *  5. FEATURE FLAG: caller is responsible for checking FEATURE_FLAGS.CONTENT_SAFETY_CRISIS.
 *
 * Cost model:
 *  Azure AI Content Safety F0 free tier: 5,000 text records/month.
 *  With the pre-filter, expected API calls are <5% of total chat messages.
 *  At S0 pricing ($1.00/1K records) the cost is negligible until significant traffic.
 *
 * Configuration (environment variables):
 *  AZURE_CONTENT_SAFETY_ENDPOINT — required; e.g. https://my-resource.cognitiveservices.azure.com
 *  AZURE_CONTENT_SAFETY_KEY      — required; subscription key for the resource
 */

// ---------------------------------------------------------------------------
// Pre-filter: distress signals NOT covered by CRISIS_KEYWORDS
//
// These are indirect, first-person, or metaphorical phrases that suggest a
// person may be in crisis without matching the explicit keyword list.
// Their presence alone does NOT trigger crisis routing — only gates a Content
// Safety API call, which makes the final determination.
//
// Expand this list conservatively. Every addition increases API call rate.
// ---------------------------------------------------------------------------

export const CRISIS_DISTRESS_SIGNALS: readonly string[] = [
  // Hopelessness / no future
  'feel hopeless',
  'feels hopeless',
  'feeling hopeless',
  'no hope left',
  'lost all hope',
  'all hope is gone',
  'no hope anymore',

  // Indirect self-harm / disappearing
  'want to disappear',
  'feel like disappearing',
  'wish i wasn\'t here',
  'wish i wasn\'t alive',
  'wish i was dead',
  'tired of living',
  'tired of being alive',
  'don\'t want to exist',
  'think about hurting',
  'thoughts of hurting',
  'thoughts of ending',

  // Worthlessness / burden signals
  'nobody would miss me',
  'nobody cares if i',
  'world is better without me',
  'better off without me',
  'i\'m just a burden',
  'everyone would be better',

  // Giving up / no way forward
  'given up on life',
  'giving up on life',
  'nothing to live for',
  'no reason to keep going',
  'no reason to stay',
  'can\'t do this anymore',
  'can\'t keep going',
  'can\'t take it anymore',
  'don\'t see a way out',
  'no way out',
  'no way forward',

  // Overwhelm / breaking point
  'at my breaking point',
  'reached my breaking point',
  'can\'t go on like this',
  'don\'t know how much more i can take',
  'don\'t know how much longer',
  'completely lost',
  'lost the will',
] as const;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ContentSafetyAnalysisItem {
  category: string;
  severity: number; // 0 | 2 | 4 | 6
}

interface ContentSafetyResponseBody {
  categoriesAnalysis: ContentSafetyAnalysisItem[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONTENT_SAFETY_API_VERSION = '2023-10-01';

/**
 * Minimum SelfHarm severity score to trigger crisis routing.
 * Azure severity levels: 0 = safe, 2 = low, 4 = medium, 6 = high.
 * We route at medium+ (4) to minimize false negatives.
 */
const SELF_HARM_CRISIS_THRESHOLD = 4;

/** Hard timeout for Content Safety API calls — must not block chat responses. */
const CONTENT_SAFETY_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fast synchronous pre-check for indirect distress signals.
 *
 * Returns true if the message contains ANY phrase from CRISIS_DISTRESS_SIGNALS.
 * A true result does NOT mean crisis — it gates the async API call.
 * A false result means skip the API entirely (cost saving).
 */
export function hasDistressSignals(message: string): boolean {
  const normalized = message.toLowerCase();
  return CRISIS_DISTRESS_SIGNALS.some((signal) => normalized.includes(signal));
}

/**
 * Calls Azure AI Content Safety to detect SelfHarm severity in a message.
 *
 * Returns true if SelfHarm severity >= SELF_HARM_CRISIS_THRESHOLD (medium+).
 * Returns false on ANY error — FAIL-OPEN by design (see module docstring).
 * Returns false immediately if AZURE_CONTENT_SAFETY_ENDPOINT is not configured.
 *
 * Usage — always pre-filter with hasDistressSignals() to minimize API cost:
 *
 *   if (hasDistressSignals(message)) {
 *     const isCrisis = await checkCrisisContentSafety(message);
 *     if (isCrisis) { ... }
 *   }
 */
export async function checkCrisisContentSafety(message: string): Promise<boolean> {
  const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT?.trim();
  const key = process.env.AZURE_CONTENT_SAFETY_KEY?.trim();

  // Not configured — no-op, do not warn (expected in dev without the resource)
  if (!endpoint || !key) {
    return false;
  }

  const url = `${endpoint.replace(/\/+$/, '')}/contentsafety/text:analyze?api-version=${CONTENT_SAFETY_API_VERSION}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': key,
      },
      body: JSON.stringify({
        text: message,
        outputType: 'FourSeverityLevels',
        categories: ['SelfHarm'],
      }),
      signal: AbortSignal.timeout(CONTENT_SAFETY_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Non-2xx: log the status code but NOT the message content (PII rule)
      console.warn(`[contentSafety] API returned HTTP ${response.status} — failing open`);
      return false;
    }

    const data = (await response.json()) as ContentSafetyResponseBody;

    const selfHarm = data.categoriesAnalysis.find((c) => c.category === 'SelfHarm');
    if (!selfHarm) {
      return false;
    }

    return selfHarm.severity >= SELF_HARM_CRISIS_THRESHOLD;
  } catch {
    // Network error, timeout, JSON parse failure — fail-open
    // Intentionally not logging message content
    return false;
  }
}
