import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageCircle, List, MapPin, Shield, Building2, Users, ArrowRight, Search, CheckCircle2, Zap, Globe, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppNav } from '@/components/nav/AppNav';
import { AppFooter } from '@/components/footer';

const BASE_URL = 'https://openresourceaccessnetwork.com';

export const metadata: Metadata = {
  title: 'ORAN — Open Resource Access Network',
  description:
    'Find verified government, nonprofit, and community services near you. Real, confirmed records — structured, searchable, and maintained by real people.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'ORAN — Open Resource Access Network',
    description: 'Find verified government, nonprofit, and community services near you.',
    url: BASE_URL,
    type: 'website',
  },
};

/** JSON-LD Organization schema for the landing page */
const orgSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Open Resource Access Network',
  url: BASE_URL,
  description:
    'A civic-grade platform for locating verified government, nonprofit, and community services.',
};

/** JSON-LD WebSite schema — enables Google Sitelinks Search Box */
const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Open Resource Access Network',
  url: BASE_URL,
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${BASE_URL}/directory?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
};

// ── Browse-by-need category chips ───────────────────────────
const CATEGORIES = [
  { label: 'Food & Nutrition',       href: '/directory?q=food+nutrition' },
  { label: 'Housing & Shelter',      href: '/directory?q=housing+shelter' },
  { label: 'Mental Health',          href: '/directory?q=mental+health' },
  { label: 'Healthcare',             href: '/directory?q=healthcare+medical' },
  { label: 'Crisis Support',         href: '/directory?q=crisis+support' },
  { label: 'Employment',             href: '/directory?q=employment+jobs' },
  { label: 'Legal Aid',              href: '/directory?q=legal+aid' },
  { label: 'Financial Assistance',   href: '/directory?q=financial+assistance' },
  { label: 'Child & Family',         href: '/directory?q=children+family' },
  { label: 'Disability Services',    href: '/directory?q=disability+services' },
  { label: 'Veteran Services',       href: '/directory?q=veteran+services' },
  { label: 'Substance Use',          href: '/directory?q=substance+use+recovery' },
] as const;

// ── Per-audience feature data ────────────────────────────────

const SEEKER_FEATURES: Array<{ icon: React.ElementType; title: string; body: string }> = [
  {
    icon: Search,
    title: 'Natural language search',
    body: 'Type what you need in plain words. ORAN maps your query to structured service records across hundreds of verified categories.',
  },
  {
    icon: MapPin,
    title: 'Location-aware results',
    body: 'Results ranked by proximity. Your approximate location is never stored or shared without your explicit consent.',
  },
  {
    icon: Shield,
    title: 'Verified records only',
    body: 'Every phone number, address, and service detail comes from a confirmed, structured source record — reviewed and dated.',
  },
  {
    icon: CheckCircle2,
    title: 'No account required',
    body: 'Start immediately. No sign-up, no paywall, no data collection beyond what helps you find services.',
  },
];

const ORG_FEATURES: Array<{ icon: React.ElementType; title: string; body: string }> = [
  {
    icon: Building2,
    title: 'Self-service host portal',
    body: 'Create and manage your listings through a dedicated portal. Changes flow through a structured review process before going live.',
  },
  {
    icon: Shield,
    title: 'Source provenance tracking',
    body: 'Every record carries a verifiable provenance trail — origin, last verification date, and a live confidence score.',
  },
  {
    icon: Users,
    title: 'Community-backed verification',
    body: 'Service changes enter a review workflow where community admins verify updates — protecting data integrity without burdening your staff.',
  },
  {
    icon: Zap,
    title: 'Multi-surface discoverability',
    body: 'Once published, listings are immediately reachable via search, guided chat, directory browse, and map — no extra integrations needed.',
  },
];

const PARTNER_FEATURES: Array<{ icon: React.ElementType; title: string; body: string }> = [
  {
    icon: CheckCircle2,
    title: 'Structured verification queue',
    body: 'Volunteer admins work through a curated queue of records flagged for confidence decay, unverified submissions, or local coverage gaps.',
  },
  {
    icon: Database,
    title: '211 & HSDS data federation',
    body: 'ORAN ingests and normalizes 211-standard and HSDS feeds. Community contributors maintain quality across federated sources.',
  },
  {
    icon: Globe,
    title: 'Fully open platform',
    body: 'Built for transparency. Every scoring model, ingestion pipeline, and matching rule is documented and inspectable by the community that depends on it.',
  },
  {
    icon: MessageCircle,
    title: 'Dedicated admin tooling',
    body: 'Volunteer admins and community reviewers access a purpose-built portal for claims, submissions, flag review, and coverage management.',
  },
];

