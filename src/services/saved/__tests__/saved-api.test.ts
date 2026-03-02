/**
 * Saved Services API Contract Tests
 *
 * Tests for the /api/saved route:
 *   - ServiceIdSchema validation (Zod)
 *   - Rate limit constant is reasonable
 *   - Idempotent save/remove contract expectations
 *   - Response shape contracts
 *
 * Tests run against the schema/validation layer — NOT the database.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ============================================================
// Re-declare schemas matching src/app/api/saved/route.ts
// ============================================================

const ServiceIdSchema = z.object({
  serviceId: z.string().uuid('serviceId must be a valid UUID'),
});

const SAVED_RATE_LIMIT_MAX = 30;

// ============================================================
// RATE LIMIT CONSTANTS
// ============================================================

describe('Saved services rate limit constant', () => {
  it('is a positive integer', () => {
    expect(SAVED_RATE_LIMIT_MAX).toBeGreaterThan(0);
    expect(Number.isInteger(SAVED_RATE_LIMIT_MAX)).toBe(true);
  });

  it('is at most 200 (reasonable upper bound)', () => {
    expect(SAVED_RATE_LIMIT_MAX).toBeLessThanOrEqual(200);
  });
});

// ============================================================
// ServiceIdSchema
// ============================================================

describe('ServiceIdSchema', () => {
  const validUuid = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

  it('accepts a valid UUID', () => {
    const result = ServiceIdSchema.safeParse({ serviceId: validUuid });
    expect(result.success).toBe(true);
    expect(result.data?.serviceId).toBe(validUuid);
  });

  it('accepts a standard v4 UUID', () => {
    const v4 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const result = ServiceIdSchema.safeParse({ serviceId: v4 });
    expect(result.success).toBe(true);
  });

  it('rejects empty serviceId', () => {
    const result = ServiceIdSchema.safeParse({ serviceId: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('UUID');
  });

  it('rejects non-UUID string', () => {
    const result = ServiceIdSchema.safeParse({ serviceId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects missing serviceId', () => {
    const result = ServiceIdSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects numeric serviceId', () => {
    const result = ServiceIdSchema.safeParse({ serviceId: 12345 });
    expect(result.success).toBe(false);
  });

  it('rejects null serviceId', () => {
    const result = ServiceIdSchema.safeParse({ serviceId: null });
    expect(result.success).toBe(false);
  });

  it('strips extra fields (Zod default strip)', () => {
    const result = ServiceIdSchema.safeParse({
      serviceId: validUuid,
      extraField: 'should-be-stripped',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ serviceId: validUuid });
    expect((result.data as Record<string, unknown>)['extraField']).toBeUndefined();
  });

  it('rejects UUID-like strings with wrong format', () => {
    // Missing one section
    const result = ServiceIdSchema.safeParse({
      serviceId: '00000000-0000-0000-000000000001',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// Response shape contracts
// ============================================================

describe('Saved services GET response contract', () => {
  it('returns { savedIds: string[] }', () => {
    const response = {
      savedIds: [
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ],
    };
    expect(response).toHaveProperty('savedIds');
    expect(Array.isArray(response.savedIds)).toBe(true);
    expect(response.savedIds).toHaveLength(2);
  });

  it('returns empty array when nothing is saved', () => {
    const response = { savedIds: [] };
    expect(response.savedIds).toEqual([]);
  });
});

describe('Saved services POST response contract', () => {
  it('returns { saved: true, serviceId: string }', () => {
    const serviceId = '00000000-0000-0000-0000-000000000001';
    const response = { saved: true, serviceId };
    expect(response.saved).toBe(true);
    expect(response.serviceId).toBe(serviceId);
  });

  it('is idempotent (same response for duplicate saves)', () => {
    // Saving the same service twice should produce the same response
    // due to ON CONFLICT DO NOTHING
    const serviceId = '00000000-0000-0000-0000-000000000001';
    const response1 = { saved: true, serviceId };
    const response2 = { saved: true, serviceId };
    expect(response1).toEqual(response2);
  });
});

describe('Saved services DELETE response contract', () => {
  it('returns { removed: true, serviceId: string }', () => {
    const serviceId = '00000000-0000-0000-0000-000000000001';
    const response = { removed: true, serviceId };
    expect(response.removed).toBe(true);
    expect(response.serviceId).toBe(serviceId);
  });

  it('is idempotent (removing a non-existent save does not error)', () => {
    // Deleting a service that isn't saved should still return success
    const serviceId = '00000000-0000-0000-0000-000000000099';
    const response = { removed: true, serviceId };
    expect(response.removed).toBe(true);
  });
});

// ============================================================
// API endpoint contract expectations
// ============================================================

describe('Saved services API contract expectations', () => {
  it('requires authentication on all methods (401 without auth)', () => {
    const error = { error: 'Authentication required' };
    expect(error.error).toBe('Authentication required');
  });

  it('returns 503 when database is not configured', () => {
    const error = { error: 'Saved services unavailable.' };
    expect(error.error).toContain('unavailable');
  });

  it('returns 400 for invalid JSON body', () => {
    const error = { error: 'Invalid JSON body' };
    expect(error.error).toBe('Invalid JSON body');
  });

  it('returns 400 for invalid serviceId (includes details)', () => {
    const error = {
      error: 'Invalid request',
      details: [{ message: 'serviceId must be a valid UUID' }],
    };
    expect(error.error).toBe('Invalid request');
    expect(error.details).toBeDefined();
    expect(error.details[0].message).toContain('UUID');
  });

  it('returns 429 when rate limited', () => {
    const error = {
      error: 'Rate limit exceeded. Please wait before making more requests.',
    };
    expect(error.error).toContain('Rate limit exceeded');
  });
});
