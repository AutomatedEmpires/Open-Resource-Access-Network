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
import type { EnrichedService } from '@/domain/types';
import type { ConfidenceBand } from '@/domain/types';
import { CONFIDENCE_BANDS, ORAN_CONFIDENCE_WEIGHTS } from '@/domain/constants';

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
}

export function ServiceCard({ enriched, compact = false, isSaved, onToggleSave, href }: ServiceCardProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [showReport, setShowReport] = useState(false);

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

  // Capacity status
  const capacity = service.capacityStatus
    ? CAPACITY_STYLES[service.capacityStatus]
    : null;

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
      className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 card-enter"
      aria-label={`Service: ${service.name}`}
    >
      {/* Header: service name + save action */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-gray-900 leading-snug text-base">
            {href ? (
              <Link
                href={href}
                className="hover:underline text-blue-700 inline-flex items-center gap-1"
              >
                {service.name}
              </Link>
            ) : service.url ? (
              <a
                href={service.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline text-blue-700 inline-flex items-center gap-1"
              >
                {service.name}
                <ExternalLink className="h-3 w-3 flex-shrink-0" aria-label="(opens in new tab)" />
              </a>
            ) : (
              service.name
            )}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 leading-tight">{organization.name}</p>
        </div>
        {onToggleSave && (
          <button
            type="button"
            onClick={() => onToggleSave(service.id)}
            className="flex-shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg hover:bg-gray-100 transition-colors -mr-2 -mt-1"
            aria-pressed={isSaved ?? false}
            aria-label={isSaved ? 'Unsave this service' : 'Save this service'}
            title={isSaved ? 'Remove from saved' : 'Save for later'}
          >
            {isSaved
              ? <BookmarkCheck className="h-5 w-5 text-blue-600" aria-hidden="true" />
              : <Bookmark className="h-5 w-5 text-gray-400" aria-hidden="true" />}
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

      {/* Description */}
      {!compact && service.description && (
        <p className="text-sm text-gray-600 mb-3 line-clamp-3">{service.description}</p>
      )}

      {/* Taxonomy tags */}
      {taxonomyTerms.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {taxonomyTerms.slice(0, 5).map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              <Tag className="h-3 w-3" aria-hidden="true" />
              {t.term}
            </span>
          ))}
          {taxonomyTerms.length > 5 && (
            <span className="text-xs text-gray-400">+{taxonomyTerms.length - 5} more</span>
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
          <span className="font-medium text-gray-700">Fees: </span>
          <span className="text-gray-600">{service.fees}</span>
        </div>
      )}

      {/* Languages */}
      {!compact && languages && languages.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2 text-sm text-gray-600">
          <Globe2 className="h-4 w-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
          <span>{languages.map((l) => l.language).join(', ')}</span>
        </div>
      )}

      {/* Accessibility */}
      {!compact && accessibility && accessibility.length > 0 && (
        <div className="flex items-start gap-1.5 mt-2 text-sm text-gray-600">
          <Accessibility className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{accessibility.map((a) => a.accessibility).join(', ')}</span>
        </div>
      )}

      {/* Service attributes — delivery, cost, access badges */}
      {!compact && attributes && attributes.length > 0 && (
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

      {/* Adaptations */}
      {!compact && adaptations && adaptations.length > 0 && (
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

      {/* Dietary options */}
      {!compact && dietaryOptions && dietaryOptions.length > 0 && (
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

      {/* Program */}
      {!compact && program && (
        <div className="mt-2 text-sm text-gray-600">
          <span className="flex items-center gap-1 text-xs font-medium text-gray-700">
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            Program: {program.name}
          </span>
        </div>
      )}

      {/* Transit & parking */}
      {!compact && location && (location.transitAccess?.length || location.parkingAvailable) && (
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

      {/* Contacts */}
      {!compact && contacts && contacts.length > 0 && (
        <div className="mt-2 text-sm text-gray-600">
          <p className="flex items-center gap-1 font-medium text-gray-700 text-xs">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Contact{contacts.length > 1 ? 's' : ''}
          </p>
          {contacts.slice(0, 2).map((c) => (
            <p key={c.id} className="text-xs mt-0.5">
              {[c.name, c.title, c.email].filter(Boolean).join(' · ')}
            </p>
          ))}
        </div>
      )}

      {/* Service area */}
      {!compact && serviceAreas && serviceAreas.length > 0 && (
        <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
          <Globe2 className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
          Serves: {serviceAreas.map((sa) => sa.name ?? sa.extentType ?? 'Custom area').join(', ')}
        </div>
      )}

      {/* Eligibility summary */}
      {!compact && eligibility && eligibility.length > 0 && (
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

      {/* Required documents */}
      {!compact && requiredDocuments && requiredDocuments.length > 0 && (
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

      {/* Eligibility hint — "may qualify" language — NEVER guarantee */}
      <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
        You may qualify. Confirm eligibility and hours with the provider.
      </p>

      {/* Bottom action row: View details + feedback/report */}
      {!showFeedback && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowFeedback(true)}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
            >
              <MessageSquare className="h-3 w-3" aria-hidden="true" />
              Feedback
            </button>
            <button
              type="button"
              onClick={() => setShowReport(true)}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 transition-colors"
            >
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              Flag issue
            </button>
          </div>
          {href && (
            <Link
              href={href}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
            >
              View details
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
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
