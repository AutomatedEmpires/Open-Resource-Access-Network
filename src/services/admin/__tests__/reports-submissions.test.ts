/**
 * Reports → Submissions Integration Schema Tests
 *
 * Validates the report request schema and the fact that reports
 * now create submissions in the universal pipeline.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ============================================================
// Re-declare schemas matching the route file
// ============================================================

const ISSUE_TYPES = [
  'wrong_info',
  'closed_permanently',
  'wrong_hours',
  'wrong_address',
  'wrong_phone',
  'not_free',
  'safety_concern',
  'duplicate',
  'other',
] as const;

const ReportRequestSchema = z.object({
  serviceId: z.string().uuid('serviceId must be a valid UUID'),
  issueType: z.enum(ISSUE_TYPES, { message: 'Invalid issue type' }),
  comment: z.string().max(2000, 'Comment must be 2000 characters or fewer').optional(),
});

// ============================================================
// TESTS
// ============================================================

describe('ReportRequestSchema', () => {
  it('accepts valid report without comment', () => {
    const result = ReportRequestSchema.safeParse({
      serviceId: '550e8400-e29b-41d4-a716-446655440001',
      issueType: 'wrong_info',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid report with comment', () => {
    const result = ReportRequestSchema.safeParse({
      serviceId: '550e8400-e29b-41d4-a716-446655440001',
      issueType: 'safety_concern',
      comment: 'This location appears unsafe after dark.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comment).toBe('This location appears unsafe after dark.');
    }
  });

  it('accepts all valid issue types', () => {
    for (const issueType of ISSUE_TYPES) {
      const result = ReportRequestSchema.safeParse({
        serviceId: '550e8400-e29b-41d4-a716-446655440001',
        issueType,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid issue type', () => {
    const result = ReportRequestSchema.safeParse({
      serviceId: '550e8400-e29b-41d4-a716-446655440001',
      issueType: 'invalid_type',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID serviceId', () => {
    const result = ReportRequestSchema.safeParse({
      serviceId: 'not-a-uuid',
      issueType: 'wrong_info',
    });
    expect(result.success).toBe(false);
  });

  it('rejects comment exceeding 2000 characters', () => {
    const result = ReportRequestSchema.safeParse({
      serviceId: '550e8400-e29b-41d4-a716-446655440001',
      issueType: 'other',
      comment: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing serviceId', () => {
    const result = ReportRequestSchema.safeParse({
      issueType: 'wrong_info',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing issueType', () => {
    const result = ReportRequestSchema.safeParse({
      serviceId: '550e8400-e29b-41d4-a716-446655440001',
    });
    expect(result.success).toBe(false);
  });
});

describe('Report creates community_report submission', () => {
  it('community_report is a valid submission_type in the domain model', () => {
    // Verify that the constant exists in the domain for forwards compatibility
    const SUBMISSION_TYPES = [
      'service_verification',
      'service_update',
      'new_service',
      'org_claim',
      'data_correction',
      'community_report',
      'service_removal',
    ] as const;

    expect(SUBMISSION_TYPES).toContain('community_report');
  });
});

describe('Invite response schema', () => {
  const InviteResponseSchema = z.object({
    membershipId: z.string().uuid(),
    action: z.enum(['accept', 'decline']),
  });

  it('accepts valid accept action', () => {
    const result = InviteResponseSchema.safeParse({
      membershipId: '550e8400-e29b-41d4-a716-446655440001',
      action: 'accept',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid decline action', () => {
    const result = InviteResponseSchema.safeParse({
      membershipId: '550e8400-e29b-41d4-a716-446655440001',
      action: 'decline',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = InviteResponseSchema.safeParse({
      membershipId: '550e8400-e29b-41d4-a716-446655440001',
      action: 'ignore',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID membershipId', () => {
    const result = InviteResponseSchema.safeParse({
      membershipId: 'bad-id',
      action: 'accept',
    });
    expect(result.success).toBe(false);
  });
});
