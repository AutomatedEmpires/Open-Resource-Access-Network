/**
 * /services — Service Management
 *
 * Service records remain listable here, but creation and edits now flow through
 * Resource Studio so draft state, review state, and publish state stay unified.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Briefcase, ExternalLink, Pencil, Plus, Search, Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import type { Organization, ServiceStatus } from '@/domain/types';

interface ServiceRow {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  url?: string | null;
  email?: string | null;
  status: ServiceStatus;
  fees?: string | null;
  wait_time?: string | null;
  organization_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  results: ServiceRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

interface OrgOption {
  id: string;
  name: string;
}

const LIMIT = 12;

const STATUS_LABELS: Record<ServiceStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: 'bg-green-100 text-green-800' },
  inactive: { label: 'Inactive', color: 'bg-yellow-100 text-yellow-800' },
  defunct: { label: 'Defunct', color: 'bg-error-muted text-error-deep' },
};

export default function ServicesPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const loadOrgs = async () => {
      try {
        const res = await fetch('/api/host/organizations?limit=100');
        if (!res.ok) return;
        const json = (await res.json()) as { results: Organization[] };
        setOrgs(json.results.map((org) => ({ id: org.id, name: org.name })));
      } catch {
        // Non-fatal. The list still works without org options.
      }
    };

    void loadOrgs();
  }, []);

  const fetchServices = useCallback(async (nextPage: number, nextQuery: string, nextOrgId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: String(LIMIT) });
      if (nextQuery.trim()) params.set('q', nextQuery.trim());
      if (nextOrgId) params.set('organizationId', nextOrgId);

      const res = await fetch(`/api/host/services?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load services');
      }
      const json = (await res.json()) as ListResponse;
      setData(json);
      setPage(nextPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load services');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchServices(1, '', '');
  }, [fetchServices]);

  const composeHref = useMemo(() => {
    const organizationId = orgFilter || orgs[0]?.id;
    return organizationId
      ? `/resource-studio?compose=listing&organizationId=${organizationId}`
      : '/resource-studio?compose=listing';
  }, [orgFilter, orgs]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    void fetchServices(1, query, orgFilter);
  };

  const handleDelete = useCallback(async (id: string) => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/host/services/${id}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        queuedForReview?: boolean;
        message?: string;
      } | null;
      if (!res.ok) {
        throw new Error(body?.error ?? 'Delete failed');
      }
      setDeletingId(null);
      if (body?.queuedForReview) {
        toast.info(body.message ?? 'Archive request submitted for review.');
      } else {
        toast.success('Service archived');
      }
      void fetchServices(page, query, orgFilter);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Delete failed');
      setDeletingId(null);
    } finally {
      setIsDeleting(false);
    }
  }, [fetchServices, orgFilter, page, query, toast]);

  return (
    <div>
      <PageHeader
        eyebrow="Host workspace"
        title="Services"
        icon={<Briefcase className="h-6 w-6" aria-hidden="true" />}
        subtitle="Browse live service records here, then open Resource Studio to create, revise, or resubmit a listing through one review-backed workflow."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Active changes route through the same submission cards admins review</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Studio keeps draft, evidence, and publish state in one place</PageHeaderBadge>
            <PageHeaderBadge>{data ? `${data.total} total` : 'Loading services'}</PageHeaderBadge>
          </>
        )}
        actions={(
          <Link href={composeHref}>
            <Button size="sm" className="gap-1" disabled={orgs.length === 0}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Service
            </Button>
          </Link>
        )}
      />

      <ErrorBoundary>
        <FormSection
          title="Find services"
          description="Search current listings, filter by organization, then jump into Resource Studio to continue the structured submission flow."
          className="mb-4"
        >
          <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-2">
            <FormField id="svc-search" label="Search services" className="flex-1 basis-48">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input
                  id="svc-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search services"
                  className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                  aria-label="Search services"
                />
              </div>
            </FormField>
            <FormField id="svc-org-filter" label="Filter by organization" className="w-56 max-w-full">
              <select
                id="svc-org-filter"
                value={orgFilter}
                onChange={(event) => {
                  setOrgFilter(event.target.value);
                  void fetchServices(1, query, event.target.value);
                }}
                className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                aria-label="Filter by organization"
              >
                <option value="">All organizations</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </FormField>
            <Button type="submit" disabled={isLoading}>Search</Button>
          </form>
        </FormSection>

        <FormSection
          title="How this page works now"
          description="This list is the published record view. Creation, edits, and returned fixes now reopen in Resource Studio so review, provenance, and decision history remain attached to the same submission."
          className="mb-4"
        >
          <div className="flex flex-wrap gap-3 text-sm text-slate-600">
            <Link href={composeHref} className="font-medium text-action-base hover:underline">Start a new listing</Link>
            <Link href="/resource-studio" className="font-medium text-action-base hover:underline">Open draft and review history</Link>
          </div>
        </FormSection>

        {error && (
          <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-4" />
        )}

        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true">
            {Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={`sk-${index}`} />)}
          </div>
        )}

        {!isLoading && data && data.results.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="font-medium text-gray-700">No services found</p>
            <p className="mt-1 text-sm text-gray-500">
              Start a new listing in{' '}
              <Link href={composeHref} className="text-action-base hover:underline">Resource Studio</Link>.
            </p>
          </div>
        )}

        {!isLoading && data && data.results.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.results.map((service) => {
                const status = STATUS_LABELS[service.status];
                return (
                  <div key={service.id} className="flex flex-col justify-between rounded-lg border border-gray-200 bg-white p-4">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="text-sm font-semibold text-gray-900">{service.name}</h2>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                      {service.organization_name && (
                        <p className="mt-0.5 text-xs text-gray-500">{service.organization_name}</p>
                      )}
                      {service.description && (
                        <p className="mt-1 text-xs text-gray-600 line-clamp-2">{service.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                        {service.url && (
                          <a href={service.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-action-base hover:underline">
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            Website
                          </a>
                        )}
                        {service.fees && <span>Fees: {service.fees}</span>}
                        {service.wait_time && <span>Wait: {service.wait_time}</span>}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                      <Link href={`/resource-studio?compose=listing&serviceId=${service.id}`}>
                        <Button variant="outline" size="sm" className="gap-1">
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                          Open in Studio
                        </Button>
                      </Link>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-error-base hover:border-error-accent hover:text-error-strong"
                        onClick={() => setDeletingId(service.id)}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-600" role="status">
                Page {data.page} · {data.total} total
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchServices(page - 1, query, orgFilter)}
                  disabled={page <= 1 || isLoading}
                  className="gap-1"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchServices(page + 1, query, orgFilter)}
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

      <Dialog
        open={Boolean(deletingId)}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        {deletingId && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Archive service?</DialogTitle>
              <DialogDescription>
                This marks the service as defunct so it no longer appears in host lists.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeletingId(null)} disabled={isDeleting}>Cancel</Button>
              <Button onClick={() => void handleDelete(deletingId)} disabled={isDeleting} className="bg-error-base text-white hover:bg-error-strong">
                {isDeleting ? 'Archiving…' : 'Archive'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
