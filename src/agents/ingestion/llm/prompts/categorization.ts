/**
 * Categorization Prompt
 *
 * Takes an extracted service and assigns taxonomy tags + a primary category.
 * Uses the ingestion category tags from `src/agents/ingestion/tags.ts`.
 *
 * The LLM should:
 *  - Identify the primary service type (food, housing, healthcare, etc.)
 *  - Report confidence per tag
 */

import type { CategorizationInput } from '../client';
import { ServiceCategorySchema } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

// ---------------------------------------------------------------------------
// Category definitions (from ServiceCategorySchema)
// ---------------------------------------------------------------------------

const CATEGORY_DEFINITIONS = `
## PRIMARY CATEGORIES (select ONE that best fits)
- food: Food assistance (pantries, meal programs, SNAP assistance, food banks)
- housing: Housing assistance (shelters, transitional housing, rent assistance, home repair)
- healthcare: Medical care (clinics, hospitals, dental, vision, specialty care)
- mental_health: Mental health services (counseling, therapy, psychiatric care)
- substance_use: Substance use treatment (detox, rehab, MAT, recovery support)
- legal: Legal services (civil legal aid, immigration, family law, criminal defense)
- employment: Employment services (job training, placement, career counseling, workforce development)
- childcare: Childcare services (daycare, preschool, after-school care)
- education: Education services (GED, tutoring, literacy, college prep)
- disability: Disability services (vocational rehab, independent living, assistive tech)
- transportation: Transportation assistance (bus passes, ride programs)
- utilities: Utility assistance (LIHEAP, bill payment, weatherization)
- financial: Financial assistance (emergency cash, rental assistance, bill help)
- domestic_violence: Domestic violence services (shelters, hotlines, advocacy)
- immigration: Immigration services (legal aid, resettlement support, ESL navigation)
- reentry: Reentry / post-incarceration support (housing, jobs, records)
- seniors: Senior services (aging programs, Medicare assistance, senior centers)
- youth: Youth services (mentoring, runaway/homeless youth)
- crisis: Crisis services (hotlines, mobile crisis, crisis stabilization)
- other: Services that don't fit other categories
`;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a service categorization engine for ORAN (Open Resource Access Network), a civic platform helping people locate social services.

## YOUR TASK
Given structured data about a service (extracted from a web page), assign:
1. A PRIMARY CATEGORY (exactly one from the list below)
2. Up to 5 SECONDARY CATEGORY tags (from the same list, if applicable)
3. A confidence score (0-100) for each tag

${CATEGORY_DEFINITIONS}

## RULES
1. Select exactly ONE primaryCategory — the single best fit for what this service primarily does.
2. Tags array should include the primary category PLUS any secondary categories that apply (max 5 total).
3. Confidence scores:
   - 90-100: Category is explicitly stated or obvious from description
   - 70-89: Category is strongly implied
   - 50-69: Category is partially applicable
   - Below 50: Don't include the tag
4. Include brief reasoning for any tag with confidence below 80.
5. If the service doesn't clearly fit any category, use "other" with low confidence.

## OUTPUT FORMAT
Respond with a single JSON object:
{
  "tags": [
    { "tag": "food", "confidence": 95, "reasoning": null },
    { "tag": "housing", "confidence": 72, "reasoning": "Provides emergency shelter but not housing itself" }
  ],
  "primaryCategory": "food"
}

Note:
- "tags" must be an array of objects with "tag" (from the category list), "confidence" (0-100), and optional "reasoning"
- "primaryCategory" must be exactly one of the category values
- Respond with ONLY the JSON object, no other text`;

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

function buildUserPrompt(input: CategorizationInput): string {
  const { service, categoryHints } = input;

  const parts: string[] = [];

  parts.push('# SERVICE TO CATEGORIZE');
  parts.push('');
  parts.push(`Organization: ${service.organizationName}`);
  parts.push(`Service Name: ${service.serviceName}`);
  parts.push(`Description: ${service.description}`);

  if (service.category) {
    parts.push(`Existing Category Hint: ${service.category}`);
  }

  if (service.websiteUrl) {
    parts.push(`Website: ${service.websiteUrl}`);
  }

  if (service.eligibility) {
    const elig = service.eligibility;
    const eligParts: string[] = [];
    if (elig.description) eligParts.push(`Description: ${elig.description}`);
    if (elig.ageMin != null || elig.ageMax != null) {
      eligParts.push(`Age: ${elig.ageMin ?? 'any'} - ${elig.ageMax ?? 'any'}`);
    }
    if (elig.incomeRequirement) eligParts.push(`Income: ${elig.incomeRequirement}`);
    if (elig.residencyRequirement) eligParts.push(`Residency: ${elig.residencyRequirement}`);
    if ((elig.documentationRequired?.length ?? 0) > 0) {
      eligParts.push(`Docs Required: ${elig.documentationRequired?.join(', ')}`);
    }
    if (eligParts.length > 0) {
      parts.push(`Eligibility: ${eligParts.join('; ')}`);
    }
  }

  if (service.applicationProcess) {
    parts.push(`Application Process: ${service.applicationProcess}`);
  }

  if (service.fees) {
    parts.push(`Fees: ${service.fees}`);
  }

  if (service.isRemoteService) {
    parts.push('Service Type: Remote/virtual');
  }

  if (service.serviceAreaDescription) {
    parts.push(`Service Area: ${service.serviceAreaDescription}`);
  }

  if ((service.languages?.length ?? 0) > 0) {
    parts.push(`Languages: ${service.languages?.join(', ')}`);
  }

  if (categoryHints && categoryHints.length > 0) {
    parts.push('');
    parts.push(`Category Hints (from source): ${categoryHints.join(', ')}`);
  }

  parts.push('');
  parts.push('Categorize this service based on the information above.');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build the chat messages array for a categorization call.
 * Ready to pass to `client.chat.completions.create({ messages })`.
 */
export function buildCategorizationMessages(input: CategorizationInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input) },
  ];
}

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/**
 * Get valid category values (for validation).
 */
export function getValidCategories(): string[] {
  return ServiceCategorySchema.options;
}
