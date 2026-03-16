import { describe, expect, it } from 'vitest';

import {
  classifyFeedHealth,
  parseArgs,
  summarizeDecisionReasons,
} from '../../../scripts/run-211-feed-status-report.mjs';

describe('run-211-feed-status-report helpers', () => {
  it('parses command line flags', () => {
    expect(
      parseArgs(['--feed-id', 'feed-1', '--hours', '24', '--format', 'markdown', '--out', 'status.md', '--include-inactive']),
    ).toEqual({
      feedId: 'feed-1',
      hours: 24,
      format: 'markdown',
      out: 'status.md',
      includeInactive: true,
    });
  });

  it('summarizes decision reasons in descending count order', () => {
    expect(
      summarizeDecisionReasons({
        auto_publish_approval_missing: 3,
        missing_required_location: 1,
        ignored_zero: 0,
      }),
    ).toEqual([
      { reason: 'auto_publish_approval_missing', count: 3 },
      { reason: 'missing_required_location', count: 1 },
    ]);
  });

  it('classifies paused and failed feeds ahead of freshness checks', () => {
    expect(
      classifyFeedHealth({
        emergencyPause: true,
        isActive: true,
        lastAttemptStatus: 'succeeded',
        lastAttemptCompletedAt: '2026-03-16T00:00:00.000Z',
        refreshIntervalHours: 24,
        replayFromCursor: null,
      }),
    ).toEqual({ status: 'paused', reason: 'emergency_pause', ageHours: null });

    expect(
      classifyFeedHealth(
        {
          emergencyPause: false,
          isActive: true,
          lastAttemptStatus: 'failed',
          lastAttemptCompletedAt: '2026-03-15T00:00:00.000Z',
          refreshIntervalHours: 24,
          replayFromCursor: null,
        },
        new Date('2026-03-16T00:00:00.000Z'),
      ).status,
    ).toBe('degraded');
  });

  it('classifies replay-pending and overdue feeds as attention', () => {
    expect(
      classifyFeedHealth(
        {
          emergencyPause: false,
          isActive: true,
          lastAttemptStatus: 'succeeded',
          lastAttemptCompletedAt: '2026-03-16T00:00:00.000Z',
          refreshIntervalHours: 24,
          replayFromCursor: '120',
        },
        new Date('2026-03-16T04:00:00.000Z'),
      ),
    ).toEqual({ status: 'attention', reason: 'replay_pending', ageHours: 4 });

    expect(
      classifyFeedHealth(
        {
          emergencyPause: false,
          isActive: true,
          lastAttemptStatus: 'succeeded',
          lastAttemptCompletedAt: '2026-03-10T00:00:00.000Z',
          refreshIntervalHours: 24,
          replayFromCursor: null,
        },
        new Date('2026-03-16T00:00:00.000Z'),
      ).reason,
    ).toBe('poll_overdue');
  });

  it('classifies recent successful feeds as healthy', () => {
    expect(
      classifyFeedHealth(
        {
          emergencyPause: false,
          isActive: true,
          lastAttemptStatus: 'succeeded',
          lastAttemptCompletedAt: '2026-03-16T10:00:00.000Z',
          refreshIntervalHours: 24,
          replayFromCursor: null,
        },
        new Date('2026-03-16T12:00:00.000Z'),
      ),
    ).toEqual({ status: 'healthy', reason: 'recent_success', ageHours: 2 });
  });
});
