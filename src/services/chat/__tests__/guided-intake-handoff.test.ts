// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearGuidedIntakeRetry,
  consumeGuidedIntakeHandoff,
  GUIDED_INTAKE_HANDOFF_KEY,
  MAX_GUIDED_INTAKE_RETRY_BLOCK_MS,
  readGuidedIntakeRetry,
  readGuidedIntakeRetryBlockedUntil,
  writeGuidedIntakeHandoff,
  writeGuidedIntakeRetry,
  writeGuidedIntakeRetryBlockedUntil,
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

  it('enforces the shared maximum retry-block duration at the storage boundary', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const now = Date.parse('2026-08-09T01:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const maximumDeadline = now + MAX_GUIDED_INTAKE_RETRY_BLOCK_MS;
      expect(writeGuidedIntakeRetryBlockedUntil(sessionId, maximumDeadline)).toBe(true);
      expect(readGuidedIntakeRetryBlockedUntil(sessionId)).toBe(maximumDeadline);
      expect(writeGuidedIntakeRetryBlockedUntil(sessionId, maximumDeadline + 1)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
