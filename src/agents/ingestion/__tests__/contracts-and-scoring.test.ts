import { describe, expect, test } from 'vitest';

import {
  AuditEventSchema,
  EvidenceSnapshotSchema,
  ExtractedCandidateSchema,
  VerificationCheckResultSchema,
} from '../contracts';
import { computeExtractKeySha256 } from '../dedupe';
import {
  computeConfidenceScore,
  computeReverifyCadenceDays,
  computeReviewSlaHours,
  computeScoreBreakdown,
  CONFIDENCE_TIER_THRESHOLDS,
  getConfidenceTier,
  getTierDisplayInfo,
  hasFailingCriticalChecks,
  isReadyForPublish,
} from '../scoring';

describe('ingestion contracts', () => {
  test('EvidenceSnapshotSchema validates hash + status', () => {
    const parsed = EvidenceSnapshotSchema.parse({
      evidenceId: 'ev1',
      canonicalUrl: 'https://example.org/a',
      fetchedAt: '2026-03-02T00:00:00Z',
      httpStatus: 200,
      contentHashSha256: 'a'.repeat(64),
    });

    expect(parsed.httpStatus).toBe(200);
  });

  test('ExtractedCandidateSchema requires minimal fields', () => {
    const extractKey = computeExtractKeySha256('https://example.org/a', 'b'.repeat(64));

    const parsed = ExtractedCandidateSchema.parse({
      extractionId: 'x1',
      candidateId: 'c1',
      extractKeySha256: extractKey,
      extractedAt: '2026-03-02T00:00:00Z',
      review: {
        status: 'pending',
        timers: { reviewBy: '2026-03-03T00:00:00Z' },
        jurisdiction: { kind: 'local', stateProvince: 'CA', city: 'Los Angeles' },
        assignedToRole: 'community_admin',
        assignedToKey: 'US-CA',
      },
      fields: {
        organizationName: 'Org',
        serviceName: 'Service',
        description: 'Desc',
        isRemoteService: true,
        phones: [{ number: '+1-555-555-5555', type: 'voice', context: 'Main line' }],
      },
      investigation: {
        canonicalUrl: 'https://example.org/a',
        discoveredLinks: [
          {
            url: 'https://example.org/apply',
            type: 'apply',
            evidenceId: 'ev1',
            label: 'Apply now',
          },
        ],
        importantArtifacts: ['blob://evidence/ev1.pdf'],
      },
      provenance: {},
    });

    expect(parsed.fields.organizationName).toBe('Org');
  });

  test('VerificationCheckResultSchema enforces enums', () => {
    const parsed = VerificationCheckResultSchema.parse({
      checkId: 'chk1',
      extractionId: 'x1',
      checkType: 'domain_allowlist',
      severity: 'critical',
      status: 'pass',
      ranAt: '2026-03-02T00:00:00Z',
      details: {},
      evidenceRefs: [],
    });

    expect(parsed.status).toBe('pass');
  });

  test('AuditEventSchema requires correlation + target', () => {
    const parsed = AuditEventSchema.parse({
      eventId: 'ae1',
      correlationId: 'corr1',
      eventType: 'review.status_changed',
      actorType: 'system',
      actorId: 'agent',
      targetType: 'extraction',
      targetId: 'x1',
      timestamp: '2026-03-02T00:00:00Z',
      inputs: {},
      outputs: {},
      evidenceRefs: [],
    });

    expect(parsed.eventType).toBe('review.status_changed');
  });
});

