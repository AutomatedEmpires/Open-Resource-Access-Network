/**
 * GET /api/admin/agents/control-plane
 *
 * ORAN-admin control plane for enterprise agent/operator readiness.
 * Returns a live snapshot of operator posture, trust controls, integrations,
 * and recommended activation moves based on the running environment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { trackEvent } from '@/services/telemetry/appInsights';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { buildAgentControlPlaneSnapshot } from '@/services/agentic/controlPlane';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

export async function GET(_req: NextRequest) {
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const limited = checkRateLimit(`agent-control-plane:${authCtx.userId}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (limited.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  try {
    const snapshot = await buildAgentControlPlaneSnapshot();
    void trackEvent('agent_control_plane_viewed', {
      posture: snapshot.summary.posture,
      feature_flag_backend: snapshot.featureFlags.implementation,
    }, {
      readiness_score: snapshot.summary.readinessScore,
      active_operators: snapshot.summary.activeOperators,
      configured_integrations: snapshot.summary.configuredIntegrations,
    });

    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_agents_control_plane' });
    return NextResponse.json(
      { error: 'Failed to build agent control plane snapshot.' },
      { status: 500 },
    );
  }
}
