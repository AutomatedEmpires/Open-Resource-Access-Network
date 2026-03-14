import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with the ORAN team for support, partnerships, press, or data requests.',
};

interface Channel {
  icon: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  external: boolean;
  response: string;
  border: string;
  bg: string;
}

const CHANNELS: Channel[] = [
  {
    icon: '🐛',
    title: 'Bug reports & technical issues',
    description:
      'Found a bug or unexpected behavior? Open a GitHub issue with steps to reproduce and the browser/OS you were using.',
    cta: 'Open a GitHub issue',
    href: 'https://github.com/AutomatedEmpires/Open-Resource-Access-Network/issues/new',
    external: true,
    response: 'Triaged weekly',
    border: 'border-orange-200',
    bg: 'bg-orange-50',
  },
  {
    icon: '🛡️',
    title: 'Security vulnerabilities',
    description:
      'Responsible disclosure only — do not post security findings in public GitHub issues or social media.',
    cta: 'Open a private advisory',
    href: 'https://github.com/AutomatedEmpires/Open-Resource-Access-Network/security/advisories/new',
    external: true,
    response: 'Acknowledged within 48 hours',
    border: 'border-red-200',
    bg: 'bg-red-50',
  },
  {
    icon: '🔒',
    title: 'Data & privacy requests',
    description:
      'Data access, correction, deletion, or portability requests under GDPR, CCPA, or other applicable law.',
    cta: 'Read our Privacy Policy',
    href: '/privacy',
    external: false,
    response: 'Responded within 30 days',
    border: 'border-indigo-200',
    bg: 'bg-indigo-50',
  },
  {
    icon: '🤝',
    title: 'Partnerships & listings',
    description:
      'List your organization, explore institutional partnerships, or discuss data integration agreements.',
    cta: 'See partnerships page',
    href: '/partnerships',
    external: false,
    response: 'Responded within 5 business days',
    border: 'border-violet-200',
    bg: 'bg-violet-50',
  },
  {
    icon: '📰',
    title: 'Press & media',
    description:
      'Journalist, blogger, or partner organization writing about ORAN? Find the fact sheet, brand assets, suggested boilerplate, and media contact on the Press & Media page. Include your publication and deadline in your outreach.',
    cta: 'Press & media page',
    href: '/about/press',
    external: false,
    response: 'Typically 2–3 business days',
    border: 'border-sky-200',
    bg: 'bg-sky-50',
  },
];

export default function ContactPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {/* Header */}
      <div className="mb-10 border-b border-gray-200 pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-sky-50">
          <span className="text-xl" aria-hidden="true">✉️</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">Contact</h1>
        <p className="max-w-xl leading-relaxed text-gray-600">
          Use the appropriate channel below for the fastest response. A unified contact form is in
          development — in the meantime, every inquiry type has a direct route.
        </p>
      </div>

      {/* Crisis callout */}
      <div className="mb-10 flex items-start gap-4 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
        <span className="mt-0.5 shrink-0 text-lg" aria-hidden="true">🚨</span>
        <div>
          <p className="text-sm font-semibold text-red-900">In an emergency?</p>
          <p className="mt-1 text-sm leading-relaxed text-red-800">
            Do not use this page. Call <strong>911</strong> for emergencies,{' '}
            <strong>988</strong> for mental health crises, or <strong>211</strong> for social
            services. The{' '}
            <strong>Crisis Resources</strong> button in the footer also lists national hotlines.
          </p>
        </div>
      </div>

      {/* Channels */}
      <section className="mb-10">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">Contact channels</h2>
        <div className="space-y-4">
          {CHANNELS.map(({ icon, title, description, cta, href, external, response, border, bg }) => (
            <div key={title} className={`rounded-xl border ${border} ${bg} px-5 py-5`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-xl" aria-hidden="true">{icon}</span>
                  <div>
                    <h3 className="font-semibold text-gray-900">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">{description}</p>
                    <p className="mt-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs text-gray-500">
                        ⏱ {response}
                      </span>
                    </p>
                  </div>
                </div>
                {external ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 self-start whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    {cta} ↗
                  </a>
                ) : (
                  <Link
                    href={href}
                    className="shrink-0 self-start whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    {cta} →
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* General inquiries */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-5">
        <p className="text-sm font-medium text-gray-900">General inquiries &amp; press</p>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          For press inquiries, visit the{' '}
          <Link href="/about/press" className="text-indigo-600 underline hover:text-indigo-800">
            Press &amp; Media page
          </Link>
          . For general questions not covered above, start a discussion on{' '}
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline hover:text-indigo-800"
          >
            GitHub Discussions
          </a>
          . A unified contact form with category routing is in development.
        </p>
      </div>

      {/* Related */}
      <nav aria-label="Related pages" className="mt-8 border-t border-gray-200 pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Related</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/security" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Security Policy</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/privacy" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Privacy Policy</span>
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
