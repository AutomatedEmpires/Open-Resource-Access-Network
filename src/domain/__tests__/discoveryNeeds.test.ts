import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_NEEDS,
  QUICK_DISCOVERY_NEEDS,
  getDiscoveryNeedLabel,
  getPrimaryDiscoveryNeedId,
  getDiscoveryNeedSearchText,
  isDiscoveryNeedSearchText,
  resolveDiscoveryNeedId,
} from '../discoveryNeeds';

describe('discoveryNeeds', () => {
  it('resolves canonical ids, labels, and legacy aliases to the same need id', () => {
    expect(resolveDiscoveryNeedId('food_assistance')).toBe('food_assistance');
    expect(resolveDiscoveryNeedId('Food')).toBe('food_assistance');
    expect(resolveDiscoveryNeedId('food assistance')).toBe('food_assistance');
    expect(resolveDiscoveryNeedId('mental health')).toBe('mental_health');
    expect(resolveDiscoveryNeedId('legal aid')).toBe('legal_aid');
  });

  it('returns stable label and search text projections for a need', () => {
    expect(getDiscoveryNeedLabel('utility_assistance')).toBe('Utilities');
    expect(getDiscoveryNeedSearchText('utility_assistance')).toBe('utility assistance');
  });

  it('detects when a query is just the active need search text', () => {
    expect(isDiscoveryNeedSearchText('food_assistance', 'food')).toBe(true);
    expect(isDiscoveryNeedSearchText('food_assistance', 'Food')).toBe(true);
    expect(isDiscoveryNeedSearchText('food_assistance', 'food assistance')).toBe(false);
  });

  it('keeps quick-chip needs as a strict subset of the full registry', () => {
    expect(QUICK_DISCOVERY_NEEDS.length).toBeGreaterThan(0);
    expect(QUICK_DISCOVERY_NEEDS.length).toBeLessThan(DISCOVERY_NEEDS.length);
    expect(QUICK_DISCOVERY_NEEDS.every((need) => need.quickChip)).toBe(true);
  });

  it('picks the first valid canonical discovery need from mixed values', () => {
    expect(getPrimaryDiscoveryNeedId(['not_real', 'Food', 'housing'])).toBe('food_assistance');
    expect(getPrimaryDiscoveryNeedId(['', null, undefined])).toBeNull();
  });
});
