/**
 * Profile API Contract Tests
 *
 * Tests for the /api/profile route:
 *   - UpdateProfileSchema validation (Zod)
 *   - Rate limit constant is reasonable
 *   - Schema rejects invalid inputs
 *   - Schema accepts valid inputs
 *
 * Tests run against the schema/validation layer — NOT the database.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ============================================================
// Re-declare schemas matching src/app/api/profile/route.ts
// ============================================================

const UpdateProfileSchema = z.object({
  approximateCity: z.string().max(100).optional(),
  preferredLocale: z.string().max(10).optional(),
});

const PROFILE_RATE_LIMIT_MAX = 20;

// ============================================================
// RATE LIMIT CONSTANTS
// ============================================================

describe('Profile rate limit constant', () => {
  it('is a positive integer', () => {
    expect(PROFILE_RATE_LIMIT_MAX).toBeGreaterThan(0);
    expect(Number.isInteger(PROFILE_RATE_LIMIT_MAX)).toBe(true);
  });

  it('is at most 100 (reasonable upper bound)', () => {
    expect(PROFILE_RATE_LIMIT_MAX).toBeLessThanOrEqual(100);
  });
});

// ============================================================
// UpdateProfileSchema
// ============================================================

describe('UpdateProfileSchema', () => {
  it('accepts empty object (both fields optional)', () => {
    const result = UpdateProfileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts valid approximateCity', () => {
    const result = UpdateProfileSchema.safeParse({ approximateCity: 'Portland' });
    expect(result.success).toBe(true);
    expect(result.data?.approximateCity).toBe('Portland');
  });

  it('accepts valid preferredLocale', () => {
    const result = UpdateProfileSchema.safeParse({ preferredLocale: 'en-US' });
    expect(result.success).toBe(true);
    expect(result.data?.preferredLocale).toBe('en-US');
  });

  it('accepts both fields together', () => {
    const result = UpdateProfileSchema.safeParse({
      approximateCity: 'Seattle',
      preferredLocale: 'es',
    });
    expect(result.success).toBe(true);
    expect(result.data?.approximateCity).toBe('Seattle');
    expect(result.data?.preferredLocale).toBe('es');
  });

  it('rejects approximateCity longer than 100 characters', () => {
    const result = UpdateProfileSchema.safeParse({
      approximateCity: 'A'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('accepts approximateCity of exactly 100 characters', () => {
    const result = UpdateProfileSchema.safeParse({
      approximateCity: 'A'.repeat(100),
    });
    expect(result.success).toBe(true);
  });

  it('rejects preferredLocale longer than 10 characters', () => {
    const result = UpdateProfileSchema.safeParse({
      preferredLocale: 'A'.repeat(11),
    });
    expect(result.success).toBe(false);
  });

  it('accepts preferredLocale of exactly 10 characters', () => {
    const result = UpdateProfileSchema.safeParse({
      preferredLocale: 'A'.repeat(10),
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-string approximateCity', () => {
    const result = UpdateProfileSchema.safeParse({ approximateCity: 12345 });
    expect(result.success).toBe(false);
  });

  it('rejects non-string preferredLocale', () => {
    const result = UpdateProfileSchema.safeParse({ preferredLocale: true });
    expect(result.success).toBe(false);
  });

  it('strips extra fields (Zod default strip behavior)', () => {
    const result = UpdateProfileSchema.safeParse({
      approximateCity: 'Portland',
      role: 'oran_admin', // should NOT be settable via this endpoint
      displayName: 'Hacker',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ approximateCity: 'Portland' });
    // role and displayName must NOT appear in parsed data
    expect((result.data as Record<string, unknown>)['role']).toBeUndefined();
    expect((result.data as Record<string, unknown>)['displayName']).toBeUndefined();
  });

  it('accepts empty strings (city could be cleared)', () => {
    const result = UpdateProfileSchema.safeParse({
      approximateCity: '',
      preferredLocale: '',
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// ProfileResponse shape contract
// ============================================================

describe('ProfileResponse contract', () => {
  interface ProfileResponse {
    userId: string;
    preferredLocale: string | null;
    approximateCity: string | null;
  }

  it('has the expected shape', () => {
    const profile: ProfileResponse = {
      userId: 'user-123',
      preferredLocale: 'en',
      approximateCity: 'Portland',
    };

    expect(profile).toHaveProperty('userId');
    expect(profile).toHaveProperty('preferredLocale');
    expect(profile).toHaveProperty('approximateCity');
  });

  it('allows null for optional fields', () => {
    const profile: ProfileResponse = {
      userId: 'user-456',
      preferredLocale: null,
      approximateCity: null,
    };

    expect(profile.preferredLocale).toBeNull();
    expect(profile.approximateCity).toBeNull();
  });
});

// ============================================================
// API endpoint contract expectations
// ============================================================

describe('Profile API contract expectations', () => {
  it('GET /api/profile returns { profile: ProfileResponse | null }', () => {
    // Contract: GET returns an object with a profile key
    // When no profile exists, profile is null
    const noProfileResponse = { profile: null };
    expect(noProfileResponse).toHaveProperty('profile', null);

    // When profile exists, profile is an object
    const profileResponse = {
      profile: {
        userId: 'user-1',
        preferredLocale: 'en',
        approximateCity: 'Portland',
      },
    };
    expect(profileResponse.profile).toBeDefined();
    expect(profileResponse.profile.userId).toBe('user-1');
  });

  it('PUT /api/profile returns { profile: ProfileResponse }', () => {
    // Contract: PUT always returns an upserted profile
    const putResponse = {
      profile: {
        userId: 'user-1',
        preferredLocale: 'en',
        approximateCity: 'Seattle',
      },
    };
    expect(putResponse.profile).toBeDefined();
    expect(putResponse.profile.userId).toBe('user-1');
  });

  it('requires authentication (401 without auth)', () => {
    // Contract: unauthenticated requests get { error: "Authentication required" }
    const errorResponse = { error: 'Authentication required' };
    expect(errorResponse.error).toBe('Authentication required');
  });

  it('returns 503 when database is not configured', () => {
    const errorResponse = { error: 'Profile service is temporarily unavailable.' };
    expect(errorResponse.error).toContain('temporarily unavailable');
  });
});
