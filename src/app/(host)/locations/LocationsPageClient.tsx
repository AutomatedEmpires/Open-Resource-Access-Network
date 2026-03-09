/**
 * /locations — Location management
 *
 * Locations remain listable here, while structured edits now flow through
 * Resource Studio so location, service, evidence, and review history stay
 * attached to the same listing workflow.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  FilePenLine,
  MapPin,
  Plus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';
import type { Organization } from '@/domain/types';

interface LocationRow {
  id: string;
  organization_id: string;
  name: string | null;
  alternate_name?: string | null;
  description?: string | null;
  transportation?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address_1?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  organization_name?: string | null;
  primary_service_id?: string | null;
  primary_service_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  results: LocationRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

interface OrgOption {
  id: string;
  name: string;
}

const LIMIT = 12;

function buildStudioHref(location: LocationRow): string {
  if (location.primary_service_id) {
    return `/resource-studio?compose=listing&serviceId=${location.primary_service_id}`;
  }
  return `/resource-studio?compose=listing&organizationId=${location.organization_id}`;
}

export default function LocationsPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [orgFilter, setOrgFilter] = useState('');
  const [orgs, setOrgs] = useState<OrgOption[]>([]);

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

  const fetchLocations = useCallback(async (nextPage: number, nextOrgId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: String(LIMIT) });
      if (nextOrgId) params.set('organizationId', nextOrgId);

      const res = await fetch(`/api/host/locations?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load locations');
      }
      const json = (await res.json()) as ListResponse;
      setData(json);
      setPage(nextPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load locations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLocations(1, '');
  }, [fetchLocations]);

  const composeHref = useMemo(() => {
    const organizationId = orgFilter || orgs[0]?.id;
    return organizationId
      ? `/resource-studio?compose=listing&organizationId=${organizationId}`
      : '/resource-studio?compose=listing';
  }, [orgFilter, orgs]);

  const formatAddress = (location: LocationRow): string | null => {
    const parts = [location.address_1, location.city, location.state_province, location.postal_code].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Host workspace"
        title="Locations"
        icon={<MapPin className="h-6 w-6" aria-hidden="true" />}
        subtitle="Browse published access points here, then open the linked listing bundle in Resource Studio to revise location details inside the same review-backed workflow."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Location edits stay attached to listing review history</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Map-facing details still stay privacy-aware</PageHeaderBadge>
            <PageHeaderBadge>{data ? `${data.total} total` : 'Loading locations'}</PageHeaderBadge>
          </>
        )}
        actions={(
          <Link href={composeHref}>
            <Button size="sm" className="gap-1" disabled={orgs.length === 0}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Location
            </Button>
          </Link>
        )}
      />

      <ErrorBoundary>
        <FormSection
          title="How location edits work now"
          description="This page is the published location view. Structured edits and retirement actions reopen in Resource Studio through the associated listing so location facts, service details, evidence, and review state stay together."
          className="mb-4"
        >
          <div className="flex flex-wrap gap-3 text-sm text-slate-600">
            <Link href={composeHref} className="font-medium text-action-base hover:underline">Start a listing update</Link>
            <Link href="/resource-studio" className="font-medium text-action-base hover:underline">Open draft and review history</Link>
          </div>
        </FormSection>

        <div className="flex gap-2 items-center mb-4">
          <select
            value={orgFilter}
            onChange={(event) => {
              setOrgFilter(event.target.value);
              void fetchLocations(1, event.target.value);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[44px]"
            aria-label="Filter by organization"
          >
            <option value="">All organizations</option>
            {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
        </div>

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
            <p className="text-gray-700 font-medium">No locations found</p>
            <p className="mt-1 text-sm text-gray-500">
              Start a new listing update in{' '}
              <Link href={composeHref} className="text-action-base hover:underline">Resource Studio</Link>
              .
            </p>
          </div>
        )}

        {!isLoading && data && data.results.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.results.map((location) => {
                const address = formatAddress(location);
                return (
                  <div key={location.id} className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col justify-between">
                    <div>
                      <h2 className="font-semibold text-gray-900 text-sm">{location.name ?? 'Unnamed Location'}</h2>
                      {location.organization_name && (
                        <p className="mt-0.5 text-xs text-gray-500">{location.organization_name}</p>
                      )}
                      {location.primary_service_name && (
                        <p className="mt-1 text-xs text-slate-500">Listing bundle: {location.primary_service_name}</p>
                      )}
                      {address && (
                        <p className="mt-1 text-xs text-gray-600">{address}</p>
                      )}
                      {location.latitude != null && location.longitude != null && (
                        <p className="mt-1 text-xs text-gray-400">
                          {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                        </p>
                      )}
                      {location.description && (
                        <p className="mt-1 text-xs text-gray-600 line-clamp-2">{location.description}</p>
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                      <Link href={buildStudioHref(location)}>
                        <Button variant="outline" size="sm" className="gap-1">
                          <FilePenLine className="h-3 w-3" aria-hidden="true" />
                          Open in Studio
                        </Button>
                      </Link>
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
                  onClick={() => void fetchLocations(page - 1, orgFilter)}
                  disabled={page <= 1 || isLoading}
                  className="gap-1"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchLocations(page + 1, orgFilter)}
                  disabled={!data.hasMore || isLoading}
                  className="gap-1"
                >
                  Next <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </ErrorBoundary>

    </div>
  );
}
