import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Get Involved',
  description:
    'List your organization, partner institutionally, donate, or become a community administrator. Every role that keeps real help findable.',
  alternates: { canonical: '/partnerships' },
  openGraph: {
    title: 'Get Involved — ORAN',
    description: 'List your organization, partner institutionally, donate, or become a community administrator. Every role that keeps real help findable.',
    url: `${SITE.baseUrl}/partnerships`,
    type: 'website',
  },
};

interface Track {
  icon: string;
  title: string;
  subtitle: string;
  href: string;
  external?: boolean;
  ctaLabel: string;
  color: 'indigo' | 'blue' | 'amber' | 'green';
}

const TRACKS: Track[] = [
  {
    icon: '🏢',
    title: 'List Your Organization',
    subtitle: 'Service providers, nonprofits, and agencies',
    href: '/partnerships/organizations',
    ctaLabel: 'Learn how to list →',
    color: 'indigo',
  },
  {
    icon: '🔗',
    title: 'Institutional Partner',
    subtitle: 'Hospitals, libraries, 211 networks, governments',
    href: '/contact',
    ctaLabel: 'Inquire now →',
    color: 'blue',
  },
  {
    icon: '🛡️',
    title: 'Become a Community Admin',
    subtitle: 'Verify listings and maintain your local zone',
    href: '/partnerships/admins',
    ctaLabel: 'See the role →',
    color: 'green',
  },
  {
    icon: '💛',
    title: 'Donate',
    subtitle: 'Fund verification, infrastructure, and development',
    href: '/contact',
    ctaLabel: 'Express interest →',
    color: 'amber',
  },
];

interface Detail {
  icon: string;
  title: string;
  description: string;
  highlights: string[];
  ctaLabel: string;
  ctaHref: string;
  ctaExternal?: boolean;
  ctaSecondary?: { label: string; href: string; external?: boolean };
  color: 'indigo' | 'blue' | 'amber' | 'green';
}

const DETAILS: Detail[] = [
  {
    icon: '🏢',
    title: 'List Your Organization',
    description:
      'Make your services discoverable to people who need them most. Listings are free, community-verified, and reach seekers actively looking for help in your area.',
    highlights: [
      'Free to list — no subscription required',
      'Community-verified for accuracy and ongoing data freshness',
      'Eligible for confidence scoring and elevated placement',
    ],
    ctaLabel: 'Claim your organization',
    ctaHref: '/partnerships/organizations',
    color: 'indigo',
  },
  {
    icon: '🔗',
    title: 'Institutional Partnerships',
    description:
      'Hospitals, libraries, schools, 211 networks, and government agencies — partner with ORAN to expand coverage, improve data freshness, and reach more people.',
    highlights: [
      'Structured data sharing and ingestion agreements',
      'White-label and co-branded portal options',
      'Priority verification queuing for partner organizations',
    ],
    ctaLabel: 'Inquire now',
    ctaHref: '/contact',
    color: 'blue',
  },
  {
    icon: '🛡️',
    title: 'Become a Community Admin',
    description:
      'Community administrators are the backbone of ORAN\'s verification model. Work your local zone — approve listings, verify records, and keep data accurate.',
    highlights: [
      'Approve, deny, or escalate org submissions in your zone',
      'Access the review queue, dashboard, and verification tools',
      'No minimum hours — contribute at the pace that suits you',
    ],
    ctaLabel: 'Learn about the role',
    ctaHref: '/partnerships/admins',
    ctaSecondary: {
      label: 'Apply via GitHub',
      href: 'https://github.com/AutomatedEmpires/Open-Resource-Access-Network/discussions',
      external: true,
    },
    color: 'green',
  },
  {
    icon: '💛',
    title: 'Donate',
    description:
      'Support the infrastructure that keeps real help findable. Contributions fund data verification operations, server costs, and ongoing development.',
    highlights: [
      'Supports continuous data verification',
      'Funds platform reliability and uptime',
      'Enables expanded geographic service coverage',
    ],
    ctaLabel: 'Express interest',
    ctaHref: '/contact',
    color: 'amber',
  },
];

