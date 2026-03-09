import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_ATTRIBUTE_LABELS,
  formatDiscoveryAttributeFilters,
  hasMeaningfulDiscoveryContext,
  summarizeDiscoveryContext,
  summarizeServiceAlignment,
} from '../discoveryPresentation';

describe('discovery presentation helpers', () => {
  it('formats shared discovery attribute labels deterministically', () => {
    expect(DISCOVERY_ATTRIBUTE_LABELS.phone).toBe('By Phone');
    expect(formatDiscoveryAttributeFilters({ delivery: ['phone'], access: ['no_id_required'] })).toEqual([
      'By Phone',
      'No ID Required',
    ]);
  });

  it('detects meaningful discovery context and summarizes it for UI display', () => {
    expect(hasMeaningfulDiscoveryContext({})).toBe(false);
    expect(
      summarizeDiscoveryContext(
        {
          text: 'rent help',
          needId: 'housing',
          confidenceFilter: 'HIGH',
          sortBy: 'name_desc',
          taxonomyTermIds: ['tax-1'],
          attributeFilters: { delivery: ['phone'], access: ['no_id_required'] },
        },
        { taxonomyLabelById: { 'tax-1': 'Housing Navigation' }, includeSort: true },
      ).map((chip) => chip.label),
    ).toEqual([
      'Need: Housing',
      'Search: rent help',
      'Trust: High confidence only',
      'Sort: Name (Z-A)',
      'Tag: Housing Navigation',
      'Delivery: By Phone',
      'Access: No ID Required',
    ]);
  });

  it('summarizes only proven service alignments with the active discovery filters', () => {
    const labels = summarizeServiceAlignment(
      {
        service: { id: 'svc-1', organizationId: 'org-1', name: 'Housing Navigation', status: 'active', createdAt: new Date(), updatedAt: new Date() },
        organization: { id: 'org-1', name: 'Helping Hands', status: 'active', createdAt: new Date(), updatedAt: new Date() },
        phones: [],
        schedules: [],
        taxonomyTerms: [
          { id: 'tax-1', term: 'Housing Navigation', createdAt: new Date(), updatedAt: new Date() },
          { id: 'tax-2', term: 'Eviction Prevention', createdAt: new Date(), updatedAt: new Date() },
        ],
        attributes: [
          { id: 'attr-1', serviceId: 'svc-1', taxonomy: 'delivery', tag: 'phone', createdAt: new Date(), updatedAt: new Date() },
          { id: 'attr-2', serviceId: 'svc-1', taxonomy: 'access', tag: 'no_id_required', createdAt: new Date(), updatedAt: new Date() },
          { id: 'attr-3', serviceId: 'svc-1', taxonomy: 'cost', tag: 'free', createdAt: new Date(), updatedAt: new Date() },
        ],
      },
      {
        taxonomyTermIds: ['tax-1'],
        attributeFilters: {
          delivery: ['phone'],
          access: ['no_id_required'],
          cost: ['sliding_scale'],
        },
      },
      { taxonomyLabelById: { 'tax-1': 'Housing Navigation' } },
    );

    expect(labels).toEqual(['By Phone', 'No ID Required', 'Housing Navigation']);
  });
});
