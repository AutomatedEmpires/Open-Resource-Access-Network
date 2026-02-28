/**
 * ORAN Service Card Component
 *
 * Displays a single service listing with confidence band, address, phone,
 * and always-present eligibility disclaimer.
 *
 * IMPORTANT: Only displays data from DB records. Never generates or infers information.
 */

import React from 'react';
import { MapPin, Phone, Clock, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { EnrichedService } from '@/domain/types';
import type { ConfidenceBand } from '@/domain/types';
import { CONFIDENCE_BANDS } from '@/domain/constants';

// ============================================================
// HELPERS
// ============================================================

function getConfidenceBand(score?: number | null): ConfidenceBand {
  if (score == null) return 'POSSIBLE';
  if (score >= CONFIDENCE_BANDS.HIGH.min)   return 'HIGH';
  if (score >= CONFIDENCE_BANDS.LIKELY.min) return 'LIKELY';
  return 'POSSIBLE';
}

function formatAddress(address: EnrichedService['address']): string | null {
  if (!address) return null;
  return [address.address1, address.city, address.stateProvince, address.postalCode]
    .filter(Boolean)
    .join(', ');
}

// ============================================================
// SERVICE CARD
// ============================================================

interface ServiceCardProps {
  enriched: EnrichedService;
  /** Compact mode for list views */
  compact?: boolean;
}

export function ServiceCard({ enriched, compact = false }: ServiceCardProps) {
  const { service, organization, address, phones, schedules, confidenceScore } = enriched;
  const band = getConfidenceBand(confidenceScore?.score);
  const formattedAddress = formatAddress(address);
  const primaryPhone = phones[0];
  const primarySchedule = schedules[0];

  return (
    <article
      className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4"
      aria-label={`Service: ${service.name}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 leading-tight">
            {service.url ? (
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
          <p className="text-sm text-gray-500 mt-0.5">{organization.name}</p>
        </div>
        <Badge band={band} className="flex-shrink-0" />
      </div>

      {/* Description */}
      {!compact && service.description && (
        <p className="text-sm text-gray-600 mb-3 line-clamp-3">{service.description}</p>
      )}

      {/* Details */}
      <div className="space-y-1.5 text-sm">
        {formattedAddress && (
          <div className="flex items-start gap-2 text-gray-600">
            <MapPin className="h-4 w-4 flex-shrink-0 mt-0.5 text-gray-400" aria-hidden="true" />
            <span>{formattedAddress}</span>
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

      {/* Eligibility hint — "may qualify" language — NEVER guarantee */}
      <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
        You may qualify for this service. Confirm eligibility with the provider before visiting.
      </p>

      {/* Confidence score detail */}
      {confidenceScore && (
        <div className="mt-2 text-xs text-gray-400 text-right">
          {CONFIDENCE_BANDS[band].label} · Score: {confidenceScore.score.toFixed(0)}%
        </div>
      )}
    </article>
  );
}

export default ServiceCard;
