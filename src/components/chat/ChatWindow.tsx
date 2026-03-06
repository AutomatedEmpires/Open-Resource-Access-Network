/**
 * ORAN Chat Window Component
 *
 * Primary chat interface for service discovery.
 * Always shows: crisis banner (when triggered), eligibility disclaimer.
 * Never generates or invents service information — all data from API.
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, AlertTriangle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ELIGIBILITY_DISCLAIMER } from '@/domain/constants';
import type { ChatResponse, ServiceCard } from '@/services/chat/types';
import { ChatServiceCard } from '@/components/chat/ChatServiceCard';
import { trackInteraction } from '@/services/telemetry/sentry';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const SAVED_KEY = 'oran:saved-service-ids';

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
// LOCAL STORAGE HELPERS
// ============================================================

function readSavedIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeSavedIds(ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(ids));
  } catch {
    /* quota exceeded — fail silently */
  }
}

/** Add service to server-side saves (best-effort) */
async function addServerSaved(serviceId: string): Promise<void> {
  try {
    await fetch('/api/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    });
  } catch {
    // Best-effort
  }
}

/** Remove service from server-side saves (best-effort) */
async function removeServerSaved(serviceId: string): Promise<void> {
  try {
    await fetch('/api/saved', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    });
  } catch {
    // Best-effort
  }
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
  services?: ServiceCard[];
  isCrisis?: boolean;
}

type Message = UserMessage | AssistantMessage;

// ============================================================
// CHAT WINDOW
// ============================================================

interface ChatWindowProps {
  sessionId: string;
  userId?: string;
}

export function ChatWindow({ sessionId, userId }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState(50);
  const [hasCrisis, setHasCrisis] = useState(false);
  const [showVerifyTip, setShowVerifyTip] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Filters: trust tier + taxonomy term IDs
  const [trustFilter, setTrustFilter] = useState<TrustFilter>('all');
  const [taxonomyDialogOpen, setTaxonomyDialogOpen] = useState(false);
  const [taxonomyTerms, setTaxonomyTerms] = useState<TaxonomyTermDTO[]>([]);
  const [isLoadingTaxonomy, setIsLoadingTaxonomy] = useState(false);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [taxonomySearch, setTaxonomySearch] = useState('');
  const [selectedTaxonomyIds, setSelectedTaxonomyIds] = useState<string[]>([]);
  const hasLoadedTaxonomyRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    setSavedIds(new Set(readSavedIds()));
  }, []);

  const toggleSave = useCallback((serviceId: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
        void removeServerSaved(serviceId);
      } else {
        next.add(serviceId);
        void addServerSaved(serviceId);
      }
      writeSavedIds([...next]);
      return next;
    });
  }, []);

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

  const visibleTaxonomyTerms = React.useMemo(() => {
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

  const sendMessage = useCallback(async (override?: string) => {
    const trimmed = (override ?? input).trim();
    if (!trimmed || isLoading) return;

    trackInteraction('chat_message_sent', { quota_remaining: quotaRemaining });

    if (!override) setInput('');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed, timestamp: new Date() },
    ]);
    setIsLoading(true);

    try {
      const requestBody: Record<string, unknown> = { message: trimmed, sessionId, userId };
      const filterPayload: Record<string, unknown> = {};
      if (trustFilter !== 'all') filterPayload.trust = trustFilter;
      if (selectedTaxonomyIds.length > 0) filterPayload.taxonomyTermIds = selectedTaxonomyIds;
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

      setQuotaRemaining(data.quotaRemaining);

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
          services: data.services,
          isCrisis: data.isCrisis,
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
  }, [input, isLoading, quotaRemaining, selectedTaxonomyIds, sessionId, trustFilter, userId]);

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

  return (
    <div className="flex flex-col h-[calc(100dvh-13rem)] md:h-auto md:max-h-[80vh] bg-gray-50 rounded-lg border border-gray-200 shadow">
      {/* Header — quota indicator only (page h1 owns the title) */}
      <div className="px-4 py-2.5 border-b border-gray-200 bg-white rounded-t-lg">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Verified records only</p>
          <p className={`text-xs font-medium tabular-nums ${
            quotaRemaining <= 10 ? 'text-amber-600' : 'text-gray-400'
          }`}>
            {quotaRemaining} msg{quotaRemaining !== 1 ? 's' : ''} left
          </p>
        </div>
        {/* Quota progress bar — visible when ≤ 40 remaining */}
        {quotaRemaining <= 40 && (
          <div className="mt-1.5 h-1 w-full rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                quotaRemaining > 20
                  ? 'bg-blue-400'
                  : quotaRemaining > 10
                  ? 'bg-amber-400'
                  : 'bg-red-500'
              }`}
              style={{ width: `${(quotaRemaining / 50) * 100}%` }}
            />
          </div>
        )}

        {/* Filters */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Trust:</span>
          <div role="group" aria-label="Trust filter" className="flex flex-wrap gap-1">
            {TRUST_OPTIONS.map((opt) => {
              const selected = trustFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTrustFilter(opt.value)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors min-h-[32px] ${
                    selected
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
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
              <Button type="button" variant="outline" size="sm" className="text-xs">
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
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
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
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-4"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {/* Crisis banner shown if any message triggered crisis */}
        {hasCrisis && <CrisisBanner />}

        {showVerifyTip && !hasCrisis && (
          <div
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800"
            role="note"
            aria-label="Verification tip"
          >
            Tip: Confirm hours, eligibility requirements, and any documents needed with the provider.
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center py-6 gap-5">
            <div className="text-center">
              <p className="text-gray-800 font-medium text-base">What do you need help with?</p>
              <p className="text-xs mt-1 text-gray-400">
                Tap a topic below or type your own question.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xs mx-auto">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleChipClick(chip.prompt)}
                  disabled={isLoading || quotaRemaining === 0}
                  className="text-xs px-3 py-2 rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[36px]"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 text-center max-w-[18rem]">
              Results come from verified service records only — no personal data collected.
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] space-y-2 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-2 text-sm'
                  : 'bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-2 text-sm text-gray-800 shadow-sm'
              }`}
            >
              <p>{msg.content}</p>
              {msg.role === 'assistant' && (msg as AssistantMessage).services && (
                <div className="space-y-2 mt-2">
                  {(msg as AssistantMessage).services!.map((card) => (
                    <ChatServiceCard
                      key={card.serviceId}
                      card={card}
                      isSaved={savedIds.has(card.serviceId)}
                      onToggleSave={toggleSave}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-2 shadow-sm">
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
        className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-700"
        role="note"
        aria-label="Eligibility disclaimer"
      >
        {ELIGIBILITY_DISCLAIMER}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-200 bg-white rounded-b-lg">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you need help with..."
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] max-h-[120px]"
            rows={1}
            aria-label="Chat message input"
            disabled={isLoading || quotaRemaining === 0}
          />
          <Button
            onClick={() => void sendMessage()}
            disabled={isLoading || !input.trim() || quotaRemaining === 0}
            size="icon"
            aria-label="Send message"
            className="min-w-[44px] min-h-[44px]"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        {quotaRemaining === 0 && (
          <p className="text-xs text-red-600 mt-1" role="alert">
            Message limit reached. Start a new session to continue.
          </p>
        )}
      </div>
    </div>
  );
}

export default ChatWindow;
