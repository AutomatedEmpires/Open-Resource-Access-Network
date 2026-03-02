import { describe, expect, test } from 'vitest';

import {
  AuditEventSchema,
  EvidenceSnapshotSchema,
  ExtractedCandidateSchema,
  VerificationCheckResultSchema,
} from '../contracts';
import { computeExtractKeySha256 } from '../dedupe';
import { computeConfidenceScore, hasFailingCriticalChecks } from '../scoring';

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
