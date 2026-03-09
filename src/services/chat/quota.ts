/**
 * Chat Quota Service
 *
 * Persistent (DB-backed) quota management for chat sessions.
 * Falls back to in-memory tracking when the database is not configured.
 *
 * Quota is per-session: each sessionId gets MAX_CHAT_QUOTA messages.
 * The DB stores message_count in chat_sessions. The in-memory map
 * serves as a cache and provides the fallback for environments
 * without a database (dev/CI).
 */

import { isDatabaseConfigured, executeQuery } from '@/services/db/postgres';
import {
  MAX_CHAT_QUOTA,
  CHAT_QUOTA_WINDOW_MS,
  MAX_SESSION_QUOTA_ENTRIES,
  SESSION_QUOTA_TTL_MS,
} from '@/domain/constants';
import type { QuotaState } from './types';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// IN-MEMORY FALLBACK (used when DB is not configured)
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

  const entries = Array.from(sessionQuotas.entries());
  entries.sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const excess = entries.length - MAX_SESSION_QUOTA_ENTRIES;
  for (let i = 0; i < excess; i++) {
    sessionQuotas.delete(entries[i][0]);
  }
}

function checkQuotaInMemory(sessionId: string): QuotaState {
  const now = Date.now();
  pruneSessionQuotas(now);

  const entry = sessionQuotas.get(sessionId);
  const count = entry?.count ?? 0;
  if (entry) {
    entry.lastSeen = now;
  }
  const remaining = Math.max(0, MAX_CHAT_QUOTA - count);
  return {
    sessionId,
    messageCount: count,
    remaining,
    exceeded: count >= MAX_CHAT_QUOTA,
  };
}

function incrementQuotaInMemory(sessionId: string): void {
  const now = Date.now();
  pruneSessionQuotas(now);

  const entry = sessionQuotas.get(sessionId);
  const count = entry?.count ?? 0;
  sessionQuotas.set(sessionId, { count: count + 1, lastSeen: now });
}

// ============================================================
// DATABASE-BACKED QUOTA
// ============================================================

interface ChatSessionQuotaRow {
  message_count: number;
}

/**
 * Check the quota for a session from the database.
 * If the session doesn't exist yet, returns count 0.
 */
async function checkQuotaFromDb(sessionId: string): Promise<QuotaState> {
  const rows = await executeQuery<ChatSessionQuotaRow>(
    'SELECT message_count FROM chat_sessions WHERE id = $1',
    [sessionId]
  );

  const count = rows[0]?.message_count ?? 0;
  const remaining = Math.max(0, MAX_CHAT_QUOTA - count);
  return {
    sessionId,
    messageCount: count,
    remaining,
    exceeded: count >= MAX_CHAT_QUOTA,
  };
}

/**
 * Atomically increment the quota in the database.
 * Uses UPSERT to handle the case where the session row doesn't exist yet.
 */
async function incrementQuotaInDb(sessionId: string, userId?: string): Promise<void> {
  await executeQuery(
    `INSERT INTO chat_sessions (id, user_id, message_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (id) DO UPDATE SET
       message_count = chat_sessions.message_count + 1`,
    [sessionId, userId ?? null]
  );
}

// ============================================================
// PUBLIC API — auto-selects DB or in-memory
// ============================================================

/**
 * Check quota for a session. Uses DB when available, in-memory otherwise.
 */
export async function checkQuota(sessionId: string): Promise<QuotaState> {
  if (!isDatabaseConfigured()) {
    return checkQuotaInMemory(sessionId);
  }

  try {
    return await checkQuotaFromDb(sessionId);
  } catch (error) {
    // DB failure → fall back to in-memory so chat still works
    await captureException(error, {
      feature: 'chat_quota_check',
      sessionId,
    });
    return checkQuotaInMemory(sessionId);
  }
}

/**
 * Increment the quota after a successful chat response.
 * Uses DB when available, in-memory otherwise.
 */
export async function incrementQuota(
  sessionId: string,
  userId?: string
): Promise<void> {
  if (!isDatabaseConfigured()) {
    incrementQuotaInMemory(sessionId);
    return;
  }

  try {
    await incrementQuotaInDb(sessionId, userId);
  } catch (error) {
    // DB failure → fall back to in-memory so chat still works
    await captureException(error, {
      feature: 'chat_quota_increment',
      sessionId,
    });
    incrementQuotaInMemory(sessionId);
  }
}

// ============================================================
// SYNC CHECK (kept for code that cannot be async yet)
// ============================================================

/**
 * Synchronous in-memory-only quota check.
 * Used by assembleContext() which requires sync access to the count.
 */
export function checkQuotaSync(sessionId: string): QuotaState {
  return checkQuotaInMemory(sessionId);
}

// ============================================================
// TEST HELPERS
// ============================================================

export function resetSessionQuotasForTests(): void {
  sessionQuotas.clear();
  windowQuotas.clear();
}

// ============================================================
// 24-HOUR WINDOW QUOTA (cross-session, cross-device)
// ============================================================
//
// Key format:  'user:<userId>'   — for authenticated users (cross-device)
//              'device:<deviceId>' — for anonymous sessions
//
// On each chat message, both keys are written when a userId is present.
// This enforces the quota across devices for signed-in accounts AND
// prevents a logged-out user from bypassing the limit on the same device.
//

type WindowEntry = { count: number; windowStart: number; resetAt: number };
const windowQuotas = new Map<string, WindowEntry>();

