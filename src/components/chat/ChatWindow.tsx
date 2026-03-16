/**
 * ORAN Chat Window Component
 *
 * Primary chat interface for service discovery.
 * Always shows: crisis banner (when triggered), eligibility disclaimer.
 * Never generates or invents service information — all data from API.
 */

'use client';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, AlertTriangle, Phone, Trash2, Clock, Plus, SlidersHorizontal, Bookmark, BookmarkCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ELIGIBILITY_DISCLAIMER, MAX_CHAT_QUOTA } from '@/domain/constants';
import { QUICK_DISCOVERY_NEEDS, type DiscoveryNeedId } from '@/domain/discoveryNeeds';
import { SERVICE_ATTRIBUTES_TAXONOMY } from '@/domain/taxonomy';
import type {
  ChatClarification,
  ChatResponse,
  ChatSessionContext,
  SearchInterpretation,
  ServiceCard,
} from '@/services/chat/types';
import { ChatServiceCard } from '@/components/chat/ChatServiceCard';
import { DiscoveryContextPanel } from '@/components/seeker/DiscoveryContextPanel';
import { useToast } from '@/components/ui/toast';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
  addServerSaved,
  readStoredSavedServiceIds,
  removeServerSaved,
  writeStoredSavedServiceIds,
} from '@/services/saved/client';
import { getSavedTogglePresentation } from '@/services/saved/presentation';
import { trackInteraction } from '@/services/telemetry/sentry';
import { DISCOVERY_CONFIDENCE_OPTIONS } from '@/services/search/discovery';
import type {
  DiscoveryConfidenceFilter,
  DiscoveryLinkState,
  DiscoverySortOption,
} from '@/services/search/discovery';
import { buildDiscoveryHref } from '@/services/search/discovery';
import type { SearchFilters } from '@/services/search/types';
import { DISCOVERY_ATTRIBUTE_LABELS } from '@/services/search/discoveryPresentation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Trust filter options — 'all' shows everything */
type TrustFilter = 'all' | 'HIGH' | 'LIKELY';

const TRUST_OPTIONS: { value: TrustFilter; label: string }[] = [
  { value: 'all', label: 'All results' },
  { value: 'LIKELY', label: 'Likely or higher' },
  { value: 'HIGH', label: 'High confidence only' },
];

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

// ============================================================
// SUGGESTION CHIPS — pre-fill and auto-submit on tap
// ============================================================

const SUGGESTION_CHIPS = [
  { label: 'Help paying rent',          prompt: 'I need help paying rent or utilities' },
  { label: 'Food pantry near me',       prompt: 'Where can I find a food pantry near me?' },
  { label: 'Mental health support',     prompt: 'I need mental health support or counseling' },
  { label: 'Job training programs',     prompt: 'Are there job training or employment programs available?' },
  { label: 'Free or low-cost care',     prompt: 'I need free or low-cost healthcare options' },
  { label: 'Shelter tonight',           prompt: 'I need a shelter or safe place to stay tonight' },
] as const;

// ============================================================
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
}

type Message = UserMessage | AssistantMessage;

/** Format timestamp as a short time string (e.g. "2:34 PM") */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Auto-resize a textarea to fit its content up to a max height */
function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

/** localStorage key for persisting the quota-reset timestamp across page reloads */
const QUOTA_RESET_KEY = 'oran:quota-reset-at';
const SESSION_CONTEXT_KEY_PREFIX = 'oran:chat-session-context:';
const CHAT_TRANSCRIPT_KEY_PREFIX = 'oran:chat-transcript:';
const CHAT_DRAFT_KEY_PREFIX = 'oran:chat-draft:';

function getSessionContextStorageKey(sessionId: string): string {
  return `${SESSION_CONTEXT_KEY_PREFIX}${sessionId}`;
}

function getChatTranscriptStorageKey(sessionId: string): string {
  return `${CHAT_TRANSCRIPT_KEY_PREFIX}${sessionId}`;
}

