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
import { MapPin, Phone, Clock, ExternalLink, Bookmark, BookmarkCheck, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import type { ServiceCard } from '@/services/chat/types';

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
  /** Whether this service is saved */
  isSaved?: boolean;
  /** Callback when save/unsave is toggled */
  onToggleSave?: (serviceId: string) => void;
}

export function ChatServiceCard({ card, isSaved, onToggleSave }: ChatServiceCardProps) {
  const [showFeedback, setShowFeedback] = useState(false);

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
    <div className="border border-gray-200 rounded-lg p-3 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-semibold text-gray-900 text-sm leading-tight truncate">
            <Link
              href={`/service/${card.serviceId}`}
              className="hover:underline text-blue-600"
            >
              {card.serviceName}
            </Link>
          </h4>
          <p className="text-xs text-gray-500 truncate">{card.organizationName}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {onToggleSave && (
            <button
              type="button"
              onClick={() => onToggleSave(card.serviceId)}
              className="p-1 rounded-md hover:bg-gray-100 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
              aria-label={isSaved ? 'Remove from saved' : 'Save this service'}
              title={isSaved ? 'Remove from saved' : 'Save for later'}
            >
              {isSaved
                ? <BookmarkCheck className="h-4 w-4 text-blue-600" aria-hidden="true" />
                : <Bookmark className="h-4 w-4 text-gray-400" aria-hidden="true" />}
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
        <p className="text-xs text-gray-600 mt-2 line-clamp-2">{card.description}</p>
      )}

      <div className="mt-2 space-y-1 text-xs text-gray-500">
        {card.address && (
          <div className="flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-gray-400" aria-hidden="true" />
            <span>{card.address}</span>
          </div>
        )}

        {card.phone && (
          <div className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" aria-hidden="true" />
            <a
              href={`tel:${card.phone}`}
              className="text-blue-600 hover:underline"
              aria-label={`Call ${card.serviceName} at ${card.phone}`}
            >
              {card.phone}
            </a>
          </div>
        )}

        {card.scheduleDescription && (
          <div className="flex items-start gap-1.5">
            <Clock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-gray-400" aria-hidden="true" />
            <span>{card.scheduleDescription}</span>
          </div>
        )}
      </div>

      {/* Actionable links derived from verified records */}
      {card.links && card.links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.links.slice(0, 3).map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              {link.label}
            </a>
          ))}
        </div>
      )}

      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">{card.eligibilityHint}</p>

      {/* Feedback button */}
      {!showFeedback && (
        <button
          type="button"
          onClick={() => setShowFeedback(true)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
        >
          <MessageSquare className="h-3 w-3" aria-hidden="true" />
          Feedback
        </button>
      )}

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
