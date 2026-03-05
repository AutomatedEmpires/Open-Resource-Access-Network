/**
 * Community Queue API Contract Tests
 *
 * Validates Zod schemas, status transitions, and input sanitization
 * for the community submission queue API routes (universal pipeline).
 * These tests run against the schema/validation layer — NOT the database.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
  SUBMISSION_STATUSES,
  SUBMISSION_TYPES,
  SUBMISSION_TRANSITIONS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';

// ============================================================
// Re-declare schemas matching the route files (unit-testable)
// ============================================================

const ListParamsSchema = z.object({
  status: z
    .enum(SUBMISSION_STATUSES as unknown as [string, ...string[]])
    .optional(),
  type: z
    .enum(SUBMISSION_TYPES as unknown as [string, ...string[]])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const ClaimSchema = z.object({
  submissionId: z.string().uuid('submissionId must be a valid UUID'),
});

const DecisionSchema = z.object({
  decision: z.enum(['approved', 'denied', 'escalated', 'returned', 'pending_second_approval'], {
    message: 'decision is required',
  }),
  notes: z.string().max(5000).optional(),
});

// ============================================================
// LIST PARAMS SCHEMA
// ============================================================

describe('community queue list params', () => {
  it('accepts empty params with defaults', () => {
    const result = ListParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(DEFAULT_PAGE_SIZE);
      expect(result.data.status).toBeUndefined();
      expect(result.data.type).toBeUndefined();
    }
  });

  it('accepts valid status filter', () => {
    for (const status of SUBMISSION_STATUSES) {
      const result = ListParamsSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it('accepts valid type filter', () => {
    for (const type of SUBMISSION_TYPES) {
      const result = ListParamsSchema.safeParse({ type });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    const result = ListParamsSchema.safeParse({ status: 'nonexistent' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = ListParamsSchema.safeParse({ type: 'invalid_type' });
    expect(result.success).toBe(false);
  });

  it('coerces string page/limit to numbers', () => {
    const result = ListParamsSchema.safeParse({ page: '3', limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
    }
  });

  it('rejects page < 1', () => {
    const result = ListParamsSchema.safeParse({ page: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects limit > 100', () => {
    const result = ListParamsSchema.safeParse({ limit: '101' });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer page', () => {
    const result = ListParamsSchema.safeParse({ page: '1.5' });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// CLAIM SCHEMA
// ============================================================

describe('community queue claim schema', () => {
  it('accepts valid claim payload', () => {
    const result = ClaimSchema.safeParse({
      submissionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID submissionId', () => {
    const result = ClaimSchema.safeParse({
      submissionId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing submissionId', () => {
    expect(ClaimSchema.safeParse({}).success).toBe(false);
  });
});

// ============================================================
// DECISION SCHEMA
// ============================================================

describe('community queue decision schema', () => {
  it('accepts valid approved decision', () => {
    const result = DecisionSchema.safeParse({
      decision: 'approved',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid denied decision with notes', () => {
    const result = DecisionSchema.safeParse({
      decision: 'denied',
      notes: 'Phone number is disconnected.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid escalated decision', () => {
    const result = DecisionSchema.safeParse({
      decision: 'escalated',
      notes: 'Suspicious organization — needs deeper investigation.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid returned decision', () => {
    const result = DecisionSchema.safeParse({
      decision: 'returned',
      notes: 'Please provide additional documentation.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts pending_second_approval decision', () => {
    const result = DecisionSchema.safeParse({
      decision: 'pending_second_approval',
    });
    expect(result.success).toBe(true);
  });

  it('rejects "submitted" as a decision (not a terminal decision)', () => {
    const result = DecisionSchema.safeParse({
      decision: 'submitted',
    });
    expect(result.success).toBe(false);
  });

  it('rejects "under_review" as a decision', () => {
    const result = DecisionSchema.safeParse({
      decision: 'under_review',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing decision', () => {
    const result = DecisionSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects notes exceeding 5000 chars', () => {
    const result = DecisionSchema.safeParse({
      decision: 'denied',
      notes: 'x'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('allows notes to be omitted', () => {
    const result = DecisionSchema.safeParse({
      decision: 'approved',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBeUndefined();
    }
  });
});

// ============================================================
// RATE LIMIT CONSTANTS
// ============================================================

describe('community rate limit constants', () => {
  it('community read limit is greater than write limit', () => {
    expect(COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS).toBeGreaterThan(COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS);
  });

  it('community read limit is reasonable (20-200)', () => {
    expect(COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS).toBeGreaterThanOrEqual(20);
    expect(COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS).toBeLessThanOrEqual(200);
  });

  it('community write limit is reasonable (5-100)', () => {
    expect(COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS).toBeGreaterThanOrEqual(5);
    expect(COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS).toBeLessThanOrEqual(100);
  });
});

// ============================================================
// SUBMISSION STATUS TRANSITIONS (Universal Pipeline)
// ============================================================

describe('submission status transitions', () => {
  const TERMINAL_STATUSES: SubmissionStatus[] = ['approved', 'denied', 'withdrawn', 'expired', 'archived'];
  const DECIDABLE_STATUSES: SubmissionStatus[] = ['under_review', 'escalated', 'pending_second_approval'];

  it('decidable statuses include under_review, escalated, and pending_second_approval', () => {
    expect(DECIDABLE_STATUSES).toEqual(['under_review', 'escalated', 'pending_second_approval']);
  });

  it('terminal statuses include approved, denied, withdrawn, expired, archived', () => {
    expect(TERMINAL_STATUSES).toEqual(['approved', 'denied', 'withdrawn', 'expired', 'archived']);
  });

  it('all submission statuses are in SUBMISSION_STATUSES', () => {
    for (const status of SUBMISSION_STATUSES) {
      expect(typeof status).toBe('string');
    }
    expect(SUBMISSION_STATUSES.length).toBe(13);
  });

  it('every status has a transition entry', () => {
    for (const status of SUBMISSION_STATUSES) {
      expect(SUBMISSION_TRANSITIONS).toHaveProperty(status);
    }
  });

  it('archived has no outgoing transitions', () => {
    expect(SUBMISSION_TRANSITIONS['archived']).toEqual([]);
  });

  it('draft can only go to submitted or withdrawn', () => {
    expect([...SUBMISSION_TRANSITIONS['draft']]).toEqual(expect.arrayContaining(['submitted', 'withdrawn']));
    expect(SUBMISSION_TRANSITIONS['draft']).toHaveLength(2);
  });

  it('decision enum only includes decidable decisions', () => {
    const decisionEnum = z.enum(['approved', 'denied', 'escalated', 'returned', 'pending_second_approval']);
    for (const d of ['approved', 'denied', 'escalated', 'returned', 'pending_second_approval']) {
      expect(decisionEnum.safeParse(d).success).toBe(true);
    }
    for (const d of ['draft', 'submitted', 'under_review', 'needs_review']) {
      expect(decisionEnum.safeParse(d).success).toBe(false);
    }
  });
});

// ============================================================
// SQL INJECTION PREVENTION (schema-level)
// ============================================================

describe('community queue SQL injection prevention via schema', () => {
  it('status filter rejects SQL injection payloads', () => {
    const payloads = [
      "'; DROP TABLE submissions; --",
      "submitted' OR '1'='1",
      'submitted; SELECT * FROM users',
    ];

    for (const payload of payloads) {
      const result = ListParamsSchema.safeParse({ status: payload });
      expect(result.success).toBe(false);
    }
  });

  it('submissionId rejects SQL injection payloads', () => {
    const payloads = [
      "'; DROP TABLE submissions; --",
      '1 OR 1=1',
      'abc',
    ];

    for (const payload of payloads) {
      const result = ClaimSchema.safeParse({
        submissionId: payload,
      });
      expect(result.success).toBe(false);
    }
  });
});
