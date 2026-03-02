/**
 * Community Queue API Contract Tests
 *
 * Validates Zod schemas, status transitions, and input sanitization
 * for the community verification queue API routes.
 * These tests run against the schema/validation layer — NOT the database.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
  VERIFICATION_STATUSES,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
import type { VerificationStatus } from '@/domain/types';

// ============================================================
// Re-declare schemas matching the route files (unit-testable)
// ============================================================

const ListParamsSchema = z.object({
  status: z
    .enum(['pending', 'in_review', 'verified', 'rejected', 'escalated'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const AssignSchema = z.object({
  queueEntryId: z.string().uuid('queueEntryId must be a valid UUID'),
  assignedTo: z.string().min(1, 'assignedTo is required').max(500),
});

const DecisionSchema = z.object({
  decision: z.enum(['verified', 'rejected', 'escalated'], {
    message: 'decision is required',
  }),
  notes: z.string().max(5000).optional(),
  reviewerUserId: z.string().min(1).max(500),
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
    }
  });

  it('accepts valid status filter', () => {
    for (const status of VERIFICATION_STATUSES) {
      const result = ListParamsSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    const result = ListParamsSchema.safeParse({ status: 'nonexistent' });
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
// ASSIGN SCHEMA
// ============================================================

describe('community queue assign schema', () => {
  it('accepts valid assign payload', () => {
    const result = AssignSchema.safeParse({
      queueEntryId: '550e8400-e29b-41d4-a716-446655440000',
      assignedTo: 'user_abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID queueEntryId', () => {
    const result = AssignSchema.safeParse({
      queueEntryId: 'not-a-uuid',
      assignedTo: 'user_123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty assignedTo', () => {
    const result = AssignSchema.safeParse({
      queueEntryId: '550e8400-e29b-41d4-a716-446655440000',
      assignedTo: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects assignedTo exceeding 500 chars', () => {
    const result = AssignSchema.safeParse({
      queueEntryId: '550e8400-e29b-41d4-a716-446655440000',
      assignedTo: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(AssignSchema.safeParse({}).success).toBe(false);
    expect(AssignSchema.safeParse({ queueEntryId: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(false);
    expect(AssignSchema.safeParse({ assignedTo: 'user_123' }).success).toBe(false);
  });
});

// ============================================================
// DECISION SCHEMA
// ============================================================

describe('community queue decision schema', () => {
  it('accepts valid verified decision', () => {
    const result = DecisionSchema.safeParse({
      decision: 'verified',
      reviewerUserId: 'user_abc123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid rejected decision with notes', () => {
    const result = DecisionSchema.safeParse({
      decision: 'rejected',
      notes: 'Phone number is disconnected.',
      reviewerUserId: 'user_abc123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid escalated decision', () => {
    const result = DecisionSchema.safeParse({
      decision: 'escalated',
      notes: 'Suspicious organization — needs deeper investigation.',
      reviewerUserId: 'user_abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects "pending" as a decision (not a terminal decision)', () => {
    const result = DecisionSchema.safeParse({
      decision: 'pending',
      reviewerUserId: 'user_abc123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects "in_review" as a decision', () => {
    const result = DecisionSchema.safeParse({
      decision: 'in_review',
      reviewerUserId: 'user_abc123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing decision', () => {
    const result = DecisionSchema.safeParse({
      reviewerUserId: 'user_abc123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing reviewerUserId', () => {
    const result = DecisionSchema.safeParse({
      decision: 'verified',
    });
    expect(result.success).toBe(false);
  });

  it('rejects notes exceeding 5000 chars', () => {
    const result = DecisionSchema.safeParse({
      decision: 'rejected',
      notes: 'x'.repeat(5001),
      reviewerUserId: 'user_abc123',
    });
    expect(result.success).toBe(false);
  });

  it('allows notes to be omitted', () => {
    const result = DecisionSchema.safeParse({
      decision: 'verified',
      reviewerUserId: 'user_abc123',
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
// VERIFICATION STATUS TRANSITIONS
// ============================================================

describe('verification status transitions', () => {
  // Only these starting statuses are valid for a decision
  const DECIDABLE_STATUSES: VerificationStatus[] = ['pending', 'in_review'];
  const TERMINAL_STATUSES: VerificationStatus[] = ['verified', 'rejected', 'escalated'];

  it('decidable statuses are pending and in_review', () => {
    expect(DECIDABLE_STATUSES).toEqual(['pending', 'in_review']);
  });

  it('terminal statuses are verified, rejected, escalated', () => {
    expect(TERMINAL_STATUSES).toEqual(['verified', 'rejected', 'escalated']);
  });

  it('all statuses are accounted for', () => {
    const allStatuses = [...DECIDABLE_STATUSES, ...TERMINAL_STATUSES];
    expect(new Set(allStatuses).size).toBe(5);
    for (const s of VERIFICATION_STATUSES) {
      expect(allStatuses).toContain(s);
    }
  });

  it('decision enum only includes terminal statuses', () => {
    const decisionEnum = z.enum(['verified', 'rejected', 'escalated']);
    for (const status of TERMINAL_STATUSES) {
      expect(decisionEnum.safeParse(status).success).toBe(true);
    }
    for (const status of DECIDABLE_STATUSES) {
      expect(decisionEnum.safeParse(status).success).toBe(false);
    }
  });
});

// ============================================================
// SQL INJECTION PREVENTION (schema-level)
// ============================================================

describe('community queue SQL injection prevention via schema', () => {
  it('status filter rejects SQL injection payloads', () => {
    const payloads = [
      "'; DROP TABLE verification_queue; --",
      "pending' OR '1'='1",
      'pending; SELECT * FROM users',
    ];

    for (const payload of payloads) {
      const result = ListParamsSchema.safeParse({ status: payload });
      expect(result.success).toBe(false);
    }
  });

  it('queueEntryId rejects SQL injection payloads', () => {
    const payloads = [
      "'; DROP TABLE verification_queue; --",
      '1 OR 1=1',
      'abc',
    ];

    for (const payload of payloads) {
      const result = AssignSchema.safeParse({
        queueEntryId: payload,
        assignedTo: 'user_123',
      });
      expect(result.success).toBe(false);
    }
  });
});
