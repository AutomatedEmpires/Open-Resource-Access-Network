/**
 * ORAN LLM Tagging Prompt Generator
 *
 * Generates prompts for LLM agents to extract structured tags from
 * unstructured service descriptions. This enables automated ingestion
 * of resources from scraped websites, PDFs, or manual text entry.
 *
 * IMPORTANT: All extracted tags must be validated against the canonical
 * taxonomy in src/domain/taxonomy.ts before database insertion.
 */

import {
  SERVICE_ATTRIBUTES_TAXONOMY,
  SERVICE_ADAPTATIONS_TAXONOMY,
  DIETARY_OPTIONS_TAXONOMY,
  TRANSIT_ACCESS_TAXONOMY,
  LOCATION_ACCESSIBILITY_TAXONOMY,
  CAPACITY_STATUS_OPTIONS,
  PARKING_OPTIONS,
  DIETARY_AVAILABILITY_OPTIONS,
  getValidAttributeTags,
  getValidAdaptationTags,
  getValidDietaryTypes,
  getValidTransitTags,
  isValidTag,
} from '@/domain/taxonomy';

// ============================================================
// TYPES
// ============================================================

export interface ExtractedServiceTags {
  delivery: string[];
  cost: string[];
  access: string[];
  culture: string[];
  population: string[];
  situation: string[];
}

export interface ExtractedAdaptation {
  type: 'disability' | 'health_condition' | 'age_group' | 'learning';
  tag: string;
  details?: string;
}

export interface ExtractedDietaryOption {
  type: string;
  availability: 'always' | 'by_request' | 'limited' | 'seasonal';
  details?: string;
}

export interface ExtractedLocationInfo {
  accessibility: string[];
  transitAccess: string[];
  parking: 'yes' | 'no' | 'street_only' | 'paid' | 'unknown';
}

export interface ExtractedServiceInfo {
  estimatedWaitDays: number | null;
  capacityStatus: 'available' | 'limited' | 'waitlist' | 'closed' | null;
}

export interface ExtractedEligibility {
  householdSizeMin: number | null;
  householdSizeMax: number | null;
  incomePctFpl: number | null;
  ageMin: number | null;
  ageMax: number | null;
}

export interface FullTagExtractionResult {
  serviceAttributes: ExtractedServiceTags;
  adaptations: ExtractedAdaptation[];
  dietary: ExtractedDietaryOption[];
  location: ExtractedLocationInfo;
  service: ExtractedServiceInfo;
  eligibility: ExtractedEligibility;
  languages: string[];
  confidence: number; // 0-100 overall confidence in extraction (matches ORAN standard)
  warnings: string[]; // Things the LLM wasn't sure about
}

// ============================================================
// PROMPT GENERATION
// ============================================================

/**
 * Generate a compact taxonomy reference for the LLM prompt.
 * Includes only tag names and brief descriptions, not full definitions.
 */
function generateTaxonomyReference(): string {
  const sections: string[] = [];

  // Service Attributes
  for (const [taxonomy, def] of Object.entries(SERVICE_ATTRIBUTES_TAXONOMY)) {
    const tags = def.tags.map(t => `${t.tag}: ${t.description}`).join('\n  ');
    sections.push(`### ${taxonomy.toUpperCase()} (${def.question})\n  ${tags}`);
  }

  // Service Adaptations
  sections.push('\n## SERVICE ADAPTATIONS (service-level accommodations, NOT building access)');
  for (const [type, def] of Object.entries(SERVICE_ADAPTATIONS_TAXONOMY)) {
    const tags = def.tags.map(t => `${t.tag}: ${t.description}`).join('\n  ');
    sections.push(`### ${type}\n  ${tags}`);
  }

  // Dietary
  const dietaryTags = DIETARY_OPTIONS_TAXONOMY.tags.map(t => `${t.tag}: ${t.description}`).join('\n  ');
  sections.push(`\n## DIETARY OPTIONS (food services only)\n  ${dietaryTags}`);

  // Location Accessibility
  const accessTags = LOCATION_ACCESSIBILITY_TAXONOMY.tags.map(t => `${t.tag}: ${t.description}`).join('\n  ');
  sections.push(`\n## LOCATION ACCESSIBILITY (physical building features)\n  ${accessTags}`);

  // Transit
  const transitTags = TRANSIT_ACCESS_TAXONOMY.tags.map(t => `${t.tag}: ${t.description}`).join('\n  ');
  sections.push(`\n## TRANSIT ACCESS\n  ${transitTags}`);

  return sections.join('\n\n');
}

