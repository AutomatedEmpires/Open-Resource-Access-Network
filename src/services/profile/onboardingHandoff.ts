'use client';

import { z } from 'zod';

import { DISCOVERY_NEED_IDS, type DiscoveryNeedId } from '@/domain/discoveryNeeds';

export const ONBOARDING_CHAT_HANDOFF_KEY = 'oran:onboarding-chat-handoff';

const OnboardingChatHandoffSchema = z.object({
  prompt: z.string().min(1).max(1200),
  needId: z.enum(DISCOVERY_NEED_IDS).nullable(),
});

export interface OnboardingChatHandoff {
  prompt: string;
  needId: DiscoveryNeedId | null;
}

export function writeOnboardingChatHandoff(handoff: OnboardingChatHandoff): boolean {
  if (typeof window === 'undefined') return false;
  const parsed = OnboardingChatHandoffSchema.safeParse(handoff);
  if (!parsed.success) return false;

  try {
    sessionStorage.setItem(ONBOARDING_CHAT_HANDOFF_KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

export function consumeOnboardingChatHandoff(): OnboardingChatHandoff | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(ONBOARDING_CHAT_HANDOFF_KEY);
    sessionStorage.removeItem(ONBOARDING_CHAT_HANDOFF_KEY);
    if (!raw) return null;

    const parsed = OnboardingChatHandoffSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    sessionStorage.removeItem(ONBOARDING_CHAT_HANDOFF_KEY);
    return null;
  }
}
