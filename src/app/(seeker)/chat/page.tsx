'use client';

import { useState } from 'react';
import { ChatWindow } from '@/components/chat/ChatWindow';

function generateSessionId(): string {
  const key = 'oran_chat_session_id';
  const existing = typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem(key)
    : null;
  if (existing) return existing;
  const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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
        <div className="text-center text-gray-400 py-12">Loading...</div>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Find Services</h1>
      <ChatWindow sessionId={sessionId} />
    </main>
  );
}
