import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Changelog',
  description:
    'Public product changelog for the Open Resource Access Network — new features, improvements, and notable fixes.',
  alternates: { canonical: '/changelog' },
  openGraph: {
    title: 'Changelog — ORAN',
    description: 'Public product changelog for the Open Resource Access Network — new features, improvements, and notable fixes.',
    url: `${SITE.baseUrl}/changelog`,
    type: 'website',
  },
};

type ChangeType = 'feat' | 'fix' | 'improve' | 'security' | 'infra';

interface Change {
  type: ChangeType;
  text: string;
}

interface Release {
  version: string;
  date: string;
  summary: string;
  changes: Change[];
  highlight?: boolean;
}

const TYPE_LABELS: Record<ChangeType, { label: string; bg: string; text: string }> = {
  feat:     { label: 'New',      bg: 'bg-[var(--bg-surface-alt)]', text: 'text-[var(--text-primary)]' },
  fix:      { label: 'Fix',      bg: 'bg-[var(--bg-surface-alt)]', text: 'text-[var(--text-primary)]' },
  improve:  { label: 'Improved', bg: 'bg-[var(--bg-surface-alt)]', text: 'text-[var(--text-primary)]' },
  security: { label: 'Security', bg: 'bg-[var(--bg-surface-alt)]', text: 'text-[var(--text-primary)]' },
  infra:    { label: 'Infra',    bg: 'bg-[var(--bg-surface-alt)]', text: 'text-[var(--text-secondary)]' },
};

