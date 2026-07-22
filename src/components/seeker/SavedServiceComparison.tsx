'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Scale, X } from 'lucide-react';

import type { EnrichedService } from '@/domain/types';
import { Button } from '@/components/ui/button';

const MAX_COMPARISON_SERVICES = 3;

interface SavedServiceComparisonProps {
  services: EnrichedService[];
  buildServiceHref: (service: EnrichedService) => string;
}

function humanize(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function compact(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function formatAddress(service: EnrichedService): string | null {
  const address = service.address;
  if (!address) return null;

  const locality = compact([address.city, address.stateProvince ?? address.region, address.postalCode]).join(', ');
  return compact([address.address1, address.address2, locality]).join(', ') || null;
}

function formatDistance(distanceMeters: number | null | undefined): string | null {
  if (distanceMeters === null || distanceMeters === undefined || !Number.isFinite(distanceMeters)) return null;
  const miles = distanceMeters / 1609.344;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} miles from the search location`;
}

function buildTrustDetails(service: EnrichedService): string[] {
  const verificationScore = Number(service.confidenceScore?.verificationConfidence);
  const humanReview = formatDate(service.provenance?.lastHumanReviewAt);
  const providerVerification = formatDate(service.organization.verifiedAt);
  const informationUpdated = formatDate(
    service.provenance?.informationUpdatedAt ?? service.service.updatedAt,
  );

  return compact([
    Number.isFinite(verificationScore)
      ? `Record verification confidence: ${Math.round(verificationScore)}/100`
      : null,
    humanReview
      ? `Latest recorded ORAN review: ${humanReview}`
      : providerVerification
        ? `Provider verification recorded: ${providerVerification}`
        : 'No recent human review is recorded',
    informationUpdated ? `Information updated: ${informationUpdated}` : 'Update date is not recorded',
  ]);
}

function buildLocationDetails(service: EnrichedService): string[] {
  const serviceAreas = service.serviceAreas?.flatMap((area) => compact([area.name, area.description])) ?? [];
  return compact([
    formatAddress(service),
    formatDistance(service.distanceMeters),
    ...serviceAreas.map((area) => `Service area: ${area}`),
    serviceAreas.length === 0 && !service.address ? 'Location or service area is not recorded' : null,
  ]);
}

function buildEligibilityDetails(service: EnrichedService): string[] {
  const criteria = service.eligibility?.map((eligibility) => eligibility.description) ?? [];
  return compact([
    ...criteria,
    criteria.length === 0 ? service.organization.whoWeServe : null,
    criteria.length === 0 && !service.organization.whoWeServe
      ? 'Eligibility criteria are not recorded; ask the provider'
      : null,
  ]);
}

function buildDocumentDetails(service: EnrichedService): string[] {
  const documents = service.requiredDocuments?.map((document) => document.document) ?? [];
  return documents.length > 0
    ? compact(documents)
    : ['No document requirements are recorded; confirm before applying'];
}

function buildAccessDetails(service: EnrichedService): string[] {
  const accessAttributes = service.attributes
    ?.filter((attribute) => ['delivery', 'cost', 'access'].includes(attribute.taxonomy))
    .map((attribute) => `${humanize(attribute.taxonomy)}: ${humanize(attribute.tag)}`) ?? [];

  return compact([
    service.service.capacityStatus
      ? `Stored capacity: ${humanize(service.service.capacityStatus)} — confirm with the provider`
      : 'Current availability is not recorded; confirm with the provider',
    service.service.waitTime ? `Reported wait: ${service.service.waitTime}` : null,
    service.service.fees ? `Fees: ${service.service.fees}` : null,
    service.service.applicationProcess ? `How to start: ${service.service.applicationProcess}` : null,
    ...accessAttributes,
  ]);
}

function DetailList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 text-sm leading-5 text-slate-700">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

export function SavedServiceComparison({ services, buildServiceHref }: SavedServiceComparisonProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const selectedServices = useMemo(
    () => selectedIds
      .map((serviceId) => services.find((service) => service.service.id === serviceId))
      .filter((service): service is EnrichedService => Boolean(service)),
    [selectedIds, services],
  );

  const toggleService = (serviceId: string) => {
    setSelectedIds((current) => {
      if (current.includes(serviceId)) {
        return current.filter((candidate) => candidate !== serviceId);
      }
      if (current.length >= MAX_COMPARISON_SERVICES) {
        return current;
      }
      return [...current, serviceId];
    });
  };

  return (
    <section
      aria-labelledby="saved-comparison-title"
      className="mb-5 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4 shadow-sm md:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-slate-700" aria-hidden="true" />
            <h2 id="saved-comparison-title" className="text-base font-semibold text-slate-950">
              Compare next steps
            </h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Choose two or three saved services to compare only what ORAN has on record. Selection stays in this browser tab.
          </p>
        </div>
        {selectedIds.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setSelectedIds([])}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear comparison
          </Button>
        )}
      </div>

      <fieldset className="mt-4">
        <legend className="sr-only">Choose saved services to compare</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {services.map((service) => {
            const selected = selectedIds.includes(service.service.id);
            const selectionLimitReached = !selected && selectedIds.length >= MAX_COMPARISON_SERVICES;
            return (
              <label
                key={service.service.id}
                className={`flex min-w-0 items-start gap-3 rounded-[18px] border bg-white px-3 py-3 text-sm transition ${
                  selected
                    ? 'border-slate-900 shadow-sm'
                    : selectionLimitReached
                      ? 'cursor-not-allowed border-slate-200 opacity-55'
                      : 'cursor-pointer border-slate-200 hover:border-slate-400'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={selectionLimitReached}
                  onChange={() => toggleService(service.service.id)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-400 text-slate-950 focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
                  aria-label={`${selected ? 'Remove' : 'Add'} ${service.service.name} ${selected ? 'from' : 'to'} comparison`}
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900">{service.service.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{service.organization.name}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <p className="mt-3 text-sm text-slate-600" role="status" aria-live="polite">
        {selectedIds.length === 0
          ? 'Select at least two services to open the comparison.'
          : selectedIds.length === 1
            ? 'One selected. Choose one or two more services.'
            : `${selectedIds.length} services selected for comparison.`}
        {selectedIds.length === MAX_COMPARISON_SERVICES ? ' Remove one before choosing another.' : ''}
      </p>

      {selectedServices.length >= 2 && (
        <div className="mt-5">
          <div className="overflow-x-auto rounded-[18px] border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left" style={{ minWidth: '54rem' }}>
              <caption className="sr-only">
                Comparison of selected saved services using stored ORAN information
              </caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th scope="col" className="w-40 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Compare
                  </th>
                  {selectedServices.map((service) => (
                    <th key={service.service.id} scope="col" className="min-w-56 px-4 py-3 align-top">
                      <p className="font-semibold text-slate-950">{service.service.name}</p>
                      <p className="mt-1 text-xs font-normal text-slate-500">{service.organization.name}</p>
                      <Link
                        href={buildServiceHref(service)}
                        className="mt-2 inline-flex text-sm font-semibold text-slate-800 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-700"
                      >
                        Review full details
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <th scope="row" className="bg-slate-50/70 px-4 py-4 text-sm font-semibold text-slate-800">Trust and freshness</th>
                  {selectedServices.map((service) => <td key={service.service.id} className="px-4 py-4 align-top"><DetailList items={buildTrustDetails(service)} /></td>)}
                </tr>
                <tr>
                  <th scope="row" className="bg-slate-50/70 px-4 py-4 text-sm font-semibold text-slate-800">Location and area</th>
                  {selectedServices.map((service) => <td key={service.service.id} className="px-4 py-4 align-top"><DetailList items={buildLocationDetails(service)} /></td>)}
                </tr>
                <tr>
                  <th scope="row" className="bg-slate-50/70 px-4 py-4 text-sm font-semibold text-slate-800">Eligibility on record</th>
                  {selectedServices.map((service) => <td key={service.service.id} className="px-4 py-4 align-top"><DetailList items={buildEligibilityDetails(service)} /></td>)}
                </tr>
                <tr>
                  <th scope="row" className="bg-slate-50/70 px-4 py-4 text-sm font-semibold text-slate-800">Documents to prepare</th>
                  {selectedServices.map((service) => <td key={service.service.id} className="px-4 py-4 align-top"><DetailList items={buildDocumentDetails(service)} /></td>)}
                </tr>
                <tr>
                  <th scope="row" className="bg-slate-50/70 px-4 py-4 text-sm font-semibold text-slate-800">Access and next step</th>
                  {selectedServices.map((service) => <td key={service.service.id} className="px-4 py-4 align-top"><DetailList items={buildAccessDetails(service)} /></td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
            This comparison is information, not an eligibility or availability decision. Requirements and capacity can change; confirm directly with each provider before relying on a listing or traveling.
          </p>
        </div>
      )}
    </section>
  );
}
