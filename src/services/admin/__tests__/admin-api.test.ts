/**
 * ORAN Admin API Contract Tests
 *
 * Validates Zod schemas and input sanitization for the ORAN admin API routes:
 *   /api/admin/approvals  (GET + POST)
 *   /api/admin/rules      (GET + PUT)
 *   /api/admin/audit      (GET)
 *   /api/admin/zones      (GET + POST)
 *   /api/admin/zones/[id] (PUT + DELETE)
 *
 * These tests run against the schema/validation layer — NOT the database.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';

// ============================================================
// Re-declare schemas matching the route files (unit-testable)
// ============================================================

// ── Approvals schemas ──

const ApprovalsListSchema = z.object({
  status: z
    .enum(['submitted', 'under_review', 'approved', 'denied', 'escalated', 'pending_second_approval'])
    .optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const ApprovalsDecisionSchema = z.object({
  submissionId: z.string().uuid('submissionId must be a valid UUID'),
  decision:     z.enum(['approved', 'denied'], {
    message: 'decision must be approved or denied',
  }),
  notes:        z.string().max(5000).optional(),
});

// ── Rules schema ──

const UpdateFlagSchema = z.object({
  name:       z.string().min(1, 'Flag name is required').max(200),
  enabled:    z.boolean(),
  rolloutPct: z.number().int().min(0).max(100).default(100),
});

// ── Audit schema ──

const AUDIT_ACTIONS = [
  'create', 'update', 'delete',
  'approve', 'deny', 'escalate',
  'login', 'logout',
  'flag_change',
] as const;

const AuditListSchema = z.object({
  action:    z.enum(AUDIT_ACTIONS).optional(),
  tableName: z.string().max(100).optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

// ── Zones schemas ──

const ZonesListSchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const CreateZoneSchema = z.object({
  name:           z.string().min(1, 'Zone name is required').max(500),
  description:    z.string().max(5000).optional(),
  assignedUserId: z.string().max(500).optional(),
  status:         z.enum(['active', 'inactive']).default('active'),
});

const UpdateZoneSchema = z.object({
  name:           z.string().min(1).max(500).optional(),
  description:    z.string().max(5000).optional(),
  assignedUserId: z.string().max(500).nullable().optional(),
  status:         z.enum(['active', 'inactive']).optional(),
});

// ============================================================
// RATE LIMIT CONSTANTS
// ============================================================

describe('ORAN admin rate limit constants', () => {
  it('read limit is a positive integer', () => {
    expect(ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS).toBeGreaterThan(0);
    expect(Number.isInteger(ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS)).toBe(true);
  });

  it('write limit is a positive integer', () => {
    expect(ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS).toBeGreaterThan(0);
    expect(Number.isInteger(ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS)).toBe(true);
  });

  it('write limit <= read limit', () => {
    expect(ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS)
      .toBeLessThanOrEqual(ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS);
  });
});

// ============================================================
// APPROVALS LIST PARAMS
// ============================================================

describe('admin approvals list params', () => {
  it('accepts empty params with defaults', () => {
    const r = ApprovalsListSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.limit).toBe(DEFAULT_PAGE_SIZE);
      expect(r.data.status).toBeUndefined();
    }
  });

  it('accepts valid status values', () => {
    for (const status of ['submitted', 'under_review', 'approved', 'denied', 'escalated', 'pending_second_approval']) {
      expect(ApprovalsListSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    expect(ApprovalsListSchema.safeParse({ status: 'magic' }).success).toBe(false);
  });

  it('coerces string page/limit', () => {
    const r = ApprovalsListSchema.safeParse({ page: '2', limit: '50' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(2);
      expect(r.data.limit).toBe(50);
    }
  });

  it('rejects page < 1', () => {
    expect(ApprovalsListSchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects limit > 100', () => {
    expect(ApprovalsListSchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('rejects non-integer page', () => {
    expect(ApprovalsListSchema.safeParse({ page: '1.5' }).success).toBe(false);
  });
});

// ============================================================
// APPROVALS DECISION SCHEMA
// ============================================================

describe('admin approvals decision schema', () => {
  const VALID = {
    submissionId: '550e8400-e29b-41d4-a716-446655440000',
    decision: 'approved' as const,
  };

  it('accepts valid approved decision', () => {
    const r = ApprovalsDecisionSchema.safeParse(VALID);
    expect(r.success).toBe(true);
  });

  it('accepts valid denied decision', () => {
    const r = ApprovalsDecisionSchema.safeParse({ ...VALID, decision: 'denied' });
    expect(r.success).toBe(true);
  });

  it('accepts decision with notes', () => {
    const r = ApprovalsDecisionSchema.safeParse({ ...VALID, notes: 'Verified via phone' });
    expect(r.success).toBe(true);
  });

  it('rejects non-UUID submissionId', () => {
    expect(
      ApprovalsDecisionSchema.safeParse({ ...VALID, submissionId: 'bad-id' }).success,
    ).toBe(false);
  });

  it('rejects invalid decision value', () => {
    expect(
      ApprovalsDecisionSchema.safeParse({ ...VALID, decision: 'maybe' }).success,
    ).toBe(false);
  });

  it('rejects missing submissionId', () => {
    expect(
      ApprovalsDecisionSchema.safeParse({ decision: 'approved' }).success,
    ).toBe(false);
  });

  it('rejects missing decision', () => {
    expect(
      ApprovalsDecisionSchema.safeParse({ submissionId: VALID.submissionId }).success,
    ).toBe(false);
  });

  it('rejects notes longer than 5000 chars', () => {
    expect(
      ApprovalsDecisionSchema.safeParse({ ...VALID, notes: 'x'.repeat(5001) }).success,
    ).toBe(false);
  });
});

// ============================================================
// UPDATE FLAG SCHEMA
// ============================================================

describe('admin rules update flag schema', () => {
  const VALID = { name: 'llm_summarize', enabled: true, rolloutPct: 50 };

  it('accepts valid flag update', () => {
    const r = UpdateFlagSchema.safeParse(VALID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('llm_summarize');
      expect(r.data.enabled).toBe(true);
      expect(r.data.rolloutPct).toBe(50);
    }
  });

  it('defaults rolloutPct to 100', () => {
    const r = UpdateFlagSchema.safeParse({ name: 'test', enabled: false });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rolloutPct).toBe(100);
  });

  it('rejects empty name', () => {
    expect(UpdateFlagSchema.safeParse({ ...VALID, name: '' }).success).toBe(false);
  });

  it('rejects name longer than 200 chars', () => {
    expect(UpdateFlagSchema.safeParse({ ...VALID, name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('rejects non-boolean enabled', () => {
    expect(UpdateFlagSchema.safeParse({ ...VALID, enabled: 'yes' }).success).toBe(false);
  });

  it('rejects rolloutPct < 0', () => {
    expect(UpdateFlagSchema.safeParse({ ...VALID, rolloutPct: -1 }).success).toBe(false);
  });

  it('rejects rolloutPct > 100', () => {
    expect(UpdateFlagSchema.safeParse({ ...VALID, rolloutPct: 101 }).success).toBe(false);
  });

  it('rejects non-integer rolloutPct', () => {
    expect(UpdateFlagSchema.safeParse({ ...VALID, rolloutPct: 50.5 }).success).toBe(false);
  });

  it('accepts boundary rolloutPct 0 and 100', () => {
    expect(UpdateFlagSchema.safeParse({ ...VALID, rolloutPct: 0 }).success).toBe(true);
    expect(UpdateFlagSchema.safeParse({ ...VALID, rolloutPct: 100 }).success).toBe(true);
  });
});

// ============================================================
// AUDIT LIST PARAMS
// ============================================================

describe('admin audit list params', () => {
  it('accepts empty params with defaults', () => {
    const r = AuditListSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.limit).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it('accepts all valid action values', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AuditListSchema.safeParse({ action }).success).toBe(true);
    }
  });

  it('rejects invalid action', () => {
    expect(AuditListSchema.safeParse({ action: 'hack' }).success).toBe(false);
  });

  it('accepts tableName filter', () => {
    const r = AuditListSchema.safeParse({ tableName: 'services' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tableName).toBe('services');
  });

  it('rejects tableName over 100 chars', () => {
    expect(AuditListSchema.safeParse({ tableName: 'x'.repeat(101) }).success).toBe(false);
  });

  it('coerces string page/limit', () => {
    const r = AuditListSchema.safeParse({ page: '3', limit: '25' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(3);
      expect(r.data.limit).toBe(25);
    }
  });
});

// ============================================================
// ZONES LIST PARAMS
// ============================================================

describe('admin zones list params', () => {
  it('accepts empty params with defaults', () => {
    const r = ZonesListSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.limit).toBe(DEFAULT_PAGE_SIZE);
      expect(r.data.status).toBeUndefined();
    }
  });

  it('accepts active and inactive status', () => {
    expect(ZonesListSchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(ZonesListSchema.safeParse({ status: 'inactive' }).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(ZonesListSchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });

  it('rejects page < 1', () => {
    expect(ZonesListSchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects limit > 100', () => {
    expect(ZonesListSchema.safeParse({ limit: '200' }).success).toBe(false);
  });
});

// ============================================================
// CREATE ZONE SCHEMA
// ============================================================

describe('admin zones create schema', () => {
  const VALID = { name: 'Downtown Portland' };

  it('accepts minimal valid zone', () => {
    const r = CreateZoneSchema.safeParse(VALID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('Downtown Portland');
      expect(r.data.status).toBe('active');
    }
  });

  it('accepts full valid zone', () => {
    const r = CreateZoneSchema.safeParse({
      name: 'East Side',
      description: 'Covers the east side of the metro.',
      assignedUserId: 'user_abc123',
      status: 'inactive',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe('inactive');
      expect(r.data.assignedUserId).toBe('user_abc123');
    }
  });

  it('rejects empty name', () => {
    expect(CreateZoneSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects name over 500 chars', () => {
    expect(CreateZoneSchema.safeParse({ name: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects description over 5000 chars', () => {
    expect(
      CreateZoneSchema.safeParse({ ...VALID, description: 'x'.repeat(5001) }).success,
    ).toBe(false);
  });

  it('rejects assignedUserId over 500 chars', () => {
    expect(
      CreateZoneSchema.safeParse({ ...VALID, assignedUserId: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(
      CreateZoneSchema.safeParse({ ...VALID, status: 'deleted' }).success,
    ).toBe(false);
  });
});

// ============================================================
// UPDATE ZONE SCHEMA
// ============================================================

describe('admin zones update schema', () => {
  it('accepts empty update (no-op)', () => {
    const r = UpdateZoneSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts partial update with name only', () => {
    const r = UpdateZoneSchema.safeParse({ name: 'New Name' });
    expect(r.success).toBe(true);
  });

  it('accepts setting assignedUserId to null (unassign)', () => {
    const r = UpdateZoneSchema.safeParse({ assignedUserId: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.assignedUserId).toBeNull();
  });

  it('accepts status change', () => {
    const r = UpdateZoneSchema.safeParse({ status: 'inactive' });
    expect(r.success).toBe(true);
  });

  it('rejects empty name', () => {
    expect(UpdateZoneSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects name over 500 chars', () => {
    expect(UpdateZoneSchema.safeParse({ name: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(UpdateZoneSchema.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('rejects description over 5000 chars', () => {
    expect(UpdateZoneSchema.safeParse({ description: 'x'.repeat(5001) }).success).toBe(false);
  });
});
