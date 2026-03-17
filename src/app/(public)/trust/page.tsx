import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Trust Center',
  description:
    'Canonical trust, governance, safety, and crawler resources for the Open Resource Access Network.',
  alternates: { canonical: '/trust' },
  openGraph: {
    title: 'Trust Center — ORAN',
    description:
      'Canonical trust, governance, safety, and crawler resources for the Open Resource Access Network.',
    url: `${SITE.baseUrl}/trust`,
    type: 'website',
  },
};

const TRUST_GROUPS: ReadonlyArray<{
  title: string;
  description: string;
  links: Array<{ label: string; href: string; external?: boolean; note: string }>;
}> = [
  {
    title: 'Identity',
    description: 'Core pages that explain what ORAN is, who maintains it, and how the mission is described publicly.',
    links: [
      { label: 'About ORAN', href: '/about', note: 'Mission, vision, and operating principles.' },
      { label: 'Team & Contributors', href: '/about/team', note: 'Founding team, contributors, and governance resources.' },
      { label: 'Press & Media', href: '/about/press', note: 'Fact sheet, boilerplate, and brand references.' },
      { label: 'GitHub Repository', href: SITE.githubUrl, external: true, note: 'Public codebase, issues, releases, and contributor history.' },
    ],
  },
  {
    title: 'Safety & Governance',
    description: 'Public commitments that support institutional trust, security review, and user confidence.',
    links: [
      { label: 'Security Policy', href: '/security', note: 'Responsible disclosure and security controls.' },
      { label: 'Privacy Policy', href: '/privacy', note: 'Data collection, retention, and user rights.' },
      { label: 'Accessibility', href: '/accessibility', note: 'Accessibility standards and support paths.' },
      { label: 'System Status', href: '/status', note: 'Operational status and incident references.' },
      { label: 'Changelog', href: '/changelog', note: 'Public product and platform change history.' },
      { label: 'Terms of Use', href: '/terms', note: 'Usage terms and legal framing.' },
    ],
  },
  {
    title: 'Crawler & Verification',
    description: 'Machine-readable resources for search engines, verifiers, and external trust tooling.',
    links: [
      { label: 'Sitemap', href: '/sitemap.xml', note: 'Primary crawl map for public pages and service detail pages.' },
      { label: 'robots.txt', href: '/robots.txt', note: 'Crawler allow/disallow rules and sitemap location.' },
      { label: 'security.txt', href: '/.well-known/security.txt', note: 'Standard security contact and policy discovery.' },
      { label: 'HSDS Profile API', href: '/api/hsds/profile', note: 'Public interoperability and discovery metadata.' },
    ],
  },
];

export default function TrustPage() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-12">
      <div className="mb-10 border-b border-[var(--border)] pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)]">
          <span className="text-xl" aria-hidden="true">🧭</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--text-primary)]">Trust Center</h1>
        <p className="max-w-2xl leading-relaxed text-[var(--text-secondary)]">
          Canonical references for search engines, partners, researchers, journalists, and institutional reviewers evaluating ORAN.
        </p>
      </div>

      <div className="mb-10 rounded-xl border border-gray-200 bg-gray-50 px-5 py-5">
        <p className="text-sm font-semibold text-gray-900">Why this page exists</p>
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          ORAN competes for trust before it competes for traffic. This page centralizes the factual, public, and machine-readable surfaces that establish identity,
          safety posture, and crawlability.
        </p>
      </div>

      <div className="space-y-10">
        {TRUST_GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">{group.title}</h2>
            <p className="mb-4 text-sm leading-relaxed text-gray-600">{group.description}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.links.map((link) =>
                link.external ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-gray-200 bg-white px-4 py-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-gray-900">{link.label}</p>
                      <span className="text-gray-400" aria-hidden="true">↗</span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-gray-500">{link.note}</p>
                  </a>
                ) : (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-gray-900">{link.label}</p>
                      <span className="text-gray-400" aria-hidden="true">→</span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-gray-500">{link.note}</p>
                  </Link>
                ),
              )}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-12 rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] px-5 py-5">
        <h2 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">External discovery guidance</h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          Search Console, Bing Webmaster Tools, backlinks, partner citations, and Wikipedia or Wikidata work all require manual, policy-compliant handling outside the codebase.
          See the repository runbook in docs/platform/SEARCH_DISCOVERY.md for the exact operating sequence.
        </p>
      </section>
    </div>
  );
}
