/**
 * Directory Page — Server Component wrapper
 * Exports per-page metadata; delegates rendering to DirectoryPageClient.
 * Suspense required: DirectoryPageClient uses useSearchParams().
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import DirectoryPageContent from './DirectoryPageClient';
import { SkeletonCard } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Service Directory',
  description:
    'Browse and search verified government, nonprofit, and community service listings. Filter by category, confidence, and location.',
  alternates: { canonical: '/directory' },
  openGraph: {
    title: 'Service Directory | ORAN',
    description: 'Browse and search verified service listings in your area.',
    type: 'website',
  },
};

function DirectoryFallback() {
  return (
    <main className="container mx-auto max-w-6xl px-4 py-8">
      <div className="h-8 w-48 rounded bg-gray-200 animate-pulse mb-6" />
      <div className="flex gap-2 mb-6">
        <div className="flex-1 h-10 rounded-lg bg-gray-200 animate-pulse" />
        <div className="w-20 h-10 rounded-lg bg-gray-200 animate-pulse" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    </main>
  );
}

export default function DirectoryPage() {
  return (
    <Suspense fallback={<DirectoryFallback />}>
      <DirectoryPageContent />
    </Suspense>
  );
}
