/**
 * Two-Person Approval Service
 *
 * Manages the two-person (four-eyes) approval workflow for scope grants
 * and high-risk submission approvals. Ensures that no single person can
 * unilaterally grant elevated permissions or approve critical submissions.
 *
 * Scope grant flow:
 *   1. Admin A calls requestGrant() → creates pending_scope_grants row
 *   2. Admin B (different person) calls approveGrant() → creates user_scope_grants row
 *   3. Or Admin B calls denyGrant() → marks grant denied
 *
 * Submission approval flow (handled by WorkflowEngine):
 *   1. Reviewer A moves submission to pending_second_approval
 *   2. Reviewer B (different person) calls advance() to approved
 *   3. WorkflowEngine's two-person gate enforces the separation
 */

import { executeQuery, withTransaction } from '@/services/db/postgres';
import { FEATURE_FLAGS } from '@/domain/constants';
import type { PendingGrantStatus } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

export interface GrantRequest {
  userId: string;
  scopeName: string;
  organizationId?: string | null;
  requestedByUserId: string;
  justification: string;
  expiresInHours?: number;
}

export interface GrantDecision {
  grantId: string;
  decidedByUserId: string;
  decision: 'approved' | 'denied';
  reason: string;
}

export interface PendingGrantRow {
  id: string;
  user_id: string;
  scope_id: string;
  scope_name: string;
  scope_description: string;
  organization_id: string | null;
  requested_by_user_id: string;
  requested_at: string;
  justification: string;
  status: string;
  expires_at: string;
}

export interface GrantResult {
  success: boolean;
  grantId: string;
  error?: string;
}

interface UserSecurityRow {
  user_id: string;
  account_status: 'active' | 'frozen' | null;
}

// ============================================================
// SCOPE GRANT REQUESTS
// ============================================================

/**
 * Request a scope grant for a user. Creates a pending approval
 * that must be approved by a different administrator.
 */
export async function requestGrant(req: GrantRequest): Promise<GrantResult> {
  return withTransaction(async (client) => {
    const userRows = await client.query<UserSecurityRow>(
      `SELECT user_id, account_status
       FROM user_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [req.userId],
    );

    if (userRows.rows.length === 0) {
      return { success: false, grantId: '', error: 'Target user not found' };
    }

    if ((userRows.rows[0]?.account_status ?? 'active') !== 'active') {
      return { success: false, grantId: '', error: 'Cannot grant scopes to a frozen account' };
    }

    // Resolve scope by name
    const scopeRows = await client.query<{ id: string; requires_approval: boolean }>(
      `SELECT id, requires_approval FROM platform_scopes WHERE name = $1 AND is_active = true`,
      [req.scopeName],
    );

    if (scopeRows.rows.length === 0) {
      return { success: false, grantId: '', error: `Scope '${req.scopeName}' not found or inactive` };
    }

    const scope = scopeRows.rows[0];

    // Check if user already has this scope
    const existingRows = await client.query<{ id: string }>(
      `SELECT id FROM user_scope_grants
       WHERE user_id = $1 AND scope_id = $2
         AND (organization_id = $3 OR ($3 IS NULL AND organization_id IS NULL))
         AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.userId, scope.id, req.organizationId ?? null],
    );

    if (existingRows.rows.length > 0) {
      return { success: false, grantId: '', error: 'User already has this scope grant' };
    }

    // Check if there's already a pending grant
    const pendingRows = await client.query<{ id: string }>(
      `SELECT id FROM pending_scope_grants
       WHERE user_id = $1 AND scope_id = $2
         AND (organization_id = $3 OR ($3 IS NULL AND organization_id IS NULL))
         AND status = 'pending'
         AND expires_at > NOW()`,
      [req.userId, scope.id, req.organizationId ?? null],
    );

    if (pendingRows.rows.length > 0) {
      return { success: false, grantId: pendingRows.rows[0].id, error: 'A pending grant request already exists' };
    }

    // Check if two-person approval is required
    const flagRows = await client.query<{ enabled: boolean }>(
      `SELECT enabled FROM feature_flags WHERE name = $1`,
      [FEATURE_FLAGS.TWO_PERSON_APPROVAL],
    );
    const twoPersonEnabled = flagRows.rows[0]?.enabled ?? false;

    const requiresApproval = scope.requires_approval && twoPersonEnabled;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (req.expiresInHours ?? 168)); // Default 7 days

    if (!requiresApproval) {
      // Direct grant — no second person needed
      const grantResult = await client.query<{ id: string }>(
        `INSERT INTO user_scope_grants
           (user_id, scope_id, organization_id, granted_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [req.userId, scope.id, req.organizationId ?? null, req.requestedByUserId, expiresAt.toISOString()],
      );

      // Audit log
      await client.query(
        `INSERT INTO scope_audit_log
           (actor_user_id, action, target_type, target_id, after_state, justification)
         VALUES ($1, 'scope_granted_to_user', 'user_grant', $2, $3, $4)`,
        [
          req.requestedByUserId,
          req.userId,
          JSON.stringify({ scope: req.scopeName, organization_id: req.organizationId }),
          req.justification,
        ],
      );

      return { success: true, grantId: grantResult.rows[0].id };
    }

    // Create pending grant for two-person approval
    const pendingResult = await client.query<{ id: string }>(
      `INSERT INTO pending_scope_grants
         (user_id, scope_id, organization_id, requested_by_user_id, justification, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [req.userId, scope.id, req.organizationId ?? null, req.requestedByUserId, req.justification, expiresAt.toISOString()],
    );

    const grantId = pendingResult.rows[0].id;

    // Audit log
    await client.query(
      `INSERT INTO scope_audit_log
         (actor_user_id, action, target_type, target_id, after_state, justification)
       VALUES ($1, 'grant_requested', 'pending_grant', $2, $3, $4)`,
      [
        req.requestedByUserId,
        grantId,
        JSON.stringify({ user: req.userId, scope: req.scopeName, organization_id: req.organizationId }),
        req.justification,
      ],
    );

    // Notify other admins that approval is needed
    await client.query(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
       SELECT up.user_id,
              'scope_grant_requested',
              'Scope grant approval needed',
              'A scope grant for "' || $2 || '" requires your approval',
              'pending_grant',
              $1,
              '/scopes',
              'grant_req_' || $1 || '_' || up.user_id
       FROM user_profiles up
       WHERE up.role IN ('oran_admin')
         AND up.user_id != $3
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [grantId, req.scopeName, req.requestedByUserId],
    );

    return { success: true, grantId };
  });
}

