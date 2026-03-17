/**
 * Notification Service
 *
 * Manages in-app notification delivery, read tracking, and user preferences.
 * Email notifications are dispatched via Azure Communication Services when configured.
 *
 * This service is the single interface for all notification operations.
 */

import { executeQuery, withTransaction } from '@/services/db/postgres';
import { sendEmail, isEmailConfigured } from '@/services/email/azureEmail';
import { NOTIFICATION_RATE_LIMIT_PER_HOUR } from '@/domain/constants';
import type {
  NotificationChannel,
  NotificationEventType,
} from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

export interface SendNotificationRequest {
  recipientUserId: string;
  eventType: NotificationEventType;
  channel?: NotificationChannel;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  actionUrl?: string;
  idempotencyKey?: string;
  /** Email address for email channel. If not provided, email dispatch is skipped. */
  recipientEmail?: string;
}

export interface NotificationRow {
  id: string;
  recipient_user_id: string;
  event_type: string;
  channel: string;
  title: string;
  body: string;
  resource_type: string | null;
  resource_id: string | null;
  action_url: string | null;
  status: string;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPreferenceRow {
  id: string;
  user_id: string;
  event_type: string;
  channel: string;
  enabled: boolean;
}

// ============================================================
// SEND
// ============================================================

/**
 * Send a notification to a user. Respects user preferences:
 * if the user has disabled this event_type+channel combo, the
 * notification is silently dropped.
 */
export async function send(req: SendNotificationRequest): Promise<string | null> {
  const channel = req.channel ?? 'in_app';

  // Check user preference
  const prefRows = await executeQuery<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preferences
     WHERE user_id = $1 AND event_type = $2 AND channel = $3`,
    [req.recipientUserId, req.eventType, channel],
  );

  // If preference exists and is disabled, skip
  if (prefRows.length > 0 && !prefRows[0].enabled) {
    return null;
  }

  // LB7: Rate limit — prevent notification DDoS
  const recentCountRows = await executeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM notification_events
     WHERE recipient_user_id = $1 AND sent_at > NOW() - INTERVAL '1 hour'`,
    [req.recipientUserId],
  );
  const recentCount = parseInt(recentCountRows[0]?.count ?? '0', 10);
  if (recentCount >= NOTIFICATION_RATE_LIMIT_PER_HOUR) {
    return null;
  }

