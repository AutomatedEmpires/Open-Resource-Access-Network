/**
 * Unit tests for publish readiness contracts
 */

import { describe, it, expect } from 'vitest';
import {
  PublishReadinessSchema,
  getReadinessTier,
  isReadyForPublish,
  computeReadiness,
  getReadinessBreakdown,
  getBlockingRequirements,
  getReadinessSummary,
  createPublishDecision,
  canAutoPublish,
  createReviewAction,
  type PublishReadiness,
  type ReadinessInput,
} from '../publish';

describe('PublishReadiness schema', () => {
  it('validates a complete readiness record', () => {
    const validReadiness = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      candidateId: '550e8400-e29b-41d4-a716-446655440001',
      hasOrgName: true,
      hasServiceName: true,
      hasDescription: true,
      hasContactMethod: true,
      hasLocationOrVirtual: true,
      hasCategoryTag: true,
      hasGeographicTag: true,
      criticalTagsConfirmed: true,
      noRedTagsPending: true,
      passedDomainCheck: true,
      noCriticalFailures: true,
      confidenceScore: 85,
      computedAt: new Date(),
      approvedByUserId: null,
      approvedAt: null,
      updatedAt: new Date(),
    };
    expect(() => PublishReadinessSchema.parse(validReadiness)).not.toThrow();
  });

  it('applies defaults for boolean fields', () => {
    const minimal = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      candidateId: '550e8400-e29b-41d4-a716-446655440001',
      computedAt: new Date(),
      approvedByUserId: null,
      approvedAt: null,
      updatedAt: new Date(),
    };
    const parsed = PublishReadinessSchema.parse(minimal);
    expect(parsed.hasOrgName).toBe(false);
    expect(parsed.confidenceScore).toBe(0);
  });
});

describe('getReadinessTier', () => {
  const makeReadiness = (score: number): PublishReadiness => ({
    id: '1',
    candidateId: '2',
    hasOrgName: true,
    hasServiceName: true,
    hasDescription: true,
    hasContactMethod: true,
    hasLocationOrVirtual: true,
    hasCategoryTag: true,
    hasGeographicTag: true,
    criticalTagsConfirmed: true,
    noRedTagsPending: true,
    passedDomainCheck: true,
    noCriticalFailures: true,
    confidenceScore: score,
    computedAt: new Date(),
    approvedByUserId: null,
    approvedAt: null,
    updatedAt: new Date(),
  });

  it('returns correct tiers', () => {
    expect(getReadinessTier(makeReadiness(85))).toBe('green');
    expect(getReadinessTier(makeReadiness(70))).toBe('yellow');
    expect(getReadinessTier(makeReadiness(50))).toBe('orange');
    expect(getReadinessTier(makeReadiness(30))).toBe('red');
  });
});

