/**
 * Chat LLM Summarizer
 *
 * Provides the `summarizeWithLLM` dependency for the chat orchestrator.
 * Uses Azure OpenAI gpt-4o-mini to narrate already-retrieved service records.
 *
 * CRITICAL CONSTRAINTS (non-negotiable per SSOT):
 * - The LLM receives ONLY already-retrieved records — it NEVER retrieves or ranks.
 * - The system prompt explicitly forbids inventing names, numbers, addresses, or eligibility.
 * - Eligibility disclaimer is always appended.
 * - Will NEVER add facts not present in the provided service data.
 * - Any LLM error is surfaced to the caller, which must fall back to the assembled message.
 */

import { AzureOpenAI } from 'openai';
import type { EnrichedService } from '@/domain/types';
import type { Intent } from './types';
import { ELIGIBILITY_DISCLAIMER, MAX_SERVICES_PER_RESPONSE } from '@/domain/constants';

// ---------------------------------------------------------------------------
// Client (lazy singleton — created once per process)
// ---------------------------------------------------------------------------

let _client: AzureOpenAI | null = null;

function getClient(): AzureOpenAI {
  if (_client) return _client;

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-07-01-preview';

  if (!endpoint || !apiKey) {
    throw new Error('Azure OpenAI is not configured (AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY missing)');
  }

  _client = new AzureOpenAI({ endpoint, apiKey, apiVersion });
  return _client;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/** Serialise a service record to a compact, factual text block for the prompt. */
function serviceToText(s: EnrichedService, idx: number): string {
  const parts: string[] = [`[${idx + 1}] ${s.service.name}`];
  if (s.service.description) parts.push(`  Description: ${s.service.description}`);
  if (s.organization.name) parts.push(`  Organization: ${s.organization.name}`);
  if (s.phones.length > 0) parts.push(`  Phone: ${s.phones[0].number}`);
  if (s.address) {
    const addr = [s.address.address1, s.address.city, s.address.stateProvince]
      .filter(Boolean).join(', ');
    if (addr) parts.push(`  Address: ${addr}`);
  }
  if (s.service.url) parts.push(`  Website: ${s.service.url}`);
  if (s.schedules.length > 0 && s.schedules[0].description) {
    parts.push(`  Hours: ${s.schedules[0].description}`);
  }
  if (s.eligibility && s.eligibility.length > 0 && s.eligibility[0].description) {
    parts.push(`  Eligibility: ${s.eligibility[0].description}`);
  }
  return parts.join('\n');
}

function buildMessages(
  services: EnrichedService[],
  intent: Intent
): Array<{ role: 'system' | 'user'; content: string }> {
  const capped = services.slice(0, MAX_SERVICES_PER_RESPONSE);
  const serviceBlock = capped.map(serviceToText).join('\n\n');
  const categoryLabel = intent.category.replace(/_/g, ' ');

  const system = `You are a helpful assistant for ORAN, a civic resource directory.
Your ONLY job is to write a concise, warm 2–4 sentence summary of the services listed below.

HARD RULES — you must follow these without exception:
1. Only mention information that is explicitly present in the service records provided.
2. Never invent, guess, or extrapolate phone numbers, addresses, eligibility criteria, hours, or service names.
3. Never guarantee eligibility. Use phrases like "may be available" or "may qualify".
4. Do not add resources, links, or services that are not in the list.
5. Keep the tone empathetic and concise — no more than 4 sentences.
6. Do not repeat the disclaimer — it is added automatically after your response.`;

  const user = `The user is looking for help with: ${categoryLabel}${intent.urgencyQualifier === 'urgent' ? ' (urgent)' : ''}.

Here are the ${capped.length} service record${capped.length !== 1 ? 's' : ''} retrieved from the database:

${serviceBlock}

Write a brief, factual summary of what was found.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Summarises already-retrieved services using gpt-4o-mini.
 * Call this ONLY with records already fetched from the DB — see orchestrator Stage 8.
 *
 * @throws if the LLM is unconfigured or returns an error (caller must handle / fall back)
 */
export async function summarizeWithLLM(
  services: EnrichedService[],
  intent: Intent
): Promise<string> {
  const client = getClient();
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini';
  const messages = buildMessages(services, intent);

  const response = await client.chat.completions.create({
    model: deployment,
    messages,
    max_tokens: 300,
    temperature: 0.2, // Low temperature — factual, deterministic
  });

  const content = response.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('LLM returned empty response');

  // Always append eligibility disclaimer — non-negotiable
  return `${content}\n\n${ELIGIBILITY_DISCLAIMER}`;
}
