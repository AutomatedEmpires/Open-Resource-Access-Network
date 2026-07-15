import { z } from 'zod';

export const RESOURCE_FRESHNESS_REVIEW_SCHEMA_VERSION = 1 as const;
export const RESOURCE_FRESHNESS_SCANNER_ACTOR = 'system:resource-freshness-scan' as const;

export const resourceFreshnessSignalSchema = z.enum([
  'explicit_expiry',
  'reverification_due',
  'stale_source',
  'unknown_source',
]);

export type ResourceFreshnessSignal = z.infer<typeof resourceFreshnessSignalSchema>;

export const resourceFreshnessRequiredActionSchema = z.enum([
  'correct_expired_schedule',
  'reverify_service_availability',
  'refresh_authoritative_source',
  'establish_source_authority',
]);

export type ResourceFreshnessRequiredAction = z.infer<
  typeof resourceFreshnessRequiredActionSchema
>;

const nullableDateTimeSchema = z.string().datetime({ offset: true }).nullable();
const nullableDateSchema = z.string().date().nullable();

export const resourceFreshnessReviewPacketSchema = z.object({
  schemaVersion: z.literal(RESOURCE_FRESHNESS_REVIEW_SCHEMA_VERSION),
  findingId: z.string().uuid(),
  signal: resourceFreshnessSignalSchema,
  requiredAction: resourceFreshnessRequiredActionSchema,
  hold: z.object({
    actor: z.literal(RESOURCE_FRESHNESS_SCANNER_ACTOR),
    reason: z.string().regex(
      /^resource_freshness:(explicit_expiry|reverification_due|stale_source|unknown_source):[0-9a-f-]{36}$/i,
    ),
  }).strict(),
  observed: z.object({
    detectedAsOf: z.string().datetime({ offset: true }),
    signalObservedAt: z.string().datetime({ offset: true }),
    freshnessThresholdDays: z.number().int().positive().nullable(),
    serviceUpdatedAt: z.string().datetime({ offset: true }),
    lastSourceRefreshAt: nullableDateTimeSchema,
    lastCandidateVerifiedAt: nullableDateTimeSchema,
    lastManualVerificationAt: nullableDateTimeSchema,
    reverifyAt: nullableDateTimeSchema,
    schedule: z.object({
      totalCount: z.number().int().nonnegative(),
      datedCount: z.number().int().nonnegative(),
      maxValidTo: nullableDateSchema,
    }).strict(),
  }).strict(),
  reviewRequirements: z.object({
    evidenceRequired: z.literal(true),
    scheduleCorrectionRequiredBeforeApproval: z.boolean(),
  }).strict(),
}).strict().superRefine((packet, ctx) => {
  const expectedHoldReason = `resource_freshness:${packet.signal}:${packet.findingId}`;
  if (packet.hold.reason.toLowerCase() !== expectedHoldReason.toLowerCase()) {
    ctx.addIssue({
      code: 'custom',
      path: ['hold', 'reason'],
      message: 'Hold reason must identify this exact freshness signal and finding',
    });
  }

  if (packet.requiredAction !== requiredActionForResourceFreshnessSignal(packet.signal)) {
    ctx.addIssue({
      code: 'custom',
      path: ['requiredAction'],
      message: 'Required action must match the freshness signal',
    });
  }

  if (packet.observed.schedule.datedCount > packet.observed.schedule.totalCount) {
    ctx.addIssue({
      code: 'custom',
      path: ['observed', 'schedule', 'datedCount'],
      message: 'datedCount cannot exceed totalCount',
    });
  }

  if (packet.signal === 'explicit_expiry') {
    const schedule = packet.observed.schedule;
    if (
      schedule.totalCount === 0
      || schedule.datedCount !== schedule.totalCount
      || schedule.maxValidTo === null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['observed', 'schedule'],
        message: 'Explicit expiry requires every attached schedule to have a dated expiry',
      });
    }
    if (!packet.reviewRequirements.scheduleCorrectionRequiredBeforeApproval) {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewRequirements', 'scheduleCorrectionRequiredBeforeApproval'],
        message: 'Explicit expiry requires schedule correction before approval',
      });
    }
  } else if (packet.reviewRequirements.scheduleCorrectionRequiredBeforeApproval) {
    ctx.addIssue({
      code: 'custom',
      path: ['reviewRequirements', 'scheduleCorrectionRequiredBeforeApproval'],
      message: 'Schedule correction is only required for explicit expiry findings',
    });
  }
});

export type ResourceFreshnessReviewPacket = z.infer<
  typeof resourceFreshnessReviewPacketSchema
>;

export const resourceFreshnessOutcomeSchema = z.enum([
  'confirmed_current',
  'corrected',
  'confirmed_unavailable',
  'unable_to_verify',
]);

export type ResourceFreshnessOutcome = z.infer<typeof resourceFreshnessOutcomeSchema>;

export const resourceFreshnessVerificationMethodSchema = z.enum([
  'provider_website',
  'provider_phone',
  'provider_email',
  'provider_portal',
  'government_registry',
  'in_person',
  'trusted_partner',
]);

export const resourceFreshnessContactChannelSchema = z.enum([
  'phone',
  'email',
  'in_person',
  'provider_portal',
  'trusted_partner',
]);

export const resourceFreshnessScheduleCorrectionSchema = z.object({
  scheduleId: z.string().uuid(),
  validFrom: nullableDateSchema,
  validTo: nullableDateSchema,
}).strict().superRefine((correction, ctx) => {
  if (
    correction.validFrom
    && correction.validTo
    && correction.validFrom > correction.validTo
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['validTo'],
      message: 'Schedule validity end cannot be before its start',
    });
  }
});

