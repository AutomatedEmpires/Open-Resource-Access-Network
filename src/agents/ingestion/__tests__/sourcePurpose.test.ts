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

  it.each([undefined, null, {}, { resourcePurpose: 'not-a-purpose' }])(
    'fails closed when source purpose is missing or invalid',
    (source) => {
      expect(evaluateStandaloneResourceUse(source)).toEqual(
        expect.objectContaining({ allowed: false, purpose: 'unclassified' }),
      );
    },
  );

  it('never treats an unclassified SNAP retailer source as a service catalog', () => {
    expect(evaluateStandaloneResourceUse({ resourcePurpose: undefined })).toEqual(
      expect.objectContaining({ allowed: false, purpose: 'unclassified' }),
    );
  });
});
