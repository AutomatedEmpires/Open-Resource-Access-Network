// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearGuidedIntakeRetry,
  consumeGuidedIntakeHandoff,
  GUIDED_INTAKE_HANDOFF_KEY,
  readGuidedIntakeRetry,
  writeGuidedIntakeHandoff,
  writeGuidedIntakeRetry,
} from '../guidedIntakeHandoff';

beforeEach(() => {
  sessionStorage.clear();
});

describe('guided intake handoff', () => {
  it('consumes and deletes a validated session-only handoff', () => {
    const submission = {
      prompt: 'Utility bill help. Near 48201. I need help today. I need help I can reach by phone.',
      searchText: 'Utility bill help',
      location: '48201',
      urgency: 'today' as const,
      accessMode: 'phone' as const,
    };

    expect(writeGuidedIntakeHandoff(submission)).toBe(true);
    expect(consumeGuidedIntakeHandoff()).toEqual(submission);
    expect(sessionStorage.getItem(GUIDED_INTAKE_HANDOFF_KEY)).toBeNull();
    expect(consumeGuidedIntakeHandoff()).toBeNull();
  });

  it('drops malformed handoff data instead of exposing it to chat', () => {
    sessionStorage.setItem(GUIDED_INTAKE_HANDOFF_KEY, JSON.stringify({
      prompt: 'Help.',
      searchText: '',
      unexpected: 'private data',
    }));

    expect(consumeGuidedIntakeHandoff()).toBeNull();
    expect(sessionStorage.getItem(GUIDED_INTAKE_HANDOFF_KEY)).toBeNull();
  });

  it('drops punctuation-only retrieval text', () => {
    sessionStorage.setItem(GUIDED_INTAKE_HANDOFF_KEY, JSON.stringify({
      prompt: '.',
      searchText: '!!!',
    }));

    expect(consumeGuidedIntakeHandoff()).toBeNull();
    expect(sessionStorage.getItem(GUIDED_INTAKE_HANDOFF_KEY)).toBeNull();
  });

  it('drops a handoff whose hidden fields contradict the visible prompt', () => {
    sessionStorage.setItem(GUIDED_INTAKE_HANDOFF_KEY, JSON.stringify({
      prompt: 'I need legal aid.',
      searchText: 'Food help',
      location: '48201',
    }));

    expect(consumeGuidedIntakeHandoff()).toBeNull();
    expect(sessionStorage.getItem(GUIDED_INTAKE_HANDOFF_KEY)).toBeNull();
  });

  it('keeps validated retry metadata session-scoped until success or edit clears it', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const submission = {
      prompt: 'Food help. Near Tacoma, WA.',
      searchText: 'Food help',
      location: 'Tacoma, WA',
    };

    expect(writeGuidedIntakeRetry(sessionId, submission)).toBe(true);
    expect(readGuidedIntakeRetry(sessionId)).toEqual(submission);

    clearGuidedIntakeRetry(sessionId);
    expect(readGuidedIntakeRetry(sessionId)).toBeNull();
  });
});
