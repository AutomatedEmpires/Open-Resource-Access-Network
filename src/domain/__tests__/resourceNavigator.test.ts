import { describe, expect, it } from 'vitest';

import {
  buildGuidedIntakePrompt,
  formatVerificationStatus,
  needsVerificationWarning,
} from '@/domain/resourceNavigator';

describe('resource navigator contracts', () => {
  it('builds a prompt only from intake details the seeker supplied', () => {
    expect(buildGuidedIntakePrompt({
      need: '  I need help paying rent  ',
      location: 'Coeur d’Alene, ID',
      urgency: 'today',
      audience: 'family',
      accessMode: 'phone',
    })).toBe(
      'I need help paying rent. Near Coeur d’Alene, ID. I need help today. '
      + 'This is for my family or household. I need help I can reach by phone.',
    );
  });

  it('does not invent optional intake context', () => {
    expect(buildGuidedIntakePrompt({ need: 'Food assistance' })).toBe('Food assistance.');
    expect(buildGuidedIntakePrompt({ need: '   ' })).toBe('');
  });

  it('formats and identifies warning verification states', () => {
    expect(formatVerificationStatus('provider_verified')).toBe('Provider Verified');
    expect(needsVerificationWarning('source_verified')).toBe(false);
    expect(needsVerificationWarning('stale')).toBe(true);
    expect(needsVerificationWarning(undefined)).toBe(true);
  });
});
