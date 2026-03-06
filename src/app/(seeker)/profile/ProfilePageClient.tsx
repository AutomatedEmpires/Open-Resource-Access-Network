/**
 * Profile Page
 *
 * Enhanced with FormField, FormAlert, toast notifications.
 *
 * Privacy-first design:
 * - No data collection without explicit consent
 * - Location is ALWAYS approximate (city-level at best)
 * - Clear path to delete all saved data
 * - All preferences stored in localStorage until sign-in + consent
 *
 * If authenticated, syncs with server-side profile via /api/profile.
 */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { User, MapPin, Trash2, Shield, Bookmark, Settings, Globe, LogOut, CheckCircle, Bell, Sun, Moon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/toast';
import type { NotificationChannel, NotificationEventType } from '@/domain/types';

const PREFS_KEY = 'oran:preferences';
const SAVED_KEY = 'oran:saved-service-ids';
const THEME_KEY = 'oran-theme';

interface Preferences {
  /** Approximate city name — manually entered, never geolocated without consent */
  approximateCity?: string;
  /** Preferred language code */
  language?: string;
}

interface ServerProfile {
  userId: string;
  preferredLocale: string | null;
  approximateCity: string | null;
}

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'ko', label: '한국어' },
  { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' },
  { code: 'ht', label: 'Kreyòl Ayisyen' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
];

function readPrefs(): Preferences {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Preferences) : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs: Preferences) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* quota exceeded */
  }
}

