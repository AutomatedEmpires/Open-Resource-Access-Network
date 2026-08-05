import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CircleAlert, LockKeyhole, ShieldCheck } from 'lucide-react';

import { AppFooter } from '@/components/footer';
import { ChatFirstIntakeHero } from '@/components/home/ChatFirstIntakeHero';
import { AppNav } from '@/components/nav/AppNav';
import { ScopedMobileNav, SEEKER_MOBILE_NAV_ITEMS } from '@/components/nav/ScopedMobileNav';
import { SITE, buildOrganizationJsonLd, getSameAsLinks, toSafeJsonLd } from '@/lib/site';

export const metadata: Metadata = {
  title: SITE.title,
  description:
    'Describe what you need and search source-backed government, nonprofit, and community service listings.',
  alternates: { canonical: '/' },
  openGraph: {
    title: SITE.title,
    description: SITE.description,
    url: SITE.baseUrl,
    type: 'website',
  },
};

const orgSchema = buildOrganizationJsonLd();

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
      urlTemplate: `${SITE.baseUrl}/directory?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
};

const COMMON_NEEDS = [
  { label: 'Food', href: '/directory?category=food_assistance' },
  { label: 'Housing', href: '/directory?category=housing' },
  { label: 'Utilities', href: '/directory?category=utility_assistance' },
  { label: 'Health care', href: '/directory?category=healthcare' },
  { label: 'Mental health', href: '/directory?category=mental_health' },
  { label: 'Employment', href: '/directory?category=employment' },
  { label: 'Legal help', href: '/directory?category=legal_aid' },
  { label: 'Child care', href: '/directory?category=childcare' },
] as const;

const EXPECTATIONS = [
  {
    icon: ShieldCheck,
    title: 'Source-backed listings',
    body: 'Matches come from stored, source-backed service records. Confirm missing or potentially outdated details with the provider.',
  },
  {
    icon: LockKeyhole,
    title: 'You stay in control',
    body: 'Your description is not sent to listed providers. You choose whether and how to contact them.',
  },
  {
    icon: CircleAlert,
    title: 'Clear limits',
    body: 'A match is not an eligibility or availability decision. Confirm requirements, hours, and openings.',
  },
] as const;

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-page)] pb-14 md:pb-0">
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
        <ChatFirstIntakeHero />

        <section className="border-b border-[var(--border)] bg-white px-4 py-10 sm:py-14" aria-labelledby="common-needs-heading">
          <div className="mx-auto max-w-5xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-cobalt)]">
                  Browse common needs
                </p>
                <h2 id="common-needs-heading" className="mt-2 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
                  Start with a category
                </h2>
              </div>
              <Link
                href="/directory"
                className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-lg px-1 py-2 text-sm font-semibold text-[var(--brand-cobalt)] hover:underline sm:self-auto"
              >
                View all services
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {COMMON_NEEDS.map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex min-h-14 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:border-[var(--brand-azure)] hover:bg-[var(--bg-surface-alt)]"
                >
                  {label}
                  <ArrowRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-[var(--border)] bg-[var(--bg-page)] px-4 py-10 sm:py-14" aria-labelledby="expect-heading">
          <div className="mx-auto max-w-5xl">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-cobalt)]">
                What to expect
              </p>
              <h2 id="expect-heading" className="mt-2 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
                Useful information without false promises
              </h2>
            </div>

            <div className="mt-7 grid gap-4 md:grid-cols-3">
              {EXPECTATIONS.map(({ icon: Icon, title, body }) => (
                <article key={title} className="rounded-xl border border-[var(--border)] bg-white p-5">
                  <Icon className="h-5 w-5 text-[var(--brand-cobalt)]" aria-hidden="true" />
                  <h3 className="mt-4 text-base font-bold text-[var(--text-primary)]">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-9 sm:py-11" aria-labelledby="improve-heading">
          <div className="mx-auto flex max-w-5xl flex-col gap-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <h2 id="improve-heading" className="text-xl font-bold text-[var(--text-primary)]">
                Know a service that is missing or incorrect?
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                Send a source-backed suggestion. It will be reviewed before it can change a public listing.
              </p>
            </div>
            <Link
              href="/submit-resource"
              className="inline-flex min-h-[46px] shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--text-primary)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-navy)]"
            >
              Submit or correct a resource
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <AppFooter />
      <ScopedMobileNav scopeLabel="Seeker" pathname="/" items={SEEKER_MOBILE_NAV_ITEMS} />
    </div>
  );
}
