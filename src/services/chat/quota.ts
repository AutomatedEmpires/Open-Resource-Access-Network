/**
 * Chat usage controls.
 *
 * Session counters remain for orchestrator compatibility. Production daily
 * quota, distributed rate limiting, and in-flight exclusion use the atomic
 * `oran_internal` database functions created by migration 0062. A bounded,
 * process-local implementation is used only when Postgres is intentionally
 * not configured. Configured database failures fail closed so horizontally
 * scaled deployments cannot bypass limits through per-instance memory.
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  ANONYMOUS_CHAT_QUOTA,
  AUTHENTICATED_CHAT_QUOTA,
  CHAT_INFLIGHT_LEASE_MS,
  CHAT_QUOTA_WINDOW_MS,
  CHAT_USAGE_UNAVAILABLE_RETRY_SECONDS,
  MAX_CHAT_QUOTA,
  MAX_SESSION_QUOTA_ENTRIES,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  SESSION_QUOTA_TTL_MS,
} from '@/domain/constants';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';

import type { QuotaState } from './types';

// ============================================================
// LEGACY SESSION COUNTER (orchestrator compatibility)
// ============================================================

type SessionQuotaEntry = { count: number; lastSeen: number };
const sessionQuotas = new Map<string, SessionQuotaEntry>();

function pruneSessionQuotas(now: number): void {
  for (const [sessionId, entry] of sessionQuotas.entries()) {
    if (now - entry.lastSeen > SESSION_QUOTA_TTL_MS) {
      sessionQuotas.delete(sessionId);
    }
  }

  if (sessionQuotas.size <= MAX_SESSION_QUOTA_ENTRIES) return;

  const entries = Array.from(sessionQuotas.entries()).sort(
    (left, right) => left[1].lastSeen - right[1].lastSeen,
  );
  const excess = entries.length - MAX_SESSION_QUOTA_ENTRIES;
  for (let index = 0; index < excess; index += 1) {
    sessionQuotas.delete(entries[index][0]);
  }
}

function makeSessionQuotaState(sessionId: string, count: number): QuotaState {
  return {
    sessionId,
    messageCount: count,
    remaining: Math.max(0, MAX_CHAT_QUOTA - count),
    // Daily identity reservations are now the sole blocking control. Keeping a
    // permanent session-level block would strand reused conversations after a
    // day and could suppress later distress-safe routing.
    exceeded: false,
  };
}

function checkQuotaInMemory(sessionId: string): QuotaState {
  const now = Date.now();
  pruneSessionQuotas(now);
  const entry = sessionQuotas.get(sessionId);
  if (entry) entry.lastSeen = now;
  return makeSessionQuotaState(sessionId, entry?.count ?? 0);
}

function incrementQuotaInMemory(sessionId: string): void {
  const now = Date.now();
  pruneSessionQuotas(now);
  const count = sessionQuotas.get(sessionId)?.count ?? 0;
  sessionQuotas.set(sessionId, { count: count + 1, lastSeen: now });
}

async function checkQuotaFromDb(sessionId: string): Promise<QuotaState> {
  const rows = await executeQuery<{ message_count: number }>(
    'SELECT message_count FROM chat_sessions WHERE id = $1',
    [sessionId],
  );
  return makeSessionQuotaState(sessionId, rows[0]?.message_count ?? 0);
}

async function incrementQuotaInDb(sessionId: string, userId?: string): Promise<void> {
  await executeQuery(
    `INSERT INTO chat_sessions (id, user_id, message_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (id) DO UPDATE SET
       message_count = chat_sessions.message_count + 1`,
    [sessionId, userId ?? null],
  );
}

export async function checkQuota(sessionId: string): Promise<QuotaState> {
  if (!isDatabaseConfigured()) return checkQuotaInMemory(sessionId);

  try {
    return await checkQuotaFromDb(sessionId);
  } catch (error) {
    await captureException(error, { feature: 'chat_quota_check', sessionId });
    return checkQuotaInMemory(sessionId);
  }
}

export async function incrementQuota(sessionId: string, userId?: string): Promise<void> {
  if (!isDatabaseConfigured()) {
    incrementQuotaInMemory(sessionId);
    return;
  }

  try {
    await incrementQuotaInDb(sessionId, userId);
  } catch (error) {
    await captureException(error, { feature: 'chat_quota_increment', sessionId });
    incrementQuotaInMemory(sessionId);
  }
}

export function checkQuotaSync(sessionId: string): QuotaState {
  return checkQuotaInMemory(sessionId);
}

// ============================================================
// IDENTITY-AWARE USAGE CONTROL
// ============================================================

type UsageDecision =
  | 'allowed'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'in_flight'
  | 'unavailable';
type UsageBackend = 'database' | 'memory';

export interface ChatUsageReservation {
  requestId: string;
  deviceId?: string;
  userId?: string;
  decision: UsageDecision;
  backend: UsageBackend;
  quota: QuotaState;
  retryAfterSeconds: number;
}

export interface ReserveChatRequestInput {
  requestId: string;
  deviceId: string;
  userId?: string;
  /** Authenticated user key or caller IP. The value is hashed before storage. */
  rateLimitKey: string;
}

