/**
 * Tests for admin approval workflow contracts.
 */
import { describe, it, expect } from 'vitest';

import {
  createAdminProfile,
  hasCapacity,
  selectAdminsForAssignment,
  type AdminWithCapacity,
  type ClosestAdmin,
} from '../adminProfiles';

import {
  createAssignment,
  acceptAssignment,
  completeAssignment,
  skipAssignment,
  expireAssignment,
  withdrawAssignment,
  calculateSlaDuration,
  countApprovals,
  countRejections,
  isValidTransition,
  isTerminalStatus,
  type AdminAssignment,
} from '../adminAssignments';

import {
  createTagConfirmation,
  confirmTag,
  modifyTag,
  rejectTag,
  getConfidenceTierFromScore,
  getTierDisplayInfo,
  needsReview,
  getPendingConfirmations,
  getConfirmedTags,
  allCriticalTagsConfirmed,
  countPendingByTier,
  sortByPriority,
} from '../tagConfirmations';

import {
  createLlmSuggestion,
  acceptSuggestion,
  modifySuggestion,
  rejectSuggestion,
  getPendingSuggestions,
  getAcceptedValues,
  getFieldDisplayInfo,
  getRequiredFields,
  getCriticalFields,
} from '../llmSuggestions';

// ============================================================
// Admin Profile Tests
// ============================================================

describe('Admin Profiles', () => {
  describe('createAdminProfile', () => {
    it('creates profile with defaults', () => {
      const profile = createAdminProfile('user123', 'Test Admin');
      expect(profile.userId).toBe('user123');
      expect(profile.displayName).toBe('Test Admin');
      expect(profile.profileType).toBe('admin');
      expect(profile.maxPendingReviews).toBe(10);
      expect(profile.isActive).toBe(true);
      expect(profile.isAcceptingReviews).toBe(true);
    });

    it('creates org profile with options', () => {
      const profile = createAdminProfile('org456', 'Test Org', {
        profileType: 'org',
        maxPendingReviews: 20,
        categoryExpertise: ['food', 'housing'],
        location: { longitude: -97.7431, latitude: 30.2672 },
      });
      expect(profile.profileType).toBe('org');
      expect(profile.maxPendingReviews).toBe(20);
      expect(profile.categoryExpertise).toEqual(['food', 'housing']);
      expect(profile.location).toEqual({ longitude: -97.7431, latitude: 30.2672 });
    });
  });

  describe('hasCapacity', () => {
    it('returns true when admin has capacity', () => {
      const admin: AdminWithCapacity = {
        userId: 'user1',
        displayName: 'Admin 1',
        profileType: 'admin',
        maxPendingReviews: 10,
        maxInReview: 5,
        jurisdictionCountry: 'US',
        jurisdictionStates: [],
        jurisdictionCounties: [],
        categoryExpertise: [],
        isActive: true,
        isAcceptingReviews: true,
        totalReviewsCompleted: 0,
        currentPendingCount: 5,
        availableCapacity: 5,
      };
      expect(hasCapacity(admin)).toBe(true);
    });

    it('returns false when at capacity', () => {
      const admin: AdminWithCapacity = {
        userId: 'user1',
        displayName: 'Admin 1',
        profileType: 'admin',
        maxPendingReviews: 10,
        maxInReview: 5,
        jurisdictionCountry: 'US',
        jurisdictionStates: [],
        jurisdictionCounties: [],
        categoryExpertise: [],
        isActive: true,
        isAcceptingReviews: true,
        totalReviewsCompleted: 0,
        currentPendingCount: 10,
        availableCapacity: 0,
      };
      expect(hasCapacity(admin)).toBe(false);
    });

    it('returns false when not accepting reviews', () => {
      const admin: AdminWithCapacity = {
        userId: 'user1',
        displayName: 'Admin 1',
        profileType: 'admin',
        maxPendingReviews: 10,
        maxInReview: 5,
        jurisdictionCountry: 'US',
        jurisdictionStates: [],
        jurisdictionCounties: [],
        categoryExpertise: [],
        isActive: true,
        isAcceptingReviews: false,
        totalReviewsCompleted: 0,
        currentPendingCount: 0,
        availableCapacity: 10,
      };
      expect(hasCapacity(admin)).toBe(false);
    });
  });

  describe('selectAdminsForAssignment', () => {
    it('selects balanced mix of admins and orgs', () => {
      const all: ClosestAdmin[] = [
        { adminProfileId: '1', userId: 'a1', displayName: 'Admin 1', profileType: 'admin', distanceMeters: 100, availableCapacity: 5 },
        { adminProfileId: '2', userId: 'a2', displayName: 'Admin 2', profileType: 'admin', distanceMeters: 200, availableCapacity: 5 },
        { adminProfileId: '3', userId: 'a3', displayName: 'Admin 3', profileType: 'admin', distanceMeters: 300, availableCapacity: 5 },
        { adminProfileId: '4', userId: 'o1', displayName: 'Org 1', profileType: 'org', distanceMeters: 150, availableCapacity: 5 },
        { adminProfileId: '5', userId: 'o2', displayName: 'Org 2', profileType: 'org', distanceMeters: 250, availableCapacity: 5 },
      ];

      const selected = selectAdminsForAssignment(all, 5);
      expect(selected.length).toBe(5);

      const admins = selected.filter(a => a.profileType === 'admin');
      const orgs = selected.filter(a => a.profileType === 'org');

      expect(admins.length).toBe(3);
      expect(orgs.length).toBe(2);
    });

    it('returns only available when less than target', () => {
      const all: ClosestAdmin[] = [
        { adminProfileId: '1', userId: 'a1', displayName: 'Admin 1', profileType: 'admin', distanceMeters: 100, availableCapacity: 5 },
        { adminProfileId: '2', userId: 'o1', displayName: 'Org 1', profileType: 'org', distanceMeters: 150, availableCapacity: 5 },
      ];

      const selected = selectAdminsForAssignment(all, 5);
      expect(selected.length).toBe(2);
    });
  });
});

