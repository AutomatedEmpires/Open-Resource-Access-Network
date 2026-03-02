/**
 * Extraction Prompt
 *
 * Converts cleaned page text into structured `ExtractionResult` JSON.
 * The prompt instructs the LLM to pull HSDS-aligned service data
 * (org name, service name, phones, address, eligibility, hours, etc.)
 * and report per-field confidence.
 *
 * RULES from copilot-instructions.md:
 *  - NO hallucinated facts: if a field isn't stated, omit it.
 *  - Eligibility caution: "may qualify", never "you qualify".
 *  - The LLM may only describe what is *on the page*.
 */

import type { ExtractionInput } from '../client';

// ---------------------------------------------------------------------------
// Types re-exported for convenience
// ---------------------------------------------------------------------------

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

// ---------------------------------------------------------------------------
// System prompt (stable across calls)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an HSDS (Human Services Data Specification) data-extraction engine for ORAN — a civic platform that helps people locate verified social services.

## YOUR TASK
Given the raw text content of a web page, extract every distinct service listed on the page into a structured JSON object.

## CRITICAL RULES
1. ONLY extract information explicitly stated on the page. NEVER invent names, phone numbers, addresses, URLs, hours, or eligibility criteria.
2. If a field is not mentioned or cannot be determined, OMIT it (do not guess).
3. One page may list MULTIPLE services under one organization — return each as a separate entry in the "services" array.
4. If the page describes an organization but no specific services, create ONE entry using the organization description as the service.
5. For eligibility, use cautious language: "may qualify" — never guarantee eligibility.
6. Phone numbers: preserve the exact format found on the page.
7. Addresses: use US conventions (line1, city, region/state abbreviation, postalCode).
8. Hours: use 24-hour HH:MM format (e.g., "08:00", "17:00").

## CONFIDENCE SCORING
For each field you extract, report a confidence score (0-100):
- 90-100: Field is explicitly and clearly stated.
- 70-89: Field is strongly implied or requires minor inference.
- 50-69: Field is partially stated or ambiguous.
- 0-49: Field is weakly inferred or uncertain (consider omitting).

Include a brief "reasoning" note for any confidence below 80.

## OUTPUT FORMAT
Respond with a single JSON object matching this schema exactly:
{
  "services": [
    {
      "organizationName": "string",
      "serviceName": "string",
      "description": "string",
      "category": "string (optional, broad category like 'food', 'housing', etc.)",
      "websiteUrl": "string (optional)",
      "phones": [{ "number": "string", "type": "voice|fax|tty|hotline|sms|unknown", "context": "string (optional)" }],
      "email": "string (optional)",
      "address": { "line1": "string", "line2": "string (optional)", "city": "string", "region": "string", "postalCode": "string", "country": "US" },
      "hours": [{ "dayOfWeek": "monday|tuesday|...|sunday", "opensAt": "HH:MM", "closesAt": "HH:MM", "is24Hours": false, "isClosed": false, "notes": "string (optional)" }],
      "eligibility": {
        "description": "string",
        "ageMin": null,
        "ageMax": null,
        "incomeRequirement": "string (optional)",
        "residencyRequirement": "string (optional)",
        "documentationRequired": [],
        "restrictions": []
      },
      "applicationProcess": "string (optional)",
      "fees": "string (optional)",
      "languages": ["en"],
      "isRemoteService": false,
      "serviceAreaDescription": "string (optional)"
    }
  ],
  "confidences": [
    {
      "organizationName": { "confidence": 95, "sourceSnippet": "exact text from page" },
      "serviceName": { "confidence": 90 },
      "description": { "confidence": 85 },
      "phones": { "confidence": 95, "sourceSnippet": "(555) 123-4567" }
    }
  ],
  "pageType": "service_listing|organization_home|contact_page|eligibility_page|unknown",
  "extractionNotes": "string (optional, any caveats about the extraction)"
}

The "services" and "confidences" arrays must be the same length (one confidence object per service).
Respond with ONLY the JSON object, no other text.`;

// ---------------------------------------------------------------------------
// User prompt (per-page)
// ---------------------------------------------------------------------------

function buildUserPrompt(input: ExtractionInput): string {
  const parts: string[] = [];

  parts.push(`SOURCE URL: ${input.sourceUrl}`);

  if (input.pageTitle) {
    parts.push(`PAGE TITLE: ${input.pageTitle}`);
  }

  if (input.sourceQuality) {
    const qualityMap = {
      official: 'Government / official source (higher baseline trust)',
      vetted: 'Vetted community source',
      quarantine: 'Unverified source (apply extra caution)',
    };
    parts.push(`SOURCE QUALITY: ${qualityMap[input.sourceQuality]}`);
  }

  if (input.pageHint && input.pageHint !== 'unknown') {
    parts.push(`PAGE TYPE HINT: ${input.pageHint}`);
  }

  parts.push('');
  parts.push('--- PAGE CONTENT ---');
  parts.push(input.content);
  parts.push('--- END PAGE CONTENT ---');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build the chat messages array for an extraction call.
 * Ready to pass to `client.chat.completions.create({ messages })`.
 */
export function buildExtractionMessages(input: ExtractionInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input) },
  ];
}