const colorMap: Record<
  'indigo' | 'blue' | 'amber' | 'green',
  { border: string; trackBg: string; trackAccent: string; activeCta: string; focusRing: string }
> = {
  indigo: {
    border: 'border-gray-200',
    trackBg: 'bg-gray-50',
    trackAccent: 'text-gray-700',
    activeCta: 'bg-gray-900 text-white hover:bg-gray-800 focus:ring-gray-500',
    focusRing: 'focus:ring-gray-400',
  },
  blue: {
    border: 'border-gray-200',
    trackBg: 'bg-gray-50',
    trackAccent: 'text-gray-700',
    activeCta: 'bg-gray-900 text-white hover:bg-gray-800 focus:ring-gray-500',
    focusRing: 'focus:ring-gray-400',
  },
  amber: {
    border: 'border-gray-200',
    trackBg: 'bg-gray-50',
    trackAccent: 'text-gray-700',
    activeCta: 'bg-gray-900 text-white hover:bg-gray-800 focus:ring-gray-500',
    focusRing: 'focus:ring-gray-400',
  },
  green: {
    border: 'border-gray-200',
    trackBg: 'bg-gray-50',
    trackAccent: 'text-gray-700',
    activeCta: 'bg-gray-900 text-white hover:bg-gray-800 focus:ring-gray-500',
    focusRing: 'focus:ring-gray-400',
  },
};