interface IdentityKeys {
  deviceKey?: string;
  userKey?: string;
  keys: string[];
  primaryKey: string;
  limit: number;
}

interface DatabaseReservationRow {
  decision: UsageDecision;
  quota_remaining: number | string;
  quota_reset_at: string | Date | null;
  message_count: number | string;
  retry_after_seconds: number | string;
  rate_count: number | string;
  rate_reset_at: string | Date;
}

interface DatabaseQuotaRow {
  quota_remaining: number | string;
  quota_reset_at: string | Date | null;
  message_count: number | string;
}

function hashOpaqueKey(kind: 'device' | 'user' | 'rate', value: string): string {
  const digest = createHash('sha256').update(value, 'utf8').digest('hex');
  return `${kind}:${digest}`;
}

function buildIdentityKeys(deviceId?: string, userId?: string): IdentityKeys {
  const deviceKey = deviceId ? hashOpaqueKey('device', deviceId) : undefined;
  const userKey = userId ? hashOpaqueKey('user', userId) : undefined;
  const keys = [userKey, deviceKey].filter((key): key is string => Boolean(key));
  const limit = userKey ? AUTHENTICATED_CHAT_QUOTA : ANONYMOUS_CHAT_QUOTA;

  return {
    deviceKey,
    userKey,
    keys,
    primaryKey: userKey ?? deviceKey ?? 'anonymous',
    limit,
  };
}

