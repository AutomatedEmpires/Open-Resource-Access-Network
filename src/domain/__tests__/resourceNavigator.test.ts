import { describe, expect, it } from 'vitest';

import {
  buildGuidedIntakePrompt,
  buildGuidedIntakeSubmission,
  formatVerificationStatus,
  needsVerificationWarning,
  ORAN_USER_TYPES,
  RESOURCE_SERVICE_GROUPS,
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
    expect(buildGuidedIntakePrompt({ need: '!!!' })).toBe('');
    expect(buildGuidedIntakeSubmission({ need: '???' })).toBeNull();
    expect(buildGuidedIntakePrompt({ need: '住房帮助' })).toBe('住房帮助.');
  });

  it('keeps readable intake context separate from deterministic retrieval text', () => {
    expect(buildGuidedIntakeSubmission({
      need: '  utility   bill help ',
      location: ' 48201 ',
      urgency: 'today',
      audience: 'self',
      accessMode: 'phone',
    })).toEqual({
      prompt: 'utility bill help. Near 48201. I need help today. This is for me. I need help I can reach by phone.',
      searchText: 'utility bill help',
      location: '48201',
      urgency: 'today',
      audience: 'self',
      accessMode: 'phone',
    });
  });

  it('formats and identifies warning verification states', () => {
    expect(formatVerificationStatus('provider_verified')).toBe('Provider Verified');
    expect(needsVerificationWarning('source_verified')).toBe(false);
    expect(needsVerificationWarning('stale')).toBe(true);
    expect(needsVerificationWarning(undefined)).toBe(true);
  });

  it('keeps founder audiences and service groups explicit without inventing new RBAC roles', () => {
    expect(ORAN_USER_TYPES.map((audience) => audience.id)).toEqual([
      'government',
      'seeker',
      'admin',
      'business',
      'community_volunteer',
      'partner',
    ]);
    expect(ORAN_USER_TYPES.find((audience) => audience.id === 'government')?.workspace).toBe('organization');
    expect(RESOURCE_SERVICE_GROUPS.flatMap((group) => group.examples)).toEqual(expect.arrayContaining([
      'SNAP',
      'Medicaid',
      'Food banks',
      'Electricity',
      'Sliding-scale dental',
    ]));
  });
});