// ============================================================
// Admin Assignment Tests
// ============================================================

describe('Admin Assignments', () => {
  describe('createAssignment', () => {
    it('creates assignment with defaults', () => {
      const assignment = createAssignment('candidate1', 'admin1', 1);
      expect(assignment.candidateId).toBe('candidate1');
      expect(assignment.adminProfileId).toBe('admin1');
      expect(assignment.assignmentRank).toBe(1);
      expect(assignment.assignmentStatus).toBe('pending');
      expect(assignment.decisionDueBy).toBeDefined();
    });

    it('creates assignment with custom SLA', () => {
      const assignment = createAssignment('candidate1', 'admin1', 2, {
        distanceMeters: 5000,
        slaDurationHours: 24,
      });
      expect(assignment.distanceMeters).toBe(5000);
      expect(assignment.assignmentRank).toBe(2);
    });
  });

  describe('status transitions', () => {
    const base = createAssignment('c1', 'a1', 1);

    it('accepts pending assignment', () => {
      const accepted = acceptAssignment(base);
      expect(accepted.assignmentStatus).toBe('accepted');
      expect(accepted.acceptedAt).toBeDefined();
    });

    it('completes accepted assignment', () => {
      const accepted = acceptAssignment(base);
      const completed = completeAssignment(accepted, 'approve', 'Looks good');
      expect(completed.assignmentStatus).toBe('completed');
      expect(completed.decision).toBe('approve');
      expect(completed.decisionNotes).toBe('Looks good');
      expect(completed.completedAt).toBeDefined();
    });

    it('cannot accept non-pending', () => {
      const accepted = acceptAssignment(base);
      expect(() => acceptAssignment(accepted)).toThrow();
    });

    it('cannot complete non-accepted', () => {
      expect(() => completeAssignment(base, 'approve')).toThrow();
    });

    it('skips pending assignment', () => {
      const skipped = skipAssignment(base);
      expect(skipped.assignmentStatus).toBe('skipped');
    });

    it('expires pending assignment', () => {
      const expired = expireAssignment(base);
      expect(expired.assignmentStatus).toBe('expired');
    });

    it('withdraws non-terminal assignment', () => {
      const withdrawn = withdrawAssignment(base);
      expect(withdrawn.assignmentStatus).toBe('withdrawn');
    });
  });

  describe('isValidTransition', () => {
    it('allows pending to accepted', () => {
      expect(isValidTransition('pending', 'accepted')).toBe(true);
    });

    it('disallows completed to pending', () => {
      expect(isValidTransition('completed', 'pending')).toBe(false);
    });
  });

  describe('isTerminalStatus', () => {
    it('completed is terminal', () => {
      expect(isTerminalStatus('completed')).toBe(true);
    });

    it('pending is not terminal', () => {
      expect(isTerminalStatus('pending')).toBe(false);
    });
  });

  describe('calculateSlaDuration', () => {
    it('returns 72 hours for green', () => {
      expect(calculateSlaDuration('green')).toBe(72);
    });

    it('returns 12 hours for red', () => {
      expect(calculateSlaDuration('red')).toBe(12);
    });
  });

  describe('countApprovals', () => {
    it('counts approved assignments', () => {
      const assignments: AdminAssignment[] = [
        { ...createAssignment('c1', 'a1', 1), assignmentStatus: 'completed', decision: 'approve' },
        { ...createAssignment('c1', 'a2', 2), assignmentStatus: 'completed', decision: 'reject' },
        { ...createAssignment('c1', 'a3', 3), assignmentStatus: 'completed', decision: 'approve' },
        { ...createAssignment('c1', 'a4', 4), assignmentStatus: 'pending' },
      ];
      expect(countApprovals(assignments)).toBe(2);
    });
  });

  describe('countRejections', () => {
    it('counts rejected assignments', () => {
      const assignments: AdminAssignment[] = [
        { ...createAssignment('c1', 'a1', 1), assignmentStatus: 'completed', decision: 'reject' },
        { ...createAssignment('c1', 'a2', 2), assignmentStatus: 'completed', decision: 'approve' },
      ];
      expect(countRejections(assignments)).toBe(1);
    });
  });
});

