/**
 * OrgProfileClient — Client component for the public organization profile page.
 *
 * Fetches organization data from /api/organizations/[id] and renders
 * org details, service list, and verification status.
 */

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SkeletonCard } from '@/components/ui/skeleton';
import { TrustBadge, type TrustLevel } from '@/components/ui/trust-badge';

// ============================================================
// TYPES
// ============================================================

interface OrgData {
  organization: {
    id: string;
    name: string;
    description: string | null;
    url: string | null;
    email: string | null;
    status: string;
    year_incorporated: number | null;
    logo_url: string | null;
    verified_at: string | null;
    updated_at: string;
  };
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    url: string | null;
    status: string;
    locations?: Array<{
      address_1: string | null;
      city: string | null;
      state_province: string | null;
      postal_code: string | null;
    }>;
  }>;
  serviceCount: number;
}

// ============================================================
// HELPERS
// ============================================================

function deriveTrustLevel(org: OrgData['organization']): TrustLevel {
  // Record updates and import timestamps are not verification decisions.
  // Only an explicit organization verification timestamp earns the badge.
  return org.verified_at ? 'verified' : 'unverified';
}

// ============================================================
// COMPONENT
// ============================================================

interface OrgProfileClientProps {
  orgId: string;
}

export default function OrgProfileClient({ orgId }: OrgProfileClientProps) {
  const [data, setData] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/organizations/${encodeURIComponent(orgId)}`);
        if (res.status === 404 || res.status === 400) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`);
        }
        const json = (await res.json()) as OrgData;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError('This organization could not be loaded right now.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [orgId]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <SkeletonCard />
        <div className="mt-4 space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  // ── Not found ──
  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-center">
        <h1 className="text-xl font-semibold text-gray-900">Organization not found</h1>
        <p className="mt-2 text-gray-600">
          This organization may no longer be listed, or the link may be incorrect.
        </p>
        <Link href="/directory" className="mt-4 inline-block text-action-base hover:underline">
          ← Back to directory
        </Link>
      </div>
    );
  }

  // ── Error ──
  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-center" role="alert">
        <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
        <p className="mt-2 text-gray-600">
          {error ?? 'This organization could not be loaded right now.'} Please try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-block text-action-base hover:underline"
        >
          Try again
        </button>
        <p className="mt-2">
          <Link href="/directory" className="inline-block text-action-base hover:underline">
            ← Back to directory
          </Link>
        </p>
      </div>
    );
  }

  const { organization: org, services } = data;
  const trustLevel = deriveTrustLevel(org);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Back nav */}
      <Link href="/directory">
        <Button variant="ghost" size="sm" className="mb-4 gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back to directory
        </Button>
      </Link>

      {/* Org header */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{org.name}</h1>
            <TrustBadge level={trustLevel} lastVerifiedAt={org.verified_at} className="mt-2" />
          </div>
          {org.logo_url && (
            <Image
              src={org.logo_url}
              alt={`${org.name} logo`}
              width={64}
              height={64}
              className="h-16 w-16 rounded-lg object-contain"
              unoptimized
            />
          )}
        </div>

        {org.description && (
          <p className="mt-4 text-gray-700">{org.description}</p>
        )}

        <div className="mt-4 space-y-1 text-sm text-gray-600">
          {org.url && (
            <p>
              Website:{' '}
              <a
                href={org.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-action-base hover:underline"
              >
                {org.url}
              </a>
            </p>
          )}
          {org.email && <p>Email: {org.email}</p>}
          {org.year_incorporated && <p>Founded: {org.year_incorporated}</p>}
        </div>
      </div>

      {/* Services list */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">
          Services ({services.length})
        </h2>

        {services.length === 0 ? (
          <p className="mt-2 text-gray-500">No active services listed.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {services.map((svc) => {
              const locationLine = (svc.locations ?? [])
                .map((l) => [l.city, l.state_province].filter(Boolean).join(', '))
                .filter(Boolean)
                .join(' · ');
              return (
                <Link
                  key={svc.id}
                  href={`/service/${svc.id}`}
                  className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
                >
                  <h3 className="font-medium text-gray-900">{svc.name}</h3>
                  {svc.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-gray-600">{svc.description}</p>
                  )}
                  {locationLine && (
                    <p className="mt-1 text-xs text-gray-500">{locationLine}</p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Eligibility caution */}
      <p className="mt-8 text-xs text-gray-400">
        Information shown may not be current. You may qualify for services listed — confirm
        eligibility directly with the provider.
      </p>
    </div>
  );
}
