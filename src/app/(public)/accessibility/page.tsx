import type { Metadata } from 'next';
import Link from 'next/link';

const LAST_EVALUATED_ISO = '2026-03-06';
const LAST_EVALUATED_DISPLAY = 'March 6, 2026';

export const metadata: Metadata = {
  title: 'Accessibility Statement',
  description: "ORAN's commitment to accessible design and WCAG 2.1 AA conformance.",
};

const TECHNICAL_APPROACH = [
  'Semantic HTML5 landmarks and heading hierarchy on all pages',
  'ARIA labels and roles on interactive elements (modals, menus, live regions)',
  'Skip-to-content link on every page',
  'Minimum 44×44 px touch target size on interactive controls',
  'Color is never the sole conveyor of meaning — all status indicators include text labels',
  'Focus management in modal dialogs (focus trap, return-focus on close)',
  'All form fields have associated visible labels',
  'Images include descriptive alt text; decorative images use empty alt=""',
  'No content flashes more than three times per second',
];

const TESTING_MATRIX = [
  { tool: 'NVDA (Windows)', type: 'Screen reader' },
  { tool: 'VoiceOver (macOS / iOS)', type: 'Screen reader' },
  { tool: 'Keyboard-only navigation', type: 'Interaction model' },
  { tool: 'High-contrast mode', type: 'Visual' },
  { tool: '200% browser zoom', type: 'Visual' },
  { tool: 'axe-core automated scan', type: 'Automated' },
];

const KNOWN_ISSUES = [
  {
    issue: 'Map component (Mapbox GL)',
    detail:
      'The interactive map does not currently meet keyboard-only navigation requirements. A list-view fallback is available for all map search results.',
    severity: 'Medium' as const,
  },
  {
    issue: 'Complex data tables — admin portals',
    detail:
      'Some admin-facing tables lack explicit row/column header associations. Remediation is scheduled for Q2 2026.',
    severity: 'Low' as const,
  },
];

export default function AccessibilityPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {/* Page header */}
      <div className="mb-10 border-b border-gray-200 pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-green-50">
          <span className="text-xl" aria-hidden="true">♿</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-2">
          Accessibility Statement
        </h1>
        <p className="text-sm text-gray-500">
          Last evaluated: <time dateTime={LAST_EVALUATED_ISO}>{LAST_EVALUATED_DISPLAY}</time>
        </p>
      </div>

      {/* Introduction */}
      <section className="mb-10">
        <p className="text-gray-700 leading-relaxed">
          ORAN is committed to making this platform accessible to everyone, including people with
          disabilities. We target conformance with the{' '}
          <a
            href="https://www.w3.org/TR/WCAG21/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline hover:text-indigo-800"
          >
            Web Content Accessibility Guidelines (WCAG) 2.1
          </a>{' '}
          at Level AA. Accessibility is a functional requirement, not an afterthought.
        </p>
      </section>

      {/* Conformance status */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Conformance status</h2>
        <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-4 mb-3">
          <p className="text-sm font-medium text-green-800">
            Target: WCAG 2.1 Level AA — Partial conformance (active improvement in progress)
          </p>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">
          &ldquo;Partial conformance&rdquo; means some parts of the content do not yet fully conform.
          Known issues and remediation commitments are listed below.
        </p>
      </section>

      {/* Technical approach */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Technical approach</h2>
        <ul className="space-y-2 text-sm text-gray-700">
          {TECHNICAL_APPROACH.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-green-500" aria-hidden="true">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Testing matrix */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Tested against</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TESTING_MATRIX.map(({ tool, type }) => (
            <div
              key={tool}
              className="rounded border border-gray-200 bg-gray-50 px-4 py-3"
            >
              <p className="text-sm font-medium text-gray-900">{tool}</p>
              <p className="mt-0.5 text-xs text-gray-500">{type}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Known issues */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Known issues</h2>
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
          This section is updated after each accessibility audit. Remediation timelines are best-effort.
        </div>
        <div className="space-y-3">
          {KNOWN_ISSUES.map(({ issue, detail, severity }) => (
            <div key={issue} className="rounded border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm font-medium text-gray-900">{issue}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    severity === 'Medium'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {severity}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Third-party content */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Third-party content</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          ORAN embeds third-party components including map tiles and authentication widgets. These
          components are outside our direct control. We select third-party services with an eye
          toward their own accessibility commitments and work to mitigate gaps where possible.
        </p>
      </section>

      {/* Feedback */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Feedback and accommodation requests
        </h2>
        <p className="mb-4 text-sm text-gray-700 leading-relaxed">
          If you experience an accessibility barrier or need content in an alternative format,
          please let us know. We aim to acknowledge accessibility requests within 5 business days.
        </p>
        <Link
          href="/contact"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Contact us about accessibility
        </Link>
      </section>

      {/* Footer note */}
      <div className="border-t border-gray-200 pt-6 text-xs text-gray-600">
        This statement was last evaluated on{' '}
        <time dateTime={LAST_EVALUATED_ISO}>{LAST_EVALUATED_DISPLAY}</time>. It is updated
        when evaluations are refreshed or known issues change.
      </div>
    </div>
  );
}
