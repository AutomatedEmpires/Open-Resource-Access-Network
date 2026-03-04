'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonLine } from '@/components/ui/skeleton';

function generateSessionId(): string {
  const key = 'oran_chat_session_id';
  const existing = typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem(key)
    : null;
  if (existing) return existing;
  const id = crypto.randomUUID();
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(key, id);
  }
  return id;
}

export default function ChatPage() {
  // Lazy initializer runs only in browser; returns '' during SSR (no sessionStorage)
  const [sessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return generateSessionId();
  });

  if (!sessionId) {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Find Services</h1>
        <div className="rounded-lg border border-gray-200 bg-white p-4" role="status" aria-busy="true" aria-label="Loading chat">
          <SkeletonLine className="h-5 w-40" />
          <SkeletonLine className="mt-3 h-4 w-full" />
          <SkeletonLine className="mt-2 h-4 w-2/3" />
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Find Services</h1>
      <p className="text-sm text-gray-600 mb-6">
        Searches verified service records. No sign-in required. Prefer browsing?{' '}
        <Link href="/directory" className="text-blue-600 hover:underline">
          Directory
        </Link>
        {' '}or{' '}
        <Link href="/map" className="text-blue-600 hover:underline">
          Map
        </Link>
        .
      </p>
      <ErrorBoundary>
        <ChatWindow sessionId={sessionId} />
      </ErrorBoundary>
    </main>
  );
}
