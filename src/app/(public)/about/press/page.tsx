import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Press — ORAN',
  description:
    'Press kit, media resources, and brand guidelines for the Open Resource Access Network.',
};

interface PressAsset {
  label: string;
  description: string;
}

interface Mention {
  publication: string;
  headline: string;
  date: string;
  href?: string;
}

interface Stat {
  label: string;
  value: string;
  /** Renders the value as a live external link. */
  href?: string;
}

const BRAND_ASSETS: PressAsset[] = [
  {
    label: 'Logo — SVG (light background)',
    description: 'Primary horizontal lockup for white or light-gray surfaces.',
  },
  {
    label: 'Logo — SVG (dark background)',
    description: 'Reversed lockup for dark surfaces and overlay contexts.',
  },
  {
    label: 'Icon mark — PNG 512×512',
    description: 'Stand-alone icon for app stores, favicons, and social avatars.',
  },
  {
    label: 'Social card — Open Graph 1200×630',
    description: 'Pre-formatted card image for web link previews.',
  },
];

const FACT_SHEET: Stat[] = [
  { label: 'Full name', value: 'Open Resource Access Network' },
  { label: 'Abbreviation', value: 'ORAN' },
  { label: 'Founded', value: '2024' },
  { label: 'License', value: 'MIT (open source)' },
  {
    label: 'Primary URL',
    value: 'openresourceaccessnetwork.com',
    href: 'https://openresourceaccessnetwork.com',
  },
  {
    label: 'Codebase',
    value: 'github.com/AutomatedEmpires/Open-Resource-Access-Network',
    href: 'https://github.com/AutomatedEmpires/Open-Resource-Access-Network',
  },
  { label: 'Service categories', value: '30+' },
  { label: 'Verification model', value: 'Community admin + automated confidence scoring' },
  { label: 'Crisis routing', value: '911 / 988 / 211 — immediate, non-defeatable' },
  { label: 'Data policy', value: 'Retrieval-only — no AI hallucinations in results' },
];

const PRESS_MENTIONS: Mention[] = [
  // Populated as coverage is earned — leave section visible but empty-state handled below
];

const BRAND_GUIDELINES: { marker: string; tone: 'allow' | 'deny'; text: string }[] = [
  { marker: '✓', tone: 'allow', text: 'Refer to the platform as "ORAN" or "Open Resource Access Network".' },
  { marker: '✓', tone: 'allow', text: 'Use provided logo files without cropping or color alteration.' },
  { marker: '✓', tone: 'allow', text: 'Quote the mission: "connecting people to verified government, nonprofit, and community services."' },
  { marker: '✗', tone: 'deny',  text: 'Do not represent ORAN as a government agency or 211 operator unless explicitly confirmed.' },
  { marker: '✗', tone: 'deny',  text: 'Do not use the logo in contexts that imply endorsement of a specific political position.' },
  { marker: '✗', tone: 'deny',  text: 'Do not alter, distort, or combine the logo mark with other design elements.' },
];

export default function PressPage() {
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
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50">
          <span className="text-xl" aria-hidden="true">📰</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">Press &amp; Media</h1>
        <p className="max-w-xl leading-relaxed text-gray-600">
          Brand assets, fact sheet, and usage guidelines for journalists, bloggers, and partner organizations covering ORAN.
        </p>
      </div>

      {/* Media contact */}
      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Media contact</h2>
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-5">
          <p className="mb-1 font-medium text-gray-900">Press inquiries</p>
          <p className="mb-3 text-sm leading-relaxed text-gray-600">
            For interview requests, fact-checks, partnership announcements, or embargoed briefings, use the contact page.
            Include <span className="font-medium">&ldquo;Press inquiry&rdquo;</span> in your subject line along with your
            publication&apos;s deadline.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Contact page
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500">
              ⏱ Typical response: 2–3 business days
            </span>
          </div>
        </div>
      </section>

      {/* Suggested boilerplate — journalists need this before the fact sheet */}
      <section className="mb-12">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Suggested boilerplate</h2>
        <p className="mb-4 text-sm text-gray-500">
          Copy and adapt freely for articles, directories, and partner materials:
        </p>
        <blockquote className="rounded-lg border-l-4 border-indigo-300 bg-indigo-50 px-5 py-4">
          <p className="leading-relaxed text-gray-800 italic">
            &ldquo;ORAN (Open Resource Access Network) is an open-source, civic-grade platform that connects people to verified
            government, nonprofit, and community services. Results come exclusively from stored, verified records — no AI
            hallucinations. Safety routing to 911, 988, and 211 is built in at the system level and cannot be bypassed.&rdquo;
          </p>
        </blockquote>
      </section>

      {/* Fact sheet */}
      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Fact sheet</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm" role="table" aria-label="ORAN fact sheet">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-700 w-2/5">Field</th>
                <th className="px-4 py-3 font-medium text-gray-700">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {FACT_SHEET.map(({ label, value, href }) => (
                <tr key={label}>
                  <td className="px-4 py-3 font-medium text-gray-600">{label}</td>
                  <td className="px-4 py-3 text-gray-900">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                      >
                        {value}
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </a>
                    ) : (
                      value
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Brand assets */}
      <section className="mb-12">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Brand assets</h2>
        <p className="mb-5 text-sm leading-relaxed text-gray-500">
          The asset bundle is being finalized. Contact us directly and we will provide files while the public
          download package is prepared.
        </p>
        <div className="space-y-3">
          {BRAND_ASSETS.map(({ label, description }) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3.5"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{label}</p>
                <p className="text-sm text-gray-500">{description}</p>
              </div>
              <span className="shrink-0 rounded-full border border-gray-100 bg-gray-50 px-3 py-1 text-xs text-gray-400">
                Coming soon
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
          >
            Request assets
          </Link>
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            View repository
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </section>

      {/* Brand guidelines */}
      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Brand guidelines</h2>
        <ul className="space-y-3" role="list">
          {BRAND_GUIDELINES.map(({ marker, tone, text }) => (
            <li key={text} className="flex gap-3">
              <span
                className={`mt-0.5 shrink-0 text-sm font-bold ${tone === 'allow' ? 'text-green-500' : 'text-red-400'}`}
                aria-hidden="true"
              >
                {marker}
              </span>
              <span className="leading-relaxed text-gray-700">{text}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Press coverage */}
      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Press coverage</h2>
        {PRESS_MENTIONS.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
            <p className="text-sm text-gray-500">
              Coverage will be listed here as it is published. If you are writing about ORAN,{' '}
              <Link href="/contact" className="font-medium text-indigo-600 hover:underline">let us know</Link>.
            </p>
          </div>
        ) : (
          <ul className="space-y-4" role="list">
            {PRESS_MENTIONS.map((m) => (
              <li key={`${m.publication}-${m.date}`} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-4">
                <div>
                  <p className="mb-0.5 font-medium text-gray-900">{m.headline}</p>
                  <p className="text-sm text-gray-500">{m.publication} · {m.date}</p>
                </div>
                {m.href && (
                  <a
                    href={m.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs text-indigo-600 hover:underline"
                  >
                    Read <ExternalLink className="inline h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Footer CTA */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <div>
          <p className="font-medium text-gray-900">Something missing?</p>
          <p className="text-sm text-gray-500">Contact us and we will turn around what you need.</p>
        </div>
        <Link
          href="/contact"
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Contact us
        </Link>
      </div>

    </div>
  );
}
