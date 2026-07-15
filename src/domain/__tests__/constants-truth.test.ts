import { describe, expect, it } from 'vitest';

import { ELIGIBILITY_DISCLAIMER } from '@/domain/constants';
import en from '@/locales/en.json';

describe('public trust language', () => {
  it('describes publication authority without claiming every record is verified', () => {
    const disclaimers = [ELIGIBILITY_DISCLAIMER, en.chat.disclaimer.eligibility];

    for (const disclaimer of disclaimers) {
      expect(disclaimer).toContain('source-backed');
      expect(disclaimer).toContain('publication gate');
      expect(disclaimer).not.toMatch(/verified records?/i);
    }
  });

  it('keeps missing confidence distinct from provider verification', () => {
    expect(en.service.confidence.unverified).toBe('Confidence not scored');
  });
});