describe('confidence scoring', () => {
  test('score is bounded 0..100', () => {
    const score = computeConfidenceScore({
      sourceAllowlisted: true,
      requiredFieldsPresent: true,
      hasEvidenceSnapshot: true,
      verificationChecks: [
        {
          checkId: '1',
          extractionId: 'x',
          checkType: 'domain_allowlist',
          severity: 'critical',
          status: 'pass',
          ranAt: '2026-03-02T00:00:00Z',
          details: {},
          evidenceRefs: [],
        },
        {
          checkId: '2',
          extractionId: 'x',
          checkType: 'policy_constraints',
          severity: 'warning',
          status: 'fail',
          ranAt: '2026-03-02T00:00:00Z',
          details: {},
          evidenceRefs: [],
        },
      ],
    });

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('detects failing critical checks', () => {
    const hasCriticalFail = hasFailingCriticalChecks([
      {
        checkId: '1',
        extractionId: 'x',
        checkType: 'domain_allowlist',
        severity: 'critical',
        status: 'fail',
        ranAt: '2026-03-02T00:00:00Z',
        details: {},
        evidenceRefs: [],
      },
    ]);

    expect(hasCriticalFail).toBe(true);
  });
});

describe('confidence tiers', () => {
  test('tier thresholds are correct', () => {
    expect(CONFIDENCE_TIER_THRESHOLDS.green).toBe(80);
    expect(CONFIDENCE_TIER_THRESHOLDS.yellow).toBe(60);
    expect(CONFIDENCE_TIER_THRESHOLDS.orange).toBe(40);
    expect(CONFIDENCE_TIER_THRESHOLDS.red).toBe(0);
  });

  test('getConfidenceTier returns correct tier', () => {
    expect(getConfidenceTier(100)).toBe('green');
    expect(getConfidenceTier(80)).toBe('green');
    expect(getConfidenceTier(79)).toBe('yellow');
    expect(getConfidenceTier(60)).toBe('yellow');
    expect(getConfidenceTier(59)).toBe('orange');
    expect(getConfidenceTier(40)).toBe('orange');
    expect(getConfidenceTier(39)).toBe('red');
    expect(getConfidenceTier(0)).toBe('red');
  });

  test('getTierDisplayInfo returns correct info', () => {
    const green = getTierDisplayInfo('green');
    expect(green.label).toBe('Ready');
    expect(green.color).toBe('#22c55e');

    const red = getTierDisplayInfo('red');
    expect(red.label).toBe('Incomplete');
    expect(red.color).toBe('#ef4444');
  });

  test('computeScoreBreakdown provides detailed breakdown', () => {
    const result = computeScoreBreakdown({
      sourceAllowlisted: true,
      requiredFieldsPresent: true,
      hasEvidenceSnapshot: true,
      verificationChecks: [],
    });

    expect(result.score).toBe(60);
    expect(result.tier).toBe('yellow');
    expect(result.breakdown.length).toBeGreaterThan(0);
    expect(result.breakdown.find((b) => b.label === 'Evidence snapshot')?.points).toBe(20);
  });

  test('isReadyForPublish requires green tier and no critical failures', () => {
    expect(isReadyForPublish(85, [])).toBe(true);
    expect(isReadyForPublish(75, [])).toBe(false); // Not green
    expect(
      isReadyForPublish(85, [
        {
          checkId: '1',
          extractionId: 'x',
          checkType: 'domain_allowlist',
          severity: 'critical',
          status: 'fail',
          ranAt: '2026-03-02T00:00:00Z',
          details: {},
          evidenceRefs: [],
        },
      ])
    ).toBe(false); // Critical failure
  });

  test('computeReverifyCadenceDays varies by tier', () => {
    expect(computeReverifyCadenceDays(85)).toBe(180); // green = 6 months
    expect(computeReverifyCadenceDays(70)).toBe(90);  // yellow = 3 months
    expect(computeReverifyCadenceDays(50)).toBe(30);  // orange = 1 month
    expect(computeReverifyCadenceDays(20)).toBe(14);  // red = 2 weeks
  });

  test('computeReviewSlaHours varies by tier and critical failures', () => {
    // Critical failure always gets 24h SLA
    expect(computeReviewSlaHours(85, true)).toBe(24);
    expect(computeReviewSlaHours(20, true)).toBe(24);

    // Without critical failure, varies by tier
    expect(computeReviewSlaHours(85, false)).toBe(168); // green = 7 days (low priority)
    expect(computeReviewSlaHours(70, false)).toBe(72);  // yellow = 3 days
    expect(computeReviewSlaHours(50, false)).toBe(48);  // orange = 2 days
    expect(computeReviewSlaHours(20, false)).toBe(168); // red = 7 days (needs work first)
  });

  test('checklist completion affects score', () => {
    const baseInputs = {
      sourceAllowlisted: true,
      requiredFieldsPresent: true,
      hasEvidenceSnapshot: true,
      verificationChecks: [],
    };

    // Without checklist
    const scoreNoChecklist = computeConfidenceScore(baseInputs);

    // With incomplete checklist
    const scoreIncomplete = computeConfidenceScore({
      ...baseInputs,
      checklist: [
        { key: 'contact_method', required: true, status: 'missing', missingFields: [], evidenceRefs: [] },
        { key: 'hours', required: true, status: 'satisfied', missingFields: [], evidenceRefs: [] },
      ],
    });

    // With complete checklist
    const scoreComplete = computeConfidenceScore({
      ...baseInputs,
      checklist: [
        { key: 'contact_method', required: true, status: 'satisfied', missingFields: [], evidenceRefs: [] },
        { key: 'hours', required: true, status: 'satisfied', missingFields: [], evidenceRefs: [] },
      ],
    });

    expect(scoreComplete).toBeGreaterThan(scoreIncomplete);
    expect(scoreComplete).toBe(scoreNoChecklist + 20); // Full checklist bonus
  });
});

