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
import { AlertTriangle, Award, MapPin, Phone, Clock, ExternalLink, Bookmark, BookmarkCheck, MessageSquare, Flag, ShieldCheck, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { AddToPlanDialog } from '@/components/seeker/AddToPlanDialog';
import { SavedCollectionsDialog } from '@/components/seeker/SavedCollectionsDialog';
import type { ServiceCard } from '@/services/chat/types';
import { buildPlanServiceSnapshotFromChatCard } from '@/services/plans/snapshots';
import { buildDiscoveryHref, type DiscoveryLinkState } from '@/services/search/discovery';
import { getSavedTogglePresentation } from '@/services/saved/presentation';
import { formatVerificationStatus, needsVerificationWarning } from '@/domain/resourceNavigator';

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

function formatDistance(distanceMeters: number): string {
  const miles = distanceMeters / 1609.344;
  return miles < 0.1 ? 'Less than 0.1 mi away' : `${miles.toFixed(miles < 10 ? 1 : 0)} mi away`;
}

function formatCheckedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
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
    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
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
                className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0 text-[10px] font-semibold text-slate-700"
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
            title={`Record confidence: ${bandShortLabel(card.confidenceBand)}`}
            aria-label={`Record confidence: ${bandShortLabel(card.confidenceBand)}`}
          >
            Record confidence: {bandShortLabel(card.confidenceBand)}
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

        {(card.distanceMeters != null || card.serviceAreaSummary) && (
          <div className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
            <span>
              {[
                card.distanceMeters != null ? formatDistance(card.distanceMeters) : null,
                card.serviceAreaSummary ? `Serves ${card.serviceAreaSummary}` : null,
              ].filter(Boolean).join(' · ')}
            </span>
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

      <div className="mt-3 rounded-2xl border border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-800">
        <p className="font-semibold uppercase tracking-wider text-slate-500">Next step</p>
        <p className="mt-1 font-medium leading-5 text-slate-900">{card.nextStep ?? 'Open ORAN details and confirm the current intake process with the provider.'}</p>
        <p className="mt-2 leading-5 text-slate-600"><span className="font-medium text-slate-800">What to ask:</span> {card.whatToAsk ?? `Ask whether ${card.serviceName} is currently available, what you need to bring, and how to start.`}</p>
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

      {onToggleSave && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SavedCollectionsDialog
            serviceId={card.serviceId}
            serviceName={card.serviceName}
            isSaved={Boolean(isSaved)}
            onEnsureSaved={() => {
              if (!isSaved) {
                onToggleSave(card.serviceId);
              }
            }}
            savedSyncEnabled={Boolean(savedSyncEnabled)}
            triggerClassName="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          />
          <AddToPlanDialog
            service={buildPlanServiceSnapshotFromChatCard(card, serviceHref)}
            source="chat_service"
            triggerClassName="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          />
        </div>
      )}

      {card.matchReasons && card.matchReasons.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Why this may fit</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {card.matchReasons.map((reason) => (
              <span
                key={reason}
                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700"
              >
                {reason}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">{card.eligibilityHint}</p>

      {card.requiredDocuments && card.requiredDocuments.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700">
          <FileText className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
          <p><span className="font-medium text-slate-900">Documents listed:</span> {card.requiredDocuments.slice(0, 3).join(', ')}</p>
        </div>
      )}

      {(needsVerificationWarning(card.verificationStatus) || (!card.sourceLastCheckedAt && !card.verificationLastCheckedAt)) && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950" role="note">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <p>
            {card.verificationStatus === 'stale'
              ? 'This record is marked stale. Confirm every detail before relying on it.'
              : card.verificationStatus === 'disputed'
                ? 'This record has a disputed detail under review.'
                : card.verificationStatus === 'retired'
                  ? 'This record is retired and should not be treated as available.'
                  : card.verificationStatus === 'unverified'
                    ? 'This record is unverified. Use the source details below and confirm with the provider.'
                    : 'A source-check date is not available in this result. Confirm hours, eligibility, and intake before visiting.'}
          </p>
        </div>
      )}

      <details className="mt-3 rounded-xl border border-slate-200 bg-white text-xs text-slate-700">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
          <ShieldCheck className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
          Source &amp; verification details
        </summary>
        <dl className="grid gap-2 border-t border-slate-200 px-3 py-3 sm:grid-cols-3">
          <dt className="font-medium text-slate-500">Verification</dt>
          <dd className="sm:col-span-2">{card.verificationStatus ? formatVerificationStatus(card.verificationStatus) : `No provider verification decision recorded; record confidence is ${bandShortLabel(card.confidenceBand).toLowerCase()}`}</dd>
          <dt className="font-medium text-slate-500">Last verified</dt>
          <dd className="sm:col-span-2">{card.verificationLastCheckedAt ? formatCheckedDate(card.verificationLastCheckedAt) : 'Not available in this result'}</dd>
          <dt className="font-medium text-slate-500">Stored source</dt>
          <dd className="sm:col-span-2">
            {card.sourceUrl ? (
              <a href={card.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-900 hover:underline">
                {card.sourceLabel ?? 'Open stored source'}
              </a>
            ) : 'No source link is included in this result'}
          </dd>
          <dt className="font-medium text-slate-500">Source checked</dt>
          <dd className="sm:col-span-2">{card.sourceLastCheckedAt ? formatCheckedDate(card.sourceLastCheckedAt) : 'Unknown'}</dd>
        </dl>
      </details>

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
          className="inline-flex min-h-[44px] items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-900"
          title="Report incorrect information — wrong address, closed, or other data issue"
        >
          <Flag className="h-3 w-3" aria-hidden="true" />
          Flag issue
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
