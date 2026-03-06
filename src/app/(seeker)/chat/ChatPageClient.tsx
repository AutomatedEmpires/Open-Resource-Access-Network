'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonLine } from '@/components/ui/skeleton';

function generateSessionId(): string {
  const key = 'oran_chat_session_id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

export default function ChatPage() {
  // Initialised in useEffect so SSR and client first-render both produce the
  // same empty-string value, eliminating the hydration mismatch / skeleton flash.
  const [sessionId, setSessionId] = useState<string>('');

  useEffect(() => {
    // sessionStorage unavailable on SSR — initialising via effect ensures SSR and first client
    // render produce identical '' output, eliminating hydration mismatch / skeleton flash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionId(generateSessionId());
  }, []);

  if (!sessionId) {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-8">
        <PageHeader
          title="Find Services"
          subtitle="Prefer browsing? Directory or Map."
        />
        <div className="rounded-lg border border-gray-200 bg-white p-4" role="status" aria-busy="true" aria-label="Loading chat">
          <SkeletonLine className="h-5 w-40" />
          <SkeletonLine className="mt-3 h-4 w-full" />
          <SkeletonLine className="mt-2 h-4 w-2/3" />
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 pt-4 pb-4 md:py-8">
      <PageHeader
        title="Find Services"
        subtitle={
          <>
            Prefer browsing?{' '}
            <Link href="/directory" className="text-blue-600 hover:underline">Directory</Link>
            {' '}or{' '}
            <Link href="/map" className="text-blue-600 hover:underline">Map</Link>.
          </>
        }
      />
      <ErrorBoundary>
        <ChatWindow sessionId={sessionId} />
      </ErrorBoundary>
    </main>
  );
}