function getChatDraftStorageKey(sessionId: string): string {
  return `${CHAT_DRAFT_KEY_PREFIX}${sessionId}`;
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
    discoveryContext: message.discoveryContext,
    retrievalStatus: message.retrievalStatus,
    activeContextUsed: message.activeContextUsed,
    sessionContext: message.sessionContext,
    searchInterpretation: message.searchInterpretation,
    clarification: message.clarification,
    followUpSuggestions: message.followUpSuggestions,
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

  sessionStorage.setItem(key, JSON.stringify(messages.map(toStoredMessage)));
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

  const normalized: ChatSessionContext = {
    ...sessionContext,
    activeCity: sessionContext.activeCity?.trim() || undefined,
    preferredDeliveryModes: sessionContext.preferredDeliveryModes?.filter(Boolean),
    taxonomyTermIds: sessionContext.taxonomyTermIds?.filter(Boolean),
    attributeFilters: sessionContext.attributeFilters,
    profileShapingEnabled: sessionContext.profileShapingEnabled,
  };

  const hasMeaningfulContext = Boolean(
    normalized.activeNeedId
    || normalized.activeCity
    || normalized.urgency
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
    preferredDeliveryModes: options.initialAttributeFilters?.delivery,
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
      className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <Clock className="h-4 w-4 flex-shrink-0 text-amber-500" aria-hidden="true" />
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
          <p className="font-medium">Inherited from this chat session</p>
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

function SectionBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700">
      {children}
    </span>
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

  const raw = localStorage.getItem(CHAT_HISTORY_INDEX_KEY);
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
    localStorage.setItem(CHAT_HISTORY_INDEX_KEY, JSON.stringify(sorted));
  }

  return sorted;
}

