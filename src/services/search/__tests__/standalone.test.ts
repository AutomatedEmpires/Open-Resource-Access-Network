import { describe, expect, it } from 'vitest';

import { isStandaloneSeekerResult } from '../standalone';

function result(name: string, description: string) {
  return {
    service: {
      service: { name, description },
    },
  } as never;
}

describe('isStandaloneSeekerResult', () => {
  it('filters the historical SNAP retailer-only import', () => {
    expect(isStandaloneSeekerResult(result(
      'SNAP/EBT accepted here',
      'Source: USDA FNS SNAP Retailer Locator. This is a place to SPEND SNAP benefits (not a free-food or food-bank site).',
    ))).toBe(false);
  });

  it('keeps direct SNAP application and food-bank services', () => {
    expect(isStandaloneSeekerResult(result(
      'SNAP application assistance',
      'Benefits navigators help residents apply for SNAP.',
    ))).toBe(true);
    expect(isStandaloneSeekerResult(result(
      'Community food bank',
      'Free groceries for households facing food insecurity.',
    ))).toBe(true);
  });
});
