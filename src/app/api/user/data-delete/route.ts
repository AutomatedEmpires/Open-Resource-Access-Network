/**
 * DELETE /api/user/data-delete — Full server-side user data deletion (GDPR).
 *
 * Removes all personal data for the authenticated user:
 * - user_profiles
 * - saved_services
 * - notification_events
 * - notification_preferences
 * - organization_members (status → deactivated)
 * - Nullifies user references in submissions, audit_log, etc.
 *
 * Irreversible. The user should be encouraged to export their data first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { getAuthContext } from '@/services/auth/session';
import { captureException } from '@/services/telemetry/sentry';

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function DELETE(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`user:data-delete:${ip}`, {
    windowMs: 600_000,
    maxRequests: 1,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before requesting again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const userId = authCtx.userId;

  try {
    await withTransaction(async (client) => {
      // 1. Delete saved services
      await client.query('DELETE FROM saved_services WHERE user_id = $1', [userId]);

      // 2. Delete notification preferences
      await client.query('DELETE FROM notification_preferences WHERE user_id = $1', [userId]);

      // 3. Delete notification events
      await client.query('DELETE FROM notification_events WHERE recipient_user_id = $1', [userId]);

      // 4. Deactivate organization memberships (preserve org integrity)
      await client.query(
        `UPDATE organization_members SET status = 'deactivated', updated_at = NOW()
         WHERE user_id = $1 AND (status IS NULL OR status != 'deactivated')`,
        [userId],
      );

      // 5. Nullify user references in submissions (keep submission for records)
      await client.query(
        'UPDATE submissions SET submitted_by_user_id = NULL WHERE submitted_by_user_id = $1',
        [userId],
      );
      await client.query(
        'UPDATE submissions SET assigned_to_user_id = NULL WHERE assigned_to_user_id = $1',
        [userId],
      );
      await client.query(
        'UPDATE submissions SET locked_by_user_id = NULL WHERE locked_by_user_id = $1',
        [userId],
      );

      // 6. Nullify user references in submission_transitions
      await client.query(
        'UPDATE submission_transitions SET actor_user_id = NULL WHERE actor_user_id = $1',
        [userId],
      );

      // 7. Nullify user references in audit_log
      await client.query(
        'UPDATE audit_log SET performed_by = NULL WHERE performed_by = $1',
        [userId],
      );

      // 8. Delete user profile
      await client.query('DELETE FROM user_profiles WHERE user_id = $1', [userId]);

      // 9. Record the deletion in audit_log (for compliance tracking)
      await client.query(
        `INSERT INTO audit_log (action, entity_type, entity_id, details, performed_by)
         VALUES ('user_data_deleted', 'user', $1, '{"gdpr": true}', NULL)`,
        [userId],
      );
    });

    return NextResponse.json(
      { message: 'All personal data has been deleted.' },
      { status: 200 },
    );
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Failed to delete user data.' }, { status: 500 });
  }
}
