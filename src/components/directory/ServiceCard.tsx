/**
 * ORAN Service Card Component
 *
 * Displays a single service listing with confidence band, address, phone,
 * capacity status, eligibility, taxonomy tags, languages, accessibility,
 * required documents, and always-present eligibility disclaimer.
 *
 * IMPORTANT: Only displays data from DB records. Never generates or infers information.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import {
  MapPin, Phone, Clock, ExternalLink, Tag, Globe2,
  Accessibility, FileText, Heart, Bookmark, BookmarkCheck, AlertCircle,
  Utensils, Navigation, Bus, Users, Layers, MessageSquare,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { ReportProblemDialog } from '@/components/feedback/ReportProblemDialog';
import { OrgProfileCard } from '@/components/host/OrgProfileCard';
import type { EnrichedService } from '@/domain/types';
import type { ConfidenceBand } from '@/domain/types';
import { CONFIDENCE_BANDS, ORAN_CONFIDENCE_WEIGHTS } from '@/domain/constants';
import type { DiscoveryLinkState } from '@/services/search/discovery';
import { summarizeServiceAlignment } from '@/services/search/discoveryPresentation';
import { getSavedTogglePresentation } from '@/services/saved/presentation';

// ============================================================
// HELPERS
// ============================================================

function getConfidenceBand(score?: number | null): ConfidenceBand {
  if (score == null) return 'POSSIBLE';
  if (score >= CONFIDENCE_BANDS.HIGH.min)   return 'HIGH';
  if (score >= CONFIDENCE_BANDS.LIKELY.min) return 'LIKELY';
  return 'POSSIBLE';
}

function bandShortLabel(band: ConfidenceBand): string {
  switch (band) {
    case 'HIGH': return 'High';
    case 'LIKELY': return 'Likely';
    case 'POSSIBLE': return 'Possible';
  }
}

function computeMatchScore(confidence?: EnrichedService['confidenceScore']): number | null {
  if (!confidence) return null;

  const eligibility = confidence.eligibilityMatch;
  const constraint = confidence.constraintFit;

  const matchWeightSum = ORAN_CONFIDENCE_WEIGHTS.eligibility + ORAN_CONFIDENCE_WEIGHTS.constraint;
  if (matchWeightSum <= 0) return null;

  const score =
    (ORAN_CONFIDENCE_WEIGHTS.eligibility * eligibility +
      ORAN_CONFIDENCE_WEIGHTS.constraint * constraint) /
    matchWeightSum;

  return Math.max(0, Math.min(100, score));
}

function formatAddress(address: EnrichedService['address']): string | null {
  if (!address) return null;
  return [address.address1, address.city, address.stateProvince, address.postalCode]
    .filter(Boolean)
    .join(', ');
}

const CAPACITY_STYLES: Record<string, { label: string; color: string }> = {
  available: { label: 'Available', color: 'bg-green-100 text-green-800' },
  limited:   { label: 'Limited',   color: 'bg-amber-100 text-amber-800' },
  waitlist:  { label: 'Waitlist',  color: 'bg-orange-100 text-orange-800' },
  closed:    { label: 'Closed',    color: 'bg-red-100 text-red-800' },
};

// ============================================================
// SERVICE CARD
// ============================================================

interface ServiceCardProps {
  enriched: EnrichedService;
  /** Compact mode for list views */
  compact?: boolean;
  /** Whether this service is saved */
  isSaved?: boolean;
  /** Callback when save/unsave is toggled */
  onToggleSave?: (serviceId: string) => void;
  /** Optional link href for service detail page */
  href?: string;
  /** Optional discovery context used to explain current filter alignment */
  discoveryContext?: DiscoveryLinkState;
  /** Whether saves on this surface also sync to the signed-in account */
  savedSyncEnabled?: boolean;
}

