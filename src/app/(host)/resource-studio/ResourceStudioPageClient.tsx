'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Building2, FileClock, Layers3, Plus, RefreshCw, Send, ShieldCheck } from 'lucide-react';

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
      return 'border-[var(--text-primary)] bg-[var(--text-primary)] text-white';
    case 'denied':
      return 'border-[var(--color-error-accent)] bg-[var(--color-error-muted)] text-[var(--color-error-deep)]';
    case 'returned':
      return 'border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]';
    case 'under_review':
      return 'border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]';
    case 'submitted':
    case 'needs_review':
    case 'pending_second_approval':
      return 'border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]';
    default:
      return 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)]';
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
      className="group rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 transition hover:-translate-y-0.5 hover:border-[var(--text-muted)] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] focus-visible:ring-offset-1"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">{title}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-3 text-[var(--text-secondary)]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
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
      <div className="flex min-h-80 items-center justify-center rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
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

      <section className="rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)] p-6">
        <div className="flex flex-col gap-4 border-b border-[var(--border-subtle)] pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Submission activity</p>
            <h2 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">Continue work without losing review context</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Drafts, submitted items, and returned fixes all reopen in the same card workflow.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {STUDIO_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={`inline-flex min-h-[44px] items-center rounded-full px-3 text-sm font-medium transition ${
                  activeFilter === filter.key
                    ? 'bg-[var(--text-primary)] text-white'
                    : 'border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {filter.label} ({filterCounts[filter.key] ?? 0})
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 shrink-0"
            onClick={() => void fetchSubmissions()}
            disabled={isLoading}
            aria-label="Refresh submission list"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-surface-alt)] px-6 py-10 text-center">
            <FileClock className="mx-auto h-8 w-8 text-[var(--text-muted)]" aria-hidden="true" />
            <h3 className="mt-3 text-lg font-semibold text-[var(--text-primary)]">No submissions in this lane yet</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Start a new listing or claim, then return here to continue drafts, review returned notes, and reopen items already in flight.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {filteredSubmissions.map((item) => {
              const completion = completionSummary(item.cards);
              return (
                <div key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                        {item.variant === 'claim' ? 'Claim submission' : 'Resource listing'}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                        {item.title || item.summary.serviceName || item.summary.organizationName || 'Untitled submission'}
                      </h3>
                      <p className="mt-1 text-sm text-[var(--text-secondary)]">
                        {item.summary.organizationName || 'Organization pending'}{item.summary.serviceName ? ` · ${item.summary.serviceName}` : ''}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
                      {item.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-[var(--text-secondary)] sm:grid-cols-2">
                    <div>
                      <span className="font-medium text-[var(--text-primary)]">Updated</span>
                      <div>{formatDate(item.updatedAt)}</div>
                    </div>
                    <div>
                      <span className="font-medium text-[var(--text-primary)]">Submitted</span>
                      <div>{formatDate(item.submittedAt)}</div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-[var(--text-primary)]">Required cards complete</span>
                      <span className="text-[var(--text-secondary)]">{completion.completed}/{completion.total}</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                      <div
                        className={`h-full rounded-full transition-all ${
                          completion.total === 0
                            ? 'bg-[var(--color-action-pale)]'
                            : completion.completed / completion.total >= 0.8
                            ? 'bg-[var(--text-primary)]'
                            : completion.completed / completion.total >= 0.5
                            ? 'bg-[var(--text-secondary)]'
                            : 'bg-[var(--text-muted)]'
                        }`}
                        style={{ width: `${completion.total === 0 ? 0 : (completion.completed / completion.total) * 100}%` }}
                      />
                    </div>
                    {completion.missing.length > 0 && (
                      <p className="mt-3 text-sm text-[var(--text-secondary)]">
                        Missing: {completion.missing.join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-[var(--text-muted)]">
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
