/**
 * POST /api/user/data-export — GDPR / records data export.
 *
 * Authenticated users can request a bounded export of their personal data.
 * Returns a privacy-filtered JSON archive with: profile, seeker profile, submissions,
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

function boundedRows<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  return {
    rows: rows.slice(0, limit),
    truncated: rows.length > limit,
  };
}

function boundedMetadata(returned: number, limit: number, truncated: boolean) {
  return { limit, returned, hasMore: truncated, truncated };
}

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
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
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
    // 1. Subject-owned submissions and bounded governance records. The
    // database helper strips third-party identities, reviewer internals, raw
    // source assertions, and storage paths before the archive reaches Node.
    const governanceRows = await executeQuery<{ archive: Record<string, unknown> }>(
      `SELECT oran_internal.export_user_governance_data($1::text) AS archive`,
      [userId],
    );
    const governanceArchive = governanceRows[0]?.archive ?? {};
    const submissions = Array.isArray(governanceArchive.subjectSubmissions)
      ? governanceArchive.subjectSubmissions
      : [];
    const governance = { ...governanceArchive };
    delete governance.subjectSubmissions;

    // 2. Organization memberships
    const membershipPage = boundedRows(await executeQuery<Record<string, unknown>>(
      `SELECT om.id, om.organization_id, o.name AS organization_name,
              om.role, om.status, om.created_at, om.updated_at
       FROM organization_members om
       LEFT JOIN organizations o ON o.id = om.organization_id
       WHERE om.user_id = $1
       ORDER BY om.created_at DESC, om.id
       LIMIT 1001`,
      [userId],
    ), 1000);

    // 3. Notification events
    const notificationPage = boundedRows(await executeQuery<Record<string, unknown>>(
      `SELECT id, event_type, channel, title, body, resource_type, resource_id,
              action_url, status, created_at
       FROM notification_events
       WHERE recipient_user_id = $1
       ORDER BY created_at DESC, id
       LIMIT 5001`,
      [userId],
    ), 5000);

    // 4. Notification preferences
    const preferencePage = boundedRows(await executeQuery<Record<string, unknown>>(
      `SELECT id, event_type, channel, enabled,
              created_at, updated_at
       FROM notification_preferences
       WHERE user_id = $1
       ORDER BY created_at DESC, id
       LIMIT 1001`,
      [userId],
    ), 1000);

    // 5. Audit log entries for this user's actions
    const auditPage = boundedRows(await executeQuery<Record<string, unknown>>(
      `SELECT id, action, resource_type, resource_id,
              created_at
       FROM audit_logs
       WHERE actor_user_id = $1
       ORDER BY created_at DESC, id
       LIMIT 5001`,
      [userId],
    ), 5000);

    // 6. Saved services
    const savedServicePage = boundedRows(await executeQuery<Record<string, unknown>>(
      `SELECT id, user_id, service_id, saved_at
       FROM saved_services
       WHERE user_id = $1
       ORDER BY saved_at DESC, id
       LIMIT 5001`,
      [userId],
    ), 5000);

    // 6.5. Collections and nested membership have independent global budgets.
    // A per-collection LIMIT can still multiply into millions of JSON objects.
    const savedCollectionPage = boundedRows(await executeQuery<Record<string, unknown>>(
      `SELECT id, name, created_at, updated_at
       FROM saved_collections
       WHERE user_id = $1
       ORDER BY created_at DESC, id
       LIMIT 201`,
      [userId],
    ), 200);
    const collectionIds = savedCollectionPage.rows
      .map((collection) => collection.id)
      .filter((id): id is string => typeof id === 'string');
    const savedMembershipPage = boundedRows(collectionIds.length > 0
      ? await executeQuery<Record<string, unknown>>(
        `SELECT id, collection_id, service_id, saved_at
         FROM saved_collection_services
         WHERE collection_id = ANY($1::uuid[])
         ORDER BY array_position($1::uuid[], collection_id), saved_at DESC, id
         LIMIT 1001`,
        [collectionIds],
      )
      : [], 1000);
    const membersByCollection = new Map<string, Record<string, unknown>[]>();
    for (const member of savedMembershipPage.rows) {
      if (typeof member.collection_id !== 'string') continue;
      const bucket = membersByCollection.get(member.collection_id) ?? [];
      bucket.push({ serviceId: member.service_id, savedAt: member.saved_at });
      membersByCollection.set(member.collection_id, bucket);
    }
    const savedCollections = savedCollectionPage.rows.map((collection) => ({
      ...collection,
      services: typeof collection.id === 'string'
        ? membersByCollection.get(collection.id) ?? []
        : [],
    }));

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
    const chatPage = boundedRows(await executeQuery<Record<string, unknown>>(
      `SELECT id, started_at, ended_at, intent_summary, message_count, created_at
       FROM chat_sessions
       WHERE user_id = $1
       ORDER BY started_at DESC, id
       LIMIT 5001`,
      [userId],
    ), 5000);

    // 10. Seeker feedback
    const feedbackPage = boundedRows(await executeQuery<Record<string, unknown>>(
      `SELECT id, service_id, session_id, rating, comment, contact_success,
              created_at
       FROM seeker_feedback
       WHERE created_by_user_id = $1
       ORDER BY created_at DESC, id
       LIMIT 5001`,
      [userId],
    ), 5000);

    const exportData = {
      exportedAt: new Date().toISOString(),
      userId,
      profile: profile[0] ?? null,
      seekerProfile: seekerProfile[0] ?? null,
      submissions,
      memberships: membershipPage.rows,
      notifications: notificationPage.rows,
      preferences: preferencePage.rows,
      savedServices: savedServicePage.rows,
      savedCollections,
      auditEntries: auditPage.rows,
      chatSessions: chatPage.rows,
      feedback: feedbackPage.rows,
      governance,
      exportMetadata: {
        bounded: true,
        sections: {
          memberships: boundedMetadata(membershipPage.rows.length, 1000, membershipPage.truncated),
          notifications: boundedMetadata(
            notificationPage.rows.length, 5000, notificationPage.truncated,
          ),
          preferences: boundedMetadata(preferencePage.rows.length, 1000, preferencePage.truncated),
          savedServices: boundedMetadata(
            savedServicePage.rows.length, 5000, savedServicePage.truncated,
          ),
          savedCollections: {
            collections: boundedMetadata(
              savedCollectionPage.rows.length, 200, savedCollectionPage.truncated,
            ),
            memberships: boundedMetadata(
              savedMembershipPage.rows.length, 1000, savedMembershipPage.truncated,
            ),
          },
          auditEntries: boundedMetadata(auditPage.rows.length, 5000, auditPage.truncated),
          chatSessions: boundedMetadata(chatPage.rows.length, 5000, chatPage.truncated),
          feedback: boundedMetadata(feedbackPage.rows.length, 5000, feedbackPage.truncated),
        },
        governance: governance.exportMetadata ?? null,
      },
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
