import type { ChatContext } from '@/services/chat/types';
import { buildSeekerDiscoveryProfile } from '@/services/profile/discoveryProfile';
import type { SearchPreferenceSignals } from '@/services/search/types';

export function shouldUseSavedSeekerProfile(context: ChatContext): boolean {
  const audience = context.sessionContext?.audience;
  return !context.profileShapingDisabled && (!audience || audience === 'self');
}

export function buildChatSearchProfileSignals(context: ChatContext): SearchPreferenceSignals | undefined {
  const profileSignals = shouldUseSavedSeekerProfile(context) && context.userProfile
    ? buildSeekerDiscoveryProfile(context.userProfile, { locale: context.locale }).profileSignals
    : undefined;
  const canTravel = context.sessionContext?.accessMode === 'can_travel';
  const urgencyWindow = context.sessionContext?.urgencyWindow;
  const urgencyAccessTags = urgencyWindow === 'today'
    ? ['same_day', '24_7', 'after_hours', 'weekend_hours', 'evening_hours']
    : urgencyWindow === 'within_days'
      ? ['same_day', 'next_day']
      : [];
  const audienceCultureTags = context.sessionContext?.audience === 'child'
    ? ['youth_focused', 'family_centered']
    : context.sessionContext?.audience === 'family'
      ? ['family_centered']
      : [];
  const savedAccessTags = (urgencyWindow
    ? (profileSignals?.accessTags ?? []).filter((tag) => !['same_day', 'next_day'].includes(tag))
    : profileSignals?.accessTags ?? [])
    .filter((tag) => !canTravel || tag !== 'transportation_provided');
  const accessTags = Array.from(new Set([...savedAccessTags, ...urgencyAccessTags]));
  const cultureTags = Array.from(new Set([...(profileSignals?.cultureTags ?? []), ...audienceCultureTags]));
  const hasSessionDeliveryPreference = Boolean(
    context.sessionContext
    && Object.prototype.hasOwnProperty.call(context.sessionContext, 'preferredDeliveryModes'),
  );
  const sessionDeliveryTags = context.sessionContext?.preferredDeliveryModes ?? [];

  const merged: SearchPreferenceSignals = {
    ...profileSignals,
    situationTags: canTravel
      ? profileSignals?.situationTags?.filter((tag) => tag !== 'transportation_barrier')
      : profileSignals?.situationTags,
    accessTags: accessTags.length > 0 ? accessTags : undefined,
    cultureTags: cultureTags.length > 0 ? cultureTags : undefined,
    deliveryTags: hasSessionDeliveryPreference
      ? sessionDeliveryTags.length > 0 ? sessionDeliveryTags : undefined
      : profileSignals?.deliveryTags,
  };

  return Object.values(merged).some((tags) => tags && tags.length > 0)
    ? merged
    : undefined;
}
