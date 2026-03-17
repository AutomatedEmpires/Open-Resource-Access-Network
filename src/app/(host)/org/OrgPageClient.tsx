/**
 * /org — Organization dashboard
 *
 * Organization records remain visible here, while structured edits now flow
 * through Resource Studio so organization changes stay attached to the same
 * submission-backed review workflow as listing edits.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Building2,
  ExternalLink,
  FilePenLine,
  Mail,
  Plus,
  Search,
  UserCog,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';

interface OrgApiRow {
  id: string;
  name: string;
  description?: string | null;
  url?: string | null;
  email?: string | null;
  tax_status?: string | null;
  tax_id?: string | null;
  year_incorporated?: number | null;
  legal_status?: string | null;
  status?: 'active' | 'inactive' | 'defunct' | null;
  verified_at?: string | null;
  mission_statement?: string | null;
}

interface OrgListResponse {
  results: OrgApiRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

const LIMIT = 12;

export default function OrgDashboardPage() {
  const [data, setData] = useState<OrgListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');

  const fetchOrgs = useCallback(async (nextPage: number, nextQuery: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: String(LIMIT) });
      if (nextQuery.trim()) params.set('q', nextQuery.trim());

      const res = await fetch(`/api/host/organizations?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load organizations');
      }

      const json = (await res.json()) as OrgListResponse;
      setData(json);
      setPage(nextPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load organizations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrgs(1, '');
  }, [fetchOrgs]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    void fetchOrgs(1, query);
  };

  const visibleCount = data?.results.length ?? 0;
  const verifiedCount = data?.results.filter((org) => Boolean(org.verified_at)).length ?? 0;
  const profileFollowUpCount = data?.results.filter((org) => !org.url || !org.email || !org.verified_at).length ?? 0;

  const workspaceLanes = [
    {
      href: '/resource-studio',
      label: 'Resource Studio',
      description: 'Continue claims, drafts, and submission-backed org updates from one place.',
      icon: FilePenLine,
    },
    {
      href: '/org/profile',
      label: 'Trust Profile',
      description: 'Complete verification, trust, and public identity fields that reviewers depend on.',
      icon: UserCog,
    },
    {
      href: '/services',
      label: 'Services',
      description: 'Maintain the seeker-facing service inventory attached to each organization.',
      icon: Award,
    },
    {
      href: '/admins',
      label: 'Team Access',
      description: 'Keep org ownership clear by inviting or pruning host operators.',
      icon: Plus,
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Host workspace"
        title="Organizations"
        icon={<Building2 className="h-6 w-6" aria-hidden="true" />}
        subtitle={
          <>
            Keep organization records visible here, then open Resource Studio to revise the structured organization packet that reviewers see alongside listing changes.{' '}
            <Link href="/resource-studio?compose=claim" className="text-action-base hover:underline">
              Claim a new organization
            </Link>
            .
          </>
        }
        badges={(
          <>
            <PageHeaderBadge tone="trust">Organization edits now stay attached to the submission audit trail</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Published org state remains visible here</PageHeaderBadge>
            <PageHeaderBadge>{data ? `${data.total} total` : 'Loading organizations'}</PageHeaderBadge>
          </>
        )}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href="/resource-studio?compose=listing">
              <Button size="sm" variant="outline" className="gap-1">
                <FilePenLine className="h-4 w-4" aria-hidden="true" />
                Resource Studio
              </Button>
            </Link>
            <Link href="/resource-studio?compose=claim">
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Claim
              </Button>
            </Link>
          </div>
        )}
      />

      <ErrorBoundary>
        <FormSection
          title="Find organizations"
          description="Search the published organization list, then jump into Resource Studio to continue a structured update flow."
          className="mb-4"
        >
          <form onSubmit={handleSearch} className="flex gap-2 items-end">
            <FormField id="org-search" label="Search organizations" className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                <input
                  id="org-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search organizations"
                  className="min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]"
                  aria-label="Search organizations"
                />
              </div>
            </FormField>
            <Button type="submit" disabled={isLoading}>Search</Button>
          </form>
        </FormSection>

        <section className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">Organization control center</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Use this page to inspect published org state, then move into the exact workflow that owns edits, trust completion, or access recovery.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[28rem]">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Visible results</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{visibleCount}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Verified on page</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{verifiedCount}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Need follow-up</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{profileFollowUpCount}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {workspaceLanes.map(({ href, label, description, icon: Icon }) => (
              <Link key={href} href={href} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-4 transition-shadow hover:shadow-md">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)]">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm font-semibold text-[var(--text-primary)]">{label}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{description}</p>
                <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
                  Open workspace <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
              </Link>
            ))}
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)] px-4 py-2.5 text-sm text-[var(--text-secondary)]">
          <span>This page shows published organization records. Structured edits stay attached to the submission audit trail.</span>
          <Link href="/resource-studio?compose=listing" className="font-medium text-action-base hover:underline whitespace-nowrap">Start a structured update →</Link>
          <Link href="/resource-studio" className="font-medium text-action-base hover:underline whitespace-nowrap">Open draft history →</Link>
        </div>

        {error && (
          <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-4" />
        )}

        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <SkeletonCard key={`sk-${index}`} />
            ))}
          </div>
        )}

        {!isLoading && data && data.results.length === 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-8 text-center">
            <p className="font-medium text-[var(--text-primary)]">No organizations found</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              <Link href="/resource-studio?compose=claim" className="text-action-base hover:underline">
                Claim an organization
              </Link>{' '}
              or open{' '}
              <Link href="/resource-studio?compose=listing" className="text-action-base hover:underline">
                Resource Studio
              </Link>
              .
            </p>
          </div>
        )}

        {!isLoading && data && data.results.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.results.map((org) => (
                <div
                  key={org.id}
                  className="flex flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-sm font-semibold text-[var(--text-primary)]">{org.name}</h2>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        {org.verified_at && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--text-primary)] bg-[var(--text-primary)] px-2 py-0.5 text-xs font-medium text-white"
                            title={`Verified ${new Date(org.verified_at).toLocaleDateString()}`}
                          >
                            <Award className="h-3 w-3" aria-hidden="true" />
                            Verified
                          </span>
                        )}
                        {org.status && org.status !== 'active' && (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${
                              org.status === 'defunct'
                                ? 'border-[var(--color-error-accent)] bg-[var(--color-error-muted)] text-[var(--color-error-deep)]'
                                : 'border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]'
                            }`}
                          >
                            {org.status.charAt(0).toUpperCase() + org.status.slice(1)}
                          </span>
                        )}
                      </div>
                    </div>
                    {org.mission_statement && (
                      <p className="mt-1 line-clamp-1 text-xs italic text-[var(--text-muted)]">{org.mission_statement}</p>
                    )}
                    {org.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">{org.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                      {org.url && (
                        <a
                          href={org.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-action-base hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          Website
                        </a>
                      )}
                      {org.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" aria-hidden="true" />
                          {org.email}
                        </span>
                      )}
                    </div>
                    {(org.year_incorporated ?? org.legal_status ?? org.tax_status) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {org.year_incorporated && (
                          <span className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                            Est. {org.year_incorporated}
                          </span>
                        )}
                        {org.legal_status && (
                          <span className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                            {org.legal_status}
                          </span>
                        )}
                        {org.tax_status && (
                          <span className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                            {org.tax_status}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
                    <Link href={`/resource-studio?compose=listing&organizationId=${org.id}`}>
                      <Button variant="outline" size="sm" className="gap-1">
                        <FilePenLine className="h-3 w-3" aria-hidden="true" />
                        Edit in Studio
                      </Button>
                    </Link>
                    <Link href={`/org/profile?orgId=${org.id}`}>
                      <Button variant="outline" size="sm" className="gap-1">
                        <UserCog className="h-3 w-3" aria-hidden="true" />
                        Profile
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-[var(--text-secondary)]" role="status">
                Page {data.page} · {data.total} total
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchOrgs(page - 1, query)}
                  disabled={page <= 1 || isLoading}
                  className="gap-1"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchOrgs(page + 1, query)}
                  disabled={!data.hasMore || isLoading}
                  className="gap-1"
                >
                  Next
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </ErrorBoundary>

    </div>
  );
}
