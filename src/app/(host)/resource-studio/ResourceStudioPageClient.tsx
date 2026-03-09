'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Building2, FileClock, Layers3, Plus, Send, ShieldCheck } from 'lucide-react';

import { ResourceSubmissionWorkspace } from '@/components/resource-submissions/ResourceSubmissionWorkspace';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';
import type { ResourceSubmissionCardSummary, ResourceSubmissionReviewMeta } from '@/domain/resourceSubmission';

interface OrganizationOption {
  id: string;
  name: string;
}

interface ResourceStudioListItem {
  id: string;
  submissionId: string;
  status: string;
  submissionType: string;
  channel: 'host' | 'public';
  variant: 'listing' | 'claim';
  title: string | null;
  updatedAt: string;
  submittedAt: string | null;
  ownerOrganizationId: string | null;
  cards: ResourceSubmissionCardSummary[];
  summary: {
    organizationName: string;
    serviceName: string;
    sourceName: string;
  };
  reviewMeta: ResourceSubmissionReviewMeta;
}

type StudioFilter = 'all' | 'draft' | 'active' | 'returned' | 'resolved';

const STUDIO_FILTERS: Array<{
  key: StudioFilter;
  label: string;
  matches: (status: string) => boolean;
}> = [
  { key: 'all', label: 'All', matches: () => true },
  { key: 'draft', label: 'Drafts', matches: (status) => status === 'draft' },
  {
    key: 'active',
    label: 'In Review',
    matches: (status) => ['submitted', 'needs_review', 'under_review', 'escalated', 'pending_second_approval'].includes(status),
  },
  { key: 'returned', label: 'Returned', matches: (status) => status === 'returned' },
  {
    key: 'resolved',
    label: 'Resolved',
    matches: (status) => ['approved', 'denied', 'archived', 'withdrawn'].includes(status),
  },
];

