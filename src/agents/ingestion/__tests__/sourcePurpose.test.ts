import { describe, expect, it } from 'vitest';

import { evaluateStandaloneResourceUse } from '../sourcePurpose';

describe('source purpose', () => {
  it.each(['service_catalog', 'program_navigation'] as const)(
    'allows %s to produce standalone resources',
    (resourcePurpose) => {
      expect(evaluateStandaloneResourceUse({ resourcePurpose })).toEqual(
        expect.objectContaining({ allowed: true, purpose: resourcePurpose }),
      );
    },
  );

  it.each(['supporting_reference', 'excluded'] as const)(
    'blocks %s from standalone publication',
    (resourcePurpose) => {
      expect(evaluateStandaloneResourceUse({ resourcePurpose })).toEqual(
        expect.objectContaining({ allowed: false, purpose: resourcePurpose }),
      );
    },
  );

  it('keeps legacy sources compatible as service catalogs', () => {
    expect(evaluateStandaloneResourceUse({})).toEqual(
      expect.objectContaining({ allowed: true, purpose: 'service_catalog' }),
    );
  });
});
