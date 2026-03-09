/**
 * Service Detail Page
 *
 * Displays a full service view reached via deep-link or click from search results.
 * Data comes from verified service records only — no invented facts.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Accessibility, AlertTriangle, ArrowLeft, Clock, ExternalLink, FileText, Globe2, MapPin, MessageCircle, Phone, Search, ShieldCheck, Users } from 'lucide-react';

import { Breadcrumb } from '@/components/ui/breadcrumb';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { ServiceCard } from '@/components/directory/ServiceCard';
import { DiscoveryContextPanel } from '@/components/seeker/DiscoveryContextPanel';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { FormSection } from '@/components/ui/form-section';
import { SkeletonCard } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import type { EnrichedService } from '@/domain/types';
import { buildDiscoveryHref, parseDiscoveryUrlState, resolveDiscoverySearchText } from '@/services/search/discovery';
import { buildServiceFallbackDiscoveryState } from '@/services/search/discoveryFromService';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
  addServerSaved,
  readStoredSavedServiceIds,
  removeServerSaved,
  writeStoredSavedServiceIds,
} from '@/services/saved/client';
import { getSavedTogglePresentation } from '@/services/saved/presentation';

function formatAddress(service: EnrichedService): string | null {
  const address = service.address;
  if (!address) return null;
  return [address.address1, address.city, address.stateProvince, address.postalCode].filter(Boolean).join(', ');
}

function computeMatchScore(confidence?: EnrichedService['confidenceScore']): number | null {
  if (!confidence) return null;
  return Math.round((confidence.eligibilityMatch + confidence.constraintFit) / 2);
}

// ============================================================
// SERVER-SIDE HELPERS
// ============================================================

interface BatchServiceResponse {
  results: EnrichedService[];
  notFound?: string[];
}

/** Fetch a single service by ID */
async function fetchServiceById(id: string): Promise<EnrichedService | null> {
  const params = new URLSearchParams({ ids: id });

  const res = await fetch(`/api/services?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 404) {
      return null;
    }
    throw new Error('Failed to fetch service');
  }

  const json = (await res.json()) as BatchServiceResponse;
  return json.results[0] ?? null;
}

// ============================================================
// PAGE
// ============================================================

export default function ServiceDetailPage({ serviceId }: { serviceId: string }) {
  const searchParams = useSearchParams();
  const [service, setService] = useState<EnrichedService | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [serverSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());
  const { success } = useToast();

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    setSavedIds(new Set(readStoredSavedServiceIds()));
  }, []);

  // Fetch service details
  useEffect(() => {
    if (!serviceId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      setNotFound(false);

      try {
        const result = await fetchServiceById(serviceId);
        if (cancelled) return;

        if (!result) {
          setNotFound(true);
        } else {
          setService(result);
          // Update page title
          document.title = `${result.service.name} | ORAN`;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load service');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  const toggleSave = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      const wasSaved = next.has(id);
      const toggleCopy = getSavedTogglePresentation(wasSaved, serverSyncEnabled);
      if (wasSaved) {
        next.delete(id);
        if (serverSyncEnabled) {
          void removeServerSaved(id);
        }
      } else {
        next.add(id);
        if (serverSyncEnabled) {
          void addServerSaved(id);
        }
      }
      success(toggleCopy.toastMessage);
      writeStoredSavedServiceIds(next);
      return next;
    });
  }, [serverSyncEnabled, success]);

  const incomingDiscoveryIntent = useMemo(() => parseDiscoveryUrlState(searchParams), [searchParams]);
  const hasIncomingDiscoveryIntent = Boolean(
    resolveDiscoverySearchText(incomingDiscoveryIntent.text, incomingDiscoveryIntent.needId)
      || incomingDiscoveryIntent.taxonomyTermIds.length > 0
      || Object.keys(incomingDiscoveryIntent.attributeFilters ?? {}).length > 0,
  );
  const fallbackDiscoveryIntent = useMemo(() => {
    return buildServiceFallbackDiscoveryState(service);
  }, [service]);
  const discoveryIntent = useMemo(() => {
    if (hasIncomingDiscoveryIntent) {
      return incomingDiscoveryIntent;
    }

    return {
      ...incomingDiscoveryIntent,
      taxonomyTermIds: fallbackDiscoveryIntent.taxonomyTermIds,
      attributeFilters: fallbackDiscoveryIntent.attributeFilters,
      page: 1,
    };
  }, [fallbackDiscoveryIntent.attributeFilters, fallbackDiscoveryIntent.taxonomyTermIds, hasIncomingDiscoveryIntent, incomingDiscoveryIntent]);

  const directoryHref = useMemo(() => buildDiscoveryHref('/directory', discoveryIntent), [discoveryIntent]);
  const mapHref = useMemo(() => buildDiscoveryHref('/map', discoveryIntent), [discoveryIntent]);
  const chatHref = useMemo(() => buildDiscoveryHref('/chat', discoveryIntent), [discoveryIntent]);
  const taxonomyLabelById = useMemo<Record<string, string>>(() => {
    return (service?.taxonomyTerms ?? []).reduce<Record<string, string>>((acc, term) => {
      acc[term.id] = term.term;
      return acc;
    }, {});
  }, [service?.taxonomyTerms]);

  const trustScore = service?.confidenceScore?.verificationConfidence ?? null;
  const trustLabel = trustScore == null ? 'Trust information unavailable' : trustScore >= 80 ? 'High trust record' : trustScore >= 60 ? 'Likely match record' : 'Review provider details';
  const matchScore = computeMatchScore(service?.confidenceScore);
  const formattedAddress = service ? formatAddress(service) : null;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-8">
      <ErrorBoundary>
        {/* Breadcrumb navigation */}
        <Breadcrumb
          className="mb-6"
          items={[
            { label: 'Directory', href: directoryHref },
            ...(service
              ? [{ label: service.service.name }]
              : notFound
              ? [{ label: 'Not found' }]
              : error
              ? [{ label: 'Error' }]
              : []),
          ]}
        />

        {/* Loading */}
        {isLoading && (
          <div role="status" aria-busy="true" aria-label="Loading service details">
            <SkeletonCard />
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-error-soft bg-error-subtle p-4 text-sm text-error-deep"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Could not load service</p>
              <p className="mt-1 text-xs">{error}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 text-error-strong hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Not found */}
        {notFound && !isLoading && (
          <div className="rounded-lg border border-gray-200 bg-white p-10 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto text-amber-400 mb-3" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 mb-2">Service not found</h1>
            <p className="text-sm text-gray-600 mb-4">
              This service may no longer be available, or the link may be incorrect.
            </p>
            <Link href={directoryHref}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Search className="h-4 w-4" aria-hidden="true" />
                Browse directory
              </Button>
            </Link>
          </div>
        )}

        {/* Service card */}
        {service && !isLoading && !notFound && (
          <div>
            <PageHeader
              eyebrow="Verified service record"
              title={service.service.name}
              subtitle={
                <>
                  Stored record from {service.organization.name}. Also try the{' '}
                  <Link href={directoryHref} className="text-action-base hover:underline">Directory</Link>,{' '}
                  <Link href={mapHref} className="text-action-base hover:underline">Map</Link>, or{' '}
                  <Link href={chatHref} className="text-action-base hover:underline">Chat</Link>
                  {' '}if you want alternate routes.
                </>
              }
              badges={(
                <>
                  <PageHeaderBadge tone="trust">{trustLabel}</PageHeaderBadge>
                  <PageHeaderBadge tone="accent">Eligibility not guaranteed</PageHeaderBadge>
                  <PageHeaderBadge>{serverSyncEnabled ? 'Saves can sync to your account' : 'Saves stay on this device'}</PageHeaderBadge>
                  {matchScore != null ? <PageHeaderBadge>Overall score: {Math.round(matchScore)}</PageHeaderBadge> : null}
                </>
              )}
              actions={(
                <Link href={directoryHref}>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5">
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back to browse
                  </Button>
                </Link>
              )}
            />

            <FormSection
              title="Service overview"
              description="Primary provider details shown from stored records only."
            >
              <DiscoveryContextPanel
                discoveryContext={discoveryIntent}
                taxonomyLabelById={taxonomyLabelById}
                title={hasIncomingDiscoveryIntent ? 'Current browse scope' : 'Rebuilt browse scope'}
                description={
                  hasIncomingDiscoveryIntent
                    ? 'You opened this record from a scoped browse flow. These filters will carry into the other seeker surfaces.'
                    : 'ORAN rebuilt a similar-service scope from this record so you can continue browsing without losing taxonomy and access context.'
                }
                className="mb-4"
              />
              <ServiceCard
                enriched={service}
                isSaved={savedIds.has(service.service.id)}
                onToggleSave={toggleSave}
                savedSyncEnabled={serverSyncEnabled}
                discoveryContext={discoveryIntent}
              />
            </FormSection>

            <FormSection
              title="Trust and eligibility"
              description="Confidence cues and qualification details from the stored record. ORAN does not guarantee eligibility."
              className="mt-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    Trust evidence
                  </p>
                  <div className="mt-3 space-y-2 text-sm text-emerald-950">
                    <p>
                      <span className="font-medium">Record status:</span> {trustLabel}
                    </p>
                    <p>
                      <span className="font-medium">Verification confidence:</span>{' '}
                      {trustScore == null ? 'Unavailable' : `${Math.round(trustScore)} / 100`}
                    </p>
                    <p>
                      <span className="font-medium">Overall match score:</span>{' '}
                      {matchScore == null ? 'Unavailable' : `${Math.round(matchScore)} / 100`}
                    </p>
                    <p className="text-xs text-emerald-800">
                      Trust cues summarize stored evidence only. Confirm current hours, intake rules, and availability with the provider.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    Eligibility and documents
                  </p>
                  {service.eligibility && service.eligibility.length > 0 ? (
                    <ul className="mt-3 space-y-2 text-sm text-amber-950">
                      {service.eligibility.slice(0, 3).map((rule, index) => (
                        <li key={`${rule.description}-${index}`} className="rounded-md bg-white/70 px-3 py-2">
                          <p>{rule.description}</p>
                          {(rule.minimumAge != null || rule.maximumAge != null) ? (
                            <p className="mt-1 text-xs text-amber-800">
                              Age range: {rule.minimumAge ?? '?'} to {rule.maximumAge ?? '?'}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-amber-950">No stored eligibility criteria are listed for this record.</p>
                  )}
                  {service.requiredDocuments && service.requiredDocuments.length > 0 ? (
                    <div className="mt-3 text-sm text-amber-950">
                      <p className="font-medium">Bring if requested:</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {service.requiredDocuments.map((document, index) => (
                          <li key={`${document.document}-${index}`}>{document.document}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            </FormSection>

            <FormSection
              title="Access and availability"
              description="Location, schedule, language, and accessibility signals from the record."
              className="mt-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  <p className="flex items-center gap-2 font-semibold text-gray-900">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    Visit and schedule
                  </p>
                  <p>{formattedAddress ?? 'No stored address is listed for this service.'}</p>
                  <p className="flex items-start gap-2">
                    <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" aria-hidden="true" />
                    <span>
                      {service.schedules && service.schedules.length > 0
                        ? service.schedules.slice(0, 2).map((schedule) => schedule.description).filter(Boolean).join(' · ')
                        : 'No stored schedule details are listed.'}
                    </span>
                  </p>
                  {service.serviceAreas && service.serviceAreas.length > 0 ? (
                    <p>
                      <span className="font-medium text-gray-900">Service area:</span>{' '}
                      {service.serviceAreas.map((area) => area.name ?? area.extentType ?? 'Custom area').join(', ')}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  <p className="flex items-center gap-2 font-semibold text-gray-900">
                    <Accessibility className="h-4 w-4" aria-hidden="true" />
                    Access details
                  </p>
                  <p className="flex items-start gap-2">
                    <Globe2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" aria-hidden="true" />
                    <span>
                      {service.languages && service.languages.length > 0
                        ? `Languages: ${service.languages.map((language) => language.language).join(', ')}`
                        : 'No stored language support details are listed.'}
                    </span>
                  </p>
                  <p>
                    {service.accessibility && service.accessibility.length > 0
                      ? `Accessibility: ${service.accessibility.map((entry) => entry.accessibility).join(', ')}`
                      : 'No stored accessibility details are listed.'}
                  </p>
                  {service.attributes && service.attributes.length > 0 ? (
                    <p>
                      <span className="font-medium text-gray-900">Service tags:</span>{' '}
                      {service.attributes.slice(0, 6).map((attribute) => attribute.tag).join(', ')}
                    </p>
                  ) : null}
                  {service.program ? (
                    <p>
                      <span className="font-medium text-gray-900">Program:</span> {service.program.name}
                    </p>
                  ) : null}
                </div>
              </div>
            </FormSection>

            <FormSection
              title="Contact and next steps"
              description="Ways to verify details directly with the provider or continue your search in another surface."
              className="mt-4"
              contentClassName="space-y-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  <p className="flex items-center gap-2 font-semibold text-gray-900">
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    Contact the provider
                  </p>
                  {service.phones.length > 0 ? (
                    <div className="space-y-2">
                      {service.phones.slice(0, 2).map((phone) => (
                        <a
                          key={phone.id}
                          href={`tel:${phone.number}`}
                          className="block text-action-base hover:underline"
                        >
                          {phone.number}
                          {phone.extension ? ` ext. ${phone.extension}` : ''}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p>No stored phone number is listed.</p>
                  )}
                  {service.contacts && service.contacts.length > 0 ? (
                    <div>
                      <p className="flex items-center gap-2 font-medium text-gray-900">
                        <Users className="h-4 w-4" aria-hidden="true" />
                        Named contacts
                      </p>
                      <ul className="mt-1 space-y-1">
                        {service.contacts.slice(0, 3).map((contact) => (
                          <li key={contact.id}>
                            {[contact.name, contact.title, contact.email].filter(Boolean).join(' · ')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {service.service.url ? (
                    <a
                      href={service.service.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-action-base hover:underline"
                    >
                      Visit provider website
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  <p className="font-semibold text-gray-900">Continue exploring</p>
                  <p className="mt-1 text-sm text-gray-600">
                    Use another seeker surface if you want nearby alternatives or conversational routing without losing the trust-first contract.
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Link href={chatHref} className="sm:flex-1">
                      <Button type="button" variant="outline" className="w-full gap-1.5">
                        <MessageCircle className="h-4 w-4" aria-hidden="true" />
                        Ask chat for alternatives
                      </Button>
                    </Link>
                    <Link href={mapHref} className="sm:flex-1">
                      <Button type="button" variant="outline" className="w-full gap-1.5">
                        <Search className="h-4 w-4" aria-hidden="true" />
                        See nearby options on the map
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </FormSection>

            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Confirm details with the provider before visiting.</p>
              <p className="mt-1 text-xs text-amber-800">
                ORAN shows stored, verified records only, but hours, eligibility, intake requirements, and availability can still change.
              </p>
            </div>
          </div>
        )}
      </ErrorBoundary>
    </main>
  );
}
