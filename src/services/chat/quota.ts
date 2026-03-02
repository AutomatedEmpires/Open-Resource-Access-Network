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
}
