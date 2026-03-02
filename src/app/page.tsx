import Link from 'next/link';
import { MessageCircle, List, MapPin, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * ORAN Landing Page
 *
 * Per docs/UI_UX_CONTRACT.md §3.4–3.5:
 * - Communicate: "resource directory searching verified records"
 * - Primary CTA: "Find services" → /chat
 * - Escape hatches: Directory + Map as first-class alternatives
 * - No sign-in required to start
 */
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* ── Minimal top bar ──────────────────────────────── */}
      <header className="border-b border-gray-200 bg-white">
        <div className="container mx-auto max-w-5xl flex items-center justify-between px-4 h-14">
          <span className="font-bold text-lg tracking-tight text-gray-900">
            ORAN
          </span>
          <Link
            href="/profile"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="max-w-xl space-y-6">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Find verified services near you
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed">
            ORAN is a <strong>resource directory</strong> that searches verified
            government, nonprofit, and community service records. No guesswork —
            only real, confirmed information.
          </p>

          {/* Primary CTA */}
          <div className="pt-2">
            <Button asChild size="lg" className="gap-2 text-base px-8">
              <Link href="/chat">
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
                Find services
              </Link>
            </Button>
          </div>

          {/* Alternative entry points */}
          <div className="flex items-center justify-center gap-4 pt-2">
            <Link
              href="/directory"
              className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
            >
              <List className="h-4 w-4" aria-hidden="true" />
              Browse directory
            </Link>
            <span className="text-gray-300" aria-hidden="true">|</span>
            <Link
              href="/map"
              className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              View map
            </Link>
          </div>
        </div>

        {/* ── Trust indicators ───────────────────────────── */}
        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-3 max-w-3xl w-full">
          <TrustCard
            icon={<Shield className="h-6 w-6 text-blue-600" aria-hidden="true" />}
            title="Verified records"
            description="Every listing is sourced from government and nonprofit databases, not generated."
          />
          <TrustCard
            icon={<MessageCircle className="h-6 w-6 text-blue-600" aria-hidden="true" />}
            title="Search naturally"
            description="Ask in your own words. ORAN matches you with real services — no hallucinated results."
          />
          <TrustCard
            icon={<MapPin className="h-6 w-6 text-blue-600" aria-hidden="true" />}
            title="Location-aware"
            description="Results are ranked by proximity. Your approximate location is never stored without consent."
          />
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-white py-6 text-center text-xs text-gray-400">
        <p>
          Open Resource Access Network · Services may have eligibility
          requirements — confirm with provider
        </p>
      </footer>
    </div>
  );
}

/* ── Helper component ──────────────────────────────────── */

function TrustCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-gray-200 bg-white p-6 text-center">
      {icon}
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
    </div>
  );
}
