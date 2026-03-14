/**
 * ORAN Chat Window Component
 *
 * Primary chat interface for service discovery.
 * Always shows: crisis banner (when triggered), eligibility disclaimer.
 * Never generates or invents service information — all data from API.
 */

'use client';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, AlertTriangle, Phone, Trash2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ELIGIBILITY_DISCLAIMER } from '@/domain/constants';
import type { DiscoveryNeedId } from '@/domain/discoveryNeeds';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/** Trust filter options — 'all' shows everything */
type TrustFilter = 'all' | 'HIGH' | 'LIKELY';

const TRUST_OPTIONS: { value: TrustFilter; label: string }[] = [
  { value: 'all', label: 'All results' },
  { value: 'LIKELY', label: 'Likely or higher' },
  { value: 'HIGH', label: 'High confidence only' },
];

type TaxonomyTermDTO = {
  id: string;
  term: string;
  description: string | null;
  parentId: string | null;
  taxonomy: string | null;
  serviceCount: number;
};

function formatFilterLabel(value: string): string {
  return value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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

function getSessionContextStorageKey(sessionId: string): string {
  return `${SESSION_CONTEXT_KEY_PREFIX}${sessionId}`;
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
  initialTaxonomyTermIds?: string[];
  initialAttributeFilters?: SearchFilters['attributeFilters'];
  ignoreProfileShaping: boolean;
}): ChatSessionContext | undefined {
  return normalizeSessionContext({
    activeNeedId: options.initialNeedId ?? undefined,
    preferredDeliveryModes: options.initialAttributeFilters?.delivery,
    trustFilter: options.initialTrustFilter,
    taxonomyTermIds: options.initialTaxonomyTermIds,
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
      className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
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
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
      <p className="font-medium text-slate-900">How this was interpreted</p>
      <p className="mt-1">{interpretation.summary}</p>

      {interpretation.usedSessionContext && interpretation.sessionSignals.length > 0 && (
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-emerald-900">
          <p className="font-medium">Inherited from this chat session</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {interpretation.sessionSignals.map((signal) => (
              <span
                key={signal}
                className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-emerald-900"
              >
                {signal}
              </span>
            ))}
          </div>
        </div>
      )}

      {(interpretation.usedProfileShaping || interpretation.ignoredProfileShaping) && (
        <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 text-blue-900">
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
                  className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-blue-900"
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
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-blue-300 bg-white px-2.5 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-100"
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
    <span className="inline-flex items-center rounded-full border border-white/70 bg-white/85 px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm">
      {children}
    </span>
  );
}

// ============================================================
// CHAT WINDOW
// ============================================================

interface ChatWindowProps {
  sessionId: string;
  userId?: string;
  initialPrompt?: string;
  initialNeedId?: DiscoveryNeedId | null;
  initialTrustFilter?: DiscoveryConfidenceFilter;
  initialSortBy?: DiscoverySortOption;
  initialPage?: number;
  initialTaxonomyTermIds?: string[];
  initialAttributeFilters?: SearchFilters['attributeFilters'];
}

export function ChatWindow({
  sessionId,
  userId,
  initialPrompt,
  initialNeedId,
  initialTrustFilter,
  initialSortBy,
  initialPage,
  initialTaxonomyTermIds,
  initialAttributeFilters,
}: ChatWindowProps) {
  const initialHasSeededContext = Boolean(initialPrompt?.trim())
    || Boolean(initialTrustFilter && initialTrustFilter !== 'all')
    || (initialTaxonomyTermIds?.length ?? 0) > 0
    || Object.keys(initialAttributeFilters ?? {}).length > 0;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initialPrompt?.trim() ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState(50);
  const [quotaResetAt, setQuotaResetAt] = useState<Date | null>(() => {
    // Restore persisted reset timestamp from a previous session so the
    // countdown is immediately visible after a page reload.
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(QUOTA_RESET_KEY);
    if (!stored) return null;
    const d = new Date(stored);
    return d > new Date() ? d : null;
  });
  const [hasCrisis, setHasCrisis] = useState(false);
  const [showVerifyTip, setShowVerifyTip] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [serverSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());
  const [ignoreProfileShaping, setIgnoreProfileShaping] = useState(false);
  const { success } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const quotaStateVersionRef = useRef(0);

  // Filters: trust tier + taxonomy term IDs
  const [trustFilter, setTrustFilter] = useState<TrustFilter>(initialTrustFilter ?? 'all');
  const [taxonomyDialogOpen, setTaxonomyDialogOpen] = useState(false);
  const [taxonomyTerms, setTaxonomyTerms] = useState<TaxonomyTermDTO[]>([]);
  const [isLoadingTaxonomy, setIsLoadingTaxonomy] = useState(false);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [taxonomySearch, setTaxonomySearch] = useState('');
  const [selectedTaxonomyIds, setSelectedTaxonomyIds] = useState<string[]>(initialTaxonomyTermIds ?? []);
  const [seededAttributeFilters, setSeededAttributeFilters] = useState<SearchFilters['attributeFilters']>(
    initialAttributeFilters,
  );
  const [showSeededContext, setShowSeededContext] = useState(initialHasSeededContext);
  const [sessionContext, setSessionContext] = useState<ChatSessionContext | undefined>(() => buildSeededSessionContext({
    initialNeedId,
    initialTrustFilter,
    initialTaxonomyTermIds,
    initialAttributeFilters,
    ignoreProfileShaping: false,
  }));
  const hasLoadedTaxonomyRef = useRef(false);

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

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    setSavedIds(new Set(readStoredSavedServiceIds()));
  }, []);

  useEffect(() => {
    const stored = readStoredSessionContext(sessionId);
    setSessionContext((current) => normalizeSessionContext(stored ?? current ?? buildSeededSessionContext({
      initialNeedId,
      initialTrustFilter,
      initialTaxonomyTermIds,
      initialAttributeFilters,
      ignoreProfileShaping,
    })));
  }, [
    ignoreProfileShaping,
    initialAttributeFilters,
    initialNeedId,
    initialTaxonomyTermIds,
    initialTrustFilter,
    sessionId,
  ]);

  useEffect(() => {
    setSessionContext((current) => normalizeSessionContext({
      ...(current ?? {}),
      trustFilter,
      taxonomyTermIds: selectedTaxonomyIds.length > 0 ? selectedTaxonomyIds : undefined,
      attributeFilters: seededAttributeFilters,
      preferredDeliveryModes: seededAttributeFilters?.delivery ?? current?.preferredDeliveryModes,
      profileShapingEnabled: !ignoreProfileShaping,
    }));
  }, [ignoreProfileShaping, seededAttributeFilters, selectedTaxonomyIds, trustFilter]);

  useEffect(() => {
    writeStoredSessionContext(sessionId, sessionContext);
  }, [sessionContext, sessionId]);

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

  const loadTaxonomyTermsIfNeeded = useCallback(async () => {
    if (hasLoadedTaxonomyRef.current) return;
    setIsLoadingTaxonomy(true);
    setTaxonomyError(null);
    try {
      const res = await fetch('/api/taxonomy/terms?limit=250', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load filters');
      }
      const json = (await res.json()) as { terms: TaxonomyTermDTO[] };
      setTaxonomyTerms(Array.isArray(json.terms) ? json.terms : []);
      hasLoadedTaxonomyRef.current = true;
    } catch (e) {
      setTaxonomyError(e instanceof Error ? e.message : 'Failed to load filters');
    } finally {
      setIsLoadingTaxonomy(false);
    }
  }, []);

  const handleTaxonomyOpenChange = useCallback((next: boolean) => {
    setTaxonomyDialogOpen(next);
    if (next) {
      void loadTaxonomyTermsIfNeeded();
    }
  }, [loadTaxonomyTermsIfNeeded]);

  const visibleTaxonomyTerms = useMemo(() => {
    const trimmed = taxonomySearch.trim().toLowerCase();
    if (!trimmed) return taxonomyTerms;
    return taxonomyTerms.filter((t) => t.term.toLowerCase().includes(trimmed));
  }, [taxonomySearch, taxonomyTerms]);

  const toggleTaxonomyId = useCallback((id: string) => {
    if (!isUuid(id)) return;
    setSelectedTaxonomyIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      return next.slice(0, 20);
    });
  }, []);

  const clearTaxonomyFilters = useCallback(() => {
    setSelectedTaxonomyIds([]);
  }, []);

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
    || selectedTaxonomyIds.length > 0
    || Object.keys(seededAttributeFilters ?? {}).length > 0
  );
  const seededContextDescription = isSeededPromptActive
    ? 'Chat picked up your current search draft and filters. Edit the message below or send it as-is.'
    : 'Chat picked up your current browse filters. Type a message below and it will stay scoped to them.';
  const trustFilterLabel = DISCOVERY_CONFIDENCE_OPTIONS.find((option) => option.value === trustFilter)?.label;

  const clearSeededBrowseContext = useCallback(() => {
    setShowSeededContext(false);
    setTrustFilter('all');
    setSelectedTaxonomyIds([]);
    setSeededAttributeFilters(undefined);
    setInput((current) => (current.trim() === (initialPrompt?.trim() ?? '') ? '' : current));
  }, [initialPrompt]);

  const updateSessionContext = useCallback((updater: (current: ChatSessionContext | undefined) => ChatSessionContext | undefined) => {
    setSessionContext((current) => normalizeSessionContext(updater(current)));
  }, []);

  const _clearSessionContextField = useCallback((field: 'activeNeedId' | 'activeCity' | 'urgency' | 'trustFilter' | 'taxonomyTermIds' | 'attributeFilters' | 'preferredDeliveryModes') => {
    updateSessionContext((current) => {
      const next = { ...(current ?? {}), profileShapingEnabled: !ignoreProfileShaping };

      switch (field) {
        case 'trustFilter':
          setTrustFilter('all');
          next.trustFilter = undefined;
          break;
        case 'taxonomyTermIds':
          setSelectedTaxonomyIds([]);
          next.taxonomyTermIds = undefined;
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
    sessionStorage.setItem('oran_chat_session_id', nextSessionId);
    writeStoredSessionContext(nextSessionId, sessionContext);
    window.location.assign(buildDiscoveryHref('/chat', handoffDiscoveryContext));
  }, [handoffDiscoveryContext, sessionContext]);

  const sendMessage = useCallback(async (override?: string) => {
    const trimmed = (override ?? input).trim();
    if (!trimmed || isLoading) return;
    const frozenDiscoveryContext: DiscoveryLinkState = {
      text: trimmed,
      needId: showSeededContext ? initialNeedId : undefined,
      confidenceFilter: trustFilter,
      sortBy: showSeededContext ? initialSortBy : undefined,
      taxonomyTermIds: selectedTaxonomyIds.length > 0 ? selectedTaxonomyIds : undefined,
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
          taxonomyTermIds: selectedTaxonomyIds.length > 0 ? selectedTaxonomyIds : undefined,
          attributeFilters: seededAttributeFilters,
          preferredDeliveryModes: seededAttributeFilters?.delivery ?? sessionContext?.preferredDeliveryModes,
          profileShapingEnabled: !ignoreProfileShaping,
        }),
      };
      const filterPayload: Record<string, unknown> = {};
      if (trustFilter !== 'all') filterPayload.trust = trustFilter;
      if (selectedTaxonomyIds.length > 0) filterPayload.taxonomyTermIds = selectedTaxonomyIds;
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
      if (data.sessionContext?.taxonomyTermIds) {
        setSelectedTaxonomyIds(data.sessionContext.taxonomyTermIds);
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
    selectedTaxonomyIds,
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
      initialTaxonomyTermIds: selectedTaxonomyIds,
      initialAttributeFilters: seededAttributeFilters,
      ignoreProfileShaping,
    }));
    inputRef.current?.focus();
  }, [ignoreProfileShaping, initialNeedId, seededAttributeFilters, selectedTaxonomyIds, trustFilter]);

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
    <div className="flex h-[calc(100dvh-13rem)] flex-col overflow-hidden rounded-[26px] border border-orange-100/90 bg-gradient-to-b from-white via-orange-50/40 to-rose-50/50 shadow-[0_18px_55px_rgba(234,88,12,0.12)] md:h-auto md:max-h-[80vh]">
      {/* Header — quota indicator + actions */}
      <div className="border-b border-orange-100/80 bg-gradient-to-b from-orange-50/80 to-white px-4 py-3 md:px-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-700">Verified records only</p>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearConversation}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
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
                : 'border-orange-100 bg-white text-stone-500'
            }`}>
              {quotaRemaining} msg{quotaRemaining !== 1 ? 's' : ''} left
            </p>
          </div>
        </div>
        {/* Quota progress bar — visible when ≤ 40 remaining */}
        {quotaRemaining <= 40 && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-orange-100/70" aria-hidden="true">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                quotaRemaining > 20
                  ? 'bg-emerald-400'
                  : quotaRemaining > 10
                  ? 'bg-amber-400'
                  : 'bg-red-500'
              }`}
              style={{ width: `${(quotaRemaining / 50) * 100}%` }}
            />
          </div>
        )}

        {/* Filters */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-orange-100/80 bg-white/90 p-2.5 shadow-sm">
          <span className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Trust</span>
          <div role="group" aria-label="Trust filter" className="flex flex-wrap gap-1.5">
            {TRUST_OPTIONS.map((opt) => {
              const selected = trustFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTrustFilter(opt.value)}
                  className={`inline-flex min-h-[44px] flex-shrink-0 items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                    selected
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'border border-orange-100 bg-orange-50/60 text-stone-700 hover:border-orange-200 hover:bg-white'
                  }`}
                  aria-pressed={selected}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <Dialog open={taxonomyDialogOpen} onOpenChange={handleTaxonomyOpenChange}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="rounded-full border-orange-100 bg-white text-xs shadow-sm hover:bg-orange-50">
                Tags{selectedTaxonomyIds.length > 0 ? ` (${selectedTaxonomyIds.length})` : ''}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Filter by service tags</DialogTitle>
                <DialogDescription>
                  Filters are based on stored taxonomy terms. You may need to confirm details with the provider.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={taxonomySearch}
                    onChange={(e) => setTaxonomySearch(e.target.value)}
                    type="search"
                    placeholder="Search tags…"
                    className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 min-h-[44px]"
                    aria-label="Search service tags"
                  />
                  {selectedTaxonomyIds.length > 0 && (
                    <Button type="button" variant="outline" onClick={clearTaxonomyFilters}>
                      Clear
                    </Button>
                  )}
                </div>

                {taxonomyError && (
                  <p className="text-sm text-red-700" role="alert">{taxonomyError}</p>
                )}

                {isLoadingTaxonomy ? (
                  <p className="text-sm text-gray-600">Loading tags…</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 p-2">
                    <div className="flex flex-wrap gap-2">
                      {visibleTaxonomyTerms.map((t) => {
                        const selected = selectedTaxonomyIds.includes(t.id);
                        return (
                          <Button
                            key={t.id}
                            type="button"
                            size="sm"
                            variant={selected ? 'secondary' : 'outline'}
                            onClick={() => toggleTaxonomyId(t.id)}
                            title={t.description ?? undefined}
                            className="text-xs"
                          >
                            {t.term}
                          </Button>
                        );
                      })}
                      {visibleTaxonomyTerms.length === 0 && (
                        <p className="text-sm text-gray-600">No matching tags.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {userId && (
            <button
              type="button"
              onClick={() => setIgnoreProfileShaping((current) => !current)}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${
                ignoreProfileShaping
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900'
              }`}
              aria-pressed={ignoreProfileShaping}
            >
              {ignoreProfileShaping ? 'Saved profile off for this session' : 'Use saved profile signals'}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-orange-50/60 via-white to-rose-50/40 p-4 md:p-5"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {/* Crisis banner shown if any message triggered crisis */}
        {hasCrisis && <CrisisBanner />}

        {showVerifyTip && !hasCrisis && (
          <div
            className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-rose-50 px-4 py-3 text-xs text-orange-900 shadow-sm"
            role="note"
            aria-label="Verification tip"
          >
            Tip: Confirm hours, eligibility requirements, and any documents needed with the provider.
          </div>
        )}

        {sessionContext && (
          <div className="rounded-[24px] border border-emerald-200 bg-[linear-gradient(145deg,_rgba(236,253,245,0.96),_rgba(255,255,255,0.95))] px-4 py-4 text-left shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-800">
                  Active chat context
                </p>
                <p className="mt-1 text-sm text-emerald-950">
                  Follow-up questions can reuse this scope until you clear it.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setTrustFilter('all');
                  setSelectedTaxonomyIds([]);
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
                  className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 shadow-sm"
                >
                  Need: {formatFilterLabel(sessionContext.activeNeedId)} x
                </button>
              )}
              {sessionContext.activeCity && (
                <button
                  type="button"
                  onClick={() => _clearSessionContextField('activeCity')}
                  className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 shadow-sm"
                >
                  City: {sessionContext.activeCity} x
                </button>
              )}
              {sessionContext.urgency && (
                <button
                  type="button"
                  onClick={() => _clearSessionContextField('urgency')}
                  className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 shadow-sm"
                >
                  Urgency: {formatFilterLabel(sessionContext.urgency)} x
                </button>
              )}
              {sessionContext.trustFilter && sessionContext.trustFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => _clearSessionContextField('trustFilter')}
                  className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 shadow-sm"
                >
                  Trust: {formatFilterLabel(sessionContext.trustFilter)} x
                </button>
              )}
              {sessionContext.taxonomyTermIds?.length ? (
                <button
                  type="button"
                  onClick={() => _clearSessionContextField('taxonomyTermIds')}
                  className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 shadow-sm"
                >
                  Tags: {sessionContext.taxonomyTermIds.length} x
                </button>
              ) : null}
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
                  className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 shadow-sm"
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
                    className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 shadow-sm"
                  >
                    {formatFilterLabel(tag)} x
                  </button>
                ))}
            </div>
          </div>
        )}

        {messages.length === 0 && (
          <div className="relative overflow-hidden rounded-[28px] border border-orange-100/80 bg-gradient-to-br from-white via-orange-50/70 to-rose-50/70 px-5 py-8 shadow-sm md:px-8 md:py-10">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-r from-orange-100/70 via-rose-100/40 to-emerald-100/50" aria-hidden="true" />
            <div className="relative flex flex-col items-center gap-5">
            {hasSeededBrowseContext && (
              <div className="w-full max-w-2xl rounded-[22px] border border-rose-200 bg-gradient-to-br from-rose-50 to-orange-50 px-4 py-4 text-left shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-900">
                  Using current browse context
                </p>
                <p className="mt-1 text-sm text-stone-800">
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
                  {selectedTaxonomyIds.length > 0 && (
                    <SectionBadge>
                      Tags: {selectedTaxonomyIds.length}
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
              <p className="text-2xl font-semibold tracking-tight text-stone-900">What do you need help with?</p>
            </div>
            <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleChipClick(chip.prompt)}
                  disabled={isLoading || quotaRemaining === 0}
                  className="min-h-[54px] rounded-2xl border border-orange-200 bg-white/95 px-4 py-3 text-left text-sm font-medium text-stone-800 shadow-sm transition-all hover:-translate-y-0.5 hover:border-rose-300 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                  ? 'rounded-[24px] rounded-tr-md bg-gradient-to-br from-rose-500 to-orange-500 px-4 py-3 text-sm text-white shadow-[0_18px_40px_rgba(249,115,22,0.24)]'
                  : 'rounded-[24px] rounded-tl-md border border-orange-100/90 bg-white/96 px-4 py-3 text-sm text-stone-800 shadow-[0_12px_32px_rgba(234,88,12,0.08)]'
              }`}
            >
              <p>{msg.content}</p>
              {msg.role === 'assistant' && (
                <div className="space-y-2 mt-2">
                  {(msg as AssistantMessage).resultSummary && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50/90 px-3 py-2.5 text-xs text-rose-950">
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
                    <div className="rounded-2xl border border-orange-200 bg-orange-50/90 px-3 py-2.5 text-xs text-orange-900">
                      <p className="font-medium">Refine this search</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(msg as AssistantMessage).clarification?.suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => handleChipClick(suggestion)}
                            disabled={isLoading || quotaRemaining === 0}
                            className="rounded-full border border-orange-200 bg-white px-2.5 py-1 text-[11px] font-medium text-orange-900 disabled:opacity-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {((msg as AssistantMessage).followUpSuggestions?.length ?? 0) > 0 && !(msg as AssistantMessage).clarification && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 px-3 py-2.5 text-xs text-emerald-950">
                      <p className="font-medium">Next refinements</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(msg as AssistantMessage).followUpSuggestions?.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => handleChipClick(suggestion)}
                            disabled={isLoading || quotaRemaining === 0}
                            className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-900 disabled:opacity-50"
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
                    className="border-orange-100 bg-orange-50"
                  />
                  {(msg as AssistantMessage).services!.map((card) => (
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
              <span className={`block text-[10px] mt-1 select-none ${
                msg.role === 'user' ? 'text-orange-100 text-right' : 'text-stone-400'
              }`}>{formatTime(msg.timestamp)}</span>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-[22px] rounded-tl-md border border-orange-100 bg-white/95 px-4 py-3 shadow-sm">
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
        className="border-t border-amber-200/80 bg-gradient-to-b from-amber-50 to-orange-50 px-4 py-2.5 text-xs text-amber-800"
        role="note"
        aria-label="Eligibility disclaimer"
      >
        {ELIGIBILITY_DISCLAIMER}
      </div>

      {/* Input */}
      <div className="border-t border-orange-100/80 bg-gradient-to-b from-white to-orange-50/60 p-3 md:p-4">
        {quotaRemaining <= 5 && quotaRemaining > 0 && (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-xs text-amber-900 shadow-sm">
            <p className="font-medium">Low message budget</p>
            <p className="mt-1">You can keep this search scope and continue in Directory or Map if needed.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={_directoryHandoffHref} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 shadow-sm">
                Open Directory
              </a>
              <a href={_mapHandoffHref} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 shadow-sm">
                Open Map
              </a>
            </div>
          </div>
        )}
        <div className="rounded-[24px] border border-orange-100 bg-white/95 p-2 shadow-[0_12px_32px_rgba(234,88,12,0.08)]">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoResize(e.target); }}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you need help with..."
              className="min-h-[48px] flex-1 resize-none rounded-[18px] border border-orange-200 bg-orange-50/50 px-3 py-3 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-orange-400"
              rows={1}
              aria-label="Chat message input"
              disabled={isLoading || quotaRemaining === 0}
            />
            <Button
              onClick={() => void sendMessage()}
              disabled={isLoading || !input.trim() || quotaRemaining === 0}
              size="icon"
              aria-label="Send message"
              className="min-h-[48px] min-w-[48px] rounded-2xl bg-orange-500 shadow-sm hover:bg-orange-600"
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
              <a href={_directoryHandoffHref} className="rounded-full border border-red-200 bg-white px-2.5 py-1 font-medium text-red-700 shadow-sm">
                Open Directory
              </a>
              <a href={_mapHandoffHref} className="rounded-full border border-red-200 bg-white px-2.5 py-1 font-medium text-red-700 shadow-sm">
                Open Map
              </a>
              <button
                type="button"
                onClick={_startNewSession}
                className="rounded-full border border-red-200 bg-white px-2.5 py-1 font-medium text-red-700 shadow-sm"
              >
                Start new chat session
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatWindow;
