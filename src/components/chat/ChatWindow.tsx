/**
 * ORAN Chat Window Component
 *
 * Primary chat interface for service discovery.
 * Always shows: crisis banner (when triggered), eligibility disclaimer.
 * Never generates or invents service information — all data from API.
 */

'use client';
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { Send, AlertTriangle, Phone, Trash2, Clock, Plus, SlidersHorizontal, Bookmark, BookmarkCheck, MapPin, BellRing, ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ELIGIBILITY_DISCLAIMER, MAX_CHAT_QUOTA } from '@/domain/constants';
import type { DiscoveryNeedId } from '@/domain/discoveryNeeds';
import type { GuidedIntakeSubmission } from '@/domain/resourceNavigator';
import { SERVICE_ATTRIBUTES_TAXONOMY } from '@/domain/taxonomy';
import type {
  ChatClarification,
  ChatResponse,
  ChatSessionContext,
  SearchInterpretation,
  ServiceCard,
} from '@/services/chat/types';
import {
  clearGuidedIntakeRetry,
  clearGuidedIntakeRetryBlockedUntil,
  MAX_GUIDED_INTAKE_RETRY_BLOCK_MS,
  readGuidedIntakeRetry,
  readGuidedIntakeRetryBlockedUntil,
  writeGuidedIntakeRetry,
  writeGuidedIntakeRetryBlockedUntil,
} from '@/services/chat/guidedIntakeHandoff';
import { ChatServiceCard } from '@/components/chat/ChatServiceCard';
import { DiscoveryContextPanel } from '@/components/seeker/DiscoveryContextPanel';
import { DistanceRadiusControl } from '@/components/seeker/DistanceRadiusControl';
import { QuickNeedFilterGrid } from '@/components/seeker/QuickNeedFilterGrid';
import { ResourceSearchRecovery } from '@/components/seeker/ResourceSearchRecovery';
import { useToast } from '@/components/ui/toast';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
  addServerSaved,
  readStoredSavedServiceIds,
  removeServerSaved,
  writeStoredSavedServiceIds,
} from '@/services/saved/client';
import { getSavedTogglePresentation } from '@/services/saved/presentation';
import { useSeekerFeatureFlags } from '@/components/seeker/SeekerFeatureFlags';
import { buildPlanServiceSnapshotFromChatCard } from '@/services/plans/snapshots';
import { buildChatExecutionProposal, type ChatExecutionProposalDraft } from '@/services/chat/executionCommands';
import {
  addServicePlanItem,
  createSeekerPlan,
  getActiveSeekerPlan,
  readStoredSeekerPlansState,
  setActiveSeekerPlan,
  updateSeekerPlanItem,
} from '@/services/plans/client';
import { trackInteraction } from '@/services/telemetry/sentry';
import type {
  DiscoveryConfidenceFilter,
  DiscoveryLinkState,
  DiscoverySortOption,
} from '@/services/search/discovery';
import { buildDiscoveryHref } from '@/services/search/discovery';
import type { SearchFilters } from '@/services/search/types';
import { DISCOVERY_ATTRIBUTE_LABELS } from '@/services/search/discoveryPresentation';
import { clampDiscoveryRadiusMiles, DEFAULT_DISCOVERY_RADIUS_MILES } from '@/services/search/radius';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Trust filter options — 'all' shows everything */
type TrustFilter = 'all' | 'HIGH' | 'LIKELY';

function formatFilterLabel(value: string): string {
  return value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

const SEEKER_ATTRIBUTE_DIMENSIONS = ['delivery', 'cost', 'access', 'culture', 'population', 'situation'] as const;

const DIMENSION_LABELS: Record<string, string> = {
  delivery: 'How support is delivered',
  cost: 'Cost and payment',
  access: 'Access and requirements',
  culture: 'Language and cultural fit',
  population: 'Who it serves',
  situation: 'Specific life situations',
};

const DEFAULT_GUIDED_RETRY_BLOCK_MS = 30_000;

function parseRetryAfterDeadline(value: string | null | undefined, now = Date.now()): number {
  if (value) {
    const normalizedValue = value.trim();
    const seconds = Number(normalizedValue);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return now + Math.min(seconds * 1000, MAX_GUIDED_INTAKE_RETRY_BLOCK_MS);
    }

    const dateDeadline = Date.parse(normalizedValue);
    if (Number.isFinite(dateDeadline)) {
      return dateDeadline > now
        ? Math.min(dateDeadline, now + MAX_GUIDED_INTAKE_RETRY_BLOCK_MS)
        : now;
    }
  }

  return now + DEFAULT_GUIDED_RETRY_BLOCK_MS;
}

// ============================================================
// CRISIS BANNER
// ============================================================

function CrisisBanner() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="bg-red-700 text-white p-4 rounded-lg mb-4 border-2 border-red-900"
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
        <strong className="text-lg">Immediate Help Available</strong>
      </div>
      <p className="mb-3 text-sm">
        It sounds like you may be in crisis or immediate danger. Please reach out now.
      </p>
      <div className="space-y-2">
        <a
          href="tel:911"
          className="flex items-center gap-2 bg-white text-red-700 font-bold px-3 py-2 rounded hover:bg-red-50 transition-colors min-h-[44px]"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          Emergency: Call 911
        </a>
        <a
          href="tel:988"
          className="flex items-center gap-2 bg-white text-red-700 font-bold px-3 py-2 rounded hover:bg-red-50 transition-colors min-h-[44px]"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          Crisis Line: Call or text 988
        </a>
        <a
          href="tel:211"
          className="flex items-center gap-2 bg-white text-red-700 font-bold px-3 py-2 rounded hover:bg-red-50 transition-colors min-h-[44px]"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          Community Resources: Call 211
        </a>
      </div>
    </div>
  );
}

// ============================================================
// MESSAGE TYPES
// ============================================================

interface UserMessage {
  role: 'user';
  content: string;
  timestamp: Date;
}

interface AssistantMessage {
  role: 'assistant';
  content: string;
  timestamp: Date;
  resultSummary?: string;
  services?: ServiceCard[];
  isCrisis?: boolean;
  discoveryContext?: DiscoveryLinkState;
  retrievalStatus?: ChatResponse['retrievalStatus'];
  activeContextUsed?: boolean;
  sessionContext?: ChatSessionContext;
  searchInterpretation?: SearchInterpretation;
  clarification?: ChatClarification;
  followUpSuggestions?: string[];
  executionProposal?: ChatExecutionProposal;
}

type Message = UserMessage | AssistantMessage;

interface ChatExecutionProposal extends ChatExecutionProposalDraft {
  status: 'pending' | 'applied' | 'cancelled';
  serviceHref: string;
}

/** Format timestamp as a short time string (e.g. "2:34 PM") */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Auto-resize a textarea to fit its content up to a max height */
function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  if (!el.value) return;
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

/** localStorage key for persisting the quota-reset timestamp across page reloads */
const QUOTA_RESET_KEY = 'oran:quota-reset-at';
const SESSION_CONTEXT_KEY_PREFIX = 'oran:chat-session-context:';
const CHAT_TRANSCRIPT_KEY_PREFIX = 'oran:chat-transcript:';
const CHAT_DRAFT_KEY_PREFIX = 'oran:chat-draft:';
const LOCATION_PROMPT_DISMISSED_KEY_PREFIX = 'oran:chat-location-dismissed:';
const MAX_CHAT_RAIL_SESSIONS = 10;
const CHAT_REMOVAL_UNDO_WINDOW_MS = 5000;

/**
 * Maximum number of messages to persist in sessionStorage per chat session.
 * Prevents unbounded storage growth from very long conversations. Server-side
 * quota limits already cap throughput, but this adds a client-side safety net.
 */
const MAX_STORED_MESSAGES = 200;

function getSessionContextStorageKey(sessionId: string): string {
  return `${SESSION_CONTEXT_KEY_PREFIX}${sessionId}`;
}

function getChatTranscriptStorageKey(sessionId: string): string {
  return `${CHAT_TRANSCRIPT_KEY_PREFIX}${sessionId}`;
}

function getChatDraftStorageKey(sessionId: string): string {
  return `${CHAT_DRAFT_KEY_PREFIX}${sessionId}`;
}

function getLocationPromptDismissedStorageKey(sessionId: string): string {
  return `${LOCATION_PROMPT_DISMISSED_KEY_PREFIX}${sessionId}`;
}

function readStoredLocationPromptDismissed(sessionId: string): boolean {
  return typeof window !== 'undefined'
    && sessionStorage.getItem(getLocationPromptDismissedStorageKey(sessionId)) === 'true';
}

function writeStoredLocationPromptDismissed(sessionId: string, dismissed: boolean): void {
  if (typeof window === 'undefined') return;
  const key = getLocationPromptDismissedStorageKey(sessionId);
  if (dismissed) {
    sessionStorage.setItem(key, 'true');
  } else {
    sessionStorage.removeItem(key);
  }
}

function omitQueryTextFromStoredHref(href: string): string {
  try {
    const url = new URL(href, 'https://oran.invalid');
    url.searchParams.delete('q');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

interface StoredMessage {
  role: Message['role'];
  content: string;
  timestamp: string;
  resultSummary?: string;
  services?: ServiceCard[];
  isCrisis?: boolean;
  discoveryContext?: DiscoveryLinkState;
  retrievalStatus?: ChatResponse['retrievalStatus'];
  activeContextUsed?: boolean;
  sessionContext?: ChatSessionContext;
  searchInterpretation?: SearchInterpretation;
  clarification?: ChatClarification;
  followUpSuggestions?: string[];
  executionProposal?: ChatExecutionProposal;
}

function toStoredMessage(message: Message): StoredMessage {
  return {
    ...message,
    timestamp: message.timestamp.toISOString(),
  };
}

function fromStoredMessage(message: StoredMessage): Message {
  if (message.role === 'user') {
    return {
      role: 'user',
      content: message.content,
      timestamp: new Date(message.timestamp),
    };
  }

  return {
    role: 'assistant',
    content: message.content,
    timestamp: new Date(message.timestamp),
    resultSummary: message.resultSummary,
    services: message.services,
    isCrisis: message.isCrisis,
    discoveryContext: message.discoveryContext
      ? { ...message.discoveryContext, omitTextFromUrl: true }
      : undefined,
    retrievalStatus: message.retrievalStatus,
    activeContextUsed: message.activeContextUsed,
    sessionContext: message.sessionContext,
    searchInterpretation: message.searchInterpretation,
    clarification: message.clarification,
    followUpSuggestions: message.followUpSuggestions,
    executionProposal: message.executionProposal
      ? {
          ...message.executionProposal,
          serviceHref: omitQueryTextFromStoredHref(message.executionProposal.serviceHref),
        }
      : undefined,
  };
}

function readStoredMessages(sessionId: string): Message[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = sessionStorage.getItem(getChatTranscriptStorageKey(sessionId));
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as StoredMessage[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(fromStoredMessage);
  } catch {
    return [];
  }
}

function writeStoredMessages(sessionId: string, messages: Message[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  const key = getChatTranscriptStorageKey(sessionId);
  if (messages.length === 0) {
    sessionStorage.removeItem(key);
    return;
  }

  const trimmed = messages.length > MAX_STORED_MESSAGES
    ? messages.slice(-MAX_STORED_MESSAGES)
    : messages;
  sessionStorage.setItem(key, JSON.stringify(trimmed.map(toStoredMessage)));
}

function readStoredDraft(sessionId: string): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return sessionStorage.getItem(getChatDraftStorageKey(sessionId)) ?? '';
}

function writeStoredDraft(sessionId: string, draft: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const key = getChatDraftStorageKey(sessionId);
  if (!draft.trim()) {
    sessionStorage.removeItem(key);
    return;
  }

  sessionStorage.setItem(key, draft);
}

function normalizeSessionContext(sessionContext: ChatSessionContext | undefined): ChatSessionContext | undefined {
  if (!sessionContext) {
    return undefined;
  }

  const hasExplicitDeliveryPreference = Object.prototype.hasOwnProperty.call(
    sessionContext,
    'preferredDeliveryModes',
  );

  const normalized: ChatSessionContext = {
    ...sessionContext,
    activeRetrievalText: sessionContext.activeRetrievalText?.trim() || undefined,
    activeCity: sessionContext.activeCity?.trim() || undefined,
    activeLocation: sessionContext.activeLocation
      ? {
          city: sessionContext.activeLocation.city?.trim() || undefined,
          postalCode: sessionContext.activeLocation.postalCode,
          stateProvince: sessionContext.activeLocation.stateProvince?.trim() || undefined,
        }
      : undefined,
    activeGeo: sessionContext.activeGeo
      ? {
          ...sessionContext.activeGeo,
          radiusMiles: clampDiscoveryRadiusMiles(sessionContext.activeGeo.radiusMiles ?? DEFAULT_DISCOVERY_RADIUS_MILES),
        }
      : undefined,
    taxonomyTermIds: sessionContext.taxonomyTermIds?.filter(Boolean),
    attributeFilters: sessionContext.attributeFilters,
    profileShapingEnabled: sessionContext.profileShapingEnabled,
    ...(hasExplicitDeliveryPreference
      ? { preferredDeliveryModes: sessionContext.preferredDeliveryModes?.filter(Boolean) ?? [] }
      : {}),
  };

  const hasMeaningfulContext = Boolean(
    normalized.activeNeedId
    || normalized.activeRetrievalText
    || normalized.activeCity
    || normalized.activeLocation
    || normalized.activeGeo
    || normalized.urgency
    || normalized.urgencyWindow
    || normalized.audience
    || normalized.accessMode
    || hasExplicitDeliveryPreference
    || normalized.preferredDeliveryModes?.length
    || (normalized.trustFilter && normalized.trustFilter !== 'all')
    || normalized.taxonomyTermIds?.length
    || Object.keys(normalized.attributeFilters ?? {}).length > 0,
  );

  if (!hasMeaningfulContext && normalized.profileShapingEnabled) {
    return undefined;
  }

  return normalized;
}

function buildDeliveryPreferenceContext(
  current: ChatSessionContext | undefined,
  attributeFilters: SearchFilters['attributeFilters'] | undefined,
): Pick<ChatSessionContext, 'preferredDeliveryModes'> | Record<string, never> {
  if (attributeFilters?.delivery) {
    return { preferredDeliveryModes: attributeFilters.delivery };
  }
  if (current && Object.prototype.hasOwnProperty.call(current, 'preferredDeliveryModes')) {
    return { preferredDeliveryModes: current.preferredDeliveryModes ?? [] };
  }
  return {};
}

function readStoredSessionContext(sessionId: string): ChatSessionContext | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const raw = sessionStorage.getItem(getSessionContextStorageKey(sessionId));
  if (!raw) {
    return undefined;
  }

  try {
    return normalizeSessionContext(JSON.parse(raw) as ChatSessionContext);
  } catch {
    return undefined;
  }
}

function writeStoredSessionContext(sessionId: string, sessionContext: ChatSessionContext | undefined): void {
  if (typeof window === 'undefined') {
    return;
  }

  const key = getSessionContextStorageKey(sessionId);
  const normalized = normalizeSessionContext(sessionContext);
  if (!normalized) {
    sessionStorage.removeItem(key);
    return;
  }

  sessionStorage.setItem(key, JSON.stringify(normalized));
}

function buildSeededSessionContext(options: {
  initialNeedId?: DiscoveryNeedId | null;
  initialTrustFilter?: DiscoveryConfidenceFilter;
  initialAttributeFilters?: SearchFilters['attributeFilters'];
  ignoreProfileShaping: boolean;
}): ChatSessionContext | undefined {
  return normalizeSessionContext({
    activeNeedId: options.initialNeedId ?? undefined,
    ...(options.initialAttributeFilters?.delivery
      ? { preferredDeliveryModes: options.initialAttributeFilters.delivery }
      : {}),
    trustFilter: options.initialTrustFilter,
    attributeFilters: options.initialAttributeFilters,
    profileShapingEnabled: !options.ignoreProfileShaping,
  });
}

function buildHandoffDiscoveryContext(
  sessionContext: ChatSessionContext | undefined,
  fallbackText: string,
): DiscoveryLinkState {
  return {
    text: fallbackText,
    needId: sessionContext?.activeNeedId,
    confidenceFilter: sessionContext?.trustFilter,
    taxonomyTermIds: sessionContext?.taxonomyTermIds,
    attributeFilters: sessionContext?.attributeFilters,
  };
}

// ============================================================
// QUOTA COOLDOWN DISPLAY
// ============================================================

/**
 * Live countdown that ticks every second until `resetAt`.
 * Displayed in place of the send button when quota is exhausted.
 */
function QuotaCooldown({ resetAt, onExpired }: { resetAt: Date; onExpired: () => void }) {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    function tick() {
      const ms = resetAt.getTime() - Date.now();
      if (ms <= 0) {
        setDisplay('00:00:00');
        onExpired();
        return;
      }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setDisplay(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      );
    }
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [resetAt, onExpired]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Time until chat quota resets"
      className="mt-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800"
    >
      <Clock className="h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden="true" />
      <span>Daily limit reached — resets in</span>
      <span className="font-mono font-semibold tabular-nums">{display}</span>
    </div>
  );
}

