/**
 * POST /api/user/data-export — GDPR / records data export.
 *
 * Authenticated users can request an export of all their personal data.
 * Returns a JSON archive with: profile, seeker profile, submissions,
 * notifications, preferences, organization memberships, audit log entries,
 * chat sessions, saved services, and seeker feedback.
 *
 * Rate-limited (1 per 10 minutes) to prevent abuse.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured, executeQuery } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { getAuthContext } from '@/services/auth/session';
import { captureException } from '@/services/telemetry/sentry';
import { getIp } from '@/services/security/ip';
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const userId = authCtx.userId;
  const ip = getIp(req);
  const rl = await checkRateLimitShared(`user:data-export:${userId}:${ip}`, {
    windowMs: 600_000,
    maxRequests: 1,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Export rate limit exceeded. Please wait before requesting again.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfterSeconds),
          'Cache-Control': 'private, no-store',
        },
      },
    );
  }

  try {
    // 1. Submissions authored by this user
    const submissions = await executeQuery<Record<string, unknown>>(
      `SELECT id, submission_type, status, service_id, target_type, target_id,
              payload, priority, sla_deadline, sla_breached,
              created_at, updated_at
       FROM submissions
       WHERE submitted_by_user_id = $1
       ORDER BY created_at DESC
       LIMIT 1000`,
      [userId],
    );

    // 2. Organization memberships
    const memberships = await executeQuery<Record<string, unknown>>(
      `SELECT om.id, om.organization_id, o.name AS organization_name,
              om.role, om.status, om.created_at, om.updated_at
       FROM organization_members om
       LEFT JOIN organizations o ON o.id = om.organization_id
       WHERE om.user_id = $1
       ORDER BY om.created_at DESC`,
      [userId],
    );

    // 3. Notification events
    const notifications = await executeQuery<Record<string, unknown>>(
      `SELECT id, event_type, channel, title, body, resource_type, resource_id,
              action_url, status, created_at
       FROM notification_events
       WHERE recipient_user_id = $1
       ORDER BY created_at DESC
       LIMIT 5000`,
      [userId],
    );

    // 4. Notification preferences
    const preferences = await executeQuery<Record<string, unknown>>(
      `SELECT id, event_type, channel, enabled,
              created_at, updated_at
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId],
    );

    // 5. Audit log entries for this user's actions
    const auditEntries = await executeQuery<Record<string, unknown>>(
      `SELECT id, action, resource_type, resource_id,
              created_at
       FROM audit_logs
       WHERE actor_user_id = $1
       ORDER BY created_at DESC
       LIMIT 5000`,
      [userId],
    );

    // 6. Saved services
    const savedServices = await executeQuery<Record<string, unknown>>(
      `SELECT id, user_id, service_id, saved_at
       FROM saved_services
       WHERE user_id = $1
       ORDER BY saved_at DESC`,
      [userId],
    );

    // 7. User profile
    const profile = await executeQuery<Record<string, unknown>>(
      `SELECT user_id, display_name, email, phone, auth_provider,
              preferred_locale, approximate_city, created_at, updated_at
       FROM user_profiles
       WHERE user_id = $1`,
      [userId],
    );

    // 8. Seeker profile
    const seekerProfile = await executeQuery<Record<string, unknown>>(
      `SELECT user_id, service_interests, age_group, household_type, housing_situation,
              self_identifiers, current_services, accessibility_needs, pronouns,
              profile_headline, avatar_emoji, accent_theme,
              contact_phone, contact_email,
              additional_context, created_at, updated_at
         FROM seeker_profiles
        WHERE user_id = $1`,
      [userId],
    );

    // 9. Chat sessions
    const chatSessions = await executeQuery<Record<string, unknown>>(
      `SELECT id, started_at, ended_at, intent_summary, message_count, created_at
       FROM chat_sessions
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT 5000`,
      [userId],
    );

    // 10. Seeker feedback
    const feedback = await executeQuery<Record<string, unknown>>(
      `SELECT id, service_id, session_id, rating, comment, contact_success,
              created_at
       FROM seeker_feedback
       WHERE created_by_user_id = $1
       ORDER BY created_at DESC
       LIMIT 5000`,
      [userId],
    );

    const exportData = {
      exportedAt: new Date().toISOString(),
      userId,
      profile: profile[0] ?? null,
      seekerProfile: seekerProfile[0] ?? null,
      submissions,
      memberships,
      notifications,
      preferences,
      savedServices,
      auditEntries,
      chatSessions,
      feedback,
    };

    return NextResponse.json(exportData, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="oran-data-export-${Date.now()}.json"`,
      },
    });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Failed to generate data export' }, { status: 500 });
  }
}