/** Fetch server-side profile (returns null if not authenticated) */
async function fetchServerProfile(): Promise<ServerProfile | null> {
  try {
    const res = await fetch('/api/profile', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const json = (await res.json()) as { profile: ServerProfile | null };
    return json.profile;
  } catch {
    return null;
  }
}

/** Update server-side profile (best-effort) */
async function updateServerProfile(data: { approximateCity?: string; preferredLocale?: string }): Promise<void> {
  try {
    await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    // Best-effort, ignore errors
  }
}

// ============================================================
// NOTIFICATION PREFERENCES SECTION
// ============================================================

const EVENT_TYPE_LABELS: Record<string, string> = {
  submission_assigned:          'Submission assigned to you',
  submission_status_changed:    'Submission status changed',
  submission_sla_warning:       'SLA deadline approaching',
  submission_sla_breach:        'SLA deadline breached',
  scope_grant_requested:        'Scope grant requested',
  scope_grant_decided:          'Scope grant decided',
  scope_grant_revoked:          'Scope grant revoked',
  two_person_approval_needed:   'Two-person approval needed',
  system_alert:                 'System alerts',
};

interface PrefRow {
  eventType: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
}

function NotificationPreferencesSection() {
  const [prefs, setPrefs] = useState<PrefRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/notifications/preferences');
        if (!res.ok) return;
        const json = (await res.json()) as { preferences: PrefRow[] };
        if (!cancelled) setPrefs(json.preferences);
      } catch {
        // Best-effort
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = useCallback(async (eventType: NotificationEventType, channel: NotificationChannel, enabled: boolean) => {
    // Optimistic update
    setPrefs(prev => {
      const existing = prev.find(p => p.eventType === eventType && p.channel === channel);
      if (existing) {
        return prev.map(p => p.eventType === eventType && p.channel === channel ? { ...p, enabled } : p);
      }
      return [...prev, { eventType, channel, enabled }];
    });

    setIsSaving(true);
    try {
      const res = await fetch('/api/user/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: [{ eventType, channel, enabled }] }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast('success', `Notification ${enabled ? 'enabled' : 'disabled'}`);
    } catch {
      // Revert
      setPrefs(prev => prev.map(p =>
        p.eventType === eventType && p.channel === channel ? { ...p, enabled: !enabled } : p
      ));
      toast('error', 'Failed to save notification preference');
    } finally {
      setIsSaving(false);
    }
  }, [toast]);

  const isEnabled = (eventType: string, channel: string): boolean => {
    const pref = prefs.find(p => p.eventType === eventType && p.channel === channel);
    return pref?.enabled ?? true; // Default to enabled
  };

  const eventTypes = Object.keys(EVENT_TYPE_LABELS) as NotificationEventType[];

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="h-4 w-4 text-gray-500" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-gray-900">Notification preferences</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Choose which notifications you receive. Changes save automatically.
      </p>
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading preferences…</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr,auto,auto] gap-x-4 gap-y-1 items-center text-xs text-gray-500 font-medium border-b border-gray-100 pb-2">
            <span>Event</span>
            <span className="text-center w-14">In-App</span>
            <span className="text-center w-14">Email</span>
          </div>
          {eventTypes.map(et => (
            <div key={et} className="grid grid-cols-[1fr,auto,auto] gap-x-4 gap-y-1 items-center py-1">
              <span className="text-sm text-gray-700">{EVENT_TYPE_LABELS[et]}</span>
              <div className="flex justify-center w-14">
                <input
                  type="checkbox"
                  checked={isEnabled(et, 'in_app')}
                  onChange={(e) => void toggle(et, 'in_app', e.target.checked)}
                  disabled={isSaving}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  aria-label={`${EVENT_TYPE_LABELS[et]} in-app notifications`}
                />
              </div>
              <div className="flex justify-center w-14">
                <input
                  type="checkbox"
                  checked={isEnabled(et, 'email')}
                  onChange={(e) => void toggle(et, 'email', e.target.checked)}
                  disabled={isSaving}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  aria-label={`${EVENT_TYPE_LABELS[et]} email notifications`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ProfilePage() {
  const [prefs, setPrefs] = useState<Preferences>(readPrefs);
  const [savedCount, setSavedCount] = useState(() => {
    if (typeof window === 'undefined') return 0;
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw) {
        const ids = JSON.parse(raw) as unknown;
        if (Array.isArray(ids)) return ids.length;
      }
    } catch {
      /* no-op */
    }
    return 0;
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [city, setCity] = useState(() => readPrefs().approximateCity ?? '');
  const [language, setLanguage] = useState(() => readPrefs().language ?? 'en');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === 'dark' || (saved === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch {
      return false;
    }
  });
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const { toast } = useToast();

  // Fetch server profile on mount and merge with localStorage
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const serverProfile = await fetchServerProfile();
      if (cancelled) return;

      if (serverProfile) {
        setIsAuthenticated(true);
        // Server wins over localStorage for display
        const serverCity = serverProfile.approximateCity ?? '';
        const serverLocale = serverProfile.preferredLocale ?? 'en';

        setCity(serverCity);
        setLanguage(serverLocale);

        // Update localStorage with server values
        const merged = {
          approximateCity: serverCity || undefined,
          language: serverLocale,
        };
        setPrefs(merged);
        writePrefs(merged);
      }
      // Not authenticated: localStorage values already loaded via readPrefs() initialiser
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleTheme = useCallback((dark: boolean) => {
    setIsDark(dark);
    try {
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // localStorage unavailable
    }
  }, []);

  const saveCity = useCallback(() => {
    const trimmed = city.trim();
    const updated = { ...prefs, approximateCity: trimmed || undefined };
    setPrefs(updated);
    writePrefs(updated);
    // Sync to server (best-effort)
    void updateServerProfile({ approximateCity: trimmed || undefined });
    toast('success', trimmed ? 'Location saved.' : 'Location cleared.');
  }, [city, prefs, toast]);

  const saveLanguage = useCallback((code: string) => {
    setLanguage(code);
    const updated = { ...prefs, language: code };
    setPrefs(updated);
    writePrefs(updated);
    // Sync to server (best-effort)
    void updateServerProfile({ preferredLocale: code });
    toast('success', `Language set to ${LANGUAGE_OPTIONS.find((l) => l.code === code)?.label ?? code}.`);
  }, [prefs, toast]);

  const deleteAllData = useCallback(async () => {
    // Delete server-side data if authenticated
    if (isAuthenticated) {
      try {
        const res = await fetch('/api/user/data-delete', { method: 'DELETE' });
        if (!res.ok) {
          toast('error', 'Failed to delete server data. Please try again.');
          return;
        }
      } catch {
        toast('error', 'Failed to delete server data. Please try again.');
        return;
      }
    }

    // Clear local data
    localStorage.removeItem(PREFS_KEY);
    localStorage.removeItem(SAVED_KEY);
    setPrefs({});
    setCity('');
    setLanguage('en');
    setSavedCount(0);
    setShowDeleteConfirm(false);
    toast('success', 'All data deleted.');
  }, [toast, isAuthenticated]);

  const openDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(true);
    // Focus the confirm button after it renders
    setTimeout(() => confirmBtnRef.current?.focus(), 0);
  }, []);

  return (
    <main className="container mx-auto max-w-2xl px-4 py-8">
      <PageHeader
        title="Profile"
        icon={<User className="h-6 w-6" aria-hidden="true" />}
        subtitle="Preferences stay on your device. Nothing is shared without your consent."
      />

      <ErrorBoundary>
        <div className="space-y-6">
          {/* ── Display preference ────────────────────────── */}
          <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center gap-2 mb-3">
              {isDark ? (
                <Moon className="h-4 w-4 text-gray-500" aria-hidden="true" />
              ) : (
                <Sun className="h-4 w-4 text-gray-500" aria-hidden="true" />
              )}
              <h2 className="text-sm font-semibold text-gray-900">Display</h2>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Choose light or dark mode. This preference stays on your device only.
            </p>
            <div className="flex gap-2" role="group" aria-label="Color theme">
              <button
                type="button"
                onClick={() => toggleTheme(false)}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm min-h-[44px] transition-colors ${
                  !isDark
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
                aria-pressed={!isDark}
              >
                <Sun className="h-4 w-4" aria-hidden="true" />
                Light
              </button>
              <button
                type="button"
                onClick={() => toggleTheme(true)}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm min-h-[44px] transition-colors ${
                  isDark
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
                aria-pressed={isDark}
              >
                <Moon className="h-4 w-4" aria-hidden="true" />
                Dark
              </button>
            </div>
          </section>

          {/* ── Approximate location ──────────────────────── */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-gray-900">Approximate location</h2>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Enter a city or region to improve search results. ORAN never requests precise
              GPS location. This value stays on your device only.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); saveCity(); }} className="flex gap-2">
              <FormField label="City or region" htmlFor="approx-city" srOnlyLabel>
                <input
                  id="approx-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g., Austin, TX"
                  className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                />
              </FormField>
              <Button type="submit" size="sm">
                Save
              </Button>
            </form>
            {prefs.approximateCity && (
              <p className="mt-2 text-xs text-gray-500">
                Saved: <span className="font-medium text-gray-700">{prefs.approximateCity}</span> (approximate)
              </p>
            )}
          </section>

          {/* ── Language preference ───────────────────────── */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-gray-900">Preferred language</h2>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Choose your preferred language. This preference stays on your device only.
            </p>
            <FormField label="Language" htmlFor="pref-language" srOnlyLabel>
              <select
                id="pref-language"
                value={language}
                onChange={(e) => saveLanguage(e.target.value)}
                className="w-full sm:w-64 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                ))}
              </select>
            </FormField>
            <p className="mt-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-1 inline-block">
              Display language only — full UI translation coming soon.
            </p>
          </section>

          {/* ── Saved services summary ────────────────────── */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <Bookmark className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-gray-900">Saved services</h2>
            </div>
            <p className="text-sm text-gray-600">
              {savedCount > 0
                ? `${savedCount} service${savedCount > 1 ? 's' : ''} bookmarked on this device.`
                : 'No saved services yet.'}
            </p>
            {savedCount > 0 && (
              <Link
                href="/saved"
                className="inline-block mt-2 text-sm text-blue-600 hover:underline"
              >
                View saved services →
              </Link>
            )}
          </section>

          {/* ── Notification preferences ─────────────────── */}
          {isAuthenticated && <NotificationPreferencesSection />}

          {/* ── Privacy & security ────────────────────────── */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-gray-900">Privacy & data</h2>
            </div>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                No device location is requested without your action.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                Preferences and bookmarks stay in your browser&apos;s local storage.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                Chat sessions do not record personally identifying information.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                You can delete all local data at any time.
              </li>
            </ul>
          </section>

          {/* ── Authentication placeholder ────────────────── */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <Settings className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-gray-900">Account</h2>
            </div>
            {isAuthenticated ? (
              <>
                <p className="text-sm text-gray-600 mb-3">
                  You are signed in. Your preferences are syncing across devices.
                </p>
                <Link
                  href="/api/auth/signout"
                  className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:underline"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-3">
                  Sign in to sync bookmarks across devices, provide feedback on services,
                  and access your search history.
                </p>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <Link href="/api/auth/signin?callbackUrl=/profile">
                    <User className="h-4 w-4" aria-hidden="true" />
                    Sign in with Microsoft
                  </Link>
                </Button>
              </>
            )}
          </section>

          {/* ── Delete data ───────────────────────────────── */}
          <section className="rounded-lg border border-red-100 bg-red-50/50 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Trash2 className="h-4 w-4 text-red-500" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-gray-900">Delete all data</h2>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              {isAuthenticated
                ? 'This permanently removes all your data from ORAN — including server-side profile, saved services, notifications, and local preferences. This cannot be undone.'
                : 'This permanently removes your preferences, saved services, and any other ORAN data from this browser. This cannot be undone.'}
            </p>
            {isAuthenticated && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 mb-3">
                We recommend{' '}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/user/data-export', { method: 'POST' });
                      if (res.ok) {
                        const data = await res.json();
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `oran-data-export-${Date.now()}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast('success', 'Data export downloaded.');
                      } else {
                        toast('error', 'Failed to export data.');
                      }
                    } catch {
                      toast('error', 'Failed to export data.');
                    }
                  }}
                  className="underline font-medium text-amber-800 hover:text-amber-900"
                >
                  downloading your data
                </button>
                {' '}before deleting.
              </p>
            )}
            {!showDeleteConfirm ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openDeleteConfirm}
                className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete my data
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  ref={confirmBtnRef}
                  onClick={deleteAllData}
                  className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
                >
                  Confirm delete
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </section>
        </div>

      </ErrorBoundary>
    </main>
  );
}