interface ChatQuotaWindowRow {
  message_count: number;
  window_start: string;
  reset_at: string;
}

function makeQuotaState(sessionId: string, count: number, resetAt?: Date): QuotaState {
  const remaining = Math.max(0, MAX_CHAT_QUOTA - count);
  return {
    sessionId,
    messageCount: count,
    remaining,
    exceeded: count >= MAX_CHAT_QUOTA,
    resetAt,
  };
}

// --- In-memory fallback ---

function checkWindowInMemory(key: string): QuotaState {
  const now = Date.now();
  const entry = windowQuotas.get(key);
  if (!entry || entry.resetAt <= now) {
    return makeQuotaState(key, 0, undefined);
  }
  return makeQuotaState(key, entry.count, new Date(entry.resetAt));
}

function incrementWindowInMemory(key: string): void {
  const now = Date.now();
  const entry = windowQuotas.get(key);
  if (!entry || entry.resetAt <= now) {
    // Start a fresh 24-hour window
    const resetAt = now + CHAT_QUOTA_WINDOW_MS;
    windowQuotas.set(key, { count: 1, windowStart: now, resetAt });
  } else {
    windowQuotas.set(key, { ...entry, count: entry.count + 1 });
  }
}

// --- DB-backed ---

async function checkWindowFromDb(key: string): Promise<QuotaState> {
  const rows = await executeQuery<ChatQuotaWindowRow>(
    `SELECT message_count, window_start, reset_at
     FROM chat_quota_windows
     WHERE key = $1 AND reset_at > now()`,
    [key],
  );
  const row = rows[0];
  if (!row) return makeQuotaState(key, 0, undefined);
  return makeQuotaState(key, row.message_count, new Date(row.reset_at));
}

/**
 * Atomically increment the 24-hour window quota.
 * If the existing window is expired, this starts a fresh window.
 * Returns the updated state after increment.
 */
async function incrementWindowInDb(key: string): Promise<{ count: number; resetAt: Date }> {
  const rows = await executeQuery<{ message_count: number; reset_at: string }>(
    `INSERT INTO chat_quota_windows (key, message_count, window_start, reset_at)
     VALUES ($1, 1, now(), now() + INTERVAL '24 hours')
     ON CONFLICT (key) DO UPDATE SET
       message_count = CASE
         WHEN chat_quota_windows.reset_at <= now() THEN 1
         ELSE chat_quota_windows.message_count + 1
       END,
       window_start = CASE
         WHEN chat_quota_windows.reset_at <= now() THEN now()
         ELSE chat_quota_windows.window_start
       END,
       reset_at = CASE
         WHEN chat_quota_windows.reset_at <= now() THEN now() + INTERVAL '24 hours'
         ELSE chat_quota_windows.reset_at
       END
     RETURNING message_count, reset_at`,
    [key],
  );
  const row = rows[0];
  return { count: row?.message_count ?? 1, resetAt: new Date(row?.reset_at ?? Date.now() + CHAT_QUOTA_WINDOW_MS) };
}

// --- Public API ---

/**
 * Check the 24-hour window quota for a single key.
 * Used by GET /api/chat/quota for a single-key lookup.
 */
export async function checkQuotaByKey(key: string): Promise<QuotaState> {
  if (!isDatabaseConfigured()) return checkWindowInMemory(key);
  try {
    return await checkWindowFromDb(key);
  } catch (error) {
    await captureException(error, { feature: 'chat_quota_check_window', extra: { key } });
    return checkWindowInMemory(key);
  }
}

/**
 * Check the effective 24-hour quota for an identity (device + optional user).
 * For logged-in users, checks both user and device keys and returns the most
 * restrictive state (lowest remaining) to prevent cross-key bypass.
 */
export async function checkQuotaByIdentity(
  deviceId: string | undefined,
  userId: string | undefined,
): Promise<QuotaState> {
  const keys: string[] = [];
  if (userId) keys.push(`user:${userId}`);
  if (deviceId) keys.push(`device:${deviceId}`);
  if (keys.length === 0) {
    return makeQuotaState('anonymous', 0, undefined);
  }

  const states = await Promise.all(keys.map((k) => checkQuotaByKey(k)));
  // Return the most restrictive state (fewest messages remaining)
  return states.reduce((worst, cur) => (cur.remaining < worst.remaining ? cur : worst));
}

/**
 * Increment the 24-hour window quota for an identity.
 * Always increments device key. Also increments user key when known.
 * Returns the updated QuotaState for the primary key (user > device).
 */
export async function incrementQuotaByIdentity(
  deviceId: string | undefined,
  userId: string | undefined,
): Promise<void> {
  const increments: Promise<unknown>[] = [];

  if (!isDatabaseConfigured()) {
    if (userId) incrementWindowInMemory(`user:${userId}`);
    if (deviceId) incrementWindowInMemory(`device:${deviceId}`);
    return;
  }

  if (userId) increments.push(incrementWindowInDb(`user:${userId}`).catch((e) =>
    captureException(e, { feature: 'chat_quota_increment_window', extra: { key: `user:${userId}` } })));
  if (deviceId) increments.push(incrementWindowInDb(`device:${deviceId}`).catch((e) =>
    captureException(e, { feature: 'chat_quota_increment_window', extra: { key: `device:${deviceId}` } })));

  await Promise.all(increments);
}
