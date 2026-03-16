import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);

import {
  checkSlaWarnings,
  escalateBreachedSubmissions,
  findNextAvailableAdmin,
  findOranAdmins,
  ensureDefaultNotificationPreferences,
  backfillAdminNotificationPreferences,
} from '@/services/escalation/engine';

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.executeQuery.mockResolvedValue([]);
});

// ============================================================
// checkSlaWarnings
// ============================================================

describe('checkSlaWarnings', () => {
  it('returns 0 when no submissions are approaching SLA', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const count = await checkSlaWarnings();

    expect(count).toBe(0);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('fires warning notifications for approaching submissions', async () => {
    const approaching = [
      {
        id: 'sub-1',
        assigned_to_user_id: 'admin-1',
        submitted_by_user_id: 'user-1',
        sla_deadline: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'sub-2',
        assigned_to_user_id: null,
        submitted_by_user_id: 'user-2',
        sla_deadline: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      },
    ];

    dbMocks.executeQuery
      .mockResolvedValueOnce(approaching) // query for approaching submissions
      .mockResolvedValueOnce([{ id: 'notif-1' }]) // insert for sub-1
      .mockResolvedValueOnce([{ id: 'notif-2' }]); // insert for sub-2

    const count = await checkSlaWarnings();

    expect(count).toBe(2);
    // 1 query + 2 notification inserts
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(3);
  });

  it('sends warning to assignee when present, submitter when not', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'sub-3',
        assigned_to_user_id: null,
        submitted_by_user_id: 'submitter-3',
        sla_deadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }])
      .mockResolvedValueOnce([{ id: 'notif-3' }]);

    await checkSlaWarnings();

    // The notification INSERT should use the submitter as recipient
    const insertCall = dbMocks.executeQuery.mock.calls[1];
    expect(insertCall[1][0]).toBe('submitter-3'); // recipient_user_id param
  });
});

// ============================================================
// escalateBreachedSubmissions
// ============================================================