function formatDate(value: string | null): string {
  if (!value) return 'Not yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusTone(status: string): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-100 text-emerald-800';
    case 'denied':
      return 'bg-rose-100 text-rose-800';
    case 'returned':
      return 'bg-amber-100 text-amber-900';
    case 'under_review':
      return 'bg-sky-100 text-sky-900';
    case 'submitted':
    case 'needs_review':
    case 'pending_second_approval':
      return 'bg-violet-100 text-violet-900';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function completionSummary(cards: ResourceSubmissionCardSummary[]): { completed: number; total: number; missing: string[] } {
  const actionable = cards.filter((card) => card.id !== 'review');
  return {
    completed: actionable.filter((card) => card.state !== 'incomplete').length,
    total: actionable.length,
    missing: actionable.flatMap((card) => card.missing).slice(0, 3),
  };
}

function StudioLaunchCard({
  href,
  title,
  description,
  eyebrow,
  icon: Icon,
}: {
  href: string;
  title: string;
  description: string;
  eyebrow: string;
  icon: React.ElementType;
}) {
  return (
    <Link
      href={href}
      className="group rounded-3xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">{title}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{description}</p>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-action-base">
        Open workflow
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
    </Link>
  );
}

export default function ResourceStudioPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [organizationOptions, setOrganizationOptions] = useState<OrganizationOption[]>([]);
  const [orgOptionsLoaded, setOrgOptionsLoaded] = useState(false);
  const [submissions, setSubmissions] = useState<ResourceStudioListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<StudioFilter>('all');

  const compose = searchParams.get('compose');
  const entryId = searchParams.get('entryId');
  const existingServiceId = searchParams.get('serviceId');
  const requestedOrganizationId = searchParams.get('organizationId');
  const initialVariant = compose === 'claim' ? 'claim' : 'listing';
  const shouldOpenWorkspace = Boolean(entryId || existingServiceId || compose === 'listing' || compose === 'claim');

  const fetchOrganizations = useCallback(async () => {
    try {
      const res = await fetch('/api/host/organizations?limit=100');
      if (!res.ok) return;
      const json = (await res.json()) as { results?: OrganizationOption[] };
      setOrganizationOptions(json.results ?? []);
    } finally {
      setOrgOptionsLoaded(true);
    }
  }, []);

  const fetchSubmissions = useCallback(async () => {
    setIsLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/resource-submissions');
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Unable to load resource studio.');
      }
      const json = (await res.json()) as { results?: ResourceStudioListItem[] };
      setSubmissions((json.results ?? []).filter((entry) => entry.channel === 'host'));
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Unable to load resource studio.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrganizations();
    if (!shouldOpenWorkspace) {
      void fetchSubmissions();
    }
  }, [fetchOrganizations, fetchSubmissions, shouldOpenWorkspace]);

  const defaultOwnerOrganizationId = useMemo(() => {
    if (requestedOrganizationId) return requestedOrganizationId;
    if (organizationOptions.length === 1) return organizationOptions[0].id;
    return null;
  }, [organizationOptions, requestedOrganizationId]);

  const filteredSubmissions = useMemo(() => {
    const filter = STUDIO_FILTERS.find((entry) => entry.key === activeFilter) ?? STUDIO_FILTERS[0];
    return submissions.filter((entry) => filter.matches(entry.status));
  }, [activeFilter, submissions]);

  const filterCounts = useMemo(() => (
    Object.fromEntries(
      STUDIO_FILTERS.map((filter) => [filter.key, submissions.filter((entry) => filter.matches(entry.status)).length]),
    ) as Record<StudioFilter, number>
  ), [submissions]);

  const handleEntryReady = useCallback((entry: { instanceId: string }) => {
    if (entryId === entry.instanceId) return;
    const next = new URLSearchParams();
    next.set('entryId', entry.instanceId);
    router.replace(`/resource-studio?${next.toString()}`, { scroll: false });
  }, [entryId, router]);

  const shouldDelayWorkspace =
    shouldOpenWorkspace &&
    compose === 'listing' &&
    !entryId &&
    !existingServiceId &&
    !requestedOrganizationId &&
    !orgOptionsLoaded;

  if (shouldDelayWorkspace) {
    return (
      <div className="flex min-h-80 items-center justify-center rounded-3xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <Layers3 className="h-4 w-4" aria-hidden="true" />
          Preparing Resource Studio…
        </div>
      </div>
    );
  }

  if (shouldOpenWorkspace) {
    return (
      <ResourceSubmissionWorkspace
        portal="host"
        initialVariant={initialVariant}
        initialChannel="host"
        pageEyebrow="Host workspace"
        pageTitle={initialVariant === 'claim' ? 'Claim an Organization' : 'Resource Studio'}
        pageSubtitle={
          initialVariant === 'claim'
            ? 'Complete a structured ownership claim with the same review data admins will see.'
            : 'Build or revise a listing through one card-based workflow that keeps draft, provenance, review, and publishing in sync.'
        }
        entryId={entryId}
        existingServiceId={existingServiceId}
        defaultOwnerOrganizationId={defaultOwnerOrganizationId}
        organizationOptions={organizationOptions}
        backHref="/resource-studio"
        backLabel="Back to resource studio"
        onEntryReady={handleEntryReady}
      />
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Host workspace"
        title="Resource Studio"
        icon={<Layers3 className="h-6 w-6" aria-hidden="true" />}
        subtitle="One studio for new listings, claims, drafts in review, and returned fixes. The cards your team completes are the same cards admins review."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Drafts stay structured and auditable</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Review state stays attached to the same submission</PageHeaderBadge>
            <PageHeaderBadge>{submissions.length} tracked submissions</PageHeaderBadge>
          </>
        )}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href={defaultOwnerOrganizationId ? `/resource-studio?compose=listing&organizationId=${defaultOwnerOrganizationId}` : '/resource-studio?compose=listing'}>
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New listing
              </Button>
            </Link>
            <Link href="/resource-studio?compose=claim">
              <Button size="sm" variant="outline" className="gap-1">
                <Send className="h-4 w-4" aria-hidden="true" />
                Claim org
              </Button>
            </Link>
          </div>
        )}
      />

      {listError && (
        <FormAlert variant="error" message={listError} onDismiss={() => setListError(null)} />
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <StudioLaunchCard
          href={defaultOwnerOrganizationId ? `/resource-studio?compose=listing&organizationId=${defaultOwnerOrganizationId}` : '/resource-studio?compose=listing'}
          eyebrow="Listing workflow"
          title="Start a new resource listing"
          description="Create a full service submission with organization, contact, location, taxonomy, access, evidence, and trust metadata in one place."
          icon={ShieldCheck}
        />
        <StudioLaunchCard
          href="/resource-studio?compose=claim"
          eyebrow="Ownership workflow"
          title="Submit an organization claim"
          description="Use the same card system for ownership claims so ORAN admins review the exact structure your team sees while drafting."
          icon={Building2}
        />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Submission activity</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Continue work without losing review context</h2>
            <p className="mt-1 text-sm text-slate-600">
              Drafts, submitted items, and returned fixes all reopen in the same card workflow.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {STUDIO_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  activeFilter === filter.key
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {filter.label} ({filterCounts[filter.key] ?? 0})
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
            <FileClock className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
            <h3 className="mt-3 text-lg font-semibold text-slate-900">No submissions in this lane yet</h3>
            <p className="mt-2 text-sm text-slate-600">
              Start a new listing or claim, then return here to continue drafts, review returned notes, and reopen items already in flight.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {filteredSubmissions.map((item) => {
              const completion = completionSummary(item.cards);
              return (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                        {item.variant === 'claim' ? 'Claim submission' : 'Resource listing'}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-900">
                        {item.title || item.summary.serviceName || item.summary.organizationName || 'Untitled submission'}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {item.summary.organizationName || 'Organization pending'}{item.summary.serviceName ? ` · ${item.summary.serviceName}` : ''}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
                      {item.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                    <div>
                      <span className="font-medium text-slate-900">Updated</span>
                      <div>{formatDate(item.updatedAt)}</div>
                    </div>
                    <div>
                      <span className="font-medium text-slate-900">Submitted</span>
                      <div>{formatDate(item.submittedAt)}</div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl bg-white p-4">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-slate-900">Required cards complete</span>
                      <span className="text-slate-600">{completion.completed}/{completion.total}</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${completion.total === 0 ? 0 : (completion.completed / completion.total) * 100}%` }}
                      />
                    </div>
                    {completion.missing.length > 0 && (
                      <p className="mt-3 text-sm text-slate-600">
                        Missing: {completion.missing.join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      Reviewer lane: {item.reviewMeta.targetType || 'pending'}
                    </div>
                    <Link href={`/resource-studio?entryId=${item.id}`}>
                      <Button size="sm" className="gap-1">
                        Open cards
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
