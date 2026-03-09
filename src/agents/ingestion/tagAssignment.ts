/**
 * Tag assignment wiring — derives audience, program, geographic,
 * and source quality tags from source record metadata and taxonomy
 * crosswalk results.
 *
 * Called after normalisation to enrich canonical entities with
 * multi-dimensional tags beyond the basic category assignment.
 */

import type { ResourceTagType } from './tags';
import { ResourceTagTypeSchema } from './tags';

// ── Public types ──────────────────────────────────────────────

export interface TagAssignment {
  tagType: ResourceTagType;
  tagValue: string;
  tagConfidence: number;
  assignedBy: 'system';
  evidenceRefs: string[];
}

export interface AssignTagsInput {
  /** Parsed payload from source record. */
  payload: Record<string, unknown>;
  /** Source system trust tier. */
  trustTier: string;
  /** Tags already derived via taxonomy crosswalk. */
  crosswalkTags?: Array<{ tagType: string; tagValue: string; confidence: number }>;
  /** Source record ID for evidence references. */
  sourceRecordId?: string;
}

export interface AssignTagsResult {
  tags: TagAssignment[];
}

// ── Keyword → tag mappings ────────────────────────────────────

const AUDIENCE_KEYWORDS: Record<string, string> = {
  veteran: 'veteran',
  veterans: 'veteran',
  senior: 'senior',
  seniors: 'senior',
  elderly: 'senior',
  'older adult': 'senior',
  'older adults': 'senior',
  youth: 'youth',
  teen: 'youth',
  teenager: 'youth',
  teenagers: 'youth',
  child: 'youth',
  children: 'youth',
  adolescent: 'youth',
  adolescents: 'youth',
  family: 'family',
  families: 'family',
  immigrant: 'immigrant',
  immigrants: 'immigrant',
  refugee: 'immigrant',
  refugees: 'immigrant',
  'new american': 'immigrant',
  'new americans': 'immigrant',
  disabled: 'disabled',
  disability: 'disabled',
  disabilities: 'disabled',
  handicap: 'disabled',
  homeless: 'homeless',
  unhoused: 'homeless',
  houseless: 'homeless',
  'experiencing homelessness': 'homeless',
  pregnant: 'pregnant',
  prenatal: 'pregnant',
  'expecting mother': 'pregnant',
  'low income': 'low_income',
  'low-income': 'low_income',
  'below poverty': 'low_income',
};

const PROGRAM_KEYWORDS: Record<string, string> = {
  snap: 'snap',
  'food stamps': 'snap',
  'food stamp': 'snap',
  wic: 'wic',
  'women infants': 'wic',
  'section 8': 'section8',
  section8: 'section8',
  'housing choice voucher': 'section8',
  medicaid: 'medicaid',
  'medi-cal': 'medicaid',
  medicare: 'medicare',
  tanf: 'tanf',
  'temporary assistance': 'tanf',
  liheap: 'liheap',
  'energy assistance': 'liheap',
  chip: 'chip',
  "children's health insurance": 'chip',
  ssi: 'ssi',
  'supplemental security income': 'ssi',
  ssdi: 'ssdi',
  'social security disability': 'ssdi',
  'social security': 'social_security',
  'head start': 'head_start',
  'early head start': 'head_start',
};

const TRUST_TIER_TO_SOURCE_QUALITY: Record<string, string> = {
  verified_publisher: 'verified_source',
  curated: 'curated_source',
  community: 'community_source',
  quarantine: 'quarantine_source',
};

// ── Core logic ────────────────────────────────────────────────

function extractTextFields(payload: Record<string, unknown>): string {
  const fields = ['description', 'name', 'eligibility', 'fees',
    'interpretation_services', 'accreditations', 'licenses'];

  const parts: string[] = [];
  for (const f of fields) {
    const v = payload[f];
    if (typeof v === 'string') parts.push(v);
  }

  // Also check nested services array
  const services = payload.services;
  if (Array.isArray(services)) {
    for (const s of services) {
      if (typeof s === 'object' && s !== null) {
        for (const f of fields) {
          const v = (s as Record<string, unknown>)[f];
          if (typeof v === 'string') parts.push(v);
        }
      }
    }
  }

  return parts.join(' ').toLowerCase();
}

/** Compiled regex cache for keyword patterns. */
const keywordRegexCache = new Map<string, RegExp>();

function getKeywordRegex(keyword: string): RegExp {
  let regex = keywordRegexCache.get(keyword);
  if (!regex) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(`\\b${escaped}\\b`, 'i');
    keywordRegexCache.set(keyword, regex);
  }
  return regex;
}

