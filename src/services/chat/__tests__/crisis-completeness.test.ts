/**
 * Crisis Detection Completeness Tests
 *
 * Safety-critical: every keyword in CRISIS_KEYWORDS must trigger detection.
 * If any keyword is missed, a user in crisis may not be routed to 911/988/211.
 */

import { describe, it, expect } from 'vitest';
import { detectCrisis } from '@/services/chat/orchestrator';
import { CRISIS_KEYWORDS } from '@/domain/constants';

describe('crisis detection completeness', () => {
  it('every single CRISIS_KEYWORD triggers detection', () => {
    const missed: string[] = [];

    for (const keyword of CRISIS_KEYWORDS) {
      const detected = detectCrisis(`I am ${keyword} right now`);
      if (!detected) {
        missed.push(keyword);
      }
    }

    expect(missed).toEqual([]);
  });

  it('crisis keywords are case-insensitive', () => {
    for (const keyword of CRISIS_KEYWORDS) {
      expect(detectCrisis(keyword.toUpperCase())).toBe(true);
    }
  });

  it('crisis keywords are detected as substring (no word boundary required)', () => {
    // e.g., "suicidal" should match inside "feeling suicidal tonight"
    expect(detectCrisis('feeling suicidal tonight')).toBe(true);
    expect(detectCrisis('there is domestic violence in my home')).toBe(true);
  });

  it('normal help-seeking messages do NOT trigger crisis', () => {
    const normalMessages = [
      'I need help finding food',
      'Where is the nearest shelter?',
      'Can you help me with housing?',
      'I lost my job and need employment services',
      'Looking for childcare near me',
      'How do I apply for food stamps?',
      'I need a doctor appointment',
      'Where can I get legal advice?',
    ];

    for (const msg of normalMessages) {
      expect(detectCrisis(msg)).toBe(false);
    }
  });

  it('CRISIS_KEYWORDS list is not empty', () => {
    expect(CRISIS_KEYWORDS.length).toBeGreaterThan(0);
  });

  it('CRISIS_KEYWORDS contains core categories: suicide, domestic violence, overdose', () => {
    const keywords = CRISIS_KEYWORDS.map(k => k.toLowerCase());
    expect(keywords).toContain('suicide');
    expect(keywords).toContain('domestic violence');
    expect(keywords).toContain('overdose');
  });
});
