/**
 * 211 NDP → ORAN Canonical Normalizer.
 *
 * Converts 211 NDP source records (created by ndp211Connector) into
 * canonical entities via the normalizeSourceRecord bridge.
 *
 * The 211 NDP connector stores records with _211_* prefixed fields.
 * This module re-shapes those into the HSDS-aligned parsed_payload
 * that normalizeSourceRecord expects, then delegates to it.
 *
 * It also handles 211-specific enrichments:
 *  - Eligibility → ORAN population/situation tags
 *  - Fee type → ORAN cost tags
 *  - Languages → ORAN access tags
 *  - Service areas → ORAN service_areas
 */

import type { IngestionStores } from './stores';
import type { SourceRecordRow } from '@/db/schema';
import {
  normalizeSourceRecord,
  type NormalizationResult,
} from './normalizeSourceRecord';
import { resolveCrosswalks, type TaxonomyCode } from './taxonomyCrosswalkResolver';

// ── Types ─────────────────────────────────────────────────────

export interface Normalize211RecordOptions {
  stores: IngestionStores;
  sourceRecord: SourceRecordRow;
  trustTier?: string;
  /** If true, also run taxonomy crosswalk after normalization. */
  runCrosswalk?: boolean;
}

export interface Normalize211Result extends NormalizationResult {
  enrichments: {
    eligibilityTags: string[];
    costTags: string[];
    languageTags: string[];
    taxonomyCrosswalked: boolean;
    crosswalkDerivedTags: number;
    crosswalkUnmatchedCodes: number;
  };
}

// ── Eligibility → ORAN tag mapping ───────────────────────────

const ELIGIBILITY_TO_TAG: Record<string, { type: string; value: string }> = {
  veteran: { type: 'population', value: 'veterans' },
  senior: { type: 'population', value: 'seniors' },
  youth: { type: 'population', value: 'youth' },
  student: { type: 'population', value: 'students' },
  transgender: { type: 'population', value: 'lgbtq' },
  low_income: { type: 'situation', value: 'low_income' },
  homelessness: { type: 'situation', value: 'homeless' },
  victim_of_violence: { type: 'situation', value: 'domestic_violence' },
  crisis: { type: 'situation', value: 'crisis' },
  disability: { type: 'situation', value: 'disability' },
  uninsured: { type: 'situation', value: 'uninsured' },
  food_insecurity: { type: 'situation', value: 'food_insecurity' },
  medical_issue: { type: 'situation', value: 'medical_issue' },
};

function deriveEligibilityTags(
  eligibility: Record<string, unknown> | null | undefined,
): Array<{ type: string; value: string }> {
  if (!eligibility) return [];
  const types = eligibility['types'];
  if (!Array.isArray(types)) return [];
  return types
    .filter((t): t is string => typeof t === 'string')
    .map((t) => ELIGIBILITY_TO_TAG[t])
    .filter((t): t is { type: string; value: string } => !!t);
}

// ── Fee type → ORAN cost tag ─────────────────────────────────

function deriveCostTag(
  fees: Record<string, unknown> | null | undefined,
): string | null {
  if (!fees) return null;
  const feeType = fees['type'];
  if (feeType === 'no_fee') return 'free';
  if (feeType === 'partial_fee') return 'sliding_scale';
  if (feeType === 'full_fee') return 'fee_required';
  return null;
}

// ── Language → ORAN access tags ──────────────────────────────

function deriveLanguageTags(
  languages: Record<string, unknown> | null | undefined,
): string[] {
  if (!languages) return [];
  const codes = languages['codes'];
  if (!Array.isArray(codes)) return [];
  return codes
    .filter((c): c is string => typeof c === 'string' && c !== 'english')
    .map((c) => `language_${c}`);
}

// ── Per-service enrichment data extraction ───────────────────

interface ServiceEnrichmentData {
  eligibility: Record<string, unknown> | null;
  fees: Record<string, unknown> | null;
  languages: Record<string, unknown> | null;
  taxonomy: unknown[] | null;
}

/**
 * Extract enrichment data for each service in a source record.
 *
 * For child records (type:service), _211_* keys are at the top level.
 * For organization_bundles, data is nested under services[].
 */