// ── Competitive differentiators ──────────────────────────────
const WHY_ORAN = [
  {
    label: 'vs. generic chatbots',
    title: 'Reliable by design',
    body: 'ORAN only surfaces records that exist in its verified database. No invented contact details, no fabricated service hours — ever.',
  },
  {
    label: 'vs. search engines',
    title: 'Structured & eligibility-aware',
    body: 'Search engines surface pages. ORAN surfaces structured records — hours, eligibility, contact details, and a confidence score.',
  },
  {
    label: 'vs. stale 211 databases',
    title: 'Continuously re-verified',
    body: 'Traditional databases go stale between update cycles. ORAN flags confidence decay and routes verification work to community admins.',
  },
  {
    label: 'vs. proprietary directories',
    title: 'Transparent & auditable',
    body: 'No black boxes. Anyone can inspect how records are scored, how data flows, and how the matching logic works.',
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-page)]">
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema).replace(/</g, '\\u003c') }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema).replace(/</g, '\\u003c') }}
      />

      <AppNav />

      <main id="main-content" tabIndex={-1} className="flex-1">

        {/* ══ HERO ══════════════════════════════════════════════ */}
        <section className="border-b border-[var(--border)] bg-white px-4 py-14 sm:py-24 md:py-32 text-center">
          <div className="mx-auto max-w-3xl">
            {/* Identity badge */}
            <div className="mb-5 sm:mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" aria-hidden="true" />
              Community-verified &middot; Always free
            </div>

            <h1 className="mb-4 font-display text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-5xl lg:text-6xl leading-tight">
              Find verified services<br className="hidden sm:block" /> for real needs
            </h1>

            <p className="mb-7 sm:mb-10 text-base sm:text-lg leading-relaxed text-[var(--text-secondary)] max-w-xl mx-auto">
              ORAN connects people to confirmed government, nonprofit, and community programs.
              Every record is structured, sourced, and reviewed — so the results you see are real.
            </p>

            {/* Search form */}
            <form
              action="/directory"
              method="get"
              role="search"
              aria-label="Search community services"
              className="mb-6 flex max-w-2xl mx-auto items-stretch overflow-hidden rounded-xl shadow-sm ring-1 ring-[var(--border)]"
            >
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  name="q"
                  placeholder="Food assistance, housing, mental health…"
                  aria-label="Search for a service or need"
                  className="h-full w-full border-0 bg-white py-4 pl-11 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-0"
                />
              </div>
              <button
                type="submit"
                className="flex-shrink-0 border-l border-[var(--border)] bg-white px-5 sm:px-8 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--text-muted)]"
              >
                Search
              </button>
            </form>

            {/* Quick-access pills */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <span className="text-xs text-[var(--text-muted)]">or explore</span>
              <Link
                href="/directory"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-gray-50 hover:text-[var(--text-primary)]"
              >
                <List className="h-3.5 w-3.5" aria-hidden="true" />
                Directory
              </Link>
              <Link
                href="/map"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-gray-50 hover:text-[var(--text-primary)]"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                Map view
              </Link>
            </div>
          </div>
        </section>

        {/* ══ BROWSE BY NEED ══════════════════════════════════════ */}
        <section className="border-b border-[var(--border)] bg-white px-4 py-6 sm:py-8">
          <div className="mx-auto max-w-4xl">
            <p className="mb-4 text-center text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Browse by need
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {CATEGORIES.map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-1.5 text-sm font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-page)] hover:text-[var(--text-primary)]"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ══ SEEKERS ══════════════════════════════════════════════ */}
        <section className="bg-[var(--bg-page)] px-4 py-12 sm:py-20 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto mb-8 sm:mb-12 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                For individuals seeking help
              </p>
              <h2 className="mb-4 text-2xl font-bold text-[var(--text-primary)] sm:text-3xl md:text-4xl">
                Real answers, fast
              </h2>
              <p className="leading-relaxed text-[var(--text-secondary)]">
                When accuracy matters — and with services it always does — ORAN retrieves real,
                verified records and presents them clearly. No guesswork, no stale data.
              </p>
            </div>

            <div className="mb-10 grid grid-cols-1 gap-8 sm:grid-cols-2">
              {SEEKER_FEATURES.map((f) => (
                <FeatureTile key={f.title} icon={f.icon} title={f.title} body={f.body} />
              ))}
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" variant="outline" className="gap-2 text-[var(--text-primary)]">
                <Link href="/chat">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Find services with chat
                </Link>
              </Button>
              <Link
                href="/directory"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-2.5 text-sm font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
              >
                <List className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                Browse directory
              </Link>
              <Link
                href="/map"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-2.5 text-sm font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
              >
                <MapPin className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                View map
              </Link>
            </div>
          </div>
        </section>

        {/* ══ ORGANIZATIONS ════════════════════════════════════════ */}
        <section className="border-y border-[var(--border)] bg-white px-4 py-12 sm:py-20 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto mb-8 sm:mb-12 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                For service providers &amp; nonprofits
              </p>
              <h2 className="mb-4 text-2xl font-bold text-[var(--text-primary)] sm:text-3xl md:text-4xl">
                Get discovered. Stay verified. Build trust.
              </h2>
              <p className="leading-relaxed text-[var(--text-secondary)]">
                ORAN gives organizations a dedicated portal to manage listings, build
                provenance-backed credibility, and reach people actively searching for their
                programs — without proprietary lock-in.
              </p>
            </div>

            <div className="mb-10 grid grid-cols-1 gap-8 sm:grid-cols-2">
              {ORG_FEATURES.map((f) => (
                <FeatureTile key={f.title} icon={f.icon} title={f.title} body={f.body} />
              ))}
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/partnerships/organizations"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--text-primary)] bg-white px-6 py-2.5 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:bg-gray-50"
              >
                List your organization
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/about"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-2.5 text-sm font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-page)] hover:text-[var(--text-primary)]"
              >
                Learn more
              </Link>
            </div>
          </div>
        </section>

        {/* ══ COMMUNITY PARTNERS ═══════════════════════════════════ */}
        <section className="border-b border-[var(--border)] bg-[var(--bg-page)] px-4 py-12 sm:py-20 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto mb-8 sm:mb-12 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                For community contributors &amp; admins
              </p>
              <h2 className="mb-4 text-2xl font-bold text-[var(--text-primary)] sm:text-3xl md:text-4xl">
                Help build the civic data layer
              </h2>
              <p className="leading-relaxed text-[var(--text-secondary)]">
                ORAN is only as good as the people maintaining it. Community partners — volunteer
                admins, civic technologists, and local advocates — are how verified data stays
                accurate at scale.
              </p>
            </div>

            <div className="mb-10 grid grid-cols-1 gap-8 sm:grid-cols-2">
              {PARTNER_FEATURES.map((f) => (
                <FeatureTile key={f.title} icon={f.icon} title={f.title} body={f.body} />
              ))}
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/partnerships/admins"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--text-primary)] bg-white px-6 py-2.5 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:bg-gray-50"
              >
                Become a volunteer admin
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/partnerships"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-2.5 text-sm font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
              >
                Explore all partnerships
              </Link>
            </div>
          </div>
        </section>

        {/* ══ WHY ORAN ══════════════════════════════════════════════ */}
        <section className="bg-[var(--bg-surface)] px-4 py-12 sm:py-20 md:py-24">
          <div className="mx-auto max-w-4xl">
            <div className="mx-auto mb-8 sm:mb-12 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                Why ORAN
              </p>
              <h2 className="mb-4 text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
                Built for the gaps other tools leave open
              </h2>
              <p className="leading-relaxed text-[var(--text-secondary)]">
                Generic search returns pages, not answers. Unverified directories go stale.
                ORAN is purpose-built for the problem they all fall short on.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {WHY_ORAN.map(({ label, title, body }) => (
                <div
                  key={label}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-page)] p-6"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {label}
                  </p>
                  <h3 className="mb-2 text-base font-semibold text-[var(--text-primary)]">{title}</h3>
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ MISSION STRIP ══════════════════════════════════════════ */}
        <section className="border-t border-[var(--border)] bg-white px-4 py-12 text-center sm:py-20 md:py-28">
          <div className="mx-auto max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Our commitment
            </p>
            <h2 className="mb-4 font-display text-2xl font-bold text-[var(--text-primary)] sm:text-3xl md:text-4xl">
              Community-governed.<br className="hidden sm:block" /> Free to use. Built to last.
            </h2>
            <p className="mb-7 sm:mb-10 text-base sm:text-lg leading-relaxed text-[var(--text-secondary)]">
              ORAN is built on the principle that verified resource access should never be gated
              behind a paywall. WCAG 2.1 AA accessible, continuously maintained, and free for
              every person who needs it.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="/about"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--text-primary)] bg-white px-6 py-3 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[var(--text-muted)] focus:ring-offset-2"
              >
                Learn about our mission
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/partnerships/organizations"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-6 py-3 text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-page)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--text-muted)] focus:ring-offset-2"
              >
                Partner with us
              </Link>
            </div>
          </div>
        </section>

      </main>

      <AppFooter />
    </div>
  );
}

/* ── Helper component ──────────────────────────────────────── */

function FeatureTile({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
        <Icon className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-[var(--text-secondary)]">{body}</p>
      </div>
    </div>
  );
}