const RELEASES: Release[] = [
  {
    version: '0.10.0',
    date: 'March 13, 2026',
    summary: 'Team, Press, and Changelog pages; footer expanded across all role variants.',
    highlight: true,
    changes: [
      { type: 'feat',    text: 'Team page — contributor profiles, guiding principles, and open-source contribution paths.' },
      { type: 'feat',    text: 'Press page — media contact, fact sheet, brand guidelines, boilerplate, and press coverage tracking.' },
      { type: 'feat',    text: 'Changelog page — full release history with versioned entries and typed change badges.' },
      { type: 'improve', text: 'Footer — Team, Press, and Changelog linked across all four role-scoped variants.' },
    ],
  },
  {
    version: '0.9.0',
    date: 'July 2025',
    summary: 'Host portal CRUD, community admin verification workflow, and public footer pages complete.',
    highlight: false,
    changes: [
      { type: 'feat',    text: 'Host portal — organization, services, locations, team, and claim pages (full CRUD).' },
      { type: 'feat',    text: 'Community admin portal — review queue, deep-review form, and coverage dashboard.' },
      { type: 'feat',    text: 'ORAN admin portal — triage, approvals, appeals, audit, ingestion, scopes, rules, templates, and zone management.' },
      { type: 'feat',    text: 'Public footer pages — About, Privacy, Terms, Accessibility, Contact, Status, Security, Partnerships, Team, Press, and Changelog.' },
      { type: 'feat',    text: 'Footer system — role-aware variant rendering (public / host / community_admin / oran_admin) with crisis modal.' },
      { type: 'feat',    text: 'Confidence scoring model — multi-factor score with source trust, recency, and completeness tiers.' },
      { type: 'improve', text: 'Chat pipeline — retrieval-only architecture enforced; LLM summarization gate behind feature flag.' },
      { type: 'improve', text: 'Data model — full HSDS-aligned schema with PostGIS spatial queries.' },
      { type: 'security', text: 'Auth — Microsoft Entra ID (NextAuth.js) with route gating middleware.' },
      { type: 'infra',   text: 'Azure deployment — App Service + PostgreSQL Flexible Server + Sentry telemetry.' },
    ],
  },
  {
    version: '0.8.0',
    date: 'June 2025',
    summary: 'Seeker portal, directory, map, and saved resources pages.',
    changes: [
      { type: 'feat',    text: 'Seeker portal — chat, directory, map, saved, profile, notifications, report, appeal, and service detail pages.' },
      { type: 'feat',    text: 'Directory — full-text search, category filter, eligibility tags, pagination, and WCAG-compliant results list.' },
      { type: 'feat',    text: 'Map — PostGIS proximity search with cluster rendering and accessible fallback list.' },
      { type: 'feat',    text: 'Saved resources — session and profile-linked saved list with one-tap remove.' },
      { type: 'improve', text: 'Crisis hard gate — 911 / 988 / 211 routing triggered on any imminent-risk signal before normal result flow.' },
      { type: 'fix',     text: 'Location handling — approximate by default; explicit consent required before saving precise position.' },
    ],
  },
  {
    version: '0.7.0',
    date: 'May 2025',
    summary: 'Core API routes, database schema, and authentication foundation.',
    changes: [
      { type: 'feat',    text: 'Database schema — organizations, services, locations, phones, schedules, eligibility, taxonomy, and the initial legacy verification queue schema later superseded by the submissions pipeline.' },
      { type: 'feat',    text: 'API routes — /api/search, /api/chat, /api/host/*, /api/community/*, /api/oran-admin/* behind role middleware.' },
      { type: 'feat',    text: 'Chat API — streaming response pipeline with retrieval-first query expansion.' },
      { type: 'feat',    text: 'Import tooling — CSV / HSDS JSON ingestion scripts for seeding from 211 data exports.' },
      { type: 'infra',   text: 'Drizzle ORM migrations wired to PostgreSQL + PostGIS on local Docker and Azure.' },
      { type: 'security', text: 'Role-based access — host_admin, host_member, community_admin, oran_admin, seeker enforced per route.' },
    ],
  },
  {
    version: '0.6.0',
    date: 'April 2025',
    summary: 'Project scaffolding, design system, and component library.',
    changes: [
      { type: 'feat',    text: 'Next.js 15 App Router scaffold with TypeScript strict mode and ESLint config.' },
      { type: 'feat',    text: 'Design system — Button, Dialog, FormField, FormAlert, Toast, SkeletonCard, ErrorBoundary, PageHeader.' },
      { type: 'feat',    text: 'ScheduleEditor, PhoneEditor, CategoryPicker, SuccessCelebration components.' },
      { type: 'feat',    text: 'Domain types — Organization, Service, Location, OranRole, CrisisIndicator.' },
      { type: 'infra',   text: 'Vitest unit tests, Playwright e2e spec files, and Codecov coverage reporting.' },
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">

      {/* Header */}
      <div className="mb-10 border-b border-[var(--border)] pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)]">
          <span className="text-xl" aria-hidden="true">📋</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--text-primary)]">Changelog</h1>
        <p className="max-w-xl leading-relaxed text-[var(--text-secondary)]">
          New features, improvements, security updates, and notable fixes — documented by release. For granular detail, see the{' '}
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/commits/main"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--text-primary)] hover:underline"
          >
            commit history on GitHub
          </a>
          .
        </p>
      </div>

      {/* Release list */}
      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-3.5 top-0 h-full w-px bg-[var(--border)]" aria-hidden="true" />

        <ol className="space-y-10" role="list">
          {RELEASES.map((release) => (
            <li key={release.version} className="relative pl-10">
              {/* Timeline dot */}
              <div
                className={`absolute left-0 top-1.5 h-7 w-7 rounded-full border-2 flex items-center justify-center text-xs font-bold
                  ${release.highlight
                    ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-white'
                    : 'border-[var(--border)] bg-white text-[var(--text-muted)]'
                  }`}
                aria-hidden="true"
              >
                {release.highlight ? '★' : '·'}
              </div>

              {/* Version badge + date */}
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex rounded-full px-3 py-0.5 text-sm font-semibold
                    ${release.highlight ? 'bg-[var(--text-primary)] text-white' : 'bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]'}`}
                >
                  v{release.version}
                </span>
                <span className="text-sm text-[var(--text-secondary)]">{release.date}</span>
              </div>

              {/* Summary */}
              <p className="mb-4 leading-relaxed text-[var(--text-secondary)]">{release.summary}</p>

              {/* Changes */}
              <ul className="space-y-2" role="list">
                {release.changes.map((change) => {
                  const meta = TYPE_LABELS[change.type];
                  return (
                    <li key={change.text} className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 shrink-0 inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${meta.bg} ${meta.text}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-sm leading-relaxed text-[var(--text-secondary)]">{change.text}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </div>

      {/* Watch for updates */}
      <div className="mt-12 flex items-center gap-4 rounded-lg border border-[var(--border)] bg-white px-5 py-4">
        <span className="shrink-0 text-xl" aria-hidden="true">👁</span>
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">Watch for new releases</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Star or watch the{' '}
            <a
              href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-primary)] underline"
            >
              GitHub repository
            </a>{' '}
            to receive release notifications. An RSS/Atom feed is planned for v1.0.
          </p>
        </div>
      </div>

      {/* Pre-release notice */}
      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)] px-5 py-4">
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          <span className="font-semibold">Actively maintained, pre-1.0.</span>{' '}
          ORAN is in continuous development. Breaking changes to APIs, data models, or UI may occur without a deprecation period
          until v1.0 is tagged. Track progress and report issues on{' '}
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2 hover:text-[var(--text-primary)]"
          >
            GitHub
          </a>
          .
        </p>
      </div>

      {/* Footer CTA */}
      <div className="mt-8 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)] px-5 py-4">
        <div>
          <p className="font-medium text-[var(--text-primary)]">See what is coming</p>
          <p className="text-sm text-[var(--text-muted)]">Open issues and milestones are tracked on GitHub.</p>
        </div>
        <a
          href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg bg-[var(--text-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          View issues
        </a>
      </div>

      {/* Related */}
      <nav aria-label="Related pages" className="mt-8 border-t border-[var(--border)] pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Related</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/about" className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]">
            <span className="font-medium text-[var(--text-primary)]">About ORAN</span>
            <span className="text-[var(--text-muted)]" aria-hidden="true">→</span>
          </Link>
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]"
          >
            <span className="font-medium text-[var(--text-primary)]">GitHub Releases</span>
            <span className="text-[var(--text-muted)]" aria-hidden="true">↗</span>
          </a>
          <Link href="/partnerships" className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]">
            <span className="font-medium text-[var(--text-primary)]">Get Involved</span>
            <span className="text-[var(--text-muted)]" aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>

    </div>
  );
}