function extractPerServiceEnrichments(
  sourceRecord: SourceRecordRow,
): ServiceEnrichmentData[] {
  const payload = (sourceRecord.parsedPayload ?? sourceRecord.rawPayload) as Record<string, unknown>;
  if (!payload) return [];

  if (sourceRecord.sourceRecordType === 'organization_bundle') {
    const services = (payload['services'] ?? []) as Record<string, unknown>[];
    return services.map((svc) => ({
      eligibility: (svc['eligibility'] ?? null) as Record<string, unknown> | null,
      fees: (svc['fees'] ?? null) as Record<string, unknown> | null,
      languages: (svc['languages'] ?? null) as Record<string, unknown> | null,
      taxonomy: Array.isArray(svc['taxonomy']) ? svc['taxonomy'] as unknown[] : null,
    }));
  }

  // Child service records have _211_* prefixed keys at top level
  return [{
    eligibility: (payload['_211_eligibility'] ?? null) as Record<string, unknown> | null,
    fees: (payload['_211_fees_detail'] ?? null) as Record<string, unknown> | null,
    languages: (payload['_211_languages'] ?? null) as Record<string, unknown> | null,
    taxonomy: Array.isArray(payload['_211_taxonomy']) ? payload['_211_taxonomy'] as unknown[] : null,
  }];
}

// ── Reshape 211 parsed_payload → HSDS-aligned ────────────────

/**
 * Map a single 211 camelCase service into HSDS snake_case keys.
 * Mirrors ndp211Connector's normalizeServicePayload mapping.
 */
function reshapeServiceEntry(svc: Record<string, unknown>): Record<string, unknown> {
  const phones = svc['phones'] as Array<Record<string, unknown>> | undefined;
  const mainPhone = phones?.find((p) => p['isMain']) ?? phones?.[0];
  const fees = svc['fees'] as Record<string, unknown> | undefined;
  const feeDescription =
    fees?.['type'] === 'no_fee' ? 'Free' :
      (fees?.['description'] as string) ?? null;

  return {
    name: svc['name'],
    alternate_name: Array.isArray(svc['alternateNames'])
      ? (svc['alternateNames'] as string[]).join('; ')
      : null,
    description: svc['description'],
    url: svc['url'],
    email: svc['email'],
    phone: mainPhone?.['number'] ?? null,
    status: (svc['meta'] as Record<string, unknown> | undefined)?.['status'] ?? 'active',
    interpretation_services: svc['interpretationServices'],
    application_process: svc['applicationProcess'],
    wait_time: svc['waitTime'],
    fees: feeDescription,
    _211_fees_detail: fees,
    _211_eligibility: svc['eligibility'],
    _211_documents: svc['documents'],
    _211_service_areas: svc['serviceAreas'],
    _211_languages: svc['languages'],
    _211_taxonomy: svc['taxonomy'],
    _211_meta: svc['meta'],
  };
}

/**
 * Map a single 211 camelCase location into HSDS snake_case keys.
 * Mirrors ndp211Connector's normalizeLocationPayload mapping.
 */
function reshapeLocationEntry(loc: Record<string, unknown>): Record<string, unknown> {
  const addrs = loc['addresses'] as Array<Record<string, unknown>> | undefined;
  const physAddr = addrs?.find((a) => a['type'] === 'physical') ?? addrs?.[0];
  return {
    name: loc['name'],
    alternate_name: Array.isArray(loc['alternateNames'])
      ? (loc['alternateNames'] as string[]).join('; ')
      : null,
    description: loc['description'],
    latitude: loc['latitude'],
    longitude: loc['longitude'],
    transportation: loc['transportation'],
    address_1: physAddr?.['street'] ?? null,
    city: physAddr?.['city'] ?? null,
    region: physAddr?.['state'] ?? null,
    postal_code: physAddr?.['postalCode'] ?? null,
    country: physAddr?.['country'] ?? 'US',
    _211_accessibility: loc['accessibility'],
    _211_languages: loc['languages'],
    _211_meta: loc['meta'],
  };
}

function reshape211Payload(
  record: SourceRecordRow,
): Record<string, unknown> {
  const payload = (record.parsedPayload ?? record.rawPayload) as Record<string, unknown>;
  if (!payload || typeof payload !== 'object') return {};

  // For organization_bundle type, reshape nested services/locations
  // from 211 camelCase to HSDS-aligned snake_case keys
  if (record.sourceRecordType === 'organization_bundle') {
    const services = Array.isArray(payload['services'])
      ? (payload['services'] as Record<string, unknown>[]).map(reshapeServiceEntry)
      : [];
    const locations = Array.isArray(payload['locations'])
      ? (payload['locations'] as Record<string, unknown>[]).map(reshapeLocationEntry)
      : [];

    return {
      name: payload['name'],
      alternate_name: Array.isArray(payload['alternateNames'])
        ? (payload['alternateNames'] as string[]).join('; ')
        : null,
      description: payload['description'],
      url: payload['url'],
      email: payload['email'],
      services,
      locations,
    };
  }

  // For pre-normalized child records (organization, service, location),
  // the ndp211Connector has already mapped 211 fields to HSDS-aligned keys.
  // Return as-is — normalizeSourceRecord will pick up name, description, etc.
  return payload;
}

