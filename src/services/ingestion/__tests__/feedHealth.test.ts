import { describe, expect, it } from 'vitest';

import { assessIngestionDegradedMode } from '../feedHealth';

describe('ingestion/feedHealth', () => {
  it('keeps normal mode when feed health is stable', () => {
    expect(
      assessIngestionDegradedMode({
        activeFeeds: 10,
        pausedFeeds: 1,
        failedFeeds: 1,
        autoPublishFeeds: 3,
        silentFeeds: 1,
        silentAutoPublishFeeds: 0,
      }),
    ).toEqual({
      recommended: false,
      severity: 'normal',
      reasons: [],
      freezeAutoPublish: false,
      requireReviewOnly: false,
    });
  });

  it('recommends degraded mode when silent automation is present', () => {
    const result = assessIngestionDegradedMode({
      activeFeeds: 6,
      pausedFeeds: 0,
      failedFeeds: 1,
      autoPublishFeeds: 2,
      silentFeeds: 2,
      silentAutoPublishFeeds: 1,
    });

    expect(result.recommended).toBe(true);
    expect(result.severity).toBe('degraded');
    expect(result.freezeAutoPublish).toBe(true);
    expect(result.requireReviewOnly).toBe(true);
    expect(result.reasons[0]).toContain('auto-publish');
  });

  it('recommends elevated mode for widespread silence without auto-publish drift', () => {
    const result = assessIngestionDegradedMode({
      activeFeeds: 8,
      pausedFeeds: 0,
      failedFeeds: 2,
      autoPublishFeeds: 0,
      silentFeeds: 2,
      silentAutoPublishFeeds: 0,
    });

    expect(result.recommended).toBe(true);
    expect(result.severity).toBe('elevated');
    expect(result.freezeAutoPublish).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('silent'),
        expect.stringContaining('currently failed'),
      ]),
    );
  });
});