describe('escalateBreachedSubmissions', () => {
  it('returns zero counts when no breached submissions exist', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const result = await escalateBreachedSubmissions();

    expect(result).toEqual({
      warnings: 0,
      renotified: 0,
      reassigned: 0,
      escalatedToOran: 0,
      silentReviewerReassignments: 0,
      ownerOutreachAlerts: 0,
      integrityHoldsApplied: 0,
    });
  });

  it('re-notifies assignee for submissions breached 12–23 hours', async () => {
    const breachedAt = new Date(Date.now() - 14 * 60 * 60 * 1000); // 14 hours ago

    dbMocks.executeQuery
      // 1. Query breached submissions
      .mockResolvedValueOnce([{
        id: 'sub-10',
        submission_type: 'service_verification',
        assigned_to_user_id: 'admin-10',
        submitted_by_user_id: 'user-10',
        sla_deadline: breachedAt.toISOString(),
        jurisdiction_state: 'CA',
        jurisdiction_county: 'Los Angeles',
      }])
      // 2. Re-notify assignee (notification insert)
      .mockResolvedValueOnce([{ id: 'notif-renotify' }])
      // 3. Query org host_admins
      .mockResolvedValueOnce([])
      // 4. Silent reviewer scan
      .mockResolvedValueOnce([])
      // 5. Silent owner org scan
      .mockResolvedValueOnce([]);

    const result = await escalateBreachedSubmissions();

    expect(result.renotified).toBe(1);
    expect(result.reassigned).toBe(0);
    expect(result.escalatedToOran).toBe(0);
  });

  it('reassigns to next admin for submissions breached 24–47 hours', async () => {
    const breachedAt = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 hours ago

    dbMocks.executeQuery
      // 1. Query breached submissions
      .mockResolvedValueOnce([{
        id: 'sub-20',
        submission_type: 'service_verification',
        assigned_to_user_id: 'admin-20',
        submitted_by_user_id: 'user-20',
        sla_deadline: breachedAt.toISOString(),
        jurisdiction_state: 'TX',
        jurisdiction_county: 'Harris',
      }])
      // 2. Check if already reassigned at this tier
      .mockResolvedValueOnce([]) // no existing notification → proceed
      // 3. Find next available admin
      .mockResolvedValueOnce([{
        user_id: 'admin-25',
        pending_count: 3,
        max_pending: 10,
      }])
      // 4. Reassign submission
      .mockResolvedValueOnce([])
      // 5. Notify new assignee
      .mockResolvedValueOnce([])
      // 6. Silent reviewer scan
      .mockResolvedValueOnce([])
      // 7. Silent owner org scan
      .mockResolvedValueOnce([]);

    const result = await escalateBreachedSubmissions();

    expect(result.reassigned).toBe(1);
    expect(result.escalatedToOran).toBe(0);
  });

  it('skips reassignment if already processed at tier', async () => {
    const breachedAt = new Date(Date.now() - 30 * 60 * 60 * 1000);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'sub-21',
        submission_type: 'service_verification',
        assigned_to_user_id: 'admin-21',
        submitted_by_user_id: 'user-21',
        sla_deadline: breachedAt.toISOString(),
        jurisdiction_state: 'CA',
        jurisdiction_county: null,
      }])
      // Already has a reassigned notification → skip
      .mockResolvedValueOnce([{ id: 'existing-notif' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await escalateBreachedSubmissions();

    expect(result.reassigned).toBe(0);
  });

  it('escalates to ORAN admin for submissions breached 48+ hours', async () => {
    const breachedAt = new Date(Date.now() - 50 * 60 * 60 * 1000); // 50 hours ago

    dbMocks.executeQuery
      // 1. Query breached submissions
      .mockResolvedValueOnce([{
        id: 'sub-30',
        submission_type: 'community_report',
        assigned_to_user_id: 'admin-30',
        submitted_by_user_id: 'user-30',
        sla_deadline: breachedAt.toISOString(),
        jurisdiction_state: 'NY',
        jurisdiction_county: 'Kings',
      }])
      // 2. Check if already escalated
      .mockResolvedValueOnce([]) // not yet
      // 3. Find ORAN admins (moved before status transition)
      .mockResolvedValueOnce([{
        user_id: 'oran-admin-1',
        pending_count: 5,
        max_pending: 50,
      }])
      // 4. Capture current status
      .mockResolvedValueOnce([{ status: 'needs_review' }])
      // 5. Update submission status to escalated
      .mockResolvedValueOnce([])
      // 6. Insert transition record
      .mockResolvedValueOnce([])
      // 7. Notify ORAN admin
      .mockResolvedValueOnce([{ id: 'notif-oran' }])
      // 8. Reassign to ORAN admin
      .mockResolvedValueOnce([])
      // 9. Insert escalation marker
      .mockResolvedValueOnce([])
      // 10. Silent reviewer scan
      .mockResolvedValueOnce([])
      // 11. Silent owner org scan
      .mockResolvedValueOnce([]);

    const result = await escalateBreachedSubmissions();

    expect(result.escalatedToOran).toBe(1);
  });

  it('skips ORAN escalation if already processed', async () => {
    const breachedAt = new Date(Date.now() - 50 * 60 * 60 * 1000);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'sub-31',
        submission_type: 'service_verification',
        assigned_to_user_id: 'admin-31',
        submitted_by_user_id: 'user-31',
        sla_deadline: breachedAt.toISOString(),
        jurisdiction_state: null,
        jurisdiction_county: null,
      }])
      // Already escalated
      .mockResolvedValueOnce([{ id: 'existing-escalation' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await escalateBreachedSubmissions();

    expect(result.escalatedToOran).toBe(0);
  });

  it('returns 0 when no ORAN admins exist for T+48 escalation', async () => {
    const breachedAt = new Date(Date.now() - 50 * 60 * 60 * 1000);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'sub-32',
        submission_type: 'service_verification',
        assigned_to_user_id: 'admin-32',
        submitted_by_user_id: 'user-32',
        sla_deadline: breachedAt.toISOString(),
        jurisdiction_state: null,
        jurisdiction_county: null,
      }])
      // Not yet processed
      .mockResolvedValueOnce([])
      // No ORAN admins available
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await escalateBreachedSubmissions();

    // Should NOT transition status since nobody can handle it
    expect(result.escalatedToOran).toBe(0);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(5);
  });

  it('does not reassign when no admin with capacity exists', async () => {
    const breachedAt = new Date(Date.now() - 30 * 60 * 60 * 1000);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'sub-40',
        submission_type: 'service_verification',
        assigned_to_user_id: 'admin-40',
        submitted_by_user_id: 'user-40',
        sla_deadline: breachedAt.toISOString(),
        jurisdiction_state: 'FL',
        jurisdiction_county: null,
      }])
      // Not yet processed
      .mockResolvedValueOnce([])
      // No available admin
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await escalateBreachedSubmissions();

    expect(result.reassigned).toBe(0);
  });

  it('reclaims stalled assignments from silent reviewers', async () => {
    const breachedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'sub-50',
        submission_type: 'service_verification',
        assigned_to_user_id: 'admin-50',
        submitted_by_user_id: 'user-50',
        sla_deadline: breachedAt.toISOString(),
        jurisdiction_state: 'WA',
        jurisdiction_county: 'King',
      }])
      .mockResolvedValueOnce([{
        id: 'sub-stalled',
        assigned_to_user_id: 'admin-silent',
        submitted_by_user_id: 'submitter-silent',
        jurisdiction_state: 'WA',
        jurisdiction_county: 'King',
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        user_id: 'admin-active',
        pending_count: 1,
        max_pending: 10,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await escalateBreachedSubmissions();

    expect(result.silentReviewerReassignments).toBe(1);
  });

  it('alerts silent owner organizations with active listings', async () => {
    const breachedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'sub-60',
        submission_type: 'service_verification',
        assigned_to_user_id: 'admin-60',
        submitted_by_user_id: 'user-60',
        sla_deadline: breachedAt.toISOString(),
        jurisdiction_state: 'CA',
        jurisdiction_county: 'Alameda',
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        organization_id: 'org-1',
        organization_name: 'Silent Org',
        active_service_count: 3,
        host_admin_user_ids: ['host-1', 'host-2'],
      }])
      .mockResolvedValueOnce([{ user_id: 'oran-1', pending_count: 2, max_pending: 20 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await escalateBreachedSubmissions();

    expect(result.ownerOutreachAlerts).toBe(1);
  });
});

