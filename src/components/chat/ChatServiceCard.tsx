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

import React from 'react';
import { MapPin, Phone, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ServiceCard } from '@/services/chat/types';

interface ChatServiceCardProps {
  card: ServiceCard;
}

export function ChatServiceCard({ card }: ChatServiceCardProps) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-semibold text-gray-900 text-sm leading-tight truncate">
            {card.serviceName}
          </h4>
          <p className="text-xs text-gray-500 truncate">{card.organizationName}</p>
        </div>
        <Badge band={card.confidenceBand} className="flex-shrink-0 text-xs" />
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

      <p className="text-xs text-gray-400 italic mt-2">{card.eligibilityHint}</p>
    </div>
  );
}

export default ChatServiceCard;
