/**
 * Taxonomy crosswalk resolver.
 *
 * Given a set of external taxonomy codes (e.g. AIRS/211 codes from an HSDS
 * feed), resolves them through crosswalk mappings to derive ORAN resource
 * tags and records the derivation audit trail.
 *
 * Flow:
 *  1. For each external code, look up crosswalks → canonical concepts.
 *  2. For each matched concept, resolve the ORAN taxonomy_term tag value.
 *  3. Record derivations in concept_tag_derivations for audit.
 */
import type {
  TaxonomyCrosswalkStore,
  CanonicalConceptStore,
  ConceptTagDerivationStore,
} from './stores';

// ── Public types ──────────────────────────────────────────────

export interface TaxonomyCode {
  registryId: string;
  code: string;
}

export interface DerivedTag {
  tagType: string;   // e.g. 'category'
  tagValue: string;  // e.g. 'food_pantry'
  conceptId: string;
  crosswalkId: string;
  confidence: number;
  matchType: string;
}

export interface ResolveCrosswalksOptions {
  codes: TaxonomyCode[];
  entityType: string;
  entityId: string;
  sourceRecordId?: string;
  stores: {
    taxonomyCrosswalks: TaxonomyCrosswalkStore;
    canonicalConcepts: CanonicalConceptStore;
    conceptTagDerivations: ConceptTagDerivationStore;
  };
}

export interface ResolveCrosswalksResult {
  derivedTags: DerivedTag[];
  unmatchedCodes: TaxonomyCode[];
  derivationsRecorded: number;
}

// ── Core resolver ─────────────────────────────────────────────

export async function resolveCrosswalks(
  opts: ResolveCrosswalksOptions
): Promise<ResolveCrosswalksResult> {
  const { codes, entityType, entityId, sourceRecordId, stores } = opts;

  const derivedTags: DerivedTag[] = [];
  const unmatchedCodes: TaxonomyCode[] = [];
  const derivationRows: Parameters<ConceptTagDerivationStore['bulkCreate']>[0] = [];
  const seenConceptsByCode = new Set<string>();

  for (const { registryId, code } of codes) {
    const crosswalks = await stores.taxonomyCrosswalks.findBySourceCode(registryId, code);

    if (crosswalks.length === 0) {
      unmatchedCodes.push({ registryId, code });
      continue;
    }

    for (const cw of crosswalks) {
      // Deduplicate: skip if this code already mapped to this concept
      const dedupeKey = `${registryId}:${code}:${cw.targetConceptId}`;
      if (seenConceptsByCode.has(dedupeKey)) continue;
      seenConceptsByCode.add(dedupeKey);

      const concept = await stores.canonicalConcepts.getById(cw.targetConceptId);
      if (!concept || !concept.isActive) continue;

      const tagValue = concept.conceptKey;
      const tag: DerivedTag = {
        tagType: 'category',
        tagValue,
        conceptId: concept.id,
        crosswalkId: cw.id,
        confidence: cw.confidence,
        matchType: cw.matchType,
      };
      derivedTags.push(tag);

      derivationRows.push({
        sourceRecordId: sourceRecordId ?? null,
        sourceRegistryId: registryId,
        sourceCode: code,
        crosswalkId: cw.id,
        conceptId: concept.id,
        derivedTagType: 'category',
        derivedTagValue: tagValue,
        confidence: cw.confidence,
        entityType,
        entityId,
      });
    }
  }

  if (derivationRows.length > 0) {
    await stores.conceptTagDerivations.bulkCreate(derivationRows);
  }

  return {
    derivedTags,
    unmatchedCodes,
    derivationsRecorded: derivationRows.length,
  };
}
