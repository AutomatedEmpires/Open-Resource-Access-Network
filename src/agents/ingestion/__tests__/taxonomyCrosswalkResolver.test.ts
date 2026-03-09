/**
 * Tests for the taxonomy crosswalk resolver.
 *
 * Validates: resolution of external codes → ORAN tags via crosswalks,
 * unmatched code tracking, derivation recording, and edge cases.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveCrosswalks,
} from '../taxonomyCrosswalkResolver';
import type {
  TaxonomyCrosswalkStore,
  CanonicalConceptStore,
  ConceptTagDerivationStore,
} from '../stores';

// ── Helpers ────────────────────────────────────────────────

function makeMockStores() {
  const taxonomyCrosswalks: TaxonomyCrosswalkStore = {
    getById: vi.fn(),
    findBySourceCode: vi.fn().mockResolvedValue([]),
    findExact: vi.fn(),
    create: vi.fn(),
    bulkCreate: vi.fn(),
  };

  const canonicalConcepts: CanonicalConceptStore = {
    getById: vi.fn().mockResolvedValue(null),
    findByKey: vi.fn(),
    listActive: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const conceptTagDerivations: ConceptTagDerivationStore = {
    findByEntity: vi.fn(),
    create: vi.fn(),
    bulkCreate: vi.fn().mockResolvedValue(undefined),
  };

  return { taxonomyCrosswalks, canonicalConcepts, conceptTagDerivations };
}

const REG_ID = 'reg-001';
const CONCEPT_ID = 'concept-001';
const CW_ID = 'cw-001';
const ENTITY_ID = 'svc-001';
const SOURCE_REC_ID = 'src-001';

// ── Tests ──────────────────────────────────────────────────

describe('resolveCrosswalks', () => {
  it('resolves a single code through one crosswalk', async () => {
    const stores = makeMockStores();
    (stores.taxonomyCrosswalks.findBySourceCode as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: CW_ID,
        sourceRegistryId: REG_ID,
        sourceCode: 'BD-1800',
        targetConceptId: CONCEPT_ID,
        matchType: 'exact',
        confidence: 95,
      },
    ]);
    (stores.canonicalConcepts.getById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: CONCEPT_ID,
      conceptKey: 'food_pantry',
      label: 'Food Pantry',
      isActive: true,
    });

    const result = await resolveCrosswalks({
      codes: [{ registryId: REG_ID, code: 'BD-1800' }],
      entityType: 'service',
      entityId: ENTITY_ID,
      sourceRecordId: SOURCE_REC_ID,
      stores,
    });

    expect(result.derivedTags).toHaveLength(1);
    expect(result.derivedTags[0]).toMatchObject({
      tagType: 'category',
      tagValue: 'food_pantry',
      conceptId: CONCEPT_ID,
      crosswalkId: CW_ID,
      confidence: 95,
      matchType: 'exact',
    });
    expect(result.unmatchedCodes).toHaveLength(0);
    expect(result.derivationsRecorded).toBe(1);
    expect(stores.conceptTagDerivations.bulkCreate).toHaveBeenCalledOnce();
  });

  it('tracks unmatched codes when no crosswalk exists', async () => {
    const stores = makeMockStores();

    const result = await resolveCrosswalks({
      codes: [{ registryId: REG_ID, code: 'UNKNOWN-999' }],
      entityType: 'service',
      entityId: ENTITY_ID,
      stores,
    });

    expect(result.derivedTags).toHaveLength(0);
    expect(result.unmatchedCodes).toEqual([{ registryId: REG_ID, code: 'UNKNOWN-999' }]);
    expect(result.derivationsRecorded).toBe(0);
    expect(stores.conceptTagDerivations.bulkCreate).not.toHaveBeenCalled();
  });

  it('skips inactive concepts', async () => {
    const stores = makeMockStores();
    (stores.taxonomyCrosswalks.findBySourceCode as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: CW_ID,
        sourceRegistryId: REG_ID,
        sourceCode: 'BD-1800',
        targetConceptId: CONCEPT_ID,
        matchType: 'exact',
        confidence: 100,
      },
    ]);
    (stores.canonicalConcepts.getById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: CONCEPT_ID,
      conceptKey: 'food_pantry',
      label: 'Food Pantry',
      isActive: false,
    });

    const result = await resolveCrosswalks({
      codes: [{ registryId: REG_ID, code: 'BD-1800' }],
      entityType: 'service',
      entityId: ENTITY_ID,
      stores,
    });

    expect(result.derivedTags).toHaveLength(0);
    expect(result.derivationsRecorded).toBe(0);
  });

  it('resolves multiple codes from the same registry', async () => {
    const stores = makeMockStores();

    (stores.taxonomyCrosswalks.findBySourceCode as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { id: 'cw-1', sourceRegistryId: REG_ID, sourceCode: 'BD-1800', targetConceptId: 'c-1', matchType: 'exact', confidence: 100 },
      ])
      .mockResolvedValueOnce([
        { id: 'cw-2', sourceRegistryId: REG_ID, sourceCode: 'BH-1800', targetConceptId: 'c-2', matchType: 'exact', confidence: 80 },
      ]);

    (stores.canonicalConcepts.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'c-1', conceptKey: 'food_pantry', label: 'Food Pantry', isActive: true })
      .mockResolvedValueOnce({ id: 'c-2', conceptKey: 'shelter', label: 'Shelter', isActive: true });

    const result = await resolveCrosswalks({
      codes: [
        { registryId: REG_ID, code: 'BD-1800' },
        { registryId: REG_ID, code: 'BH-1800' },
      ],
      entityType: 'service',
      entityId: ENTITY_ID,
      stores,
    });

    expect(result.derivedTags).toHaveLength(2);
    expect(result.derivedTags.map(t => t.tagValue).sort()).toEqual(['food_pantry', 'shelter']);
    expect(result.derivationsRecorded).toBe(2);
  });

  it('handles one code mapping to multiple concepts (broader match)', async () => {
    const stores = makeMockStores();

    (stores.taxonomyCrosswalks.findBySourceCode as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'cw-1', sourceRegistryId: REG_ID, sourceCode: 'BD-1800', targetConceptId: 'c-1', matchType: 'exact', confidence: 100 },
      { id: 'cw-2', sourceRegistryId: REG_ID, sourceCode: 'BD-1800', targetConceptId: 'c-2', matchType: 'broader', confidence: 70 },
    ]);

    (stores.canonicalConcepts.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'c-1', conceptKey: 'food_pantry', label: 'Food Pantry', isActive: true })
      .mockResolvedValueOnce({ id: 'c-2', conceptKey: 'food_assistance', label: 'Food Assistance', isActive: true });

    const result = await resolveCrosswalks({
      codes: [{ registryId: REG_ID, code: 'BD-1800' }],
      entityType: 'service',
      entityId: ENTITY_ID,
      stores,
    });

    expect(result.derivedTags).toHaveLength(2);
    expect(result.derivationsRecorded).toBe(2);
    const broader = result.derivedTags.find(t => t.matchType === 'broader');
    expect(broader?.confidence).toBe(70);
  });

  it('records sourceRecordId as null when not provided', async () => {
    const stores = makeMockStores();
    (stores.taxonomyCrosswalks.findBySourceCode as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: CW_ID, sourceRegistryId: REG_ID, sourceCode: 'BD-1800', targetConceptId: CONCEPT_ID, matchType: 'exact', confidence: 100 },
    ]);
    (stores.canonicalConcepts.getById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: CONCEPT_ID, conceptKey: 'food_pantry', label: 'Food Pantry', isActive: true,
    });

    await resolveCrosswalks({
      codes: [{ registryId: REG_ID, code: 'BD-1800' }],
      entityType: 'service',
      entityId: ENTITY_ID,
      // no sourceRecordId
      stores,
    });

    const derivations = (stores.conceptTagDerivations.bulkCreate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(derivations[0].sourceRecordId).toBeNull();
  });

  it('handles empty codes array gracefully', async () => {
    const stores = makeMockStores();

    const result = await resolveCrosswalks({
      codes: [],
      entityType: 'service',
      entityId: ENTITY_ID,
      stores,
    });

    expect(result.derivedTags).toHaveLength(0);
    expect(result.unmatchedCodes).toHaveLength(0);
    expect(result.derivationsRecorded).toBe(0);
  });

  it('skips concept when getById returns null', async () => {
    const stores = makeMockStores();
    (stores.taxonomyCrosswalks.findBySourceCode as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: CW_ID, sourceRegistryId: REG_ID, sourceCode: 'BD-1800', targetConceptId: CONCEPT_ID, matchType: 'exact', confidence: 100 },
    ]);
    // concept not found
    (stores.canonicalConcepts.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await resolveCrosswalks({
      codes: [{ registryId: REG_ID, code: 'BD-1800' }],
      entityType: 'service',
      entityId: ENTITY_ID,
      stores,
    });

    expect(result.derivedTags).toHaveLength(0);
    // code was matched to a crosswalk, so NOT unmatched
    expect(result.unmatchedCodes).toHaveLength(0);
    expect(result.derivationsRecorded).toBe(0);
  });

  it('deduplicates when multiple crosswalks point to the same concept', async () => {
    const stores = makeMockStores();

    // Two crosswalks for the same code both targeting the same concept
    (stores.taxonomyCrosswalks.findBySourceCode as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'cw-1', sourceRegistryId: REG_ID, sourceCode: 'BD-1800', targetConceptId: CONCEPT_ID, matchType: 'exact', confidence: 100 },
      { id: 'cw-2', sourceRegistryId: REG_ID, sourceCode: 'BD-1800', targetConceptId: CONCEPT_ID, matchType: 'broader', confidence: 90 },
    ]);

    (stores.canonicalConcepts.getById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: CONCEPT_ID, conceptKey: 'food_pantry', label: 'Food Pantry', isActive: true,
    });

    const result = await resolveCrosswalks({
      codes: [{ registryId: REG_ID, code: 'BD-1800' }],
      entityType: 'service',
      entityId: ENTITY_ID,
      stores,
    });

    // Should only produce 1 derivation, not 2
    expect(result.derivedTags).toHaveLength(1);
    expect(result.derivationsRecorded).toBe(1);
  });
});