describe('isReadyForPublish', () => {
  const baseReadiness: PublishReadiness = {
    id: '1',
    candidateId: '2',
    hasOrgName: true,
    hasServiceName: true,
    hasDescription: true,
    hasContactMethod: true,
    hasLocationOrVirtual: true,
    hasCategoryTag: true,
    hasGeographicTag: true,
    criticalTagsConfirmed: true,
    noRedTagsPending: true,
    passedDomainCheck: true,
    noCriticalFailures: true,
    confidenceScore: 75,
    computedAt: new Date(),
    approvedByUserId: null,
    approvedAt: null,
    updatedAt: new Date(),
  };

  it('returns true when all criteria met', () => {
    expect(isReadyForPublish(baseReadiness)).toBe(true);
  });

  it('returns false when missing org name', () => {
    expect(isReadyForPublish({ ...baseReadiness, hasOrgName: false })).toBe(false);
  });

  it('returns false when missing service name', () => {
    expect(isReadyForPublish({ ...baseReadiness, hasServiceName: false })).toBe(false);
  });

  it('returns false when missing description', () => {
    expect(isReadyForPublish({ ...baseReadiness, hasDescription: false })).toBe(false);
  });

  it('returns false when missing contact method', () => {
    expect(isReadyForPublish({ ...baseReadiness, hasContactMethod: false })).toBe(false);
  });

  it('returns false when missing location and not virtual', () => {
    expect(isReadyForPublish({ ...baseReadiness, hasLocationOrVirtual: false })).toBe(false);
  });

  it('returns false when missing category tag', () => {
    expect(isReadyForPublish({ ...baseReadiness, hasCategoryTag: false })).toBe(false);
  });

  it('returns false when missing geographic tag', () => {
    expect(isReadyForPublish({ ...baseReadiness, hasGeographicTag: false })).toBe(false);
  });

  it('returns false when critical tags not confirmed', () => {
    expect(isReadyForPublish({ ...baseReadiness, criticalTagsConfirmed: false })).toBe(false);
  });

  it('returns false when red tags are pending', () => {
    expect(isReadyForPublish({ ...baseReadiness, noRedTagsPending: false })).toBe(false);
  });

  it('returns false when domain check failed', () => {
    expect(isReadyForPublish({ ...baseReadiness, passedDomainCheck: false })).toBe(false);
  });

  it('returns false when critical failures exist', () => {
    expect(isReadyForPublish({ ...baseReadiness, noCriticalFailures: false })).toBe(false);
  });

  it('returns false when confidence score below 60', () => {
    expect(isReadyForPublish({ ...baseReadiness, confidenceScore: 55 })).toBe(false);
  });

  it('returns true when confidence score exactly 60', () => {
    expect(isReadyForPublish({ ...baseReadiness, confidenceScore: 60 })).toBe(true);
  });
});

