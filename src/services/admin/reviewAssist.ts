/**
 * ORAN Admin Review Assist — Idea 7 (Phase 5)
 *
 * Uses gpt-4o-mini to pre-check candidate service records during admin review.
 * Returns a completeness score, warnings, and field-level suggestions.
 *
 * GUARANTEES:
 * - Advisory only — output displayed to admins, never triggers auto-approve.
 * - Only service record metadata is sent — no seeker PII, no session data.
 * - Fail-open: any error throws so callers can catch and surface gracefully.
 * - LLM cannot invent new field values — it only assesses what's already provided.
 *
 * Requires env:
 *   AZURE_OPENAI_ENDPOINT  — Azure OpenAI (already wired for Idea 1)
 *   AZURE_OPENAI_KEY       — subscription key
 *   AZURE_OPENAI_DEPLOYMENT — deployment name (default: gpt-4o-mini)
 */

import { z } from 'zod';
import { trackEvent } from '@/services/telemetry/appInsights';

// ============================================================
// TYPES
// ============================================================

const ReviewSuggestionSchema = z.object({
  field: z.string().max(50),
  suggestion: z.string().max(300),
});

export const ReviewAssistResultSchema = z.object({
  completenessScore: z.number().int().min(0).max(100),
  warnings: z.array(z.string().max(200)).max(5),
  suggestions: z.array(ReviewSuggestionSchema).max(5),
  model: z.string(),
});

export type ReviewAssistResult = z.infer<typeof ReviewAssistResultSchema>;

export interface CandidateForReview {
  id: string;
  serviceName?: string | null;
  description?: string | null;
  organizationName?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressRegion?: string | null;
  addressPostalCode?: string | null;
  hours?: string | null;
  eligibility?: string | null;
  fees?: string | null;
  tags?: string[];
  confidenceScore?: number | null;
}

// ============================================================
// CONSTANTS
// ============================================================

const REQUEST_TIMEOUT_MS = 10_000;
const API_VERSION = '2024-02-15-preview';
const MAX_TOKENS = 500;

const SYSTEM_PROMPT = `You are an expert quality-assurance reviewer for ORAN, a civic resource directory.
Review the service candidate record below and return ONLY a JSON object with:
- completenessScore: integer 0–100 estimating overall quality and completeness
- warnings: array of up to 5 short warning strings for suspicious, missing, or inconsistent fields
- suggestions: array of up to 5 objects with {field, suggestion} for concrete improvements

RULES:
1. Only evaluate the provided fields — never invent new information.
2. Flag phone numbers that look invalid (all zeros, wrong length, missing area code).
3. Flag descriptions that are under 20 words, too vague, or purely promotional.
4. Flag missing critical HSDS fields: name, description, phone, address.
5. Keep each warning under 20 words.
6. Return ONLY valid JSON — no markdown, no commentary.`;

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

export function isReviewAssistConfigured(): boolean {
  return getConfig() !== null;
}

function buildCandidateText(c: CandidateForReview): string {
  const lines: string[] = [];
  if (c.serviceName)      lines.push(`Service Name: ${c.serviceName}`);
  if (c.description)      lines.push(`Description: ${c.description.slice(0, 500)}`);
  if (c.organizationName) lines.push(`Organization: ${c.organizationName}`);
  if (c.phone)            lines.push(`Phone: ${c.phone}`);
  if (c.websiteUrl)       lines.push(`Website: ${c.websiteUrl}`);

  const addrParts = [c.addressLine1, c.addressCity, c.addressRegion, c.addressPostalCode]
    .filter(Boolean).join(', ');
  if (addrParts) lines.push(`Address: ${addrParts}`);

  if (c.hours)       lines.push(`Hours: ${c.hours.slice(0, 200)}`);
  if (c.eligibility) lines.push(`Eligibility: ${c.eligibility.slice(0, 300)}`);
  if (c.fees)        lines.push(`Fees: ${c.fees}`);
  if (c.tags?.length) lines.push(`Tags: ${c.tags.join(', ')}`);
  if (c.confidenceScore != null) lines.push(`Current Confidence Score: ${c.confidenceScore}/100`);

  return lines.join('\n') || '(no fields provided)';
}

function getMissingFields(c: CandidateForReview): string[] {
  const required: Array<keyof CandidateForReview> = [
    'serviceName', 'description', 'phone', 'addressLine1',
  ];
  return required.filter((f) => !c[f]);
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Asks gpt-4o-mini to review a candidate service record.
 * Returns a ReviewAssistResult — advisory only.
 *
 * @throws if Azure OpenAI is unconfigured or returns an error.
 */
export async function reviewCandidateWithLLM(
  candidate: CandidateForReview,
): Promise<ReviewAssistResult> {
  const config = getConfig();
  if (!config) {
    throw new Error(
      'Azure OpenAI is not configured (AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY missing)',
    );
  }

  const candidateText = buildCandidateText(candidate);
  const missing = getMissingFields(candidate);
  const userContent = missing.length
    ? `${candidateText}\n\nMissing critical fields: ${missing.join(', ')}`
    : candidateText;

  const url =
    `${config.endpoint}/openai/deployments/${config.deployment}` +
    `/chat/completions?api-version=${API_VERSION}`;

  const t0 = Date.now();

  // Telemetry accumulator — updated on each exit path; emitted once in finally.
  // error_type lets App Insights queries filter by failure mode.
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
            { role: 'user', content: `Review this service record:\n\n${userContent}` },
          ],
          temperature: 0.1,
          max_tokens: MAX_TOKENS,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw err; // telemetry: network_error (default)
    }

    if (!response.ok) {
      telemetry = { model: config.deployment, success: false, error_type: 'http_error', http_status: response.status };
      throw new Error(`Azure OpenAI returned HTTP ${response.status} for review assist`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      telemetry = { model: config.deployment, success: false, error_type: 'empty_response' };
      throw new Error('Empty response from LLM review assist');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      telemetry = { model: config.deployment, success: false, error_type: 'parse_error' };
      throw new Error('LLM review assist returned invalid JSON');
    }

    const result = ReviewAssistResultSchema.safeParse({
      ...(parsed as object),
      model: config.deployment,
    });
    if (!result.success) {
      telemetry = { model: config.deployment, success: false, error_type: 'schema_error' };
      throw new Error('LLM review assist result failed schema validation');
    }

    telemetry = {
      model: config.deployment,
      success: true,
      completeness_score: result.data.completenessScore,
      warning_count: result.data.warnings.length,
    };
    return result.data;
  } finally {
    const durationMs = Date.now() - t0;
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(telemetry)) {
      if (v === undefined) continue;
      props[k] = String(v);
    }
    void trackEvent('review_assist', props, { duration_ms: durationMs });
  }
}
