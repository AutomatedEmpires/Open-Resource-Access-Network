/**
 * Profile Page — Enhanced Seeker Profile
 *
 * A world-class, organized, AI-context-aware profile that agents review
 * to surface relevant services in chat, map, and directory.
 *
 * Privacy-first design:
 * - All data stored in localStorage only (no PII in logs)
 * - Location is ALWAYS approximate (city-level)
 * - Explicit consent before server sync
 * - One-click delete of all data
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  User, MapPin, Globe, Sun, Moon, Bell, Shield, Bookmark,
  ChevronDown, ChevronUp, CheckCircle, Sparkles, Heart,
  Phone, Mail, Info,
  UserCheck, Star, Trash2, LogOut, AlertCircle,
} from 'lucide-react';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormSection } from '@/components/ui/form-section';
import { useToast } from '@/components/ui/toast';
import { DISCOVERY_NEEDS } from '@/domain/discoveryNeeds';
import type { NotificationChannel, NotificationEventType } from '@/domain/types';
import {
  ACCENT_THEME_VALUES,
  EMPTY_SEEKER_PROFILE,
  hasMeaningfulSeekerProfile,
  normalizeSeekerProfile,
  type AccessibilityNeedId,
  type AgeGroupId,
  type CurrentServiceId,
  type DeliveryModeId,
  type DocumentationBarrierId,
  type HouseholdTypeId,
  type HousingSituationId,
  type SelfIdentifierId,
  type ServiceInterestId,
  type SeekerProfile,
  type UrgencyWindowId,
} from '@/services/profile/contracts';
import { buildSeekerDiscoveryProfile } from '@/services/profile/discoveryProfile';
import {
  clearStoredProfilePreferences,
  readStoredProfilePreferences,
  resolveProfileSyncConsent,
  writeStoredProfilePreferences,
  type ProfilePreferences as Preferences,
} from '@/services/profile/syncPreference';
import {
  clearStoredSeekerProfile,
  readStoredSeekerProfile,
  writeStoredSeekerProfile,
} from '@/services/profile/clientContext';
import {
  readStoredSavedServiceCount,
  SAVED_SERVICES_UPDATED_EVENT,
  writeStoredSavedServiceIds,
} from '@/services/saved/client';
import { buildDiscoveryHref } from '@/services/search/discovery';

// ============================================================
// STORAGE KEYS
// ============================================================
const THEME_KEY = 'oran-theme';

interface AccountProfile {
  displayName: string;
  email: string;
  phone: string;
  authProvider: string;
}

type SeekerContext = SeekerProfile;

const DEFAULT_SEEKER_CONTEXT: SeekerContext = { ...EMPTY_SEEKER_PROFILE };

interface ServerProfile {
  userId: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  authProvider?: string | null;
  preferredLocale: string | null;
  approximateCity: string | null;
  seekerProfile: SeekerContext | null;
}

function hasMeaningfulServerProfile(profile: ServerProfile | null): boolean {
  if (!profile) return false;

  return Boolean(
    profile.displayName?.trim() ||
    profile.phone?.trim() ||
    profile.preferredLocale?.trim() ||
    profile.approximateCity?.trim() ||
    hasMeaningfulSeekerProfile(profile.seekerProfile),
  );
}

// ============================================================
// PROFILE DATA CONSTANTS
// ============================================================
const SERVICE_INTEREST_OPTIONS: ReadonlyArray<{ id: ServiceInterestId; label: string; icon: string; color: string }> =
  DISCOVERY_NEEDS.map((need) => ({
    id: need.id,
    label: need.label,
    icon: need.icon,
    color: need.profileColorClass,
  }));

const AGE_GROUP_OPTIONS: ReadonlyArray<{ id: AgeGroupId; label: string }> = [
  { id: 'under18', label: 'Under 18' },
  { id: '18_24', label: '18–24' },
  { id: '25_54', label: '25–54' },
  { id: '55_64', label: '55–64' },
  { id: '65plus', label: '65 or older' },
  { id: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const HOUSEHOLD_TYPE_OPTIONS: ReadonlyArray<{ id: HouseholdTypeId; label: string }> = [
  { id: 'single', label: 'Single adult' },
  { id: 'couple', label: 'Couple / partners' },
  { id: 'family_with_children', label: 'Family with children' },
  { id: 'single_parent', label: 'Single parent' },
  { id: 'multigenerational', label: 'Multigenerational household' },
  { id: 'other', label: 'Other' },
];

const HOUSING_SITUATION_OPTIONS: ReadonlyArray<{ id: HousingSituationId; label: string }> = [
  { id: 'housed_stable', label: 'Stably housed' },
  { id: 'at_risk', label: 'At risk of housing loss' },
  { id: 'unhoused', label: 'Currently unhoused' },
  { id: 'shelter', label: 'In shelter or transitional housing' },
  { id: 'couch_surfing', label: 'Staying with others temporarily' },
];

const SELF_IDENTIFIER_OPTIONS: ReadonlyArray<{ id: SelfIdentifierId; label: string; group: string }> = [
  { id: 'veteran', label: 'Veteran', group: 'identity' },
  { id: 'senior_65plus', label: 'Senior (65+)', group: 'identity' },
  { id: 'disability', label: 'Person with disability', group: 'identity' },
  { id: 'pregnant', label: 'Pregnant', group: 'identity' },
  { id: 'new_parent', label: 'New parent / postpartum', group: 'identity' },
  { id: 'caregiver', label: 'Caregiver', group: 'identity' },
  { id: 'dv_survivor', label: 'DV / trauma survivor', group: 'identity' },
  { id: 'reentry', label: 'Reentry (post-incarceration)', group: 'identity' },
  { id: 'undocumented_friendly', label: 'Seeking undocumented-friendly services', group: 'identity' },
  { id: 'lgbtq', label: 'LGBTQ+', group: 'identity' },
  { id: 'refugee', label: 'Refugee / asylum seeker', group: 'identity' },
];

const CURRENT_SERVICES_OPTIONS: ReadonlyArray<{ id: CurrentServiceId; label: string }> = [
  { id: 'snap', label: 'SNAP (food stamps)' },
  { id: 'medicaid', label: 'Medicaid / Medi-Cal' },
  { id: 'medicare', label: 'Medicare' },
  { id: 'wic', label: 'WIC' },
  { id: 'section8', label: 'Section 8 / Housing voucher' },
  { id: 'ssi_ssdi', label: 'SSI / SSDI' },
  { id: 'tanf', label: 'TANF / Cash assistance' },
  { id: 'chip', label: "CHIP (children's health)" },
  { id: 'va_benefits', label: 'VA benefits' },
  { id: 'head_start', label: 'Head Start / Early Head Start' },
  { id: 'liheap', label: 'LIHEAP (energy assistance)' },
];

const ACCESSIBILITY_OPTIONS: ReadonlyArray<{ id: AccessibilityNeedId; label: string }> = [
  { id: 'wheelchair_access', label: 'Wheelchair accessible' },
  { id: 'hearing_support', label: 'Hearing support / captions' },
  { id: 'vision_support', label: 'Large print / low-vision support' },
  { id: 'language_interpretation', label: 'Language interpretation' },
  { id: 'quiet_space', label: 'Low-sensory / quiet space' },
  { id: 'child_friendly', label: 'Child-friendly appointments' },
  { id: 'virtual_option', label: 'Virtual-first options' },
  { id: 'evening_hours', label: 'Evening or weekend hours' },
];

const PREFERRED_DELIVERY_OPTIONS: ReadonlyArray<{ id: DeliveryModeId; label: string }> = [
  { id: 'in_person', label: 'In person' },
  { id: 'virtual', label: 'Video / online' },
  { id: 'phone', label: 'Phone call' },
  { id: 'hybrid', label: 'Flexible / hybrid' },
];

const URGENCY_WINDOW_OPTIONS: ReadonlyArray<{ id: UrgencyWindowId; label: string }> = [
  { id: 'same_day', label: 'Need help today' },
  { id: 'next_day', label: 'Need help in 1-2 days' },
  { id: 'flexible', label: 'Timing is flexible' },
];

const DOCUMENTATION_BARRIER_OPTIONS: ReadonlyArray<{ id: DocumentationBarrierId; label: string }> = [
  { id: 'no_id', label: 'No ID available' },
  { id: 'no_documents', label: 'Missing required documents' },
  { id: 'no_ssn', label: 'Cannot provide SSN' },
];

const AVATAR_OPTIONS = [
  { id: '🙂', label: '🙂 Warm' },
  { id: '🌟', label: '🌟 Bright' },
  { id: '🌿', label: '🌿 Calm' },
  { id: '💪', label: '💪 Strong' },
  { id: '🦋', label: '🦋 Fresh start' },
  { id: '🧭', label: '🧭 Focused' },
] as const;

const ACCENT_THEME_OPTIONS: Array<{
  id: (typeof ACCENT_THEME_VALUES)[number];
  label: string;
  previewClass: string;
  cardClass: string;
  progressClass: string;
  textClass: string;
}> = [
  { id: 'ocean', label: 'Petal', previewClass: 'bg-rose-400', cardClass: 'border-rose-100 bg-gradient-to-r from-rose-50 to-orange-50', progressClass: 'bg-rose-400', textClass: 'text-rose-900' },
  { id: 'blossom', label: 'Blossom', previewClass: 'bg-pink-500', cardClass: 'border-pink-100 bg-gradient-to-r from-pink-50 to-rose-50', progressClass: 'bg-pink-500', textClass: 'text-pink-900' },
  { id: 'forest', label: 'Meadow', previewClass: 'bg-emerald-500', cardClass: 'border-emerald-100 bg-gradient-to-r from-emerald-50 to-lime-50', progressClass: 'bg-emerald-500', textClass: 'text-emerald-900' },
  { id: 'sunset', label: 'Sunrise', previewClass: 'bg-orange-400', cardClass: 'border-orange-100 bg-gradient-to-r from-orange-50 to-amber-50', progressClass: 'bg-orange-400', textClass: 'text-orange-900' },
  { id: 'midnight', label: 'Hearth', previewClass: 'bg-amber-500', cardClass: 'border-amber-100 bg-gradient-to-r from-amber-50 to-rose-50', progressClass: 'bg-amber-500', textClass: 'text-amber-900' },
];

const AUTH_PROVIDER_LABELS: Record<string, string> = {
  'azure-ad': 'Microsoft Entra ID',
  google: 'Google',
  credentials: 'Email + password',
};

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

function readSeekerContext(): SeekerContext {
  return readStoredSeekerProfile();
}

function writeSeekerContext(ctx: SeekerContext) {
  writeStoredSeekerProfile(ctx);
}

async function fetchServerProfile(): Promise<ServerProfile | null> {
  try {
    const res = await fetch('/api/profile', { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = (await res.json()) as { profile: ServerProfile | null };
    return json.profile;
  } catch { return null; }
}

async function updateServerProfile(data: {
  approximateCity?: string;
  preferredLocale?: string;
  displayName?: string;
  phone?: string;
  seekerProfile?: SeekerContext;
}) {
  try {
    await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch { /* best-effort */ }
}

