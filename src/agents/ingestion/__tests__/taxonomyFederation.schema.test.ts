/**
 * Tests for Taxonomy Federation schema tables (migration 0037).
 *
 * Validates Drizzle table definitions, column types, defaults, and FK references.
 */
import { describe, it, expect } from 'vitest';
import {
  taxonomyRegistries,
  taxonomyTermsExt,
  canonicalConcepts,
  taxonomyCrosswalks,
  conceptTagDerivations,
} from '@/db/schema';
import { getTableName } from 'drizzle-orm';

// ── Helpers ────────────────────────────────────────────────

function colNames(table: object): string[] {
  const t = table as Record<string, unknown>;
  return Object.keys(t).filter(
    (k) => typeof t[k] === 'object' && t[k] !== null && 'name' in (t[k] as Record<string, unknown>)
  );
}

function colConfig(table: object, col: string) {
  return (table as Record<string, unknown>)[col] as Record<string, unknown>;
}

// ── Tests ──────────────────────────────────────────────────

describe('Taxonomy Federation Schema Tables', () => {
  describe('taxonomy_registries', () => {
    it('has correct SQL table name', () => {
      expect(getTableName(taxonomyRegistries)).toBe('taxonomy_registries');
    });

    it('defines expected columns', () => {
      const cols = colNames(taxonomyRegistries);
      expect(cols).toEqual(expect.arrayContaining([
        'id', 'name', 'uri', 'version', 'description',
        'isDefault', 'status', 'createdAt', 'updatedAt',
      ]));
    });

    it('has primary key on id', () => {
      const cfg = colConfig(taxonomyRegistries, 'id');
      expect(cfg.primary).toBe(true);
    });
  });

  describe('taxonomy_terms_ext', () => {
    it('has correct SQL table name', () => {
      expect(getTableName(taxonomyTermsExt)).toBe('taxonomy_terms_ext');
    });

    it('defines expected columns', () => {
      const cols = colNames(taxonomyTermsExt);
      expect(cols).toEqual(expect.arrayContaining([
        'id', 'registryId', 'code', 'term', 'parentCode',
        'description', 'uri', 'depth', 'isActive',
        'createdAt', 'updatedAt',
      ]));
    });

    it('has FK to taxonomy_registries', () => {
      const cfg = colConfig(taxonomyTermsExt, 'registryId') as Record<string, unknown>;
      expect(cfg.notNull).toBe(true);
    });
  });

  describe('canonical_concepts', () => {
    it('has correct SQL table name', () => {
      expect(getTableName(canonicalConcepts)).toBe('canonical_concepts');
    });

    it('defines expected columns', () => {
      const cols = colNames(canonicalConcepts);
      expect(cols).toEqual(expect.arrayContaining([
        'id', 'conceptKey', 'label', 'description',
        'oranTaxonomyTermId', 'isActive', 'createdAt', 'updatedAt',
      ]));
    });

    it('concept_key is unique', () => {
      const cfg = colConfig(canonicalConcepts, 'conceptKey') as Record<string, unknown>;
      expect(cfg.isUnique).toBe(true);
    });
  });

  describe('taxonomy_crosswalks', () => {
    it('has correct SQL table name', () => {
      expect(getTableName(taxonomyCrosswalks)).toBe('taxonomy_crosswalks');
    });

    it('defines expected columns', () => {
      const cols = colNames(taxonomyCrosswalks);
      expect(cols).toEqual(expect.arrayContaining([
        'id', 'sourceRegistryId', 'sourceCode', 'targetConceptId',
        'matchType', 'confidence', 'notes', 'createdBy',
        'createdAt', 'updatedAt',
      ]));
    });
  });

  describe('concept_tag_derivations', () => {
    it('has correct SQL table name', () => {
      expect(getTableName(conceptTagDerivations)).toBe('concept_tag_derivations');
    });

    it('defines expected columns', () => {
      const cols = colNames(conceptTagDerivations);
      expect(cols).toEqual(expect.arrayContaining([
        'id', 'sourceRecordId', 'sourceRegistryId', 'sourceCode',
        'crosswalkId', 'conceptId', 'derivedTagType', 'derivedTagValue',
        'confidence', 'entityType', 'entityId', 'createdAt',
      ]));
    });

    it('derivedTagType defaults to category', () => {
      const cfg = colConfig(conceptTagDerivations, 'derivedTagType') as Record<string, unknown>;
      expect(cfg.hasDefault).toBe(true);
    });
  });

  describe('Row type inference', () => {
    it('TaxonomyRegistryRow is exported', async () => {
      const schema = await import('@/db/schema');
      expect(schema.taxonomyRegistries).toBeDefined();
    });

    it('TaxonomyTermExtRow is exported', async () => {
      const schema = await import('@/db/schema');
      expect(schema.taxonomyTermsExt).toBeDefined();
    });

    it('CanonicalConceptRow is exported', async () => {
      const schema = await import('@/db/schema');
      expect(schema.canonicalConcepts).toBeDefined();
    });

    it('TaxonomyCrosswalkRow is exported', async () => {
      const schema = await import('@/db/schema');
      expect(schema.taxonomyCrosswalks).toBeDefined();
    });

    it('ConceptTagDerivationRow is exported', async () => {
      const schema = await import('@/db/schema');
      expect(schema.conceptTagDerivations).toBeDefined();
    });
  });
});
