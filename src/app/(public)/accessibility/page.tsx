import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

const LAST_EVALUATED_ISO = '2026-03-13';
const LAST_EVALUATED_DISPLAY = 'March 13, 2026';

export const metadata: Metadata = {
  title: 'Accessibility Statement',
  description: "ORAN's commitment to accessible design and WCAG 2.1 AA conformance.",
  alternates: { canonical: '/accessibility' },
  openGraph: {
    title: 'Accessibility Statement — ORAN',
    description: "ORAN's commitment to accessible design and WCAG 2.1 AA conformance.",
    url: `${SITE.baseUrl}/accessibility`,
    type: 'website',
  },
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
    issue: 'Map component (Azure Maps)',
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
      <div className="mb-10 border-b border-[var(--border)] pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)]">
          <span className="text-xl" aria-hidden="true">♿</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          Accessibility Statement
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Last evaluated: <time dateTime={LAST_EVALUATED_ISO}>{LAST_EVALUATED_DISPLAY}</time>
        </p>
      </div>

      {/* Introduction */}
      <section className="mb-10">
        <p className="leading-relaxed text-[var(--text-secondary)]">
          ORAN is committed to making this platform accessible to everyone, including people with
          disabilities. We target conformance with the{' '}
          <a
            href="https://www.w3.org/TR/WCAG21/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--text-primary)] underline hover:text-[var(--text-secondary)]"
          >
            Web Content Accessibility Guidelines (WCAG) 2.1
          </a>{' '}
          at Level AA. Accessibility is a functional requirement, not an afterthought.
        </p>
      </section>

      {/* Conformance status */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Conformance status</h2>
        <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)] px-5 py-4">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Target: WCAG 2.1 Level AA — Partial conformance (active improvement in progress)
          </p>
        </div>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          &ldquo;Partial conformance&rdquo; means some parts of the content do not yet fully conform.
          Known issues and remediation commitments are listed below.
        </p>
      </section>

      {/* Technical approach */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Technical approach</h2>
        <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
          {TECHNICAL_APPROACH.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-[var(--text-primary)]" aria-hidden="true">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Testing matrix */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Tested against</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TESTING_MATRIX.map(({ tool, type }) => (
            <div
              key={tool}
              className="rounded border border-[var(--border)] bg-[var(--bg-surface-alt)] px-4 py-3"
            >
              <p className="text-sm font-medium text-[var(--text-primary)]">{tool}</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{type}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Known issues */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Known issues</h2>
        <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)] px-5 py-3 text-sm text-[var(--text-secondary)]">
          This section is updated after each accessibility audit. Remediation timelines are best-effort.
        </div>
        <div className="space-y-3">
          {KNOWN_ISSUES.map(({ issue, detail, severity }) => (
            <div key={issue} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm font-medium text-[var(--text-primary)]">{issue}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    severity === 'Medium'
                        ? 'border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                      : 'border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]'
                  }`}
                >
                  {severity}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Third-party content */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Third-party content</h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          ORAN embeds third-party components including map tiles and authentication widgets. These
          components are outside our direct control. We select third-party services with an eye
          toward their own accessibility commitments and work to mitigate gaps where possible.
        </p>
      </section>

      {/* Feedback */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
          Feedback and accommodation requests
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          If you experience an accessibility barrier or need content in an alternative format,
          please let us know. We aim to acknowledge accessibility requests within 5 business days.
        </p>
        <Link
          href="/contact"
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--text-primary)] bg-[var(--text-primary)] px-4 py-2 text-sm font-medium text-[var(--bg-page)] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--text-muted)] focus:ring-offset-2"
        >
          Contact us about accessibility
        </Link>
      </section>

      {/* External resources */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Accessibility resources</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <a
            href="https://www.w3.org/TR/WCAG21/"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]"
          >
            <div>
              <p className="font-medium text-[var(--text-primary)]">WCAG 2.1 Guidelines</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">W3C — official specification</p>
            </div>
            <span className="shrink-0 text-[var(--text-muted)]" aria-hidden="true">↗</span>
          </a>
          <a
            href="https://webaim.org/resources/contrastchecker/"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]"
          >
            <div>
              <p className="font-medium text-[var(--text-primary)]">WebAIM Contrast Checker</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">Color contrast verification tool</p>
            </div>
            <span className="shrink-0 text-[var(--text-muted)]" aria-hidden="true">↗</span>
          </a>
          <a
            href="https://www.deque.com/axe/devtools/"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]"
          >
            <div>
              <p className="font-medium text-[var(--text-primary)]">axe DevTools</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">Browser extension for a11y auditing</p>
            </div>
            <span className="shrink-0 text-[var(--text-muted)]" aria-hidden="true">↗</span>
          </a>
          <a
            href="https://www.nvaccess.org/download/"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]"
          >
            <div>
              <p className="font-medium text-[var(--text-primary)]">NVDA Screen Reader</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">Free Windows screen reader (NV Access)</p>
            </div>
            <span className="shrink-0 text-[var(--text-muted)]" aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      {/* Footer note */}
      <div className="mb-8 border-t border-[var(--border)] pt-6 text-xs text-[var(--text-secondary)]">
        This statement was last evaluated on{' '}
        <time dateTime={LAST_EVALUATED_ISO}>{LAST_EVALUATED_DISPLAY}</time>. It is updated
        when evaluations are refreshed or known issues change.
      </div>

      {/* Related policies */}
      <nav aria-label="Related policies" className="border-t border-[var(--border)] pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Related</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/terms" className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]">
            <span className="font-medium text-[var(--text-primary)]">Terms of Use</span>
            <span className="text-[var(--text-muted)]" aria-hidden="true">→</span>
          </Link>
          <Link href="/privacy" className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]">
            <span className="font-medium text-[var(--text-primary)]">Privacy Policy</span>
            <span className="text-[var(--text-muted)]" aria-hidden="true">→</span>
          </Link>
          <Link href="/contact" className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]">
            <span className="font-medium text-[var(--text-primary)]">Contact us</span>
            <span className="text-[var(--text-muted)]" aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