export type ResourceFreshnessScheduleCorrection = z.infer<
  typeof resourceFreshnessScheduleCorrectionSchema
>;

const httpUrlSchema = z.string().url().max(2048).refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}, 'Evidence URL must use HTTP or HTTPS');

export const resourceFreshnessReviewSchema = z.object({
  schemaVersion: z.literal(RESOURCE_FRESHNESS_REVIEW_SCHEMA_VERSION),
  outcome: resourceFreshnessOutcomeSchema,
  verificationMethod: resourceFreshnessVerificationMethodSchema,
  checkedAt: z.string().datetime({ offset: true }),
  evidenceUrl: httpUrlSchema.optional(),
  contactChannel: resourceFreshnessContactChannelSchema.optional(),
  scheduleCorrections: z.array(resourceFreshnessScheduleCorrectionSchema).max(100).optional(),
  reviewerSummary: z.string().trim().min(20).max(2000),
}).strict().superRefine((review, ctx) => {
  if (!review.evidenceUrl && !review.contactChannel) {
    ctx.addIssue({
      code: 'custom',
      path: ['evidenceUrl'],
      message: 'An evidence URL or contact channel is required',
    });
  }

  const expectedContactChannel: Partial<Record<
    z.infer<typeof resourceFreshnessVerificationMethodSchema>,
    z.infer<typeof resourceFreshnessContactChannelSchema>
  >> = {
    provider_phone: 'phone',
    provider_email: 'email',
    in_person: 'in_person',
    trusted_partner: 'trusted_partner',
  };
  const expected = expectedContactChannel[review.verificationMethod];
  if (expected && review.contactChannel !== expected) {
    ctx.addIssue({
      code: 'custom',
      path: ['contactChannel'],
      message: `Verification method ${review.verificationMethod} requires contact channel ${expected}`,
    });
  }

  if (
    (review.verificationMethod === 'provider_website'
      || review.verificationMethod === 'government_registry')
    && !review.evidenceUrl
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['evidenceUrl'],
      message: `Verification method ${review.verificationMethod} requires an evidence URL`,
    });
  }

  if (
    review.verificationMethod === 'provider_portal'
    && review.contactChannel !== 'provider_portal'
    && !review.evidenceUrl
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['contactChannel'],
      message: 'Provider portal verification requires a portal channel or evidence URL',
    });
  }

  const seenScheduleIds = new Set<string>();
  for (const [index, correction] of (review.scheduleCorrections ?? []).entries()) {
    if (seenScheduleIds.has(correction.scheduleId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduleCorrections', index, 'scheduleId'],
        message: 'Each schedule can only be corrected once',
      });
    }
    seenScheduleIds.add(correction.scheduleId);
  }
});

export type ResourceFreshnessReview = z.infer<typeof resourceFreshnessReviewSchema>;

export const RESOURCE_FRESHNESS_OUTCOME_DECISION_MAP = {
  confirmed_current: 'approved',
  corrected: 'approved',
  confirmed_unavailable: 'denied',
  unable_to_verify: 'escalated',
} as const satisfies Record<ResourceFreshnessOutcome, string>;

export function decisionForResourceFreshnessOutcome(
  outcome: ResourceFreshnessOutcome,
): typeof RESOURCE_FRESHNESS_OUTCOME_DECISION_MAP[ResourceFreshnessOutcome] {
  return RESOURCE_FRESHNESS_OUTCOME_DECISION_MAP[outcome];
}

export function requiredActionForResourceFreshnessSignal(
  signal: ResourceFreshnessSignal,
): ResourceFreshnessRequiredAction {
  switch (signal) {
    case 'explicit_expiry':
      return 'correct_expired_schedule';
    case 'reverification_due':
      return 'reverify_service_availability';
    case 'stale_source':
      return 'refresh_authoritative_source';
    case 'unknown_source':
      return 'establish_source_authority';
  }
}

export function resourceFreshnessReviewTimingError(
  checkedAt: string,
  now: Date = new Date(),
): string | null {
  const checkedAtMs = Date.parse(checkedAt);
  const nowMs = now.getTime();
  const fiveMinutesMs = 5 * 60 * 1000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  if (checkedAtMs > nowMs + fiveMinutesMs) {
    return 'checkedAt cannot be in the future';
  }
  if (checkedAtMs < nowMs - thirtyDaysMs) {
    return 'checkedAt must be within the last 30 days';
  }
  return null;
}

export function resourceFreshnessOutcomeError(
  packet: ResourceFreshnessReviewPacket,
  review: ResourceFreshnessReview,
): string | null {
  if (Date.parse(review.checkedAt) < Date.parse(packet.observed.detectedAsOf)) {
    return 'checkedAt must be on or after this freshness finding was detected';
  }

  if (packet.signal === 'explicit_expiry' && review.outcome === 'confirmed_current') {
    return 'Explicit expiry cannot be confirmed current without a corrected schedule';
  }

  if (
    (review.scheduleCorrections?.length ?? 0) > 0
    && (packet.signal !== 'explicit_expiry' || review.outcome !== 'corrected')
  ) {
    return 'Schedule corrections are only accepted for a corrected explicit-expiry finding';
  }

  if (packet.signal === 'explicit_expiry' && review.outcome === 'corrected') {
    const checkedDate = new Date(review.checkedAt).toISOString().slice(0, 10);
    if (review.scheduleCorrections?.some((correction) => (
      correction.validFrom !== null && correction.validFrom > checkedDate
    ))) {
      return 'Corrected schedule start cannot be after the verification date';
    }
    if (review.scheduleCorrections?.some((correction) => (
      correction.validTo !== null && correction.validTo < checkedDate
    ))) {
      return 'Corrected schedule expiry must be on or after the verification date, or have no end date';
    }
  }
  return null;
}