export default function PartnershipsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <header className="mb-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-gray-50">
              <span className="text-xl" aria-hidden="true">🤝</span>
            </div>
            <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">Get Involved</h1>
            <p className="max-w-md text-base leading-relaxed text-gray-600">
              ORAN is a civic network powered by real organizations and real people. Choose your path below.
            </p>
          </div>
          {/* Quick stats — right column */}
          <div className="flex shrink-0 flex-col gap-3 sm:items-end">
            <div className="flex gap-4 rounded-xl border border-gray-100 bg-gray-50 px-5 py-4">
              <div className="text-center">
                <p className="text-xl font-bold text-gray-900">30+</p>
                <p className="text-xs text-gray-500">Categories</p>
              </div>
              <div className="w-px bg-gray-200" />
              <div className="text-center">
                <p className="text-xl font-bold text-gray-900">Free</p>
                <p className="text-xs text-gray-500">To list</p>
              </div>
              <div className="w-px bg-gray-200" />
              <div className="text-center">
                <p className="text-xl font-bold text-gray-900">MIT</p>
                <p className="text-xs text-gray-500">Open source</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Already a partner? Portal access ────────────────── */}
      <section aria-label="Portal access" className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
          Already a partner? Access your portal
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/host"
            className="group flex items-start gap-4 rounded-xl border border-gray-200 bg-gray-50 px-5 py-5 transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
          >
            <span className="mt-0.5 shrink-0 text-2xl" aria-hidden="true">🏢</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">Host Portal</p>
              <p className="mt-1 text-xs text-gray-500">
                Dashboard · Profile · Services · Locations · Team · Resource Studio · Claims
              </p>
              <p className="mt-2 text-xs font-medium text-gray-700">Open portal →</p>
            </div>
          </Link>
          <Link
            href="/dashboard"
            className="group flex items-start gap-4 rounded-xl border border-gray-200 bg-gray-50 px-5 py-5 transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
          >
            <span className="mt-0.5 shrink-0 text-2xl" aria-hidden="true">🛡️</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">Community Admin Portal</p>
              <p className="mt-1 text-xs text-gray-500">
                Dashboard · Review Queue · Verify · Community Forms · Coverage
              </p>
              <p className="mt-2 text-xs font-medium text-gray-700">Open portal →</p>
            </div>
          </Link>
        </div>
      </section>

      {/* ── Why it matters ───────────────────────────────────── */}
      <section aria-label="Why ORAN" className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Why it matters</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { emoji: '🔍', label: 'Real retrieval only', sub: 'No AI-invented results — verified records only' },
            { emoji: '📡', label: '211-compatible', sub: 'Feeds downstream social work platforms' },
            { emoji: '🏅', label: 'Confidence scoring', sub: 'Listings ranked by verification depth' },
            { emoji: '🔒', label: 'Privacy-first', sub: 'Approximate location, no PII in telemetry' },
          ].map(({ emoji, label, sub }) => (
            <div key={label} className="flex flex-col items-center rounded-xl border border-gray-100 bg-white px-3 py-4 text-center">
              <span className="mb-2 text-xl" aria-hidden="true">{emoji}</span>
              <p className="text-xs font-semibold text-gray-900">{label}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How the system works ─────────────────────────────── */}
      <section aria-label="How ORAN works" className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">How the system works</h2>
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-6">
          {[
            { n: '1', label: 'Org submits a claim', detail: 'Organization files a structured form via the claim portal. Takes 10–20 min.' },
            { n: '2', label: 'Community admin reviews', detail: "A trained admin in the org's geographic zone verifies the submission and approves or denies." },
            { n: '3', label: 'Listing goes live', detail: 'Approved orgs appear in search, map views, and the 211-compatible API with a confidence score.' },
            { n: '4', label: 'Org maintains their record', detail: 'The host portal gives the org an authenticated workspace to update hours, services, and locations at any time.' },
          ].map(({ n, label, detail }, i, arr) => (
            <div key={n} className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                  {n}
                </span>
                {i < arr.length - 1 && <div className="mt-1 h-8 w-px bg-gray-200" />}
              </div>
              <div className="pb-4">
                <p className="text-sm font-semibold text-gray-900">{label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Track selector ───────────────────────────────────── */}
      <section aria-label="Choose your path" className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Choose your path</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {TRACKS.map(({ icon, title, subtitle, href, ctaLabel, color, external }) => {
            const c = colorMap[color];
            const linkProps = external ? { target: '_blank' as const, rel: 'noopener noreferrer' } : {};
            return (
              <Link
                key={title}
                href={href}
                {...linkProps}
                className={`group flex items-start gap-3 rounded-xl border ${c.border} ${c.trackBg} px-5 py-4 transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 ${c.focusRing}`}
              >
                <span className="mt-0.5 shrink-0 text-xl" aria-hidden="true">{icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">{title}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
                  <p className={`mt-2 text-xs font-medium ${c.trackAccent}`}>{ctaLabel}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Detail cards ─────────────────────────────────────── */}
      <section aria-label="Opportunity details" className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Details</h2>
        <div className="space-y-5">
          {DETAILS.map(({ icon, title, description, highlights, ctaLabel, ctaHref, ctaExternal, ctaSecondary, color }) => {
            const c = colorMap[color];
            const primaryProps = ctaExternal
              ? { target: '_blank' as const, rel: 'noopener noreferrer' }
              : {};
            return (
              <div
                key={title}
                id={title.toLowerCase().replace(/\s+/g, '-')}
                className={`rounded-xl border ${c.border} bg-white px-6 py-6`}
              >
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 shrink-0 text-2xl" aria-hidden="true">{icon}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                    <p className="mb-4 text-sm leading-relaxed text-gray-600">{description}</p>
                    <ul className="mb-5 space-y-1.5">
                      {highlights.map((h) => (
                        <li key={h} className="flex gap-2 text-sm text-gray-700">
                          <span className="mt-0.5 shrink-0 text-gray-700" aria-hidden="true">✓</span>
                          {h}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={ctaHref}
                        {...primaryProps}
                        className={`inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 ${c.activeCta}`}
                      >
                        {ctaLabel} →
                      </Link>
                      {ctaSecondary && (
                        <Link
                          href={ctaSecondary.href}
                          {...(ctaSecondary.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                          className="text-sm font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900"
                        >
                          {ctaSecondary.label}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── GitHub banner ────────────────────────────────────── */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Open-source contributor?</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Browse open issues, submit pull requests, or start a discussion.
          </p>
        </div>
        <a
          href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
        >
          View on GitHub →
        </a>
      </div>

      {/* ── Related nav ──────────────────────────────────────── */}
      <nav aria-label="Related pages" className="border-t border-gray-200 pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Related</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/about" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">About ORAN</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/about/team" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Team</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/contact" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Contact</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
