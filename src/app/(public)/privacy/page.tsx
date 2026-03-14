import type { Metadata } from 'next';
import Link from 'next/link';

const LAST_UPDATED_ISO = '2026-03-13';
const LAST_UPDATED_DISPLAY = 'March 13, 2026';
const VERSION = '0.9 — Pre-release (pending legal review)';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How ORAN collects, uses, and protects your information.',
};

const DATA_WE_COLLECT = [
  {
    category: 'Location data',
    detail:
      'Approximate location (city / ZIP level) used by default for service matching. Precise location is only used when you explicitly grant browser permission and is not stored after your session.',
    purpose: 'Service matching',
  },
  {
    category: 'Session identifiers',
    detail:
      'Pseudonymous identity token managed by Microsoft Entra ID and NextAuth.js. Not linked to your real name within ORAN.',
    purpose: 'Authentication',
  },
  {
    category: 'Service interactions',
    detail:
      'Services you search for, save, or rate. Feedback scores submitted on service listings.',
    purpose: 'Platform quality',
  },
  {
    category: 'Optional profile data',
    detail:
      'Display name, city preference, and locale — only if you choose to save a profile. Opt-in, not default.',
    purpose: 'Personalization',
  },
  {
    category: 'Usage patterns',
    detail:
      'Anonymized telemetry for platform performance and reliability. Error traces are anonymized before transmission to Sentry.',
    purpose: 'Platform integrity',
  },
];

const THIRD_PARTIES: { name: string; purpose: string; link: string }[] = [
  {
    name: 'Microsoft Entra ID',
    purpose: 'Identity management and authentication',
    link: 'https://privacy.microsoft.com/en-US/privacystatement',
  },
  {
    name: 'Sentry',
    purpose: 'Anonymized error monitoring — no PII transmitted',
    link: 'https://sentry.io/privacy/',
  },
  {
    name: 'Azure (Microsoft)',
    purpose: 'Cloud hosting, database, and application infrastructure',
    link: 'https://privacy.microsoft.com/en-US/privacystatement',
  },
  {
    name: 'Azure Maps (Microsoft)',
    purpose: 'Map tiles, geocoding, and location search',
    link: 'https://privacy.microsoft.com/en-US/privacystatement',
  },
];

const YOUR_RIGHTS = [
  { right: 'Access', description: 'Request a copy of the data ORAN holds about you.' },
  { right: 'Correction', description: 'Request correction of inaccurate data.' },
  { right: 'Deletion', description: 'Request deletion of your profile and associated data.' },
  {
    right: 'Portability',
    description: 'Request your data in a machine-readable format where technically feasible.',
  },
  {
    right: 'Opt-out',
    description: 'Withdraw consent for optional data collection at any time via your profile settings.',
  },
];

const HOW_WE_USE = [
  'Service matching — finding the most relevant verified services for your location and needs.',
  'Platform integrity — detecting and preventing abuse, spam, and fraudulent submissions.',
  'Data quality improvement — aggregated, anonymized usage patterns to identify service coverage gaps.',
  'Authentication and session management — verifying your identity when you sign in.',
  'Communications — responding to support, accessibility, and data subject inquiries.',
];

const DATA_RETENTION: { category: string; retention: string }[] = [
  {
    category: 'Session tokens',
    retention: 'Expire at browser close; inactive sessions purged after 30 days',
  },
  {
    category: 'Profile data',
    retention: 'Retained until account deletion or deletion request',
  },
  {
    category: 'Service interactions',
    retention: 'Retained up to 12 months; anonymized thereafter',
  },
  {
    category: 'Usage telemetry',
    retention: 'Up to 90 days in Sentry; aggregated metrics retained indefinitely',
  },
  {
    category: 'Location data',
    retention:
      'Precise location not stored beyond the active session; approximate location embedded within service interaction records only',
  },
];