// ── Main function ─────────────────────────────────────────────

/**
 * Normalize a 211 NDP source record into canonical ORAN entities.
 *
 * Typical usage: process `organization_bundle` records from ndp211Connector.
 * For per-type records (organization, service, location), it also works
 * but the bundle method is recommended for maximum fidelity.
 */
export async function normalize211SourceRecord(
  opts: Normalize211RecordOptions,
): Promise<Normalize211Result> {
  const { stores, sourceRecord, trustTier, runCrosswalk } = opts;

  // Reshape the 211-specific payload into HSDS-aligned structure
  const reshaped = reshape211Payload(sourceRecord);

  // Temporary mutation of parsed_payload for normalizeSourceRecord
  const patchedRecord: SourceRecordRow = {
    ...sourceRecord,
    parsedPayload: reshaped,
  };

  // Delegate to the generic normalizer
  const normResult = await normalizeSourceRecord({
    stores,
    sourceRecord: patchedRecord,
    trustTier,
  });

  // ── Post-normalization enrichments ────────────────────────
  const enrichments: Normalize211Result['enrichments'] = {
    eligibilityTags: [],
    costTags: [],
    languageTags: [],
    taxonomyCrosswalked: false,
    crosswalkDerivedTags: 0,
    crosswalkUnmatchedCodes: 0,
  };

  // Extract per-service enrichment data.
  // For child records: _211_* keys are at the top level.
  // For organization_bundles: data is nested under services[].
  const svcEnrichments = extractPerServiceEnrichments(sourceRecord);

  for (let i = 0; i < normResult.canonicalServiceIds.length; i++) {
    const svcId = normResult.canonicalServiceIds[i];
    const svcData = svcEnrichments[i] ?? svcEnrichments[0];
    if (!svcData) continue;

    const eligTags = deriveEligibilityTags(svcData.eligibility);
    enrichments.eligibilityTags.push(...eligTags.map((t) => `${t.type}:${t.value}`));

    const costTag = deriveCostTag(svcData.fees);
    if (costTag && !enrichments.costTags.includes(costTag)) {
      enrichments.costTags.push(costTag);
    }

    const langTags = deriveLanguageTags(svcData.languages);
    for (const lt of langTags) {
      if (!enrichments.languageTags.includes(lt)) enrichments.languageTags.push(lt);
    }

    // Apply tags to specific canonical service
    for (const { value } of eligTags) {
      await stores.tags.add({
        serviceId: svcId,
        tagType: 'audience',
        tagValue: value,
        tagConfidence: 80,
        assignedBy: 'system',
        evidenceRefs: [],
      });
    }
    if (costTag) {
      await stores.tags.add({
        serviceId: svcId,
        tagType: 'custom',
        tagValue: `cost:${costTag}`,
        tagConfidence: 90,
        assignedBy: 'system',
        evidenceRefs: [],
      });
    }
    for (const lt of langTags) {
      await stores.tags.add({
        serviceId: svcId,
        tagType: 'custom',
        tagValue: lt,
        tagConfidence: 90,
        assignedBy: 'system',
        evidenceRefs: [],
      });
    }

    // ── Per-service taxonomy crosswalk ─────────────────────
    if (runCrosswalk && svcData.taxonomy && svcData.taxonomy.length > 0) {
      const codes: TaxonomyCode[] = svcData.taxonomy
        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
        .filter((t) => t['taxonomyCode'])
        .map((t) => ({
          registryId: 'airs_211',
          code: String(t['taxonomyCode']),
        }));

      if (codes.length > 0) {
        const cwResult = await resolveCrosswalks({
          codes,
          entityType: 'canonical_service',
          entityId: svcId,
          sourceRecordId: sourceRecord.id,
          stores: {
            taxonomyCrosswalks: stores.taxonomyCrosswalks,
            canonicalConcepts: stores.canonicalConcepts,
            conceptTagDerivations: stores.conceptTagDerivations,
          },
        });
        enrichments.taxonomyCrosswalked = true;
        enrichments.crosswalkDerivedTags += cwResult.derivedTags.length;
        enrichments.crosswalkUnmatchedCodes += cwResult.unmatchedCodes.length;
      }
    }
  }

  return {
    ...normResult,
    enrichments,
  };
}
