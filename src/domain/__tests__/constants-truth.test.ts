import { describe, expect, it } from 'vitest';

import { ELIGIBILITY_DISCLAIMER } from '@/domain/constants';
import en from '@/locales/en.json';

describe('public trust language', () => {
  it('describes publication authority without claiming every record is verified', () => {
    const disclaimers = [ELIGIBILITY_DISCLAIMER, en.chat.disclaimer.eligibility];

    for (const disclaimer of disclaimers) {
      expect(disclaimer).toContain('published service records');
      expect(disclaimer).toContain("ORAN's catalog");
      expect(disclaimer).toContain('does not guarantee qualification');
      expect(disclaimer).toContain('confirm with the provider');
      expect(disclaimer).not.toMatch(/source-backed/i);
      expect(disclaimer).not.toMatch(/(?:all|every).*verified|verified.*(?:all|every)/i);
    }
  });

  it('keeps missing confidence distinct from provider verification', () => {
    expect(en.service.confidence.unverified).toBe('Confidence not scored');
  });
});