// ============================================================
// Tag Confirmation Tests
// ============================================================

describe('Tag Confirmations', () => {
  describe('getConfidenceTierFromScore', () => {
    it('returns green for >= 80', () => {
      expect(getConfidenceTierFromScore(80)).toBe('green');
      expect(getConfidenceTierFromScore(100)).toBe('green');
    });

    it('returns yellow for 60-79', () => {
      expect(getConfidenceTierFromScore(60)).toBe('yellow');
      expect(getConfidenceTierFromScore(79)).toBe('yellow');
    });

    it('returns orange for 40-59', () => {
      expect(getConfidenceTierFromScore(40)).toBe('orange');
      expect(getConfidenceTierFromScore(59)).toBe('orange');
    });

    it('returns red for < 40', () => {
      expect(getConfidenceTierFromScore(0)).toBe('red');
      expect(getConfidenceTierFromScore(39)).toBe('red');
    });
  });

  describe('getTierDisplayInfo', () => {
    it('returns color info for each tier', () => {
      expect(getTierDisplayInfo('green').color).toBe('#22c55e');
      expect(getTierDisplayInfo('yellow').color).toBe('#eab308');
      expect(getTierDisplayInfo('orange').color).toBe('#f97316');
      expect(getTierDisplayInfo('red').color).toBe('#ef4444');
    });
  });

  describe('createTagConfirmation', () => {
    it('creates pending confirmation for low confidence', () => {
      const conf = createTagConfirmation('c1', 'category', 'food', 50);
      expect(conf.candidateId).toBe('c1');
      expect(conf.tagType).toBe('category');
      expect(conf.suggestedValue).toBe('food');
      expect(conf.suggestedConfidence).toBe(50);
      expect(conf.confidenceTier).toBe('orange');
      expect(conf.confirmationStatus).toBe('pending');
    });

    it('auto-approves high confidence tags', () => {
      const conf = createTagConfirmation('c1', 'category', 'food', 85);
      expect(conf.confirmationStatus).toBe('auto_approved');
      expect(conf.confirmedValue).toBe('food');
      expect(conf.confirmedConfidence).toBe(85);
    });
  });

  describe('confirmation actions', () => {
    const pending = createTagConfirmation('c1', 'category', 'food', 50);

    it('confirms tag as-is', () => {
      const confirmed = confirmTag(pending, 'user1', 'Verified');
      expect(confirmed.confirmationStatus).toBe('confirmed');
      expect(confirmed.confirmedValue).toBe('food');
      expect(confirmed.reviewedByUserId).toBe('user1');
    });

    it('modifies tag value', () => {
      const modified = modifyTag(pending, 'housing', 'user1', { notes: 'Wrong category' });
      expect(modified.confirmationStatus).toBe('modified');
      expect(modified.confirmedValue).toBe('housing');
      expect(modified.confirmedConfidence).toBe(100); // Human confirmed = high
    });

    it('rejects tag', () => {
      const rejected = rejectTag(pending, 'user1', 'Invalid tag');
      expect(rejected.confirmationStatus).toBe('rejected');
      expect(rejected.reviewNotes).toBe('Invalid tag');
    });

    it('cannot confirm non-pending', () => {
      const confirmed = confirmTag(pending, 'user1');
      expect(() => confirmTag(confirmed, 'user2')).toThrow();
    });
  });

  describe('needsReview', () => {
    it('returns true for pending', () => {
      const pending = createTagConfirmation('c1', 'category', 'food', 50);
      expect(needsReview(pending)).toBe(true);
    });

    it('returns false for confirmed', () => {
      const conf = createTagConfirmation('c1', 'category', 'food', 50);
      const confirmed = confirmTag(conf, 'user1');
      expect(needsReview(confirmed)).toBe(false);
    });
  });

  describe('getPendingConfirmations', () => {
    it('filters to pending only', () => {
      const confs = [
        createTagConfirmation('c1', 'category', 'food', 50),
        createTagConfirmation('c1', 'audience', 'veteran', 90), // auto-approved
        createTagConfirmation('c1', 'program', 'snap', 30),
      ];
      const pending = getPendingConfirmations(confs);
      expect(pending.length).toBe(2);
      expect(pending.every(c => c.confirmationStatus === 'pending')).toBe(true);
    });
  });

  describe('countPendingByTier', () => {
    it('counts by tier correctly', () => {
      const confs = [
        createTagConfirmation('c1', 'category', 'food', 85), // auto-approved, not pending
        createTagConfirmation('c1', 'audience', 'veteran', 65), // yellow - pending
        createTagConfirmation('c1', 'program', 'snap', 45), // orange - pending
        createTagConfirmation('c1', 'geographic', 'TX', 30), // red - pending
        createTagConfirmation('c1', 'geographic', 'Austin', 25), // red - pending
      ];
      const counts = countPendingByTier(confs);
      expect(counts.green).toBe(0); // auto-approved doesn't count
      expect(counts.yellow).toBe(1);
      expect(counts.orange).toBe(1);
      expect(counts.red).toBe(2);
    });
  });

  describe('getConfirmedTags', () => {
    it('returns confirmed and auto-approved tags', () => {
      const confs = [
        createTagConfirmation('c1', 'category', 'food', 85), // auto-approved
        createTagConfirmation('c1', 'audience', 'veteran', 50),
      ];
      confs[1] = confirmTag(confs[1], 'user1');

      const confirmed = getConfirmedTags(confs);
      expect(confirmed.length).toBe(2);
      expect(confirmed.find(t => t.tagType === 'category')?.value).toBe('food');
      expect(confirmed.find(t => t.tagType === 'audience')?.value).toBe('veteran');
    });
  });

  describe('allCriticalTagsConfirmed', () => {
    it('returns true when no critical tags pending', () => {
      const confs = [
        createTagConfirmation('c1', 'category', 'food', 85), // green - auto-approved
        createTagConfirmation('c1', 'audience', 'veteran', 65), // yellow - pending but not critical
      ];
      expect(allCriticalTagsConfirmed(confs)).toBe(true);
    });

    it('returns false when critical tags pending', () => {
      const confs = [
        createTagConfirmation('c1', 'category', 'food', 30), // red - pending (critical)
      ];
      expect(allCriticalTagsConfirmed(confs)).toBe(false);
    });
  });

  describe('sortByPriority', () => {
    it('sorts red first, then orange, yellow, green', () => {
      const confs = [
        createTagConfirmation('c1', 'category', 'a', 85), // green
        createTagConfirmation('c1', 'category', 'b', 30), // red
        createTagConfirmation('c1', 'category', 'c', 65), // yellow
        createTagConfirmation('c1', 'category', 'd', 45), // orange
      ];
      const sorted = sortByPriority(confs);
      expect(sorted[0].confidenceTier).toBe('red');
      expect(sorted[1].confidenceTier).toBe('orange');
      expect(sorted[2].confidenceTier).toBe('yellow');
      expect(sorted[3].confidenceTier).toBe('green');
    });
  });
});

