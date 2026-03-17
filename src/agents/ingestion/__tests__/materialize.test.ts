import { beforeEach, describe, expect, it, vi } from 'vitest';

import { materializePipelineArtifacts } from '../materialize';
import type { DetailedPipelineExecution } from '../pipeline/types';

function buildExecution(
  overrides: Partial<NonNullable<DetailedPipelineExecution['artifacts']['candidate']>> = {},
): DetailedPipelineExecution {
  return {
    result: {
      sourceUrl: 'https://example.gov/services/pantry',
      canonicalUrl: 'https://example.gov/services/pantry',
      correlationId: 'job-corr-1',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:05.000Z',
      totalDurationMs: 5000,
      stages: [],
      finalStage: 'build_candidate',
      sourceCheck: {
        allowed: true,
        trustLevel: 'allowlisted',
        sourceId: 'src-1',
      },
      evidenceId: 'ev-1',
      extractionId: 'ext-1',
      candidateId: 'cand-1',
      confidenceScore: 84,
      confidenceTier: 'green',
    },
    artifacts: {
      evidence: {
        evidenceId: 'ev-1',
        canonicalUrl: 'https://example.gov/services/pantry',
        fetchedAt: '2026-01-01T00:00:01.000Z',
        httpStatus: 200,
        contentHashSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        contentType: 'text/html',
        contentLength: 2048,
        htmlRaw: '<html></html>',
        textExtracted: 'Pantry details',
        title: 'Food pantry',
        metaDescription: 'Example pantry',
        language: 'en',
      },
      candidate: {
        candidateId: 'cand-1',
        extractionId: 'ext-1',
        extractKeySha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        extractedAt: '2026-01-01T00:00:02.000Z',
        organizationName: 'Example Community Action',
        serviceName: 'Food Pantry',
        description: 'Emergency food boxes for families.',
        websiteUrl: 'https://example.gov/services/pantry',
        phone: '(206) 555-0100',
        address: {
          line1: '123 Main St',
          city: 'Seattle',
          region: 'WA',
          postalCode: '98101',
          country: 'US',
        },
        isRemoteService: false,
        fieldConfidences: {
          organizationName: 92,
          serviceName: 95,
        },
        categoryTags: [
          {
            tagType: 'category',
            tagValue: 'food',
            confidence: 92,
          },
          {
            tagType: 'category',
            tagValue: 'family_support',
            confidence: 65,
          },
        ],
        discoveredLinks: [
          {
            url: 'https://example.gov/services/pantry/apply',
            type: 'apply',
            label: 'Apply now',
            confidence: 91,
            evidenceId: 'ev-1',
          },
        ],
        verificationChecks: [
          {
            checkType: 'domain_allowlist',
            severity: 'critical',
            status: 'pass',
            ranAt: '2026-01-01T00:00:03.000Z',
            details: {},
            evidenceRefs: ['ev-1'],
            extractionId: 'ext-1',
          },
          {
            checkType: 'contact_validity',
            severity: 'warning',
            status: 'pass',
            ranAt: '2026-01-01T00:00:03.000Z',
            details: {},
            evidenceRefs: ['ev-1'],
            extractionId: 'ext-1',
          },
        ],
        verificationChecklist: [
          {
            key: 'contact_method',
            required: true,
            status: 'satisfied',
            missingFields: [],
            evidenceRefs: ['ev-1'],
          },
          {
            key: 'physical_address_or_virtual',
            required: true,
            status: 'satisfied',
            missingFields: [],
            evidenceRefs: ['ev-1'],
          },
          {
            key: 'service_area',
            required: true,
            status: 'missing',
            missingFields: ['county'],
            evidenceRefs: ['ev-1'],
          },
          {
            key: 'eligibility_criteria',
            required: true,
            status: 'satisfied',
            missingFields: [],
            evidenceRefs: ['ev-1'],
          },
          {
            key: 'hours',
            required: true,
            status: 'missing',
            missingFields: ['days'],
            evidenceRefs: ['ev-1'],
          },
          {
            key: 'source_provenance',
            required: true,
            status: 'satisfied',
            missingFields: [],
            evidenceRefs: ['ev-1'],
          },
          {
            key: 'duplication_review',
            required: true,
            status: 'satisfied',
            missingFields: [],
            evidenceRefs: ['ev-1'],
          },
          {
            key: 'policy_pass',
            required: true,
            status: 'satisfied',
            missingFields: [],
            evidenceRefs: ['ev-1'],
          },
        ],
        score: {
          overall: 84,
          tier: 'green',
          subScores: {
            verification: 88,
            completeness: 80,
            freshness: 85,
          },
        },
        sourceTrustLevel: 'allowlisted',
        ...overrides,
      },
    },
  };
}

