/**
 * Profile Page
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
import { User, MapPin, Trash2, Shield, Bookmark, MessageCircle, Settings, Globe, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';

const PREFS_KEY = 'oran:preferences';
const SAVED_KEY = 'oran:saved-service-ids';

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

/** Update HTML lang attribute for screen readers */
function updateHtmlLang(locale: string) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

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
        updateHtmlLang(serverLocale);
      } else {
        // Not authenticated — use localStorage values and update HTML lang
        const localPrefs = readPrefs();
        updateHtmlLang(localPrefs.language ?? 'en');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveCity = useCallback(() => {
    const trimmed = city.trim();
    const updated = { ...prefs, approximateCity: trimmed || undefined };
    setPrefs(updated);
    writePrefs(updated);
    // Sync to server (best-effort)
    void updateServerProfile({ approximateCity: trimmed || undefined });
    setStatusMessage(trimmed ? 'Location saved.' : 'Location cleared.');
    setTimeout(() => setStatusMessage(null), 3000);
  }, [city, prefs]);

  const saveLanguage = useCallback((code: string) => {
    setLanguage(code);
    const updated = { ...prefs, language: code };
    setPrefs(updated);
    writePrefs(updated);
    updateHtmlLang(code);
    // Sync to server (best-effort)
    void updateServerProfile({ preferredLocale: code });
    setStatusMessage(`Language set to ${LANGUAGE_OPTIONS.find((l) => l.code === code)?.label ?? code}.`);
    setTimeout(() => setStatusMessage(null), 3000);
  }, [prefs]);

  const deleteAllData = useCallback(() => {
    localStorage.removeItem(PREFS_KEY);
    localStorage.removeItem(SAVED_KEY);
    setPrefs({});
    setCity('');
    setLanguage('en');
    setSavedCount(0);
    setShowDeleteConfirm(false);
    updateHtmlLang('en');
    setStatusMessage('All local data deleted.');
    setTimeout(() => setStatusMessage(null), 3000);
  }, []);

  const openDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(true);
    // Focus the confirm button after it renders
    setTimeout(() => confirmBtnRef.current?.focus(), 0);
  }, []);

  return (
    <main className="container mx-auto max-w-lg px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
          <User className="h-6 w-6 text-blue-600" aria-hidden="true" />
          Profile
        </h1>
        <p className="text-gray-600 text-sm">
          All preferences stay on your device. Nothing is shared without your consent.
        </p>
      </div>

      <ErrorBoundary>
        {/* Status announcements */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {statusMessage}
        </div>
        {statusMessage && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
            {statusMessage}
          </div>
        )}

        <div className="space-y-6">
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
            <div className="flex gap-2">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g., Austin, TX"
              className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                aria-label="Approximate city or region"
              />
              <Button type="button" size="sm" onClick={saveCity}>
                Save
              </Button>
            </div>
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
              Choose a preferred language for search results and chat. This preference
              stays on your device only.
            </p>
            <select
              value={language}
              onChange={(e) => saveLanguage(e.target.value)}
              className="w-full sm:w-64 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              aria-label="Preferred language"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>{opt.label}</option>
              ))}
            </select>
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

          {/* ── Privacy & security ────────────────────────── */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-gray-900">Privacy & data</h2>
            </div>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
                No device location is requested without your action.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
                Preferences and bookmarks stay in your browser&apos;s local storage.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
                Chat sessions do not record personally identifying information.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
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
                <a
                  href="/api/auth/signout"
                  className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:underline"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </a>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-3">
                  Sign in to sync bookmarks across devices, provide feedback on services,
                  and access your search history.
                </p>
                <a href="/api/auth/signin?callbackUrl=/profile">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5">
                    <User className="h-4 w-4" aria-hidden="true" />
                    Sign in with Microsoft
                  </Button>
                </a>
              </>
            )}
          </section>

          {/* ── Delete data ───────────────────────────────── */}
          <section className="rounded-lg border border-red-100 bg-red-50/50 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Trash2 className="h-4 w-4 text-red-500" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-gray-900">Delete all local data</h2>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              This permanently removes your preferences, saved services, and any other
              ORAN data from this browser. This cannot be undone.
            </p>
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

        {/* ── Navigation escape hatches ───────────────────── */}
        <div className="mt-8 text-center">
          <Link href="/chat" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Find services
          </Link>
        </div>
      </ErrorBoundary>
    </main>
  );
}