/**
 * Generate the main tagging prompt for the LLM.
 */
export function generateTaggingPrompt(rawServiceText: string): string {
  const taxonomyRef = generateTaxonomyReference();

  return `You are an expert data tagger for ORAN (Open Resource Access Network), a civic platform that helps people in crisis find social services.

Your task: Extract structured tags from the service description below. These tags determine who can find this service.

## CRITICAL RULES
1. ONLY output tags from the valid taxonomy lists below — never invent tags
2. Be CONSERVATIVE — only tag what is explicitly stated or strongly implied
3. Distinguish between SERVICE adaptations (how the service is delivered) vs LOCATION accessibility (building features)
4. If uncertain, note it in the warnings array
5. For dietary options, specify availability: always, by_request, limited, or seasonal

## SERVICE DESCRIPTION TO ANALYZE
"""
${rawServiceText}
"""

## VALID TAXONOMY (only use tags from this list)
${taxonomyRef}

## OUTPUT FORMAT (respond with valid JSON only)
\`\`\`json
{
  "serviceAttributes": {
    "delivery": ["tag1", "tag2"],
    "cost": ["tag1"],
    "access": ["tag1", "tag2"],
    "culture": ["tag1"],
    "population": ["tag1"],
    "situation": ["tag1"]
  },
  "adaptations": [
    { "type": "disability", "tag": "deaf", "details": "ASL interpreter available" }
  ],
  "dietary": [
    { "type": "halal", "availability": "by_request", "details": "With 24hr notice" }
  ],
  "location": {
    "accessibility": ["wheelchair", "accessible_restroom"],
    "transitAccess": ["bus_stop_nearby"],
    "parking": "yes"
  },
  "service": {
    "estimatedWaitDays": 7,
    "capacityStatus": "available"
  },
  "eligibility": {
    "householdSizeMin": null,
    "householdSizeMax": null,
    "incomePctFpl": 200,
    "ageMin": 18,
    "ageMax": null
  },
  "languages": ["en", "es", "vi"],
  "confidence": 85,
  "warnings": ["Unclear if they accept new clients"]
}
\`\`\`

Notes:
- Use ISO 639-1 language codes (en, es, zh, vi, ko, tl, ar, etc.)
- estimatedWaitDays: null if unknown, 0 for same-day
- incomePctFpl: percentage of Federal Poverty Level (e.g., 200 = 200% FPL)
- confidence: 0-100, how confident you are in overall extraction accuracy

Respond with ONLY the JSON object, no other text.`;
}

/**
 * Generate a simpler prompt for quick tagging (fewer dimensions).
 */
export function generateQuickTaggingPrompt(rawServiceText: string): string {
  return `Extract service tags from this description. Use ONLY these exact tags or leave arrays empty.

DESCRIPTION:
"""
${rawServiceText}
"""

VALID TAGS:
delivery: in_person, virtual, phone, mobile_outreach, home_delivery
cost: free, sliding_scale, medicaid, medicare, ebt_snap, no_insurance_required
access: walk_in, appointment_required, no_id_required, weekend_hours, same_day

Respond with JSON only:
\`\`\`json
{
  "delivery": [],
  "cost": [],
  "access": []
}
\`\`\``;
}

// ============================================================
// RESPONSE PARSING & VALIDATION
// ============================================================

/**
 * Parse LLM response JSON and validate against taxonomy.
 */
export function extractTagsFromResponse(llmResponse: string): FullTagExtractionResult | null {
  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = llmResponse.match(/```(?:json)?\s*([\s\S]*?)```/) ??
                    [null, llmResponse];
  const jsonStr = jsonMatch[1]?.trim();

  if (!jsonStr) {
    console.error('No JSON found in LLM response');
    return null;
  }

  let parsed: FullTagExtractionResult;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse LLM response as JSON:', e);
    return null;
  }

  // Validate and filter to only valid tags
  const validated = validateAndFilterTags(parsed);
  return validated;
}

/**
 * Validate extracted tags against the canonical taxonomy.
 * Removes any invalid tags and logs warnings.
 */
