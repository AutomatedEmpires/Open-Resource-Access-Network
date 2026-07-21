import { describe, expect, it, vi } from 'vitest';
import {
  checkCrisisContentSafety,
  CRISIS_DISTRESS_SIGNALS,
  hasDistressSignals,
} from '../contentSafety';

describe('provider-independent crisis signals', () => {
  it('does not classify ordinary civic-resource requests as distress', () => {
    for (const message of [
      'I need help finding food',
      'Where is the nearest shelter?',
      'Can you help me with housing assistance?',
      'I need a doctor appointment',
      'Looking for childcare near me',
    ]) {
      expect(hasDistressSignals(message), `Expected false for: "${message}"`).toBe(false);
    }
  });

  it('detects indirect distress language locally and case-insensitively', () => {
    for (const message of [
      'I FEEL HOPELESS about everything',
      'I want to disappear',
      'nobody would miss me if I was gone',
      "I can't do this anymore",
      "I don't see a way out",
      'I don’t see a way out',
      "I've given up on life",
      "I'm at my breaking point",
    ]) {
      expect(hasDistressSignals(message), `Expected true for: "${message}"`).toBe(true);
    }
  });

  it('keeps the compatibility helper deterministic and network-free', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(checkCrisisContentSafety('Nobody would miss me')).resolves.toBe(true);
    await expect(checkCrisisContentSafety('I need food assistance')).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('retains the reviewed indirect-signal catalog', () => {
    expect(CRISIS_DISTRESS_SIGNALS.length).toBeGreaterThan(0);
    expect(CRISIS_DISTRESS_SIGNALS.some((signal) => signal.includes('hopeless'))).toBe(true);
    expect(CRISIS_DISTRESS_SIGNALS.some((signal) => signal.includes('miss me'))).toBe(true);
    expect(CRISIS_DISTRESS_SIGNALS.some((signal) => signal.includes('way out'))).toBe(true);
  });
});
