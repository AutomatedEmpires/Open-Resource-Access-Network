import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Partnerships & Get Involved',
  description:
    'List your organization on ORAN, partner with us, donate, or volunteer to help connect people to verified services.',
};

interface Opportunity {
  icon: string;
  title: string;
  description: string;
  highlights: string[];
  cta: string;
  ctaHref: string | null;
  color: 'indigo' | 'blue' | 'amber' | 'green';
}

const OPPORTUNITIES: Opportunity[] = [
  {
    icon: '🏢',
    title: 'List Your Organization',
    description:
      'Make your services discoverable to people who need them most. Listings are free, community-verified, and reach seekers actively looking for help in your area. Self-service intake is in development.',
    highlights: [
      'Free to list — no subscription required',
      'Community-verified for accuracy and ongoing data freshness',
      'Eligible for confidence scoring and elevated placement',
    ],
    cta: 'Coming soon',
    ctaHref: null,
    color: 'indigo',
  },
  {
    icon: '🔗',
    title: 'Institutional Partnerships',
    description:
      'Hospitals, libraries, schools, 211 networks, and government agencies — partner with ORAN to expand coverage, improve data freshness, and reach more people. Data-sharing agreements and co-branded portals are available.',
    highlights: [
      'Structured data sharing and ingestion agreements',
      'White-label and co-branded portal options',
      'Priority verification queuing for partner organizations',
    ],
    cta: 'Inquire now',
    ctaHref: '/contact',
    color: 'blue',
  },
  {
    icon: '💛',
    title: 'Donate',
    description:
      'Support the infrastructure that keeps real help findable. Contributions fund data verification operations, server costs, and ongoing development. Donation infrastructure is being finalized.',
    highlights: [
      'Supports continuous data verification',
      'Funds platform reliability and uptime',
      'Enables expanded geographic service coverage',
    ],
    cta: 'Coming soon',
    ctaHref: null,
    color: 'amber',
  },
  {
    icon: '🙋',
    title: 'Volunteer',
    description:
      'Community administrators are the backbone of ORAN\'s verification model. Volunteer to verify service listings in your area, moderate submissions, or contribute to the open-source codebase.',
    highlights: [
      'Verify and update local service listings in your area',
      'Serve as a trusted community administrator',
      'Contribute to the open-source codebase on GitHub',
    ],
    cta: 'Coming soon',
    ctaHref: null,
    color: 'green',
  },
];

const colorMap: Record<
  'indigo' | 'blue' | 'amber' | 'green',
  { border: string; activeCta: string }
> = {
  indigo: {
    border: 'border-indigo-200',
    activeCta:
      'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500',
  },
  blue: {
    border: 'border-teal-200',
    activeCta: 'bg-teal-600 text-white hover:bg-teal-700 focus:ring-teal-500',
  },
  amber: {
    border: 'border-amber-200',
    activeCta:
      'bg-amber-500 text-white hover:bg-amber-600 focus:ring-amber-400',
  },
  green: {
    border: 'border-green-200',
    activeCta:
      'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
  },
};

export default function PartnershipsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {/* Header */}
      <div className="mb-10 border-b border-gray-200 pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-violet-50">
          <span className="text-xl" aria-hidden="true">🤝</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">Get Involved</h1>
        <p className="max-w-xl leading-relaxed text-gray-600">
          ORAN is a civic network powered by real organizations and real people. Whether you
          provide services, fund infrastructure, verify data, or contribute code — there is a
          role for you.
        </p>
      </div>

      {/* Opportunity cards */}
      <section className="mb-10">
        <div className="space-y-5">
          {OPPORTUNITIES.map(({ icon, title, description, highlights, cta, ctaHref, color }) => {
            const colors = colorMap[color];
            const sectionId = title.toLowerCase().replace(/\s+/g, '-');
            return (
              <div
                key={title}
                id={sectionId}
                className={`rounded-xl border ${colors.border} bg-white px-6 py-6`}
              >
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 shrink-0 text-2xl" aria-hidden="true">
                    {icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="mb-2 text-base font-semibold text-gray-900">{title}</h2>
                    <p className="mb-4 text-sm leading-relaxed text-gray-600">{description}</p>
                    <ul className="mb-5 space-y-1.5">
                      {highlights.map((h) => (
                        <li key={h} className="flex gap-2 text-sm text-gray-700">
                          <span
                            className="mt-0.5 shrink-0 text-green-500"
                            aria-hidden="true"
                          >
                            ✓
                          </span>
                          {h}
                        </li>
                      ))}
                    </ul>
                    {ctaHref ? (
                      <Link
                        href={ctaHref}
                        className={`inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 ${colors.activeCta}`}
                      >
                        {cta} →
                      </Link>
                    ) : (
                      <span className="inline-block rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500">
                        {cta}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* GitHub contribution banner */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Open-source contributor?</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Browse open issues, submit pull requests, or start a discussion.
          </p>
        </div>
        <a
          href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          View on GitHub →
        </a>
      </div>
    </div>
  );
}
