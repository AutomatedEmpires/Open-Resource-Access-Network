import { describe, expect, it } from 'vitest';

import {
  isHighRiskSourceSystemUpdate,
  isHighRiskSourceUpdate,
} from '../controlChanges';

describe('ingestion control changes', () => {
  it('treats source purpose changes as high-risk authority changes', () => {
    expect(isHighRiskSourceUpdate(
      { trustLevel: 'allowlisted', resourcePurpose: 'service_catalog' },
      { resourcePurpose: 'supporting_reference' },
    )).toBe(true);

    expect(isHighRiskSourceSystemUpdate(
      { trustTier: 'curated', resourcePurpose: 'program_navigation' },
      { resourcePurpose: 'excluded' },
    )).toBe(true);
  });

  it('does not queue unchanged source authority', () => {
    expect(isHighRiskSourceUpdate(
      { trustLevel: 'allowlisted', resourcePurpose: 'service_catalog' },
      { resourcePurpose: 'service_catalog' },
    )).toBe(false);
  });
});