describe('computeReadiness', () => {
  const baseInput: ReadinessInput = {
    organizationName: 'Test Org',
    serviceName: 'Food Pantry',
    description: 'We provide food assistance',
    phones: [{ number: '555-1234' }],
    emails: [],
    websiteUrl: 'https://example.gov',
    address: { city: 'Test City' },
    isRemoteService: false,
    confidenceScore: 75,
    confirmedCategoryTags: ['food_pantry'],
    confirmedGeographicTags: ['us_id_kootenai'],
    pendingTags: [],
    domainCheckPassed: true,
    criticalChecksFailed: false,
  };

  it('computes all fields correctly when fully populated', () => {
    const result = computeReadiness('candidate-123', baseInput);
    expect(result.hasOrgName).toBe(true);
    expect(result.hasServiceName).toBe(true);
    expect(result.hasDescription).toBe(true);
    expect(result.hasContactMethod).toBe(true);
    expect(result.hasLocationOrVirtual).toBe(true);
    expect(result.hasCategoryTag).toBe(true);
    expect(result.hasGeographicTag).toBe(true);
    expect(result.passedDomainCheck).toBe(true);
    expect(result.noCriticalFailures).toBe(true);
  });

  it('detects missing org name', () => {
    const result = computeReadiness('candidate-123', {
      ...baseInput,
      organizationName: null,
    });
    expect(result.hasOrgName).toBe(false);
  });

  it('detects missing contact method when no phone/email/website', () => {
    const result = computeReadiness('candidate-123', {
      ...baseInput,
      phones: [],
      emails: [],
      websiteUrl: null,
    });
    expect(result.hasContactMethod).toBe(false);
  });

  it('allows remote service without address', () => {
    const result = computeReadiness('candidate-123', {
      ...baseInput,
      address: null,
      isRemoteService: true,
    });
    expect(result.hasLocationOrVirtual).toBe(true);
  });

  it('detects missing category tags', () => {
    const result = computeReadiness('candidate-123', {
      ...baseInput,
      confirmedCategoryTags: [],
    });
    expect(result.hasCategoryTag).toBe(false);
  });

  it('detects blocking red tags', () => {
    const result = computeReadiness('candidate-123', {
      ...baseInput,
      pendingTags: [
        {
          id: '1',
          candidateId: '2',
          tagType: 'category',
          suggestedValue: 'test',
          suggestedLabel: null,
          agentConfidence: 30, // Red
          evidenceText: null,
          evidenceSelector: null,
          evidenceUrl: null,
          status: 'pending',
          confirmedValue: null,
          confirmedByUserId: null,
          confirmedAt: null,
          rejectionReason: null,
          isAutoConfirmed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    expect(result.noRedTagsPending).toBe(false);
  });
});

describe('getReadinessBreakdown', () => {
  const baseReadiness: PublishReadiness = {
    id: '1',
    candidateId: '2',
    hasOrgName: true,
    hasServiceName: true,
    hasDescription: false, // Missing
    hasContactMethod: true,
    hasLocationOrVirtual: true,
    hasCategoryTag: false, // Missing
    hasGeographicTag: true,
    criticalTagsConfirmed: true,
    noRedTagsPending: true,
    passedDomainCheck: true,
    noCriticalFailures: true,
    confidenceScore: 75,
    computedAt: new Date(),
    approvedByUserId: null,
    approvedAt: null,
    updatedAt: new Date(),
  };

  it('returns all requirements with correct status', () => {
    const breakdown = getReadinessBreakdown(baseReadiness);
    expect(breakdown.length).toBeGreaterThan(0);

    const descriptionReq = breakdown.find((r) => r.key === 'description');
    expect(descriptionReq?.met).toBe(false);

    const orgNameReq = breakdown.find((r) => r.key === 'org_name');
    expect(orgNameReq?.met).toBe(true);
  });

  it('includes confidence score requirement', () => {
    const breakdown = getReadinessBreakdown(baseReadiness);
    const scoreReq = breakdown.find((r) => r.key === 'confidence_score');
    expect(scoreReq).toBeDefined();
    expect(scoreReq?.met).toBe(true);
    expect(scoreReq?.label).toContain('75');
  });
});

describe('getBlockingRequirements', () => {
  const baseReadiness: PublishReadiness = {
    id: '1',
    candidateId: '2',
    hasOrgName: true,
    hasServiceName: true,
    hasDescription: false, // Blocking
    hasContactMethod: true,
    hasLocationOrVirtual: true,
    hasCategoryTag: false, // Blocking
    hasGeographicTag: true,
    criticalTagsConfirmed: true,
    noRedTagsPending: true,
    passedDomainCheck: true,
    noCriticalFailures: true,
    confidenceScore: 75,
    computedAt: new Date(),
    approvedByUserId: null,
    approvedAt: null,
    updatedAt: new Date(),
  };

  it('returns only unmet requirements', () => {
    const blockers = getBlockingRequirements(baseReadiness);
    expect(blockers.length).toBe(2);
    expect(blockers.some((b) => b.key === 'description')).toBe(true);
    expect(blockers.some((b) => b.key === 'category_tag')).toBe(true);
  });

  it('sorts by weight descending', () => {
    const blockers = getBlockingRequirements(baseReadiness);
    for (let i = 0; i < blockers.length - 1; i++) {
      expect(blockers[i].weight).toBeGreaterThanOrEqual(blockers[i + 1].weight);
    }
  });
});

describe('getReadinessSummary', () => {
  it('returns summary for ready candidate', () => {
    const ready: PublishReadiness = {
      id: '1',
      candidateId: '2',
      hasOrgName: true,
      hasServiceName: true,
      hasDescription: true,
      hasContactMethod: true,
      hasLocationOrVirtual: true,
      hasCategoryTag: true,
      hasGeographicTag: true,
      criticalTagsConfirmed: true,
      noRedTagsPending: true,
      passedDomainCheck: true,
      noCriticalFailures: true,
      confidenceScore: 85,
      computedAt: new Date(),
      approvedByUserId: null,
      approvedAt: null,
      updatedAt: new Date(),
    };
    const summary = getReadinessSummary(ready);
    expect(summary.isReady).toBe(true);
    expect(summary.tier).toBe('green');
    expect(summary.blockers.length).toBe(0);
    expect(summary.metCount).toBe(summary.totalRequired);
  });

  it('returns summary for not-ready candidate', () => {
    const notReady: PublishReadiness = {
      id: '1',
      candidateId: '2',
      hasOrgName: true,
      hasServiceName: true,
      hasDescription: false,
      hasContactMethod: true,
      hasLocationOrVirtual: true,
      hasCategoryTag: false,
      hasGeographicTag: true,
      criticalTagsConfirmed: true,
      noRedTagsPending: true,
      passedDomainCheck: true,
      noCriticalFailures: true,
      confidenceScore: 50,
      computedAt: new Date(),
      approvedByUserId: null,
      approvedAt: null,
      updatedAt: new Date(),
    };
    const summary = getReadinessSummary(notReady);
    expect(summary.isReady).toBe(false);
    expect(summary.tier).toBe('orange');
    expect(summary.blockers.length).toBeGreaterThan(0);
    expect(summary.metCount).toBeLessThan(summary.totalRequired);
  });
});

describe('createPublishDecision', () => {
  it('creates a publish decision', () => {
    const decision = createPublishDecision(
      'candidate-123',
      'publish',
      'admin-456',
      'All criteria met'
    );
    expect(decision.candidateId).toBe('candidate-123');
    expect(decision.action).toBe('publish');
    expect(decision.decidedByUserId).toBe('admin-456');
    expect(decision.reason).toBe('All criteria met');
    expect(decision.wasAutomatic).toBe(false);
    expect(decision.decidedAt).toBeDefined();
  });

  it('creates an automatic decision', () => {
    const decision = createPublishDecision(
      'candidate-123',
      'publish',
      'system',
      'Auto-published from official source',
      true
    );
    expect(decision.wasAutomatic).toBe(true);
  });
});

describe('canAutoPublish', () => {
  const baseReadiness: PublishReadiness = {
    id: '1',
    candidateId: '2',
    hasOrgName: true,
    hasServiceName: true,
    hasDescription: true,
    hasContactMethod: true,
    hasLocationOrVirtual: true,
    hasCategoryTag: true,
    hasGeographicTag: true,
    criticalTagsConfirmed: true,
    noRedTagsPending: true,
    passedDomainCheck: true,
    noCriticalFailures: true,
    confidenceScore: 85,
    computedAt: new Date(),
    approvedByUserId: null,
    approvedAt: null,
    updatedAt: new Date(),
  };

  it('allows auto-publish for official source with high confidence', () => {
    expect(canAutoPublish(baseReadiness, 'official')).toBe(true);
  });

  it('disallows auto-publish for vetted source', () => {
    expect(canAutoPublish(baseReadiness, 'vetted')).toBe(false);
  });

  it('disallows auto-publish for community source', () => {
    expect(canAutoPublish(baseReadiness, 'community')).toBe(false);
  });

  it('disallows auto-publish when confidence below 80', () => {
    const lowConfidence = { ...baseReadiness, confidenceScore: 75 };
    expect(canAutoPublish(lowConfidence, 'official')).toBe(false);
  });

  it('disallows auto-publish when not ready', () => {
    const notReady = { ...baseReadiness, hasOrgName: false };
    expect(canAutoPublish(notReady, 'official')).toBe(false);
  });
});

describe('createReviewAction', () => {
  it('creates a review action audit record', () => {
    const action = createReviewAction(
      'candidate-123',
      'admin-456',
      'community_admin',
      'tag_confirmed',
      'tag',
      {
        targetId: 'tag-789',
        oldValue: { status: 'pending' },
        newValue: { status: 'confirmed' },
        notes: 'Tag was correct',
      }
    );
    expect(action.candidateId).toBe('candidate-123');
    expect(action.actorUserId).toBe('admin-456');
    expect(action.actorRole).toBe('community_admin');
    expect(action.actionType).toBe('tag_confirmed');
    expect(action.targetType).toBe('tag');
    expect(action.targetId).toBe('tag-789');
    expect(action.actedAt).toBeDefined();
  });

  it('handles optional fields as null', () => {
    const action = createReviewAction(
      'candidate-123',
      'admin-456',
      'oran_admin',
      'publish_approved',
      'candidate'
    );
    expect(action.targetId).toBeNull();
    expect(action.oldValue).toBeNull();
    expect(action.newValue).toBeNull();
    expect(action.notes).toBeNull();
  });
});
