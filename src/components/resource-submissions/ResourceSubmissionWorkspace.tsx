'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Loader2,
  MapPin,
  Plus,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/toast';
import { CategoryPicker } from '@/components/ui/category-picker';
import { CoTagSuggestionPanel } from '@/components/resource-submissions/CoTagSuggestionPanel';
import { PhoneEditor, type PhoneEntry } from '@/components/ui/phone-editor';
import { ScheduleEditor, type WeekSchedule } from '@/components/ui/schedule-editor';
import type { FormInstance } from '@/domain/forms';
import type {
  ResourceLocationDraft,
  ResourceSubmissionCardSummary,
  ResourceSubmissionChannel,
  ResourceSubmissionDraft,
  ResourceSubmissionReviewMeta,
  ResourceSubmissionVariant,
} from '@/domain/resourceSubmission';

type PortalKind = 'host' | 'public' | 'community_admin' | 'oran_admin';
type WorkspaceAction = 'save' | 'submit' | 'start_review' | 'approve' | 'deny' | 'return' | 'escalate';

interface ResourceSubmissionTransition {
  id: string;
  from_status: string;
  to_status: string;
  actor_user_id: string;
  actor_role: string | null;
  actor_display_name: string | null;
  reason: string | null;
  created_at: string;
}

interface ResourceSubmissionDetail {
  instance: FormInstance;
  draft: ResourceSubmissionDraft;
  cards: ResourceSubmissionCardSummary[];
  reviewMeta: ResourceSubmissionReviewMeta;
  transitions: ResourceSubmissionTransition[];
}

interface OrganizationOption {
  id: string;
  name: string;
}

interface ResourceSubmissionWorkspaceProps {
  portal: PortalKind;
  initialVariant: ResourceSubmissionVariant;
  initialChannel: ResourceSubmissionChannel;
  pageTitle: string;
  pageEyebrow: string;
  pageSubtitle: string;
  entryId?: string | null;
  existingServiceId?: string | null;
  defaultOwnerOrganizationId?: string | null;
  organizationOptions?: OrganizationOption[];
  backHref?: string;
  backLabel?: string;
  onEntryReady?: (entry: { instanceId: string; submissionId: string; status: string }) => void;
}

const PUBLIC_DRAFT_STORAGE_KEY = 'oran:public-resource-submission';

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function stateTone(state: ResourceSubmissionCardSummary['state']): string {
  switch (state) {
    case 'complete':
      return 'border-emerald-300 bg-emerald-50';
    case 'recommended':
      return 'border-amber-300 bg-amber-50';
    default:
      return 'border-slate-200 bg-white';
  }
}

function statusTone(status: string | null | undefined): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-100 text-emerald-800';
    case 'denied':
      return 'bg-rose-100 text-rose-800';
    case 'returned':
      return 'bg-amber-100 text-amber-800';
    case 'under_review':
      return 'bg-blue-100 text-blue-800';
    case 'needs_review':
    case 'submitted':
      return 'bg-violet-100 text-violet-800';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function emptyLocation(): ResourceLocationDraft {
  return {
    name: '',
    description: '',
    transportation: '',
    address1: '',
    address2: '',
    city: '',
    region: '',
    stateProvince: '',
    postalCode: '',
    country: 'US',
    latitude: '',
    longitude: '',
    phones: [],
    languages: [],
    accessibility: [],
    schedule: [
      { day: 'Monday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Tuesday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Wednesday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Thursday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Friday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Saturday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Sunday', opens: '09:00', closes: '17:00', closed: true },
    ],
  };
}

function normalizePhoneEntries(phones: PhoneEntry[]): ResourceSubmissionDraft['service']['phones'] {
  return phones.map((phone) => ({
    number: phone.number,
    extension: phone.extension ?? '',
    type: phone.type,
    description: phone.description ?? '',
  }));
}

function CardStatusBadge({ card }: { card: ResourceSubmissionCardSummary }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(card.state)}`}>
      {card.requiredCompleted}/{card.requiredTotal} required
    </span>
  );
}

function ArrayChipsEditor({
  label,
  values,
  onChange,
  placeholder,
  readOnly = false,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState('');

  const addValue = () => {
    const next = draft.trim();
    if (!next) return;
    if (!values.includes(next)) {
      onChange([...values, next]);
    }
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700"
            >
              {value}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onChange(values.filter((entry) => entry !== value))}
                  className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                  aria-label={`Remove ${value}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addValue();
              }
            }}
            placeholder={placeholder}
            className="min-h-[44px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-0 transition focus:border-blue-500"
          />
          <Button type="button" variant="outline" onClick={addValue} className="gap-1">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