export function ServiceCard({
  enriched,
  compact = false,
  isSaved,
  onToggleSave,
  href,
  discoveryContext,
  savedSyncEnabled,
}: ServiceCardProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  const {
    service, organization, address, phones, schedules, confidenceScore,
    taxonomyTerms, eligibility, requiredDocuments, languages, accessibility,
    attributes, adaptations, dietaryOptions, distanceMeters, contacts,
    serviceAreas, program, location,
  } = enriched;

  const trustBand = getConfidenceBand(confidenceScore?.verificationConfidence);
  const matchScore = computeMatchScore(confidenceScore);
  const matchBand = getConfidenceBand(matchScore);
  const formattedAddress = formatAddress(address);
  const primaryPhone = phones[0];
  const primarySchedule = schedules[0];
  const alignmentLabels = summarizeServiceAlignment(enriched, discoveryContext);
  const savedToggleCopy = savedSyncEnabled == null
    ? {
        ariaLabel: isSaved ? 'Unsave this service' : 'Save this service',
        title: isSaved ? 'Remove from saved' : 'Save for later',
      }
    : getSavedTogglePresentation(Boolean(isSaved), savedSyncEnabled);

  // Capacity status
  const capacity = service.capacityStatus
    ? CAPACITY_STYLES[service.capacityStatus]
    : null;
  const hasExtendedDetails = Boolean(
    (!compact && languages && languages.length > 0)
    || (!compact && accessibility && accessibility.length > 0)
    || (!compact && attributes && attributes.length > 0)
    || (!compact && adaptations && adaptations.length > 0)
    || (!compact && dietaryOptions && dietaryOptions.length > 0)
    || (!compact && program)
    || (!compact && location && (location.transitAccess?.length || location.parkingAvailable))
    || (!compact && contacts && contacts.length > 0)
    || (!compact && serviceAreas && serviceAreas.length > 0)
    || (!compact && eligibility && eligibility.length > 0)
    || (!compact && requiredDocuments && requiredDocuments.length > 0)
    || (!compact && (organization.missionStatement || organization.verifiedAt))
  );

  // Get or create session ID for feedback
  const getSessionId = (): string => {
    if (typeof sessionStorage !== 'undefined') {
      let sid = sessionStorage.getItem('oran_chat_session_id');
      if (!sid) {
        sid = crypto.randomUUID();
        sessionStorage.setItem('oran_chat_session_id', sid);
      }
      return sid;
    }
    return crypto.randomUUID();
  };

  return (
    <article
      className="card-enter rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
      aria-label={`Service: ${service.name}`}
    >
      {/* Header: service name + save action */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-gray-900 leading-snug text-base">
            {href ? (
              <Link href={href} className="text-sky-700 hover:underline">
                {service.name}
              </Link>
            ) : service.url ? (
              <a
                href={service.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sky-700 hover:underline"
              >
                {service.name}
                <ExternalLink className="h-3 w-3 flex-shrink-0" aria-label="(opens in new tab)" />
              </a>
            ) : (
              service.name
            )}
          </h3>
          <p className="mt-0.5 text-xs leading-tight text-slate-500">{organization.name}</p>
        </div>
        {onToggleSave && (
          <button
            type="button"
            onClick={() => onToggleSave(service.id)}
            className="-mr-2 -mt-1 flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-slate-100"
            aria-pressed={isSaved ?? false}
            aria-label={savedToggleCopy.ariaLabel}
            title={savedToggleCopy.title}
          >
            {isSaved
              ? <BookmarkCheck className="h-5 w-5 text-blue-600" aria-hidden="true" />
              : <Bookmark className="h-5 w-5 text-slate-400" aria-hidden="true" />}
          </button>
        )}
      </div>

      {/* Badge row: trust band + match + capacity — below org name, above description */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <Badge
          band={trustBand}
          title={`Trust: ${bandShortLabel(trustBand)}`}
          aria-label={`Trust: ${bandShortLabel(trustBand)}`}
        >
          {bandShortLabel(trustBand)}
        </Badge>
        {matchScore != null && (
          <Badge
            band={matchBand}
            title={`Match: ${bandShortLabel(matchBand)}`}
            aria-label={`Match: ${bandShortLabel(matchBand)}`}
          >
            Match: {bandShortLabel(matchBand)}
          </Badge>
        )}
        {capacity && (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none ${capacity.color}`}>
            {capacity.label}
          </span>
        )}
        {service.estimatedWaitDays != null && (
          <span className="text-xs text-gray-500 leading-none">
            ~{service.estimatedWaitDays}d wait
          </span>
        )}
      </div>

      {alignmentLabels.length > 0 && (
        <div className="mb-2 rounded-2xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <span className="font-semibold">Fits your current scope:</span>{' '}
          {alignmentLabels.join(', ')}
        </div>
      )}

      {/* Description */}
      {!compact && service.description && (
        <p className="mb-3 line-clamp-2 text-sm text-slate-600">{service.description}</p>
      )}

      {/* Taxonomy tags */}
      {taxonomyTerms.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {taxonomyTerms.slice(0, compact ? 3 : 4).map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              <Tag className="h-3 w-3" aria-hidden="true" />
              {t.term}
            </span>
          ))}
          {taxonomyTerms.length > (compact ? 3 : 4) && (
            <span className="text-xs text-slate-400">+{taxonomyTerms.length - (compact ? 3 : 4)} more</span>
          )}
        </div>
      )}

      {/* Core details */}
      <div className="space-y-1.5 text-sm">
        {formattedAddress && (
          <div className="flex items-start gap-2 text-gray-600">
            <MapPin className="h-4 w-4 flex-shrink-0 mt-0.5 text-gray-400" aria-hidden="true" />
            <span>
              {formattedAddress}
              {distanceMeters != null && (
                <span className="ml-1.5 text-gray-400">
                  ({distanceMeters < 1000
                    ? `${Math.round(distanceMeters)}m`
                    : `${(distanceMeters / 1000).toFixed(1)}km`} away)
                </span>
              )}
            </span>
          </div>
        )}

        {primaryPhone && (
          <div className="flex items-center gap-2 text-gray-600">
            <Phone className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
            <a
              href={`tel:${primaryPhone.number}`}
              className="hover:underline text-blue-600"
              aria-label={`Call ${service.name}: ${primaryPhone.number}`}
            >
              {primaryPhone.number}
              {primaryPhone.extension && ` ext. ${primaryPhone.extension}`}
            </a>
          </div>
        )}

        {primarySchedule?.description && (
          <div className="flex items-start gap-2 text-gray-600">
            <Clock className="h-4 w-4 flex-shrink-0 mt-0.5 text-gray-400" aria-hidden="true" />
            <span>{primarySchedule.description}</span>
          </div>
        )}
      </div>

      {/* Fees */}
      {!compact && service.fees && (
        <div className="mt-2 text-sm">
          <span className="font-medium text-slate-700">Fees: </span>
          <span className="text-slate-600">{service.fees}</span>
        </div>
      )}

      {hasExtendedDetails && !compact && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setShowMoreDetails((current) => !current)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white"
            aria-expanded={showMoreDetails}
          >
            {showMoreDetails ? 'Hide details' : 'More details'}
          </button>
        </div>
      )}

      {showMoreDetails && !compact && languages && languages.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2 text-sm text-gray-600">
          <Globe2 className="h-4 w-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
          <span>{languages.map((l) => l.language).join(', ')}</span>
        </div>
      )}

      {showMoreDetails && !compact && accessibility && accessibility.length > 0 && (
        <div className="flex items-start gap-1.5 mt-2 text-sm text-gray-600">
          <Accessibility className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{accessibility.map((a) => a.accessibility).join(', ')}</span>
        </div>
      )}

      {showMoreDetails && !compact && attributes && attributes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {attributes.slice(0, 6).map((attr) => (
            <span
              key={attr.id}
              className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
              title={attr.details ?? undefined}
            >
              {attr.tag}
            </span>
          ))}
        </div>
      )}

      {showMoreDetails && !compact && adaptations && adaptations.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {adaptations.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700"
              title={a.details ?? undefined}
            >
              <Heart className="h-3 w-3" aria-hidden="true" />
              {a.adaptationTag}
            </span>
          ))}
        </div>
      )}

      {showMoreDetails && !compact && dietaryOptions && dietaryOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {dietaryOptions.map((d) => (
            <span
              key={d.id}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
              title={d.details ?? undefined}
            >
              <Utensils className="h-3 w-3" aria-hidden="true" />
              {d.dietaryType}
              {d.availability && d.availability !== 'always' && (
                <span className="text-emerald-500">({d.availability})</span>
              )}
            </span>
          ))}
        </div>
      )}

      {showMoreDetails && !compact && program && (
        <div className="mt-2 text-sm text-gray-600">
          <span className="flex items-center gap-1 text-xs font-medium text-gray-700">
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            Program: {program.name}
          </span>
        </div>
      )}

      {showMoreDetails && !compact && location && (location.transitAccess?.length || location.parkingAvailable) && (
        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-600">
          {location.transitAccess && location.transitAccess.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Bus className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
              {location.transitAccess.map((t) => t.replace(/_/g, ' ')).join(', ')}
            </span>
          )}
          {location.parkingAvailable && location.parkingAvailable !== 'unknown' && (
            <span className="inline-flex items-center gap-1">
              <Navigation className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
              Parking: {location.parkingAvailable.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      )}

      {showMoreDetails && !compact && contacts && contacts.length > 0 && (
        <div className="mt-2 text-sm text-gray-600">
          <p className="flex items-center gap-1 font-medium text-gray-700 text-xs">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Contact{contacts.length > 1 ? 's' : ''}
          </p>
          {contacts.slice(0, 2).map((c) => (
            <p key={c.id} className="text-xs mt-0.5 break-all">
              {[c.name, c.title, c.email].filter(Boolean).join(' · ')}
            </p>
          ))}
        </div>
      )}

      {showMoreDetails && !compact && serviceAreas && serviceAreas.length > 0 && (
        <div className="mt-2 text-xs text-gray-500 flex flex-wrap items-center gap-1">
          <Globe2 className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
          Serves: {serviceAreas.map((sa) => sa.name ?? sa.extentType ?? 'Custom area').join(', ')}
        </div>
      )}

      {showMoreDetails && !compact && eligibility && eligibility.length > 0 && (
        <div className="mt-2 text-sm border-l-2 border-amber-300 pl-2">
          <p className="font-medium text-gray-700 flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Eligibility
          </p>
          {eligibility.slice(0, 2).map((e, i) => (
            <p key={i} className="text-xs text-gray-600 mt-0.5">
              {e.description}
              {(e.minimumAge != null || e.maximumAge != null) && (
                <span className="ml-1 text-gray-500">
                  (Ages {e.minimumAge ?? '?'}–{e.maximumAge ?? '?'})
                </span>
              )}
            </p>
          ))}
          {eligibility.length > 2 && (
            <p className="text-xs text-gray-400 mt-0.5">+{eligibility.length - 2} more criteria</p>
          )}
        </div>
      )}

      {showMoreDetails && !compact && requiredDocuments && requiredDocuments.length > 0 && (
        <div className="mt-2 text-sm text-gray-600">
          <p className="flex items-center gap-1 font-medium text-gray-700">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Bring:
          </p>
          <ul className="list-disc list-inside text-xs mt-0.5 space-y-0.5">
            {requiredDocuments.map((d, i) => (
              <li key={i}>{d.document}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
        You may qualify. Confirm eligibility and hours with the provider.
      </p>

      {showMoreDetails && !compact && (organization.missionStatement || organization.verifiedAt) && (
        <div className="mt-3">
          <OrgProfileCard
            org={{
              id: organization.id,
              name: organization.name,
              logoUrl: organization.logoUrl,
              missionStatement: organization.missionStatement,
              whoWeServe: organization.whoWeServe,
              serviceRegion: organization.serviceRegion,
              verifiedAt: typeof organization.verifiedAt === 'string' ? organization.verifiedAt : (organization.verifiedAt ? String(organization.verifiedAt) : null),
              url: organization.url,
              email: organization.email,
            }}
            size="md"
          />
        </div>
      )}

      {/* Bottom action row: View details + feedback/report */}
      {!showFeedback && (
        <div className="mt-3 flex items-center justify-between gap-1 border-t border-slate-100 pt-1.5 -mx-1">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setShowFeedback(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              Feedback
            </button>
            <button
              type="button"
              onClick={() => setShowReport(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-amber-50 hover:text-amber-800"
            >
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Flag issue
            </button>
          </div>
          {href && (
            <Link
              href={href}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-50"
            >
              View details
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}

      {/* Feedback form */}
      {showFeedback && (
        <div className="mt-3">
          <FeedbackForm
            serviceId={service.id}
            sessionId={getSessionId()}
            onClose={() => setShowFeedback(false)}
          />
        </div>
      )}

      {/* Confidence score — accessible via badge row; raw numbers omitted to reduce noise */}

      {/* Report Problem Dialog */}
      <ReportProblemDialog
        serviceId={service.id}
        serviceName={service.name}
        open={showReport}
        onOpenChange={setShowReport}
      />
    </article>
  );
}

export default ServiceCard;
