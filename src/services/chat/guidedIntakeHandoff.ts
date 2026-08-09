'use client';

import {
  guidedIntakePromptMatchesDraft,
  type GuidedIntakeSubmission,
} from '@/domain/resourceNavigator';
import { parseGuidedIntakeRequest } from '@/services/chat/guidedIntakeValidation';

export const GUIDED_INTAKE_HANDOFF_KEY = 'oran:guided-intake-handoff';
const GUIDED_INTAKE_RETRY_KEY_PREFIX = 'oran:guided-intake-retry:';
const GUIDED_INTAKE_RETRY_BLOCK_KEY_PREFIX = 'oran:guided-intake-retry-blocked-until:';
const MAX_RETRY_BLOCK_MS = 26 * 60 * 60 * 1000;

const HANDOFF_KEYS = new Set(['prompt', 'searchText', 'location', 'urgency', 'audience', 'accessMode']);

function parseGuidedIntakeHandoff(value: unknown): GuidedIntakeSubmission | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !HANDOFF_KEYS.has(key))) return null;
  if (typeof record.prompt !== 'string') return null;
  const prompt = record.prompt.trim();
  if (prompt.length < 1 || prompt.length > 1200) return null;

  const parsed = parseGuidedIntakeRequest({
    searchText: record.searchText,
    location: record.location,
    urgency: record.urgency,
    audience: record.audience,
    accessMode: record.accessMode,
  });
  if (!parsed.success) return null;

  const submission = { prompt, ...parsed.data };
  return guidedIntakePromptMatchesDraft(prompt, {
    need: submission.searchText,
    location: submission.location,
    urgency: submission.urgency,
    audience: submission.audience,
    accessMode: submission.accessMode,
  }) ? submission : null;
}

export function writeGuidedIntakeHandoff(submission: GuidedIntakeSubmission): boolean {
  if (typeof window === 'undefined') return false;
  const parsed = parseGuidedIntakeHandoff(submission);
  if (!parsed) return false;

  try {
    sessionStorage.setItem(GUIDED_INTAKE_HANDOFF_KEY, JSON.stringify(parsed));
    return true;
  } catch {
    return false;
  }
}

export function consumeGuidedIntakeHandoff(): GuidedIntakeSubmission | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(GUIDED_INTAKE_HANDOFF_KEY);
    sessionStorage.removeItem(GUIDED_INTAKE_HANDOFF_KEY);
    if (!raw) return null;

    return parseGuidedIntakeHandoff(JSON.parse(raw));
  } catch {
    try {
      sessionStorage.removeItem(GUIDED_INTAKE_HANDOFF_KEY);
    } catch {
      // Storage is unavailable; there is nothing else to clean up safely.
    }
    return null;
  }
}

function getGuidedIntakeRetryKey(sessionId: string): string {
  return `${GUIDED_INTAKE_RETRY_KEY_PREFIX}${sessionId}`;
}

function getGuidedIntakeRetryBlockKey(sessionId: string): string {
  return `${GUIDED_INTAKE_RETRY_BLOCK_KEY_PREFIX}${sessionId}`;
}

export function writeGuidedIntakeRetry(
  sessionId: string,
  submission: GuidedIntakeSubmission,
): boolean {
  if (typeof window === 'undefined') return false;
  const parsed = parseGuidedIntakeHandoff(submission);
  if (!parsed) return false;

  try {
    sessionStorage.setItem(getGuidedIntakeRetryKey(sessionId), JSON.stringify(parsed));
    return true;
  } catch {
    return false;
  }
}

export function readGuidedIntakeRetry(sessionId: string): GuidedIntakeSubmission | null {
  if (typeof window === 'undefined') return null;

  const key = getGuidedIntakeRetryKey(sessionId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const parsed = parseGuidedIntakeHandoff(JSON.parse(raw));
    if (parsed) return parsed;
    sessionStorage.removeItem(key);
    return null;
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Storage is unavailable; there is nothing else to clean up safely.
    }
    return null;
  }
}

export function writeGuidedIntakeRetryBlockedUntil(sessionId: string, blockedUntil: number): boolean {
  if (typeof window === 'undefined') return false;
  const now = Date.now();
  if (!Number.isFinite(blockedUntil) || blockedUntil <= now || blockedUntil > now + MAX_RETRY_BLOCK_MS) {
    return false;
  }

  try {
    sessionStorage.setItem(getGuidedIntakeRetryBlockKey(sessionId), String(Math.floor(blockedUntil)));
    return true;
  } catch {
    return false;
  }
}

export function readGuidedIntakeRetryBlockedUntil(sessionId: string): number | null {
  if (typeof window === 'undefined') return null;
  const key = getGuidedIntakeRetryBlockKey(sessionId);

  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const blockedUntil = Number(raw);
    const now = Date.now();
    if (Number.isFinite(blockedUntil) && blockedUntil > now && blockedUntil <= now + MAX_RETRY_BLOCK_MS) {
      return blockedUntil;
    }
    sessionStorage.removeItem(key);
    return null;
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Storage is unavailable; there is nothing else to clean up safely.
    }
    return null;
  }
}

export function clearGuidedIntakeRetryBlockedUntil(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(getGuidedIntakeRetryBlockKey(sessionId));
  } catch {
    // Session-only retry state is best effort when browser storage is blocked.
  }
}

export function clearGuidedIntakeRetry(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(getGuidedIntakeRetryKey(sessionId));
    sessionStorage.removeItem(getGuidedIntakeRetryBlockKey(sessionId));
  } catch {
    // Session-only retry state is best effort when browser storage is blocked.
  }
}
