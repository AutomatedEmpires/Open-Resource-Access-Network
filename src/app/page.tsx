import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageCircle, List, MapPin, Shield, Building2, Users, ArrowRight, Search, CheckCircle2, Zap, Globe, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppNav } from '@/components/nav/AppNav';
import { ScopedMobileNav, SEEKER_MOBILE_NAV_ITEMS } from '@/components/nav/ScopedMobileNav';
import { AppFooter } from '@/components/footer';
import { ChatFirstIntakeHero } from '@/components/home/ChatFirstIntakeHero';
import { SITE, buildOrganizationJsonLd, getSameAsLinks, toSafeJsonLd } from '@/lib/site';
import { ORAN_USER_TYPES } from '@/domain/resourceNavigator';

export const metadata: Metadata = {
  title: SITE.title,
  description:
    'Tell ORAN what is happening and find a clear next step from stored government, nonprofit, and community provider records.',
  alternates: { canonical: '/' },
  openGraph: {
    title: SITE.title,
    description: SITE.description,
    url: SITE.baseUrl,
    type: 'website',
  },
};

/** JSON-LD Organization schema for the landing page */
const orgSchema = buildOrganizationJsonLd();

/** JSON-LD WebSite schema — enables Google Sitelinks Search Box */
const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE.legalName,
  alternateName: SITE.acronym,
  url: SITE.baseUrl,
  sameAs: getSameAsLinks(),
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE.baseUrl}/chat?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
};

// ── Browse-by-need category chips ───────────────────────────
const CATEGORIES = [
  { label: 'SNAP & Food Benefits',   href: '/directory?q=SNAP+food+benefits' },
  { label: 'Food Banks & Meals',     href: '/directory?q=food+banks+meal+centers' },
  { label: 'Clothing',               href: '/directory?q=clothing+bank' },
  { label: 'Rent & Housing',         href: '/directory?q=rent+housing+shelter' },
  { label: 'Electricity & Utilities', href: '/directory?q=electricity+utility+assistance' },
  { label: 'Medicaid & Health',      href: '/directory?q=Medicaid+healthcare' },
  { label: 'Mental Health',          href: '/directory?q=mental+health' },
  { label: 'Medical & Dental',       href: '/directory?q=sliding+scale+medical+dental' },
  { label: 'Urgent support',         href: '/chat?q=I+need+urgent+support' },
  { label: 'Employment',             href: '/directory?q=employment+jobs' },
  { label: 'Legal Aid',              href: '/directory?q=legal+aid' },
  { label: 'Immigration',            href: '/directory?q=immigration+services' },
  { label: 'Child & Family',         href: '/directory?q=children+family' },
  { label: 'Disability Services',    href: '/directory?q=disability+services' },
  { label: 'Veteran Services',       href: '/directory?q=veteran+services' },
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
    body: 'Every displayed fact comes from a stored provider record, with trust and freshness cues that say what is known or unknown.',
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
    title: 'Structured review queue',
    body: 'Volunteer admins work through a curated review queue of records flagged for confidence decay, unverified submissions, or local coverage gaps.',
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
    <div className="flex min-h-screen flex-col bg-[var(--bg-page)] pb-14 md:pb-0">
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toSafeJsonLd(orgSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toSafeJsonLd(websiteSchema) }}
      />

      <AppNav />

      <main id="main-content" tabIndex={-1} className="flex-1">

        {/* ══ CHAT-FIRST INTAKE ═════════════════════════════════ */}
        <ChatFirstIntakeHero />

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

        <section className="border-b border-[var(--border)] bg-slate-50 px-4 py-5" aria-labelledby="audience-scopes-heading">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <h2 id="audience-scopes-heading" className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              One network, clear scopes
            </h2>
            <div className="flex flex-wrap justify-center gap-2">
              {ORAN_USER_TYPES.map((audience) => (
                <span key={audience.id} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                  {audience.label}
                </span>
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
                stored provider records and presents them clearly. No invented facts; missing or stale details stay visible.
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
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--text-primary)] bg-white px-6 py-2.5 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--bg-surface-alt)]"
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
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--text-primary)] bg-white px-6 py-2.5 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--bg-surface-alt)]"
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
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--text-primary)] bg-white px-6 py-3 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-alt)] focus:outline-none focus:ring-2 focus:ring-[var(--text-muted)] focus:ring-offset-2"
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
      <ScopedMobileNav scopeLabel="Seeker" pathname="/" items={SEEKER_MOBILE_NAV_ITEMS} />
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
