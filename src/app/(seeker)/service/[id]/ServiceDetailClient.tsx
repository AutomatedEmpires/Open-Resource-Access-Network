/**
 * Service Detail Page
 *
 * Displays a full service view reached via deep-link or click from search results.
 * Data comes from publication-gated service records only — no invented facts.
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
import { computeMatchScore } from '@/domain/match';
import { buildDiscoveryHref, parseDiscoveryUrlState, resolveDiscoverySearchText } from '@/services/search/discovery';
import { buildServiceFallbackDiscoveryState } from '@/services/search/discoveryFromService';
import {
  formatScheduleSummaries,
  formatStoredEligibilityCriterion,
  isCallablePhone,
} from '@/services/search/cardPresentation';
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

const PROVENANCE_ORIGIN_LABELS: Record<NonNullable<EnrichedService['provenance']>['origin'], string> = {
  official_feed: 'An official publisher feed',
  partner_feed: 'A trusted partner feed',
  curated_feed: 'A curated data feed',
  community_feed: 'A community data feed',
  provider_submission: 'Submitted by the provider organization',
  community_submission: 'A community contribution, approved through review',
  curated_import: 'Imported from a public dataset',
  unknown: 'Not recorded for this record',
};

function formatProvenanceDate(isoDate: string): string {
  // UTC keeps the rendered date identical to the stored evidence date
  // regardless of the viewer's timezone.
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
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

  const recordConfidenceScore = service?.confidenceScore?.verificationConfidence ?? null;
  const recordConfidenceLabel = recordConfidenceScore == null
    ? 'Record confidence unavailable'
    : recordConfidenceScore >= 80
      ? 'High record confidence'
      : recordConfidenceScore >= 60
        ? 'Moderate record confidence'
        : 'Limited record confidence';
  const matchScore = computeMatchScore(service?.confidenceScore);
  const formattedAddress = service ? formatAddress(service) : null;
  const scheduleSummary = service ? formatScheduleSummaries(service.schedules) : null;
  const eligibilityCriteria = (service?.eligibility ?? [])
    .map(formatStoredEligibilityCriterion)
    .filter((criterion): criterion is string => Boolean(criterion));
  const contactPhones = (service?.phones ?? []).slice(0, 3).map((phone) => ({
    ...phone,
    actionLabel: phone.type === 'sms'
      ? 'Text'
      : phone.type === 'tty'
        ? 'TTY'
        : phone.type === 'fax'
          ? 'Fax'
          : phone.type === 'hotline'
            ? 'Hotline'
            : 'Call',
    href: phone.type === 'sms'
      ? `sms:${phone.number}`
      : isCallablePhone(phone)
        ? `tel:${phone.number}`
        : null,
  }));

  return (
    <main className="min-h-screen bg-white">
      <div className="container mx-auto max-w-7xl px-4 pt-4 pb-8 md:py-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm md:p-8">
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
            className="flex items-start gap-2 rounded-[20px] border border-error-soft bg-error-subtle p-4 text-sm text-error-deep shadow-[0_12px_32px_rgba(127,29,29,0.08)]"
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
          <div className="rounded-[24px] border border-slate-200 bg-white p-10 text-center shadow-sm">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-slate-400" aria-hidden="true" />
            <h1 className="mb-2 text-2xl font-bold tracking-tight text-stone-900">Service not found</h1>
            <p className="mb-4 text-sm text-stone-600">
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
          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] md:p-5">
            <PageHeader
              eyebrow="Published service record"
              title={service.service.name}
              subtitle={
                <>
                  Stored record from{' '}
                  <Link href={`/org/${service.organization.id}`} className="font-medium text-action-base hover:underline">
                    {service.organization.name}
                  </Link>. Also try the{' '}
                  <Link href={directoryHref} className="font-medium text-action-base hover:underline">Directory</Link>,{' '}
                  <Link href={mapHref} className="font-medium text-action-base hover:underline">Map</Link>, or{' '}
                  <Link href={chatHref} className="font-medium text-action-base hover:underline">Chat</Link>
                  {' '}if you want alternate routes.
                </>
              }
              badges={(
                <>
                  <PageHeaderBadge tone="trust">{recordConfidenceLabel}</PageHeaderBadge>
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
              title="Record confidence and eligibility"
              description="Confidence cues and qualification details from the stored record. ORAN does not guarantee eligibility."
              className="mt-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    Record evidence
                  </p>
                  <div className="mt-3 space-y-2 text-sm text-slate-800">
                    <p>
                      <span className="font-medium">Record status:</span> {recordConfidenceLabel}
                    </p>
                    <p>
                      <span className="font-medium">Record confidence:</span>{' '}
                      {recordConfidenceScore == null ? 'Unavailable' : `${Math.round(recordConfidenceScore)} / 100`}
                    </p>
                    <p>
                      <span className="font-medium">Overall match score:</span>{' '}
                      {matchScore == null ? 'Unavailable' : `${Math.round(matchScore)} / 100`}
                    </p>
                    <p className="text-xs text-slate-600">
                      Record-confidence cues summarize stored evidence only. Confirm current hours, intake rules, and availability with the provider.
                    </p>
                  </div>
                </div>

                <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    Eligibility and documents
                  </p>
                  {eligibilityCriteria.length > 0 ? (
                    <ul className="mt-3 space-y-2 text-sm text-slate-800">
                      {eligibilityCriteria.slice(0, 3).map((criterion, index) => (
                        <li key={`${criterion}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                          <p>{criterion}</p>
                        </li>
                      ))}
                      {eligibilityCriteria.length > 3 ? (
                        <li className="text-xs text-slate-600">+{eligibilityCriteria.length - 3} more stored requirements</li>
                      ) : null}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-slate-800">No eligibility requirements are stored for this listing.</p>
                  )}
                  {service.requiredDocuments && service.requiredDocuments.length > 0 ? (
                    <div className="mt-3 text-sm text-slate-800">
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
                <div className="space-y-3 rounded-[20px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 shadow-sm">
                  <p className="flex items-center gap-2 font-semibold text-slate-900">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    Visit and schedule
                  </p>
                  <p>{formattedAddress ?? 'No stored address is listed for this service.'}</p>
                  <p className="flex items-start gap-2">
                    <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden="true" />
                    <span>
                      {scheduleSummary ?? 'No current stored schedule details are listed.'}
                    </span>
                  </p>
                  {service.serviceAreas && service.serviceAreas.length > 0 ? (
                    <p>
                      <span className="font-medium text-slate-900">Service area:</span>{' '}
                      {service.serviceAreas.map((area) => area.name ?? area.extentType ?? 'Custom area').join(', ')}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-3 rounded-[20px] border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
                  <p className="flex items-center gap-2 font-semibold text-slate-900">
                    <Accessibility className="h-4 w-4" aria-hidden="true" />
                    Access details
                  </p>
                  <p className="flex items-start gap-2">
                    <Globe2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden="true" />
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
                      <span className="font-medium text-slate-900">Service tags:</span>{' '}
                      {service.attributes.slice(0, 6).map((attribute) => attribute.tag).join(', ')}
                    </p>
                  ) : null}
                  {service.program ? (
                    <p>
                      <span className="font-medium text-slate-900">Program:</span> {service.program.name}
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
                <div className="space-y-3 rounded-[20px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 shadow-sm">
                  <p className="flex items-center gap-2 font-semibold text-slate-900">
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    Contact the provider
                  </p>
                  {contactPhones.length > 0 ? (
                    <div className="space-y-2">
                      {contactPhones.map((phone) => (
                        phone.href ? (
                          <a
                            key={phone.id}
                            href={phone.href}
                            className="block text-slate-900 hover:underline"
                            aria-label={`${phone.actionLabel} ${service.service.name}: ${phone.number}`}
                          >
                            {phone.number}
                            {phone.extension ? ` ext. ${phone.extension}` : ''}
                            <span className="ml-2 text-xs text-slate-500">{phone.actionLabel}</span>
                          </a>
                        ) : (
                          <p key={phone.id} className="text-slate-900">
                            {phone.number}
                            {phone.extension ? ` ext. ${phone.extension}` : ''}
                            <span className="ml-2 text-xs text-slate-500">{phone.actionLabel}</span>
                          </p>
                        )
                      ))}
                    </div>
                  ) : (
                    <p>No stored phone number is listed.</p>
                  )}
                  {service.contacts && service.contacts.length > 0 ? (
                    <div>
                      <p className="flex items-center gap-2 font-medium text-slate-900">
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
                      className="inline-flex items-center gap-1 text-slate-900 hover:underline"
                    >
                      Visit provider website
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>

                <div className="rounded-[20px] border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
                  <p className="font-semibold text-slate-900">Continue exploring</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Use another seeker surface if you want nearby alternatives or conversational routing without losing the source-authority boundary.
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

            {service.provenance ? (
              <section
                aria-label="Where this information comes from"
                className="mt-4 rounded-[20px] border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm"
              >
                <p className="flex items-center gap-2 font-semibold text-slate-900">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Where this information comes from
                </p>
                <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-3">
                  <dt className="font-medium text-slate-500">Source</dt>
                  <dd className="sm:col-span-2">
                    {PROVENANCE_ORIGIN_LABELS[service.provenance.origin]}
                    {service.provenance.sourceName ? ` — ${service.provenance.sourceName}` : ''}
                  </dd>
                  {typeof service.provenance.sourceCount === 'number' && service.provenance.sourceCount > 1 ? (
                    <>
                      <dt className="font-medium text-slate-500">Corroboration</dt>
                      <dd className="sm:col-span-2">Combined from {service.provenance.sourceCount} independent sources</dd>
                    </>
                  ) : null}
                  <dt className="font-medium text-slate-500">Information updated</dt>
                  <dd className="sm:col-span-2">
                    {service.provenance.informationUpdatedAt
                      ? formatProvenanceDate(service.provenance.informationUpdatedAt)
                      : 'Not recorded'}
                  </dd>
                  {service.provenance.firstSeenAt ? (
                    <>
                      <dt className="font-medium text-slate-500">First seen by ORAN</dt>
                      <dd className="sm:col-span-2">{formatProvenanceDate(service.provenance.firstSeenAt)}</dd>
                    </>
                  ) : null}
                  <dt className="font-medium text-slate-500">Human review</dt>
                  <dd className="sm:col-span-2">
                    {service.provenance.lastHumanReviewAt
                      ? `Approved by an ORAN reviewer on ${formatProvenanceDate(service.provenance.lastHumanReviewAt)}`
                      : 'No independent review date is recorded for this record'}
                  </dd>
                </dl>
                <p className="mt-2 text-xs text-slate-600">
                  See something wrong? Use “Flag issue” on this page to report a correction.
                </p>
              </section>
            ) : null}

            <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 shadow-sm">
              <p className="font-medium">Confirm details with the provider before visiting.</p>
              <p className="mt-1 text-xs text-slate-600">
                ORAN only shows stored records that pass its publication gate, but hours, eligibility, intake requirements, and availability can still change.
              </p>
            </div>
          </div>
        )}
            </ErrorBoundary>
          </section>

          <aside className="space-y-4 lg:sticky lg:top-6">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Record view</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">One record, multiple ways to continue</h2>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
                <li>This page shows stored provider details only, with no invented facts.</li>
                <li>Browse scope carries into Directory, Map, and Chat when available.</li>
                <li>Record-confidence cues help compare records, but provider confirmation still matters.</li>
              </ul>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Eligibility caution</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                ORAN can show who may qualify and which documents may be needed, but it never guarantees eligibility. Confirm current intake rules directly with the provider.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
