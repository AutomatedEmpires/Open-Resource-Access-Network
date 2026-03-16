/**
 * Chat Page — Server Component wrapper
 * Exports per-page metadata; delegates rendering to the client component.
 * noindex: session-specific content, not suitable for indexing.
 */
import type { Metadata } from 'next';
import ChatPageContent from './ChatPageClient';

export const metadata: Metadata = {
  title: 'Chat',
  description:
    'Chat with ORAN to search verified government, nonprofit, and community service records. Results come from stored, confirmed listings only.',
  robots: { index: false, follow: false },
};

export default function ChatPage() {
  return <ChatPageContent />;
}
