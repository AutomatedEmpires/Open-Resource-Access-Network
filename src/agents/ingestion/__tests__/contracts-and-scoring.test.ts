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
      fields: {
        organizationName: 'Org',
        serviceName: 'Service',
        description: 'Desc',
        isRemoteService: true,
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
      eventType: 'extract.completed',
      actorType: 'system',
      actorId: 'agent',
      targetType: 'extraction',
      targetId: 'x1',
      timestamp: '2026-03-02T00:00:00Z',
      inputs: {},
      outputs: {},
      evidenceRefs: [],
    });

    expect(parsed.eventType).toBe('extract.completed');
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