export function validateAndFilterTags(extracted: FullTagExtractionResult): FullTagExtractionResult {
  const warnings = [...(extracted.warnings ?? [])];

  // Validate service attributes
  const validatedAttributes: ExtractedServiceTags = {
    delivery: [],
    cost: [],
    access: [],
    culture: [],
    population: [],
    situation: [],
  };

  for (const taxonomy of Object.keys(validatedAttributes) as (keyof ExtractedServiceTags)[]) {
    const inputTags = extracted.serviceAttributes?.[taxonomy] ?? [];
    const validTags = getValidAttributeTags(taxonomy);

    for (const tag of inputTags) {
      if (validTags.includes(tag)) {
        validatedAttributes[taxonomy].push(tag);
      } else {
        warnings.push(`Invalid ${taxonomy} tag ignored: ${tag}`);
      }
    }
  }

  // Validate adaptations
  const validatedAdaptations: ExtractedAdaptation[] = [];
  for (const adaptation of extracted.adaptations ?? []) {
    const validTags = getValidAdaptationTags(adaptation.type);
    if (validTags.includes(adaptation.tag)) {
      validatedAdaptations.push(adaptation);
    } else {
      warnings.push(`Invalid ${adaptation.type} adaptation ignored: ${adaptation.tag}`);
    }
  }

  // Validate dietary options
  const validatedDietary: ExtractedDietaryOption[] = [];
  const validDietaryTypes = getValidDietaryTypes();
  const validAvailability = DIETARY_AVAILABILITY_OPTIONS.map(o => o.value);

  for (const diet of extracted.dietary ?? []) {
    if (validDietaryTypes.includes(diet.type)) {
      const availability = validAvailability.includes(diet.availability as typeof validAvailability[number])
        ? diet.availability
        : 'always'; // Default to always if invalid
      validatedDietary.push({ ...diet, availability });
    } else {
      warnings.push(`Invalid dietary type ignored: ${diet.type}`);
    }
  }

  // Validate location accessibility
  const validAccessibility = LOCATION_ACCESSIBILITY_TAXONOMY.tags.map(t => t.tag);
  const validTransit = getValidTransitTags();
  const validParking = PARKING_OPTIONS.map(o => o.value);

  const validatedLocation: ExtractedLocationInfo = {
    accessibility: (extracted.location?.accessibility ?? []).filter(t => {
      if (!validAccessibility.includes(t)) {
        warnings.push(`Invalid accessibility tag ignored: ${t}`);
        return false;
      }
      return true;
    }),
    transitAccess: (extracted.location?.transitAccess ?? []).filter(t => {
      if (!validTransit.includes(t)) {
        warnings.push(`Invalid transit tag ignored: ${t}`);
        return false;
      }
      return true;
    }),
    parking: validParking.includes(extracted.location?.parking as typeof validParking[number])
      ? extracted.location.parking
      : 'unknown',
  };

  // Validate capacity status
  const validCapacity = CAPACITY_STATUS_OPTIONS.map(o => o.value);
  const validatedService: ExtractedServiceInfo = {
    estimatedWaitDays: extracted.service?.estimatedWaitDays ?? null,
    capacityStatus: validCapacity.includes(extracted.service?.capacityStatus as typeof validCapacity[number])
      ? extracted.service.capacityStatus
      : null,
  };

  return {
    serviceAttributes: validatedAttributes,
    adaptations: validatedAdaptations,
    dietary: validatedDietary,
    location: validatedLocation,
    service: validatedService,
    eligibility: extracted.eligibility ?? {
      householdSizeMin: null,
      householdSizeMax: null,
      incomePctFpl: null,
      ageMin: null,
      ageMax: null,
    },
    languages: extracted.languages ?? [],
    confidence: extracted.confidence ?? 50,
    warnings,
  };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Check if the extracted tags are sufficient for a basic service listing.
 */
export function hasMinimumTags(extraction: FullTagExtractionResult): boolean {
  // At minimum, need at least one delivery method and one cost indicator
  return (
    extraction.serviceAttributes.delivery.length > 0 &&
    extraction.serviceAttributes.cost.length > 0
  );
}

/**
 * Generate a summary of what was extracted (for human review).
 */
export function summarizeExtraction(extraction: FullTagExtractionResult): string {
  const lines: string[] = [];

  const attrCounts = Object.entries(extraction.serviceAttributes)
    .filter(([, tags]) => tags.length > 0)
    .map(([k, v]) => `${k}: ${v.length}`);
  if (attrCounts.length > 0) {
    lines.push(`Service attributes: ${attrCounts.join(', ')}`);
  }

  if (extraction.adaptations.length > 0) {
    lines.push(`Adaptations: ${extraction.adaptations.map(a => `${a.type}:${a.tag}`).join(', ')}`);
  }

  if (extraction.dietary.length > 0) {
    lines.push(`Dietary: ${extraction.dietary.map(d => d.type).join(', ')}`);
  }

  if (extraction.location.accessibility.length > 0) {
    lines.push(`Accessibility: ${extraction.location.accessibility.join(', ')}`);
  }

  if (extraction.languages.length > 0) {
    lines.push(`Languages: ${extraction.languages.join(', ')}`);
  }

  lines.push(`Confidence: ${Math.round(extraction.confidence)}%`);

  if (extraction.warnings.length > 0) {
    lines.push(`Warnings: ${extraction.warnings.length}`);
  }

  return lines.join('\n');
}

// ============================================================
// EXPORT FOR HOST PORTAL
// ============================================================

/**
 * Get all taxonomies formatted for a dropdown/autocomplete UI.
 * Useful for the Host Portal where organizations manually tag services.
 */
export function getTaxonomyOptionsForUI() {
  return {
    delivery: SERVICE_ATTRIBUTES_TAXONOMY.delivery.tags.map(t => ({
      value: t.tag,
      label: t.tag.replace(/_/g, ' '),
      description: t.description,
      common: t.common ?? false,
    })),
    cost: SERVICE_ATTRIBUTES_TAXONOMY.cost.tags.map(t => ({
      value: t.tag,
      label: t.tag.replace(/_/g, ' '),
      description: t.description,
      common: t.common ?? false,
    })),
    access: SERVICE_ATTRIBUTES_TAXONOMY.access.tags.map(t => ({
      value: t.tag,
      label: t.tag.replace(/_/g, ' '),
      description: t.description,
      common: t.common ?? false,
    })),
    culture: SERVICE_ATTRIBUTES_TAXONOMY.culture.tags.map(t => ({
      value: t.tag,
      label: t.tag.replace(/_/g, ' '),
      description: t.description,
      common: t.common ?? false,
    })),
    population: SERVICE_ATTRIBUTES_TAXONOMY.population.tags.map(t => ({
      value: t.tag,
      label: t.tag.replace(/_/g, ' '),
      description: t.description,
      common: t.common ?? false,
    })),
    situation: SERVICE_ATTRIBUTES_TAXONOMY.situation.tags.map(t => ({
      value: t.tag,
      label: t.tag.replace(/_/g, ' '),
      description: t.description,
      common: t.common ?? false,
    })),
    dietary: DIETARY_OPTIONS_TAXONOMY.tags.map(t => ({
      value: t.tag,
      label: t.tag.replace(/_/g, ' '),
      description: t.description,
      common: t.common ?? false,
    })),
    locationAccessibility: LOCATION_ACCESSIBILITY_TAXONOMY.tags.map(t => ({
      value: t.tag,
      label: t.tag.replace(/_/g, ' '),
      description: t.description,
      common: t.common ?? false,
    })),
    transit: TRANSIT_ACCESS_TAXONOMY.tags.map(t => ({
      value: t.tag,
      label: t.tag.replace(/_/g, ' '),
      description: t.description,
      common: t.common ?? false,
    })),
    adaptations: {
      disability: SERVICE_ADAPTATIONS_TAXONOMY.disability.tags.map(t => ({ value: t.tag, label: t.tag.replace(/_/g, ' '), description: t.description })),
      health_condition: SERVICE_ADAPTATIONS_TAXONOMY.health_condition.tags.map(t => ({ value: t.tag, label: t.tag.replace(/_/g, ' '), description: t.description })),
      age_group: SERVICE_ADAPTATIONS_TAXONOMY.age_group.tags.map(t => ({ value: t.tag, label: t.tag.replace(/_/g, ' '), description: t.description })),
      learning: SERVICE_ADAPTATIONS_TAXONOMY.learning.tags.map(t => ({ value: t.tag, label: t.tag.replace(/_/g, ' '), description: t.description })),
    },
    capacityStatus: CAPACITY_STATUS_OPTIONS.map(o => ({ value: o.value, label: o.value, description: o.description })),
    parking: PARKING_OPTIONS.map(o => ({ value: o.value, label: o.value, description: o.description })),
    dietaryAvailability: DIETARY_AVAILABILITY_OPTIONS.map(o => ({ value: o.value, label: o.value, description: o.description })),
  };
}
