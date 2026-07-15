/**
 * DELETE /api/user/data-delete — durable account and personal-data erasure.
 *
 * The database first queues the request and revokes ORAN authorization. Clerk
 * deletion is then attempted synchronously, followed by at most one bounded
 * database page. A private worker advances the durable scrub without allowing
 * the identity to regain access.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthContext } from '@/services/auth/session';
import { isDatabaseConfigured } from '@/services/db/postgres';
import {
  processAccountErasure,
  queueAccountErasure,
} from '@/services/privacy/accountErasure';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { getIp } from '@/services/security/ip';
import { captureException } from '@/services/telemetry/sentry';

export async function DELETE(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`user:data-delete:${authCtx.userId}:${ip}`, {
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
      { error: 'Rate limit exceeded. Please wait before requesting again.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfterSeconds),
          'Cache-Control': 'private, no-store',
        },
      },
    );
  }

  let queued: Awaited<ReturnType<typeof queueAccountErasure>>;
  try {
    queued = await queueAccountErasure(authCtx.userId, authCtx.clerkUserId);
  } catch (error) {
    await captureException(error, { feature: 'account_erasure_queue' });
    return NextResponse.json({ error: 'Failed to queue account deletion.' }, { status: 500 });
  }

  if (queued.status === 'completed') {
    return NextResponse.json(
      {
        message: 'Your account and personal data have been deleted.',
        status: 'completed',
        accessRevoked: true,
        identityProviderDeleted: true,
        erasureStatus: 'completed',
        nextStep: null,
      },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  try {
    const result = await processAccountErasure(queued);
    if (result.completed) {
      return NextResponse.json(
        {
          message: 'Your account and personal data have been deleted.',
          status: 'completed',
          accessRevoked: true,
          identityProviderDeleted: true,
          erasureStatus: 'completed',
          nextStep: null,
        },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    return NextResponse.json(
      {
        message: 'Account access has been revoked. Secure deletion is in progress.',
        status: 'pending',
        accessRevoked: true,
        identityProviderDeleted: result.identityProviderDeleted,
        erasureStatus: result.status === 'blocked' ? 'operator_review' : 'in_progress',
        nextStep: result.nextStep,
      },
      { status: 202, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'account_erasure_processing' });
    return NextResponse.json(
      {
        message: 'Account access has been revoked. Secure deletion is queued.',
        status: 'pending',
        accessRevoked: true,
        identityProviderDeleted: null,
        erasureStatus: 'queued',
        nextStep: null,
      },
      { status: 202, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
