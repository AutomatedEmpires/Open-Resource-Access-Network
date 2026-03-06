/**
 * ORAN Feedback Triage — Idea 14 (Phase 5)
 *
 * Uses gpt-4o-mini to classify seeker feedback comments into actionable categories.
 * Runs fire-and-forget after feedback is stored — never delays the response to the seeker.
 *
 * GUARANTEES:
 * - Only the comment text is sent — no session ID, user ID, service name, or PII.
 * - Fail-open: any error returns null (caller must not throw).
 * - Triage output is advisory; it informs admin queue prioritisation only.
 * - Maximum 100 tokens in the response to keep latency low.
 *
 * Requires env:
 *   AZURE_OPENAI_ENDPOINT  — Azure OpenAI (already wired for Idea 1)
 *   AZURE_OPENAI_KEY       — subscription key
 *   AZURE_OPENAI_DEPLOYMENT — deployment name (default: gpt-4o-mini)
 */

import { z } from 'zod';
import { trackAiEvent } from '@/services/telemetry/appInsights';

// ============================================================
// TYPES
// ============================================================

export const TRIAGE_CATEGORIES = [
  'record_outdated',
  'service_closed',
  'incorrect_phone',
  'incorrect_address',
  'incorrect_hours',
  'positive',
  'out_of_scope',
  'other',
] as const;

export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

export const TriageResultSchema = z.object({
  category: z.enum(TRIAGE_CATEGORIES),
  urgency: z.enum(['high', 'normal']),
  extractedFields: z.array(z.string().max(50)).max(5),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

// ============================================================
// CONSTANTS
// ============================================================

const REQUEST_TIMEOUT_MS = 8_000;
const API_VERSION = '2024-02-15-preview';
const MAX_TOKENS = 150;

const SYSTEM_PROMPT = `You are a triage assistant for ORAN, a civic service directory.
Classify seeker feedback comments into exactly one category and return ONLY a JSON object with:
- category: one of [record_outdated, service_closed, incorrect_phone, incorrect_address, incorrect_hours, positive, out_of_scope, other]
- urgency: "high" if the service may be closed or unreachable, otherwise "normal"
- extractedFields: array of field names mentioned (e.g. ["phone", "address", "hours"])

RULES:
1. Classify based on the comment text only — no other context.
2. "high" urgency: service_closed, incorrect_phone when caller said unreachable, record_outdated with closure mention.
3. Keep extractedFields to 1–3 field names maximum.
4. Return ONLY valid JSON — no markdown, no commentary.`;

// ============================================================
// HELPERS
// ============================================================

function getConfig(): { endpoint: string; key: string; deployment: string } | null {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini';
  if (!endpoint || !key) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), key, deployment };
}

export function isFeedbackTriageConfigured(): boolean {
  return getConfig() !== null;
}

// ============================================================
// CORE
// ============================================================

/**
 * Triages a single feedback comment.
 *
 * @param comment - The raw comment text from the seeker. MUST NOT contain PII.
 * @returns TriageResult or null if LLM is unavailable or comment is too short.
 */
export async function triageFeedback(comment: string): Promise<TriageResult | null> {
  const config = getConfig();
  if (!config) return null;

  // Skip comments too short to be meaningful
  if (comment.trim().length < 5) return null;

  const url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${API_VERSION}`;
  const t0 = Date.now();

  // Telemetry accumulator — written on success, read in finally block.
  // error_type is set on each early-exit path so App Insights queries can
  // distinguish timeout vs http_error vs parse/schema failures.
  let telemetry: Record<string, string | number | boolean> = {
    model: config.deployment,
    success: false,
    error_type: 'network_error',
  };

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': config.key,
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Classify this feedback comment:\n\n${comment.slice(0, 600)}` },
          ],
          temperature: 0.1,
          max_tokens: MAX_TOKENS,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return null; // telemetry: network_error (default)
    }

    if (!response.ok) {
      telemetry = { model: config.deployment, success: false, error_type: 'http_error', http_status: response.status };
      return null;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      telemetry = { model: config.deployment, success: false, error_type: 'parse_error' };
      return null;
    }

    const content = (
      data as { choices?: Array<{ message?: { content?: string } }> }
    ).choices?.[0]?.message?.content?.trim();

    if (!content) {
      telemetry = { model: config.deployment, success: false, error_type: 'empty_response' };
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      telemetry = { model: config.deployment, success: false, error_type: 'parse_error' };
      return null;
    }

    const result = TriageResultSchema.safeParse(parsed);
    if (!result.success) {
      telemetry = { model: config.deployment, success: false, error_type: 'schema_error' };
      return null;
    }

    telemetry = {
      model: config.deployment,
      success: true,
      category: result.data.category,
      urgency: result.data.urgency,
    };
    return result.data;
  } finally {
    void trackAiEvent('feedback_triage', {
      ...telemetry,
      duration_ms: Date.now() - t0,
    });
  }
}
