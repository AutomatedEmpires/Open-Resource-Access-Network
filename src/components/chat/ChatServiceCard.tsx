/**
 * Chat Service Card
 *
 * Compact service card designed for inline display within chat message bubbles.
 * Uses the flat ServiceCard type from the chat API response.
 *
 * For standalone list views (directory, map, saved), use
 * `src/components/directory/ServiceCard.tsx` which takes the full EnrichedService type.
 *
 * Both cards share the same visual language (Badge, lucide icons) but differ in
 * rendering context: this card is embedded in constrained chat bubbles; the
 * directory card is a full <article> with richer detail (fees, external links, score).
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Award, MapPin, Phone, Clock, ExternalLink, Bookmark, BookmarkCheck, MessageSquare, Flag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import type { ServiceCard } from '@/services/chat/types';
import { buildDiscoveryHref, type DiscoveryLinkState } from '@/services/search/discovery';
import { getSavedTogglePresentation } from '@/services/saved/presentation';

function bandShortLabel(band: ServiceCard['confidenceBand']): string {
  switch (band) {
    case 'HIGH':
      return 'High';
    case 'LIKELY':
      return 'Likely';
    case 'POSSIBLE':
      return 'Possible';
  }
}

interface ChatServiceCardProps {
  card: ServiceCard;
  discoveryContext?: DiscoveryLinkState;
  /** Whether this service is saved */
  isSaved?: boolean;
  /** Callback when save/unsave is toggled */
  onToggleSave?: (serviceId: string) => void;
  /** Whether saves on this surface also sync to the signed-in account */
  savedSyncEnabled?: boolean;
}

export function ChatServiceCard({
  card,
  discoveryContext,
  isSaved,
  onToggleSave,
  savedSyncEnabled,
}: ChatServiceCardProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const serviceHref = buildDiscoveryHref(`/service/${card.serviceId}`, discoveryContext ?? {});
  const reportHref = buildDiscoveryHref(`/report?serviceId=${encodeURIComponent(card.serviceId)}`, discoveryContext ?? {});
  const savedToggleCopy = savedSyncEnabled == null
    ? {
        ariaLabel: isSaved ? 'Remove from saved' : 'Save this service',
        title: isSaved ? 'Remove from saved' : 'Save for later',
      }
    : getSavedTogglePresentation(Boolean(isSaved), savedSyncEnabled);

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
    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold leading-tight text-slate-900">
            <Link
              href={serviceHref}
              className="transition-colors hover:text-slate-700 hover:underline"
            >
              {card.serviceName}
            </Link>
          </h4>
          <p className="flex items-center gap-1 truncate text-xs text-slate-500">
            {card.organizationName}
            {(card as ServiceCard & { orgVerifiedAt?: string }).orgVerifiedAt && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0 text-[10px] font-semibold text-emerald-700"
                title="Verified Provider"
              >
                <Award className="h-2.5 w-2.5" aria-hidden="true" />
                Verified
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {onToggleSave && (
            <button
              type="button"
              onClick={() => onToggleSave(card.serviceId)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-slate-200 bg-white p-1 transition-colors hover:bg-slate-50"
              aria-label={savedToggleCopy.ariaLabel}
              title={savedToggleCopy.title}
            >
              {isSaved
                ? <BookmarkCheck className="h-4 w-4 text-slate-900" aria-hidden="true" />
                : <Bookmark className="h-4 w-4 text-slate-400" aria-hidden="true" />}
            </button>
          )}
          <Badge
            band={card.confidenceBand}
            className="flex-shrink-0 text-xs"
            title={`Trust: ${bandShortLabel(card.confidenceBand)}`}
            aria-label={`Trust: ${bandShortLabel(card.confidenceBand)}`}
          >
            Trust: {bandShortLabel(card.confidenceBand)}
          </Badge>
        </div>
      </div>

      {card.description && (
        <p className="mt-2 line-clamp-2 text-xs text-slate-600">{card.description}</p>
      )}

      <div className="mt-3 space-y-1 text-xs text-slate-500">
        {card.address && (
          <div className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
            <span>{card.address}</span>
          </div>
        )}

        {card.phone && (
          <div className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
            <a
              href={`tel:${card.phone}`}
              className="text-slate-900 hover:underline"
              aria-label={`Call ${card.serviceName} at ${card.phone}`}
            >
              {card.phone}
            </a>
          </div>
        )}

        {card.scheduleDescription && (
          <div className="flex items-start gap-1.5">
            <Clock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
            <span>{card.scheduleDescription}</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={serviceHref}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800"
        >
          ORAN details
        </Link>
        {card.links?.slice(0, 2).map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {link.label}
          </a>
        ))}
      </div>

      {card.matchReasons && card.matchReasons.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Why this may fit</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {card.matchReasons.map((reason) => (
              <span
                key={reason}
                className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800"
              >
                {reason}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">{card.eligibilityHint}</p>

      {/* Feedback + report actions */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!showFeedback && (
          <button
            type="button"
            onClick={() => setShowFeedback(true)}
            className="inline-flex min-h-[44px] items-center gap-1 text-xs text-slate-500 transition-colors hover:text-slate-900"
            title="Rate this result — did it match what you needed?"
          >
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            Rate result
          </button>
        )}
        <Link
          href={reportHref}
          className="inline-flex min-h-[44px] items-center gap-1 text-xs text-slate-400 transition-colors hover:text-red-600"
          title="Report incorrect information — wrong address, closed, or other data issue"
        >
          <Flag className="h-3 w-3" aria-hidden="true" />
          Report data issue
        </Link>
      </div>

      {/* Feedback form */}
      {showFeedback && (
        <div className="mt-2">
          <FeedbackForm
            serviceId={card.serviceId}
            sessionId={getSessionId()}
            onClose={() => setShowFeedback(false)}
          />
        </div>
      )}
    </div>
  );
}

export default ChatServiceCard;
