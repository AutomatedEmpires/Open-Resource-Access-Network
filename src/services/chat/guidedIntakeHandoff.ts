'use client';

import { z } from 'zod';

import {
  guidedIntakePromptMatchesDraft,
  type GuidedIntakeSubmission,
} from '@/domain/resourceNavigator';
import { GuidedIntakeRequestSchema } from '@/services/chat/guidedIntakeContract';

export const GUIDED_INTAKE_HANDOFF_KEY = 'oran:guided-intake-handoff';
const GUIDED_INTAKE_RETRY_KEY_PREFIX = 'oran:guided-intake-retry:';

const GuidedIntakeHandoffSchema = GuidedIntakeRequestSchema.extend({
  prompt: z.string().trim().min(1).max(1200),
}).strict().refine((submission) => guidedIntakePromptMatchesDraft(submission.prompt, {
  need: submission.searchText,
  location: submission.location,
  urgency: submission.urgency,
  audience: submission.audience,
  accessMode: submission.accessMode,
}), {
  message: 'Guided intake fields must match the visible prompt.',
});

export function writeGuidedIntakeHandoff(submission: GuidedIntakeSubmission): boolean {
  if (typeof window === 'undefined') return false;
  const parsed = GuidedIntakeHandoffSchema.safeParse(submission);
  if (!parsed.success) return false;

  try {
    sessionStorage.setItem(GUIDED_INTAKE_HANDOFF_KEY, JSON.stringify(parsed.data));
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

    const parsed = GuidedIntakeHandoffSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
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

export function writeGuidedIntakeRetry(
  sessionId: string,
  submission: GuidedIntakeSubmission,
): boolean {
  if (typeof window === 'undefined') return false;
  const parsed = GuidedIntakeHandoffSchema.safeParse(submission);
  if (!parsed.success) return false;

  try {
    sessionStorage.setItem(getGuidedIntakeRetryKey(sessionId), JSON.stringify(parsed.data));
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

    const parsed = GuidedIntakeHandoffSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
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

export function clearGuidedIntakeRetry(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(getGuidedIntakeRetryKey(sessionId));
  } catch {
    // Session-only retry state is best effort when browser storage is blocked.
  }
}