function matchKeywords(
  text: string,
  keywords: Record<string, string>,
  tagType: ResourceTagType,
  confidence: number,
  evidence: string[]
): TagAssignment[] {
  const matched = new Set<string>();
  const results: TagAssignment[] = [];

  for (const [keyword, tagValue] of Object.entries(keywords)) {
    if (matched.has(tagValue)) continue;
    const regex = getKeywordRegex(keyword);
    if (regex.test(text)) {
      matched.add(tagValue);
      results.push({
        tagType,
        tagValue,
        tagConfidence: confidence,
        assignedBy: 'system',
        evidenceRefs: evidence,
      });
    }
  }

  return results;
}

function deriveGeographicTags(
  payload: Record<string, unknown>,
  evidence: string[]
): TagAssignment[] {
  const tags: TagAssignment[] = [];

  // Extract from addresses in payload
  const addresses = payload.addresses ?? payload.physical_address ?? payload.address;
  const addressList = Array.isArray(addresses) ? addresses : addresses ? [addresses] : [];

  const seenValues = new Set<string>();

  for (const addr of addressList) {
    if (typeof addr !== 'object' || addr === null) continue;
    const a = addr as Record<string, unknown>;

    const locality = typeof a.city === 'string' ? a.city : typeof a.locality === 'string' ? a.locality : null;
    const region = typeof a.state === 'string' ? a.state : typeof a.state_province === 'string' ? a.state_province : typeof a.region === 'string' ? a.region : null;
    const postalCode = typeof a.postal_code === 'string' ? a.postal_code : typeof a.zip === 'string' ? a.zip : null;

    if (locality && !seenValues.has(locality.toLowerCase())) {
      seenValues.add(locality.toLowerCase());
      tags.push({ tagType: 'geographic', tagValue: locality.toLowerCase(), tagConfidence: 90, assignedBy: 'system', evidenceRefs: evidence });
    }
    if (region && !seenValues.has(region.toLowerCase())) {
      seenValues.add(region.toLowerCase());
      tags.push({ tagType: 'geographic', tagValue: region.toLowerCase(), tagConfidence: 90, assignedBy: 'system', evidenceRefs: evidence });
    }
    if (postalCode && !seenValues.has(postalCode)) {
      seenValues.add(postalCode);
      tags.push({ tagType: 'geographic', tagValue: postalCode, tagConfidence: 95, assignedBy: 'system', evidenceRefs: evidence });
    }
  }

  return tags;
}

// ── Main entry point ──────────────────────────────────────────

export function assignTags(input: AssignTagsInput): AssignTagsResult {
  const { payload, trustTier, crosswalkTags = [], sourceRecordId } = input;
  const evidence = sourceRecordId ? [`source_record:${sourceRecordId}`] : [];
  const tags: TagAssignment[] = [];

  // 1. Add crosswalk-derived tags (already computed) — validate tagType
  for (const ct of crosswalkTags) {
    const parsed = ResourceTagTypeSchema.safeParse(ct.tagType);
    if (!parsed.success) continue; // skip unrecognised tag types
    tags.push({
      tagType: parsed.data,
      tagValue: ct.tagValue,
      tagConfidence: ct.confidence,
      assignedBy: 'system',
      evidenceRefs: evidence,
    });
  }

  // 2. Extract text fields for keyword matching
  const text = extractTextFields(payload);

  // 3. Audience tags
  tags.push(...matchKeywords(text, AUDIENCE_KEYWORDS, 'audience', 60, evidence));

  // 4. Program tags
  tags.push(...matchKeywords(text, PROGRAM_KEYWORDS, 'program', 65, evidence));

  // 5. Geographic tags
  tags.push(...deriveGeographicTags(payload, evidence));

  // 6. Source quality tag
  const sqTag = TRUST_TIER_TO_SOURCE_QUALITY[trustTier];
  if (sqTag) {
    tags.push({
      tagType: 'source_quality',
      tagValue: sqTag,
      tagConfidence: 100,
      assignedBy: 'system',
      evidenceRefs: evidence,
    });
  }

  // 7. Deduplicate: keep highest confidence per (tagType, tagValue)
  const deduped = new Map<string, TagAssignment>();
  for (const tag of tags) {
    const key = `${tag.tagType}::${tag.tagValue}`;
    const existing = deduped.get(key);
    if (!existing || tag.tagConfidence > existing.tagConfidence) {
      deduped.set(key, tag);
    }
  }

  return { tags: Array.from(deduped.values()) };
}
