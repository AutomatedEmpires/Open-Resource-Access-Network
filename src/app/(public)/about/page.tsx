import type { Metadata } from 'next';
import Link from 'next/link';
import {
  SITE,
  buildAboutPageJsonLd,
  buildOrganizationJsonLd,
  toSafeJsonLd,
} from '@/lib/site';

export const metadata: Metadata = {
  title: 'About ORAN',
  description:
    'Learn about the Open Resource Access Network — a civic-grade platform connecting people to verified government, nonprofit, and community services.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About ORAN',
    description:
      'Mission, vision, governance, and trust principles for the Open Resource Access Network.',
    url: `${SITE.baseUrl}/about`,
    type: 'article',
  },
};

const MISSION_VISION = [
  {
    title: 'Mission',
    body: SITE.mission,
  },
  {
    title: 'Vision',
    body: SITE.vision,
  },
] as const;

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Find',
    body: 'Search by what you need, your location, and eligibility. Chat or browse — both use the same verified, retrieval-only data.',
  },
  {
    step: '2',
    title: 'Verify',
    body: 'Every listing carries a confidence score. Community admins and automated checks flag stale or inaccurate records before they reach you.',
  },
  {
    step: '3',
    title: 'Connect',
    body: 'Live phone numbers, hours, and eligibility details. Save resources to your profile or share them directly.',
  },
];

const NON_NEGOTIABLES = [
  {
    title: 'Truth first',
    description:
      'Results come from stored, verified records only. No AI hallucinations — no invented phone numbers, addresses, or hours.',
  },
  {
    title: 'Crisis-first routing',
    description:
      'Any imminent-risk signal immediately surfaces 911 / 988 / 211. Safety is never deferred to the normal result flow.',
  },
  {
    title: 'Eligibility caution',
    description:
      'ORAN never guarantees eligibility. Results carry "may qualify" language — always confirm directly with the provider.',
  },
  {
    title: 'Privacy by default',
    description:
      'Location is approximate by default. Profile saving is opt-in. Our Privacy Policy details how data is collected and used.',
  },
  {
    title: 'Accessible to everyone',
    description:
      'WCAG 2.1 AA is a functional requirement. ORAN is designed to work for people with disabilities and on low-bandwidth connections.',
  },
];

const PLATFORM_STATS = [
  { label: 'Service categories', value: '30+' },
  { label: 'Verification model', value: 'Community-driven' },
  { label: 'Crisis gate', value: '911 / 988 / 211' },
  { label: 'License', value: 'MIT' },
  { label: 'WCAG conformance', value: '2.1 AA' },
  { label: 'Listing cost', value: 'Free' },
];

const DIFFERENTIATORS = [
  {
    vs: 'vs. AI chatbots',
    title: 'Zero hallucinations',
    body: 'ORAN never invents phone numbers, addresses, or service hours. Every result is retrieved from a verified, stored record — not generated on the fly.',
  },
  {
    vs: 'vs. search engines',
    title: 'Structured & eligibility-aware',
    body: 'Search engines surface pages. ORAN surfaces structured service records — with hours, eligibility criteria, contact details, and a live confidence score.',
  },
  {
    vs: 'vs. stale 211 databases',
    title: 'Continuously re-verified',
    body: 'Traditional 211 databases go stale between update cycles. ORAN flags confidence decay automatically and routes re-verification work to community admins.',
  },
  {
    vs: 'vs. proprietary directories',
    title: 'Open source & auditable',
    body: 'MIT licensed. Anyone can inspect how records are scored, how data flows through the pipeline, and how eligibility criteria are assessed — no black boxes.',
  },
];

