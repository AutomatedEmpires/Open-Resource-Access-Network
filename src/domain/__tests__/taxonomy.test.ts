import { describe, expect, it } from 'vitest';
import {
  ALL_TAXONOMIES,
  CAPACITY_STATUS_OPTIONS,
  DIETARY_AVAILABILITY_OPTIONS,
  PARKING_OPTIONS,
  SERVICE_ADAPTATIONS_TAXONOMY,
  SERVICE_ATTRIBUTES_TAXONOMY,
  getCommonTags,
  getTagDescription,
  getValidAdaptationTags,
  getValidAttributeTags,
  getValidDietaryTypes,
  getValidTransitTags,
  isValidTag,
} from '@/domain/taxonomy';

describe('taxonomy SSOT', () => {
  it('exposes expected attribute and adaptation dimensions with non-empty tags', () => {
    expect(Object.keys(SERVICE_ATTRIBUTES_TAXONOMY)).toEqual([
      'delivery',
      'cost',
      'access',
      'culture',
      'population',
      'situation',
    ]);
    expect(Object.keys(SERVICE_ADAPTATIONS_TAXONOMY)).toEqual([
      'disability',
      'health_condition',
      'age_group',
      'learning',
    ]);

    for (const key of Object.keys(SERVICE_ATTRIBUTES_TAXONOMY)) {
      expect(SERVICE_ATTRIBUTES_TAXONOMY[key].tags.length).toBeGreaterThan(0);
    }
    for (const key of Object.keys(SERVICE_ADAPTATIONS_TAXONOMY)) {
      expect(SERVICE_ADAPTATIONS_TAXONOMY[key].tags.length).toBeGreaterThan(0);
    }
  });

  it('returns valid tag lists from helper functions', () => {
    const deliveryTags = getValidAttributeTags('delivery');
    const disabilityTags = getValidAdaptationTags('disability');
    const dietaryTags = getValidDietaryTypes();
    const transitTags = getValidTransitTags();

    expect(deliveryTags).toContain('in_person');
    expect(deliveryTags).toContain('virtual');
    expect(disabilityTags).toContain('deaf');
    expect(disabilityTags).toContain('autism');
    expect(dietaryTags).toContain('vegan');
    expect(dietaryTags).toContain('fresh_produce');
    expect(transitTags).toContain('bus_stop_nearby');
    expect(transitTags).toContain('ada_transit');
  });

  it('validates and describes tags across attributes and adaptations', () => {
    expect(isValidTag('delivery', 'in_person')).toBe(true);
    expect(isValidTag('delivery', 'not_a_tag')).toBe(false);
    expect(isValidTag('unknown_taxonomy', 'in_person')).toBe(false);

    expect(getTagDescription('delivery', 'hybrid')).toContain('combination');
    expect(getTagDescription('disability', 'deaf')).toContain('Deaf');
    expect(getTagDescription('delivery', 'does_not_exist')).toBeNull();
    expect(getTagDescription('does_not_exist', 'any')).toBeNull();
  });

  it('returns only common tags and keeps option groups consistent', () => {
    const commonDelivery = getCommonTags('delivery');
    const commonDisability = getCommonTags('disability');

    expect(commonDelivery.length).toBeGreaterThan(0);
    expect(commonDelivery.every((tag) => tag.common)).toBe(true);
    expect(commonDisability.every((tag) => tag.common)).toBe(true);
    expect(getCommonTags('unknown_taxonomy')).toEqual([]);

    expect(CAPACITY_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      'available',
      'limited',
      'waitlist',
      'closed',
    ]);
    expect(PARKING_OPTIONS.map((o) => o.value)).toEqual([
      'yes',
      'no',
      'street_only',
      'paid',
      'unknown',
    ]);
    expect(DIETARY_AVAILABILITY_OPTIONS.map((o) => o.value)).toEqual([
      'always',
      'by_request',
      'limited',
      'seasonal',
    ]);
  });

  it('exports all taxonomy bundles for downstream prompt/build consumers', () => {
    expect(ALL_TAXONOMIES.serviceAttributes).toBe(SERVICE_ATTRIBUTES_TAXONOMY);
    expect(ALL_TAXONOMIES.serviceAdaptations).toBe(SERVICE_ADAPTATIONS_TAXONOMY);
    expect(ALL_TAXONOMIES.capacityStatus).toBe(CAPACITY_STATUS_OPTIONS);
    expect(ALL_TAXONOMIES.parking).toBe(PARKING_OPTIONS);
    expect(ALL_TAXONOMIES.dietaryAvailability).toBe(DIETARY_AVAILABILITY_OPTIONS);
  });
});
