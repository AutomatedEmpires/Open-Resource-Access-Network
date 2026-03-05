/**
 * Bulk Advance API + Merge API Schema Tests
 *
 * Validates Zod schemas and input sanitization for the admin bulk/merge routes.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ============================================================
// Re-declare schemas matching the route files
// ============================================================

const BulkAdvanceSchema = z.object({
  submissionIds: z
    .array(z.string().uuid('Each submissionId must be a valid UUID'))
    .min(1, 'At least one submissionId required')
    .max(100, 'Maximum 100 submissions per batch'),
  toStatus: z.string().min(1),
  reason: z.string().max(5000).optional(),
});

const MergeSchema = z.object({
  targetId: z.string().uuid('targetId must be a valid UUID'),
  sourceId: z.string().uuid('sourceId must be a valid UUID'),
});

// ============================================================
// BULK ADVANCE SCHEMA
// ============================================================

describe('BulkAdvanceSchema', () => {
  it('accepts valid bulk advance request', () => {
    const result = BulkAdvanceSchema.safeParse({
      submissionIds: ['550e8400-e29b-41d4-a716-446655440001'],
      toStatus: 'approved',
    });
    expect(result.success).toBe(true);
  });

  it('accepts up to 100 submission IDs', () => {
    const ids = Array.from({ length: 100 }, (_, i) =>
      `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`,
    );
    const result = BulkAdvanceSchema.safeParse({
      submissionIds: ids,
      toStatus: 'approved',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty submissionIds array', () => {
    const result = BulkAdvanceSchema.safeParse({
      submissionIds: [],
      toStatus: 'approved',
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 100 submission IDs', () => {
    const ids = Array.from({ length: 101 }, (_, i) =>
      `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`,
    );
    const result = BulkAdvanceSchema.safeParse({
      submissionIds: ids,
      toStatus: 'approved',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID submission IDs', () => {
    const result = BulkAdvanceSchema.safeParse({
      submissionIds: ['not-a-uuid'],
      toStatus: 'approved',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty toStatus', () => {
    const result = BulkAdvanceSchema.safeParse({
      submissionIds: ['550e8400-e29b-41d4-a716-446655440001'],
      toStatus: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional reason', () => {
    const result = BulkAdvanceSchema.safeParse({
      submissionIds: ['550e8400-e29b-41d4-a716-446655440001'],
      toStatus: 'denied',
      reason: 'Bulk denial - duplicate entries',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe('Bulk denial - duplicate entries');
    }
  });

  it('rejects reason exceeding 5000 characters', () => {
    const result = BulkAdvanceSchema.safeParse({
      submissionIds: ['550e8400-e29b-41d4-a716-446655440001'],
      toStatus: 'approved',
      reason: 'x'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// MERGE SCHEMA
// ============================================================

describe('MergeSchema', () => {
  it('accepts valid merge request', () => {
    const result = MergeSchema.safeParse({
      targetId: '550e8400-e29b-41d4-a716-446655440001',
      sourceId: '550e8400-e29b-41d4-a716-446655440002',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID targetId', () => {
    const result = MergeSchema.safeParse({
      targetId: 'not-uuid',
      sourceId: '550e8400-e29b-41d4-a716-446655440002',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID sourceId', () => {
    const result = MergeSchema.safeParse({
      targetId: '550e8400-e29b-41d4-a716-446655440001',
      sourceId: 'bad-id',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(MergeSchema.safeParse({}).success).toBe(false);
    expect(MergeSchema.safeParse({ targetId: '550e8400-e29b-41d4-a716-446655440001' }).success).toBe(false);
    expect(MergeSchema.safeParse({ sourceId: '550e8400-e29b-41d4-a716-446655440002' }).success).toBe(false);
  });
});