export default function PrivacyPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {/* Header */}
      <div className="mb-10 border-b border-gray-200 pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-50">
          <span className="text-xl" aria-hidden="true">🔒</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">Privacy Policy</h1>
        <div className="flex flex-wrap gap-3 text-sm text-gray-500">
          <span>{VERSION}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={LAST_UPDATED_ISO}>Updated {LAST_UPDATED_DISPLAY}</time>
        </div>
      </div>

      {/* Legal review notice */}
      <div className="mb-10 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-sm font-semibold text-amber-900">Under legal review</p>
        <p className="mt-1 text-sm text-amber-800 leading-relaxed">
          This page reflects our current data practices accurately but is pending formal legal
          review. A fully reviewed document will replace this page before ORAN accepts general
          public traffic at scale. For data requests in the meantime, use our{' '}
          <Link href="/contact" className="font-medium underline hover:text-amber-900">
            contact form
          </Link>
          .
        </p>
      </div>

      {/* Introduction */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Overview</h2>
        <p className="leading-relaxed text-gray-700">
          ORAN collects and processes data to connect you with verified services. This page
          explains what we collect, how it is used, who may have access, and how to exercise
          your rights. Where practices are still being formalized, we say so plainly.
        </p>
      </section>

      {/* Data we collect */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Data we collect</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="w-40 px-4 py-3 text-left font-medium text-gray-500">Category</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Detail</th>
                <th className="hidden w-32 px-4 py-3 text-left font-medium text-gray-500 sm:table-cell">
                  Purpose
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {DATA_WE_COLLECT.map(({ category, detail, purpose }) => (
                <tr key={category}>
                  <td className="px-4 py-3 align-top font-medium text-gray-900">{category}</td>
                  <td className="px-4 py-3 leading-relaxed text-gray-600">{detail}</td>
                  <td className="hidden px-4 py-3 align-top text-gray-500 sm:table-cell">
                    {purpose}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Collection scope may expand as the platform grows. Material changes will be communicated
          via a revised version of this page with an updated date.
        </p>
      </section>

      {/* How we use it */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">How we use your data</h2>
        <ul className="space-y-2 text-sm text-gray-700">
          {HOW_WE_USE.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-indigo-400" aria-hidden="true">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-gray-600 leading-relaxed">
          Additional uses of collected data — including any that may arise from future business
          arrangements — will be disclosed in a revised version of this policy before they take
          effect.
        </p>
      </section>

      {/* Data retention */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Data retention</h2>
        <div className="space-y-2">
          {DATA_RETENTION.map(({ category, retention }) => (
            <div
              key={category}
              className="flex flex-col gap-1 rounded border border-gray-200 bg-white px-4 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-4"
            >
              <span className="w-44 shrink-0 font-medium text-gray-900">{category}</span>
              <span className="text-gray-600">{retention}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Retention periods are reviewed as part of our data governance process and may be
          adjusted. Reductions in retention are applied automatically.
        </p>
      </section>

      {/* Third-party processors */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Third-party processors</h2>
        <p className="mb-4 text-sm text-gray-600 leading-relaxed">
          ORAN uses the following third-party services. We do not currently share data with
          advertisers or data brokers. Any data-sharing arrangement beyond those listed below
          will be disclosed in this policy before it takes effect.
        </p>
        <div className="space-y-2">
          {THIRD_PARTIES.map(({ name, purpose, link }) => (
            <div
              key={name}
              className="flex items-center justify-between gap-4 rounded border border-gray-200 bg-white px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-gray-900">{name}</p>
                <p className="mt-0.5 text-gray-500">{purpose}</p>
              </div>
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-indigo-600 underline hover:text-indigo-800"
              >
                Privacy policy ↗
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Your rights */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Your rights</h2>
        <p className="mb-4 text-sm text-gray-600 leading-relaxed">
          Depending on your jurisdiction (including GDPR and CCPA), you may have the following
          rights regarding your personal data:
        </p>
        <div className="space-y-2">
          {YOUR_RIGHTS.map(({ right, description }) => (
            <div key={right} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 shrink-0 rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                {right}
              </span>
              <span className="leading-relaxed text-gray-700">{description}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm">
          <p className="text-indigo-800">
            To exercise any of these rights, use our{' '}
            <Link href="/contact" className="font-medium underline hover:text-indigo-900">
              contact form
            </Link>{' '}
            and select &ldquo;Data Request&rdquo; as the category. We will respond within 30 days.
          </p>
        </div>
      </section>

      {/* Cookies */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Cookies</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          ORAN uses a single session cookie managed by NextAuth.js, required for authentication.
          This cookie is strictly necessary and does not track you across other sites or sessions.
          We do not use advertising cookies or persistent third-party tracking cookies. If analytics
          cookies are introduced in the future, this policy will be updated and explicit consent
          will be sought before they are placed.
        </p>
      </section>

      {/* Children */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Children</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          ORAN requires users to be at least 13 years old to create an account (in compliance with
          COPPA). We do not knowingly collect personal information from children under 13. If you
          believe a child under 13 has provided personal information, contact us and we will delete
          it promptly.
        </p>
      </section>

      {/* Policy updates */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Policy updates</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          We will update this page when our data practices change. Material changes — including
          changes to data use purposes, third-party sharing, or retention periods — will be
          communicated with a revised version number and updated date. If you have an account,
          we will notify you by email for material changes.
        </p>
      </section>

      {/* Contact CTA */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Questions or data requests?</p>
          <p className="mt-0.5 text-xs text-gray-500">
            We aim to respond to data inquiries within 30 days.
          </p>
        </div>
        <Link
          href="/contact"
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Contact us →
        </Link>
      </div>

      {/* Related policies */}
      <nav aria-label="Related policies" className="mt-8 border-t border-gray-200 pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Related policies</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/terms" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Terms of Use</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/security" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Security Policy</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/accessibility" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Accessibility</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