function parseNumber(value: number | string | null | undefined, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function makeIdentityQuotaState(
  identity: IdentityKeys,
  count: number,
  resetAt?: Date,
): QuotaState {
  return {
    sessionId: identity.primaryKey,
    messageCount: count,
    remaining: Math.max(0, identity.limit - count),
    exceeded: count >= identity.limit,
    resetAt,
  };
}

// ============================================================
// PROCESS-LOCAL FALLBACK
// ============================================================

interface LocalUsageEvent {
  requestId: string;
  state: 'reserved' | 'consumed';
  reservedUntil: number;
  consumedAt?: number;
}

interface LocalLease {
  requestId: string;
  expiresAt: number;
}

interface LocalRateWindow {
  count: number;
  windowStart: number;
  resetAt: number;
}

const localUsageEvents = new Map<string, Map<string, LocalUsageEvent>>();
const localInflightLeases = new Map<string, LocalLease>();
const localRateWindows = new Map<string, LocalRateWindow>();

function pruneLocalIdentity(key: string, now: number): void {
  const events = localUsageEvents.get(key);
  if (events) {
    for (const [requestId, event] of events.entries()) {
      const expiredReservation = event.state === 'reserved' && event.reservedUntil <= now;
      const expiredUsage = event.state === 'consumed'
        && (event.consumedAt ?? event.reservedUntil) + CHAT_QUOTA_WINDOW_MS <= now;
      if (expiredReservation || expiredUsage) events.delete(requestId);
    }
    if (events.size === 0) localUsageEvents.delete(key);
  }

  const lease = localInflightLeases.get(key);
  if (lease && lease.expiresAt <= now) localInflightLeases.delete(key);
}

function getLocalQuota(identity: IdentityKeys, now = Date.now()): QuotaState {
  if (identity.keys.length === 0) {
    return makeIdentityQuotaState(identity, 0);
  }

  let mostRestrictiveCount = -1;
  let mostRestrictiveReset: Date | undefined;

  for (const key of identity.keys) {
    pruneLocalIdentity(key, now);
    const events = Array.from(localUsageEvents.get(key)?.values() ?? []);
    const count = events.length;
    const resetAtMs = events.reduce<number | undefined>((earliest, event) => {
      const eventReset = event.state === 'consumed'
        ? (event.consumedAt ?? now) + CHAT_QUOTA_WINDOW_MS
        : event.reservedUntil;
      return earliest === undefined || eventReset < earliest ? eventReset : earliest;
    }, undefined);

    if (
      count > mostRestrictiveCount
      || (count === mostRestrictiveCount
        && resetAtMs !== undefined
        && (mostRestrictiveReset === undefined || resetAtMs < mostRestrictiveReset.getTime()))
    ) {
      mostRestrictiveCount = count;
      mostRestrictiveReset = resetAtMs === undefined ? undefined : new Date(resetAtMs);
    }
  }

  return makeIdentityQuotaState(
    identity,
    Math.max(0, mostRestrictiveCount),
    mostRestrictiveReset,
  );
}

function checkLocalRateLimit(rateKey: string, now: number): LocalRateWindow {
  const existing = localRateWindows.get(rateKey);
  if (!existing || existing.resetAt <= now) {
    const next = { count: 1, windowStart: now, resetAt: now + RATE_LIMIT_WINDOW_MS };
    localRateWindows.set(rateKey, next);
    return next;
  }

  const next = {
    ...existing,
    count: Math.min(existing.count + 1, RATE_LIMIT_MAX_REQUESTS + 1),
  };
  localRateWindows.set(rateKey, next);
  return next;
}

function mirrorLocalReservation(identity: IdentityKeys, requestId: string, now: number): void {
  const reservedUntil = now + CHAT_INFLIGHT_LEASE_MS;
  for (const key of identity.keys) {
    pruneLocalIdentity(key, now);
    const events = localUsageEvents.get(key) ?? new Map<string, LocalUsageEvent>();
    events.set(requestId, { requestId, state: 'reserved', reservedUntil });
    localUsageEvents.set(key, events);
    localInflightLeases.set(key, { requestId, expiresAt: reservedUntil });
  }
}

function mirrorLocalQuota(identity: IdentityKeys, count: number, now: number): void {
  for (const key of identity.keys) {
    pruneLocalIdentity(key, now);
    const events = localUsageEvents.get(key) ?? new Map<string, LocalUsageEvent>();
    let syntheticIndex = 0;
    while (events.size < count) {
      const requestId = `database-mirror:${syntheticIndex}`;
      syntheticIndex += 1;
      if (events.has(requestId)) continue;
      events.set(requestId, {
        requestId,
        state: 'consumed',
        consumedAt: now,
        reservedUntil: now,
      });
    }
    if (events.size > 0) localUsageEvents.set(key, events);
  }
}

function mirrorLocalRate(
  rateKey: string,
  count: number,
  resetAt: Date | undefined,
  now: number,
): void {
  if (!resetAt) return;
  localRateWindows.set(rateKey, {
    count,
    windowStart: Math.max(0, resetAt.getTime() - RATE_LIMIT_WINDOW_MS),
    resetAt: Math.max(now, resetAt.getTime()),
  });
}

function reserveLocally(input: ReserveChatRequestInput): ChatUsageReservation {
  const now = Date.now();
  const identity = buildIdentityKeys(input.deviceId, input.userId);
  const rateKey = hashOpaqueKey('rate', input.rateLimitKey);
  const rate = checkLocalRateLimit(rateKey, now);
  const rateRetry = Math.max(1, Math.ceil((rate.resetAt - now) / 1000));

  if (rate.count > RATE_LIMIT_MAX_REQUESTS) {
    return {
      requestId: input.requestId,
      deviceId: input.deviceId,
      userId: input.userId,
      decision: 'rate_limited',
      backend: 'memory',
      quota: getLocalQuota(identity, now),
      retryAfterSeconds: rateRetry,
    };
  }

  const activeLease = identity.keys
    .map((key) => {
      pruneLocalIdentity(key, now);
      return localInflightLeases.get(key);
    })
    .find((lease) => lease && lease.requestId !== input.requestId && lease.expiresAt > now);

  if (activeLease) {
    return {
      requestId: input.requestId,
      deviceId: input.deviceId,
      userId: input.userId,
      decision: 'in_flight',
      backend: 'memory',
      quota: getLocalQuota(identity, now),
      retryAfterSeconds: Math.max(1, Math.ceil((activeLease.expiresAt - now) / 1000)),
    };
  }

  const quota = getLocalQuota(identity, now);
  if (quota.exceeded) {
    const quotaRetry = quota.resetAt
      ? Math.max(1, Math.ceil((quota.resetAt.getTime() - now) / 1000))
      : Math.ceil(CHAT_QUOTA_WINDOW_MS / 1000);
    return {
      requestId: input.requestId,
      deviceId: input.deviceId,
      userId: input.userId,
      decision: 'quota_exceeded',
      backend: 'memory',
      quota,
      retryAfterSeconds: quotaRetry,
    };
  }

  mirrorLocalReservation(identity, input.requestId, now);
  return {
    requestId: input.requestId,
    deviceId: input.deviceId,
    userId: input.userId,
    decision: 'allowed',
    backend: 'memory',
    quota: getLocalQuota(identity, now),
    retryAfterSeconds: rateRetry,
  };
}

function finalizeLocally(reservation: ChatUsageReservation, consume: boolean): void {
  const now = Date.now();
  const identity = buildIdentityKeys(reservation.deviceId, reservation.userId);

  for (const key of identity.keys) {
    const events = localUsageEvents.get(key);
    const event = events?.get(reservation.requestId);
    if (event) {
      if (consume) {
        events?.set(reservation.requestId, {
          ...event,
          state: 'consumed',
          consumedAt: now,
        });
      } else {
        events?.delete(reservation.requestId);
        if (events?.size === 0) localUsageEvents.delete(key);
      }
    }

    const lease = localInflightLeases.get(key);
    if (lease?.requestId === reservation.requestId) localInflightLeases.delete(key);
  }
}

// ============================================================
// DATABASE-BACKED USAGE CONTROL
// ============================================================

async function reserveInDatabase(input: ReserveChatRequestInput): Promise<ChatUsageReservation> {
  const now = Date.now();
  const identity = buildIdentityKeys(input.deviceId, input.userId);
  const rateKey = hashOpaqueKey('rate', input.rateLimitKey);
  const rows = await executeQuery<DatabaseReservationRow>(
    `SELECT decision,
            quota_remaining,
            quota_reset_at,
            message_count,
            retry_after_seconds,
            rate_count,
            rate_reset_at
     FROM oran_internal.reserve_chat_request(
       $1::uuid,
       $2::text,
       $3::text,
       $4::text,
       $5::integer,
       $6::integer,
       $7::integer,
       $8::integer
     )`,
    [
      input.requestId,
      identity.deviceKey ?? null,
      identity.userKey ?? null,
      rateKey,
      Math.floor(CHAT_QUOTA_WINDOW_MS / 1000),
      Math.floor(RATE_LIMIT_WINDOW_MS / 1000),
      RATE_LIMIT_MAX_REQUESTS,
      Math.floor(CHAT_INFLIGHT_LEASE_MS / 1000),
    ],
  );

  const row = rows[0];
  if (!row || !['allowed', 'quota_exceeded', 'rate_limited', 'in_flight'].includes(row.decision)) {
    throw new Error('Chat usage reservation returned an invalid result');
  }

  const count = parseNumber(row.message_count);
  const quota: QuotaState = {
    sessionId: identity.primaryKey,
    messageCount: count,
    remaining: Math.max(0, parseNumber(row.quota_remaining, identity.limit - count)),
    exceeded: row.decision === 'quota_exceeded' || count >= identity.limit,
    resetAt: parseDate(row.quota_reset_at),
  };

  mirrorLocalRate(
    rateKey,
    parseNumber(row.rate_count),
    parseDate(row.rate_reset_at),
    now,
  );
  if (row.decision === 'allowed') {
    mirrorLocalReservation(identity, input.requestId, now);
  }
  mirrorLocalQuota(identity, count, now);

  return {
    requestId: input.requestId,
    deviceId: input.deviceId,
    userId: input.userId,
    decision: row.decision,
    backend: 'database',
    quota,
    retryAfterSeconds: Math.max(1, parseNumber(row.retry_after_seconds, 1)),
  };
}

async function checkQuotaInDatabase(deviceId?: string, userId?: string): Promise<QuotaState> {
  const now = Date.now();
  const identity = buildIdentityKeys(deviceId, userId);
  const rows = await executeQuery<DatabaseQuotaRow>(
    `SELECT quota_remaining, quota_reset_at, message_count
     FROM oran_internal.check_chat_quota($1::text, $2::text, $3::integer)`,
    [
      identity.deviceKey ?? null,
      identity.userKey ?? null,
      Math.floor(CHAT_QUOTA_WINDOW_MS / 1000),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('Chat quota check returned no result');
  const count = parseNumber(row.message_count);
  mirrorLocalQuota(identity, count, now);
  return {
    sessionId: identity.primaryKey,
    messageCount: count,
    remaining: Math.max(0, parseNumber(row.quota_remaining, identity.limit - count)),
    exceeded: count >= identity.limit,
    resetAt: parseDate(row.quota_reset_at),
  };
}

// ============================================================
// PUBLIC IDENTITY API
// ============================================================

/**
 * Atomically applies the six-per-minute limiter, one-in-flight lease, and
 * rolling daily quota. Capacity is only reserved here; callers must finalize.
 */
export async function reserveChatRequest(
  input: ReserveChatRequestInput,
): Promise<ChatUsageReservation> {
  if (!isDatabaseConfigured()) return reserveLocally(input);

  try {
    return await reserveInDatabase(input);
  } catch (error) {
    await captureException(error, {
      feature: 'chat_usage_reserve',
      extra: { requestId: input.requestId },
    });

    const identity = buildIdentityKeys(input.deviceId, input.userId);
    return {
      requestId: input.requestId,
      deviceId: input.deviceId,
      userId: input.userId,
      decision: 'unavailable',
      backend: 'database',
      quota: getLocalQuota(identity),
      retryAfterSeconds: CHAT_USAGE_UNAVAILABLE_RETRY_SECONDS,
    };
  }
}

/**
 * Commits a successful response or releases an unchargeable/error response.
 * Failed commits are surfaced so a response is never reported successful when
 * its persistent quota record could not be finalized.
 */
export async function finalizeChatRequest(
  reservation: ChatUsageReservation,
  consume: boolean,
): Promise<QuotaState> {
  if (reservation.decision !== 'allowed') return reservation.quota;

  let finalizeError: unknown;
  if (reservation.backend === 'database') {
    try {
      await executeQuery(
        'SELECT oran_internal.finalize_chat_request($1::uuid, $2::boolean)',
        [reservation.requestId, consume],
      );
    } catch (error) {
      finalizeError = error;
      await captureException(error, {
        feature: 'chat_usage_finalize',
        extra: { requestId: reservation.requestId, consume },
      });
    }
  }

  finalizeLocally(reservation, consume);

  if (finalizeError && consume) {
    throw new Error('Unable to finalize successful chat usage', { cause: finalizeError });
  }

  return checkQuotaByIdentity(reservation.deviceId, reservation.userId);
}

/** Read the most restrictive user/device rolling quota without consuming it. */
export async function checkQuotaByIdentity(
  deviceId: string | undefined,
  userId: string | undefined,
): Promise<QuotaState> {
  const identity = buildIdentityKeys(deviceId, userId);
  if (!isDatabaseConfigured()) return getLocalQuota(identity);

  try {
    return await checkQuotaInDatabase(deviceId, userId);
  } catch (error) {
    await captureException(error, {
      feature: 'chat_quota_check_window',
      extra: { hasDevice: Boolean(deviceId), authenticated: Boolean(userId) },
    });
    return getLocalQuota(identity);
  }
}

/** Compatibility lookup for older callers; new code should use identity checks. */
export async function checkQuotaByKey(key: string): Promise<QuotaState> {
  return checkQuotaByIdentity(key, undefined);
}

/**
 * Compatibility increment for older callers. New request handlers should use
 * reserveChatRequest/finalizeChatRequest so concurrency cannot overshoot.
 */
export async function incrementQuotaByIdentity(
  deviceId: string | undefined,
  userId: string | undefined,
): Promise<void> {
  if (!deviceId) return;
  const requestId = randomUUID();
  const reservation = await reserveChatRequest({
    requestId,
    deviceId,
    userId,
    rateLimitKey: userId ? `legacy-user:${userId}` : `legacy-device:${deviceId}`,
  });
  if (reservation.decision === 'allowed') {
    await finalizeChatRequest(reservation, true);
  }
}

// ============================================================
// TEST HELPERS
// ============================================================

export function resetSessionQuotasForTests(): void {
  sessionQuotas.clear();
  localUsageEvents.clear();
  localInflightLeases.clear();
  localRateWindows.clear();
}
