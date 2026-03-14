import type { Metadata } from 'next';
import Link from 'next/link';
import { Github, ExternalLink } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Team — ORAN',
  description:
    'The contributors, maintainers, and community builders behind the Open Resource Access Network.',
};

interface Contributor {
  handle: string;
  role: string;
  areas: string[];
  github?: string;
}

interface ContributeArea {
  title: string;
  body: string;
}

const CORE_TEAM: Contributor[] = [
  {
    handle: 'AutomatedEmpires',
    role: 'Founder & Lead Engineer',
    areas: ['Platform architecture', 'API design', 'Infrastructure'],
    github: 'https://github.com/AutomatedEmpires',
  },
];

const HOW_TO_CONTRIBUTE: ContributeArea[] = [
  {
    title: 'Code',
    body: 'Tackle open issues, improve test coverage, or add WCAG-compliant UI components. TypeScript strict mode is enforced.',
  },
  {
    title: 'Data quality',
    body: 'Become a Community Admin and verify service records in your area. Accurate data is the most direct impact you can have.',
  },
  {
    title: 'Documentation',
    body: 'Improve the SSOT docs, translate content into Spanish or other languages, or write guides for host organizations.',
  },
  {
    title: 'Outreach',
    body: 'Connect nonprofits, government agencies, and 211 operators to ORAN. Service coverage is our most urgent growth lever.',
  },
];

const PRINCIPLES: { marker: string; label: string }[] = [
  { marker: '✦', label: 'Retrieval-first — no hallucinated facts, ever' },
  { marker: '✦', label: 'Crisis-first routing — 911 / 988 / 211 before everything' },
  { marker: '✦', label: 'Accessible by default — WCAG 2.1 AA is a requirement' },
  { marker: '✦', label: 'Privacy-first — approximate location, opt-in profile saving' },
  { marker: '✦', label: 'Open source — MIT license, public roadmap' },
];

export default function TeamPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">

      {/* Back link */}
      <Link
        href="/about"
        className="mb-8 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <span aria-hidden="true">←</span> About ORAN
      </Link>

      {/* Header */}
      <div className="mb-10 border-b border-gray-200 pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-50">
          <span className="text-xl" aria-hidden="true">👥</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">
          Team &amp; Contributors
        </h1>
        <p className="max-w-xl leading-relaxed text-gray-600">
          ORAN is an open-source project built by a small founding team and a growing community of contributors. Everyone listed here
          has helped make verified-service access more reliable for real people.
        </p>
      </div>

      {/* Core team */}
      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">Core team</h2>
        <div className="space-y-4">
          {CORE_TEAM.map((person) => (
            <div
              key={person.handle}
              className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white px-5 py-4"
            >
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-semibold text-gray-900">@{person.handle}</span>
                  {person.github && (
                    <a
                      href={person.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                      aria-label={`${person.handle} on GitHub`}
                    >
                      <Github className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
                <p className="mb-2 text-sm font-medium text-indigo-600">{person.role}</p>
                <div className="flex flex-wrap gap-2">
                  {person.areas.map((area) => (
                    <span
                      key={area}
                      className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-600"
                    >
                      {area}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Guiding principles */}
      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">What we stand for</h2>
        <p className="mb-5 leading-relaxed text-gray-600">
          Every contributor agrees to uphold these non-negotiables. They are not aspirational — they are hard constraints that guide
          every design and engineering decision.
        </p>
        <ul className="space-y-3" role="list">
          {PRINCIPLES.map(({ marker, label }) => (
            <li key={label} className="flex gap-3">
              <span className="mt-0.5 shrink-0 text-sm text-indigo-400" aria-hidden="true">{marker}</span>
              <span className="leading-relaxed text-gray-700">{label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Open source community */}
      <section className="mb-12">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Open-source community</h2>
        <p className="mb-5 leading-relaxed text-gray-600">
          ORAN is made better by every pull request, bug report, and data-quality correction. Contributors appear in commit history and
          the GitHub contributors graph. The full list of everyone who has improved this codebase lives on GitHub.
        </p>
        <a
          href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/graphs/contributors"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
        >
          <Github className="h-4 w-4" aria-hidden="true" />
          View all contributors on GitHub
          <ExternalLink className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
        </a>
      </section>

      {/* How to contribute */}
      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">Ways to contribute</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {HOW_TO_CONTRIBUTE.map(({ title, body }) => (
            <div key={title} className="rounded-lg border border-gray-200 bg-white px-5 py-4">
              <h3 className="mb-2 font-semibold text-gray-900">{title}</h3>
              <p className="text-sm leading-relaxed text-gray-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Values callout */}
      <div className="mb-12 flex items-start gap-4 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-5">
        <span className="mt-0.5 shrink-0 text-2xl" aria-hidden="true">🤝</span>
        <div>
          <p className="mb-1 font-semibold text-indigo-900">We welcome all skill levels</p>
          <p className="text-sm leading-relaxed text-indigo-800">
            Whether you are a seasoned engineer, a social-services professional, or someone who just wants to help — there is a role
            for you. Read the{' '}
            <a
              href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-600"
            >
              CONTRIBUTING.md
            </a>{' '}
            guide to get started.
          </p>
        </div>
      </div>

      {/* Governance resources */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Governance resources</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/blob/main/CONTRIBUTING.md"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <span className="font-medium text-gray-900">CONTRIBUTING.md</span>
            <span className="text-gray-400" aria-hidden="true">↗</span>
          </a>
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/blob/main/CODE_OF_CONDUCT.md"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <span className="font-medium text-gray-900">Code of Conduct</span>
            <span className="text-gray-400" aria-hidden="true">↗</span>
          </a>
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <span className="font-medium text-gray-900">GitHub Discussions</span>
            <span className="text-gray-400" aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      {/* Footer CTA */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <div>
          <p className="font-medium text-gray-900">Interested in joining?</p>
          <p className="text-sm text-gray-500">Reach us via GitHub issues or the contact page.</p>
        </div>
        <Link
          href="/contact"
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Contact us
        </Link>
      </div>

      {/* Related */}
      <nav aria-label="Related pages" className="mt-8 border-t border-gray-200 pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Related</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/about" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">About ORAN</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/about/press" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Press &amp; Media</span>
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