// ============================================================
// PROFILE STRENGTH CALCULATOR
// ============================================================
function calcProfileStrength(ctx: SeekerContext, city: string): { score: number; max: number; label: string } {
  let score = 0;
  const max = 9;
  if (city.trim()) score++;
  if (ctx.serviceInterests.length > 0) score++;
  if (ctx.ageGroup) score++;
  if (ctx.householdType) score++;
  if (ctx.selfIdentifiers.length > 0 || ctx.currentServices.length > 0) score++;
  if (ctx.accessibilityNeeds.length > 0) score++;
  if (ctx.transportationBarrier || ctx.preferredDeliveryModes.length > 0 || ctx.urgencyWindow || ctx.documentationBarriers.length > 0 || ctx.digitalAccessBarrier) score++;
  if (ctx.profileHeadline.trim() || ctx.pronouns.trim() || ctx.avatarEmoji.trim()) score++;
  if (ctx.additionalContext.trim().length > 10) score++;
  const pct = Math.round((score / max) * 100);
  const label = pct < 34 ? 'Basic' : pct < 67 ? 'Good' : pct < 100 ? 'Strong' : 'Complete';
  return { score, max, label };
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

interface SectionProps {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  accentColor: string;
  badge?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function CollapsibleSection({ id, title, subtitle, icon, accentColor, badge, isOpen, onToggle, children }: SectionProps) {
  const headingId = `section-${id}-heading`;
  const subtitleId = subtitle ? `section-${id}-subtitle` : undefined;

  return (
    <FormSection
      className="overflow-hidden border border-orange-100/80 bg-white/90 p-0 shadow-sm transition-shadow hover:shadow-md"
      contentClassName="border-t border-orange-100 px-5 pb-5 pt-4"
      header={
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-orange-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          aria-expanded={isOpen}
          aria-controls={`section-${id}-body`}
        >
          <div className={`flex-none flex items-center justify-center w-9 h-9 rounded-lg ${accentColor} text-white`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span id={headingId} className="font-semibold text-stone-900 text-sm">{title}</span>
              {badge && (
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  {badge}
                </span>
              )}
            </div>
            {subtitle && <p id={subtitleId} className="mt-0.5 truncate text-xs text-stone-500">{subtitle}</p>}
          </div>
          <div className="flex-none text-stone-400">
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </button>
      }
      labelledBy={headingId}
      describedBy={subtitleId}
    >
      {isOpen ? <div id={`section-${id}-body`}>{children}</div> : null}
    </FormSection>
  );
}

interface PillButtonProps {
  label: string;
  icon?: string;
  selected: boolean;
  onToggle: () => void;
  colorClass?: string;
}

function PillButton({ label, icon, selected, onToggle, colorClass }: PillButtonProps) {
  const base = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400';
  const active = colorClass
    ? `${colorClass} border-current shadow-sm`
    : 'border-orange-500 bg-orange-500 text-white shadow-sm';
  const inactive = 'border-orange-100 bg-white text-stone-700 hover:border-orange-200 hover:bg-orange-50';

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`${base} ${selected ? active : inactive}`}
      aria-pressed={selected}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
      {selected && !icon && <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

interface RadioPillGroupProps {
  options: ReadonlyArray<{ id: string; label: string }>;
  selected: string;
  onChange: (id: string) => void;
  name: string;
}

function RadioPillGroup({ options, selected, onChange, name }: RadioPillGroupProps) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={name}>
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={selected === opt.id}
          onClick={() => onChange(selected === opt.id ? '' : opt.id)}
          className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${
            selected === opt.id
              ? 'border-orange-500 bg-orange-500 text-white shadow-sm'
              : 'border-orange-100 bg-white text-stone-700 hover:border-orange-200 hover:bg-orange-50'
          }`}
        >
          {selected === opt.id && <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// NOTIFICATION SECTION (admin-facing)
// ============================================================
const EVENT_TYPE_LABELS: Record<string, string> = {
  submission_assigned: 'Submission assigned to you',
  submission_status_changed: 'Submission status changed',
  submission_sla_warning: 'SLA deadline approaching',
  submission_sla_breach: 'SLA deadline breached',
  scope_grant_requested: 'Scope grant requested',
  scope_grant_decided: 'Scope grant decided',
  scope_grant_revoked: 'Scope grant revoked',
  two_person_approval_needed: 'Two-person approval needed',
  system_alert: 'System alerts',
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
    void (async () => {
      try {
        const res = await fetch('/api/user/notifications/preferences');
        if (!res.ok) return;
        const json = (await res.json()) as { preferences: PrefRow[] };
        if (!cancelled) setPrefs(json.preferences);
      } catch { /* best-effort */ }
      finally { if (!cancelled) setIsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = useCallback(async (eventType: NotificationEventType, channel: NotificationChannel, enabled: boolean) => {
    setPrefs(prev => {
      const existing = prev.find(p => p.eventType === eventType && p.channel === channel);
      if (existing) return prev.map(p => p.eventType === eventType && p.channel === channel ? { ...p, enabled } : p);
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
      setPrefs(prev => prev.map(p => p.eventType === eventType && p.channel === channel ? { ...p, enabled: !enabled } : p));
      toast('error', 'Failed to save notification preference');
    } finally { setIsSaving(false); }
  }, [toast]);

  const isEnabled = (eventType: string, channel: string): boolean =>
    prefs.find(p => p.eventType === eventType && p.channel === channel)?.enabled ?? true;

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">Choose which notifications you receive. Changes save automatically.</p>
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="min-w-80 space-y-1">
            <div className="grid grid-cols-[1fr,auto,auto] gap-x-4 text-xs text-gray-500 font-medium border-b border-gray-100 pb-2 mb-1">
              <span>Event</span>
              <span className="text-center w-14">In-App</span>
              <span className="text-center w-14">Email</span>
            </div>
            {(Object.keys(EVENT_TYPE_LABELS) as NotificationEventType[]).map(et => (
              <div key={et} className="grid grid-cols-[1fr,auto,auto] gap-x-4 items-center py-1.5">
                <span className="text-sm text-gray-700">{EVENT_TYPE_LABELS[et]}</span>
                <div className="flex justify-center w-14">
                  <input type="checkbox" checked={isEnabled(et, 'in_app')}
                    onChange={e => void toggle(et, 'in_app', e.target.checked)} disabled={isSaving}
                    className="h-5 w-5 rounded border-orange-200 text-orange-500 focus:ring-orange-400"
                    aria-label={`${EVENT_TYPE_LABELS[et]} in-app notifications`} />
                </div>
                <div className="flex justify-center w-14">
                  <input type="checkbox" checked={isEnabled(et, 'email')}
                    onChange={e => void toggle(et, 'email', e.target.checked)} disabled={isSaving}
                    className="h-5 w-5 rounded border-orange-200 text-orange-500 focus:ring-orange-400"
                    aria-label={`${EVENT_TYPE_LABELS[et]} email notifications`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN PAGE COMPONENT
// ============================================================
export default function ProfilePage() {
  // ── State ──────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<Preferences>(() => readStoredProfilePreferences());
  const [seeker, setSeeker] = useState<SeekerContext>(() => readSeekerContext());
  const [account, setAccount] = useState<AccountProfile>({
    displayName: '',
    email: '',
    phone: '',
    authProvider: '',
  });
  const [city, setCity] = useState(() => readStoredProfilePreferences().approximateCity ?? '');
  const [language, setLanguage] = useState(() => readStoredProfilePreferences().language ?? 'en');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasLoadedServerProfile, setHasLoadedServerProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [savedCount, setSavedCount] = useState(() => readStoredSavedServiceCount());
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === 'dark' || (saved === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch { return false; }
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Track which sections are open
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(['services', 'aboutme', 'constraints', 'identity', 'location', 'language', 'display', 'saved', 'privacy'])
  );

  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const shouldSkipNextSeekerSyncRef = useRef(true);
  const { toast } = useToast();
  const discoveryProfile = useMemo(() => buildSeekerDiscoveryProfile(seeker, { locale: language }), [language, seeker]);
  const isServerSyncEnabled = isAuthenticated && prefs.serverSyncEnabled === true;
  const browseDirectoryHref = useMemo(() => {
    return buildDiscoveryHref('/directory', discoveryProfile.browseState);
  }, [discoveryProfile.browseState]);
  const browseChatHref = useMemo(() => buildDiscoveryHref('/chat', discoveryProfile.browseState), [discoveryProfile.browseState]);
  const browseMapHref = useMemo(() => buildDiscoveryHref('/map', discoveryProfile.browseState), [discoveryProfile.browseState]);

  useEffect(() => {
    const refreshSavedCount = () => {
      setSavedCount(readStoredSavedServiceCount());
    };

    refreshSavedCount();
    window.addEventListener('storage', refreshSavedCount);
    window.addEventListener(SAVED_SERVICES_UPDATED_EVENT, refreshSavedCount as EventListener);

    return () => {
      window.removeEventListener('storage', refreshSavedCount);
      window.removeEventListener(SAVED_SERVICES_UPDATED_EVENT, refreshSavedCount as EventListener);
    };
  }, []);

  // ── Hydrate on mount ────────────────────────────────────────
  useEffect(() => {
    // Server profile
    void (async () => {
      const serverProfile = await fetchServerProfile();
      if (serverProfile) {
        const storedPrefs = readStoredProfilePreferences();
        const derivedServerSyncEnabled = resolveProfileSyncConsent(
          storedPrefs,
          hasMeaningfulServerProfile(serverProfile),
        );
        setIsAuthenticated(true);
        // Also open notifications and privacy sections for authenticated users
        setOpenSections(prev => new Set([...prev, 'notifications', 'privacy']));
        const sc = serverProfile.approximateCity ?? '';
        const sl = serverProfile.preferredLocale ?? 'en';
        setAccount({
          displayName: serverProfile.displayName ?? '',
          email: serverProfile.email ?? '',
          phone: serverProfile.phone ?? '',
          authProvider: serverProfile.authProvider ?? '',
        });
        setCity(sc);
        setLanguage(sl);
        const merged = {
          approximateCity: sc || undefined,
          language: sl,
          serverSyncEnabled: derivedServerSyncEnabled,
        };
        setPrefs(merged);
        writeStoredProfilePreferences(merged);

        if (serverProfile.seekerProfile && hasMeaningfulSeekerProfile(serverProfile.seekerProfile)) {
          const normalized = normalizeSeekerProfile(serverProfile.seekerProfile);
          setSeeker(normalized);
          writeSeekerContext(normalized);
        }
      }
      setHasLoadedServerProfile(true);
    })();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !hasLoadedServerProfile || !prefs.serverSyncEnabled) return;

    if (shouldSkipNextSeekerSyncRef.current) {
      shouldSkipNextSeekerSyncRef.current = false;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void updateServerProfile({ seekerProfile: seeker });
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [hasLoadedServerProfile, isAuthenticated, prefs.serverSyncEnabled, seeker]);

  // ── Section toggle ──────────────────────────────────────────
  const toggleSection = useCallback((id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  // ── Seeker context update ───────────────────────────────────
  const updateSeeker = useCallback(<K extends keyof SeekerContext>(key: K, value: SeekerContext[K]) => {
    setSeeker(prev => {
      const updated = { ...prev, [key]: value };
      writeSeekerContext(updated);
      return updated;
    });
  }, []);

  const toggleInArray = useCallback((key: 'serviceInterests' | 'selfIdentifiers' | 'currentServices' | 'preferredDeliveryModes' | 'documentationBarriers', id: string) => {
    setSeeker(prev => {
      const arr = prev[key] as string[];
      const updated = { ...prev, [key]: arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id] };
      writeSeekerContext(updated);
      return updated;
    });
  }, []);

  const toggleAccessibilityNeed = useCallback((id: AccessibilityNeedId) => {
    setSeeker(prev => {
      const next = prev.accessibilityNeeds.includes(id)
        ? prev.accessibilityNeeds.filter(item => item !== id)
        : [...prev.accessibilityNeeds, id];
      const updated = { ...prev, accessibilityNeeds: next };
      writeSeekerContext(updated);
      return updated;
    });
  }, []);

  // ── Location save ───────────────────────────────────────────
  const saveCity = useCallback(() => {
    const trimmed = city.trim();
    const updated = { ...prefs, approximateCity: trimmed || undefined };
    setPrefs(updated);
    writeStoredProfilePreferences(updated);
    if (isServerSyncEnabled) {
      void updateServerProfile({ approximateCity: trimmed || undefined });
    }
    toast(
      'success',
      trimmed
        ? isServerSyncEnabled
          ? `Location set to ${trimmed} and syncing across devices`
          : `Location set to ${trimmed} on this device`
        : isServerSyncEnabled
          ? 'Location cleared and syncing across devices'
          : 'Location cleared from this device',
    );
  }, [city, isServerSyncEnabled, prefs, toast]);

  // ── Language save ───────────────────────────────────────────
  const saveLanguage = useCallback((code: string) => {
    setLanguage(code);
    const updated = { ...prefs, language: code };
    setPrefs(updated);
    writeStoredProfilePreferences(updated);
    if (isServerSyncEnabled) {
      void updateServerProfile({ preferredLocale: code });
    }
    toast(
      'success',
      isServerSyncEnabled
        ? `Language set to ${LANGUAGE_OPTIONS.find(l => l.code === code)?.label ?? code} and syncing across devices`
        : `Language set to ${LANGUAGE_OPTIONS.find(l => l.code === code)?.label ?? code} on this device`,
    );
  }, [isServerSyncEnabled, prefs, toast]);

  const saveAccountProfile = useCallback(async () => {
    if (!isAuthenticated) {
      toast('info', 'Sign in to save account details across devices.');
      return;
    }
    if (!prefs.serverSyncEnabled) {
      toast('info', 'Turn on cross-device sync before saving account details to ORAN.');
      return;
    }

    await updateServerProfile({
      displayName: account.displayName.trim() || undefined,
      phone: account.phone.trim() || undefined,
    });
    toast('success', 'Account details updated');
  }, [account.displayName, account.phone, isAuthenticated, prefs.serverSyncEnabled, toast]);

  // ── Theme toggle ────────────────────────────────────────────
  const toggleTheme = useCallback((dark: boolean) => {
    setIsDark(dark);
    try {
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch { /* no-op */ }
  }, []);

  // ── Contact save (local only) ───────────────────────────────
  const saveContact = useCallback(() => {
    writeSeekerContext(seeker);
    toast(
      'success',
      isServerSyncEnabled ? 'Contact info saved to this device and syncing to your account' : 'Contact info saved on this device',
    );
  }, [isServerSyncEnabled, seeker, toast]);

  const toggleServerSync = useCallback(async (enabled: boolean) => {
    const updated = { ...prefs, serverSyncEnabled: enabled };
    setPrefs(updated);
    writeStoredProfilePreferences(updated);

    if (!isAuthenticated) {
      toast('info', 'Sign in to enable cross-device sync.');
      return;
    }

    if (enabled) {
      await updateServerProfile({
        approximateCity: city.trim() || undefined,
        preferredLocale: language,
        displayName: account.displayName.trim() || undefined,
        phone: account.phone.trim() || undefined,
        seekerProfile: seeker,
      });
      toast('success', 'Cross-device sync enabled. Your current profile is now saved to your account.');
      return;
    }

    toast('info', 'Cross-device sync is now off. Existing account data remains until you delete it.');
  }, [account.displayName, account.phone, city, isAuthenticated, language, prefs, seeker, toast]);

  const updatePassword = useCallback(async () => {
    if (!isAuthenticated) {
      toast('error', 'You need to sign in first.');
      return;
    }
    if (account.authProvider !== 'credentials') {
      toast('info', 'Password changes are only available for email + password accounts.');
      return;
    }
    if (!currentPassword || !newPassword) {
      toast('error', 'Enter your current and new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('error', 'New password confirmation does not match.');
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const res = await fetch('/api/user/security/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        toast('error', json.error ?? 'Failed to update password.');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('success', json.message ?? 'Password updated successfully.');
    } catch {
      toast('error', 'Failed to update password.');
    } finally {
      setIsUpdatingPassword(false);
    }
  }, [account.authProvider, confirmPassword, currentPassword, isAuthenticated, newPassword, toast]);

  // ── Delete all data ─────────────────────────────────────────
  const deleteAllData = useCallback(async () => {
    if (isAuthenticated) {
      try {
        const res = await fetch('/api/user/data-delete', { method: 'DELETE' });
        if (!res.ok) { toast('error', 'Failed to delete server data. Please try again.'); return; }
      } catch { toast('error', 'Failed to delete server data. Please try again.'); return; }
    }
    clearStoredProfilePreferences();
    writeStoredSavedServiceIds([]);
    clearStoredSeekerProfile();
    setPrefs({});
    setCity('');
    setLanguage('en');
    setSavedCount(0);
    setSeeker({ ...DEFAULT_SEEKER_CONTEXT });
    setShowDeleteConfirm(false);
    toast('success', isAuthenticated ? 'All profile data deleted from this device and your account' : 'All profile data deleted from this device');
  }, [toast, isAuthenticated]);

  // ── Export data (authenticated) ─────────────────────────────
  const exportData = useCallback(async () => {
    try {
      const res = await fetch('/api/user/data-export', { method: 'POST' });
      if (!res.ok) { toast('error', 'Failed to export data.'); return; }
      toast('success', 'Data export started — check your email.');
    } catch { toast('error', 'Failed to export data.'); }
  }, [toast]);

  // ── Profile strength ────────────────────────────────────────
  const strength = calcProfileStrength(seeker, city);
  const strengthPct = Math.round((strength.score / strength.max) * 100);
  const selectedTheme = ACCENT_THEME_OPTIONS.find(theme => theme.id === seeker.accentTheme) ?? ACCENT_THEME_OPTIONS[0];
  const strengthColor = strengthPct < 34 ? 'bg-orange-400' : strengthPct < 67 ? 'bg-yellow-400' : strengthPct < 100 ? selectedTheme.progressClass : 'bg-green-500';

  // ── Subtitle helpers ────────────────────────────────────────
  const serviceSubtitle = seeker.serviceInterests.length > 0
    ? seeker.serviceInterests.map(id => SERVICE_INTEREST_OPTIONS.find(o => o.id === id)?.label).filter(Boolean).join(', ')
    : 'None selected — tap to choose';

  const aboutSubtitle = seeker.ageGroup || seeker.householdType
    ? [AGE_GROUP_OPTIONS.find(o => o.id === seeker.ageGroup)?.label, HOUSEHOLD_TYPE_OPTIONS.find(o => o.id === seeker.householdType)?.label].filter(Boolean).join(' · ')
    : 'Tap to tell agents about you';

  const constraintSummary = [
    ...(seeker.transportationBarrier ? ['Transportation barrier'] : []),
    ...(seeker.digitalAccessBarrier ? ['Digital access barrier'] : []),
    ...seeker.preferredDeliveryModes.map(id => PREFERRED_DELIVERY_OPTIONS.find(o => o.id === id)?.label).filter(Boolean) as string[],
    ...(seeker.urgencyWindow ? [URGENCY_WINDOW_OPTIONS.find(o => o.id === seeker.urgencyWindow)?.label].filter(Boolean) as string[] : []),
    ...seeker.documentationBarriers.map(id => DOCUMENTATION_BARRIER_OPTIONS.find(o => o.id === id)?.label).filter(Boolean) as string[],
  ];
  const constraintsSubtitle = constraintSummary.length > 0
    ? constraintSummary.slice(0, 3).join(' · ')
    : 'Optional real-world fit constraints';

  const locationSubtitle = prefs.approximateCity ? `Set to: ${prefs.approximateCity}` : 'Not set';
  const identitySubtitle = account.displayName || seeker.pronouns || seeker.profileHeadline
    ? [account.displayName, seeker.pronouns, seeker.profileHeadline].filter(Boolean).join(' · ')
    : 'Make this feel like your space';
  const securitySubtitle = account.authProvider
    ? `Signed in with ${AUTH_PROVIDER_LABELS[account.authProvider] ?? account.authProvider}`
    : 'Sign in to manage account security';

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <main className="min-h-screen bg-white">
      <div className="container mx-auto max-w-4xl px-4 py-6 md:py-8">
      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm md:p-8">
      <PageHeader
        eyebrow="Private seeker profile"
        title="Profile"
        icon={<User className="h-6 w-6" aria-hidden="true" />}
        subtitle={isAuthenticated
          ? isServerSyncEnabled
            ? `${account.displayName ? `${account.displayName}, ` : ''}your signed-in profile syncs across ORAN so chat, saved services, and future dashboards can use the same context.`
            : `${account.displayName ? `${account.displayName}, ` : ''}you are signed in, but this profile stays local on this device until you opt in to cross-device sync.`
          : 'Your profile helps ORAN find the most relevant services for you. Signed-out preferences stay on this device.'}
        badges={(
          <>
            <PageHeaderBadge tone="trust">Private by default</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Approximate location only</PageHeaderBadge>
            <PageHeaderBadge>
              {isAuthenticated ? (isServerSyncEnabled ? 'Sync enabled' : 'Local-only until you opt in') : 'Local-only until sign-in'}
            </PageHeaderBadge>
          </>
        )}
      />

      <ErrorBoundary>
        <div className="space-y-4">

          {/* ── Authenticated banner ─────────────────────────── */}
          {isAuthenticated && (
            <div
              className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                isServerSyncEnabled
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle className={`h-4 w-4 flex-none ${isServerSyncEnabled ? 'text-green-600' : 'text-amber-600'}`} aria-hidden="true" />
                <span>
                  {isServerSyncEnabled
                    ? account.displayName
                      ? `${account.displayName}, you are signed in. Your preferences are syncing across devices.`
                      : 'You are signed in. Your preferences are syncing across devices.'
                    : account.displayName
                      ? `${account.displayName}, you are signed in. Profile changes stay on this device until you turn on cross-device sync.`
                      : 'You are signed in. Profile changes stay on this device until you turn on cross-device sync.'}
                </span>
              </div>
              <Link
                href="/api/auth/signout"
                className={`flex-none inline-flex min-h-[44px] items-center gap-1 whitespace-nowrap px-2 text-xs font-medium underline underline-offset-2 transition-colors hover:no-underline ${
                  isServerSyncEnabled ? 'text-green-700 hover:text-red-700' : 'text-amber-800 hover:text-red-700'
                }`}
              >
                <LogOut className="h-3 w-3" aria-hidden="true" />
                Sign out
              </Link>
            </div>
          )}

          {/* ── Anonymous value-proposition banner (H6 + L1) ─── */}
          {!isAuthenticated && (
            <div className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-orange-50 px-4 py-3 text-sm text-rose-900">
              <div className="flex items-start gap-2 mb-2">
                <Info className="mt-0.5 h-4 w-4 flex-none text-rose-500" aria-hidden="true" />
                <p className="font-medium">Your profile is saved on this device only</p>
              </div>
              <p className="mb-2 text-xs text-rose-700">
                Preferences marked <strong>&ldquo;AI uses this&rdquo;</strong> improve chat and search results right away
                — no account needed. Signing in lets ORAN sync your profile across devices, remember your saved
                services, and unlock future features like alerts and history.
              </p>
              <Link
                href="/api/auth/signin"
                className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-600"
              >
                Sign in to sync across devices
              </Link>
            </div>
          )}

          {/* ── Profile Strength Card ────────────────────────── */}
          <div className={`rounded-xl border p-5 ${selectedTheme.cardClass}`}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-start gap-3">
                <div className={`flex h-12 w-12 flex-none items-center justify-center rounded-2xl text-xl shadow-sm ${selectedTheme.previewClass} text-white`}>
                  {seeker.avatarEmoji || '✨'}
                </div>
                <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-orange-500" aria-hidden="true" />
                  <span className={`font-semibold text-sm ${selectedTheme.textClass}`}>AI Match Strength</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    strengthPct < 34 ? 'bg-orange-100 text-orange-700' :
                    strengthPct < 67 ? 'bg-yellow-100 text-yellow-700' :
                    strengthPct < 100 ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700'
                  }`}>{strength.label}</span>
                </div>
                <p className="mt-1 text-xs text-stone-600">
                  {strengthPct < 100
                    ? `Complete ${strength.max - strength.score} more section${strength.max - strength.score === 1 ? '' : 's'} to improve AI matching`
                    : 'Your profile is fully set up for AI-powered recommendations!'}
                </p>
                {seeker.profileHeadline && (
                  <p className="mt-2 text-xs text-gray-600">{seeker.profileHeadline}</p>
                )}
                </div>
              </div>
              <span className={`text-2xl font-bold ${selectedTheme.textClass}`}>{strengthPct}%</span>
            </div>
            <div className="w-full bg-blue-100 rounded-full h-2.5" role="progressbar" aria-valuenow={strengthPct} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-2.5 rounded-full transition-all duration-500 ${strengthColor}`} style={{ width: `${strengthPct}%` }} />
            </div>
          </div>

          {/* ── 1. Service Interests ─────────────────────────── */}
          <CollapsibleSection
            id="services"
            title="Service interests"
            subtitle={serviceSubtitle}
            icon={<Star className="h-4 w-4" />}
            accentColor="bg-blue-600"
            badge="AI uses this"
            isOpen={openSections.has('services')}
            onToggle={() => toggleSection('services')}
          >
            <p className="text-xs text-gray-500 mb-3">
              Select all types of services you may need. ORAN agents will prioritize these when finding matches.
            </p>
            <div className="flex flex-wrap gap-2">
              {SERVICE_INTEREST_OPTIONS.map(opt => (
                <PillButton
                  key={opt.id}
                  label={opt.label}
                  icon={opt.icon}
                  selected={seeker.serviceInterests.includes(opt.id)}
                  onToggle={() => toggleInArray('serviceInterests', opt.id)}
                  colorClass={opt.color}
                />
              ))}
            </div>
            {seeker.serviceInterests.length > 0 && (
              <p className="mt-3 text-xs text-green-700 flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {seeker.serviceInterests.length} categor{seeker.serviceInterests.length === 1 ? 'y' : 'ies'} selected — saved automatically{isAuthenticated ? ' to your account' : ''}
              </p>
            )}
          </CollapsibleSection>

          {/* ── 2. About Me ──────────────────────────────────── */}
          <CollapsibleSection
            id="aboutme"
            title="About me"
            subtitle={aboutSubtitle}
            icon={<UserCheck className="h-4 w-4" />}
            accentColor="bg-purple-600"
            badge="AI uses this"
            isOpen={openSections.has('aboutme')}
            onToggle={() => toggleSection('aboutme')}
          >
            <p className="text-xs text-gray-500 mb-4">
              This information helps agents find programs that match your specific situation. All optional.
            </p>

            {/* Age group */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Age group</label>
              <RadioPillGroup
                options={AGE_GROUP_OPTIONS}
                selected={seeker.ageGroup}
                onChange={v => updateSeeker('ageGroup', v as SeekerContext['ageGroup'])}
                name="Age group"
              />
            </div>

            {/* Household */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Household type</label>
              <RadioPillGroup
                options={HOUSEHOLD_TYPE_OPTIONS}
                selected={seeker.householdType}
                onChange={v => updateSeeker('householdType', v as SeekerContext['householdType'])}
                name="Household type"
              />
            </div>

            {/* Housing situation */}
            <div className="mb-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">Current housing situation</label>
              <RadioPillGroup
                options={HOUSING_SITUATION_OPTIONS}
                selected={seeker.housingSituation}
                onChange={v => updateSeeker('housingSituation', v as SeekerContext['housingSituation'])}
                name="Housing situation"
              />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            id="constraints"
            title="Practical fit constraints"
            subtitle={constraintsSubtitle}
            icon={<AlertCircle className="h-4 w-4" />}
            accentColor="bg-amber-600"
            badge="AI uses this"
            isOpen={openSections.has('constraints')}
            onToggle={() => toggleSection('constraints')}
          >
            <p className="text-xs text-gray-500 mb-4">
              These are the constraints that most often change whether a service is realistic for someone, even when they technically qualify.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Preferred delivery modes</label>
              <div className="flex flex-wrap gap-2">
                {PREFERRED_DELIVERY_OPTIONS.map(opt => (
                  <PillButton
                    key={opt.id}
                    label={opt.label}
                    selected={seeker.preferredDeliveryModes.includes(opt.id)}
                    onToggle={() => toggleInArray('preferredDeliveryModes', opt.id)}
                  />
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Timing urgency</label>
              <RadioPillGroup
                options={URGENCY_WINDOW_OPTIONS}
                selected={seeker.urgencyWindow}
                onChange={v => updateSeeker('urgencyWindow', v as SeekerContext['urgencyWindow'])}
                name="Timing urgency"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Documentation barriers</label>
              <div className="flex flex-wrap gap-2">
                {DOCUMENTATION_BARRIER_OPTIONS.map(opt => (
                  <PillButton
                    key={opt.id}
                    label={opt.label}
                    selected={seeker.documentationBarriers.includes(opt.id)}
                    onToggle={() => toggleInArray('documentationBarriers', opt.id)}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <PillButton
                label="Transportation is a barrier"
                selected={seeker.transportationBarrier}
                onToggle={() => updateSeeker('transportationBarrier', !seeker.transportationBarrier)}
              />
              <PillButton
                label="Limited internet or device access"
                selected={seeker.digitalAccessBarrier}
                onToggle={() => updateSeeker('digitalAccessBarrier', !seeker.digitalAccessBarrier)}
              />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            id="identity"
            title="Personal identity"
            subtitle={identitySubtitle}
            icon={<User className="h-4 w-4" />}
            accentColor="bg-fuchsia-600"
            isOpen={openSections.has('identity')}
            onToggle={() => toggleSection('identity')}
          >
            <p className="text-xs text-gray-500 mb-3">
              Make the profile feel like yours. This helps ORAN speak to you more naturally and keeps your account recognizable across dashboards.
            </p>
            <div className="space-y-4">
              <FormField label="Preferred name" htmlFor="display-name">
                <input
                  id="display-name"
                  value={account.displayName}
                  onChange={e => setAccount(prev => ({ ...prev, displayName: e.target.value }))}
                  placeholder="What should ORAN call you?"
                  className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 min-h-[44px]"
                />
              </FormField>

              <FormField label="Pronouns" htmlFor="pronouns">
                <input
                  id="pronouns"
                  value={seeker.pronouns}
                  onChange={e => updateSeeker('pronouns', e.target.value)}
                  placeholder="e.g., she/her, he/him, they/them"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                />
              </FormField>

              <FormField label="Profile headline" htmlFor="profile-headline">
                <input
                  id="profile-headline"
                  value={seeker.profileHeadline}
                  onChange={e => updateSeeker('profileHeadline', e.target.value)}
                  placeholder="A short line that describes what matters to you most"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                />
              </FormField>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Profile picture style</label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updateSeeker('avatarEmoji', seeker.avatarEmoji === opt.id ? '' : opt.id)}
                      className={`rounded-full border px-3 py-2 text-sm min-h-[44px] transition-colors ${
                        seeker.avatarEmoji === opt.id
                          ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                      aria-pressed={seeker.avatarEmoji === opt.id}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {isAuthenticated && (
                <Button type="button" size="sm" variant="secondary" onClick={() => void saveAccountProfile()}>
                  Save identity details
                </Button>
              )}
            </div>
          </CollapsibleSection>

          {/* ── 3. Self-identifiers ──────────────────────────── */}
          <CollapsibleSection
            id="identifiers"
            title="Who you are"
            subtitle={
              seeker.selfIdentifiers.length > 0
                ? seeker.selfIdentifiers.map(id => SELF_IDENTIFIER_OPTIONS.find(o => o.id === id)?.label).filter(Boolean).join(', ')
                : 'Optional — helps find specialized programs'
            }
            icon={<Heart className="h-4 w-4" />}
            accentColor="bg-rose-500"
            badge="AI uses this"
            isOpen={openSections.has('identifiers')}
            onToggle={() => toggleSection('identifiers')}
          >
            <p className="text-xs text-gray-500 mb-3">
              Select what applies to you. This helps surface specialized programs designed for your community.
              This is entirely optional. It stays on this device unless you explicitly enable cross-device sync.
            </p>
            <div className="flex flex-wrap gap-2">
              {SELF_IDENTIFIER_OPTIONS.map(opt => (
                <PillButton
                  key={opt.id}
                  label={opt.label}
                  selected={seeker.selfIdentifiers.includes(opt.id)}
                  onToggle={() => toggleInArray('selfIdentifiers', opt.id)}
                />
              ))}
            </div>
          </CollapsibleSection>

          {/* ── 4. Currently receiving ───────────────────────── */}
          <CollapsibleSection
            id="currentservices"
            title="Services I already receive"
            subtitle={
              seeker.currentServices.length > 0
                ? `${seeker.currentServices.length} program${seeker.currentServices.length === 1 ? '' : 's'} noted`
                : 'Optional — avoids duplicate suggestions'
            }
            icon={<CheckCircle className="h-4 w-4" />}
            accentColor="bg-teal-600"
            badge="AI uses this"
            isOpen={openSections.has('currentservices')}
            onToggle={() => toggleSection('currentservices')}
          >
            <p className="text-xs text-gray-500 mb-3">
              Check programs you already participate in. ORAN will avoid suggesting duplicates and look for complementary services.
            </p>
            <div className="flex flex-wrap gap-2">
              {CURRENT_SERVICES_OPTIONS.map(opt => (
                <PillButton
                  key={opt.id}
                  label={opt.label}
                  selected={seeker.currentServices.includes(opt.id)}
                  onToggle={() => toggleInArray('currentServices', opt.id)}
                />
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            id="accessibility"
            title="Accessibility & accommodations"
            subtitle={seeker.accessibilityNeeds.length > 0 ? `${seeker.accessibilityNeeds.length} preference${seeker.accessibilityNeeds.length === 1 ? '' : 's'} selected` : 'Optional — helps find a better fit'}
            icon={<Heart className="h-4 w-4" />}
            accentColor="bg-emerald-600"
            badge="AI uses this"
            isOpen={openSections.has('accessibility')}
            onToggle={() => toggleSection('accessibility')}
          >
            <p className="text-xs text-gray-500 mb-3">
              These preferences help ORAN surface services that are more workable in real life, not just technically available.
            </p>
            <div className="flex flex-wrap gap-2">
              {ACCESSIBILITY_OPTIONS.map(opt => (
                <PillButton
                  key={opt.id}
                  label={opt.label}
                  selected={seeker.accessibilityNeeds.includes(opt.id)}
                  onToggle={() => toggleAccessibilityNeed(opt.id)}
                />
              ))}
            </div>
          </CollapsibleSection>

          {/* ── 5. Location ──────────────────────────────────── */}
          <CollapsibleSection
            id="location"
            title="Approximate location"
            subtitle={locationSubtitle}
            icon={<MapPin className="h-4 w-4" />}
            accentColor="bg-green-600"
            badge="AI uses this"
            isOpen={openSections.has('location')}
            onToggle={() => toggleSection('location')}
          >
            <p className="text-xs text-gray-500 mb-3">
              Enter a city or region to improve search results. ORAN <strong>never</strong> requests precise GPS location.
              {isServerSyncEnabled
                ? ' Cross-device sync is on, so this approximate location also saves to your account.'
                : ' This location stays on this device unless you turn on cross-device sync.'}
              {' '}ORAN never stores street-level location here.
            </p>
            <form onSubmit={e => { e.preventDefault(); saveCity(); }} className="flex gap-2">
              <FormField label="City or region" htmlFor="approx-city" srOnlyLabel>
                <input
                  id="approx-city"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  placeholder="e.g., Austin, TX"
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                />
              </FormField>
              <Button type="submit" size="sm">Save</Button>
            </form>
            {prefs.approximateCity && (
              <p className="mt-2 text-xs text-gray-500">
                Saved: <span className="font-medium text-gray-700">{prefs.approximateCity}</span> (approximate)
              </p>
            )}
          </CollapsibleSection>

          {/* ── 6. Language ──────────────────────────────────── */}
          <CollapsibleSection
            id="language"
            title="Preferred language"
            subtitle={LANGUAGE_OPTIONS.find(l => l.code === language)?.label ?? 'English'}
            icon={<Globe className="h-4 w-4" />}
            accentColor="bg-cyan-600"
            isOpen={openSections.has('language')}
            onToggle={() => toggleSection('language')}
          >
            <p className="text-xs text-gray-500 mb-3">
              Choose your preferred language. It stays on this device unless you turn on cross-device sync.
            </p>
            <FormField label="Language" htmlFor="pref-language" srOnlyLabel>
              <select
                id="pref-language"
                value={language}
                onChange={e => saveLanguage(e.target.value)}
                className="w-full sm:w-64 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              >
                {LANGUAGE_OPTIONS.map(opt => (
                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                ))}
              </select>
            </FormField>
            <p className="mt-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded px-3 py-1.5 inline-flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
              Display language only — full UI translation coming soon.
            </p>
          </CollapsibleSection>

          {/* ── 7. Additional context ─────────────────────────── */}
          <CollapsibleSection
            id="context"
            title="Hints for AI assistants"
            subtitle={
              seeker.additionalContext.trim().length > 10
                ? `${seeker.additionalContext.trim().substring(0, 50)}…`
                : 'Optional — any details that may help'
            }
            icon={<Info className="h-4 w-4" />}
            accentColor="bg-amber-500"
            badge="AI uses this"
            isOpen={openSections.has('context')}
            onToggle={() => toggleSection('context')}
          >
            <p className="text-xs text-gray-500 mb-3">
              Anything else you&apos;d like AI assistants to know when finding services for you? E.g. &ldquo;I have a car but no childcare&rdquo;
              or &ldquo;I need evening hours only&rdquo;. Keep it general — avoid including sensitive personal details such as SSNs, dates of birth, or financial account numbers.
            </p>
            <textarea
              value={seeker.additionalContext}
              onChange={e => updateSeeker('additionalContext', e.target.value)}
              onBlur={() => writeSeekerContext(seeker)}
              placeholder="e.g., I work nights and need evening or weekend appointments only…"
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              aria-label="Additional context for AI agents"
            />
            <p className="mt-1 text-xs text-gray-400 text-right">{seeker.additionalContext.length}/500</p>
          </CollapsibleSection>

          {/* ── 8. Contact info ──────────────────────────────── */}
          <CollapsibleSection
            id="contact"
            title="My contact info"
            subtitle="Optional — stored locally, used only by agents when you ask"
            icon={<Phone className="h-4 w-4" />}
            accentColor="bg-indigo-600"
            isOpen={openSections.has('contact')}
            onToggle={() => toggleSection('contact')}
          >
            <div className="flex items-start gap-2 rounded-lg bg-indigo-50 border border-indigo-100 p-3 mb-3">
              <Info className="h-4 w-4 text-indigo-500 mt-0.5 flex-none" aria-hidden="true" />
              <p className="text-xs text-indigo-700">
                {isAuthenticated ? 'Stored on this device and in your signed-in profile.' : 'Stored only on this device.'} Agents may use this only when you explicitly ask them to help contact a service on your behalf. It is <strong>never transmitted to providers</strong> without your direct action.
              </p>
            </div>
            <div className="space-y-3">
              <FormField label="Phone number" htmlFor="contact-phone">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-400 flex-none" aria-hidden="true" />
                  <input
                    id="contact-phone"
                    type="tel"
                    autoComplete="tel"
                    value={seeker.contactPhone}
                    onChange={e => updateSeeker('contactPhone', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="flex-1 rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 min-h-[44px]"
                  />
                </div>
              </FormField>
              <FormField label="Email address" htmlFor="contact-email">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-gray-400 flex-none" aria-hidden="true" />
                  <input
                    id="contact-email"
                    type="email"
                    autoComplete="email"
                    value={seeker.contactEmail}
                    onChange={e => updateSeeker('contactEmail', e.target.value)}
                    placeholder="you@example.com"
                    className="flex-1 rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 min-h-[44px]"
                  />
                </div>
              </FormField>
              <Button type="button" size="sm" onClick={saveContact} variant="secondary">
                Save contact info
              </Button>
            </div>
          </CollapsibleSection>

          {/* ── 9. Saved resources ──────────────────────────── */}
          <CollapsibleSection
            id="saved"
            title="Saved resources"
            subtitle={savedCount > 0 ? `${savedCount} service${savedCount === 1 ? '' : 's'} bookmarked on this device.` : 'Nothing saved yet'}
            icon={<Bookmark className="h-4 w-4" />}
            accentColor="bg-pink-600"
            isOpen={openSections.has('saved')}
            onToggle={() => toggleSection('saved')}
          >
            {savedCount > 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  You have <span className="font-medium">{savedCount} service{savedCount === 1 ? '' : 's'}</span> bookmarked on this device.
                </p>
                <Link href="/saved">
                  <Button variant="secondary" size="sm" className="flex items-center gap-1.5">
                    <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                    View all saved services
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="text-center py-6">
                <Bookmark className="h-8 w-8 text-gray-200 mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm text-gray-500 mb-3">No saved services yet.</p>
                <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
                  <Link href={browseDirectoryHref}>
                    <Button variant="secondary" size="sm">Browse services</Button>
                  </Link>
                  <Link href={browseChatHref}>
                    <Button variant="outline" size="sm">Ask chat</Button>
                  </Link>
                  <Link href={browseMapHref}>
                    <Button variant="outline" size="sm">Map view</Button>
                  </Link>
                </div>
              </div>
            )}
          </CollapsibleSection>

          {/* ── 10. Display ─────────────────────────────────── */}
          <CollapsibleSection
            id="display"
            title="Display"
            subtitle={`${isDark ? 'Dark mode' : 'Light mode'} · ${selectedTheme.label} theme`}
            icon={isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            accentColor="bg-slate-600"
            isOpen={openSections.has('display')}
            onToggle={() => toggleSection('display')}
          >
            <p className="text-xs text-gray-500 mb-3">Choose light or dark mode and the accent personality that feels right for you. Theme names are intentionally flexible, not gender-locked.</p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Accent theme</label>
              <div className="flex flex-wrap gap-2">
                {ACCENT_THEME_OPTIONS.map(theme => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => updateSeeker('accentTheme', theme.id)}
                    aria-pressed={seeker.accentTheme === theme.id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm min-h-[44px] transition-colors ${
                      seeker.accentTheme === theme.id
                        ? 'border-orange-300 bg-orange-50 text-orange-700 font-medium'
                        : 'border-orange-100 bg-white text-stone-700 hover:bg-orange-50'
                    }`}
                  >
                    <span className={`h-3 w-3 rounded-full ${theme.previewClass}`} aria-hidden="true" />
                    {theme.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2" role="group" aria-label="Color theme">
              <button
                type="button"
                onClick={() => toggleTheme(false)}
                aria-pressed={!isDark}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm min-h-[44px] transition-colors ${
                  !isDark ? 'border-orange-300 bg-orange-50 text-orange-700 font-medium' : 'border-orange-100 bg-white text-stone-700 hover:bg-orange-50'
                }`}
              >
                <Sun className="h-4 w-4" aria-hidden="true" /> Light
              </button>
              <button
                type="button"
                onClick={() => toggleTheme(true)}
                aria-pressed={isDark}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm min-h-[44px] transition-colors ${
                  isDark ? 'border-orange-300 bg-orange-50 text-orange-700 font-medium' : 'border-orange-100 bg-white text-stone-700 hover:bg-orange-50'
                }`}
              >
                <Moon className="h-4 w-4" aria-hidden="true" /> Dark
              </button>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            id="security"
            title="Account & security"
            subtitle={securitySubtitle}
            icon={<Shield className="h-4 w-4" />}
            accentColor="bg-violet-700"
            isOpen={openSections.has('security')}
            onToggle={() => toggleSection('security')}
          >
            {isAuthenticated ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Account email" htmlFor="account-email">
                    <input
                      id="account-email"
                      value={account.email}
                      readOnly
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 min-h-[44px]"
                    />
                  </FormField>
                  <FormField label="Account phone" htmlFor="account-phone">
                    <input
                      id="account-phone"
                      value={account.phone}
                      onChange={e => setAccount(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="Optional account phone"
                      className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 min-h-[44px]"
                    />
                  </FormField>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                  <p className="font-medium text-gray-900">Sign-in method</p>
                  <p className="mt-1">{AUTH_PROVIDER_LABELS[account.authProvider] ?? account.authProvider ?? 'Unknown provider'}</p>
                </div>

                <Button type="button" size="sm" variant="secondary" onClick={() => void saveAccountProfile()}>
                  Save account details
                </Button>

                {account.authProvider === 'credentials' ? (
                  <div className="rounded-xl border border-violet-100 bg-violet-50 p-4 space-y-3">
                    <p className="text-sm font-medium text-violet-900">Update password</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField label="Current password" htmlFor="current-password">
                        <input
                          id="current-password"
                          type="password"
                          autoComplete="current-password"
                          value={currentPassword}
                          onChange={e => setCurrentPassword(e.target.value)}
                          className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 min-h-[44px]"
                        />
                      </FormField>
                      <FormField label="New password" htmlFor="new-password">
                        <input
                          id="new-password"
                          type="password"
                          autoComplete="new-password"
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 min-h-[44px]"
                        />
                      </FormField>
                    </div>
                    <FormField label="Confirm new password" htmlFor="confirm-password">
                      <input
                        id="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 min-h-[44px]"
                      />
                    </FormField>
                    <Button type="button" size="sm" onClick={() => void updatePassword()} disabled={isUpdatingPassword}>
                      {isUpdatingPassword ? 'Updating password...' : 'Update password'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    Password changes for social or Microsoft sign-in accounts are managed by your identity provider. Notification preferences are available in the separate notifications section.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Sign in to manage account identity, password settings, and cross-device profile sync.</p>
            )}
          </CollapsibleSection>

          {/* ── 11. Notifications (authenticated only) ────────── */}
          {isAuthenticated && (
            <CollapsibleSection
              id="notifications"
              title="Notification preferences"
              subtitle="Manage what emails and alerts you receive"
              icon={<Bell className="h-4 w-4" />}
              accentColor="bg-orange-500"
              isOpen={openSections.has('notifications')}
              onToggle={() => toggleSection('notifications')}
            >
              <NotificationPreferencesSection />
            </CollapsibleSection>
          )}

          {/* ── 12. Privacy & account ────────────────────────── */}
          <CollapsibleSection
            id="privacy"
            title="Privacy & data"
            subtitle="Control all your stored data"
            icon={<Shield className="h-4 w-4" />}
            accentColor="bg-gray-600"
            isOpen={openSections.has('privacy')}
            onToggle={() => toggleSection('privacy')}
          >
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 space-y-2 text-xs text-emerald-800">
                <p className="font-semibold text-emerald-900 mb-1 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  Your privacy commitments
                </p>
                <p className="flex items-start gap-2"><CheckCircle className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-none" aria-hidden="true" /><span>{isAuthenticated ? (isServerSyncEnabled ? 'You explicitly enabled cross-device sync, so profile data can be reused across ORAN surfaces.' : 'Signed-in profile data still stays local until you explicitly enable cross-device sync.') : 'Signed-out profile data lives in your browser only.'}</span></p>
                <p className="flex items-start gap-2"><CheckCircle className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-none" aria-hidden="true" /><span>Location is city-level approximate — ORAN <strong>never</strong> requests GPS or precise location.</span></p>
                <p className="flex items-start gap-2"><CheckCircle className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-none" aria-hidden="true" /><span>Your data is <strong>never sold or shared</strong> with third parties.</span></p>
                <p className="flex items-start gap-2"><CheckCircle className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-none" aria-hidden="true" /><span>One-tap delete removes everything — no waiting period.</span></p>
              </div>

              {isAuthenticated ? (
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={prefs.serverSyncEnabled === true}
                      onChange={(event) => void toggleServerSync(event.target.checked)}
                      className="mt-0.5 rounded border-orange-200 text-orange-500 focus:ring-orange-400"
                      aria-label="Save my preferences to improve future results across devices"
                    />
                    <span className="space-y-1">
                      <span className="block text-sm font-medium text-gray-900">
                        Save my preferences to improve future results across devices
                      </span>
                      <span className="block text-xs text-gray-500">
                        {isServerSyncEnabled
                          ? 'Cross-device sync is on. New profile changes will save to your ORAN account.'
                          : 'Cross-device sync is off. Profile changes stay local until you turn this on.'}
                      </span>
                    </span>
                  </label>
                </div>
              ) : null}

              {!showDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => { setShowDeleteConfirm(true); setTimeout(() => confirmBtnRef.current?.focus(), 50); }}
                  className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete my data
                </button>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
                    <span className="font-semibold text-sm text-red-800">This cannot be undone</span>
                  </div>
                  <p className="text-xs text-red-700 mb-3">
                    This will permanently delete your location, preferences, seeker context, and saved services
                    {isAuthenticated ? ' — including server-side data' : ' from this device'}.
                  </p>
                  <div className="flex gap-2">
                    <button
                      ref={confirmBtnRef}
                      type="button"
                      onClick={() => void deleteAllData()}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {isAuthenticated && (
                <div className="flex flex-col gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void exportData()}
                      className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-medium text-orange-700 transition-colors hover:bg-orange-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                    >
                      Export my data
                    </button>
                    <Link
                      href="/api/auth/signout"
                      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-colors w-fit"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      Sign out
                    </Link>
                  </div>
                  <p className="text-xs text-gray-400">
                    Export sends a copy of your data to your account email. Sign out clears your session on this device.
                  </p>
                </div>
              )}
            </div>
          </CollapsibleSection>

        </div>
      </ErrorBoundary>
      </section>
      </div>
    </main>
  );
}
