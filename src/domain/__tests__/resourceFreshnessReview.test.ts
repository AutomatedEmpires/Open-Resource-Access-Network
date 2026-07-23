import { describe, expect, it } from 'vitest';

import {
  deriveResourceFreshnessReviewPacket,
  requiredActionForResourceFreshnessSignal,
  resourceFreshnessOutcomeError,
  resourceFreshnessPayloadPacketSchema,
  resourceFreshnessReviewPacketSchema,
  resourceFreshnessReviewTimingError,
  type ResourceFreshnessPayloadPacket,
  type ResourceFreshnessReview,
  type ResourceFreshnessSignal,
} from '@/domain/resourceFreshnessReview';

const FINDING_ID = '22222222-2222-4222-8222-222222222222';

/** Exact replica of what main's scanner writes (buildEvidence + findingId). */
function flatPacket(overrides: Partial<ResourceFreshnessPayloadPacket> = {}): ResourceFreshnessPayloadPacket {
  return {
    findingId: FINDING_ID,
    scannerVersion: 1,
    signalType: 'stale_source',
    detectedAsOf: '2026-07-13T12:00:00.000Z',
    signalObservedAt: '2026-01-01T00:00:00.000Z',
    freshnessThresholdDays: 180,
    serviceUpdatedAt: '2026-07-01T00:00:00.000Z',
    lastSourceRefreshAt: '2026-01-01T00:00:00.000Z',
    lastCandidateVerifiedAt: null,
    lastManualVerificationAt: null,
    reverifyAt: null,
    scheduleCount: 0,
    datedScheduleCount: 0,
    maxValidTo: null,
    ...overrides,
  };
}

describe('resourceFreshnessPayloadPacketSchema', () => {
  it('accepts the exact shape the scanner writes', () => {
    expect(resourceFreshnessPayloadPacketSchema.safeParse(flatPacket()).success).toBe(true);
  });

  it('rejects unknown keys, wrong versions, bad ids, and schedule contradictions', () => {
    expect(resourceFreshnessPayloadPacketSchema.safeParse({
      ...flatPacket(), extra: true,
    }).success).toBe(false);
    expect(resourceFreshnessPayloadPacketSchema.safeParse(
      flatPacket({ scannerVersion: 2 as never }),
    ).success).toBe(false);
    expect(resourceFreshnessPayloadPacketSchema.safeParse(
      flatPacket({ findingId: 'not-a-uuid' }),
    ).success).toBe(false);
    expect(resourceFreshnessPayloadPacketSchema.safeParse(
      flatPacket({ scheduleCount: 1, datedScheduleCount: 2 }),
    ).success).toBe(false);
  });
});

describe('deriveResourceFreshnessReviewPacket', () => {
  const signalFixtures: Record<ResourceFreshnessSignal, Partial<ResourceFreshnessPayloadPacket>> = {
    explicit_expiry: { scheduleCount: 2, datedScheduleCount: 2, maxValidTo: '2026-06-30' },
    reverification_due: {},
    stale_source: {},
    unknown_source: {},
  };

  it.each(Object.keys(signalFixtures) as ResourceFreshnessSignal[])(
    'derives a structured packet that passes the strict review schema for %s',
    (signalType) => {
      const flat = flatPacket({ signalType, ...signalFixtures[signalType] });

      const derived = deriveResourceFreshnessReviewPacket(flat);

      expect(resourceFreshnessReviewPacketSchema.safeParse(derived).success).toBe(true);
      expect(derived.signal).toBe(signalType);
      expect(derived.requiredAction).toBe(requiredActionForResourceFreshnessSignal(signalType));
      expect(derived.hold.reason).toBe(`resource_freshness:${signalType}:${FINDING_ID}`);
      expect(derived.reviewRequirements.scheduleCorrectionRequiredBeforeApproval)
        .toBe(signalType === 'explicit_expiry');
      expect(derived.observed.schedule.totalCount).toBe(flat.scheduleCount);
    },
  );

  it('fails loudly when an explicit expiry lacks a fully dated schedule', () => {
    expect(() => deriveResourceFreshnessReviewPacket(
      flatPacket({ signalType: 'explicit_expiry', scheduleCount: 0, datedScheduleCount: 0, maxValidTo: null }),
    )).toThrow();
  });
});

describe('review timing and outcome helpers', () => {
  const now = new Date('2026-07-20T00:00:00.000Z');

  it('rejects future and long-stale verification instants', () => {
    expect(resourceFreshnessReviewTimingError('2026-07-20T00:06:00.000Z', now)).toContain('future');
    expect(resourceFreshnessReviewTimingError('2026-07-15T00:00:00.000Z', now)).toBeNull();
    expect(resourceFreshnessReviewTimingError('2026-06-21T00:00:00.000Z', now)).toBeNull();
    expect(resourceFreshnessReviewTimingError('2026-06-01T00:00:00.000Z', now)).toContain('30 days');
  });

  function review(overrides: Partial<ResourceFreshnessReview> = {}): ResourceFreshnessReview {
    return {
      schemaVersion: 1,
      outcome: 'confirmed_current',
      verificationMethod: 'provider_phone',
      contactChannel: 'phone',
      checkedAt: '2026-07-15T00:00:00.000Z',
      reviewerSummary: 'Called the provider and confirmed availability today.',
      ...overrides,
    };
  }

  it('binds outcomes to the packet signal', () => {
    const stale = deriveResourceFreshnessReviewPacket(flatPacket());
    expect(resourceFreshnessOutcomeError(stale, review())).toBeNull();
    expect(resourceFreshnessOutcomeError(stale, review({
      checkedAt: '2026-07-01T00:00:00.000Z',
    }))).toContain('detected');

    const expiry = deriveResourceFreshnessReviewPacket(flatPacket({
      signalType: 'explicit_expiry', scheduleCount: 1, datedScheduleCount: 1, maxValidTo: '2026-06-30',
    }));
    expect(resourceFreshnessOutcomeError(expiry, review())).toContain('corrected schedule');
    expect(resourceFreshnessOutcomeError(stale, review({
      outcome: 'corrected',
      scheduleCorrections: [{ scheduleId: FINDING_ID, validFrom: null, validTo: null }],
    }))).toContain('explicit-expiry');
  });
});
