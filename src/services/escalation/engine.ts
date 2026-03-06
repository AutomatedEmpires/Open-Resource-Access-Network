/**
 * Escalation Engine
 *
 * Manages tiered auto-escalation for breached SLA submissions,
 * SLA pre-breach warnings, and default admin notification preferences.
 *
 * Escalation cadence (hours after SLA breach):
 *   T+0h  → Notify assignee (handled by existing checkSlaBreaches)
 *   T+12h → Re-notify assignee + alert org's host_admin
 *   T+24h → Reassign to next available admin with capacity
 *   T+48h → Escalate to ORAN admin queue
 *
 * @module services/escalation/engine
 */

import { executeQuery } from '@/services/db/postgres';
import {
  ESCALATION_TIERS,
  SLA_WARNING_THRESHOLD,
  DEFAULT_ADMIN_NOTIFICATION_EVENTS,
} from '@/domain/constants';

// ============================================================
// TYPES
// ============================================================

interface BreachedSubmission {
  id: string;
  submission_type: string;
  assigned_to_user_id: string | null;
  submitted_by_user_id: string;
  sla_deadline: string;
  jurisdiction_state: string | null;
  jurisdiction_county: string | null;
}

interface WarningSubmission {
  id: string;
  assigned_to_user_id: string | null;
  submitted_by_user_id: string;
  sla_deadline: string;
}

interface AdminCandidate {
  user_id: string;
  pending_count: number;
  max_pending: number;
}

export interface EscalationResult {
  warnings: number;
  renotified: number;
  reassigned: number;
  escalatedToOran: number;
}

// ============================================================
// SLA WARNING (PRE-BREACH)
// ============================================================

/**
 * Find submissions approaching their SLA deadline (≥75% elapsed)
 * that have not yet been warned, and fire `submission_sla_warning`.
 *
 * Warning threshold: `SLA_WARNING_THRESHOLD` (0.75) of the SLA window.
 * Uses `sla_warning_sent` column to avoid duplicate warnings.
 */
export async function checkSlaWarnings(): Promise<number> {
  const submissions = await executeQuery<WarningSubmission>(
    `SELECT s.id, s.assigned_to_user_id, s.submitted_by_user_id, s.sla_deadline
     FROM submissions s
     WHERE s.sla_deadline IS NOT NULL
       AND s.sla_breached = false
       AND s.status IN ('needs_review', 'under_review', 'pending_second_approval')
       AND NOW() >= s.sla_deadline - (
         (s.sla_deadline - COALESCE(s.submitted_at, s.created_at))
         * (1.0 - ${SLA_WARNING_THRESHOLD})
       )
       AND NOT EXISTS (
         SELECT 1 FROM notification_events ne
         WHERE ne.resource_id = s.id
           AND ne.resource_type = 'submission'
           AND ne.event_type = 'submission_sla_warning'
       )`,
    [],
  );

  for (const sub of submissions) {
    const recipientId = sub.assigned_to_user_id ?? sub.submitted_by_user_id;
    await executeQuery(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body,
          resource_type, resource_id, action_url, idempotency_key)
       VALUES ($1, 'submission_sla_warning',
               'SLA Warning: Submission approaching deadline',
               'Submission ' || $2 || ' is approaching its SLA deadline. Please review soon.',
               'submission', $2, '/verify?id=' || $2,
               'sla_warning_' || $2)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [recipientId, sub.id],
    );
  }

  return submissions.length;
}

// ============================================================
// TIERED ESCALATION
// ============================================================

/**
 * Process breached submissions through the escalation tiers.
 *
 * For each breached submission, determines how long it has been breached
 * and applies the appropriate escalation tier action:
 *  - T+12h: Re-notify assignee + notify org host_admin
 *  - T+24h: Reassign to next available admin
 *  - T+48h: Escalate to ORAN admin
 *
 * T+0h (initial breach notification) is handled by `checkSlaBreaches()`.
 */