export function ResourceSubmissionWorkspace({
  portal,
  initialVariant,
  initialChannel,
  pageTitle,
  pageEyebrow,
  pageSubtitle,
  entryId = null,
  existingServiceId = null,
  defaultOwnerOrganizationId = null,
  organizationOptions = [],
  backHref,
  backLabel,
  onEntryReady,
}: ResourceSubmissionWorkspaceProps) {
  const { success, error, info } = useToast();
  const createdRef = useRef(false);
  const [detail, setDetail] = useState<ResourceSubmissionDetail | null>(null);
  const [draft, setDraft] = useState<ResourceSubmissionDraft | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [alert, setAlert] = useState<{ variant: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [publicAccessToken, setPublicAccessToken] = useState<string | null>(null);

  const cards = draft ? (detail?.cards ?? []) : [];
  const canReview = portal === 'community_admin' || portal === 'oran_admin';
  const canEdit = Boolean(draft) && (!canReview || ['submitted', 'needs_review', 'under_review', 'returned', 'draft'].includes(detail?.instance.status ?? 'draft'));

  useEffect(() => {
    if (!detail) return;
    onEntryReady?.({
      instanceId: detail.instance.id,
      submissionId: detail.instance.submission_id,
      status: detail.instance.status,
    });
  }, [detail, onEntryReady]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(PUBLIC_DRAFT_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as { id?: string; token?: string };
      if (parsed.token) {
        setPublicAccessToken(parsed.token);
      }
    } catch {
      // Ignore malformed storage.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function initialize() {
      setIsLoading(true);
      try {
        if (entryId) {
          const res = await fetch(`/api/resource-submissions/${entryId}`, {
            headers: publicAccessToken ? { 'x-resource-submission-token': publicAccessToken } : undefined,
            signal: controller.signal,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error ?? 'Failed to load submission.');
          }
          const json = (await res.json()) as { detail: ResourceSubmissionDetail };
          setDetail(json.detail);
          setDraft(json.detail.draft);
          setReviewerNotes(json.detail.reviewMeta.reviewerNotes ?? '');
          return;
        }

        if (createdRef.current) return;
        createdRef.current = true;

        let resumeId: string | null = null;
        let resumeToken: string | null = publicAccessToken;
        if (portal === 'public' && typeof window !== 'undefined') {
          const stored = window.localStorage.getItem(PUBLIC_DRAFT_STORAGE_KEY);
          if (stored) {
            try {
              const parsed = JSON.parse(stored) as { id?: string; token?: string };
              if (parsed.id && parsed.token) {
                resumeId = parsed.id;
                resumeToken = parsed.token;
              }
            } catch {
              // Ignore malformed storage.
            }
          }
        }

        if (resumeId && resumeToken) {
          const existing = await fetch(`/api/resource-submissions/${resumeId}`, {
            headers: { 'x-resource-submission-token': resumeToken },
            signal: controller.signal,
          });
          if (existing.ok) {
            const json = (await existing.json()) as { detail: ResourceSubmissionDetail };
            setPublicAccessToken(resumeToken);
            setDetail(json.detail);
            setDraft(json.detail.draft);
            setReviewerNotes(json.detail.reviewMeta.reviewerNotes ?? '');
            setIsLoading(false);
            return;
          }
        }

        const createRes = await fetch('/api/resource-submissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variant: initialVariant,
            channel: initialChannel,
            ownerOrganizationId: defaultOwnerOrganizationId,
            existingServiceId,
          }),
          signal: controller.signal,
        });
        if (!createRes.ok) {
          const body = (await createRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? 'Failed to create submission draft.');
        }
        const json = (await createRes.json()) as {
          detail: ResourceSubmissionDetail;
          publicAccessToken: string | null;
        };
        if (json.publicAccessToken && typeof window !== 'undefined') {
          window.localStorage.setItem(
            PUBLIC_DRAFT_STORAGE_KEY,
            JSON.stringify({ id: json.detail.instance.id, token: json.publicAccessToken }),
          );
          setPublicAccessToken(json.publicAccessToken);
        }
        setDetail(json.detail);
        setDraft(json.detail.draft);
        setReviewerNotes(json.detail.reviewMeta.reviewerNotes ?? '');
      } catch (loadError) {
        if ((loadError as Error).name === 'AbortError') return;
        setAlert({
          variant: 'error',
          message: loadError instanceof Error ? loadError.message : 'Unable to load submission workspace.',
        });
      } finally {
        setIsLoading(false);
      }
    }

    void initialize();

    return () => controller.abort();
  }, [defaultOwnerOrganizationId, entryId, existingServiceId, initialChannel, initialVariant, portal, publicAccessToken]);

  const currentStatus = detail?.instance.status ?? 'draft';

  const runAction = async (action: WorkspaceAction) => {
    if (!detail || !draft) return;
    setIsWorking(true);
    setAlert(null);
    try {
      const res = await fetch(`/api/resource-submissions/${detail.instance.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(publicAccessToken ? { 'x-resource-submission-token': publicAccessToken } : {}),
        },
        body: JSON.stringify({
          action,
          draft,
          notes: draft.evidence.notes,
          reviewerNotes,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; detail?: ResourceSubmissionDetail } | null;
      if (!res.ok || !body?.detail) {
        throw new Error(body?.error ?? 'Unable to update submission.');
      }

      setDetail(body.detail);
      setDraft(body.detail.draft);
      setReviewerNotes(body.detail.reviewMeta.reviewerNotes ?? reviewerNotes);

      if (action === 'submit' && portal === 'public' && typeof window !== 'undefined') {
        window.localStorage.removeItem(PUBLIC_DRAFT_STORAGE_KEY);
      }

      if (action === 'save') success('Draft saved.');
      if (action === 'submit') success('Resource submitted for review.');
      if (action === 'approve') success('Resource approved and published.');
      if (action === 'return') info('Submission returned to the submitter.');
      if (action === 'deny') info('Submission denied.');
      if (action === 'start_review') info('Review started.');
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'Unable to update submission.';
      setAlert({ variant: 'error', message });
      error(message);
    } finally {
      setIsWorking(false);
    }
  };

  const updateDraft = (updater: (current: ResourceSubmissionDraft) => ResourceSubmissionDraft) => {
    setDraft((current) => (current ? updater(current) : current));
  };

  const jumpToCard = (cardId: string) => {
    document.getElementById(`resource-card-${cardId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const hasCompleteRequiredCards = cards.filter((card) => card.id !== 'review').every((card) => card.state !== 'incomplete');

  if (isLoading || !draft || !detail) {
    return (
      <div className="flex min-h-80 items-center justify-center rounded-3xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Preparing resource workspace…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backHref && backLabel && (
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
      )}

      <PageHeader
        eyebrow={pageEyebrow}
        title={pageTitle}
        icon={<FileCheck2 className="h-6 w-6" aria-hidden="true" />}
        subtitle={pageSubtitle}
        badges={(
          <>
            <PageHeaderBadge tone="accent">{draft.variant === 'claim' ? 'Organization claim' : 'Resource listing'}</PageHeaderBadge>
            <PageHeaderBadge tone="trust">{draft.channel === 'host' ? 'Authenticated submitter' : 'Community submitter'}</PageHeaderBadge>
            <PageHeaderBadge>{currentStatus.replace(/_/g, ' ')}</PageHeaderBadge>
          </>
        )}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button variant="outline" onClick={() => void runAction('save')} disabled={isWorking} className="gap-2">
                {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Clock3 className="h-4 w-4" aria-hidden="true" />}
                Save draft
              </Button>
            )}
            {!canReview && (
              <Button onClick={() => void runAction('submit')} disabled={isWorking || !hasCompleteRequiredCards || !['draft', 'returned'].includes(currentStatus)} className="gap-2">
                {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                Submit for review
              </Button>
            )}
            {canReview && currentStatus !== 'under_review' && currentStatus !== 'approved' && currentStatus !== 'denied' && (
              <Button variant="outline" onClick={() => void runAction('start_review')} disabled={isWorking} className="gap-2">
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                Start review
              </Button>
            )}
          </div>
        )}
      />

      {alert && (
        <FormAlert
          variant={alert.variant === 'error' ? 'error' : alert.variant === 'success' ? 'success' : 'info'}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <aside className="space-y-4 xl:col-span-1">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">Completion</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {cards.filter((card) => card.state === 'complete').length}/{cards.length}
                </div>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(currentStatus)}`}>
                {currentStatus.replace(/_/g, ' ')}
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => jumpToCard(card.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition hover:border-slate-300 ${stateTone(card.state)}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{card.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{card.description}</div>
                    </div>
                    {card.state === 'complete' ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <CardStatusBadge card={card} />
                    <span className="text-xs text-slate-400">{card.state}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600 shadow-sm">
            <div className="font-semibold text-slate-900">Trust record</div>
            <div className="mt-3 space-y-2">
              <div>Submitted: {formatDateTime(detail.reviewMeta.submittedAt ?? detail.instance.created_at)}</div>
              <div>Assigned: {detail.reviewMeta.assignedToLabel ?? detail.reviewMeta.assignedToUserId ?? 'Unassigned'}</div>
              <div>Source record: {detail.reviewMeta.sourceRecordId ?? 'Created on submit'}</div>
              <div>Reverify: {formatDateTime(detail.reviewMeta.reverifyAt)}</div>
            </div>
          </div>
        </aside>

        <div className="space-y-6 xl:col-span-2">
          <section id="resource-card-organization" className={`rounded-3xl border p-6 shadow-sm ${stateTone(cards.find((card) => card.id === 'organization')?.state ?? 'incomplete')}`}>
            <FormSection
              title="Organization identity"
              description="Who provides the resource, which organization owns it, and how reviewers can verify that identity."
              action={<Building2 className="h-4 w-4 text-slate-500" aria-hidden="true" />}
            >
              {organizationOptions.length > 0 && draft.channel === 'host' && draft.variant === 'listing' && (
                <FormField id="resource-owner-org" label="Publishing organization" hint="Choose which host organization owns this listing.">
                  <select
                    id="resource-owner-org"
                    value={draft.ownerOrganizationId ?? ''}
                    onChange={(event) => updateDraft((current) => ({ ...current, ownerOrganizationId: event.target.value || null }))}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    disabled={!canEdit}
                  >
                    <option value="">Select an organization…</option>
                    {organizationOptions.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </FormField>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <FormField id="resource-org-name" label="Organization name" required>
                  <input
                    id="resource-org-name"
                    type="text"
                    value={draft.organization.name}
                    onChange={(event) => updateDraft((current) => ({ ...current, organization: { ...current.organization, name: event.target.value } }))}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField id="resource-org-url" label="Organization website">
                  <input
                    id="resource-org-url"
                    type="url"
                    value={draft.organization.url}
                    onChange={(event) => updateDraft((current) => ({ ...current, organization: { ...current.organization, url: event.target.value } }))}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    disabled={!canEdit}
                  />
                </FormField>
              </div>

              <FormField id="resource-org-description" label="Organization description" required>
                <textarea
                  id="resource-org-description"
                  value={draft.organization.description}
                  onChange={(event) => updateDraft((current) => ({ ...current, organization: { ...current.organization, description: event.target.value } }))}
                  rows={4}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                  disabled={!canEdit}
                />
              </FormField>

              <div className="grid gap-4 md:grid-cols-3">
                <FormField id="resource-org-email" label="Verification email">
                  <input
                    id="resource-org-email"
                    type="email"
                    value={draft.organization.email}
                    onChange={(event) => updateDraft((current) => ({ ...current, organization: { ...current.organization, email: event.target.value } }))}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField id="resource-org-phone" label="Verification phone">
                  <input
                    id="resource-org-phone"
                    type="tel"
                    value={draft.organization.phone}
                    onChange={(event) => updateDraft((current) => ({ ...current, organization: { ...current.organization, phone: event.target.value } }))}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField id="resource-org-tax-status" label="Tax status">
                  <input
                    id="resource-org-tax-status"
                    type="text"
                    value={draft.organization.taxStatus}
                    onChange={(event) => updateDraft((current) => ({ ...current, organization: { ...current.organization, taxStatus: event.target.value } }))}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    disabled={!canEdit}
                  />
                </FormField>
              </div>
            </FormSection>
          </section>

          {draft.variant === 'listing' && (
            <>
              <section id="resource-card-service" className={`rounded-3xl border p-6 shadow-sm ${stateTone(cards.find((card) => card.id === 'service')?.state ?? 'incomplete')}`}>
                <FormSection
                  title="Listing basics"
                  description="What the service is, what it does, and how a person reaches it."
                  action={<ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField id="resource-service-name" label="Service name" required>
                      <input
                        id="resource-service-name"
                        type="text"
                        value={draft.service.name}
                        onChange={(event) => updateDraft((current) => ({ ...current, service: { ...current.service, name: event.target.value } }))}
                        className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                        disabled={!canEdit}
                      />
                    </FormField>
                    <FormField id="resource-service-url" label="Service URL">
                      <input
                        id="resource-service-url"
                        type="url"
                        value={draft.service.url}
                        onChange={(event) => updateDraft((current) => ({ ...current, service: { ...current.service, url: event.target.value } }))}
                        className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                        disabled={!canEdit}
                      />
                    </FormField>
                  </div>

                  <FormField id="resource-service-description" label="Service description" required>
                    <textarea
                      id="resource-service-description"
                      value={draft.service.description}
                      onChange={(event) => updateDraft((current) => ({ ...current, service: { ...current.service, description: event.target.value } }))}
                      rows={4}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                      disabled={!canEdit}
                    />
                  </FormField>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField id="resource-service-email" label="Service email">
                      <input
                        id="resource-service-email"
                        type="email"
                        value={draft.service.email}
                        onChange={(event) => updateDraft((current) => ({ ...current, service: { ...current.service, email: event.target.value } }))}
                        className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                        disabled={!canEdit}
                      />
                    </FormField>
                    <FormField id="resource-service-application" label="Application process">
                      <input
                        id="resource-service-application"
                        type="text"
                        value={draft.service.applicationProcess}
                        onChange={(event) => updateDraft((current) => ({ ...current, service: { ...current.service, applicationProcess: event.target.value } }))}
                        className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                        disabled={!canEdit}
                      />
                    </FormField>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <FormField id="resource-service-fees" label="Fees">
                      <input
                        id="resource-service-fees"
                        type="text"
                        value={draft.service.fees}
                        onChange={(event) => updateDraft((current) => ({ ...current, service: { ...current.service, fees: event.target.value } }))}
                        className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                        disabled={!canEdit}
                      />
                    </FormField>
                    <FormField id="resource-service-wait" label="Wait time">
                      <input
                        id="resource-service-wait"
                        type="text"
                        value={draft.service.waitTime}
                        onChange={(event) => updateDraft((current) => ({ ...current, service: { ...current.service, waitTime: event.target.value } }))}
                        className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                        disabled={!canEdit}
                      />
                    </FormField>
                    <FormField id="resource-service-interpretation" label="Interpretation services">
                      <input
                        id="resource-service-interpretation"
                        type="text"
                        value={draft.service.interpretationServices}
                        onChange={(event) => updateDraft((current) => ({ ...current, service: { ...current.service, interpretationServices: event.target.value } }))}
                        className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                        disabled={!canEdit}
                      />
                    </FormField>
                  </div>

                  <PhoneEditor
                    phones={draft.service.phones as PhoneEntry[]}
                    onChange={(phones) => updateDraft((current) => ({ ...current, service: { ...current.service, phones: normalizePhoneEntries(phones) } }))}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  />
                </FormSection>
              </section>

              <section id="resource-card-locations" className={`rounded-3xl border p-6 shadow-sm ${stateTone(cards.find((card) => card.id === 'locations')?.state ?? 'incomplete')}`}>
                <FormSection
                  title="Locations and hours"
                  description="Each delivery location gets its own card, phones, hours, and access notes."
                  action={<MapPin className="h-4 w-4 text-slate-500" aria-hidden="true" />}
                >
                  <div className="space-y-6">
                    {draft.locations.map((location, index) => (
                      <div key={location.id ?? `location-${index}`} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                        <div className="mb-4 flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">Location {index + 1}</div>
                            <div className="text-xs text-slate-500">Keep at least one location with an address or city/state.</div>
                          </div>
                          {canEdit && draft.locations.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => updateDraft((current) => ({
                                ...current,
                                locations: current.locations.filter((_, locationIndex) => locationIndex !== index),
                              }))}
                              className="gap-2 text-rose-600 hover:text-rose-700"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Remove
                            </Button>
                          )}
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <FormField id={`location-name-${index}`} label="Location name">
                            <input
                              id={`location-name-${index}`}
                              type="text"
                              value={location.name}
                              onChange={(event) => updateDraft((current) => ({
                                ...current,
                                locations: current.locations.map((entry, locationIndex) => locationIndex === index ? { ...entry, name: event.target.value } : entry),
                              }))}
                              className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                              disabled={!canEdit}
                            />
                          </FormField>
                          <FormField id={`location-transport-${index}`} label="Transportation notes">
                            <input
                              id={`location-transport-${index}`}
                              type="text"
                              value={location.transportation}
                              onChange={(event) => updateDraft((current) => ({
                                ...current,
                                locations: current.locations.map((entry, locationIndex) => locationIndex === index ? { ...entry, transportation: event.target.value } : entry),
                              }))}
                              className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                              disabled={!canEdit}
                            />
                          </FormField>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <FormField id={`location-address1-${index}`} label="Address line 1">
                            <input
                              id={`location-address1-${index}`}
                              type="text"
                              value={location.address1}
                              onChange={(event) => updateDraft((current) => ({
                                ...current,
                                locations: current.locations.map((entry, locationIndex) => locationIndex === index ? { ...entry, address1: event.target.value } : entry),
                              }))}
                              className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                              disabled={!canEdit}
                            />
                          </FormField>
                          <FormField id={`location-address2-${index}`} label="Address line 2">
                            <input
                              id={`location-address2-${index}`}
                              type="text"
                              value={location.address2}
                              onChange={(event) => updateDraft((current) => ({
                                ...current,
                                locations: current.locations.map((entry, locationIndex) => locationIndex === index ? { ...entry, address2: event.target.value } : entry),
                              }))}
                              className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                              disabled={!canEdit}
                            />
                          </FormField>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-4">
                          {([
                            ['city', 'City'],
                            ['stateProvince', 'State / province'],
                            ['postalCode', 'Postal code'],
                            ['country', 'Country'],
                          ] as const).map(([field, label]) => (
                            <FormField key={field} id={`location-${field}-${index}`} label={label}>
                              <input
                                id={`location-${field}-${index}`}
                                type="text"
                                value={location[field]}
                                onChange={(event) => updateDraft((current) => ({
                                  ...current,
                                  locations: current.locations.map((entry, locationIndex) => locationIndex === index ? { ...entry, [field]: event.target.value } : entry),
                                }))}
                                className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                                disabled={!canEdit}
                              />
                            </FormField>
                          ))}
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <ArrayChipsEditor
                            label="Languages"
                            values={location.languages}
                            onChange={(values) => updateDraft((current) => ({
                              ...current,
                              locations: current.locations.map((entry, locationIndex) => locationIndex === index ? { ...entry, languages: values } : entry),
                            }))}
                            placeholder="English, Spanish, ASL…"
                            readOnly={!canEdit}
                          />
                          <ArrayChipsEditor
                            label="Accessibility"
                            values={location.accessibility}
                            onChange={(values) => updateDraft((current) => ({
                              ...current,
                              locations: current.locations.map((entry, locationIndex) => locationIndex === index ? { ...entry, accessibility: values } : entry),
                            }))}
                            placeholder="Wheelchair entrance, elevator…"
                            readOnly={!canEdit}
                          />
                        </div>

                        <PhoneEditor
                          phones={location.phones as PhoneEntry[]}
                          onChange={(phones) => updateDraft((current) => ({
                            ...current,
                            locations: current.locations.map((entry, locationIndex) => locationIndex === index ? { ...entry, phones: normalizePhoneEntries(phones) } : entry),
                          }))}
                          className="mt-5 rounded-2xl border border-slate-200 bg-white p-4"
                        />

                        <ScheduleEditor
                          schedule={location.schedule as WeekSchedule}
                          onChange={(schedule) => updateDraft((current) => ({
                            ...current,
                            locations: current.locations.map((entry, locationIndex) => locationIndex === index ? { ...entry, schedule: schedule as ResourceLocationDraft['schedule'] } : entry),
                          }))}
                          className="mt-5 rounded-2xl border border-slate-200 bg-white p-4"
                        />
                      </div>
                    ))}

                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => updateDraft((current) => ({ ...current, locations: [...current.locations, emptyLocation()] }))}
                        className="gap-2"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add another location
                      </Button>
                    )}
                  </div>
                </FormSection>
              </section>

              <section id="resource-card-taxonomy" className={`rounded-3xl border p-6 shadow-sm ${stateTone(cards.find((card) => card.id === 'taxonomy')?.state ?? 'incomplete')}`}>
                <FormSection
                  title="Taxonomy and tags"
                  description="Pick the closest standard categories first, then add custom taxonomy terms only when required."
                >
                  <CategoryPicker
                    selected={draft.taxonomy.categories}
                    onChange={(categories) => updateDraft((current) => ({ ...current, taxonomy: { ...current.taxonomy, categories } }))}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  />
                  {draft.taxonomy.categories.length > 0 && (
                    <CoTagSuggestionPanel
                      selectedCategories={draft.taxonomy.categories}
                      customTerms={draft.taxonomy.customTerms}
                      onAddTag={(updatedTerms) =>
                        updateDraft((current) => ({
                          ...current,
                          taxonomy: { ...current.taxonomy, customTerms: updatedTerms },
                        }))
                      }
                      readOnly={!canEdit}
                      className="mt-4"
                    />
                  )}
                  <div className="mt-4">
                    <ArrayChipsEditor
                      label="Custom taxonomy terms"
                      values={draft.taxonomy.customTerms}
                      onChange={(customTerms) => updateDraft((current) => ({ ...current, taxonomy: { ...current.taxonomy, customTerms } }))}
                      placeholder="Add a precise local or program term"
                      readOnly={!canEdit}
                    />
                  </div>
                </FormSection>
              </section>

              <section id="resource-card-access" className={`rounded-3xl border p-6 shadow-sm ${stateTone(cards.find((card) => card.id === 'access')?.state ?? 'incomplete')}`}>
                <FormSection
                  title="Access and eligibility"
                  description="Spell out who can use the resource, where it applies, and what a person may need before arriving."
                >
                  <div>
                    <ArrayChipsEditor
                      label="Service areas"
                      values={draft.access.serviceAreas}
                      onChange={(serviceAreas) => updateDraft((current) => ({ ...current, access: { ...current.access, serviceAreas } }))}
                      placeholder="County, city, ZIP, statewide…"
                      readOnly={!canEdit}
                    />
                    {!canEdit ? null : (
                      <div className="mt-2">
                        <p className="mb-1.5 text-xs text-slate-500">
                          Quick-add scope · or type a ZIP code, city, or county name above
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(['Statewide', 'Countywide', 'Online only', 'National', 'Virtual/Telehealth'] as const).map((scope) => {
                            const alreadyAdded = draft.access.serviceAreas.includes(scope);
                            return (
                              <button
                                key={scope}
                                type="button"
                                disabled={alreadyAdded}
                                onClick={() => {
                                  if (!alreadyAdded) {
                                    updateDraft((current) => ({
                                      ...current,
                                      access: {
                                        ...current.access,
                                        serviceAreas: [...current.access.serviceAreas, scope],
                                      },
                                    }));
                                  }
                                }}
                                className={[
                                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border transition-all',
                                  alreadyAdded
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 cursor-default'
                                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700',
                                ].join(' ')}
                                aria-pressed={alreadyAdded}
                              >
                                {alreadyAdded ? '✓ ' : '+ '}{scope}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                          Examples: <span className="font-mono">94102</span> (ZIP) · <span className="font-mono">San Francisco</span> (city) · <span className="font-mono">Alameda County</span> (county)
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <FormField id="resource-eligibility-description" label="Eligibility and access notes" required>
                      <textarea
                        id="resource-eligibility-description"
                        value={draft.access.eligibilityDescription}
                        onChange={(event) => updateDraft((current) => ({ ...current, access: { ...current.access, eligibilityDescription: event.target.value } }))}
                        rows={4}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                        disabled={!canEdit}
                      />
                    </FormField>
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField id="resource-min-age" label="Minimum age">
                          <input
                            id="resource-min-age"
                            type="text"
                            value={draft.access.minimumAge}
                            onChange={(event) => updateDraft((current) => ({ ...current, access: { ...current.access, minimumAge: event.target.value } }))}
                            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                            disabled={!canEdit}
                          />
                        </FormField>
                        <FormField id="resource-max-age" label="Maximum age">
                          <input
                            id="resource-max-age"
                            type="text"
                            value={draft.access.maximumAge}
                            onChange={(event) => updateDraft((current) => ({ ...current, access: { ...current.access, maximumAge: event.target.value } }))}
                            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                            disabled={!canEdit}
                          />
                        </FormField>
                      </div>

                      <ArrayChipsEditor
                        label="Service languages"
                        values={draft.access.languages}
                        onChange={(languages) => updateDraft((current) => ({ ...current, access: { ...current.access, languages } }))}
                        placeholder="English, Spanish, Vietnamese…"
                        readOnly={!canEdit}
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <ArrayChipsEditor
                      label="Required documents"
                      values={draft.access.requiredDocuments}
                      onChange={(requiredDocuments) => updateDraft((current) => ({ ...current, access: { ...current.access, requiredDocuments } }))}
                      placeholder="ID, proof of address, referral…"
                      readOnly={!canEdit}
                    />
                  </div>
                </FormSection>
              </section>
            </>
          )}

          <section id="resource-card-evidence" className={`rounded-3xl border p-6 shadow-sm ${stateTone(cards.find((card) => card.id === 'evidence')?.state ?? 'incomplete')}`}>
            <FormSection
              title="Evidence and source"
              description="Tell reviewers what you used, what is missing, and what should be checked before approval."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <FormField id="resource-source-name" label="Source name">
                  <input
                    id="resource-source-name"
                    type="text"
                    value={draft.evidence.sourceName}
                    onChange={(event) => updateDraft((current) => ({ ...current, evidence: { ...current.evidence, sourceName: event.target.value } }))}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField id="resource-source-url" label="Source URL">
                  <input
                    id="resource-source-url"
                    type="url"
                    value={draft.evidence.sourceUrl}
                    onChange={(event) => updateDraft((current) => ({ ...current, evidence: { ...current.evidence, sourceUrl: event.target.value } }))}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    disabled={!canEdit}
                  />
                </FormField>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField id="resource-contact-email" label="Verification contact email">
                  <input
                    id="resource-contact-email"
                    type="email"
                    value={draft.evidence.contactEmail}
                    onChange={(event) => updateDraft((current) => ({ ...current, evidence: { ...current.evidence, contactEmail: event.target.value } }))}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField id="resource-relationship" label="Submitter relationship">
                  <input
                    id="resource-relationship"
                    type="text"
                    value={draft.evidence.submitterRelationship}
                    onChange={(event) => updateDraft((current) => ({ ...current, evidence: { ...current.evidence, submitterRelationship: event.target.value } }))}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    disabled={!canEdit}
                  />
                </FormField>
              </div>

              <FormField id="resource-evidence-notes" label="Reviewer notes and evidence summary" required>
                <textarea
                  id="resource-evidence-notes"
                  value={draft.evidence.notes}
                  onChange={(event) => updateDraft((current) => ({ ...current, evidence: { ...current.evidence, notes: event.target.value } }))}
                  rows={5}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                  disabled={!canEdit}
                />
              </FormField>
            </FormSection>
          </section>

          <section id="resource-card-review" className={`rounded-3xl border p-6 shadow-sm ${stateTone(cards.find((card) => card.id === 'review')?.state ?? 'recommended')}`}>
            <FormSection
              title="Review and trust"
              description="This card shows submitter, reviewer, workflow history, and the next action for this record."
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">Record metadata</div>
                  <dl className="mt-3 space-y-2 text-sm text-slate-600">
                    <div className="flex items-start justify-between gap-4"><dt>Status</dt><dd className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(detail.reviewMeta.status)}`}>{detail.reviewMeta.status?.replace(/_/g, ' ') ?? 'draft'}</dd></div>
                    <div className="flex items-start justify-between gap-4"><dt>Submitted by</dt><dd>{detail.reviewMeta.submittedByLabel ?? detail.reviewMeta.submittedByUserId ?? 'Unknown'}</dd></div>
                    <div className="flex items-start justify-between gap-4"><dt>Assigned to</dt><dd>{detail.reviewMeta.assignedToLabel ?? detail.reviewMeta.assignedToUserId ?? 'Unassigned'}</dd></div>
                    <div className="flex items-start justify-between gap-4"><dt>Submitted</dt><dd>{formatDateTime(detail.reviewMeta.submittedAt ?? detail.instance.created_at)}</dd></div>
                    <div className="flex items-start justify-between gap-4"><dt>Reviewed</dt><dd>{formatDateTime(detail.reviewMeta.reviewedAt)}</dd></div>
                    <div className="flex items-start justify-between gap-4"><dt>Resolved</dt><dd>{formatDateTime(detail.reviewMeta.resolvedAt)}</dd></div>
                  </dl>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">Workflow timeline</div>
                  <ol className="mt-4 space-y-3">
                    {detail.transitions.length === 0 ? (
                      <li className="text-sm text-slate-500">No workflow events recorded yet.</li>
                    ) : detail.transitions.map((transition) => (
                      <li key={transition.id} className="rounded-2xl border border-slate-200 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-900">{transition.from_status} → {transition.to_status}</div>
                          <div className="text-xs text-slate-400">{formatDateTime(transition.created_at)}</div>
                        </div>
                        <div className="mt-1 text-sm text-slate-600">{transition.actor_display_name ?? transition.actor_user_id}</div>
                        {transition.reason && (
                          <div className="mt-2 text-sm text-slate-500">{transition.reason}</div>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {canReview && (
                <div className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <FormField id="resource-reviewer-notes" label="Reviewer notes">
                    <textarea
                      id="resource-reviewer-notes"
                      value={reviewerNotes}
                      onChange={(event) => setReviewerNotes(event.target.value)}
                      rows={4}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                    />
                  </FormField>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void runAction('approve')} disabled={isWorking} className="gap-2">
                      {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                      Approve
                    </Button>
                    <Button variant="outline" onClick={() => void runAction('return')} disabled={isWorking} className="gap-2">
                      Return for edits
                    </Button>
                    <Button variant="outline" onClick={() => void runAction('escalate')} disabled={isWorking} className="gap-2">
                      Escalate
                    </Button>
                    <Button variant="ghost" onClick={() => void runAction('deny')} disabled={isWorking} className="gap-2 text-rose-600 hover:text-rose-700">
                      Deny
                    </Button>
                  </div>
                </div>
              )}
            </FormSection>
          </section>
        </div>
      </div>
    </div>
  );
}