// ============================================================
// LLM Suggestion Tests
// ============================================================

describe('LLM Suggestions', () => {
  describe('createLlmSuggestion', () => {
    it('creates suggestion with defaults', () => {
      const sugg = createLlmSuggestion('c1', 'description', 'A helpful service', 0.85);
      expect(sugg.candidateId).toBe('c1');
      expect(sugg.fieldName).toBe('description');
      expect(sugg.suggestedValue).toBe('A helpful service');
      expect(sugg.llmConfidence).toBe(0.85);
      expect(sugg.suggestionStatus).toBe('pending');
      expect(sugg.llmModel).toBe('unknown');
      expect(sugg.llmProvider).toBe('azure');
    });

    it('creates suggestion with options', () => {
      const sugg = createLlmSuggestion('c1', 'eligibility_criteria', 'Must be 65+', 0.7, {
        llmModel: 'gpt-4o',
        promptContext: 'Based on service page content',
        sourceEvidenceRefs: ['ev1', 'ev2'],
      });
      expect(sugg.llmModel).toBe('gpt-4o');
      expect(sugg.promptContext).toBe('Based on service page content');
      expect(sugg.sourceEvidenceRefs).toEqual(['ev1', 'ev2']);
    });
  });

  describe('suggestion actions', () => {
    const pending = createLlmSuggestion('c1', 'description', 'Original suggestion', 0.8);

    it('accepts suggestion as-is', () => {
      const accepted = acceptSuggestion(pending, 'user1', 'Good suggestion');
      expect(accepted.suggestionStatus).toBe('accepted');
      expect(accepted.acceptedValue).toBe('Original suggestion');
      expect(accepted.reviewedByUserId).toBe('user1');
    });

    it('modifies suggestion', () => {
      const modified = modifySuggestion(pending, 'Better description', 'user1', 'Improved wording');
      expect(modified.suggestionStatus).toBe('modified');
      expect(modified.acceptedValue).toBe('Better description');
    });

    it('rejects suggestion', () => {
      const rejected = rejectSuggestion(pending, 'user1', 'Not accurate');
      expect(rejected.suggestionStatus).toBe('rejected');
      expect(rejected.reviewNotes).toBe('Not accurate');
    });

    it('cannot accept non-pending', () => {
      const accepted = acceptSuggestion(pending, 'user1');
      expect(() => acceptSuggestion(accepted, 'user2')).toThrow();
    });
  });

  describe('getPendingSuggestions', () => {
    it('filters to pending only', () => {
      const suggs = [
        createLlmSuggestion('c1', 'name', 'Service A', 0.9),
        createLlmSuggestion('c1', 'description', 'Desc', 0.8),
      ];
      suggs[0] = acceptSuggestion(suggs[0], 'user1');

      const pending = getPendingSuggestions(suggs);
      expect(pending.length).toBe(1);
      expect(pending[0].fieldName).toBe('description');
    });
  });

  describe('getAcceptedValues', () => {
    it('returns map of accepted values', () => {
      const suggs = [
        acceptSuggestion(createLlmSuggestion('c1', 'name', 'Service A', 0.9), 'u1'),
        modifySuggestion(createLlmSuggestion('c1', 'description', 'Desc', 0.8), 'Better desc', 'u1'),
        rejectSuggestion(createLlmSuggestion('c1', 'phone', '555-1234', 0.5), 'u1'),
        createLlmSuggestion('c1', 'email', 'test@test.com', 0.6), // pending
      ];

      const values = getAcceptedValues(suggs);
      expect(values.size).toBe(2);
      expect(values.get('name')).toBe('Service A');
      expect(values.get('description')).toBe('Better desc');
      expect(values.has('phone')).toBe(false);
      expect(values.has('email')).toBe(false);
    });
  });

  describe('getFieldDisplayInfo', () => {
    it('returns info for all fields', () => {
      expect(getFieldDisplayInfo('name').isRequired).toBe(true);
      expect(getFieldDisplayInfo('description').isRequired).toBe(true);
      expect(getFieldDisplayInfo('fees').isRequired).toBe(false);
    });
  });

  describe('getRequiredFields', () => {
    it('returns required fields', () => {
      const required = getRequiredFields();
      expect(required).toContain('name');
      expect(required).toContain('description');
      expect(required).toContain('service_area');
      expect(required).toContain('category');
      expect(required).not.toContain('fees');
    });
  });

  describe('getCriticalFields', () => {
    it('returns critical fields', () => {
      const critical = getCriticalFields();
      expect(critical).toContain('name');
      expect(critical).toContain('phone');
      expect(critical).toContain('address');
    });
  });
});