export async function escalateBreachedSubmissions(): Promise<EscalationResult> {
  const result: EscalationResult = {
    warnings: 0,
    renotified: 0,
    reassigned: 0,
    escalatedToOran: 0,
  };

  const breached = await executeQuery<BreachedSubmission>(
    `SELECT s.id, s.submission_type, s.assigned_to_user_id,
            s.submitted_by_user_id, s.sla_deadline,
            s.jurisdiction_state, s.jurisdiction_county
     FROM submissions s
     WHERE s.sla_breached = true
       AND s.status IN ('needs_review', 'under_review', 'pending_second_approval')
     ORDER BY s.sla_deadline ASC`,
    [],
  );

  for (const sub of breached) {
    const breachTime = new Date(sub.sla_deadline);
    const hoursBreached = (Date.now() - breachTime.getTime()) / (1000 * 60 * 60);

    // Determine the highest applicable escalation tier
    const tier = getApplicableTier(hoursBreached);
    if (!tier) continue;

    switch (tier.action) {
      case 'notify_assignee':
        // Handled by existing checkSlaBreaches — skip
        break;

      case 'renotify_and_alert_org':
        result.renotified += await renotifyAndAlertOrg(sub);
        break;

      case 'reassign_to_next_admin':
        result.reassigned += await reassignToNextAdmin(sub);
        break;

      case 'escalate_to_oran_admin':
        result.escalatedToOran += await escalateToOranAdmin(sub);
        break;
    }
  }

  return result;
}

/**
 * Find the highest applicable escalation tier for the given breach duration.
 */
function getApplicableTier(hoursBreached: number) {
  // Walk tiers in reverse to find the highest matching one
  for (let i = ESCALATION_TIERS.length - 1; i >= 0; i--) {
    if (hoursBreached >= ESCALATION_TIERS[i].hoursAfterBreach) {
      return ESCALATION_TIERS[i];
    }
  }
  return null;
}

/**
 * Tier 2: Re-notify assignee and alert the org's host_admin.
 */
async function renotifyAndAlertOrg(sub: BreachedSubmission): Promise<number> {
  const idempotencyBase = `escalation_t12_${sub.id}`;
  let sent = 0;

  // Re-notify the assignee
  if (sub.assigned_to_user_id) {
    const rows = await executeQuery<{ id: string }>(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body,
          resource_type, resource_id, action_url, idempotency_key)
       VALUES ($1, 'submission_escalation_warning',
               'Reminder: SLA breached submission requires action',
               'Submission ' || $2 || ' has been past its SLA deadline for over 12 hours.',
               'submission', $2, '/verify?id=' || $2, $3)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [sub.assigned_to_user_id, sub.id, `${idempotencyBase}_assignee`],
    );
    if (rows.length > 0) sent++;
  }

  // Alert the org's host_admin (if the submission has a target org)
  const hostAdmins = await executeQuery<{ user_id: string }>(
    `SELECT DISTINCT om.user_id
     FROM organization_members om
     JOIN submissions s ON s.target_id = om.organization_id
     WHERE s.id = $1
       AND s.target_type = 'organization'
       AND om.role = 'admin'
       AND om.status = 'active'`,
    [sub.id],
  );

  for (const admin of hostAdmins) {
    const rows = await executeQuery<{ id: string }>(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body,
          resource_type, resource_id, action_url, idempotency_key)
       VALUES ($1, 'submission_escalation_warning',
               'Escalation: SLA breached submission in your organization',
               'Submission ' || $2 || ' has breached its SLA and requires attention.',
               'submission', $2, '/verify?id=' || $2, $3)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [admin.user_id, sub.id, `${idempotencyBase}_host_${admin.user_id}`],
    );
    if (rows.length > 0) sent++;
  }

  return sent;
}

/**
 * Tier 3: Reassign to the next available admin with capacity.
 */