function createStores() {
  return {
    evidence: {
      getById: vi.fn(),
      create: vi.fn(),
    },
    candidates: {
      getByExtractKey: vi.fn(),
      findByNormalizedName: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      updateConfidenceScore: vi.fn(),
    },
    checks: {
      record: vi.fn(),
    },
    tags: {
      replaceByType: vi.fn(),
    },
    tagConfirmations: {
      listForCandidate: vi.fn(),
      bulkCreate: vi.fn(),
    },
    links: {
      listForCandidate: vi.fn(),
      bulkAdd: vi.fn(),
    },
    publishReadiness: {
      upsert: vi.fn(),
    },
  };
}

describe('materializePipelineArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists a new candidate with evidence, tags, checks, links, and readiness state', async () => {
    const stores = createStores();
    stores.evidence.getById.mockResolvedValue(null);
    stores.candidates.getByExtractKey.mockResolvedValue(null);
    stores.tagConfirmations.listForCandidate.mockResolvedValue([]);
    stores.links.listForCandidate.mockResolvedValue([]);

    const result = await materializePipelineArtifacts(stores as never, buildExecution(), {
      jobId: 'job-1',
      correlationId: 'job-corr-1',
    });

    expect(stores.evidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceId: 'ev-1',
        correlationId: 'job-corr-1',
        jobId: 'job-1',
      }),
    );
    expect(stores.candidates.create).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'cand-1',
        review: expect.objectContaining({
          status: 'pending',
          assignedToRole: 'community_admin',
        }),
      }),
    );
    expect(stores.candidates.updateConfidenceScore).toHaveBeenCalledWith('cand-1', 84);
    expect(stores.checks.record).toHaveBeenCalledTimes(2);
    expect(stores.tags.replaceByType).toHaveBeenCalledTimes(5);
    expect(stores.tagConfirmations.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({
        candidateId: 'cand-1',
        tagType: 'category',
        suggestedValue: 'family_support',
        confirmationStatus: 'pending',
      }),
    ]);
    expect(stores.links.bulkAdd).toHaveBeenCalledWith([
      expect.objectContaining({
        candidateId: 'cand-1',
        url: 'https://example.gov/services/pantry/apply',
        linkType: 'apply',
      }),
    ]);
    expect(stores.publishReadiness.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'cand-1',
        isReady: false,
        hasRequiredFields: true,
        hasRequiredTags: true,
        tagsConfirmed: false,
        pendingTagCount: 1,
        blockers: expect.arrayContaining(['pending_tag_confirmation']),
      }),
    );
    expect(result).toEqual({
      candidateId: 'cand-1',
      evidenceId: 'ev-1',
      deduped: false,
      assignedToRole: 'community_admin',
      reviewStatus: 'pending',
    });
  });

  it('dedupes by extract key and escalates quarantine candidates to ORAN admin review', async () => {
    const stores = createStores();
    stores.evidence.getById.mockResolvedValue({
      evidenceId: 'ev-1',
    });
    stores.candidates.getByExtractKey.mockResolvedValue({
      candidateId: 'cand-existing',
      review: {
        status: 'pending',
      },
    });
    stores.tagConfirmations.listForCandidate.mockResolvedValue([
      {
        tagType: 'category',
        suggestedValue: 'food',
        confirmationStatus: 'pending',
      },
    ]);
    stores.links.listForCandidate.mockResolvedValue([
      {
        url: 'https://example.gov/services/pantry/apply',
      },
    ]);

    const result = await materializePipelineArtifacts(
      stores as never,
      buildExecution({
        sourceTrustLevel: 'quarantine',
        score: {
          overall: 42,
          tier: 'orange',
          subScores: {
            verification: 30,
            completeness: 50,
            freshness: 60,
          },
        },
        verificationChecks: [
          {
            checkType: 'domain_allowlist',
            severity: 'critical',
            status: 'fail',
            ranAt: '2026-01-01T00:00:03.000Z',
            details: {},
            evidenceRefs: ['ev-1'],
            extractionId: 'ext-1',
          },
        ],
      }),
      {
        correlationId: 'job-corr-1',
      },
    );

    expect(stores.evidence.create).not.toHaveBeenCalled();
    expect(stores.candidates.update).toHaveBeenCalledWith(
      'cand-existing',
      expect.objectContaining({
        review: expect.objectContaining({
          status: 'escalated',
          assignedToRole: 'oran_admin',
        }),
      }),
    );
    expect(stores.tagConfirmations.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({
        candidateId: 'cand-existing',
        suggestedValue: 'family_support',
        confirmationStatus: 'pending',
      }),
    ]);
    expect(stores.links.bulkAdd).not.toHaveBeenCalled();
    expect(stores.publishReadiness.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'cand-existing',
        isReady: false,
        blockers: expect.arrayContaining([
          'quarantine_source',
          'critical_verification_failure',
          'domain_allowlist_failed',
          'pending_tag_confirmation',
          'confidence_below_publish_threshold',
        ]),
      }),
    );
    expect(result).toEqual({
      candidateId: 'cand-existing',
      evidenceId: 'ev-1',
      deduped: true,
      assignedToRole: 'oran_admin',
      reviewStatus: 'escalated',
    });
  });
});
