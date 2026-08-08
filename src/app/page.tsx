import type { Metadata } from 'next';
import Link from 'next/link';
import { ChatFirstIntakeHero } from '@/components/home/ChatFirstIntakeHero';
import { AppNav } from '@/components/nav/AppNav';
import { ScopedMobileNav, SEEKER_MOBILE_NAV_ITEMS } from '@/components/nav/ScopedMobileNav';
import { SITE, buildOrganizationJsonLd, getSameAsLinks, toSafeJsonLd } from '@/lib/site';

export const metadata: Metadata = {
  title: SITE.title,
  description:
    "Describe what you need and search published government, nonprofit, and community service listings in ORAN's catalog.",
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

      <main id="main-content" tabIndex={-1} className="flex flex-1">
        <ChatFirstIntakeHero />
      </main>

      <footer className="border-t border-[var(--border)] bg-white px-4 py-4 text-xs text-[var(--text-muted)]">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p>Stored service information. Providers decide eligibility and availability.</p>
          <nav aria-label="Home footer" className="flex flex-wrap gap-x-4 gap-y-2">
            <Link href="/trust" className="hover:text-[var(--text-primary)] hover:underline">Trust</Link>
            <Link href="/privacy" className="hover:text-[var(--text-primary)] hover:underline">Privacy</Link>
            <Link href="/accessibility" className="hover:text-[var(--text-primary)] hover:underline">Accessibility</Link>
            <Link href="/submit-resource" className="hover:text-[var(--text-primary)] hover:underline">Correct a listing</Link>
          </nav>
        </div>
      </footer>
      <ScopedMobileNav scopeLabel="Seeker" pathname="/" items={SEEKER_MOBILE_NAV_ITEMS} />
    </div>
  );
}
