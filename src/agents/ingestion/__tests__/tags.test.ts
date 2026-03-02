import { describe, expect, test } from 'vitest';

import {
  AUDIENCE_TAGS,
  buildVerificationMissingTags,
  CATEGORY_TAGS,
  createGeographicTag,
  deriveSourceQualityTag,
  formatGeographicLabel,
  parseGeographicTag,
  PROGRAM_TAGS,
  ResourceTagSchema,
  ResourceTagTypeSchema,
  SOURCE_QUALITY_TAGS,
  VERIFICATION_MISSING_TAGS,
} from '../tags';

describe('resource tags', () => {
  describe('tag type schema', () => {
    test('has expected types', () => {
      const types = ResourceTagTypeSchema.options;
      expect(types).toContain('category');
      expect(types).toContain('geographic');
      expect(types).toContain('audience');
      expect(types).toContain('verification_missing');
      expect(types).toContain('verification_status');
      expect(types).toContain('program');
      expect(types).toContain('source_quality');
      expect(types).toContain('custom');
    });
  });

  describe('predefined tag values', () => {
    test('CATEGORY_TAGS covers major domains', () => {
      expect(CATEGORY_TAGS).toContain('food');
      expect(CATEGORY_TAGS).toContain('housing');
      expect(CATEGORY_TAGS).toContain('healthcare');
      expect(CATEGORY_TAGS).toContain('legal');
      expect(CATEGORY_TAGS).toContain('employment');
      expect(CATEGORY_TAGS).toContain('crisis');
    });

    test('AUDIENCE_TAGS covers key populations', () => {
      expect(AUDIENCE_TAGS).toContain('veteran');
      expect(AUDIENCE_TAGS).toContain('senior');
      expect(AUDIENCE_TAGS).toContain('family');
      expect(AUDIENCE_TAGS).toContain('homeless');
      expect(AUDIENCE_TAGS).toContain('low_income');
    });

    test('PROGRAM_TAGS covers major benefit programs', () => {
      expect(PROGRAM_TAGS).toContain('snap');
      expect(PROGRAM_TAGS).toContain('wic');
      expect(PROGRAM_TAGS).toContain('medicaid');
      expect(PROGRAM_TAGS).toContain('section8');
      expect(PROGRAM_TAGS).toContain('va_benefits');
    });

    test('VERIFICATION_MISSING_TAGS covers checklist items', () => {
      expect(VERIFICATION_MISSING_TAGS).toContain('missing_phone');
      expect(VERIFICATION_MISSING_TAGS).toContain('missing_address');
      expect(VERIFICATION_MISSING_TAGS).toContain('missing_hours');
      expect(VERIFICATION_MISSING_TAGS).toContain('needs_duplication_review');
    });

    test('SOURCE_QUALITY_TAGS covers domain types', () => {
      expect(SOURCE_QUALITY_TAGS).toContain('gov_source');
      expect(SOURCE_QUALITY_TAGS).toContain('edu_source');
      expect(SOURCE_QUALITY_TAGS).toContain('mil_source');
      expect(SOURCE_QUALITY_TAGS).toContain('quarantine_source');
    });
  });

  describe('ResourceTagSchema', () => {
    test('validates a candidate tag', () => {
      const tag = ResourceTagSchema.parse({
        candidateId: crypto.randomUUID(),
        tagType: 'category',
        tagValue: 'Food',
        displayLabel: 'Food Assistance',
        tagConfidence: 95,
        assignedBy: 'agent',
        evidenceRefs: ['ev-123'],
      });

      expect(tag.tagValue).toBe('food'); // normalized to lowercase
      expect(tag.tagConfidence).toBe(95);
    });

    test('validates a service tag', () => {
      const tag = ResourceTagSchema.parse({
        serviceId: crypto.randomUUID(),
        tagType: 'geographic',
        tagValue: 'us_id_kootenai',
        assignedBy: 'human',
        assignedByUserId: 'user-456',
      });

      expect(tag.tagType).toBe('geographic');
    });

    test('rejects tag without parent', () => {
      expect(() =>
        ResourceTagSchema.parse({
          tagType: 'category',
          tagValue: 'food',
        })
      ).toThrow('Either candidateId or serviceId must be provided');
    });

    test('normalizes tag value to lowercase', () => {
      const tag = ResourceTagSchema.parse({
        candidateId: crypto.randomUUID(),
        tagType: 'audience',
        tagValue: '  VETERAN  ',
      });

      expect(tag.tagValue).toBe('veteran');
    });

    test('clamps confidence to 0-100', () => {
      expect(() =>
        ResourceTagSchema.parse({
          candidateId: crypto.randomUUID(),
          tagType: 'category',
          tagValue: 'food',
          tagConfidence: 150,
        })
      ).toThrow();
    });
  });

  describe('createGeographicTag', () => {
    test('creates state-level tag', () => {
      expect(createGeographicTag('ID')).toBe('us_id');
    });

    test('creates county-level tag', () => {
      expect(createGeographicTag('ID', 'Kootenai')).toBe('us_id_kootenai');
    });

    test('creates city-level tag', () => {
      expect(createGeographicTag('WA', 'King', 'Seattle')).toBe('us_wa_king_seattle');
    });

    test('handles spaces in names', () => {
      expect(createGeographicTag('WA', 'King', 'Federal Way')).toBe('us_wa_king_federal_way');
    });

    test('handles custom country', () => {
      expect(createGeographicTag('BC', undefined, undefined, 'CA')).toBe('ca_bc');
    });
  });

  describe('parseGeographicTag', () => {
    test('parses state-level tag', () => {
      const result = parseGeographicTag('us_id');
      expect(result.country).toBe('US');
      expect(result.state).toBe('ID');
      expect(result.county).toBeUndefined();
    });

    test('parses county-level tag', () => {
      const result = parseGeographicTag('us_id_kootenai');
      expect(result.country).toBe('US');
      expect(result.state).toBe('ID');
      expect(result.county).toBe('kootenai');
    });

    test('parses city-level tag', () => {
      const result = parseGeographicTag('us_wa_king_seattle');
      expect(result.country).toBe('US');
      expect(result.state).toBe('WA');
      expect(result.county).toBe('king');
      expect(result.city).toBe('seattle');
    });
  });

  describe('formatGeographicLabel', () => {
    test('formats state only', () => {
      expect(formatGeographicLabel('Idaho')).toBe('Idaho');
    });

    test('formats county + state', () => {
      expect(formatGeographicLabel('Idaho', 'Kootenai')).toBe('Kootenai County, Idaho');
    });

    test('formats city + county + state', () => {
      expect(formatGeographicLabel('Washington', 'King', 'Seattle')).toBe(
        'Seattle, King County, Washington'
      );
    });

    test('returns Nationwide for empty', () => {
      expect(formatGeographicLabel()).toBe('Nationwide');
    });
  });

  describe('deriveSourceQualityTag', () => {
    test('identifies .gov source', () => {
      expect(deriveSourceQualityTag('benefits.gov')).toBe('gov_source');
      expect(deriveSourceQualityTag('www.idaho.gov')).toBe('gov_source');
    });

    test('identifies .edu source', () => {
      expect(deriveSourceQualityTag('www.mit.edu')).toBe('edu_source');
    });

    test('identifies .mil source', () => {
      expect(deriveSourceQualityTag('www.army.mil')).toBe('mil_source');
    });

    test('returns quarantine for unknown domains', () => {
      expect(deriveSourceQualityTag('example.com')).toBe('quarantine_source');
      expect(deriveSourceQualityTag('example.org')).toBe('quarantine_source');
    });
  });

  describe('buildVerificationMissingTags', () => {
    test('returns empty for satisfied checklist', () => {
      const checklist = [
        { key: 'contact_method', status: 'satisfied', required: true },
        { key: 'physical_address_or_virtual', status: 'satisfied', required: true },
      ];

      expect(buildVerificationMissingTags(checklist)).toEqual([]);
    });

    test('returns missing tags for incomplete checklist', () => {
      const checklist = [
        { key: 'contact_method', status: 'missing', required: true },
        { key: 'hours', status: 'missing', required: true },
        { key: 'eligibility_criteria', status: 'not_applicable', required: false },
      ];

      const tags = buildVerificationMissingTags(checklist);
      expect(tags).toContain('missing_phone');
      expect(tags).toContain('missing_hours');
      expect(tags).not.toContain('missing_eligibility');
    });

    test('maps all checklist keys correctly', () => {
      const checklist = [
        { key: 'contact_method', status: 'missing', required: true },
        { key: 'physical_address_or_virtual', status: 'missing', required: true },
        { key: 'service_area', status: 'missing', required: true },
        { key: 'eligibility_criteria', status: 'missing', required: true },
        { key: 'hours', status: 'missing', required: true },
        { key: 'source_provenance', status: 'missing', required: true },
        { key: 'duplication_review', status: 'missing', required: true },
        { key: 'policy_pass', status: 'missing', required: true },
      ];

      const tags = buildVerificationMissingTags(checklist);
      expect(tags).toContain('missing_phone');
      expect(tags).toContain('missing_address');
      expect(tags).toContain('missing_service_area');
      expect(tags).toContain('missing_eligibility');
      expect(tags).toContain('missing_hours');
      expect(tags).toContain('missing_provenance');
      expect(tags).toContain('needs_duplication_review');
      expect(tags).toContain('needs_policy_review');
    });
  });
});