// ============================================================
// SCOPE GRANT DECISIONS
// ============================================================

/**
 * Approve or deny a pending scope grant.
 * The decider must be different from the requester (four-eyes principle).
 */
export async function decideGrant(decision: GrantDecision): Promise<GrantResult> {
  return withTransaction(async (client) => {
    // Lock the pending grant row
    const pendingRows = await client.query<{
      id: string;
      user_id: string;
      scope_id: string;
      organization_id: string | null;
      requested_by_user_id: string;
      status: string;
      expires_at: string;
    }>(
      `SELECT id, user_id, scope_id, organization_id, requested_by_user_id, status, expires_at
       FROM pending_scope_grants
       WHERE id = $1
       FOR UPDATE`,
      [decision.grantId],
    );

    if (pendingRows.rows.length === 0) {
      return { success: false, grantId: decision.grantId, error: 'Pending grant not found' };
    }

    const pending = pendingRows.rows[0];

    const userRows = await client.query<UserSecurityRow>(
      `SELECT user_id, account_status
       FROM user_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [pending.user_id],
    );

    if (userRows.rows.length === 0) {
      return { success: false, grantId: decision.grantId, error: 'Target user not found' };
    }

    if ((userRows.rows[0]?.account_status ?? 'active') !== 'active') {
      return { success: false, grantId: decision.grantId, error: 'Cannot approve a grant for a frozen account' };
    }

    if (pending.status !== 'pending') {
      return { success: false, grantId: decision.grantId, error: `Grant already ${pending.status}` };
    }

    // Check expiration
    if (new Date(pending.expires_at) < new Date()) {
      await client.query(
        `UPDATE pending_scope_grants SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [decision.grantId],
      );
      return { success: false, grantId: decision.grantId, error: 'Grant request has expired' };
    }

    // Enforce two-person rule: decider must be different from requester
    if (decision.decidedByUserId === pending.requested_by_user_id) {
      return {
        success: false,
        grantId: decision.grantId,
        error: 'Cannot approve your own grant request (two-person rule)',
      };
    }

    // Update pending grant
    const newStatus: PendingGrantStatus = decision.decision === 'approved' ? 'approved' : 'denied';
    await client.query(
      `UPDATE pending_scope_grants
       SET status = $1, decided_by_user_id = $2, decided_at = NOW(), decision_reason = $3, updated_at = NOW()
       WHERE id = $4`,
      [newStatus, decision.decidedByUserId, decision.reason, decision.grantId],
    );

    // If approved, create the actual grant
    if (decision.decision === 'approved') {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90); // 90-day default

      await client.query(
        `INSERT INTO user_scope_grants
           (user_id, scope_id, organization_id, granted_by_user_id, approval_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, scope_id, organization_id) DO UPDATE
           SET is_active = true, granted_by_user_id = $4, approval_id = $5,
               expires_at = $6, updated_at = NOW()`,
        [pending.user_id, pending.scope_id, pending.organization_id, decision.decidedByUserId, decision.grantId, expiresAt.toISOString()],
      );
    }

    // Audit log
    await client.query(
      `INSERT INTO scope_audit_log
         (actor_user_id, action, target_type, target_id, after_state, justification)
       VALUES ($1, $2, 'pending_grant', $3, $4, $5)`,
      [
        decision.decidedByUserId,
        decision.decision === 'approved' ? 'grant_approved' : 'grant_denied',
        decision.grantId,
        JSON.stringify({ user: pending.user_id, decision: decision.decision }),
        decision.reason,
      ],
    );

    // Notify the requester of the decision
    await client.query(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body, resource_type, resource_id, idempotency_key)
       VALUES ($1, 'scope_grant_decided', $2, $3, 'pending_grant', $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        pending.requested_by_user_id,
        `Scope grant ${decision.decision}`,
        `Your scope grant request has been ${decision.decision}: ${decision.reason}`,
        decision.grantId,
        `grant_decided_${decision.grantId}`,
      ],
    );

    return { success: true, grantId: decision.grantId };
  });
}