// ============================================================
// findNextAvailableAdmin
// ============================================================

describe('findNextAvailableAdmin', () => {
  it('returns null when no admin has capacity', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const admin = await findNextAvailableAdmin('CA', 'Los Angeles', 'admin-1');

    expect(admin).toBeNull();
  });

  it('returns the first matching admin', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{
      user_id: 'admin-5',
      pending_count: 2,
      max_pending: 10,
    }]);

    const admin = await findNextAvailableAdmin('TX', null, 'admin-1');

    expect(admin).toEqual({
      user_id: 'admin-5',
      pending_count: 2,
      max_pending: 10,
    });
  });

  it('passes excludeUserId to the query', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    await findNextAvailableAdmin('CA', 'SF', 'exclude-me');

    const queryParams = dbMocks.executeQuery.mock.calls[0][1];
    expect(queryParams[0]).toBe('exclude-me');
  });
});

// ============================================================
// findOranAdmins
// ============================================================

describe('findOranAdmins', () => {
  it('returns empty array when no ORAN admins exist', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const admins = await findOranAdmins();

    expect(admins).toEqual([]);
  });

  it('returns ORAN admins ordered by capacity', async () => {
    const mockAdmins = [
      { user_id: 'oran-1', pending_count: 2, max_pending: 50 },
      { user_id: 'oran-2', pending_count: 5, max_pending: 50 },
    ];
    dbMocks.executeQuery.mockResolvedValueOnce(mockAdmins);

    const admins = await findOranAdmins();

    expect(admins).toHaveLength(2);
    expect(admins[0].user_id).toBe('oran-1');
  });
});

// ============================================================
// ensureDefaultNotificationPreferences
// ============================================================

describe('ensureDefaultNotificationPreferences', () => {
  it('creates preference rows for all default event types', async () => {
    // Single batched INSERT returns 6 ids (one per event type)
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        { id: 'pref-1' },
        { id: 'pref-2' },
        { id: 'pref-3' },
        { id: 'pref-4' },
        { id: 'pref-5' },
        { id: 'pref-6' },
      ]);

    const created = await ensureDefaultNotificationPreferences('admin-1');

    expect(created).toBe(6);
    // Single batched INSERT
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when all preferences already exist (ON CONFLICT)', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]); // ON CONFLICT DO NOTHING → empty

    const created = await ensureDefaultNotificationPreferences('admin-2');

    expect(created).toBe(0);
  });

  it('counts only newly created preferences', async () => {
    // Batched INSERT returns only 3 ids (3 new, 3 already existed)
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        { id: 'pref-new-1' },
        { id: 'pref-new-2' },
        { id: 'pref-new-3' },
      ]);

    const created = await ensureDefaultNotificationPreferences('admin-3');

    expect(created).toBe(3);
  });
});

// ============================================================
// backfillAdminNotificationPreferences
// ============================================================

describe('backfillAdminNotificationPreferences', () => {
  it('provisions preferences for all admin users', async () => {
    // Query for admin users
    dbMocks.executeQuery.mockResolvedValueOnce([
      { user_id: 'admin-a' },
      { user_id: 'admin-b' },
    ]);

    // For admin-a: batched INSERT returns 6 new rows
    dbMocks.executeQuery.mockResolvedValueOnce([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' },
      { id: 'p4' }, { id: 'p5' }, { id: 'p6' },
    ]);

    // For admin-b: batched INSERT returns 2 new rows (4 already existed)
    dbMocks.executeQuery.mockResolvedValueOnce([
      { id: 'p7' }, { id: 'p8' },
    ]);

    const total = await backfillAdminNotificationPreferences();

    expect(total).toBe(8); // 6 + 2
    // 1 admin query + 1 batch per admin = 3 total
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(3);
  });

  it('returns 0 when no admin users exist', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const total = await backfillAdminNotificationPreferences();

    expect(total).toBe(0);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1);
  });
});
