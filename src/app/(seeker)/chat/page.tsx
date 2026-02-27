'use client';

import { useEffect, useState } from 'react';
import { ChatWindow } from '@/components/chat/ChatWindow';

function generateSessionId(): string {
  // Use sessionStorage for persistence across refreshes within the same tab
  const key = 'oran_chat_session_id';
  const existing = typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem(key)
    : null;
  if (existing) return existing;
  // Fallback UUID generation without crypto.randomUUID (works in all browsers)
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
  const [sessionId, setSessionId] = useState<string>('');

  useEffect(() => {
    setSessionId(generateSessionId());
  }, []);

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