async function reassignToNextAdmin(sub: BreachedSubmission): Promise<number> {
  const idempotencyBase = `escalation_t24_${sub.id}`;

  // Check if already reassigned at this tier
  const existing = await executeQuery<{ id: string }>(
    `SELECT id FROM notification_events
     WHERE idempotency_key = $1`,
    [`${idempotencyBase}_reassigned`],
  );
  if (existing.length > 0) return 0;

  // Find next available admin excluding current assignee
  const nextAdmin = await findNextAvailableAdmin(
    sub.jurisdiction_state,
    sub.jurisdiction_county,
    sub.assigned_to_user_id,
  );

  if (!nextAdmin) return 0;

  // Reassign the submission
  await executeQuery(
    `UPDATE submissions
     SET assigned_to_user_id = $1, updated_at = NOW()
     WHERE id = $2`,
    [nextAdmin.user_id, sub.id],
  );

  // Notify the new assignee
  await executeQuery(
    `INSERT INTO notification_events
       (recipient_user_id, event_type, title, body,
        resource_type, resource_id, action_url, idempotency_key)
     VALUES ($1, 'submission_assigned',
             'Submission reassigned to you (escalation)',
             'Submission ' || $2 || ' has been automatically reassigned to you due to SLA escalation.',
             'submission', $2, '/verify?id=' || $2, $3)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [nextAdmin.user_id, sub.id, `${idempotencyBase}_reassigned`],
  );

  return 1;
}

/**
 * Tier 4: Escalate to ORAN admin queue.
 */
async function escalateToOranAdmin(sub: BreachedSubmission): Promise<number> {
  const idempotencyBase = `escalation_t48_${sub.id}`;

  // Check if already escalated at this tier
  const existing = await executeQuery<{ id: string }>(
    `SELECT id FROM notification_events
     WHERE idempotency_key = $1`,
    [`${idempotencyBase}_escalated`],
  );
  if (existing.length > 0) return 0;

  // Find ORAN admins first — don't transition status if nobody can pick it up
  const oranAdmins = await findOranAdmins();
  if (oranAdmins.length === 0) return 0;

  // Capture from_status BEFORE updating (avoids race where subquery reads post-UPDATE value)
  const currentRows = await executeQuery<{ status: string }>(
    `SELECT status FROM submissions WHERE id = $1`,
    [sub.id],
  );
  const fromStatus = currentRows[0]?.status ?? 'needs_review';

  // Transition to escalated status if currently in a reviewable state
  await executeQuery(
    `UPDATE submissions
     SET status = 'escalated', updated_at = NOW()
     WHERE id = $1
       AND status IN ('needs_review', 'under_review', 'pending_second_approval')`,
    [sub.id],
  );

  // Record the transition with the correct from_status
  await executeQuery(
    `INSERT INTO submission_transitions
       (submission_id, from_status, to_status, actor_user_id, actor_role,
        reason, gates_checked, gates_passed, metadata)
     VALUES ($1, $2,
             'escalated', 'system', 'system',
             'Auto-escalated: SLA breached for over 48 hours',
             '[]', true, '{"escalation_tier": "t48"}')`,
    [sub.id, fromStatus],
  );

  // Notify ORAN admins
  let sent = 0;

  for (const admin of oranAdmins) {
    const rows = await executeQuery<{ id: string }>(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body,
          resource_type, resource_id, action_url, idempotency_key)
       VALUES ($1, 'submission_escalation_warning',
               'Critical: Submission escalated to ORAN admin',
               'Submission ' || $2 || ' has been breached for 48+ hours and requires immediate platform-level review.',
               'submission', $2, '/verify?id=' || $2, $3)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [admin.user_id, sub.id, `${idempotencyBase}_escalated_${admin.user_id}`],
    );
    if (rows.length > 0) sent++;
  }

  // Reassign to first ORAN admin with capacity
  if (oranAdmins.length > 0) {
    await executeQuery(
      `UPDATE submissions
       SET assigned_to_user_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [oranAdmins[0].user_id, sub.id],
    );
  }

  // Record the escalation marker
  await executeQuery(
    `INSERT INTO notification_events
       (recipient_user_id, event_type, title, body,
        resource_type, resource_id, idempotency_key)
     VALUES ($1, 'system_alert',
             'Escalation marker',
             'Submission ' || $2 || ' escalated to ORAN admin tier',
             'submission', $2, $3)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [sub.submitted_by_user_id, sub.id, `${idempotencyBase}_escalated`],
  );

  return sent > 0 ? 1 : 0;
}

// ============================================================
// ADMIN LOOKUP
// ============================================================

/**
 * Find the next available admin with capacity, excluding the current assignee.
 * Prefers admins matching the submission's jurisdiction.
 */
export async function findNextAvailableAdmin(
  state: string | null,
  county: string | null,
  excludeUserId: string | null,
): Promise<AdminCandidate | null> {
  const candidates = await executeQuery<AdminCandidate>(
    `SELECT arp.user_id, arp.pending_count, arp.max_pending
     FROM admin_review_profiles arp
     JOIN user_profiles up ON up.user_id = arp.user_id
     WHERE arp.is_active = true
       AND arp.is_accepting_new = true
       AND arp.pending_count < arp.max_pending
       AND ($1::text IS NULL OR arp.user_id != $1)
       AND up.role IN ('community_admin', 'oran_admin')
     ORDER BY
       CASE WHEN $2::text IS NOT NULL AND $3::text IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM unnest(arp.coverage_counties) c WHERE c = $2 || '_' || $3
                 ) THEN 0
            WHEN $2::text IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM unnest(arp.coverage_states) s WHERE s = $2
                 ) THEN 1
            ELSE 2
       END ASC,
       arp.pending_count ASC,
       COALESCE(arp.avg_review_hours, 999) ASC
     LIMIT 1`,
    [excludeUserId, state, county],
  );

  return candidates[0] ?? null;
}

/**
 * Find all active ORAN admins, ordered by capacity (most available first).
 */
export async function findOranAdmins(): Promise<AdminCandidate[]> {
  return executeQuery<AdminCandidate>(
    `SELECT arp.user_id, arp.pending_count, arp.max_pending
     FROM admin_review_profiles arp
     JOIN user_profiles up ON up.user_id = arp.user_id
     WHERE up.role = 'oran_admin'
       AND arp.is_active = true
     ORDER BY arp.pending_count ASC
     LIMIT 10`,
    [],
  );
}

// ============================================================
// DEFAULT NOTIFICATION PREFERENCES
// ============================================================

/**
 * Ensure default notification preferences are enabled for an admin user.
 * Creates `in_app = true` preference rows for critical admin event types.
 * Uses ON CONFLICT DO NOTHING — safe to call multiple times.
 * Batches all event types into a single INSERT for efficiency.
 */
export async function ensureDefaultNotificationPreferences(
  userId: string,
): Promise<number> {
  const events = DEFAULT_ADMIN_NOTIFICATION_EVENTS;
  // Build multi-row VALUES: ($1, $2, 'in_app', true), ($1, $3, 'in_app', true), ...
  const valuesClauses = events.map(
    (_, i) => `($1, $${i + 2}, 'in_app', true)`,
  );
  const rows = await executeQuery<{ id: string }>(
    `INSERT INTO notification_preferences (user_id, event_type, channel, enabled)
     VALUES ${valuesClauses.join(', ')}
     ON CONFLICT (user_id, event_type, channel) DO NOTHING
     RETURNING id`,
    [userId, ...events.map((e) => e as string)],
  );
  return rows.length;
}

/**
 * Provision default notification preferences for all existing admin users
 * who don't yet have preferences. Intended for one-time backfill.
 */
export async function backfillAdminNotificationPreferences(): Promise<number> {
  const admins = await executeQuery<{ user_id: string }>(
    `SELECT user_id FROM user_profiles
     WHERE role IN ('community_admin', 'oran_admin')`,
    [],
  );

  let totalCreated = 0;
  for (const admin of admins) {
    totalCreated += await ensureDefaultNotificationPreferences(admin.user_id);
  }
  return totalCreated;
}