function upsertStoredChatSession(summary: ChatSessionSummary): ChatSessionSummary[] {
  const sessions = readStoredChatSessions();
  const next = sessions.filter((session) => session.sessionId !== summary.sessionId);
  next.push(summary);
  return writeStoredChatSessions(next);
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
  const preview = truncateCopy(lastMessage || options.draft.trim() || fallbackTitle || 'Verified service search', 88);
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
}: {
  title: string;
  emptyCopy: string;
  sessions: ChatSessionSummary[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
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
            <button
              key={session.sessionId}
              type="button"
              onClick={() => onSelect(session.sessionId)}
              className={`w-full rounded-2xl border px-3 py-3 text-left transition ${isActive ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-sm font-medium">{session.title}</span>
                {session.saved ? (
                  <BookmarkCheck className={`mt-0.5 h-4 w-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} aria-hidden="true" />
                ) : (
                  <span className={`text-[10px] ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>
                    {session.messageCount > 0 ? `${session.messageCount} msgs` : 'Draft'}
                  </span>
                )}
              </div>
              <p className={`mt-1 line-clamp-2 text-xs ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>{session.preview}</p>
            </button>
          );
        })}
      </div>
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
  initialNeedId,
  initialTrustFilter,
  initialSortBy,
  initialPage,
  initialAttributeFilters,
}: ChatWindowProps) {
  const initialHasSeededContext = Boolean(initialPrompt?.trim())
    || Boolean(initialTrustFilter && initialTrustFilter !== 'all')
    || Object.keys(initialAttributeFilters ?? {}).length > 0;
  const [messages, setMessages] = useState<Message[]>(() => readStoredMessages(sessionId));
  const [input, setInput] = useState(() => readStoredDraft(sessionId) || initialPrompt?.trim() || '');
  const [isLoading, setIsLoading] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState(MAX_CHAT_QUOTA);
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { success } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const quotaStateVersionRef = useRef(0);

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

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

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
    scrollToBottom();
  }, [messages, scrollToBottom]);

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
    const storedSessions = readStoredChatSessions();
    const existingSession = storedSessions.find((session) => session.sessionId === sessionId);
    const storedMessages = readStoredMessages(sessionId);
    const storedDraft = readStoredDraft(sessionId);
    const storedContext = readStoredSessionContext(sessionId);
    const seeded = existingSession?.seeded ?? initialHasSeededContext;
    const seededContext = seeded
      ? buildSeededSessionContext({
          initialNeedId,
          initialTrustFilter,
          initialAttributeFilters,
          ignoreProfileShaping,
        })
      : undefined;

    if (!existingSession) {
      setChatSessions(upsertStoredChatSession(buildChatSessionSummary({
        sessionId,
        messages: storedMessages,
        draft: storedDraft,
        initialPrompt,
        seeded,
      })));
    } else {
      setChatSessions(storedSessions);
    }

    setMessages(storedMessages);
    setInput(storedDraft || (storedMessages.length === 0 && seeded ? initialPrompt?.trim() || '' : ''));
    setShowSeededContext(storedMessages.length === 0 && seeded);
    setHasCrisis(storedMessages.some((message) => message.role === 'assistant' && message.isCrisis));
    setShowVerifyTip(false);

    const nextContext = normalizeSessionContext(storedContext ?? seededContext);
    setSessionContext(nextContext);
    setTrustFilter((nextContext?.trustFilter ?? initialTrustFilter ?? 'all') as TrustFilter);
    setSeededAttributeFilters(nextContext?.attributeFilters ?? (seeded ? initialAttributeFilters : undefined));
    setIgnoreProfileShaping(nextContext?.profileShapingEnabled === false);
  }, [
    initialHasSeededContext,
    initialAttributeFilters,
    initialNeedId,
    initialPrompt,
    initialTrustFilter,
    sessionId,
  ]);

  useEffect(() => {
    setSessionContext((current) => normalizeSessionContext({
      ...(current ?? {}),
      trustFilter,
      attributeFilters: seededAttributeFilters,
      preferredDeliveryModes: seededAttributeFilters?.delivery ?? current?.preferredDeliveryModes,
      profileShapingEnabled: !ignoreProfileShaping,
    }));
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
    setChatSessions(upsertStoredChatSession(summary));
  }, [initialPrompt, input, messages, sessionId, showSeededContext]);

  // Fetch the server-authoritative quota state on mount.
  // This ensures the countdown and remaining count are accurate even after
  // a page reload or cross-device navigation.
  useEffect(() => {
    const quotaVersion = quotaStateVersionRef.current;

    fetch('/api/chat/quota', { method: 'GET', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { remaining: number; resetAt: string | null } | null) => {
        if (!data) return;
        applyQuotaState(data.remaining, data.resetAt, quotaVersion);
      })
      .catch(() => {/* non-fatal — keep default quota display */});

  }, [applyQuotaState]);

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

  const seededAttributeLabels = useMemo(() => {
    return Object.values(seededAttributeFilters ?? {})
      .flat()
      .map((value) => formatFilterLabel(value))
      .slice(0, 4);
  }, [seededAttributeFilters]);

  const isSeededPromptActive = Boolean(initialPrompt?.trim()) && input.trim() === (initialPrompt?.trim() ?? '');
  const hasSeededBrowseContext = showSeededContext && (
    isSeededPromptActive
    || trustFilter !== 'all'
    || Object.keys(seededAttributeFilters ?? {}).length > 0
  );
  const seededContextDescription = isSeededPromptActive
    ? 'Chat picked up your current search draft and filters. Edit the message below or send it as-is.'
    : 'Chat picked up your current browse filters. Type a message below and it will stay scoped to them.';
  const trustFilterLabel = DISCOVERY_CONFIDENCE_OPTIONS.find((option) => option.value === trustFilter)?.label;
  const activeNeedId = sessionContext?.activeNeedId;
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
  const activeAttributeCount = useMemo(
    () => Object.values(seededAttributeFilters ?? {}).reduce((total, values) => total + values.length, 0),
    [seededAttributeFilters],
  );

  const clearSeededBrowseContext = useCallback(() => {
    setShowSeededContext(false);
    setTrustFilter('all');
    setSeededAttributeFilters(undefined);
    setInput((current) => (current.trim() === (initialPrompt?.trim() ?? '') ? '' : current));
  }, [initialPrompt]);

  const updateSessionContext = useCallback((updater: (current: ChatSessionContext | undefined) => ChatSessionContext | undefined) => {
    setSessionContext((current) => normalizeSessionContext(updater(current)));
  }, []);

  const _clearSessionContextField = useCallback((field: 'activeNeedId' | 'activeCity' | 'urgency' | 'trustFilter' | 'attributeFilters' | 'preferredDeliveryModes') => {
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
          next.preferredDeliveryModes = undefined;
          break;
        default:
          next[field] = undefined;
      }

      return next;
    });
  }, [ignoreProfileShaping, updateSessionContext]);

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

  const handoffDiscoveryContext = useMemo(
    () => buildHandoffDiscoveryContext(sessionContext, latestUserMessage),
    [latestUserMessage, sessionContext],
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
    setChatSessions(upsertStoredChatSession({
      sessionId: nextSessionId,
      title: 'New chat',
      preview: 'Verified service search',
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      saved: false,
      seeded: false,
    }));
    if (onSessionChange) {
      onSessionChange(nextSessionId);
      return;
    }
    sessionStorage.setItem('oran_chat_session_id', nextSessionId);
    window.location.assign('/chat');
  }, [onSessionChange]);

  const selectSession = useCallback((nextSessionId: string) => {
    if (nextSessionId === sessionId) {
      return;
    }

    if (onSessionChange) {
      onSessionChange(nextSessionId);
      return;
    }

    sessionStorage.setItem('oran_chat_session_id', nextSessionId);
    window.location.assign(buildDiscoveryHref('/chat', handoffDiscoveryContext));
  }, [handoffDiscoveryContext, onSessionChange, sessionId]);

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
    setChatSessions(upsertStoredChatSession(next));
  }, [currentChatSummary, initialPrompt, input, messages, sessionId, showSeededContext]);

  const handleCategoryClick = useCallback((needId: DiscoveryNeedId) => {
    updateSessionContext((current) => ({
      ...(current ?? {}),
      activeNeedId: current?.activeNeedId === needId ? undefined : needId,
      profileShapingEnabled: !ignoreProfileShaping,
    }));
    setShowSeededContext(false);
  }, [ignoreProfileShaping, updateSessionContext]);

  const clearCategory = useCallback(() => {
    updateSessionContext((current) => ({
      ...(current ?? {}),
      activeNeedId: undefined,
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
        preferredDeliveryModes: taxonomy === 'delivery' ? nextFilters.delivery : current?.preferredDeliveryModes,
        profileShapingEnabled: !ignoreProfileShaping,
      };
    });
    setShowSeededContext(false);
  }, [ignoreProfileShaping, updateSessionContext]);

  const clearAttributes = useCallback(() => {
    setSeededAttributeFilters(undefined);
    updateSessionContext((current) => ({
      ...(current ?? {}),
      attributeFilters: undefined,
      preferredDeliveryModes: undefined,
      profileShapingEnabled: !ignoreProfileShaping,
    }));
  }, [ignoreProfileShaping, updateSessionContext]);

  const sendMessage = useCallback(async (override?: string) => {
    const trimmed = (override ?? input).trim();
    if (!trimmed || isLoading) return;
    const frozenDiscoveryContext: DiscoveryLinkState = {
      text: trimmed,
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

    try {
      const requestBody: Record<string, unknown> = {
        message: trimmed,
        sessionId,
        userId,
        profileMode: ignoreProfileShaping ? 'ignore' : 'use',
        sessionContext: normalizeSessionContext({
          ...(sessionContext ?? {}),
          trustFilter,
          attributeFilters: seededAttributeFilters,
          preferredDeliveryModes: seededAttributeFilters?.delivery ?? sessionContext?.preferredDeliveryModes,
          profileShapingEnabled: !ignoreProfileShaping,
        }),
      };
      const filterPayload: Record<string, unknown> = {};
      if (trustFilter !== 'all') filterPayload.trust = trustFilter;
      if (seededAttributeFilters && Object.keys(seededAttributeFilters).length > 0) {
        filterPayload.attributeFilters = seededAttributeFilters;
      }
      if (Object.keys(filterPayload).length > 0) requestBody.filters = filterPayload;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errorMsg = 'Something went wrong. Please try again.';
        try {
          const errBody = await response.json() as { error?: string };
          if (typeof errBody.error === 'string' && errBody.error) errorMsg = errBody.error;
        } catch { /* fall through to generic message */ }
        throw new Error(errorMsg);
      }

      const data: ChatResponse = await response.json();

      if (data.isCrisis) {
        setHasCrisis(true);
        trackInteraction('crisis_banner_shown');
      }

      setSessionContext(normalizeSessionContext(data.sessionContext));
      if (data.sessionContext?.trustFilter) {
        setTrustFilter(data.sessionContext.trustFilter);
      }
      if (data.sessionContext?.attributeFilters) {
        setSeededAttributeFilters(data.sessionContext.attributeFilters);
      }
      if (typeof data.sessionContext?.profileShapingEnabled === 'boolean') {
        setIgnoreProfileShaping(!data.sessionContext.profileShapingEnabled);
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
          discoveryContext: frozenDiscoveryContext,
          retrievalStatus: data.retrievalStatus,
          activeContextUsed: data.activeContextUsed,
          sessionContext: data.sessionContext,
          searchInterpretation: data.searchInterpretation,
          clarification: data.clarification,
          followUpSuggestions: data.followUpSuggestions,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [
    applyQuotaState,
    initialNeedId,
    initialPage,
    initialSortBy,
    input,
    isLoading,
    quotaRemaining,
    seededAttributeFilters,
    sessionId,
    showSeededContext,
    trustFilter,
    userId,
    ignoreProfileShaping,
    sessionContext,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const handleChipClick = useCallback((prompt: string) => {
    if (isLoading || quotaRemaining === 0) return;
    void sendMessage(prompt);
  }, [isLoading, quotaRemaining, sendMessage]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setHasCrisis(false);
    setShowVerifyTip(false);
    setInput('');
    setSessionContext(buildSeededSessionContext({
      initialNeedId,
      initialTrustFilter: trustFilter,
      initialAttributeFilters: seededAttributeFilters,
      ignoreProfileShaping,
    }));
    writeStoredMessages(sessionId, []);
    writeStoredDraft(sessionId, '');
    inputRef.current?.focus();
  }, [ignoreProfileShaping, initialNeedId, seededAttributeFilters, sessionId, trustFilter]);

  /** Called by QuotaCooldown when the countdown reaches zero — re-fetches to confirm reset */
  const handleQuotaExpired = useCallback(() => {
    setQuotaResetAt(null);
    localStorage.removeItem(QUOTA_RESET_KEY);
    const quotaVersion = quotaStateVersionRef.current;

    fetch('/api/chat/quota', { method: 'GET', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { remaining: number; resetAt: string | null } | null) => {
        if (!data) return;
        applyQuotaState(data.remaining, data.resetAt, quotaVersion);
      })
      .catch(() => {/* non-fatal */});
  }, [applyQuotaState]);

  return (
    <div className="grid h-[calc(100dvh-13rem)] min-h-[300px] gap-4 md:h-full md:min-h-0 md:max-h-none lg:grid-cols-[280px,minmax(0,1fr)]">
      <div className="space-y-3 lg:hidden">
        <button
          type="button"
          onClick={_startNewSession}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New chat
        </button>
        <div className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
          <ChatRailSection
            title="Saved chats"
            emptyCopy="Save a conversation to keep it at the top of your chat history."
            sessions={savedChatSessions}
            activeSessionId={sessionId}
            onSelect={selectSession}
          />
          <div className="mt-4">
            <ChatRailSection
              title="Recent chats"
              emptyCopy="Recent conversations appear here after you send your first message."
              sessions={recentChatSessions}
              activeSessionId={sessionId}
              onSelect={selectSession}
            />
          </div>
        </div>
      </div>

      <aside className="hidden min-h-0 flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white lg:flex">
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
          />

          <div className="mt-6">
            <ChatRailSection
              title="Recent chats"
              emptyCopy="Recent conversations appear here after you send your first message."
              sessions={recentChatSessions}
              activeSessionId={sessionId}
              onSelect={selectSession}
            />
          </div>
        </div>
      </aside>

      <div className="flex min-h-[300px] flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      {/* Header — quota indicator + actions */}
      <div className="border-b border-slate-200 bg-white px-4 py-4 md:px-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Verified records only</p>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">ORAN Chat only helps with verified service discovery. It uses stored ORAN records, will not invent facts, and refuses unrelated or inappropriate requests.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleCurrentConversationSaved}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
              aria-label={currentChatSummary?.saved ? 'Unsave current chat' : 'Save current chat'}
              title={currentChatSummary?.saved ? 'Unsave current chat' : 'Save current chat'}
            >
              {currentChatSummary?.saved ? <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />}
              {currentChatSummary?.saved ? 'Saved' : 'Save chat'}
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearConversation}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                Clear
              </button>
            )}
            <p className={`rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums ${
              quotaRemaining <= 10
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-slate-200 bg-white text-slate-600'
            }`}>
              {quotaRemaining} left today
            </p>
          </div>
        </div>
        {quotaRemaining < MAX_CHAT_QUOTA && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                quotaRemaining > Math.floor(MAX_CHAT_QUOTA / 2)
                  ? 'bg-slate-900'
                  : quotaRemaining > 10
                  ? 'bg-amber-400'
                  : 'bg-red-500'
              }`}
              style={{ width: `${(quotaRemaining / MAX_CHAT_QUOTA) * 100}%` }}
            />
          </div>
        )}

        {!ignoreProfileShaping && (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <span className="font-semibold">Saved profile guidance active.</span>
            <span className="ml-1 text-slate-600">It can guide ranking and follow-up context, but it does not create or hide records on its own.</span>
            <button
              type="button"
              onClick={() => setIgnoreProfileShaping(true)}
              className="ml-3 inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-900 hover:bg-slate-100"
            >
              Turn off for this session
            </button>
          </div>
        )}

        <div className="mt-4 space-y-3 rounded-[24px] border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick chat categories">
              {QUICK_DISCOVERY_NEEDS.map((need) => {
                const selected = activeNeedId === need.id;
                return (
                  <button
                    key={need.id}
                    type="button"
                    onClick={() => handleCategoryClick(need.id)}
                    className={`inline-flex min-h-[40px] items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
                    aria-pressed={selected}
                  >
                    {need.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-100"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              Filters
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Trust</span>
            <div role="group" aria-label="Trust filter" className="flex flex-wrap gap-1.5">
              {TRUST_OPTIONS.map((opt) => {
                const selected = trustFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTrustFilter(opt.value)}
                    className={`inline-flex min-h-[40px] flex-shrink-0 items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium transition ${selected ? 'border border-slate-900 bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
                    aria-pressed={selected}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {userId && (
              <button
                type="button"
                onClick={() => setIgnoreProfileShaping((current) => !current)}
                className={`inline-flex min-h-[40px] items-center rounded-full border px-3 py-1.5 text-xs font-medium ${ignoreProfileShaping ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-300 bg-white text-slate-800'}`}
                aria-pressed={ignoreProfileShaping}
              >
                {ignoreProfileShaping ? 'Saved profile off for this session' : 'Use saved profile signals'}
              </button>
            )}
          </div>

          {(activeNeedId || activeAttributeCount > 0 || trustFilter !== 'all') && (
            <div className="flex flex-wrap gap-2">
              {activeNeedId && (
                <SectionBadge>
                  Category: {QUICK_DISCOVERY_NEEDS.find((need) => need.id === activeNeedId)?.label ?? formatFilterLabel(activeNeedId)}
                </SectionBadge>
              )}
              {trustFilter !== 'all' && trustFilterLabel && (
                <SectionBadge>
                  Trust: {trustFilterLabel}
                </SectionBadge>
              )}
              {Object.entries(seededAttributeFilters ?? {}).flatMap(([taxonomy, tags]) => tags.map((tag) => ({ taxonomy, tag }))).slice(0, 6).map(({ taxonomy, tag }) => (
                <SectionBadge key={`${taxonomy}-${tag}`}>
                  {DISCOVERY_ATTRIBUTE_LABELS[tag] ?? formatFilterLabel(tag)}
                </SectionBadge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 space-y-4 overflow-y-auto bg-[linear-gradient(180deg,_#ffffff_0%,_#fafafa_100%)] p-4 md:p-5"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
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

        {sessionContext && (
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-left">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Active chat context
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  Follow-up questions can reuse this scope until you clear it.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={() => {
                  setTrustFilter('all');
                  setSeededAttributeFilters(undefined);
                  setSessionContext(undefined);
                }}
              >
                Clear all
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {sessionContext.activeNeedId && (
                <button
                  type="button"
                  onClick={() => _clearSessionContextField('activeNeedId')}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                >
                  Need: {formatFilterLabel(sessionContext.activeNeedId)} x
                </button>
              )}
              {sessionContext.activeCity && (
                <button
                  type="button"
                  onClick={() => _clearSessionContextField('activeCity')}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                >
                  City: {sessionContext.activeCity} x
                </button>
              )}
              {sessionContext.urgency && (
                <button
                  type="button"
                  onClick={() => _clearSessionContextField('urgency')}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                >
                  Urgency: {formatFilterLabel(sessionContext.urgency)} x
                </button>
              )}
              {sessionContext.trustFilter && sessionContext.trustFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => _clearSessionContextField('trustFilter')}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                >
                  Trust: {formatFilterLabel(sessionContext.trustFilter)} x
                </button>
              )}
              {sessionContext.preferredDeliveryModes?.map((mode) => (
                <button
                  key={`delivery-${mode}`}
                  type="button"
                  onClick={() => {
                    setSeededAttributeFilters((current) => {
                      const nextModes = current?.delivery?.filter((value) => value !== mode) ?? [];
                      const nextFilters = { ...(current ?? {}) };
                      if (nextModes.length > 0) {
                        nextFilters.delivery = nextModes;
                      } else {
                        delete nextFilters.delivery;
                      }
                      return Object.keys(nextFilters).length > 0 ? nextFilters : undefined;
                    });
                    updateSessionContext((current) => ({
                      ...(current ?? {}),
                      preferredDeliveryModes: current?.preferredDeliveryModes?.filter((value) => value !== mode),
                      profileShapingEnabled: !ignoreProfileShaping,
                    }));
                  }}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                >
                  Delivery: {formatFilterLabel(mode)} x
                </button>
              ))}
              {Object.entries(sessionContext.attributeFilters ?? {})
                .flatMap(([taxonomy, tags]) => taxonomy === 'delivery'
                  ? []
                  : tags.map((tag) => ({ taxonomy, tag })))
                .map(({ taxonomy, tag }) => (
                  <button
                    key={`${taxonomy}-${tag}`}
                    type="button"
                    onClick={() => _removeSessionAttributeTag(taxonomy, tag)}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                  >
                    {formatFilterLabel(tag)} x
                  </button>
                ))}
            </div>
          </div>
        )}

        {messages.length === 0 && (
          <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white px-5 py-8 shadow-sm md:px-8 md:py-10">
            <div className="relative flex flex-col items-center gap-5">
            {hasSeededBrowseContext && (
              <div className="w-full max-w-2xl rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-left">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Using current browse context
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  {seededContextDescription}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {isSeededPromptActive && (
                    <SectionBadge>
                      Need: {input.trim()}
                    </SectionBadge>
                  )}
                  {trustFilter !== 'all' && trustFilterLabel && (
                    <SectionBadge>
                      Trust: {trustFilterLabel}
                    </SectionBadge>
                  )}
                  {seededAttributeLabels.map((label) => (
                    <SectionBadge key={label}>
                      {label}
                    </SectionBadge>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={clearSeededBrowseContext}>
                    Clear context
                  </Button>
                </div>
              </div>
            )}
            <div className="max-w-xl text-center">
              <p className="text-2xl font-semibold tracking-tight text-slate-900">What verified help do you need?</p>
              <p className="mt-2 text-sm text-slate-500">Ask ORAN Chat for services, provider details, eligibility hints, or next steps from the ORAN catalog.</p>
            </div>
            <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleChipClick(chip.prompt)}
                  disabled={isLoading || quotaRemaining === 0}
                  className="min-h-[54px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-800 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {chip.label}
                </button>
              ))}
            </div>

          </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
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
                </div>
              )}
              {msg.role === 'assistant' && (msg as AssistantMessage).services && (
                <div className="space-y-2 mt-2">
                  <DiscoveryContextPanel
                    discoveryContext={(msg as AssistantMessage).discoveryContext}
                    title="Search scope used for these results"
                    description="This response stayed inside the trust and filter scope active when you sent the message."
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
                              <span className="ml-1 text-slate-600">Additional verified records that may still fit.</span>
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
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" aria-hidden="true" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" aria-hidden="true" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" aria-hidden="true" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Eligibility disclaimer — always shown */}
      <div
        className="border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900"
        role="note"
        aria-label="Eligibility disclaimer"
      >
        {ELIGIBILITY_DISCLAIMER}
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 bg-white p-3 md:p-4">
        {quotaRemaining <= 5 && quotaRemaining > 0 && (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 shadow-sm">
            <p className="font-medium">Low message budget</p>
            <p className="mt-1">You can keep this search scope and continue in Directory or Map if needed.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={_directoryHandoffHref} className="inline-flex min-h-[44px] items-center rounded-full border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 shadow-sm">
                Open Directory
              </a>
              <a href={_mapHandoffHref} className="inline-flex min-h-[44px] items-center rounded-full border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 shadow-sm">
                Open Map
              </a>
            </div>
          </div>
        )}
        <div className="rounded-[24px] border border-slate-200 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoResize(e.target); }}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you need help with..."
              className="min-h-[48px] flex-1 resize-none rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
              rows={1}
              aria-label="Chat message input"
              disabled={isLoading || quotaRemaining === 0}
            />
            <Button
              onClick={() => void sendMessage()}
              disabled={isLoading || !input.trim() || quotaRemaining === 0}
              size="icon"
              aria-label="Send message"
              className="min-h-[48px] min-w-[48px] rounded-2xl bg-slate-900 shadow-sm hover:bg-slate-800"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        {quotaRemaining === 0 && quotaResetAt && (
          <QuotaCooldown resetAt={quotaResetAt} onExpired={handleQuotaExpired} />
        )}
        {quotaRemaining === 0 && !quotaResetAt && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50/95 px-4 py-3 text-xs text-red-700 shadow-sm" role="alert">
            <p className="font-medium">Message limit reached.</p>
            <p className="mt-1">Continue with the same scope in Directory or Map, or start a fresh chat session.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={_directoryHandoffHref} className="inline-flex min-h-[44px] items-center rounded-full border border-red-200 bg-white px-2.5 py-1 font-medium text-red-700 shadow-sm">
                Open Directory
              </a>
              <a href={_mapHandoffHref} className="inline-flex min-h-[44px] items-center rounded-full border border-red-200 bg-white px-2.5 py-1 font-medium text-red-700 shadow-sm">
                Open Map
              </a>
              <button
                type="button"
                onClick={_startNewSession}
                className="inline-flex min-h-[44px] items-center rounded-full border border-red-200 bg-white px-2.5 py-1 font-medium text-red-700 shadow-sm"
              >
                Start new chat session
              </button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="max-w-3xl rounded-[28px] border border-slate-200 bg-white p-0 shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left">
            <DialogTitle className="text-xl font-semibold text-slate-900">Chat filters</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-500">
              Narrow chat results with the same quick-filter pattern used in seeker discovery.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto px-6 py-5" style={{ maxHeight: '78vh' }}>
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Quick filters</p>
                  <p className="mt-1 text-xs text-slate-500">Start with the kind of help you need, then add trust and service details below.</p>
                </div>
                {activeNeedId ? (
                  <Button type="button" variant="outline" size="sm" onClick={clearCategory}>
                    Clear category
                  </Button>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2" role="group" aria-label="Chat category">
                {QUICK_DISCOVERY_NEEDS.map((need) => {
                  const selected = activeNeedId === need.id;
                  return (
                    <button
                      key={need.id}
                      type="button"
                      onClick={() => handleCategoryClick(need.id)}
                      className={`inline-flex min-h-[40px] items-center rounded-full border px-3 py-1.5 text-xs font-medium ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                      aria-pressed={selected}
                    >
                      {need.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Trust</p>
                  <p className="mt-1 text-xs text-slate-500">Keep all results visible or narrow to stronger verification signals.</p>
                </div>
                {trustFilter !== 'all' ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setTrustFilter('all')}>
                    Clear trust
                  </Button>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2" role="group" aria-label="Trust filter options">
                {TRUST_OPTIONS.map((opt) => {
                  const selected = trustFilter === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTrustFilter(opt.value)}
                      className={`inline-flex min-h-[40px] items-center rounded-full border px-3 py-1.5 text-xs font-medium ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                      aria-pressed={selected}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Service details</p>
                  <p className="mt-1 text-xs text-slate-500">Canonical service tags from the ORAN taxonomy. These match what the API validates.</p>
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
              setTrustFilter('all');
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
