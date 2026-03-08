import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About ORAN',
  description:
    'Learn about the Open Resource Access Network — a civic-grade platform connecting people to verified government, nonprofit, and community services.',
};

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
];

export default function AboutPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {/* Hero */}
      <div className="mb-10 border-b border-gray-200 pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-50">
          <span className="text-xl" aria-hidden="true">🌐</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">
          Open Resource Access Network
        </h1>
        <p className="max-w-2xl text-xl leading-relaxed text-gray-600">
          Connecting people to verified services — real help, real fast.
        </p>
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

      {/* How it works */}
      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">How it works</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {HOW_IT_WORKS.map(({ step, title, body }) => (
            <div
              key={step}
              className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-5"
            >
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
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
              <span className="mt-1 shrink-0 text-lg text-indigo-400" aria-hidden="true">
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
      </section>

      {/* Platform at a glance */}
      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">Platform at a glance</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {PLATFORM_STATS.map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg border border-gray-200 bg-white px-4 py-5 text-center"
            >
              <p className="text-xl font-bold text-indigo-600">{value}</p>
              <p className="mt-1 text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Get involved */}
      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">Get involved</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link
            href="/"
            className="group rounded-lg border border-gray-200 bg-white px-5 py-5 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
          >
            <p className="mb-1 font-semibold text-gray-900 group-hover:text-indigo-700">
              Get Help
            </p>
            <p className="text-sm text-gray-500">Search verified services near you.</p>
          </Link>
          <Link
            href="/partnerships"
            className="group rounded-lg border border-gray-200 bg-white px-5 py-5 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
          >
            <p className="mb-1 font-semibold text-gray-900 group-hover:text-indigo-700">
              List Your Organization
            </p>
            <p className="text-sm text-gray-500">Add your services to the directory.</p>
          </Link>
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-lg border border-gray-200 bg-white px-5 py-5 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
          >
            <p className="mb-1 font-semibold text-gray-900 group-hover:text-indigo-700">
              Contribute
            </p>
            <p className="text-sm text-gray-500">Open source on GitHub. PRs welcome.</p>
          </a>
        </div>
      </section>

      {/* Open source banner */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Open source</p>
          <p className="mt-0.5 text-xs text-gray-500">MIT licensed · Auditable · Community-driven</p>
        </div>
        <a
          href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          View on GitHub →
        </a>
      </div>
    </div>
  );
}
