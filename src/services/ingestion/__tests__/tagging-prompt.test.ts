/**
 * Tests for ORAN Ingestion Tagging
 */

import { describe, it, expect } from 'vitest';
import {
  generateTaggingPrompt,
  generateQuickTaggingPrompt,
  extractTagsFromResponse,
  validateAndFilterTags,
  hasMinimumTags,
  summarizeExtraction,
  getTaxonomyOptionsForUI,
  type FullTagExtractionResult,
} from '../tagging-prompt';

describe('tagging-prompt', () => {
  describe('generateTaggingPrompt', () => {
    it('should generate a valid prompt with taxonomy reference', () => {
      const rawText = 'Downtown Food Bank - Free food for anyone in need.';
      const prompt = generateTaggingPrompt(rawText);

      expect(prompt).toContain('Downtown Food Bank');
      expect(prompt).toContain('DELIVERY');
      expect(prompt).toContain('COST');
      expect(prompt).toContain('ACCESS');
      expect(prompt).toContain('in_person');
      expect(prompt).toContain('free');
      expect(prompt).toContain('JSON');
    });

    it('should include all taxonomy dimensions', () => {
      const prompt = generateTaggingPrompt('Test service');

      expect(prompt).toContain('DELIVERY');
      expect(prompt).toContain('COST');
      expect(prompt).toContain('ACCESS');
      expect(prompt).toContain('CULTURE');
      expect(prompt).toContain('POPULATION');
      expect(prompt).toContain('SITUATION');
      expect(prompt).toContain('SERVICE ADAPTATIONS');
      expect(prompt).toContain('DIETARY OPTIONS');
      expect(prompt).toContain('LOCATION ACCESSIBILITY');
    });
  });

  describe('generateQuickTaggingPrompt', () => {
    it('should generate a shorter prompt with core tags only', () => {
      const rawText = 'Test service description';
      const prompt = generateQuickTaggingPrompt(rawText);

      expect(prompt).toContain('Test service description');
      expect(prompt).toContain('delivery:');
      expect(prompt).toContain('cost:');
      expect(prompt).toContain('access:');
      expect(prompt.length).toBeLessThan(generateTaggingPrompt(rawText).length);
    });
  });

  describe('extractTagsFromResponse', () => {
    it('should parse valid JSON response', () => {
      const response = `\`\`\`json
{
  "serviceAttributes": {
    "delivery": ["in_person", "virtual"],
    "cost": ["free"],
    "access": ["walk_in"],
    "culture": [],
    "population": [],
    "situation": []
  },
  "adaptations": [],
  "dietary": [],
  "location": {
    "accessibility": ["wheelchair"],
    "transitAccess": ["bus_stop_nearby"],
    "parking": "yes"
  },
  "service": {
    "estimatedWaitDays": 0,
    "capacityStatus": "available"
  },
  "eligibility": {
    "householdSizeMin": null,
    "householdSizeMax": null,
    "incomePctFpl": null,
    "ageMin": null,
    "ageMax": null
  },
  "languages": ["en", "es"],
  "confidence": 90,
  "warnings": []
}
\`\`\``;

      const result = extractTagsFromResponse(response);

      expect(result).not.toBeNull();
      expect(result?.serviceAttributes.delivery).toContain('in_person');
      expect(result?.serviceAttributes.delivery).toContain('virtual');
      expect(result?.serviceAttributes.cost).toContain('free');
      expect(result?.location.accessibility).toContain('wheelchair');
      expect(result?.location.parking).toBe('yes');
      expect(result?.languages).toContain('es');
      expect(result?.confidence).toBe(90);
    });

    it('should return null for invalid JSON', () => {
      const response = 'This is not valid JSON';
      const result = extractTagsFromResponse(response);
      expect(result).toBeNull();
    });

    it('should handle JSON without code blocks', () => {
      const response = `{
        "serviceAttributes": {
          "delivery": ["phone"],
          "cost": ["free"],
          "access": [],
          "culture": [],
          "population": [],
          "situation": []
        },
        "adaptations": [],
        "dietary": [],
        "location": { "accessibility": [], "transitAccess": [], "parking": "unknown" },
        "service": { "estimatedWaitDays": null, "capacityStatus": null },
        "eligibility": { "householdSizeMin": null, "householdSizeMax": null, "incomePctFpl": null, "ageMin": null, "ageMax": null },
        "languages": [],
        "confidence": 70,
        "warnings": []
      }`;

      const result = extractTagsFromResponse(response);
      expect(result).not.toBeNull();
      expect(result?.serviceAttributes.delivery).toContain('phone');
    });
  });

  describe('validateAndFilterTags', () => {
    it('should keep valid tags and remove invalid ones', () => {
      const input: FullTagExtractionResult = {
        serviceAttributes: {
          delivery: ['in_person', 'INVALID_TAG', 'virtual'],
          cost: ['free', 'not_a_real_tag'],
          access: ['walk_in'],
          culture: [],
          population: ['undocumented_friendly', 'fake_population'],
          situation: [],
        },
        adaptations: [
          { type: 'disability', tag: 'deaf', details: 'ASL available' },
          { type: 'disability', tag: 'not_real_tag' },
        ],
        dietary: [
          { type: 'halal', availability: 'always' },
          { type: 'made_up_diet', availability: 'always' },
        ],
        location: {
          accessibility: ['wheelchair', 'fake_accessibility'],
          transitAccess: ['bus_stop_nearby', 'teleporter_nearby'],
          parking: 'yes',
        },
        service: {
          estimatedWaitDays: 5,
          capacityStatus: 'available',
        },
        eligibility: {
          householdSizeMin: 1,
          householdSizeMax: 6,
          incomePctFpl: 200,
          ageMin: null,
          ageMax: null,
        },
        languages: ['en', 'es'],
        confidence: 80,
        warnings: [],
      };

      const result = validateAndFilterTags(input);

      // Valid tags kept
      expect(result.serviceAttributes.delivery).toContain('in_person');
      expect(result.serviceAttributes.delivery).toContain('virtual');
      expect(result.serviceAttributes.cost).toContain('free');
      expect(result.serviceAttributes.population).toContain('undocumented_friendly');
      expect(result.adaptations).toHaveLength(1);
      expect(result.adaptations[0].tag).toBe('deaf');
      expect(result.dietary).toHaveLength(1);
      expect(result.dietary[0].type).toBe('halal');
      expect(result.location.accessibility).toContain('wheelchair');
      expect(result.location.transitAccess).toContain('bus_stop_nearby');

      // Invalid tags removed
      expect(result.serviceAttributes.delivery).not.toContain('INVALID_TAG');
      expect(result.serviceAttributes.cost).not.toContain('not_a_real_tag');
      expect(result.serviceAttributes.population).not.toContain('fake_population');
      expect(result.location.accessibility).not.toContain('fake_accessibility');
      expect(result.location.transitAccess).not.toContain('teleporter_nearby');

      // Warnings generated
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('INVALID_TAG'))).toBe(true);
    });

    it('should default parking to unknown if invalid', () => {
      const input: FullTagExtractionResult = {
        serviceAttributes: { delivery: [], cost: [], access: [], culture: [], population: [], situation: [] },
        adaptations: [],
        dietary: [],
        location: {
          accessibility: [],
          transitAccess: [],
          parking: 'invalid_parking' as 'yes',
        },
        service: { estimatedWaitDays: null, capacityStatus: null },
        eligibility: { householdSizeMin: null, householdSizeMax: null, incomePctFpl: null, ageMin: null, ageMax: null },
        languages: [],
        confidence: 50,
        warnings: [],
      };

      const result = validateAndFilterTags(input);
      expect(result.location.parking).toBe('unknown');
    });
  });

  describe('hasMinimumTags', () => {
    it('should return true when delivery and cost are present', () => {
      const extraction: FullTagExtractionResult = {
        serviceAttributes: {
          delivery: ['in_person'],
          cost: ['free'],
          access: [],
          culture: [],
          population: [],
          situation: [],
        },
        adaptations: [],
        dietary: [],
        location: { accessibility: [], transitAccess: [], parking: 'unknown' },
        service: { estimatedWaitDays: null, capacityStatus: null },
        eligibility: { householdSizeMin: null, householdSizeMax: null, incomePctFpl: null, ageMin: null, ageMax: null },
        languages: [],
        confidence: 80,
        warnings: [],
      };

      expect(hasMinimumTags(extraction)).toBe(true);
    });

    it('should return false when delivery is missing', () => {
      const extraction: FullTagExtractionResult = {
        serviceAttributes: {
          delivery: [],
          cost: ['free'],
          access: ['walk_in'],
          culture: [],
          population: [],
          situation: [],
        },
        adaptations: [],
        dietary: [],
        location: { accessibility: [], transitAccess: [], parking: 'unknown' },
        service: { estimatedWaitDays: null, capacityStatus: null },
        eligibility: { householdSizeMin: null, householdSizeMax: null, incomePctFpl: null, ageMin: null, ageMax: null },
        languages: [],
        confidence: 80,
        warnings: [],
      };

      expect(hasMinimumTags(extraction)).toBe(false);
    });
  });

  describe('summarizeExtraction', () => {
    it('should generate a human-readable summary', () => {
      const extraction: FullTagExtractionResult = {
        serviceAttributes: {
          delivery: ['in_person', 'virtual'],
          cost: ['free', 'medicaid'],
          access: ['walk_in'],
          culture: ['trauma_informed'],
          population: [],
          situation: [],
        },
        adaptations: [{ type: 'disability', tag: 'deaf', details: 'ASL' }],
        dietary: [{ type: 'halal', availability: 'by_request' }],
        location: { accessibility: ['wheelchair'], transitAccess: [], parking: 'yes' },
        service: { estimatedWaitDays: 7, capacityStatus: 'available' },
        eligibility: { householdSizeMin: null, householdSizeMax: null, incomePctFpl: null, ageMin: null, ageMax: null },
        languages: ['en', 'es', 'vi'],
        confidence: 85,
        warnings: ['Test warning'],
      };

      const summary = summarizeExtraction(extraction);

      expect(summary).toContain('delivery: 2');
      expect(summary).toContain('cost: 2');
      expect(summary).toContain('Adaptations: disability:deaf');
      expect(summary).toContain('Dietary: halal');
      expect(summary).toContain('Languages: en, es, vi');
      expect(summary).toContain('Confidence: 85%');
      expect(summary).toContain('Warnings: 1');
    });
  });

  describe('getTaxonomyOptionsForUI', () => {
    it('should return all taxonomy options formatted for UI', () => {
      const options = getTaxonomyOptionsForUI();

      // Check structure
      expect(options.delivery).toBeDefined();
      expect(options.cost).toBeDefined();
      expect(options.access).toBeDefined();
      expect(options.dietary).toBeDefined();
      expect(options.locationAccessibility).toBeDefined();
      expect(options.adaptations).toBeDefined();
      expect(options.capacityStatus).toBeDefined();
      expect(options.parking).toBeDefined();

      // Check option format
      expect(options.delivery.length).toBeGreaterThan(0);
      expect(options.delivery[0]).toHaveProperty('value');
      expect(options.delivery[0]).toHaveProperty('label');
      expect(options.delivery[0]).toHaveProperty('description');

      // Check adaptations nested structure
      expect(options.adaptations.disability).toBeDefined();
      expect(options.adaptations.health_condition).toBeDefined();
      expect(options.adaptations.age_group).toBeDefined();
      expect(options.adaptations.learning).toBeDefined();
    });

    it('should have common tags marked', () => {
      const options = getTaxonomyOptionsForUI();

      const hasCommonDelivery = options.delivery.some(o => o.common);
      const hasCommonCost = options.cost.some(o => o.common);

      expect(hasCommonDelivery).toBe(true);
      expect(hasCommonCost).toBe(true);
    });
  });
});