function RetrievalStatusNote({ status }: { status?: ChatResponse['retrievalStatus'] }) {
  if (!status || status === 'results') return null;

  const copy =
    status === 'temporarily_unavailable'
      ? 'Status: Search was temporarily unavailable for this request.'
      : status === 'catalog_empty_for_scope'
        ? 'Status: The current chat scope does not have matching records in the catalog yet.'
        : status === 'out_of_scope'
          ? 'Status: This request was outside the service-finding scope.'
          : 'Status: No close match was found in the current catalog.';

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
      {copy}
    </div>
  );
}

function RetrievalRecoveryActions({ status }: { status?: ChatResponse['retrievalStatus'] }) {
  if (!status || !['no_match', 'catalog_empty_for_scope', 'temporarily_unavailable'].includes(status)) {
    return null;
  }

  return (
    <ResourceSearchRecovery
      reason={status === 'temporarily_unavailable' ? 'temporarily_unavailable' : 'no_match'}
      showOranBrowse={status !== 'temporarily_unavailable'}
    />
  );
}

function SearchInterpretationPanel({
  interpretation,
  canToggleProfile,
  onToggleProfile,
}: {
  interpretation?: SearchInterpretation;
  canToggleProfile: boolean;
  onToggleProfile?: () => void;
}) {
  if (!interpretation) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
      <p className="font-medium text-slate-900">How this was interpreted</p>
      <p className="mt-1">{interpretation.summary}</p>

      {interpretation.usedSessionContext && interpretation.sessionSignals.length > 0 && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-slate-900">
          <p className="font-medium">Current search context</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {interpretation.sessionSignals.map((signal) => (
              <span
                key={signal}
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-800"
              >
                {signal}
              </span>
            ))}
          </div>
        </div>
      )}

      {(interpretation.usedProfileShaping || interpretation.ignoredProfileShaping) && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-slate-900">
          <p className="font-medium">
            {interpretation.ignoredProfileShaping
              ? 'Saved profile shaping is off for this session.'
              : 'Saved profile signals affected the search order.'}
          </p>
          {interpretation.profileSignals.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {interpretation.profileSignals.map((signal) => (
                <span
                  key={signal}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-800"
                >
                  {signal}
                </span>
              ))}
            </div>
          )}
          {canToggleProfile && onToggleProfile && (
            <button
              type="button"
              onClick={onToggleProfile}
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-900 hover:bg-slate-100"
            >
              {interpretation.ignoredProfileShaping ? 'Use saved profile again' : 'Ignore saved profile next time'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const CHAT_HISTORY_INDEX_KEY = 'oran:chat-session-index';

interface ChatSessionSummary {
  sessionId: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
  saved: boolean;
  seeded: boolean;
}

interface ChatSessionSnapshot {
  summary: ChatSessionSummary;
  messages: Message[];
  draft: string;
  sessionContext?: ChatSessionContext;
  guidedIntakeRetry?: GuidedIntakeSubmission;
  guidedIntakeRetryBlockedUntil?: number;
  locationPromptDismissed?: boolean;
}

function deleteStoredChatSession(sessionId: string): ChatSessionSummary[] {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(getChatTranscriptStorageKey(sessionId));
    sessionStorage.removeItem(getChatDraftStorageKey(sessionId));
    sessionStorage.removeItem(getSessionContextStorageKey(sessionId));
    sessionStorage.removeItem(getLocationPromptDismissedStorageKey(sessionId));
    clearGuidedIntakeRetry(sessionId);
  }

  return writeStoredChatSessions(
    readStoredChatSessions().filter((session) => session.sessionId !== sessionId),
  );
}

function truncateCopy(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function readStoredChatSessions(): ChatSessionSummary[] {
  if (typeof window === 'undefined') {
    return [];
  }

  // Transcripts are session-scoped; keep their index in the same storage so
  // sensitive prompt excerpts cannot outlive the transcript as zombie rows.
  localStorage.removeItem(CHAT_HISTORY_INDEX_KEY);
  const raw = sessionStorage.getItem(CHAT_HISTORY_INDEX_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as ChatSessionSummary[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((session) => Boolean(session?.sessionId))
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  } catch {
    return [];
  }
}

function writeStoredChatSessions(sessions: ChatSessionSummary[]): ChatSessionSummary[] {
  const sorted = [...sessions].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );

  if (typeof window !== 'undefined') {
    localStorage.removeItem(CHAT_HISTORY_INDEX_KEY);
    sessionStorage.setItem(CHAT_HISTORY_INDEX_KEY, JSON.stringify(sorted));
  }

  return sorted;
}

function upsertStoredChatSession(summary: ChatSessionSummary): ChatSessionSummary[] {
  const sessions = readStoredChatSessions();
  const next = sessions.filter((session) => session.sessionId !== summary.sessionId);
  next.push(summary);
  return writeStoredChatSessions(next);
}

function readStoredChatSessionSnapshot(sessionId: string): ChatSessionSnapshot | undefined {
  const summary = readStoredChatSessions().find((session) => session.sessionId === sessionId);
  if (!summary) {
    return undefined;
  }

  return {
    summary,
    messages: readStoredMessages(sessionId),
    draft: readStoredDraft(sessionId),
    sessionContext: readStoredSessionContext(sessionId),
    guidedIntakeRetry: readGuidedIntakeRetry(sessionId) ?? undefined,
    guidedIntakeRetryBlockedUntil: readGuidedIntakeRetryBlockedUntil(sessionId) ?? undefined,
    locationPromptDismissed: readStoredLocationPromptDismissed(sessionId),
  };
}

function selectChatSessionForTrim(
  sessions: ChatSessionSummary[],
  preserveSessionId?: string,
): ChatSessionSummary | undefined {
  const oldestFirst = [...sessions].sort(
    (left, right) => new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime(),
  );
  const nonActive = oldestFirst.filter((session) => session.sessionId !== preserveSessionId);
  const unsavedNonActive = nonActive.filter((session) => !session.saved);
  const unsavedAny = oldestFirst.filter((session) => !session.saved);

  return unsavedNonActive[0] ?? nonActive[0] ?? unsavedAny[0] ?? oldestFirst[0];
}

function trimStoredChatSessionsToLimit(
  sessions: ChatSessionSummary[],
  options?: { preserveSessionId?: string },
): { sessions: ChatSessionSummary[]; removed?: ChatSessionSnapshot } {
  const persisted = writeStoredChatSessions(sessions);
  if (persisted.length <= MAX_CHAT_RAIL_SESSIONS) {
    return { sessions: persisted };
  }

  const sessionToTrim = selectChatSessionForTrim(persisted, options?.preserveSessionId);
  if (!sessionToTrim) {
    return { sessions: persisted.slice(0, MAX_CHAT_RAIL_SESSIONS) };
  }

  const removed = readStoredChatSessionSnapshot(sessionToTrim.sessionId);
  const remaining = deleteStoredChatSession(sessionToTrim.sessionId);

  return {
    sessions: remaining,
    removed,
  };
}

function buildChatSessionSummary(options: {
  sessionId: string;
  messages: Message[];
  draft: string;
  initialPrompt?: string;
  existing?: ChatSessionSummary;
  seeded: boolean;
}): ChatSessionSummary {
  const firstUserMessage = options.messages.find((message): message is UserMessage => message.role === 'user')?.content.trim();
  const lastMessage = options.messages[options.messages.length - 1]?.content.trim();
  const fallbackTitle = options.seeded ? options.initialPrompt?.trim() : undefined;
  const title = truncateCopy(firstUserMessage || fallbackTitle || options.existing?.title || 'New chat', 52);
  const preview = truncateCopy(lastMessage || options.draft.trim() || fallbackTitle || 'Resource search', 88);
  const updatedAt = options.messages.length > 0
    ? options.messages[options.messages.length - 1]?.timestamp.toISOString() ?? new Date().toISOString()
    : options.existing?.updatedAt ?? new Date().toISOString();

  return {
    sessionId: options.sessionId,
    title,
    preview,
    updatedAt,
    messageCount: options.messages.length,
    saved: options.existing?.saved ?? false,
    seeded: options.seeded,
  };
}

function ChatRailSection({
  title,
  emptyCopy,
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
}: {
  title: string;
  emptyCopy: string;
  sessions: ChatSessionSummary[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}) {
  return (
    <div>
      <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{title}</p>
      <div className="mt-2 space-y-1.5">
        {sessions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-sm text-slate-500">{emptyCopy}</p>
        ) : sessions.map((session) => {
          const isActive = session.sessionId === activeSessionId;
          return (
            <div
              key={session.sessionId}
              className={`flex items-start gap-2 rounded-2xl border px-3 py-3 transition ${isActive ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'}`}
            >
              <button
                type="button"
                onClick={() => onSelect(session.sessionId)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-sm font-medium">{session.title}</span>
                  <div className="flex items-center gap-2">
                    {session.saved ? (
                      <BookmarkCheck className={`mt-0.5 h-4 w-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} aria-hidden="true" />
                    ) : (
                      <span className={`text-[10px] ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>
                        {session.messageCount > 0 ? `${session.messageCount} msgs` : 'Draft'}
                      </span>
                    )}
                  </div>
                </div>
                <p className={`mt-1 line-clamp-2 text-xs ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>{session.preview}</p>
              </button>
              <button
                type="button"
                onClick={() => onDelete(session.sessionId)}
                className={`rounded-full p-1 ${isActive ? 'text-slate-300 hover:bg-white/10 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
                aria-label={`Delete ${session.title}`}
                title="Delete chat"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChatHistoryNote() {
  return (
    <div className="border-t border-slate-200 px-4 py-3 text-xs leading-5 text-slate-500">
      Chats stay on this device and the rail keeps the newest 10. Save chat keeps a conversation in higher priority, Delete removes it locally, and saved resources remain the durable thing to come back to.
    </div>
  );
}

// ============================================================
// CHAT WINDOW
// ============================================================

interface ChatWindowProps {
  sessionId: string;
  onSessionChange?: (sessionId: string) => void;
  userId?: string;
  initialPrompt?: string;
  initialGuidedIntake?: GuidedIntakeSubmission;
  autoSubmitInitialGuidedIntake?: boolean;
  initialNeedId?: DiscoveryNeedId | null;
  initialTrustFilter?: DiscoveryConfidenceFilter;
  initialSortBy?: DiscoverySortOption;
  initialPage?: number;
  initialAttributeFilters?: SearchFilters['attributeFilters'];
}

export function ChatWindow({
  sessionId,
  onSessionChange,
  userId,
  initialPrompt,
  initialGuidedIntake,
  autoSubmitInitialGuidedIntake = false,
  initialNeedId,
  initialTrustFilter,
  initialSortBy,
  initialPage,
  initialAttributeFilters,
}: ChatWindowProps) {
  const { planEnabled, reminderEnabled } = useSeekerFeatureFlags();
  const initialHasSeededContext = Boolean(initialPrompt?.trim())
    || Boolean(initialTrustFilter && initialTrustFilter !== 'all')
    || Object.keys(initialAttributeFilters ?? {}).length > 0;
  const [messages, setMessages] = useState<Message[]>(() => readStoredMessages(sessionId));
  const [input, setInput] = useState(() => readStoredDraft(sessionId) || initialPrompt?.trim() || '');
  const [isLoading, setIsLoading] = useState(false);
  const [restoredSessionId, setRestoredSessionId] = useState<string | null>(null);
  const [guidedIntakeRetryAvailable, setGuidedIntakeRetryAvailable] = useState(false);
  const [guidedIntakeRetryRequiresQuotaCheck, setGuidedIntakeRetryRequiresQuotaCheck] = useState(
    () => Boolean(readGuidedIntakeRetry(sessionId)),
  );
  const [guidedIntakeRetryBlockedUntil, setGuidedIntakeRetryBlockedUntil] = useState<number | null>(
    () => readGuidedIntakeRetryBlockedUntil(sessionId),
  );
  const [postRequestFocusTarget, setPostRequestFocusTarget] = useState<'composer' | 'retry' | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState(MAX_CHAT_QUOTA);
  // The calling identity's actual ceiling (10 anonymous / 20 authenticated),
  // learned from the quota endpoint; MAX_CHAT_QUOTA is only the pre-fetch
  // default so the bar never renders as already-depleted on first paint.
  const [quotaLimit, setQuotaLimit] = useState(MAX_CHAT_QUOTA);
  const [quotaResetAt, setQuotaResetAt] = useState<Date | null>(() => {
    // Restore persisted reset timestamp from a previous session so the
    // countdown is immediately visible after a page reload.
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(QUOTA_RESET_KEY);
    if (!stored) return null;
    const d = new Date(stored);
    return d > new Date() ? d : null;
  });
  const [hasCrisis, setHasCrisis] = useState(() => readStoredMessages(sessionId).some((message) => message.role === 'assistant' && message.isCrisis));
  const [showVerifyTip, setShowVerifyTip] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [serverSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());
  const [ignoreProfileShaping, setIgnoreProfileShaping] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>(() => readStoredChatSessions());
  const [pendingRemovedChat, setPendingRemovedChat] = useState<ChatSessionSnapshot | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_DISCOVERY_RADIUS_MILES);
  const [isLocating, setIsLocating] = useState(false);
  const [, setMessageScrollEnabled] = useState(false);
  const [showMessageTopFade, setShowMessageTopFade] = useState(false);
  const [showMessageBottomFade, setShowMessageBottomFade] = useState(false);
  const [locationPromptDismissed, setLocationPromptDismissed] = useState(
    () => readStoredLocationPromptDismissed(sessionId),
  );
  const { success, error: toastError, info } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestResultMessageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const messageLogRef = useRef<HTMLDivElement>(null);
  const quotaStateVersionRef = useRef(0);
  const locationRequestVersionRef = useRef(0);
  const pendingRemovalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingGuidedIntakeRef = useRef<GuidedIntakeSubmission | undefined>(
    initialGuidedIntake ?? readGuidedIntakeRetry(sessionId) ?? undefined,
  );
  const guidedIntakeInFlightRef = useRef<GuidedIntakeSubmission | undefined>(undefined);
  const autoSubmittedGuidedSessionRef = useRef<string | null>(null);
  const guidedIntakeRetryBlockedUntilRef = useRef(guidedIntakeRetryBlockedUntil);
  const retryRequiresQuotaCheckAtMountRef = useRef(guidedIntakeRetryRequiresQuotaCheck);

  // Filters: trust tier + canonical attribute filters
  const [trustFilter, setTrustFilter] = useState<TrustFilter>(initialTrustFilter ?? 'all');
  const [seededAttributeFilters, setSeededAttributeFilters] = useState<SearchFilters['attributeFilters']>(
    initialAttributeFilters,
  );
  const [showSeededContext, setShowSeededContext] = useState(initialHasSeededContext);
  const [sessionContext, setSessionContext] = useState<ChatSessionContext | undefined>(() => buildSeededSessionContext({
    initialNeedId,
    initialTrustFilter,
    initialAttributeFilters,
    ignoreProfileShaping: false,
  }));
  const sessionContextRef = useRef(sessionContext);
  const locationPromptDismissedRef = useRef(locationPromptDismissed);

  useEffect(() => () => {
    locationRequestVersionRef.current += 1;
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const updateGuidedIntakeRetryBlock = useCallback((blockedUntil: number | null) => {
    guidedIntakeRetryBlockedUntilRef.current = blockedUntil;
    setGuidedIntakeRetryBlockedUntil(blockedUntil);
    if (blockedUntil) {
      writeGuidedIntakeRetryBlockedUntil(sessionId, blockedUntil);
    } else {
      clearGuidedIntakeRetryBlockedUntil(sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!guidedIntakeRetryBlockedUntil) return;
    const remainingMs = guidedIntakeRetryBlockedUntil - Date.now();
    const timer = window.setTimeout(() => {
      updateGuidedIntakeRetryBlock(null);
      if (pendingGuidedIntakeRef.current) {
        setGuidedIntakeRetryAvailable(true);
      }
    }, Math.max(0, remainingMs));
    return () => window.clearTimeout(timer);
  }, [guidedIntakeRetryBlockedUntil, updateGuidedIntakeRetryBlock]);

  const dismissPendingRemovedChat = useCallback(() => {
    if (pendingRemovalTimerRef.current) {
      clearTimeout(pendingRemovalTimerRef.current);
      pendingRemovalTimerRef.current = null;
    }
    setPendingRemovedChat(null);
  }, []);

  const queuePendingRemovedChat = useCallback((snapshot?: ChatSessionSnapshot) => {
    if (!snapshot) {
      return;
    }

    if (pendingRemovalTimerRef.current) {
      clearTimeout(pendingRemovalTimerRef.current);
    }

    setPendingRemovedChat(snapshot);
    pendingRemovalTimerRef.current = setTimeout(() => {
      pendingRemovalTimerRef.current = null;
      setPendingRemovedChat(null);
    }, CHAT_REMOVAL_UNDO_WINDOW_MS);
  }, []);

  const commitChatSessions = useCallback((nextSessions: ChatSessionSummary[], preserveSessionId?: string) => {
    const result = trimStoredChatSessionsToLimit(nextSessions, { preserveSessionId: preserveSessionId ?? sessionId });
    setChatSessions(result.sessions);
    if (result.removed) {
      queuePendingRemovedChat(result.removed);
    }
  }, [queuePendingRemovedChat, sessionId]);

  useEffect(() => {
    return () => {
      if (pendingRemovalTimerRef.current) {
        clearTimeout(pendingRemovalTimerRef.current);
      }
    };
  }, []);

  const updateMessageScrollState = useCallback(() => {
    const node = messageLogRef.current;
    if (!node) {
      setMessageScrollEnabled(false);
      setShowMessageTopFade(false);
      setShowMessageBottomFade(false);
      return;
    }

    const contentOverflowing = node.scrollHeight > node.clientHeight + 8;
    const shouldScroll = messages.length > 2 || isLoading || contentOverflowing;
    setMessageScrollEnabled(shouldScroll);

    if (!shouldScroll) {
      setShowMessageTopFade(false);
      setShowMessageBottomFade(false);
      return;
    }

    setShowMessageTopFade(node.scrollTop > 8);
    setShowMessageBottomFade(node.scrollTop + node.clientHeight < node.scrollHeight - 8);
  }, [isLoading, messages.length]);

  useEffect(() => {
    updateMessageScrollState();
  }, [messages, isLoading, updateMessageScrollState]);

  useEffect(() => {
    const node = messageLogRef.current;
    if (!node) {
      return;
    }

    const handleScroll = () => updateMessageScrollState();
    node.addEventListener('scroll', handleScroll);
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateMessageScrollState())
      : null;
    resizeObserver?.observe(node);

    return () => {
      node.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
    };
  }, [updateMessageScrollState]);

  const applyQuotaState = useCallback((remaining: number, resetAt?: string | null, version?: number) => {
    if (version !== undefined && version !== quotaStateVersionRef.current) {
      return;
    }

    setQuotaRemaining(remaining);

    if (!resetAt) {
      setQuotaResetAt(null);
      localStorage.removeItem(QUOTA_RESET_KEY);
      return;
    }

    const nextResetAt = new Date(resetAt);
    if (nextResetAt > new Date()) {
      setQuotaResetAt(nextResetAt);
      localStorage.setItem(QUOTA_RESET_KEY, nextResetAt.toISOString());
      return;
    }

    setQuotaResetAt(null);
    localStorage.removeItem(QUOTA_RESET_KEY);
  }, []);

  useEffect(() => {
    // The empty state contains the welcome and guided intake. Scrolling its
    // end marker into view on mount skips that content (and can move the whole
    // page on mobile). Reset an existing message log as well, so clearing a
    // conversation cannot leave the fresh intake stranded below the fold.
    if (messages.length === 0) {
      if (messageLogRef.current) {
        messageLogRef.current.scrollTop = 0;
      }
      return;
    }

    const latestMessage = messages[messages.length - 1];
    if (
      latestMessage?.role === 'assistant'
      && (latestMessage.services?.length ?? 0) > 0
      && latestResultMessageRef.current
    ) {
      latestResultMessageRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isLoading || !postRequestFocusTarget) {
      return;
    }

    const target = postRequestFocusTarget === 'retry'
      ? retryButtonRef.current
      : inputRef.current;
    if (!target) {
      return;
    }

    target.focus({ preventScroll: true });
    setPostRequestFocusTarget(null);
  }, [guidedIntakeRetryAvailable, isLoading, postRequestFocusTarget]);

  useEffect(() => {
    writeStoredMessages(sessionId, messages);
    setHasCrisis(messages.some((message) => message.role === 'assistant' && message.isCrisis));
  }, [messages, sessionId]);

  useEffect(() => {
    writeStoredDraft(sessionId, input);
  }, [input, sessionId]);

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    setSavedIds(new Set(readStoredSavedServiceIds()));
  }, []);

  useEffect(() => {
    locationRequestVersionRef.current += 1;
    guidedIntakeInFlightRef.current = undefined;
    setIsLocating(false);
    const storedSessions = readStoredChatSessions();
    const existingSession = storedSessions.find((session) => session.sessionId === sessionId);
    const storedMessages = readStoredMessages(sessionId);
    const storedDraft = readStoredDraft(sessionId);
    const storedContext = readStoredSessionContext(sessionId);
    const storedGuidedIntakeRetry = readGuidedIntakeRetry(sessionId);
    const storedGuidedIntakeRetryBlockedUntil = storedGuidedIntakeRetry
      ? readGuidedIntakeRetryBlockedUntil(sessionId)
      : null;
    if (!storedGuidedIntakeRetry) {
      clearGuidedIntakeRetryBlockedUntil(sessionId);
    }
    const seeded = existingSession?.seeded ?? initialHasSeededContext;
    const seededContext = seeded
      ? buildSeededSessionContext({
          initialNeedId,
          initialTrustFilter,
          initialAttributeFilters,
          ignoreProfileShaping: false,
        })
      : undefined;

    if (!existingSession) {
      commitChatSessions(upsertStoredChatSession(buildChatSessionSummary({
        sessionId,
        messages: storedMessages,
        draft: storedDraft,
        initialPrompt,
        seeded,
      })), sessionId);
    } else {
      commitChatSessions(storedSessions, sessionId);
    }

    const pendingGuidedIntake = storedGuidedIntakeRetry
      ?? (storedMessages.length === 0 ? initialGuidedIntake : undefined);
    const nextInput = storedDraft
      || pendingGuidedIntake?.prompt
      || (storedMessages.length === 0 && seeded ? initialPrompt?.trim() || '' : '');

    setMessages(storedMessages);
    setInput(nextInput);
    pendingGuidedIntakeRef.current = pendingGuidedIntake?.prompt === nextInput.trim()
      ? pendingGuidedIntake
      : undefined;
    const isRetryRestoredFromBeforeMount = Boolean(storedGuidedIntakeRetry)
      && retryRequiresQuotaCheckAtMountRef.current;
    setGuidedIntakeRetryAvailable(isRetryRestoredFromBeforeMount);
    setGuidedIntakeRetryRequiresQuotaCheck(isRetryRestoredFromBeforeMount);
    guidedIntakeRetryBlockedUntilRef.current = storedGuidedIntakeRetryBlockedUntil;
    setGuidedIntakeRetryBlockedUntil(storedGuidedIntakeRetryBlockedUntil);
    if (pendingGuidedIntakeRef.current && !storedGuidedIntakeRetry) {
      writeGuidedIntakeRetry(sessionId, pendingGuidedIntakeRef.current);
    }
    if (storedGuidedIntakeRetry && !pendingGuidedIntakeRef.current) {
      clearGuidedIntakeRetry(sessionId);
    }
    setShowSeededContext(storedMessages.length === 0 && seeded);
    setHasCrisis(storedMessages.some((message) => message.role === 'assistant' && message.isCrisis));
    setShowVerifyTip(false);

    const nextContext = normalizeSessionContext(storedContext ?? seededContext);
    sessionContextRef.current = nextContext;
    setSessionContext(nextContext);
    const storedLocationPromptDismissed = readStoredLocationPromptDismissed(sessionId);
    locationPromptDismissedRef.current = storedLocationPromptDismissed;
    setLocationPromptDismissed(storedLocationPromptDismissed);
    setTrustFilter((nextContext?.trustFilter ?? initialTrustFilter ?? 'all') as TrustFilter);
    setSeededAttributeFilters(nextContext?.attributeFilters ?? (seeded ? initialAttributeFilters : undefined));
    setIgnoreProfileShaping(nextContext?.profileShapingEnabled === false);
    setRadiusMiles(clampDiscoveryRadiusMiles(nextContext?.activeGeo?.radiusMiles ?? DEFAULT_DISCOVERY_RADIUS_MILES));
    setRestoredSessionId(sessionId);
  }, [
    commitChatSessions,
    initialHasSeededContext,
    initialAttributeFilters,
    initialGuidedIntake,
    initialNeedId,
    initialPrompt,
    initialTrustFilter,
    sessionId,
  ]);

  useEffect(() => {
    setSessionContext((current) => {
      const next = normalizeSessionContext({
        ...(current ?? {}),
        trustFilter,
        attributeFilters: seededAttributeFilters,
        ...buildDeliveryPreferenceContext(current, seededAttributeFilters),
        profileShapingEnabled: !ignoreProfileShaping,
      });
      sessionContextRef.current = next;
      return next;
    });
  }, [ignoreProfileShaping, seededAttributeFilters, trustFilter]);

  useEffect(() => {
    writeStoredSessionContext(sessionId, sessionContext);
  }, [sessionContext, sessionId]);

  useEffect(() => {
    const existing = readStoredChatSessions().find((session) => session.sessionId === sessionId);
    const summary = buildChatSessionSummary({
      sessionId,
      messages,
      draft: input,
      initialPrompt,
      existing,
      seeded: existing?.seeded ?? showSeededContext,
    });
    commitChatSessions(upsertStoredChatSession(summary), sessionId);
  }, [commitChatSessions, initialPrompt, input, messages, sessionId, showSeededContext]);

  useLayoutEffect(() => {
    autoResize(inputRef.current);
  }, [input]);

  // Fetch the server-authoritative quota state on mount.
  // This ensures the countdown and remaining count are accurate even after
  // a page reload or cross-device navigation.
  useEffect(() => {
    const quotaVersion = quotaStateVersionRef.current;
    const releaseRestoredRetry = (remaining: number | null) => {
      if (!retryRequiresQuotaCheckAtMountRef.current) return;
      const blockedUntil = guidedIntakeRetryBlockedUntilRef.current;
      const retryStillBlocked = Boolean(blockedUntil && blockedUntil > Date.now());
      if (blockedUntil && !retryStillBlocked) {
        updateGuidedIntakeRetryBlock(null);
      }
      setGuidedIntakeRetryRequiresQuotaCheck(false);
      if (
        (remaining === null || remaining > 0)
        && pendingGuidedIntakeRef.current
        && !retryStillBlocked
      ) {
        setGuidedIntakeRetryAvailable(true);
      }
    };

    fetch('/api/chat/quota', { method: 'GET', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { remaining: number; limit?: number; resetAt: string | null } | null) => {
        if (!data) {
          releaseRestoredRetry(null);
          return;
        }
        if (typeof data.limit === 'number' && data.limit > 0) setQuotaLimit(data.limit);
        applyQuotaState(data.remaining, data.resetAt, quotaVersion);
        releaseRestoredRetry(data.remaining);
      })
      .catch(() => {
        // The POST remains authoritative. Do not strand a session-only retry
        // just because the read-only quota probe was unavailable.
        releaseRestoredRetry(null);
      });

  }, [applyQuotaState, updateGuidedIntakeRetryBlock]);

  const toggleSave = useCallback((serviceId: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      const isSyncedSurface = serverSyncEnabled && Boolean(userId);
      const wasSaved = next.has(serviceId);
      const toggleCopy = getSavedTogglePresentation(wasSaved, isSyncedSurface);
      if (wasSaved) {
        next.delete(serviceId);
        if (isSyncedSurface) {
          void removeServerSaved(serviceId);
        }
      } else {
        next.add(serviceId);
        if (isSyncedSurface) {
          void addServerSaved(serviceId);
        }
      }
      success(toggleCopy.toastMessage);
      writeStoredSavedServiceIds(next);
      return next;
    });
  }, [serverSyncEnabled, success, userId]);

  const activeNeedId = sessionContext?.activeNeedId;
  const activeGeo = sessionContext?.activeGeo;
  const activeTextLocationLabel = sessionContext?.activeLocation
    ? sessionContext.activeLocation.postalCode
      ?? [sessionContext.activeLocation.city, sessionContext.activeLocation.stateProvince].filter(Boolean).join(', ')
    : sessionContext?.activeCity;
  const pendingLocationScope = guidedIntakeInFlightRef.current ?? pendingGuidedIntakeRef.current;
  const hasExplicitLocationContext = Boolean(
    sessionContext?.activeLocation
    || sessionContext?.activeCity
    || pendingLocationScope?.location,
  );
  const hasNonSelfAudience = Boolean(
    (sessionContext?.audience ?? pendingLocationScope?.audience)
    && (sessionContext?.audience ?? pendingLocationScope?.audience) !== 'self',
  );
  const shouldOfferAutomaticLocation = !activeGeo
    && !hasExplicitLocationContext
    && !hasNonSelfAudience
    && !isLoading
    && !locationPromptDismissed;
  const currentChatSummary = useMemo(
    () => chatSessions.find((session) => session.sessionId === sessionId),
    [chatSessions, sessionId],
  );
  const savedChatSessions = useMemo(
    () => chatSessions.filter((session) => session.saved),
    [chatSessions],
  );
  const recentChatSessions = useMemo(
    () => chatSessions.filter((session) => !session.saved),
    [chatSessions],
  );
  const hasMeaningfulMobileHistory = useMemo(
    () => chatSessions.some((session) => (
      session.sessionId !== sessionId
      || session.saved
      || session.messageCount > 0
    )),
    [chatSessions, sessionId],
  );
  const activeAttributeCount = useMemo(
    () => Object.values(seededAttributeFilters ?? {}).reduce((total, values) => total + values.length, 0),
    [seededAttributeFilters],
  );

  const updateSessionContext = useCallback((updater: (current: ChatSessionContext | undefined) => ChatSessionContext | undefined) => {
    setSessionContext((current) => {
      const next = normalizeSessionContext(updater(current));
      sessionContextRef.current = next;
      return next;
    });
  }, []);

  const handleRadiusChange = useCallback((nextMiles: number) => {
    const clamped = clampDiscoveryRadiusMiles(nextMiles);
    setRadiusMiles(clamped);
    updateSessionContext((current) => current?.activeGeo ? {
      ...(current ?? {}),
      activeGeo: {
        ...current.activeGeo,
        radiusMiles: clamped,
      },
      profileShapingEnabled: !ignoreProfileShaping,
    } : current);
  }, [ignoreProfileShaping, updateSessionContext]);

  const dismissLocationPrompt = useCallback(() => {
    locationRequestVersionRef.current += 1;
    locationPromptDismissedRef.current = true;
    setLocationPromptDismissed(true);
    setIsLocating(false);
    writeStoredLocationPromptDismissed(sessionId, true);
  }, [sessionId]);

  const clearLocation = useCallback(() => {
    dismissLocationPrompt();
    updateSessionContext((current) => ({
      ...(current ?? {}),
      activeCity: undefined,
      activeLocation: undefined,
      activeGeo: undefined,
      profileShapingEnabled: !ignoreProfileShaping,
    }));
  }, [dismissLocationPrompt, ignoreProfileShaping, updateSessionContext]);

  const requestDeviceLocation = useCallback((explicit = false) => {
    if (isLocating) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      toastError('Device location is not available in this browser.');
      return;
    }

    const currentContext = sessionContextRef.current;
    const pendingScope = guidedIntakeInFlightRef.current ?? pendingGuidedIntakeRef.current;
    if (
      (currentContext?.audience && currentContext.audience !== 'self')
      || (pendingScope?.audience && pendingScope.audience !== 'self')
    ) {
      toastError('Device location is available only when searching for yourself.');
      return;
    }

    const requestVersion = ++locationRequestVersionRef.current;
    setIsLocating(true);
    info('Requesting approximate device location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (requestVersion !== locationRequestVersionRef.current) return;
        const latestContext = sessionContextRef.current;
        const latestPendingScope = guidedIntakeInFlightRef.current ?? pendingGuidedIntakeRef.current;
        const locationBecameIneligible = Boolean(
          (latestContext?.audience && latestContext.audience !== 'self')
          || (latestPendingScope?.audience && latestPendingScope.audience !== 'self')
          || latestPendingScope?.location
          || (!explicit && (latestContext?.activeLocation || latestContext?.activeCity))
          || (!explicit && locationPromptDismissedRef.current),
        );
        if (locationBecameIneligible) {
          setIsLocating(false);
          return;
        }
        const lat = Math.round(pos.coords.latitude * 100) / 100;
        const lng = Math.round(pos.coords.longitude * 100) / 100;
        updateSessionContext((current) => ({
          ...(current ?? {}),
          activeCity: undefined,
          activeLocation: undefined,
          activeGeo: {
            lat,
            lng,
            radiusMiles,
          },
          profileShapingEnabled: !ignoreProfileShaping,
        }));
        if (explicit) {
          locationPromptDismissedRef.current = false;
          setLocationPromptDismissed(false);
          writeStoredLocationPromptDismissed(sessionId, false);
        }
        setShowSeededContext(false);
        setIsLocating(false);
        success('Using your approximate location for nearby chat results.');
      },
      (error) => {
        if (requestVersion !== locationRequestVersionRef.current) return;
        dismissLocationPrompt();
        toastError(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied.'
            : error.code === error.TIMEOUT
              ? 'Location request timed out.'
              : 'Location unavailable.',
        );
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 60_000,
      },
    );
  }, [dismissLocationPrompt, ignoreProfileShaping, info, isLocating, radiusMiles, sessionId, success, toastError, updateSessionContext]);

  useEffect(() => {
    if (!shouldOfferAutomaticLocation || typeof navigator === 'undefined' || !('permissions' in navigator)) {
      return;
    }

    let cancelled = false;
    const permissions = navigator.permissions as Permissions;
    void permissions.query({ name: 'geolocation' as PermissionName }).then((result) => {
      if (!cancelled && result.state === 'granted') {
        requestDeviceLocation(false);
      }
    }).catch(() => {
      // Non-fatal: some browsers do not expose the permissions query consistently.
    });
    return () => {
      cancelled = true;
    };
  }, [requestDeviceLocation, shouldOfferAutomaticLocation]);

  const deleteChatSession = useCallback((nextSessionId: string) => {
    const remainingSessions = deleteStoredChatSession(nextSessionId);
    setChatSessions(remainingSessions);
    if (pendingRemovedChat?.summary.sessionId === nextSessionId) {
      dismissPendingRemovedChat();
    }

    if (nextSessionId !== sessionId) {
      return;
    }

    const nextActiveSession = remainingSessions[0]?.sessionId ?? crypto.randomUUID();

    if (remainingSessions.length === 0) {
      commitChatSessions(upsertStoredChatSession({
        sessionId: nextActiveSession,
        title: 'New chat',
        preview: 'Resource search',
        updatedAt: new Date().toISOString(),
        messageCount: 0,
        saved: false,
        seeded: false,
      }), nextActiveSession);
    }

    if (onSessionChange) {
      onSessionChange(nextActiveSession);
      return;
    }

    sessionStorage.setItem('oran_chat_session_id', nextActiveSession);
    window.location.assign('/chat');
  }, [commitChatSessions, dismissPendingRemovedChat, onSessionChange, pendingRemovedChat, sessionId]);

  const restorePendingRemovedChat = useCallback((options?: { select?: boolean; save?: boolean }) => {
    if (!pendingRemovedChat) {
      return;
    }

    const restoredSummary: ChatSessionSummary = {
      ...pendingRemovedChat.summary,
      saved: options?.save ? true : pendingRemovedChat.summary.saved,
      updatedAt: new Date().toISOString(),
    };

    writeStoredMessages(restoredSummary.sessionId, pendingRemovedChat.messages);
    writeStoredDraft(restoredSummary.sessionId, pendingRemovedChat.draft);
    writeStoredSessionContext(restoredSummary.sessionId, pendingRemovedChat.sessionContext);
    if (pendingRemovedChat.guidedIntakeRetry) {
      writeGuidedIntakeRetry(restoredSummary.sessionId, pendingRemovedChat.guidedIntakeRetry);
      if (pendingRemovedChat.guidedIntakeRetryBlockedUntil) {
        writeGuidedIntakeRetryBlockedUntil(
          restoredSummary.sessionId,
          pendingRemovedChat.guidedIntakeRetryBlockedUntil,
        );
      }
    }
    writeStoredLocationPromptDismissed(
      restoredSummary.sessionId,
      Boolean(pendingRemovedChat.locationPromptDismissed),
    );
    dismissPendingRemovedChat();
    commitChatSessions(upsertStoredChatSession(restoredSummary), restoredSummary.sessionId);

    if (!options?.select) {
      success(options?.save ? 'Chat restored and saved.' : 'Chat restored.');
      return;
    }

    success(options?.save ? 'Chat restored, saved, and reopened.' : 'Chat restored and reopened.');
    if (onSessionChange) {
      onSessionChange(restoredSummary.sessionId);
      return;
    }

    sessionStorage.setItem('oran_chat_session_id', restoredSummary.sessionId);
    window.location.assign('/chat');
  }, [commitChatSessions, dismissPendingRemovedChat, onSessionChange, pendingRemovedChat, success]);

  const _clearSessionContextField = useCallback((field: 'activeNeedId' | 'activeCity' | 'activeLocation' | 'urgency' | 'audience' | 'accessMode' | 'trustFilter' | 'attributeFilters' | 'preferredDeliveryModes') => {
    if (field === 'activeLocation' || field === 'activeCity') {
      dismissLocationPrompt();
    }
    updateSessionContext((current) => {
      const next = { ...(current ?? {}), profileShapingEnabled: !ignoreProfileShaping };

      switch (field) {
        case 'trustFilter':
          setTrustFilter('all');
          next.trustFilter = undefined;
          break;
        case 'attributeFilters':
          setSeededAttributeFilters(undefined);
          next.attributeFilters = undefined;
          break;
        case 'preferredDeliveryModes':
          setSeededAttributeFilters((currentFilters) => {
            if (!currentFilters?.delivery) return currentFilters;
            const { delivery: _delivery, ...rest } = currentFilters;
            return Object.keys(rest).length > 0 ? rest : undefined;
          });
          delete next.preferredDeliveryModes;
          break;
        case 'accessMode': {
          setSeededAttributeFilters((currentFilters) => {
            if (!currentFilters?.delivery) return currentFilters;
            const { delivery: _delivery, ...rest } = currentFilters;
            return Object.keys(rest).length > 0 ? rest : undefined;
          });
          const { delivery: _delivery, ...remainingFilters } = next.attributeFilters ?? {};
          next.attributeFilters = Object.keys(remainingFilters).length > 0
            ? remainingFilters
            : undefined;
          next.accessMode = undefined;
          delete next.preferredDeliveryModes;
          break;
        }
        case 'activeLocation':
          next.activeLocation = undefined;
          next.activeCity = undefined;
          break;
        case 'activeCity':
          next.activeCity = undefined;
          break;
        case 'activeNeedId':
          next.activeNeedId = undefined;
          next.activeRetrievalText = undefined;
          break;
        case 'urgency':
          next.urgency = undefined;
          next.urgencyWindow = undefined;
          break;
        default:
          next[field] = undefined;
      }

      return next;
    });
  }, [dismissLocationPrompt, ignoreProfileShaping, updateSessionContext]);

  const _removeSessionAttributeTag = useCallback((taxonomy: string, tag: string) => {
    setSeededAttributeFilters((current) => {
      if (!current?.[taxonomy]) {
        return current;
      }

      const nextTags = current[taxonomy]?.filter((value) => value !== tag) ?? [];
      const nextFilters = { ...(current ?? {}) };
      if (nextTags.length > 0) {
        nextFilters[taxonomy] = nextTags;
      } else {
        delete nextFilters[taxonomy];
      }
      return Object.keys(nextFilters).length > 0 ? nextFilters : undefined;
    });
    updateSessionContext((current) => {
      const nextAttributeFilters = { ...(current?.attributeFilters ?? {}) };
      const nextTags = nextAttributeFilters[taxonomy]?.filter((value) => value !== tag) ?? [];
      if (nextTags.length > 0) {
        nextAttributeFilters[taxonomy] = nextTags;
      } else {
        delete nextAttributeFilters[taxonomy];
      }

      return {
        ...(current ?? {}),
        attributeFilters: Object.keys(nextAttributeFilters).length > 0 ? nextAttributeFilters : undefined,
        profileShapingEnabled: !ignoreProfileShaping,
      };
    });
  }, [ignoreProfileShaping, updateSessionContext]);

  const latestUserMessage = useMemo(
    () => [...messages].reverse().find((message): message is UserMessage => message.role === 'user')?.content ?? input.trim(),
    [input, messages],
  );
  const latestAssistantResult = useMemo(
    () => [...messages].reverse().find((message): message is AssistantMessage => message.role === 'assistant' && (message.services?.length ?? 0) > 0),
    [messages],
  );
  const latestAssistantServices = useMemo(() => latestAssistantResult?.services ?? [], [latestAssistantResult]);
  const latestAssistantDiscoveryContext = useMemo(
    () => [...messages].reverse().find(
      (message): message is AssistantMessage => message.role === 'assistant' && Boolean(message.discoveryContext),
    )?.discoveryContext,
    [messages],
  );
  const handoffFallbackText = pendingGuidedIntakeRef.current?.prompt === latestUserMessage
    ? pendingGuidedIntakeRef.current.searchText
    : latestUserMessage;

  const handoffDiscoveryContext = useMemo(
    () => {
      const context = latestAssistantDiscoveryContext
        ?? buildHandoffDiscoveryContext(sessionContext, handoffFallbackText);
      return { ...context, omitTextFromUrl: true };
    },
    [handoffFallbackText, latestAssistantDiscoveryContext, sessionContext],
  );

  const _directoryHandoffHref = useMemo(
    () => buildDiscoveryHref('/directory', handoffDiscoveryContext),
    [handoffDiscoveryContext],
  );
  const _mapHandoffHref = useMemo(
    () => buildDiscoveryHref('/map', handoffDiscoveryContext),
    [handoffDiscoveryContext],
  );

  const _startNewSession = useCallback(() => {
    const nextSessionId = crypto.randomUUID();
    commitChatSessions(upsertStoredChatSession({
      sessionId: nextSessionId,
      title: 'New chat',
      preview: 'Resource search',
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      saved: false,
      seeded: false,
    }), nextSessionId);
    if (onSessionChange) {
      onSessionChange(nextSessionId);
      return;
    }
    sessionStorage.setItem('oran_chat_session_id', nextSessionId);
    window.location.assign('/chat');
  }, [commitChatSessions, onSessionChange]);

  const selectSession = useCallback((nextSessionId: string) => {
    if (nextSessionId === sessionId) {
      return;
    }

    if (onSessionChange) {
      onSessionChange(nextSessionId);
      return;
    }

    sessionStorage.setItem('oran_chat_session_id', nextSessionId);
    window.location.assign('/chat');
  }, [onSessionChange, sessionId]);

  const toggleCurrentConversationSaved = useCallback(() => {
    const existing = currentChatSummary ?? buildChatSessionSummary({
      sessionId,
      messages,
      draft: input,
      initialPrompt,
      seeded: showSeededContext,
    });
    const next = {
      ...existing,
      saved: !existing.saved,
      updatedAt: new Date().toISOString(),
    };
    commitChatSessions(upsertStoredChatSession(next), sessionId);
  }, [commitChatSessions, currentChatSummary, initialPrompt, input, messages, sessionId, showSeededContext]);

  const handleCategoryClick = useCallback((needId: DiscoveryNeedId) => {
    updateSessionContext((current) => ({
      ...(current ?? {}),
      activeNeedId: current?.activeNeedId === needId ? undefined : needId,
      activeRetrievalText: undefined,
      profileShapingEnabled: !ignoreProfileShaping,
    }));
    setShowSeededContext(false);
  }, [ignoreProfileShaping, updateSessionContext]);

  const clearCategory = useCallback(() => {
    updateSessionContext((current) => ({
      ...(current ?? {}),
      activeNeedId: undefined,
      activeRetrievalText: undefined,
      profileShapingEnabled: !ignoreProfileShaping,
    }));
  }, [ignoreProfileShaping, updateSessionContext]);

  const toggleAttribute = useCallback((taxonomy: string, tag: string) => {
    setSeededAttributeFilters((current) => {
      const currentTags = current?.[taxonomy] ?? [];
      const nextTags = currentTags.includes(tag)
        ? currentTags.filter((value) => value !== tag)
        : [...currentTags, tag];
      const nextFilters = { ...(current ?? {}) };
      if (nextTags.length > 0) {
        nextFilters[taxonomy] = nextTags;
      } else {
        delete nextFilters[taxonomy];
      }
      return Object.keys(nextFilters).length > 0 ? nextFilters : undefined;
    });

    updateSessionContext((current) => {
      const nextFilters = { ...(current?.attributeFilters ?? {}) };
      const currentTags = nextFilters[taxonomy] ?? [];
      const nextTags = currentTags.includes(tag)
        ? currentTags.filter((value) => value !== tag)
        : [...currentTags, tag];

      if (nextTags.length > 0) {
        nextFilters[taxonomy] = nextTags;
      } else {
        delete nextFilters[taxonomy];
      }

      return {
        ...(current ?? {}),
        attributeFilters: Object.keys(nextFilters).length > 0 ? nextFilters : undefined,
        ...(taxonomy === 'delivery'
          ? { preferredDeliveryModes: nextFilters.delivery ?? [] }
          : buildDeliveryPreferenceContext(current, nextFilters)),
        profileShapingEnabled: !ignoreProfileShaping,
      };
    });
    setShowSeededContext(false);
  }, [ignoreProfileShaping, updateSessionContext]);

  const clearAttributes = useCallback(() => {
    setSeededAttributeFilters(undefined);
    updateSessionContext((current) => {
      const next = {
        ...(current ?? {}),
        attributeFilters: undefined,
        profileShapingEnabled: !ignoreProfileShaping,
      };
      delete next.preferredDeliveryModes;
      return next;
    });
  }, [ignoreProfileShaping, updateSessionContext]);

  const sendMessage = useCallback(async (
    override?: string,
    guidedIntake?: GuidedIntakeSubmission,
  ) => {
    const trimmed = (override ?? input).trim();
    if (!trimmed || isLoading) return;
    const storedPendingGuidedIntake = pendingGuidedIntakeRef.current;
    const pendingGuidedIntake = guidedIntake
      ?? (storedPendingGuidedIntake?.prompt === trimmed
        ? storedPendingGuidedIntake
        : undefined);
    const blockedUntil = guidedIntakeRetryBlockedUntilRef.current;
    const retryIsBlocked = Boolean(
      pendingGuidedIntake
      && (
        guidedIntakeRetryRequiresQuotaCheck
        || (blockedUntil && blockedUntil > Date.now())
        || (guidedIntakeRetryAvailable && quotaRemaining === 0)
      )
    );
    if (retryIsBlocked) return;
    if (blockedUntil) {
      updateGuidedIntakeRetryBlock(null);
    }
    guidedIntakeInFlightRef.current = pendingGuidedIntake;
    if (
      pendingGuidedIntake?.location
      || (pendingGuidedIntake?.audience && pendingGuidedIntake.audience !== 'self')
    ) {
      locationRequestVersionRef.current += 1;
      setIsLocating(false);
    }
    pendingGuidedIntakeRef.current = undefined;
    if (storedPendingGuidedIntake && !pendingGuidedIntake) {
      updateGuidedIntakeRetryBlock(null);
      clearGuidedIntakeRetry(sessionId);
      setGuidedIntakeRetryAvailable(false);
      setGuidedIntakeRetryRequiresQuotaCheck(false);
    }
    if (pendingGuidedIntake) {
      writeGuidedIntakeRetry(sessionId, pendingGuidedIntake);
      setGuidedIntakeRetryAvailable(false);
      setGuidedIntakeRetryRequiresQuotaCheck(false);
    }

    const commandProposal = !pendingGuidedIntake && planEnabled
      ? buildChatExecutionProposal(trimmed, latestAssistantServices)
      : null;
    if (commandProposal && (commandProposal.action !== 'set_reminder' || reminderEnabled)) {
      const serviceHref = buildDiscoveryHref(`/service/${commandProposal.service.serviceId}`, latestAssistantDiscoveryContext ?? {});
      const proposal: ChatExecutionProposal = {
        ...commandProposal,
        serviceHref,
        status: 'pending',
      };

      if (!override) setInput('');
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: trimmed, timestamp: new Date() },
        {
          role: 'assistant',
          content: proposal.summary,
          timestamp: new Date(),
          executionProposal: proposal,
        },
      ]);
      trackInteraction('chat_execution_command_proposed', { action: proposal.action });
      return;
    }

    const frozenDiscoveryContext: DiscoveryLinkState = {
      text: pendingGuidedIntake?.searchText ?? trimmed,
      omitTextFromUrl: true,
      needId: showSeededContext ? initialNeedId : undefined,
      confidenceFilter: trustFilter,
      sortBy: showSeededContext ? initialSortBy : undefined,
      attributeFilters:
        seededAttributeFilters && Object.keys(seededAttributeFilters).length > 0
          ? seededAttributeFilters
          : undefined,
      page: showSeededContext && (initialPage ?? 1) > 1 ? initialPage : undefined,
    };

    trackInteraction('chat_message_sent', { quota_remaining: quotaRemaining });

    if (!override) setInput('');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed, timestamp: new Date() },
    ]);
    setIsLoading(true);

    let shouldOfferGuidedRetryAfterFailure = true;
    let shouldPreserveGuidedIntakeAfterFailure = true;
    let guidedIntakeBlockedUntilAfterFailure: number | null = null;

    try {
      const beginsNonSelfGuidedScope = Boolean(
        pendingGuidedIntake?.audience && pendingGuidedIntake.audience !== 'self',
      );
      const requestBody: Record<string, unknown> = {
        message: trimmed,
        sessionId,
        userId,
        profileMode: ignoreProfileShaping ? 'ignore' : 'use',
        sessionContext: normalizeSessionContext({
          ...(sessionContext ?? {}),
          activeNeedId: beginsNonSelfGuidedScope ? undefined : sessionContext?.activeNeedId,
          activeRetrievalText: beginsNonSelfGuidedScope ? undefined : sessionContext?.activeRetrievalText,
          activeCity: beginsNonSelfGuidedScope ? undefined : sessionContext?.activeCity,
          activeLocation: beginsNonSelfGuidedScope ? undefined : sessionContext?.activeLocation,
          activeGeo: !beginsNonSelfGuidedScope && sessionContext?.activeGeo
            ? {
                ...sessionContext.activeGeo,
                radiusMiles,
              }
            : undefined,
          urgency: beginsNonSelfGuidedScope ? undefined : sessionContext?.urgency,
          urgencyWindow: beginsNonSelfGuidedScope ? undefined : sessionContext?.urgencyWindow,
          accessMode: beginsNonSelfGuidedScope ? undefined : sessionContext?.accessMode,
          taxonomyTermIds: beginsNonSelfGuidedScope ? undefined : sessionContext?.taxonomyTermIds,
          trustFilter,
          attributeFilters: beginsNonSelfGuidedScope ? undefined : seededAttributeFilters,
          ...(beginsNonSelfGuidedScope
            ? { preferredDeliveryModes: undefined }
            : buildDeliveryPreferenceContext(sessionContext, seededAttributeFilters)),
          profileShapingEnabled: !ignoreProfileShaping,
        }),
      };
      if (pendingGuidedIntake) {
        const { prompt: _prompt, ...guidedIntakePayload } = pendingGuidedIntake;
        requestBody.guidedIntake = guidedIntakePayload;
      }
      const filterPayload: Record<string, unknown> = {};
      if (trustFilter !== 'all') filterPayload.trust = trustFilter;
      if (!beginsNonSelfGuidedScope && seededAttributeFilters && Object.keys(seededAttributeFilters).length > 0) {
        filterPayload.attributeFilters = seededAttributeFilters;
      }
      if (Object.keys(filterPayload).length > 0) requestBody.filters = filterPayload;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const retryAfter = response.headers?.get?.('Retry-After');
        shouldOfferGuidedRetryAfterFailure = response.status === 503 && !retryAfter;
        shouldPreserveGuidedIntakeAfterFailure = response.status !== 400 && response.status !== 422;
        if (response.status === 429 || (response.status === 503 && retryAfter)) {
          const retryAfterDeadline = parseRetryAfterDeadline(retryAfter);
          if (retryAfterDeadline > Date.now()) {
            guidedIntakeBlockedUntilAfterFailure = retryAfterDeadline;
          } else if (response.status === 503) {
            shouldOfferGuidedRetryAfterFailure = true;
          }
        }
        let errorMsg = 'Something went wrong. Please try again.';
        try {
          const errBody = await response.json() as {
            error?: string;
            quotaRemaining?: number;
            quotaResetAt?: string | null;
          };
          if (typeof errBody.error === 'string' && errBody.error) errorMsg = errBody.error;
          if (typeof errBody.quotaRemaining === 'number') {
            quotaStateVersionRef.current += 1;
            applyQuotaState(errBody.quotaRemaining, errBody.quotaResetAt);
            if (errBody.quotaRemaining === 0 && errBody.quotaResetAt) {
              const resetDeadline = Date.parse(errBody.quotaResetAt);
              if (Number.isFinite(resetDeadline) && resetDeadline > Date.now()) {
                const quotaResetDeadline = Math.min(
                  resetDeadline,
                  Date.now() + MAX_GUIDED_INTAKE_RETRY_BLOCK_MS,
                );
                guidedIntakeBlockedUntilAfterFailure = Math.max(
                  guidedIntakeBlockedUntilAfterFailure ?? 0,
                  quotaResetDeadline,
                );
              }
            }
          }
        } catch { /* fall through to generic message */ }
        const responseError = new Error(errorMsg);
        responseError.name = 'ChatResponseError';
        throw responseError;
      }

      const data: ChatResponse = await response.json();
      const resultDiscoveryContext: DiscoveryLinkState = {
        ...frozenDiscoveryContext,
        text: data.effectiveSearchText ?? frozenDiscoveryContext.text,
        ...(frozenDiscoveryContext.omitTextFromUrl || data.sessionContext?.activeRetrievalText
          ? { omitTextFromUrl: true }
          : {}),
        needId: data.sessionContext !== undefined
          ? data.sessionContext.activeNeedId
          : data.intent.category === 'general'
            ? frozenDiscoveryContext.needId
            : data.intent.category,
        attributeFilters: data.sessionContext !== undefined
          ? data.sessionContext.attributeFilters
          : frozenDiscoveryContext.attributeFilters,
      };

      if (data.isCrisis) {
        setHasCrisis(true);
        trackInteraction('crisis_banner_shown');
      }

      const nextSessionContext = normalizeSessionContext(data.sessionContext);
      sessionContextRef.current = nextSessionContext;
      setSessionContext(nextSessionContext);
      if (data.sessionContext?.trustFilter) {
        setTrustFilter(data.sessionContext.trustFilter);
      }
      if (!data.isCrisis) {
        setSeededAttributeFilters(data.sessionContext?.attributeFilters);
      }
      if (data.sessionContext?.activeGeo?.radiusMiles) {
        setRadiusMiles(clampDiscoveryRadiusMiles(data.sessionContext.activeGeo.radiusMiles));
      }
      if (typeof data.sessionContext?.profileShapingEnabled === 'boolean') {
        setIgnoreProfileShaping(!data.sessionContext.profileShapingEnabled);
      }
      if (pendingGuidedIntake && data.retrievalStatus === 'temporarily_unavailable') {
        updateGuidedIntakeRetryBlock(null);
        pendingGuidedIntakeRef.current = pendingGuidedIntake;
        setInput(pendingGuidedIntake.prompt);
        setGuidedIntakeRetryAvailable(true);
        setPostRequestFocusTarget('retry');
      } else if (pendingGuidedIntake) {
        updateGuidedIntakeRetryBlock(null);
        clearGuidedIntakeRetry(sessionId);
        pendingGuidedIntakeRef.current = undefined;
        setGuidedIntakeRetryAvailable(false);
        setGuidedIntakeRetryRequiresQuotaCheck(false);
        setPostRequestFocusTarget('composer');
      } else {
        setPostRequestFocusTarget('composer');
      }

      quotaStateVersionRef.current += 1;
      applyQuotaState(data.quotaRemaining, data.quotaResetAt);

      // Show a one-time “what to verify” tip the first time we present service results.
      // Never show during crisis flow.
      if (!data.isCrisis && Array.isArray(data.services) && data.services.length > 0) {
        setShowVerifyTip(true);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
          resultSummary: data.resultSummary,
          services: data.services,
          isCrisis: data.isCrisis,
          discoveryContext: data.isCrisis ? undefined : resultDiscoveryContext,
          retrievalStatus: data.retrievalStatus,
          activeContextUsed: data.activeContextUsed,
          sessionContext: data.sessionContext,
          searchInterpretation: data.searchInterpretation,
          clarification: data.clarification,
          followUpSuggestions: data.followUpSuggestions,
        },
      ]);
    } catch (error) {
      if (pendingGuidedIntake) {
        setInput(pendingGuidedIntake.prompt);
        if (shouldPreserveGuidedIntakeAfterFailure) {
          pendingGuidedIntakeRef.current = pendingGuidedIntake;
          if (guidedIntakeBlockedUntilAfterFailure) {
            updateGuidedIntakeRetryBlock(guidedIntakeBlockedUntilAfterFailure);
            setGuidedIntakeRetryAvailable(false);
            setPostRequestFocusTarget('composer');
          } else {
            setGuidedIntakeRetryAvailable(shouldOfferGuidedRetryAfterFailure);
            setPostRequestFocusTarget(shouldOfferGuidedRetryAfterFailure ? 'retry' : 'composer');
          }
        } else {
          updateGuidedIntakeRetryBlock(null);
          clearGuidedIntakeRetry(sessionId);
          pendingGuidedIntakeRef.current = undefined;
          setGuidedIntakeRetryAvailable(false);
          setGuidedIntakeRetryRequiresQuotaCheck(false);
          setPostRequestFocusTarget('composer');
        }
      } else {
        setPostRequestFocusTarget('composer');
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: error instanceof Error && error.name === 'ChatResponseError'
            ? error.message
            : 'Something went wrong. Please try again.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      guidedIntakeInFlightRef.current = undefined;
      setIsLoading(false);
    }
  }, [
    applyQuotaState,
    initialNeedId,
    initialPage,
    initialSortBy,
    input,
    isLoading,
    latestAssistantDiscoveryContext,
    latestAssistantServices,
    quotaRemaining,
    planEnabled,
    radiusMiles,
    reminderEnabled,
    seededAttributeFilters,
    sessionId,
    showSeededContext,
    trustFilter,
    userId,
    ignoreProfileShaping,
    sessionContext,
    guidedIntakeRetryAvailable,
    guidedIntakeRetryRequiresQuotaCheck,
    updateGuidedIntakeRetryBlock,
  ]);

  useEffect(() => {
    if (
      !autoSubmitInitialGuidedIntake
      || !initialGuidedIntake
      || restoredSessionId !== sessionId
      || autoSubmittedGuidedSessionRef.current === sessionId
      || messages.length > 0
      || input.trim() !== initialGuidedIntake.prompt.trim()
    ) {
      return;
    }

    // Wait until the session restore effect has completed, then claim this
    // fresh handoff before starting the request. The ref survives React's
    // Strict Mode effect replay, so the home intake can create only one turn.
    autoSubmittedGuidedSessionRef.current = sessionId;
    void sendMessage(undefined, initialGuidedIntake);
  }, [
    autoSubmitInitialGuidedIntake,
    initialGuidedIntake,
    input,
    messages.length,
    restoredSessionId,
    sendMessage,
    sessionId,
  ]);

  const retryGuidedIntake = useCallback(() => {
    const pendingGuidedIntake = pendingGuidedIntakeRef.current;
    if (!pendingGuidedIntake || isLoading) return;
    void sendMessage(undefined, pendingGuidedIntake);
  }, [isLoading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === 'Enter'
      && !e.shiftKey
      && !e.nativeEvent.isComposing
      && e.nativeEvent.keyCode !== 229
    ) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const handleChipClick = useCallback((prompt: string) => {
    if (isLoading || quotaRemaining === 0) return;
    void sendMessage(prompt);
  }, [isLoading, quotaRemaining, sendMessage]);

  const updateExecutionProposalStatus = useCallback((messageIndex: number, status: ChatExecutionProposal['status']) => {
    setMessages((prev) => prev.map((message, index) => {
      if (index !== messageIndex || message.role !== 'assistant' || !message.executionProposal) {
        return message;
      }

      return {
        ...message,
        executionProposal: {
          ...message.executionProposal,
          status,
        },
      };
    }));
  }, []);

  const applyExecutionProposal = useCallback((proposal: ChatExecutionProposal) => {
    const initialState = readStoredSeekerPlansState();
    const existingPlan = getActiveSeekerPlan(initialState);
    const ensuredPlan = existingPlan ?? createSeekerPlan('Current plan').plan;
    if (!ensuredPlan) {
      return null;
    }

    setActiveSeekerPlan(ensuredPlan.id);
    const snapshot = buildPlanServiceSnapshotFromChatCard(proposal.service, proposal.serviceHref);
    const currentState = readStoredSeekerPlansState();
    const currentPlan = getActiveSeekerPlan(currentState);
    const existingItem = currentPlan?.items.find((item) => item.linkedService?.serviceId === proposal.service.serviceId);

    if (proposal.action === 'set_reminder') {
      if (existingItem && currentPlan) {
        updateSeekerPlanItem(currentPlan.id, existingItem.id, {
          reminderAt: proposal.reminderAt,
          targetDate: proposal.targetDate,
          urgency: proposal.urgency,
        });
      } else {
        addServicePlanItem(ensuredPlan.id, snapshot, {
          source: 'chat_service',
          urgency: proposal.urgency,
          targetDate: proposal.targetDate,
          reminderAt: proposal.reminderAt,
        });
      }

      return `Local reminder set for ${proposal.service.serviceName}.`;
    }

    if (existingItem && currentPlan) {
      updateSeekerPlanItem(currentPlan.id, existingItem.id, {
        targetDate: proposal.targetDate,
        urgency: proposal.urgency,
      });
      return `${proposal.service.serviceName} is already in your local plan. I updated the timing target.`;
    }

    addServicePlanItem(ensuredPlan.id, snapshot, {
      source: 'chat_service',
      urgency: proposal.urgency,
      targetDate: proposal.targetDate,
    });
    return `${proposal.service.serviceName} added to your local plan.`;
  }, []);

  const handleConfirmExecutionProposal = useCallback((messageIndex: number, proposal: ChatExecutionProposal) => {
    const confirmationMessage = applyExecutionProposal(proposal);
    if (!confirmationMessage) {
      return;
    }

    updateExecutionProposalStatus(messageIndex, 'applied');
    success(confirmationMessage);
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: confirmationMessage,
        timestamp: new Date(),
      },
    ]);
  }, [applyExecutionProposal, success, updateExecutionProposalStatus]);

  const handleCancelExecutionProposal = useCallback((messageIndex: number) => {
    updateExecutionProposalStatus(messageIndex, 'cancelled');
  }, [updateExecutionProposalStatus]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setHasCrisis(false);
    setShowVerifyTip(false);
    setInput('');
    const nextSessionContext = buildSeededSessionContext({
      initialNeedId,
      initialTrustFilter: trustFilter,
      initialAttributeFilters: seededAttributeFilters,
      ignoreProfileShaping,
    });
    sessionContextRef.current = nextSessionContext;
    setSessionContext(nextSessionContext);
    writeStoredMessages(sessionId, []);
    writeStoredDraft(sessionId, '');
    clearGuidedIntakeRetry(sessionId);
    updateGuidedIntakeRetryBlock(null);
    pendingGuidedIntakeRef.current = undefined;
    setGuidedIntakeRetryAvailable(false);
    setGuidedIntakeRetryRequiresQuotaCheck(false);
    inputRef.current?.focus();
  }, [ignoreProfileShaping, initialNeedId, seededAttributeFilters, sessionId, trustFilter, updateGuidedIntakeRetryBlock]);

  /** Called by QuotaCooldown when the countdown reaches zero — re-fetches to confirm reset */
  const handleQuotaExpired = useCallback(() => {
    setQuotaResetAt(null);
    localStorage.removeItem(QUOTA_RESET_KEY);
    const quotaVersion = quotaStateVersionRef.current;

    fetch('/api/chat/quota', { method: 'GET', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { remaining: number; limit?: number; resetAt: string | null } | null) => {
        if (!data) return;
        if (typeof data.limit === 'number' && data.limit > 0) setQuotaLimit(data.limit);
        applyQuotaState(data.remaining, data.resetAt, quotaVersion);
        setGuidedIntakeRetryRequiresQuotaCheck(false);
        const blockedUntil = guidedIntakeRetryBlockedUntilRef.current;
        const retryStillBlocked = Boolean(blockedUntil && blockedUntil > Date.now());
        if (blockedUntil && !retryStillBlocked) {
          updateGuidedIntakeRetryBlock(null);
        }
        if (data.remaining > 0 && pendingGuidedIntakeRef.current && !retryStillBlocked) {
          setGuidedIntakeRetryAvailable(true);
        }
      })
      .catch(() => {/* non-fatal */});
  }, [applyQuotaState, updateGuidedIntakeRetryBlock]);

  const pendingGuidedIntakeForCurrentInput = pendingGuidedIntakeRef.current?.prompt === input.trim()
    ? pendingGuidedIntakeRef.current
    : undefined;
  const guidedIntakeRetryBlockActive = Boolean(
    guidedIntakeRetryBlockedUntil && guidedIntakeRetryBlockedUntil > Date.now(),
  );
  const isGuidedIntakePromptBlocked = Boolean(
    pendingGuidedIntakeForCurrentInput
    && (
      guidedIntakeRetryRequiresQuotaCheck
      || guidedIntakeRetryBlockActive
      || (guidedIntakeRetryAvailable && quotaRemaining === 0)
    ),
  );

  return (
    <div className="chat-window-grid grid h-full min-h-0 bg-white lg:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="space-y-3 border-b border-slate-200 p-3 lg:hidden">
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={_startNewSession}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New chat
          </button>
        ) : null}
        {hasMeaningfulMobileHistory ? (
          <details className="rounded-[24px] border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
            <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
              Chat history
              <span className="text-xs font-medium text-slate-500">
                {savedChatSessions.length + recentChatSessions.length} saved or recent
              </span>
            </summary>
            <div className="border-t border-slate-200 p-3">
              <ChatRailSection
                title="Saved chats"
                emptyCopy="Save a conversation to keep it at the top of your chat history."
                sessions={savedChatSessions}
                activeSessionId={sessionId}
                onSelect={selectSession}
                onDelete={deleteChatSession}
              />
              <div className="mt-4">
                <ChatRailSection
                  title="Recent chats"
                  emptyCopy="Recent conversations appear here after you send your first message."
                  sessions={recentChatSessions}
                  activeSessionId={sessionId}
                  onSelect={selectSession}
                  onDelete={deleteChatSession}
                />
              </div>
              <ChatHistoryNote />
            </div>
          </details>
        ) : null}
      </div>

      <aside className="hidden min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50/70 lg:flex">
        <div className="border-b border-slate-200 px-4 py-4">
          <button
            type="button"
            onClick={_startNewSession}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New chat
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <ChatRailSection
            title="Saved chats"
            emptyCopy="Save a conversation to keep it at the top of the rail."
            sessions={savedChatSessions}
            activeSessionId={sessionId}
            onSelect={selectSession}
            onDelete={deleteChatSession}
          />

          <div className="mt-6">
            <ChatRailSection
              title="Recent chats"
              emptyCopy="Recent conversations appear here after you send your first message."
              sessions={recentChatSessions}
              activeSessionId={sessionId}
              onSelect={selectSession}
              onDelete={deleteChatSession}
            />
          </div>
        </div>
        <ChatHistoryNote />
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">

      {/* ── Compact toolbar ── */}
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:px-6">
        <span className="hidden shrink-0 text-sm font-semibold text-slate-900 md:inline lg:hidden">Find help</span>
        <nav className="inline-flex shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="Result views">
          <a
            href={_directoryHandoffHref}
            className="inline-flex min-h-11 items-center rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-950"
            aria-label="List view"
          >
            List
          </a>
          <a
            href={_mapHandoffHref}
            className="inline-flex min-h-11 items-center rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-950"
            aria-label="Map view"
          >
            Map
          </a>
        </nav>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
            aria-label="Open chat filters"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            Filters
          </button>
          {messages.length > 0 && (
            <>
              <button
                type="button"
                onClick={toggleCurrentConversationSaved}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
                aria-label={currentChatSummary?.saved ? 'Unsave current chat' : 'Save current chat'}
                title={currentChatSummary?.saved ? 'Unsave current chat' : 'Save current chat'}
              >
                {currentChatSummary?.saved ? <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />}
                <span className="hidden sm:inline">{currentChatSummary?.saved ? 'Saved' : 'Save chat'}</span>
              </button>
              <button
                type="button"
                onClick={clearConversation}
                disabled={isLoading}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            </>
          )}
          {messages.length > 0 ? (
            <p className="hidden rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-900 sm:block">
              {quotaRemaining} left today
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Quota progress bar — proportional to THIS identity's limit, so a
          fresh anonymous 10/10 renders full instead of half-spent. ── */}
      {quotaRemaining < quotaLimit && (
        <div className="h-px w-full shrink-0 overflow-hidden bg-slate-100" aria-hidden="true">
          <div
            className={`h-full transition-all duration-300 ${
              quotaRemaining > quotaLimit / 2
                ? 'bg-slate-300'
                : quotaRemaining > quotaLimit / 5
                ? 'bg-amber-400'
                : 'bg-rose-400'
            }`}
            style={{ width: `${(quotaRemaining / quotaLimit) * 100}%` }}
          />
        </div>
      )}

      {/* ── Active context strip — only when context is set ── */}
      {sessionContext && (
        <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 px-5 py-2 md:px-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Active chat context</span>
            {(sessionContext.activeNeedId || sessionContext.activeRetrievalText) && (
              <button
                type="button"
                onClick={() => _clearSessionContextField('activeNeedId')}
                className="inline-flex min-h-11 items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
                aria-label="Remove need from active chat context"
              >
                Need: {sessionContext.activeNeedId
                  ? formatFilterLabel(sessionContext.activeNeedId)
                  : 'previous request'} ×
              </button>
            )}
            {sessionContext.activeGeo && (
              <button
                type="button"
                onClick={clearLocation}
                className="inline-flex min-h-11 items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
                aria-label="Remove distance from active chat context"
              >
                <MapPin className="mr-1 h-3 w-3" aria-hidden="true" />
                {sessionContext.activeGeo.radiusMiles} mi ×
              </button>
            )}
            {sessionContext.activeLocation ? (
              <button
                type="button"
                onClick={() => _clearSessionContextField('activeLocation')}
                className="inline-flex min-h-11 items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
                aria-label="Remove location from active chat context"
              >
                Location: {sessionContext.activeLocation.postalCode
                  ?? [sessionContext.activeLocation.city, sessionContext.activeLocation.stateProvince].filter(Boolean).join(', ')} ×
              </button>
            ) : sessionContext.activeCity ? (
              <button
                type="button"
                onClick={() => _clearSessionContextField('activeCity')}
                className="inline-flex min-h-11 items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
                aria-label="Remove city from active chat context"
              >
                City: {sessionContext.activeCity} ×
              </button>
            ) : null}
            {sessionContext.urgency && (
              <button
                type="button"
                onClick={() => _clearSessionContextField('urgency')}
                className="inline-flex min-h-11 items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
                aria-label="Remove urgency from active chat context"
              >
                Urgency: {formatFilterLabel(sessionContext.urgencyWindow ?? sessionContext.urgency)} ×
              </button>
            )}
            {sessionContext.audience && (
              <button
                type="button"
                onClick={() => _clearSessionContextField('audience')}
                className="inline-flex min-h-11 items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
                aria-label="Remove audience from active chat context"
              >
                For: {formatFilterLabel(sessionContext.audience)} ×
              </button>
            )}
            {sessionContext.accessMode && (
              <button
                type="button"
                onClick={() => _clearSessionContextField('accessMode')}
                className="inline-flex min-h-11 items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
                aria-label="Remove access mode from active chat context"
              >
                Access: {formatFilterLabel(sessionContext.accessMode)} ×
              </button>
            )}
            {sessionContext.trustFilter && sessionContext.trustFilter !== 'all' && (
              <button
                type="button"
                onClick={() => _clearSessionContextField('trustFilter')}
                className="inline-flex min-h-11 items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
                aria-label="Remove record confidence from active chat context"
              >
                Record confidence: {formatFilterLabel(sessionContext.trustFilter)} ×
              </button>
            )}
            {!sessionContext.accessMode && sessionContext.preferredDeliveryModes?.map((mode) => (
              <button
                key={`strip-delivery-${mode}`}
                type="button"
                onClick={() => {
                  setSeededAttributeFilters((current) => {
                    const nextModes = current?.delivery?.filter((value) => value !== mode) ?? [];
                    const nextFilters = { ...(current ?? {}) };
                    if (nextModes.length > 0) { nextFilters.delivery = nextModes; } else { delete nextFilters.delivery; }
                    return Object.keys(nextFilters).length > 0 ? nextFilters : undefined;
                  });
                  updateSessionContext((current) => ({
                    ...(current ?? {}),
                    preferredDeliveryModes: current?.preferredDeliveryModes?.filter((value) => value !== mode),
                    profileShapingEnabled: !ignoreProfileShaping,
                  }));
                }}
                className="inline-flex min-h-11 items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
                aria-label={`Remove ${formatFilterLabel(mode)} delivery from active chat context`}
              >
                Delivery: {formatFilterLabel(mode)} ×
              </button>
            ))}
            {Object.entries(sessionContext.attributeFilters ?? {})
              .flatMap(([taxonomy, tags]) => taxonomy === 'delivery' ? [] : tags.map((tag) => ({ taxonomy, tag })))
              .map(({ taxonomy, tag }) => (
                <button
                  key={`strip-${taxonomy}-${tag}`}
                  type="button"
                  onClick={() => _removeSessionAttributeTag(taxonomy, tag)}
                  className="inline-flex min-h-11 items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
                  aria-label={`Remove ${formatFilterLabel(tag)} from active chat context`}
                >
                  {formatFilterLabel(tag)} ×
                </button>
              ))}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {userId ? (
                <button
                  type="button"
                  onClick={() => setIgnoreProfileShaping((current) => !current)}
                  className={`inline-flex min-h-11 items-center rounded-full border px-3 py-1 text-xs font-medium ${ignoreProfileShaping ? 'border-slate-300 bg-slate-100 text-slate-900' : 'border-slate-200 bg-white text-slate-700'}`}
                  aria-pressed={ignoreProfileShaping}
                >
                  {ignoreProfileShaping ? 'Profile off' : 'Profile on'}
                </button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  dismissLocationPrompt();
                  setTrustFilter('all');
                  setSeededAttributeFilters(undefined);
                  sessionContextRef.current = undefined;
                  setSessionContext(undefined);
                  setShowSeededContext(false);
                }}
              >
                Clear all
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending removed chat ── */}
      {pendingRemovedChat && (
        <div className="shrink-0 border-b border-amber-100 bg-amber-50 px-5 py-2.5 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-800">
              <span className="font-semibold">{pendingRemovedChat.summary.title}</span>{' '}
              was auto-removed. <span className="text-slate-500">Restore within 5 s.</span>
            </p>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => restorePendingRemovedChat()}>Undo</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => restorePendingRemovedChat({ select: true })}>Reopen</Button>
              <Button type="button" size="sm" onClick={() => restorePendingRemovedChat({ save: true, select: true })}>Save &amp; reopen</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Message log ── */}
      <div
        ref={messageLogRef}
        className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5 [scrollbar-gutter:stable] [scrollbar-width:thin] [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-3xl [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-track]:bg-transparent sm:px-6"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {showMessageTopFade ? (
          <div className="pointer-events-none sticky top-0 z-10 -mb-6 h-6 bg-gradient-to-b from-white to-transparent" aria-hidden="true" />
        ) : null}
        {/* Crisis banner shown if any message triggered crisis */}
        {hasCrisis && <CrisisBanner />}

        {showVerifyTip && !hasCrisis && (
          <div
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700"
            role="note"
            aria-label="Verification tip"
          >
            Tip: Confirm hours, eligibility requirements, and any documents needed with the provider.
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex min-h-full flex-col justify-center gap-5 py-6">
            {/* ── Welcome heading ── */}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-[46rem]">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-[2rem]">How can ORAN help?</h2>
                <p className="mt-1.5 text-[15px] leading-7 text-slate-500">Describe the situation in your own words. Use filters only when they improve the match.</p>
              </div>
              {activeGeo ? (
                <span className="inline-flex min-h-[32px] items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  <MapPin className="mr-1.5 h-3 w-3" aria-hidden="true" />
                  Nearby: {activeGeo.radiusMiles} mi
                </span>
              ) : null}
            </div>

            {/* ── Quick-need grid ── */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Or start with a common need</p>
            <QuickNeedFilterGrid
              activeNeedId={activeNeedId}
              onSelect={handleCategoryClick}
              ariaLabel="Quick chat categories"
              className="w-full"
              gridClassName="grid grid-cols-2 gap-2 lg:grid-cols-4"
              limit={4}
            />
            </div>

            {/* ── Optional location consent ── */}
            {shouldOfferAutomaticLocation && (
              <div className="flex flex-col gap-3 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3.5 sm:flex-row sm:items-center">
                <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">Use location for nearby results</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">Optional. Browser location is used only with your consent.</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => requestDeviceLocation(true)} disabled={isLocating}>
                    {isLocating ? 'Locating…' : 'Enable location'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={dismissLocationPrompt}>Not now</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            ref={
              idx === messages.length - 1
              && msg.role === 'assistant'
              && (msg.services?.length ?? 0) > 0
                ? latestResultMessageRef
                : undefined
            }
            data-result-bearing={
              idx === messages.length - 1
              && msg.role === 'assistant'
              && (msg.services?.length ?? 0) > 0
                ? 'true'
                : undefined
            }
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] space-y-2.5 ${
                msg.role === 'user'
                  ? 'rounded-[24px] rounded-tr-md bg-slate-900 px-4 py-3 text-sm text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]'
                  : 'rounded-[24px] rounded-tl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-[0_12px_32px_rgba(15,23,42,0.06)]'
              }`}
            >
              <p className="break-words">{msg.content}</p>
              {msg.role === 'assistant' && (
                <div className="space-y-2 mt-2">
                  {(msg as AssistantMessage).resultSummary && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
                      {(msg as AssistantMessage).resultSummary}
                    </div>
                  )}
                  <RetrievalStatusNote status={(msg as AssistantMessage).retrievalStatus} />
                  <RetrievalRecoveryActions status={(msg as AssistantMessage).retrievalStatus} />
                  <SearchInterpretationPanel
                    interpretation={(msg as AssistantMessage).searchInterpretation}
                    canToggleProfile={Boolean(userId)}
                    onToggleProfile={() => setIgnoreProfileShaping((current) => !current)}
                  />
                  {(msg as AssistantMessage).clarification && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
                      <p className="font-medium">Refine this search</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(msg as AssistantMessage).clarification?.suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => handleChipClick(suggestion)}
                            disabled={isLoading || quotaRemaining === 0}
                            className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 disabled:opacity-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {((msg as AssistantMessage).followUpSuggestions?.length ?? 0) > 0 && !(msg as AssistantMessage).clarification && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
                      <p className="font-medium">Next refinements</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(msg as AssistantMessage).followUpSuggestions?.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => handleChipClick(suggestion)}
                            disabled={isLoading || quotaRemaining === 0}
                            className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 disabled:opacity-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {(msg as AssistantMessage).executionProposal && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
                      <div className="flex items-start gap-2">
                        {(msg as AssistantMessage).executionProposal?.action === 'set_reminder'
                          ? <BellRing className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden="true" />
                          : <ListTodo className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden="true" />}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">Execution proposal</p>
                          <p className="mt-1 leading-5">{(msg as AssistantMessage).executionProposal?.detail}</p>
                          {(msg as AssistantMessage).executionProposal?.status === 'pending' ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleConfirmExecutionProposal(idx, (msg as AssistantMessage).executionProposal as ChatExecutionProposal)}
                                className="inline-flex min-h-[44px] items-center rounded-full border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                              >
                                {(msg as AssistantMessage).executionProposal?.confirmationLabel}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelExecutionProposal(idx)}
                                className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                              >
                                Not now
                              </button>
                            </div>
                          ) : (
                            <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                              {(msg as AssistantMessage).executionProposal?.status === 'applied' ? 'Applied locally' : 'Left unchanged'}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {msg.role === 'assistant' && (msg as AssistantMessage).services && (
                <div className="space-y-2 mt-2">
                  <DiscoveryContextPanel
                    discoveryContext={(msg as AssistantMessage).discoveryContext}
                    title="Search scope used for these results"
                    description="This response stayed inside the record-confidence and filter scope active when you sent the message."
                    className="border-slate-200 bg-slate-50"
                  />
                  {(() => {
                    const services = (msg as AssistantMessage).services ?? [];
                    const topMatches = services.slice(0, 3);
                    const additionalMatches = services.slice(3);

                    return (
                      <>
                        {topMatches.length > 0 && (
                          <div className="space-y-2">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                              <span className="font-medium">Top matches</span>
                              <span className="ml-1 text-slate-500">Best first, with the rest still available below.</span>
                            </div>
                            {topMatches.map((card) => (
                              <ChatServiceCard
                                key={card.serviceId}
                                card={card}
                                discoveryContext={(msg as AssistantMessage).discoveryContext}
                                isSaved={savedIds.has(card.serviceId)}
                                onToggleSave={toggleSave}
                                savedSyncEnabled={serverSyncEnabled && Boolean(userId)}
                              />
                            ))}
                          </div>
                        )}

                        {additionalMatches.length > 0 && (
                          <div className="space-y-2">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
                              <span className="font-medium">More options</span>
                              <span className="ml-1 text-slate-600">Additional publication-gated records that may still fit.</span>
                            </div>
                            {additionalMatches.map((card) => (
                              <ChatServiceCard
                                key={card.serviceId}
                                card={card}
                                discoveryContext={(msg as AssistantMessage).discoveryContext}
                                isSaved={savedIds.has(card.serviceId)}
                                onToggleSave={toggleSave}
                                savedSyncEnabled={serverSyncEnabled && Boolean(userId)}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
              <span className={`block text-[11px] mt-1 select-none ${
                msg.role === 'user' ? 'text-slate-300 text-right' : 'text-slate-400'
              }`}>{formatTime(msg.timestamp)}</span>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-[22px] rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-5" role="status">
                <span className="sr-only">Searching for services…</span>
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" aria-hidden="true" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" aria-hidden="true" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" aria-hidden="true" />
              </div>
            </div>
          </div>
        )}

        {showMessageBottomFade ? (
          <div className="pointer-events-none sticky bottom-0 z-10 -mt-8 h-8 bg-gradient-to-t from-white to-transparent" aria-hidden="true" />
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2 sm:px-6 sm:py-3">
        <div className="mx-auto max-w-3xl">
        {guidedIntakeRetryAvailable
        && !guidedIntakeRetryRequiresQuotaCheck
        && !guidedIntakeRetryBlockActive
        && !isLoading
        && quotaRemaining > 0 ? (
          <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between" role="status">
            <div>
              <p className="font-semibold">Your search is ready to retry</p>
              <p className="mt-1 text-xs leading-5 text-amber-900">We kept the intake on this device. You can retry it now or edit the message below.</p>
            </div>
            <Button ref={retryButtonRef} type="button" variant="outline" size="sm" onClick={retryGuidedIntake} className="min-h-11 shrink-0 border-amber-300 bg-white text-amber-950 hover:bg-amber-100">
              Retry search
            </Button>
          </div>
        ) : null}
        {!hasCrisis && quotaRemaining <= Math.ceil(quotaLimit / 4) && quotaRemaining > 0 && (
          <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-800 shadow-sm">
            <p className="font-medium">Low message budget</p>
            <p className="mt-1">You can keep browsing in the Directory or Map — your category and filters carry over, but what you typed here stays private to this chat, so you may need to search again there.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={_directoryHandoffHref} className="inline-flex min-h-[44px] items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-900 shadow-sm">
                Open Directory
              </a>
              <a href={_mapHandoffHref} className="inline-flex min-h-[44px] items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-900 shadow-sm">
                Open Map
              </a>
            </div>
          </div>
        )}
        <div className="rounded-[24px] border border-slate-300 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                const nextInput = e.target.value;
                if (
                  pendingGuidedIntakeRef.current
                  && pendingGuidedIntakeRef.current.prompt !== nextInput.trim()
                ) {
                  pendingGuidedIntakeRef.current = undefined;
                  clearGuidedIntakeRetry(sessionId);
                  updateGuidedIntakeRetryBlock(null);
                  setGuidedIntakeRetryAvailable(false);
                  setGuidedIntakeRetryRequiresQuotaCheck(false);
                }
                setInput(nextInput);
                autoResize(e.target);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you need help with..."
              className="min-h-12 flex-1 resize-none rounded-[18px] border-0 bg-white px-4 py-2.5 text-[15px] leading-7 text-slate-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--brand-primary)] sm:min-h-14 sm:py-3"
              rows={1}
              aria-label="Chat message input"
              disabled={isLoading}
            />
            <Button
              onClick={() => void sendMessage()}
              disabled={isLoading || !input.trim() || isGuidedIntakePromptBlocked}
              size="icon"
              aria-label="Send message"
              className="min-h-[48px] min-w-[48px] self-end rounded-2xl bg-slate-900 shadow-sm hover:bg-slate-800"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="flex flex-col gap-1 px-2 pt-1.5 text-[11px] leading-4 text-slate-500 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:pt-2.5">
            <p className="hidden sm:block">
              {quotaRemaining === 0
                ? 'Daily discovery limit reached. Immediate safety and crisis messages still work.'
                : 'Ask for nearby services, eligibility details, or next steps.'}
            </p>
            <div role="note" aria-label="Eligibility disclaimer" className="sm:max-w-[22rem] sm:text-right">
              <details className="group">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 [&::-webkit-details-marker]:hidden">
                  <span className="sm:hidden">Verify details with the provider.</span>
                  <span className="hidden sm:inline">Confirm eligibility and availability with the provider.</span>
                  <span className="text-sm leading-none transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
                </summary>
                <p className="mt-1 text-left text-slate-500 sm:text-right">{ELIGIBILITY_DISCLAIMER}</p>
              </details>
            </div>
          </div>
        </div>
        {quotaRemaining === 0 && quotaResetAt && (
          <QuotaCooldown resetAt={quotaResetAt} onExpired={handleQuotaExpired} />
        )}
        {!hasCrisis && quotaRemaining === 0 && !quotaResetAt && (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-800 shadow-sm" role="alert">
            <p className="font-medium">Daily discovery limit reached.</p>
            <p className="mt-1">Immediate safety and crisis messages still work. You can keep browsing in the Directory or Map — your category and filters carry over, but what you typed here stays private to this chat, so you may need to search again there.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={_directoryHandoffHref} className="inline-flex min-h-[44px] items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-900 shadow-sm">
                Open Directory
              </a>
              <a href={_mapHandoffHref} className="inline-flex min-h-[44px] items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-900 shadow-sm">
                Open Map
              </a>
              <button
                type="button"
                onClick={_startNewSession}
                className="inline-flex min-h-[44px] items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-900 shadow-sm"
              >
                New chat (daily limit still applies)
              </button>
            </div>
          </div>
        )}
        </div>
      </div>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="max-w-3xl rounded-[28px] border border-slate-200 bg-white p-0 shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left">
            <DialogTitle className="text-xl font-semibold text-slate-900">Filters</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-500">
              Narrow results by the kind of help, distance, or how the service is offered.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto px-6 py-5" style={{ maxHeight: '78vh' }}>
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Quick filters</p>
                  <p className="mt-1 text-xs text-slate-500">Choose the main kind of help you need.</p>
                </div>
                {activeNeedId ? (
                  <Button type="button" variant="outline" size="sm" onClick={clearCategory}>
                    Clear category
                  </Button>
                ) : null}
              </div>

              <QuickNeedFilterGrid
                activeNeedId={activeNeedId}
                onSelect={handleCategoryClick}
                ariaLabel="Chat category"
                gridClassName="grid grid-cols-2 gap-2 md:grid-cols-4"
                includeAll
              />
            </div>

            <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Distance</p>
                  <p className="mt-1 text-xs text-slate-500">Focus chat results near your approximate device location.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => requestDeviceLocation(true)} disabled={isLocating || hasNonSelfAudience}>
                    <MapPin className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    {isLocating ? 'Locating…' : activeGeo ? 'Refresh location' : 'Use my location'}
                  </Button>
                  {activeGeo || activeTextLocationLabel ? (
                    <Button type="button" variant="outline" size="sm" onClick={clearLocation}>
                      Clear location
                    </Button>
                  ) : null}
                </div>
              </div>

              {activeGeo ? (
                <DistanceRadiusControl
                  value={radiusMiles}
                  onChange={handleRadiusChange}
                />
              ) : activeTextLocationLabel ? (
                <p className="text-sm text-slate-600">
                  Using {activeTextLocationLabel} from this chat. Choosing device location will replace it.
                </p>
              ) : (
                <p className="text-sm text-slate-500">Enable approximate location to filter chat results within a specific distance.</p>
              )}
            </div>

            <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Service details</p>
                  <p className="mt-1 text-xs text-slate-500">Choose only the service details that matter to you.</p>
                </div>
                {activeAttributeCount > 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={clearAttributes}>
                    Clear details
                  </Button>
                ) : null}
              </div>

              <div className="space-y-4">
                {SEEKER_ATTRIBUTE_DIMENSIONS.map((dim) => {
                  const def = SERVICE_ATTRIBUTES_TAXONOMY[dim];
                  if (!def) return null;
                  const commonTags = def.tags.filter((tag) => tag.common).slice(0, 8);
                  const activeTags = seededAttributeFilters?.[dim] ?? [];
                  return (
                    <div key={dim} className="rounded-[18px] border border-slate-200 bg-white p-4" role="group" aria-label={def.name}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{DIMENSION_LABELS[dim] ?? def.name}</p>
                      <div className="flex flex-wrap gap-2">
                        {commonTags.map((tag) => {
                          const isActive = activeTags.includes(tag.tag);
                          return (
                            <button
                              key={tag.tag}
                              type="button"
                              onClick={() => toggleAttribute(dim, tag.tag)}
                              className={`inline-flex min-h-[40px] items-center justify-center rounded-full border px-3 py-1 text-xs font-medium ${isActive ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                              aria-pressed={isActive}
                              title={tag.description}
                            >
                              {DISCOVERY_ATTRIBUTE_LABELS[tag.tag] ?? tag.tag.replace(/_/g, ' ')}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
            <Button type="button" variant="outline" onClick={() => {
              clearCategory();
              clearAttributes();
              clearLocation();
            }}>
              Clear all
            </Button>
            <Button type="button" onClick={() => setFiltersOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

export default ChatWindow;
