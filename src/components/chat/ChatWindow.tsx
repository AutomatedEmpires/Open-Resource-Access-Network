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
          className="flex items-center gap-2 bg-white text-red-700 font-bold px-3 py-2 rounded hover:bg-red-50 transition-colors"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          Emergency: Call 911
        </a>
        <a
          href="tel:988"
          className="flex items-center gap-2 bg-white text-red-700 font-bold px-3 py-2 rounded hover:bg-red-50 transition-colors"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          Crisis Line: Call or text 988
        </a>
        <a
          href="tel:211"
          className="flex items-center gap-2 bg-white text-red-700 font-bold px-3 py-2 rounded hover:bg-red-50 transition-colors"
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setInput('');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed, timestamp: new Date() },
    ]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, sessionId, userId }),
      });

      const data: ChatResponse = await response.json();

      if (data.isCrisis) {
        setHasCrisis(true);
      }

      setQuotaRemaining(data.quotaRemaining);
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
  }, [input, isLoading, sessionId, userId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[80vh] bg-gray-50 rounded-lg border border-gray-200 shadow">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white rounded-t-lg">
        <h2 className="font-semibold text-gray-900">Find Services</h2>
        <p className="text-xs text-gray-500">
          {quotaRemaining} messages remaining
        </p>
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

        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-8">
            <p>Describe what you need help with.</p>
            <p className="text-xs mt-1">
              Results come from verified service records only.
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
                    <ChatServiceCard key={card.serviceId} card={card} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-2 shadow-sm">
              <div className="flex gap-1 items-center h-5">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
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
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px] max-h-[120px]"
            rows={1}
            aria-label="Chat message input"
            disabled={isLoading || quotaRemaining === 0}
          />
          <Button
            onClick={sendMessage}
            disabled={isLoading || !input.trim() || quotaRemaining === 0}
            size="icon"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        {quotaRemaining === 0 && (
          <p className="text-xs text-red-600 mt-1">
            Message limit reached. Start a new session to continue.
          </p>
        )}
      </div>
    </div>
  );
}

export default ChatWindow;