  const result = await executeQuery<{ id: string }>(
    `INSERT INTO notification_events
       (recipient_user_id, event_type, channel, title, body,
        resource_type, resource_id, action_url, status, sent_at, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sent', NOW(), $9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      req.recipientUserId,
      req.eventType,
      channel,
      req.title,
      req.body,
      req.resourceType ?? null,
      req.resourceId ?? null,
      req.actionUrl ?? null,
      req.idempotencyKey ?? null,
    ],
  );

  const notificationId = result[0]?.id ?? null;

  // Dispatch email via Azure Communication Services when channel is 'email'
  if (notificationId && channel === 'email' && req.recipientEmail && isEmailConfigured()) {
    const emailResult = await sendEmail({
      to: req.recipientEmail,
      subject: req.title,
      text: req.body,
    });

    // Update status based on email delivery result
    if (emailResult) {
      await executeQuery(
        `UPDATE notification_events SET status = 'delivered' WHERE id = $1`,
        [notificationId],
      );
    } else {
      await executeQuery(
        `UPDATE notification_events SET status = 'failed' WHERE id = $1`,
        [notificationId],
      );
    }
  }

  return notificationId;
}

/**
 * Send a notification to multiple recipients (broadcast).
 */
export async function broadcast(
  recipientUserIds: string[],
  eventType: NotificationEventType,
  title: string,
  body: string,
  opts?: {
    channel?: NotificationChannel;
    resourceType?: string;
    resourceId?: string;
    actionUrl?: string;
  },
): Promise<number> {
  let sent = 0;

  for (const userId of recipientUserIds) {
    const id = await send({
      recipientUserId: userId,
      eventType,
      channel: opts?.channel,
      title,
      body,
      resourceType: opts?.resourceType,
      resourceId: opts?.resourceId,
      actionUrl: opts?.actionUrl,
      idempotencyKey: `broadcast_${eventType}_${userId}_${opts?.resourceType ?? 'none'}_${opts?.resourceId ?? 'none'}`,
    });

    if (id) sent++;
  }

  return sent;
}

// ============================================================
// READ / LIST
// ============================================================

/**
 * Get unread notifications for a user.
 */
export async function getUnread(
  userId: string,
  limit = 50,
): Promise<NotificationRow[]> {
  return executeQuery<NotificationRow>(
    `SELECT id, recipient_user_id, event_type, channel, title, body,
            resource_type, resource_id, action_url, status, sent_at, read_at, created_at
     FROM notification_events
     WHERE recipient_user_id = $1
       AND read_at IS NULL
       AND status IN ('sent', 'pending')
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
}

/**
 * Get all notifications for a user (paginated).
 */
export async function listNotifications(
  userId: string,
  page = 1,
  pageSize = 20,
): Promise<{ notifications: NotificationRow[]; total: number }> {
  const offset = (page - 1) * pageSize;

  const [notifications, countResult] = await Promise.all([
    executeQuery<NotificationRow>(
      `SELECT id, recipient_user_id, event_type, channel, title, body,
              resource_type, resource_id, action_url, status, sent_at, read_at, created_at
       FROM notification_events
       WHERE recipient_user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    ),
    executeQuery<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notification_events WHERE recipient_user_id = $1`,
      [userId],
    ),
  ]);

  return {
    notifications,
    total: parseInt(countResult[0]?.count ?? '0', 10),
  };
}

/**
 * Get unread count for a user (for badge display).
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const result = await executeQuery<{ count: string }>(
    `SELECT COUNT(*) AS count FROM notification_events
     WHERE recipient_user_id = $1 AND read_at IS NULL AND status IN ('sent', 'pending')`,
    [userId],
  );
  return parseInt(result[0]?.count ?? '0', 10);
}

// ============================================================
// MARK READ
// ============================================================

/**
 * Mark a single notification as read.
 */
export async function markRead(
  notificationId: string,
  userId: string,
): Promise<boolean> {
  const result = await executeQuery<{ id: string }>(
    `UPDATE notification_events
     SET read_at = NOW(), status = 'read'
     WHERE id = $1 AND recipient_user_id = $2 AND read_at IS NULL
     RETURNING id`,
    [notificationId, userId],
  );
  return result.length > 0;
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllRead(userId: string): Promise<number> {
  const result = await executeQuery<{ id: string }>(
    `UPDATE notification_events
     SET read_at = NOW(), status = 'read'
     WHERE recipient_user_id = $1 AND read_at IS NULL
     RETURNING id`,
    [userId],
  );
  return result.length;
}

// ============================================================
// PREFERENCES
// ============================================================

/**
 * Get notification preferences for a user.
 */
export async function getPreferences(
  userId: string,
): Promise<NotificationPreferenceRow[]> {
  return executeQuery<NotificationPreferenceRow>(
    `SELECT id, user_id, event_type, channel, enabled
     FROM notification_preferences
     WHERE user_id = $1
     ORDER BY event_type, channel`,
    [userId],
  );
}

/**
 * Set a notification preference for a user.
 * Creates or updates the preference.
 */
export async function setPreference(
  userId: string,
  eventType: NotificationEventType,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<void> {
  await executeQuery(
    `INSERT INTO notification_preferences (user_id, event_type, channel, enabled)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, event_type, channel) DO UPDATE
       SET enabled = $4, updated_at = NOW()`,
    [userId, eventType, channel, enabled],
  );
}

/**
 * Bulk update notification preferences for a user.
 */
export async function setPreferences(
  userId: string,
  preferences: Array<{
    eventType: NotificationEventType;
    channel: NotificationChannel;
    enabled: boolean;
  }>,
): Promise<void> {
  await withTransaction(async (client) => {
    for (const pref of preferences) {
      await client.query(
        `INSERT INTO notification_preferences (user_id, event_type, channel, enabled)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, event_type, channel) DO UPDATE
           SET enabled = $4, updated_at = NOW()`,
        [userId, pref.eventType, pref.channel, pref.enabled],
      );
    }
  });
}
