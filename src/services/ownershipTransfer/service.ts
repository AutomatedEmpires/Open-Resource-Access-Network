/**
 * Ownership Transfer Service
 *
 * Handles the workflow when an organization signs up on ORAN and claims
 * services that were previously crawled and managed by community admins.
 *
 * Flow:
 *  1. Org signs up and detects existing services matching their identity
 *  2. Org initiates an ownership transfer claim
 *  3. Verification (domain, email, or admin review)
 *  4. Current managing admin is notified
 *  5. On approval: service ownership transfers, admin quota freed
 *  6. Audit trail recorded via submission + ownership_transfers table
 */

import crypto from 'node:crypto';

import { executeQuery, withTransaction } from '@/services/db/postgres';
import { send as sendNotification } from '@/services/notifications/service';
import { advance } from '@/services/workflow/engine';
import type {
  OwnershipVerificationMethod,
  SubmissionStatus,
} from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

export interface InitiateTransferInput {
  serviceId: string;
  organizationId: string;
  requestedByUserId: string;
  verificationMethod?: OwnershipVerificationMethod;
  transferNotes?: string;
}

export interface TransferRow {
  id: string;
  service_id: string;
  organization_id: string;
  requested_by_user_id: string;
  current_admin_user_id: string | null;
  submission_id: string | null;
  verification_method: string;
  verification_token: string | null;
  verification_expires_at: string | null;
  verified_at: string | null;
  status: string;
  transfer_notes: string | null;
  admin_notes: string | null;
  rejection_reason: string | null;
  service_snapshot: Record<string, unknown>;
  approved_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ServiceSnapshot {
  id: string;
  name: string | null;
  organization_id: string | null;
  url: string | null;
  status: string;
  confidence_overall: number | null;
}

// ============================================================
// DETECT MATCHING SERVICES
// ============================================================

/**
 * Find services that likely belong to an organization based on
 * name, URL, or email matching against the live services table.
 */
export async function detectExistingServices(
  orgName: string,
  orgUrl: string | null,
  orgEmail: string | null,
): Promise<Array<{ id: string; name: string; url: string | null; matchType: string }>> {
  const conditions: string[] = [];
  const params: (string | null)[] = [];
  let idx = 1;

  // Fuzzy name match (case-insensitive LIKE)
  if (orgName) {
    conditions.push(`LOWER(s.name) = LOWER($${idx})`);
    params.push(orgName);
    idx++;
  }

  // URL domain match
  if (orgUrl) {
    conditions.push(`s.url IS NOT NULL AND LOWER(s.url) LIKE $${idx}`);
    // Extract domain from URL for matching
    try {
      const domain = new URL(orgUrl).hostname.replace(/^www\./, '');
      params.push(`%${domain}%`);
    } catch {
      params.push(`%${orgUrl}%`);
    }
    idx++;
  }

  // Email domain match
  if (orgEmail) {
    const emailDomain = orgEmail.split('@')[1];
    if (emailDomain) {
      conditions.push(`s.url IS NOT NULL AND LOWER(s.url) LIKE $${idx}`);
      params.push(`%${emailDomain}%`);
      idx++;
    }
  }

  if (conditions.length === 0) return [];

  const query = `
    SELECT s.id, s.name, s.url,
      CASE
        WHEN LOWER(s.name) = LOWER($1) THEN 'name'
        ELSE 'url_domain'
      END AS match_type
    FROM services s
    WHERE (${conditions.join(' OR ')})
      AND s.status != 'removed'
    ORDER BY s.name
    LIMIT 50
  `;

  const rows = await executeQuery<{
    id: string;
    name: string;
    url: string | null;
    match_type: string;
  }>(query, params);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    matchType: r.match_type,
  }));
}

// ============================================================
// INITIATE TRANSFER
// ============================================================

/**
 * Create an ownership transfer request. Creates:
 *  - A submission (submission_type='ownership_transfer')
 *  - An ownership_transfers row linking the claim
 *  - Notifies the current managing admin (if any)
 */
