'use client';

/**
 * OrgProfilePageClient — rich organization profile editor.
 *
 * Covers:
 *   • Logo URL, name, website, contact email
 *   • Mission statement + who-we-serve narrative
 *   • Service region (geographic scope)
 *   • Social / contact links
 *   • Read-only verified badge status
 *   • Team snapshot (links to /admins)
 *   • Profile completeness indicator
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Award,
  Building2,
  CheckCircle2,
  ExternalLink,
  Globe,
  Image,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  Save,
  Users,
  AlertCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import type { OrgSocialLinks, Organization } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

interface OrgOption {
  id: string;
  name: string;
}

interface ProfileForm {
  name: string;
  description: string;
  email: string;
  url: string;
  logoUrl: string;
  missionStatement: string;
  whoWeServe: string;
  serviceRegion: string;
  socialLinks: OrgSocialLinks;
}

const EMPTY_SOCIAL: OrgSocialLinks = {
  website: '',
  facebook: '',
  instagram: '',
  twitter: '',
  linkedin: '',
  youtube: '',
  tiktok: '',
  phone: '',
};

// ============================================================
// COMPLETENESS
// ============================================================

interface CompletenessSection {
  label: string;
  filled: boolean;
}

function buildCompleteness(form: ProfileForm, org: Organization | null): CompletenessSection[] {
  return [
    { label: 'Organization name',    filled: form.name.trim().length > 0 },
    { label: 'Logo',                 filled: form.logoUrl.trim().length > 0 },
    { label: 'Website',              filled: form.url.trim().length > 0 },
    { label: 'Contact email',        filled: form.email.trim().length > 0 },
    { label: 'Description',          filled: form.description.trim().length > 0 },
    { label: 'Mission statement',    filled: form.missionStatement.trim().length > 0 },
    { label: 'Who we serve',         filled: form.whoWeServe.trim().length > 0 },
    { label: 'Service region',       filled: form.serviceRegion.trim().length > 0 },
    { label: 'At least one social',  filled: Object.values(form.socialLinks).some((v) => v && v.trim().length > 0) },
    { label: 'Verified status',      filled: Boolean(org?.verifiedAt) },
  ];
}

// ============================================================
// SOCIAL FIELD CONFIG
// ============================================================

const SOCIAL_FIELDS: Array<{ key: keyof OrgSocialLinks; label: string; placeholder: string; icon: React.ElementType }> = [
  { key: 'website',   label: 'Website',   placeholder: 'https://example.org',           icon: Globe },
  { key: 'facebook',  label: 'Facebook',  placeholder: 'https://facebook.com/yourpage', icon: Globe },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourhandle', icon: Globe },
  { key: 'twitter',   label: 'Twitter/X', placeholder: 'https://x.com/yourhandle',       icon: Globe },
  { key: 'linkedin',  label: 'LinkedIn',  placeholder: 'https://linkedin.com/company/…', icon: Globe },
  { key: 'youtube',   label: 'YouTube',   placeholder: 'https://youtube.com/@yourchannel', icon: Globe },
  { key: 'phone',     label: 'Main phone', placeholder: '555-555-5555',                  icon: Globe },
];

// ============================================================
// HELPERS
// ============================================================

function orgToForm(org: Organization): ProfileForm {
  return {
    name:             org.name ?? '',
    description:      org.description ?? '',
    email:            org.email ?? '',
    url:              org.url ?? '',
    logoUrl:          org.logoUrl ?? '',
    missionStatement: org.missionStatement ?? '',
    whoWeServe:       org.whoWeServe ?? '',
    serviceRegion:    org.serviceRegion ?? '',
    socialLinks: {
      ...EMPTY_SOCIAL,
      ...(org.socialLinks ?? {}),
    },
  };
}

// ============================================================
// SUBCOMPONENTS
// ============================================================

function CompletenessBar({ form, org }: { form: ProfileForm; org: Organization | null }) {
  const sections = buildCompleteness(form, org);
  const filled = sections.filter((s) => s.filled).length;
  const pct = Math.round((filled / sections.length) * 100);

  let barColor = 'bg-rose-400';
  if (pct >= 80) barColor = 'bg-emerald-500';
  else if (pct >= 50) barColor = 'bg-amber-400';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-gray-800">Profile completeness</p>
        <span className="text-sm font-bold text-gray-900">{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden mb-3">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <ul className="grid grid-cols-2 gap-1">
        {sections.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-xs text-gray-600">
            {s.filled
              ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
              : <AlertCircle  className="h-3.5 w-3.5 text-gray-300 shrink-0" aria-hidden="true" />
            }
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerifiedBadge({ verifiedAt }: { verifiedAt: string | null | undefined }) {
  if (!verifiedAt) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
        <div className="flex items-center gap-2 font-medium text-gray-700 mb-1">
          <Award className="h-4 w-4" aria-hidden="true" />
          Verified Provider
        </div>
        <p>Not yet verified. ORAN admins review your listing history before granting a Verified badge. Keep your profile complete and listings current to qualify faster.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold text-emerald-800 mb-1">
        <Award className="h-4 w-4" aria-hidden="true" />
        Verified Provider
      </div>
      <p className="text-emerald-700">
        Verified on {new Date(verifiedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
        Your listings display the Verified badge to seekers.
      </p>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function OrgProfilePageClient() {
  const toast = useToast();

  // Org selection state
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingOrg, setLoadingOrg] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState<ProfileForm>({
    name: '', description: '', email: '', url: '', logoUrl: '',
    missionStatement: '', whoWeServe: '', serviceRegion: '',
    socialLinks: { ...EMPTY_SOCIAL },
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Prevent stale save
  const saveVersionRef = useRef(0);

  // ============================================================
  // LOAD ORG LIST
  // ============================================================

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/host/organizations?limit=50');
        if (!res.ok) throw new Error('Failed to load organizations');
        const json = (await res.json()) as { results: Array<{ id: string; name: string }> };
        setOrgs(json.results);
        if (json.results.length > 0 && !selectedOrgId) {
          setSelectedOrgId(json.results[0]!.id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load organizations');
      } finally {
        setLoadingOrgs(false);
      }
    };
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // LOAD SELECTED ORG DETAIL
  // ============================================================

  const loadOrg = useCallback(async (orgId: string) => {
    setLoadingOrg(true);
    setError(null);
    try {
      const res = await fetch(`/api/host/organizations/${orgId}`);
      if (!res.ok) throw new Error('Failed to load organization profile');
      const data = (await res.json()) as Organization;
      setOrg(data);
      setForm(orgToForm(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load organization');
    } finally {
      setLoadingOrg(false);
    }
  }, []);

  useEffect(() => {
    if (selectedOrgId) void loadOrg(selectedOrgId);
  }, [selectedOrgId, loadOrg]);

  // ============================================================
  // FIELD HELPERS
  // ============================================================

  const setField = useCallback(<K extends keyof Omit<ProfileForm, 'socialLinks'>>(
    key: K,
    value: ProfileForm[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setSocial = useCallback((key: keyof OrgSocialLinks, value: string) => {
    setForm((prev) => ({
      ...prev,
      socialLinks: { ...prev.socialLinks, [key]: value },
    }));
  }, []);

  // ============================================================
  // SAVE
  // ============================================================

  const handleSave = useCallback(async () => {
    if (!selectedOrgId) return;
    const version = ++saveVersionRef.current;
    setIsSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = {
        name:             form.name.trim() || undefined,
        description:      form.description.trim() || undefined,
        email:            form.email.trim() || undefined,
        url:              form.url.trim() || undefined,
        logoUrl:          form.logoUrl.trim() || undefined,
        missionStatement: form.missionStatement.trim() || undefined,
        whoWeServe:       form.whoWeServe.trim() || undefined,
        serviceRegion:    form.serviceRegion.trim() || undefined,
        socialLinks:      form.socialLinks,
      };

      // Strip undefined keys
      const payload = Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== undefined),
      );

      const res = await fetch(`/api/host/organizations/${selectedOrgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (version !== saveVersionRef.current) return;

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? 'Failed to save');
      }

      const updated = (await res.json()) as Organization;
      setOrg(updated);
      setForm(orgToForm(updated));
      toast.success('Profile saved');
    } catch (e) {
      if (version !== saveVersionRef.current) return;
      setSaveError(e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      if (version === saveVersionRef.current) setIsSaving(false);
    }
  }, [selectedOrgId, form, toast]);

  // ============================================================
  // RENDER
  // ============================================================

  if (loadingOrgs) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8 space-y-4" role="status" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Host workspace"
        title="Organization Profile"
        icon={<Building2 className="h-6 w-6" aria-hidden="true" />}
        subtitle="Build your public-facing profile. Complete profiles earn Verified status faster and give seekers confidence."
        badges={(
          <>
            {org?.verifiedAt && (
              <PageHeaderBadge tone="trust">
                <Award className="h-3 w-3 mr-1" aria-hidden="true" />
                Verified Provider
              </PageHeaderBadge>
            )}
            <PageHeaderBadge tone="accent">Profile visible on seeker listings</PageHeaderBadge>
          </>
        )}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href="/admins">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Users className="h-4 w-4" aria-hidden="true" />
                Team
              </Button>
            </Link>
            <Link href="/services">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Services
              </Button>
            </Link>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => void handleSave()}
              disabled={isSaving || !selectedOrgId}
            >
              {isSaving
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Save className="h-4 w-4" aria-hidden="true" />
              }
              Save profile
            </Button>
          </div>
        )}
      />

      <ErrorBoundary>
        <div className="container mx-auto max-w-4xl px-4 py-6 space-y-6">

          {/* Org picker (only if multiple orgs) */}
          {orgs.length > 1 && (
            <FormSection title="Select organization" description="Choose which organization profile to edit.">
              <div className="flex flex-wrap gap-2">
                {orgs.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelectedOrgId(o.id)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                      selectedOrgId === o.id
                        ? 'border-action bg-action text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-action hover:text-action'
                    }`}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            </FormSection>
          )}

          {orgs.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
              <Building2 className="h-8 w-8 text-gray-300 mx-auto mb-3" aria-hidden="true" />
              <p className="font-medium text-gray-700">No organizations yet</p>
              <p className="mt-1 text-sm text-gray-500">
                <Link href="/claim" className="text-action-base hover:underline">Claim an organization</Link> to get started.
              </p>
            </div>
          )}

          {error && (
            <FormAlert variant="error" message={error} onDismiss={() => setError(null)} />
          )}

          {loadingOrg && (
            <div className="space-y-4" role="status" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {!loadingOrg && org && selectedOrgId && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* ─── Left column: forms ─── */}
              <div className="lg:col-span-2 space-y-6">

                {saveError && (
                  <FormAlert variant="error" message={saveError} onDismiss={() => setSaveError(null)} />
                )}

                {/* Identity */}
                <FormSection
                  title="Identity"
                  description="Basic details seekers and admins see alongside your listings."
                >
                  <div className="space-y-4">
                    <FormField
                      id="org-name"
                      label="Organization name"
                      required
                      hint="The legal or commonly recognized name of your organization."
                    >
                      <input
                        id="org-name"
                        type="text"
                        value={form.name}
                        onChange={(e) => setField('name', e.target.value)}
                        maxLength={500}
                        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                        placeholder="e.g. Community Services Coalition"
                        aria-required="true"
                      />
                    </FormField>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField
                        id="org-email"
                        label="Public contact email"
                        hint="Visible to seekers requesting more information."
                      >
                        <input
                          id="org-email"
                          type="email"
                          value={form.email}
                          onChange={(e) => setField('email', e.target.value)}
                          maxLength={500}
                          className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                          placeholder="info@example.org"
                        />
                      </FormField>
                      <FormField
                        id="org-url"
                        label="Primary website"
                        hint="Link to your organization's main site."
                      >
                        <input
                          id="org-url"
                          type="url"
                          value={form.url}
                          onChange={(e) => setField('url', e.target.value)}
                          maxLength={2000}
                          className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                          placeholder="https://example.org"
                        />
                      </FormField>
                    </div>

                    <FormField
                      id="org-logo"
                      label="Logo URL"
                      hint="Direct link to a square PNG or SVG logo (min 100×100 px). Displays on listings and org profile cards."
                    >
                      <div className="flex items-center gap-3">
                        <input
                          id="org-logo"
                          type="url"
                          value={form.logoUrl}
                          onChange={(e) => setField('logoUrl', e.target.value)}
                          maxLength={2000}
                          className="flex-1 block rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                          placeholder="https://cdn.example.org/logo.png"
                        />
                        {form.logoUrl.trim() ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={form.logoUrl}
                            alt="Logo preview"
                            className="h-10 w-10 rounded-lg object-contain border border-gray-200 bg-gray-50 shrink-0"
                            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center shrink-0">
                            <Image className="h-4 w-4 text-gray-400" aria-hidden="true" />
                          </div>
                        )}
                      </div>
                    </FormField>
                  </div>
                </FormSection>

                {/* Mission */}
                <FormSection
                  title="Mission & narrative"
                  description="These fields appear on your public profile card and inside seeker-facing listing snippets. Write for a general audience — no jargon."
                >
                  <div className="space-y-4">
                    <FormField
                      id="org-mission"
                      label="Mission statement"
                      hint="1–3 sentences. What is your core purpose?"
                    >
                      <textarea
                        id="org-mission"
                        value={form.missionStatement}
                        onChange={(e) => setField('missionStatement', e.target.value)}
                        maxLength={2000}
                        rows={3}
                        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action resize-y"
                        placeholder="e.g. We connect individuals and families experiencing housing instability to stable long-term solutions through wrap-around case management."
                      />
                      <p className="text-xs text-gray-400 mt-1">{form.missionStatement.length}/2000</p>
                    </FormField>

                    <FormField
                      id="org-who"
                      label="Who we serve"
                      hint="Describe the populations your organization specifically serves or prioritizes. Seekers read this to self-identify."
                    >
                      <textarea
                        id="org-who"
                        value={form.whoWeServe}
                        onChange={(e) => setField('whoWeServe', e.target.value)}
                        maxLength={2000}
                        rows={3}
                        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action resize-y"
                        placeholder="e.g. Adults 18+ experiencing homelessness or at imminent risk of homelessness in Maricopa County."
                      />
                      <p className="text-xs text-gray-400 mt-1">{form.whoWeServe.length}/2000</p>
                    </FormField>

                    <FormField
                      id="org-description"
                      label="Detailed description"
                      hint="Extended description shown on the full profile page. Can cover programs, history, approach."
                    >
                      <textarea
                        id="org-description"
                        value={form.description}
                        onChange={(e) => setField('description', e.target.value)}
                        maxLength={5000}
                        rows={5}
                        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action resize-y"
                        placeholder="Detailed information about your programs, history, and approach…"
                      />
                      <p className="text-xs text-gray-400 mt-1">{form.description.length}/5000</p>
                    </FormField>
                  </div>
                </FormSection>

                {/* Service region */}
                <FormSection
                  title="Service region"
                  description="Describe the geographic area your organization primarily operates in. This helps seekers and ORAN verify coverage gaps."
                >
                  <FormField
                    id="org-region"
                    label="Service region"
                    hint="e.g. 'Maricopa County, AZ' or 'ZIP codes 85001–85099' or 'Phoenix metro area'."
                  >
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
                      <input
                        id="org-region"
                        type="text"
                        value={form.serviceRegion}
                        onChange={(e) => setField('serviceRegion', e.target.value)}
                        maxLength={500}
                        className="block w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                        placeholder="e.g. Maricopa County, AZ"
                      />
                    </div>
                  </FormField>
                </FormSection>

                {/* Social links */}
                <FormSection
                  title="Social & contact links"
                  description="Add links to help seekers find and follow your organization. Only non-empty links are displayed publicly."
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
                      <FormField key={key} id={`social-${key}`} label={label}>
                        <input
                          id={`social-${key}`}
                          type={key === 'phone' ? 'tel' : 'url'}
                          value={form.socialLinks[key] ?? ''}
                          onChange={(e) => setSocial(key, e.target.value)}
                          maxLength={2000}
                          className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                          placeholder={placeholder}
                        />
                      </FormField>
                    ))}
                  </div>
                </FormSection>

                <div className="flex justify-end pb-8">
                  <Button
                    onClick={() => void handleSave()}
                    disabled={isSaving}
                    className="gap-2 min-w-[120px]"
                  >
                    {isSaving
                      ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      : <Save className="h-4 w-4" aria-hidden="true" />
                    }
                    {isSaving ? 'Saving…' : 'Save profile'}
                  </Button>
                </div>
              </div>

              {/* ─── Right column: sidebar ─── */}
              <div className="space-y-5">
                {/* Completeness */}
                <CompletenessBar form={form} org={org} />

                {/* Verified badge */}
                <VerifiedBadge verifiedAt={org.verifiedAt} />

                {/* Tips */}
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                  <div className="flex items-center gap-2 font-semibold mb-2">
                    <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Profile tips
                  </div>
                  <ul className="space-y-1.5 list-disc list-inside text-blue-700">
                    <li>A clear <strong>mission statement</strong> is the single biggest driver of seeker trust.</li>
                    <li><strong>Who we serve</strong> helps people self-identify before calling — fewer wrong-number inquiries.</li>
                    <li>A square logo at least 100×100 px looks best on map listing cards.</li>
                    <li>Verified orgs get a trust badge on every listing — keep your profile current to qualify.</li>
                  </ul>
                </div>

                {/* Quick links */}
                <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Quick links</p>
                  <Link href="/admins" className="flex items-center gap-2 text-sm text-action-base hover:underline">
                    <Users className="h-4 w-4" aria-hidden="true" />
                    Manage team members
                  </Link>
                  <Link href="/services" className="flex items-center gap-2 text-sm text-action-base hover:underline">
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    View active listings
                  </Link>
                  <Link href="/resource-studio" className="flex items-center gap-2 text-sm text-action-base hover:underline">
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    Resource Studio
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </ErrorBoundary>
    </div>
  );
}