// ============================================================
// GRANT REVOCATION
// ============================================================

/**
 * Revoke an active scope grant.
 */
export async function revokeGrant(
  grantId: string,
  actorUserId: string,
  reason: string,
): Promise<boolean> {
  return withTransaction(async (client) => {
    const result = await client.query<{ id: string; user_id: string; scope_id: string }>(
      `UPDATE user_scope_grants
       SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND is_active = true
       RETURNING id, user_id, scope_id`,
      [grantId],
    );

    if (result.rows.length === 0) return false;

    const grant = result.rows[0];

    // Audit log
    await client.query(
      `INSERT INTO scope_audit_log
         (actor_user_id, action, target_type, target_id, before_state, justification)
       VALUES ($1, 'scope_revoked_from_user', 'user_grant', $2, $3, $4)`,
      [
        actorUserId,
        grantId,
        JSON.stringify({ user: grant.user_id, scope_id: grant.scope_id }),
        reason,
      ],
    );

    // Notify the user whose grant was revoked
    await client.query(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body, resource_type, resource_id, idempotency_key)
       VALUES ($1, 'scope_grant_revoked', 'Scope access revoked', $2, 'user_scope_grant', $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        grant.user_id,
        `Your access has been revoked: ${reason}`,
        grantId,
        `grant_revoked_${grantId}`,
      ],
    );

    return true;
  });
}

// ============================================================
// QUERIES
// ============================================================

/**
 * List pending scope grants awaiting approval.
 * Excludes grants requested by the current user (they can't approve their own).
 */
export async function listPendingGrants(
  excludeRequesterId?: string,
): Promise<PendingGrantRow[]> {
  const params: string[] = [];
  let whereExtra = '';

  if (excludeRequesterId) {
    whereExtra = ` AND pg.requested_by_user_id != $1`;
    params.push(excludeRequesterId);
  }

  return executeQuery<PendingGrantRow>(
    `SELECT pg.id, pg.user_id, pg.scope_id, ps.name AS scope_name,
            ps.description AS scope_description, pg.organization_id,
            pg.requested_by_user_id, pg.requested_at, pg.justification,
            pg.status, pg.expires_at
     FROM pending_scope_grants pg
     JOIN platform_scopes ps ON ps.id = pg.scope_id
     WHERE pg.status = 'pending'
       AND pg.expires_at > NOW()
       ${whereExtra}
     ORDER BY pg.requested_at ASC`,
    params,
  );
}

/**
 * Check if a user has an active scope (either via role assignment or direct grant).
 */
export async function userHasScope(
  userId: string,
  scopeName: string,
  organizationId?: string | null,
): Promise<boolean> {
  const rows = await executeQuery<{ has_scope: boolean }>(
    `SELECT EXISTS (
       -- Direct grant
       SELECT 1 FROM user_scope_grants usg
       JOIN platform_scopes ps ON ps.id = usg.scope_id
       WHERE usg.user_id = $1
         AND ps.name = $2
         AND usg.is_active = true
         AND (usg.expires_at IS NULL OR usg.expires_at > NOW())
         AND (usg.organization_id = $3 OR $3 IS NULL)

       UNION

       -- Role-based grant
       SELECT 1 FROM user_profiles up
       JOIN platform_roles pr ON pr.name = up.role AND pr.is_active = true
       JOIN role_scope_assignments rsa ON rsa.role_id = pr.id
       JOIN platform_scopes ps ON ps.id = rsa.scope_id AND ps.is_active = true
       WHERE up.user_id = $1
         AND ps.name = $2
     ) AS has_scope`,
    [userId, scopeName, organizationId ?? null],
  );

  return rows[0]?.has_scope ?? false;
}