export default function AboutPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toSafeJsonLd(buildOrganizationJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toSafeJsonLd(buildAboutPageJsonLd()) }}
      />

      {/* Hero */}
      <div className="mb-10 border-b border-gray-200 pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
          <span className="text-xl" aria-hidden="true">🌐</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">
          Open Resource Access Network
        </h1>
        <p className="max-w-2xl text-xl leading-relaxed text-gray-600">
          The verified civic directory — connecting people in need to real, confirmed government,
          nonprofit, and community services.
        </p>
        {/* Credential strip */}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          {[
            { dot: 'bg-gray-900', text: 'WCAG 2.1 AA' },
            { dot: 'bg-gray-700', text: 'MIT open source' },
            { dot: 'bg-red-500',   text: '911 / 988 / 211 crisis gate' },
            { dot: 'bg-gray-500', text: 'Free to use' },
          ].map(({ dot, text }) => (
            <span key={text} className="inline-flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
              {text}
            </span>
          ))}
        </div>
      </div>

      {/* Problem */}
      <section className="mb-12">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">The problem we solve</h2>
        <p className="mb-3 leading-relaxed text-gray-700">
          Finding real help is harder than it should be. Government benefit portals are fragmented.
          211 databases go stale. Community resources are scattered across PDFs, flyers, and word
          of mouth. When someone is in crisis, &ldquo;Google it&rdquo; is not good enough.
        </p>
        <p className="leading-relaxed text-gray-700">
          ORAN is a single, continuously verified directory of government, nonprofit, and community
          services — searchable by location, category, and eligibility — with a chat interface that
          guides people to the right resource without inventing facts.
        </p>
      </section>

      {/* Mission & vision */}
      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">Mission &amp; vision</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {MISSION_VISION.map(({ title, body }) => (
            <div key={title} className="rounded-lg border border-gray-200 bg-white px-5 py-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">{title}</p>
              <p className="text-sm leading-relaxed text-gray-700">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">How it works</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {HOW_IT_WORKS.map(({ step, title, body }) => (
            <div
              key={step}
              className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-5"
            >
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white">
                {step}
              </div>
              <h3 className="mb-1 font-semibold text-gray-900">{title}</h3>
              <p className="text-sm leading-relaxed text-gray-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Non-negotiables */}
      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">Non-negotiables</h2>
        <div className="space-y-4">
          {NON_NEGOTIABLES.map(({ title, description }) => (
            <div key={title} className="flex gap-4">
              <span className="mt-1 shrink-0 text-lg text-gray-400" aria-hidden="true">
                ✦
              </span>
              <div>
                <p className="font-medium text-gray-900">{title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Open governance */}
      <section className="mb-12">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Open governance</h2>
        <p className="mb-3 leading-relaxed text-gray-700">
          Service accuracy is maintained through a layered verification model. Organizations
          self-list and are reviewed by community administrators — trusted local experts who
          verify addresses, hours, and eligibility criteria. An automated confidence scoring
          system flags records that may have gone stale between reviews.
        </p>
        <p className="leading-relaxed text-gray-700">
          ORAN is open source. The platform code is publicly available on GitHub, enabling public
          scrutiny, community contributions, and trust through transparency.
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <Link href="/trust" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Trust Center</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/about/press" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Press &amp; Media</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <a
            href={SITE.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <span className="font-medium text-gray-900">GitHub repository</span>
            <span className="text-gray-400" aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      {/* Platform at a glance */}
      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">Platform at a glance</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {PLATFORM_STATS.map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg border border-gray-200 bg-white px-4 py-5 text-center"
            >
              <p className="text-xl font-bold text-gray-900">{value}</p>
              <p className="mt-1 text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why ORAN is different */}
      <section className="mb-12">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Why ORAN is different</h2>
        <p className="mb-5 text-sm text-gray-600 leading-relaxed">
          Existing tools fall short in different ways. ORAN is purpose-built to close each gap.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {DIFFERENTIATORS.map(({ vs, title, body }) => (
            <div
              key={vs}
              className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-5"
            >
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{vs}</p>
              <h3 className="mb-1 font-semibold text-gray-900">{title}</h3>
              <p className="text-sm leading-relaxed text-gray-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Get involved */}
      <section className="mb-12">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Get involved</h2>
        <p className="mb-5 text-sm text-gray-600 leading-relaxed">
          Whether you&apos;re seeking help, listing services, volunteering your time, or funding the
          mission — there&apos;s a path for you.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/chat"
            className="group rounded-lg border border-gray-200 bg-white px-5 py-5 transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <h3 className="mb-1 flex items-center justify-between font-semibold text-gray-900 group-hover:text-gray-900">
              Get Help <span aria-hidden="true" className="text-gray-300 group-hover:text-gray-500">→</span>
            </h3>
            <p className="text-sm text-gray-500">Search verified services near you.</p>
          </Link>
          <Link
            href="/partnerships/organizations"
            className="group rounded-lg border border-gray-200 bg-white px-5 py-5 transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <h3 className="mb-1 flex items-center justify-between font-semibold text-gray-900 group-hover:text-gray-900">
              List Your Organization <span aria-hidden="true" className="text-gray-300 group-hover:text-gray-500">→</span>
            </h3>
            <p className="text-sm text-gray-500">Add your services to the directory for free.</p>
          </Link>
          <Link
            href="/partnerships/admins"
            className="group rounded-lg border border-gray-200 bg-white px-5 py-5 transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <h3 className="mb-1 flex items-center justify-between font-semibold text-gray-900 group-hover:text-gray-900">
              Become an Admin <span aria-hidden="true" className="text-gray-300 group-hover:text-gray-500">→</span>
            </h3>
            <p className="text-sm text-gray-500">Volunteer to verify records and expand local coverage.</p>
          </Link>
          <Link
            href="/contact"
            className="group rounded-lg border border-gray-200 bg-white px-5 py-5 transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <h3 className="mb-1 flex items-center justify-between font-semibold text-gray-900 group-hover:text-gray-900">
              Support ORAN <span aria-hidden="true" className="text-gray-300 group-hover:text-gray-500">→</span>
            </h3>
            <p className="text-sm text-gray-500">Fund verification infrastructure and geographic expansion.</p>
          </Link>
          {/* GitHub — spans both columns so the grid closes evenly */}
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-lg border border-gray-200 bg-white px-5 py-5 transition-colors hover:border-gray-300 hover:bg-gray-50 sm:col-span-2"
          >
            <h3 className="mb-1 flex items-center justify-between font-semibold text-gray-900 group-hover:text-gray-900">
              Contribute on GitHub <span aria-hidden="true" className="text-gray-300 group-hover:text-gray-500">→</span>
            </h3>
            <p className="text-sm text-gray-500">Open source &middot; MIT licensed &middot; PRs welcome &middot; Issues tracked publicly.</p>
          </a>
        </div>
      </section>

      {/* Open source banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Open source</p>
          <p className="mt-0.5 text-xs text-gray-500">MIT licensed · Auditable · Community-driven</p>
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

      {/* Explore */}
      <nav aria-label="Explore ORAN" className="mt-8 border-t border-gray-200 pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Explore</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <Link href="/about/team" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Team</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/about/press" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Press</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/changelog" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Changelog</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/partnerships" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Get Involved</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
