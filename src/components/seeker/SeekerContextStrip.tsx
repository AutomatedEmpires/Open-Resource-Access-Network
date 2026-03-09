'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bookmark, MapPin, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { readStoredSeekerProfile, SEEKER_PROFILE_UPDATED_EVENT } from '@/services/profile/clientContext';
import { buildSeekerDiscoveryProfile } from '@/services/profile/discoveryProfile';
import {
  readStoredSavedServiceCount,
  SAVED_SERVICES_UPDATED_EVENT,
} from '@/services/saved/client';
import {
  PROFILE_PREFERENCES_UPDATED_EVENT,
  readStoredProfilePreferences,
} from '@/services/profile/syncPreference';

interface SeekerShellContext {
  approximateCity: string;
  savedCount: number;
  interestCount: number;
  hasPersonalization: boolean;
  hasProfileIdentity: boolean;
  serverSyncEnabled: boolean;
}

function readContext(): SeekerShellContext {
  if (typeof window === 'undefined') {
    return {
      approximateCity: '',
      savedCount: 0,
      interestCount: 0,
      hasPersonalization: false,
      hasProfileIdentity: false,
      serverSyncEnabled: false,
    };
  }

  let approximateCity = '';
  let savedCount = 0;
  let interestCount = 0;
  let hasPersonalization = false;
  let hasProfileIdentity = false;
  let serverSyncEnabled = false;

  try {
    const prefs = readStoredProfilePreferences();
    approximateCity = prefs.approximateCity ?? '';
    serverSyncEnabled = prefs.serverSyncEnabled === true;
  } catch {
    approximateCity = '';
    serverSyncEnabled = false;
  }

  try {
    savedCount = readStoredSavedServiceCount();
  } catch {
    savedCount = 0;
  }

  try {
    const seeker = readStoredSeekerProfile();
    const discoveryProfile = buildSeekerDiscoveryProfile(seeker);
    interestCount = seeker.serviceInterests.length;
    hasPersonalization = discoveryProfile.hasPersonalization;
    hasProfileIdentity = discoveryProfile.hasIdentityContext;
  } catch {
    interestCount = 0;
    hasPersonalization = false;
    hasProfileIdentity = false;
  }

  return {
    approximateCity,
    savedCount,
    interestCount,
    hasPersonalization,
    hasProfileIdentity,
    serverSyncEnabled,
  };
}

function ContextChip({ icon, children, href, title }: { icon: React.ReactNode; children: React.ReactNode; href?: string; title?: string }) {
  const className = 'inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-gray-700 shadow-sm';

  if (href) {
    return (
      <Link href={href} className={`${className} hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800`} title={title}>
        <span className="text-gray-500" aria-hidden="true">{icon}</span>
        <span>{children}</span>
      </Link>
    );
  }

  return (
    <span className={className} title={title}>
      <span className="text-gray-500" aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </span>
  );
}

export function SeekerContextStrip({ pathname: _pathname }: { pathname: string }) {
  const [context, setContext] = useState<SeekerShellContext>(() => readContext());

  useEffect(() => {
    const refreshContext = () => {
      window.setTimeout(() => {
        setContext(readContext());
      }, 0);
    };

    refreshContext();
    window.addEventListener('storage', refreshContext);
    window.addEventListener(SAVED_SERVICES_UPDATED_EVENT, refreshContext as EventListener);
    window.addEventListener(PROFILE_PREFERENCES_UPDATED_EVENT, refreshContext as EventListener);
    window.addEventListener(SEEKER_PROFILE_UPDATED_EVENT, refreshContext as EventListener);

    return () => {
      window.removeEventListener('storage', refreshContext);
      window.removeEventListener(SAVED_SERVICES_UPDATED_EVENT, refreshContext as EventListener);
      window.removeEventListener(PROFILE_PREFERENCES_UPDATED_EVENT, refreshContext as EventListener);
      window.removeEventListener(SEEKER_PROFILE_UPDATED_EVENT, refreshContext as EventListener);
    };
  }, [_pathname]);

  const primaryContext = useMemo(() => {
    const items: React.ReactNode[] = [];

    if (context.approximateCity) {
      items.push(
        <ContextChip
          key="city"
          icon={<MapPin className="h-3.5 w-3.5" />}
          href="/profile"
          title="Approximate location only. ORAN does not use precise location by default."
        >
          Near {context.approximateCity} (approx.)
        </ContextChip>,
      );
    }

    if (context.savedCount > 0) {
      items.push(
        <ContextChip key="saved" icon={<Bookmark className="h-3.5 w-3.5" />} href="/saved">
          {context.savedCount > 99 ? '99+' : context.savedCount} saved
        </ContextChip>,
      );
    }

    if (context.interestCount > 0) {
      items.push(
        <ContextChip key="interests" icon={<Sparkles className="h-3.5 w-3.5" />} href="/profile">
          {context.interestCount} interests set
        </ContextChip>,
      );
    }

    if (context.hasProfileIdentity) {
      items.push(
        <ContextChip key="identity" icon={<UserRound className="h-3.5 w-3.5" />} href="/profile">
          Personalized profile
        </ContextChip>,
      );
    }

    items.push(
      <ContextChip
        key="sync"
        icon={<ShieldCheck className="h-3.5 w-3.5" />}
        href="/profile"
        title={
          context.serverSyncEnabled
            ? 'Cross-device sync is enabled for this device.'
            : 'Profile and saves stay local on this device until you turn on cross-device sync.'
        }
      >
        {context.serverSyncEnabled ? 'Sync on' : 'Local-only'}
      </ContextChip>,
    );

    return items;
  }, [
    context.approximateCity,
    context.hasProfileIdentity,
    context.interestCount,
    context.savedCount,
    context.serverSyncEnabled,
  ]);

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-page)]/80">
      <div className="container mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <ContextChip
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            title="Verified records only. Approximate location by default. Profile details are private to your ORAN experience."
          >
            Verified records. Private by default.
          </ContextChip>
          {primaryContext}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          {!context.hasPersonalization && !context.approximateCity && context.savedCount === 0 ? (
            <Link href="/profile" className="font-medium text-blue-700 hover:underline">
              Add preferences for better matches
            </Link>
          ) : (
            <Link href="/profile" className="font-medium text-blue-700 hover:underline">
              Review your seeker context
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default SeekerContextStrip;
