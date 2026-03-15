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
    'Find verified government, nonprofit, and community services near you. Search real, confirmed service records — no hallucinated information.',
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
    body: 'Every phone number, address, and service detail is retrieved from a confirmed source record — never hallucinated by an AI.',
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
    title: 'Fully open source',
    body: 'MIT licensed and deeply auditable. Contribute to scoring models, ingestion pipelines, or UI — all in the open.',
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
    label: 'vs. AI chatbots',
    title: 'Zero hallucinations',
    body: 'ORAN never invents phone numbers, addresses, or service hours. Every result is retrieved from a verified, stored record.',
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
    title: 'Open source & auditable',
    body: 'MIT licensed. Anyone can inspect how records are scored, how data flows, and how the matching logic works.',
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
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
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4 py-12 sm:py-24 md:py-32 text-center">
          {/* Subtle grid texture */}
          <div className="pointer-events-none absolute inset-0 bg-white/5" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 opacity-30" aria-hidden="true">
            <div className="grid h-full w-full grid-cols-6 border-x border-white/10 sm:grid-cols-12">
              {Array.from({ length: 12 }).map((_, index) => (
                <div
                  key={`hero-grid-${index}`}
                  className={index < 11 ? 'hidden border-r border-white/10 sm:block' : 'hidden sm:block'}
                />
              ))}
            </div>
          </div>

          <div className="relative mx-auto max-w-3xl">
            {/* Identity badge */}
            <div className="mb-5 sm:mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-indigo-200 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden="true" />
              Open source &middot; Community-verified &middot; Always free
            </div>

            <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl leading-tight">
              Universal access to<br className="hidden sm:block" /> verified community services
            </h1>

            <p className="mb-7 sm:mb-10 text-base sm:text-lg leading-relaxed text-indigo-200 max-w-xl mx-auto">
              ORAN is the open civic platform connecting people to government, nonprofit, and
              community programs — with real-time verification, no hallucinated data, and full
              provenance transparency.
            </p>

            {/* Search form */}
            <form
              action="/directory"
              method="get"
              role="search"
              aria-label="Search community services"
              className="mb-6 flex max-w-2xl mx-auto items-stretch overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10"
            >
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  name="q"
                  placeholder="Food assistance, housing support, mental health…"
                  aria-label="Search for a service or need"
                  className="h-full w-full border-0 bg-white py-4 pl-11 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                />
              </div>
              <button
                type="submit"
                className="flex-shrink-0 bg-orange-500 px-5 sm:px-8 text-sm font-semibold text-white transition-colors hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-orange-400"
              >
                Search
              </button>
            </form>

            {/* Quick-access pills */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <span className="text-xs text-indigo-400">or explore</span>
              <Link
                href="/chat"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Guided chat
              </Link>
              <Link
                href="/directory"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                <List className="h-3.5 w-3.5" aria-hidden="true" />
                Directory
              </Link>
              <Link
                href="/map"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                Map view
              </Link>
            </div>
          </div>
        </section>

        {/* ══ BROWSE BY NEED ══════════════════════════════════════ */}
        <section className="border-b border-gray-100 bg-slate-50 px-4 py-6 sm:py-8">
          <div className="mx-auto max-w-4xl">
            <p className="mb-4 text-center text-[11px] font-semibold uppercase tracking-widest text-gray-400">
              Browse by need
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {CATEGORIES.map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex items-center rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ══ SEEKERS ══════════════════════════════════════════════ */}
        <section className="bg-white px-4 py-12 sm:py-20 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto mb-8 sm:mb-12 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-indigo-500">
                For individuals seeking help
              </p>
              <h2 className="mb-4 text-2xl font-bold text-gray-900 sm:text-3xl md:text-4xl">
                Real answers, not AI guesses
              </h2>
              <p className="leading-relaxed text-gray-500">
                When accuracy matters — and it always does — ORAN retrieves real, verified service
                records and presents them clearly. No generated content, no stale data, no guesswork.
              </p>
            </div>

            <div className="mb-10 grid grid-cols-1 gap-8 sm:grid-cols-2">
              {SEEKER_FEATURES.map((f) => (
                <FeatureTile key={f.title} icon={f.icon} title={f.title} body={f.body} />
              ))}
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="gap-2">
                <Link href="/chat">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Find services with chat
                </Link>
              </Button>
              <Link
                href="/directory"
                className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
              >
                <List className="h-4 w-4 text-gray-400" aria-hidden="true" />
                Browse directory
              </Link>
              <Link
                href="/map"
                className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
              >
                <MapPin className="h-4 w-4 text-gray-400" aria-hidden="true" />
                View map
              </Link>
            </div>
          </div>
        </section>

        {/* ══ ORGANIZATIONS ════════════════════════════════════════ */}
        <section className="border-y border-emerald-100 bg-emerald-50 px-4 py-12 sm:py-20 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto mb-8 sm:mb-12 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-600">
                For service providers &amp; nonprofits
              </p>
              <h2 className="mb-4 text-2xl font-bold text-gray-900 sm:text-3xl md:text-4xl">
                Get discovered. Stay verified. Build trust.
              </h2>
              <p className="leading-relaxed text-gray-500">
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
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                List your organization
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/about"
                className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-5 py-2.5 text-sm font-medium text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50"
              >
                Learn more
              </Link>
            </div>
          </div>
        </section>

        {/* ══ COMMUNITY PARTNERS ═══════════════════════════════════ */}
        <section className="border-b border-violet-100 bg-violet-50 px-4 py-12 sm:py-20 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto mb-8 sm:mb-12 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-violet-600">
                For community contributors &amp; admins
              </p>
              <h2 className="mb-4 text-2xl font-bold text-gray-900 sm:text-3xl md:text-4xl">
                Help build the civic data layer
              </h2>
              <p className="leading-relaxed text-gray-500">
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
                className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700"
              >
                Become a volunteer admin
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/partnerships"
                className="inline-flex items-center gap-2 rounded-md border border-violet-200 bg-white px-5 py-2.5 text-sm font-medium text-violet-700 shadow-sm transition-colors hover:bg-violet-50"
              >
                Explore all partnerships
              </Link>
            </div>
          </div>
        </section>

        {/* ══ WHY ORAN ══════════════════════════════════════════════ */}
        <section className="bg-white px-4 py-12 sm:py-20 md:py-24">
          <div className="mx-auto max-w-4xl">
            <div className="mx-auto mb-8 sm:mb-12 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                Why ORAN
              </p>
              <h2 className="mb-4 text-2xl font-bold text-gray-900 sm:text-3xl">
                Built for the gaps other tools ignore
              </h2>
              <p className="leading-relaxed text-gray-500">
                AI tools hallucinate. Search engines return pages, not answers. Legacy databases go
                stale. ORAN is purpose-built for the problem they all fail at.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {WHY_ORAN.map(({ label, title, body }) => (
                <div
                  key={label}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-indigo-500">
                    {label}
                  </p>
                  <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                  <p className="text-sm leading-relaxed text-gray-500">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ MISSION STRIP ══════════════════════════════════════════ */}
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4 py-12 text-center sm:py-20 md:py-28">
          <div className="pointer-events-none absolute inset-0 bg-white/5" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 opacity-20" aria-hidden="true">
            <div className="grid h-full w-full grid-cols-6 border-x border-white/10 sm:grid-cols-12">
              {Array.from({ length: 12 }).map((_, index) => (
                <div
                  key={`mission-grid-${index}`}
                  className={index < 11 ? 'hidden border-r border-white/10 sm:block' : 'hidden sm:block'}
                />
              ))}
            </div>
          </div>
          <div className="relative mx-auto max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-indigo-300">
              Our commitment
            </p>
            <h2 className="mb-4 text-2xl font-bold text-white sm:text-3xl md:text-4xl">
              Open source. Community-governed.<br className="hidden sm:block" /> Free to use.
            </h2>
            <p className="mb-7 sm:mb-10 text-base sm:text-lg leading-relaxed text-indigo-200">
              ORAN is MIT licensed, WCAG 2.1 AA accessible, and built on the principle that verified
              resource access should never be gated behind a paywall or dependent on a commercial
              AI&apos;s accuracy.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="/about"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-indigo-900"
              >
                Learn about our mission
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/partnerships/organizations"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-indigo-900"
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
      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-100 bg-white shadow-sm">
        <Icon className="h-4 w-4 text-gray-600" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-gray-500">{body}</p>
      </div>
    </div>
  );
}