export async function initiateTransfer(
  input: InitiateTransferInput,
): Promise<TransferRow> {
  return withTransaction(async (client) => {
    // 1. Check for active transfer on this service
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM ownership_transfers
       WHERE service_id = $1 AND status IN ('pending', 'verified', 'approved')`,
      [input.serviceId],
    );
    if (existing.rows.length > 0) {
      throw new Error('An active transfer already exists for this service');
    }

    // 2. Get service snapshot + current admin
    const serviceRows = await client.query<ServiceSnapshot>(
      `SELECT s.id, s.name, s.organization_id, s.url, s.status,
              cs.overall_confidence AS confidence_overall
       FROM services s
       LEFT JOIN confidence_scores cs ON cs.service_id = s.id
       WHERE s.id = $1`,
      [input.serviceId],
    );
    if (serviceRows.rows.length === 0) {
      throw new Error('Service not found');
    }
    const svc = serviceRows.rows[0];

    // Find the admin who currently manages this service
    const adminRows = await client.query<{ assigned_to_user_id: string }>(
      `SELECT assigned_to_user_id FROM submissions
       WHERE service_id = $1
         AND submission_type IN ('service_verification', 'ingestion_control_change')
         AND status = 'approved'
         AND assigned_to_user_id IS NOT NULL
       ORDER BY resolved_at DESC NULLS LAST
       LIMIT 1`,
      [input.serviceId],
    );
    const currentAdminUserId = adminRows.rows[0]?.assigned_to_user_id ?? null;

    // 3. Create submission
    const submissionRows = await client.query<{ id: string }>(
      `INSERT INTO submissions
         (submission_type, status, target_type, target_id, service_id,
          submitted_by_user_id, title, notes, payload, evidence, priority)
       VALUES
         ('ownership_transfer', 'submitted', 'service', $1, $1,
          $2, $3, $4, $5::jsonb, '[]'::jsonb, 1)
       RETURNING id`,
      [
        input.serviceId,
        input.requestedByUserId,
        `Ownership transfer: ${svc.name ?? 'Untitled service'}`,
        input.transferNotes ?? 'Ownership transfer requested by organization.',
        JSON.stringify({
          organizationId: input.organizationId,
          verificationMethod: input.verificationMethod ?? 'admin_review',
        }),
      ],
    );
    const submissionId = submissionRows.rows[0].id;

    // 4. Record initial transition
    await client.query(
      `INSERT INTO submission_transitions
         (submission_id, from_status, to_status, actor_user_id, actor_role, reason, gates_checked, gates_passed, metadata)
       VALUES ($1, 'draft', 'submitted', $2, 'host_admin', 'Ownership transfer initiated', '[]'::jsonb, true, '{}'::jsonb)`,
      [submissionId, input.requestedByUserId],
    );

    // 5. Generate verification token (for domain/email verification)
    const method = input.verificationMethod ?? 'admin_review';
    let verificationToken: string | null = null;
    let verificationExpiresAt: Date | null = null;

    if (method === 'domain_match' || method === 'email_match') {
      verificationToken = crypto.randomBytes(32).toString('hex');
      verificationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    }

    // 6. Create ownership_transfers row
    const transferRows = await client.query<TransferRow>(
      `INSERT INTO ownership_transfers
         (service_id, organization_id, requested_by_user_id, current_admin_user_id,
          submission_id, verification_method, verification_token, verification_expires_at,
          status, transfer_notes, service_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10::jsonb)
       RETURNING *`,
      [
        input.serviceId,
        input.organizationId,
        input.requestedByUserId,
        currentAdminUserId,
        submissionId,
        method,
        verificationToken,
        verificationExpiresAt?.toISOString() ?? null,
        input.transferNotes ?? null,
        JSON.stringify(svc),
      ],
    );
    const transfer = transferRows.rows[0];

    // 7. Notify current admin (if known)
    if (currentAdminUserId) {
      await sendNotification({
        recipientUserId: currentAdminUserId,
        eventType: 'ownership_transfer_requested',
        title: 'Ownership Transfer Requested',
        body: `An organization has requested ownership of a service you manage: ${svc.name ?? 'Untitled'}. Review the transfer request.`,
        resourceType: 'ownership_transfer',
        resourceId: transfer.id,
        actionUrl: `/admin/transfers/${transfer.id}`,
        idempotencyKey: `transfer_requested:${transfer.id}`,
      });
    }

    return transfer;
  });
}

// ============================================================
// VERIFY OWNERSHIP
// ============================================================

/**
 * Verify ownership via a time-limited token (for domain/email methods).
 */
export async function verifyOwnership(
  transferId: string,
  token: string,
): Promise<{ success: boolean; error?: string }> {
  const rows = await executeQuery<TransferRow>(
    `SELECT * FROM ownership_transfers WHERE id = $1`,
    [transferId],
  );

  if (rows.length === 0) {
    return { success: false, error: 'Transfer not found' };
  }

  const transfer = rows[0];

  if (transfer.status !== 'pending') {
    return { success: false, error: 'Transfer is not in pending status' };
  }

  if (transfer.verification_method === 'admin_review') {
    return { success: false, error: 'This transfer requires admin review, not token verification' };
  }

  if (!transfer.verification_token) {
    return { success: false, error: 'No verification token set' };
  }

  // Constant-time comparison to prevent timing attacks
  const tokenBuffer = Buffer.from(token);
  const storedBuffer = Buffer.from(transfer.verification_token);
  if (tokenBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(tokenBuffer, storedBuffer)) {
    return { success: false, error: 'Invalid verification token' };
  }

  // Check expiry
  if (transfer.verification_expires_at && new Date(transfer.verification_expires_at) < new Date()) {
    return { success: false, error: 'Verification token has expired' };
  }

  await executeQuery(
    `UPDATE ownership_transfers
     SET status = 'verified', verified_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [transferId],
  );

  return { success: true };
}

// ============================================================
// APPROVE TRANSFER
// ============================================================

/**
 * Admin approves a transfer. Routes approval through the workflow engine
 * to enforce all gates (transition validity, two-person approval, locks).
 */
export async function approveTransfer(
  transferId: string,
  adminUserId: string,
  adminNotes?: string,
): Promise<{ success: boolean; error?: string }> {
  // 1. Validate transfer state
  const rows = await executeQuery<TransferRow>(
    `SELECT * FROM ownership_transfers WHERE id = $1`,
    [transferId],
  );
  if (rows.length === 0) {
    return { success: false, error: 'Transfer not found' };
  }

  const transfer = rows[0];
  const validFromStatuses = ['pending', 'verified'];
  if (!validFromStatuses.includes(transfer.status)) {
    return { success: false, error: `Cannot approve transfer in '${transfer.status}' status` };
  }

  // 2. Route submission through workflow engine (enforces gates)
  if (transfer.submission_id) {
    // Get current submission status to determine the path
    const subRows = await executeQuery<{ status: string }>(
      `SELECT status FROM submissions WHERE id = $1`,
      [transfer.submission_id],
    );
    const currentStatus = (subRows[0]?.status ?? 'submitted') as SubmissionStatus;

    // Navigate through valid transitions to reach 'approved'.
    // The workflow engine enforces transition validity and two-person gate.
    const stepsToApproved = getPathToApproved(currentStatus);

    for (const step of stepsToApproved) {
      // Intermediate routing steps skip gates; only the final 'approved'
      // step goes through full gate checks (including two-person).
      const isIntermediateStep = step !== 'approved';
      const result = await advance({
        submissionId: transfer.submission_id,
        toStatus: step,
        actorUserId: adminUserId,
        actorRole: 'community_admin',
        reason: isIntermediateStep
          ? 'Ownership transfer routing'
          : 'Ownership transfer approved',
        skipGates: isIntermediateStep
          ? { twoPersonApproval: true, lockCheck: true }
          : undefined,
      });

      if (!result.success) {
        return { success: false, error: result.error ?? 'Workflow gate check failed' };
      }
    }
  }

  // 3. Update ownership_transfers record
  await executeQuery(
    `UPDATE ownership_transfers
     SET status = 'approved', admin_notes = $2, approved_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'verified')`,
    [transferId, adminNotes ?? null],
  );

  // 4. Notify the requesting user
  await sendNotification({
    recipientUserId: transfer.requested_by_user_id,
    eventType: 'ownership_transfer_approved',
    title: 'Ownership Transfer Approved',
    body: 'Your ownership transfer request has been approved. The service will be transferred to your organization.',
    resourceType: 'ownership_transfer',
    resourceId: transfer.id,
    actionUrl: `/host/services`,
    idempotencyKey: `transfer_approved:${transfer.id}`,
  });

  return { success: true };
}

/**
 * Compute the sequence of valid transitions from a given status to 'approved'.
 */
function getPathToApproved(from: SubmissionStatus): SubmissionStatus[] {
  switch (from) {
    case 'submitted':
      return ['needs_review', 'under_review', 'approved'];
    case 'needs_review':
      return ['under_review', 'approved'];
    case 'under_review':
      return ['approved'];
    case 'pending_second_approval':
      return ['approved'];
    case 'escalated':
      return ['approved'];
    case 'auto_checking':
      return ['approved'];
    default:
      return ['approved']; // will fail transition validity if truly invalid
  }
}

// ============================================================
// EXECUTE TRANSFER (complete the ownership handoff)
// ============================================================

/**
 * Execute the actual ownership transfer:
 *  - Update service.organization_id to the new org
 *  - Decrement current admin's pending count
 *  - Increment transferred_out_count
 *  - Record completion
 *  - Notify both parties
 */
export async function executeTransfer(
  transferId: string,
): Promise<{ success: boolean; error?: string }> {
  return withTransaction(async (client) => {
    const rows = await client.query<TransferRow>(
      `SELECT * FROM ownership_transfers WHERE id = $1 FOR UPDATE`,
      [transferId],
    );
    if (rows.rows.length === 0) {
      return { success: false, error: 'Transfer not found' };
    }

    const transfer = rows.rows[0];
    if (transfer.status !== 'approved') {
      return { success: false, error: `Cannot execute transfer in '${transfer.status}' status` };
    }

    // 1. Update service ownership
    await client.query(
      `UPDATE services
       SET organization_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [transfer.organization_id, transfer.service_id],
    );

    // 2. Free admin quota
    if (transfer.current_admin_user_id) {
      await client.query(
        `UPDATE admin_review_profiles
         SET pending_count = GREATEST(0, pending_count - 1),
             transferred_out_count = transferred_out_count + 1,
             updated_at = NOW()
         WHERE user_id = $1`,
        [transfer.current_admin_user_id],
      );

      // Notify the admin their slot has been freed
      await sendNotification({
        recipientUserId: transfer.current_admin_user_id,
        eventType: 'admin_quota_freed',
        title: 'Service Transferred — Quota Freed',
        body: 'A service you managed has been transferred to its organization owner. Your review slot has been freed.',
        resourceType: 'ownership_transfer',
        resourceId: transfer.id,
        actionUrl: `/admin/queue`,
        idempotencyKey: `quota_freed:${transfer.id}`,
      });
    }

    // 3. Complete the transfer
    await client.query(
      `UPDATE ownership_transfers
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [transferId],
    );

    // 4. Notify the org
    await sendNotification({
      recipientUserId: transfer.requested_by_user_id,
      eventType: 'ownership_transfer_completed',
      title: 'Service Ownership Transferred',
      body: 'The service has been transferred to your organization. You now have full edit and management rights.',
      resourceType: 'ownership_transfer',
      resourceId: transfer.id,
      actionUrl: `/host/services/${transfer.service_id}`,
      idempotencyKey: `transfer_completed:${transfer.id}`,
    });

    return { success: true };
  });
}

// ============================================================
// REJECT TRANSFER
// ============================================================

/**
 * Reject a transfer with a reason. Routes through the workflow engine.
 */
export async function rejectTransfer(
  transferId: string,
  adminUserId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  // 1. Validate transfer state
  const rows = await executeQuery<TransferRow>(
    `SELECT * FROM ownership_transfers WHERE id = $1`,
    [transferId],
  );
  if (rows.length === 0) {
    return { success: false, error: 'Transfer not found' };
  }

  const transfer = rows[0];
  const validFromStatuses = ['pending', 'verified', 'approved'];
  if (!validFromStatuses.includes(transfer.status)) {
    return { success: false, error: `Cannot reject transfer in '${transfer.status}' status` };
  }

  // 2. Route submission through workflow engine
  if (transfer.submission_id) {
    const subRows = await executeQuery<{ status: string }>(
      `SELECT status FROM submissions WHERE id = $1`,
      [transfer.submission_id],
    );
    const currentStatus = (subRows[0]?.status ?? 'submitted') as SubmissionStatus;

    // Navigate to 'denied' via valid transitions
    const stepsToDenied = getPathToDenied(currentStatus);

    for (const step of stepsToDenied) {
      const isIntermediateStep = step !== 'denied';
      const result = await advance({
        submissionId: transfer.submission_id,
        toStatus: step,
        actorUserId: adminUserId,
        actorRole: 'community_admin',
        reason: isIntermediateStep ? 'Ownership transfer routing' : reason,
        skipGates: isIntermediateStep
          ? { twoPersonApproval: true, lockCheck: true }
          : { lockCheck: true },
      });

      if (!result.success) {
        return { success: false, error: result.error ?? 'Workflow transition failed' };
      }
    }
  }

  // 3. Update ownership_transfers record
  await executeQuery(
    `UPDATE ownership_transfers
     SET status = 'rejected', rejection_reason = $2, rejected_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [transferId, reason],
  );

  // 4. Notify the requesting user
  await sendNotification({
    recipientUserId: transfer.requested_by_user_id,
    eventType: 'ownership_transfer_rejected',
    title: 'Ownership Transfer Rejected',
    body: `Your ownership transfer request was rejected. Reason: ${reason}`,
    resourceType: 'ownership_transfer',
    resourceId: transfer.id,
    actionUrl: `/host/services`,
    idempotencyKey: `transfer_rejected:${transfer.id}`,
  });

  return { success: true };
}

/**
 * Compute the sequence of valid transitions from a given status to 'denied'.
 */
function getPathToDenied(from: SubmissionStatus): SubmissionStatus[] {
  switch (from) {
    case 'submitted':
      return ['needs_review', 'under_review', 'denied'];
    case 'needs_review':
      return ['under_review', 'denied'];
    case 'under_review':
      return ['denied'];
    case 'pending_second_approval':
      return ['denied'];
    case 'escalated':
      return ['denied'];
    case 'auto_checking':
      return ['denied'];
    default:
      return ['denied'];
  }
}

// ============================================================
// CANCEL TRANSFER
// ============================================================

/**
 * Cancel a transfer (by the requesting org user).
 */
export async function cancelTransfer(
  transferId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await executeQuery<{ id: string }>(
    `UPDATE ownership_transfers
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1
       AND requested_by_user_id = $2
       AND status IN ('pending', 'verified')
     RETURNING id`,
    [transferId, userId],
  );

  if (result.length === 0) {
    return { success: false, error: 'Transfer not found or cannot be cancelled' };
  }

  return { success: true };
}

// ============================================================
// QUERY
// ============================================================

/**
 * Get a single transfer by ID.
 */
export async function getTransferById(
  transferId: string,
): Promise<TransferRow | null> {
  const rows = await executeQuery<TransferRow>(
    `SELECT * FROM ownership_transfers WHERE id = $1`,
    [transferId],
  );
  return rows[0] ?? null;
}

/**
 * List transfers for an organization.
 */
export async function listTransfersForOrganization(
  organizationId: string,
): Promise<TransferRow[]> {
  return executeQuery<TransferRow>(
    `SELECT * FROM ownership_transfers
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId],
  );
}

/**
 * List pending transfers for an admin user (transfers they need to review).
 */
export async function listPendingTransfersForAdmin(
  adminUserId: string,
): Promise<TransferRow[]> {
  return executeQuery<TransferRow>(
    `SELECT * FROM ownership_transfers
     WHERE current_admin_user_id = $1
       AND status IN ('pending', 'verified')
     ORDER BY created_at ASC`,
    [adminUserId],
  );
}
