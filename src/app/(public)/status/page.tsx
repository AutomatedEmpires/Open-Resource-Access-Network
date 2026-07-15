import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

const LAST_UPDATED_ISO = '2026-07-14';
const LAST_UPDATED_DISPLAY = 'July 14, 2026';

export const metadata: Metadata = {
  title: 'System Status',
  description: 'Published operational status for ORAN platform services.',
  alternates: { canonical: '/status' },
  openGraph: {
    title: 'System Status — ORAN',
    description: 'Published operational status for ORAN platform services.',
    url: `${SITE.baseUrl}/status`,
    type: 'website',
  },
};

type ComponentStatus = 'operational' | 'degraded' | 'outage' | 'maintenance';

interface StatusComponent {
  name: string;
  status: ComponentStatus;
}

const COMPONENTS: StatusComponent[] = [
  { name: 'Web application and API', status: 'operational' },
  { name: 'Resource search', status: 'operational' },
  { name: 'Chat navigation', status: 'operational' },
  { name: 'Authentication', status: 'operational' },
  { name: 'Resource data', status: 'operational' },
  { name: 'Maps', status: 'operational' },
];

const PROVIDER_STATUS_LINKS = [
  { name: 'Vercel Status', detail: 'Application hosting and edge delivery', href: 'https://www.vercel-status.com/' },
  { name: 'Supabase Status', detail: 'Postgres database and connection pooler', href: 'https://status.supabase.com/' },
  { name: 'Clerk Status', detail: 'Identity and session services', href: 'https://status.clerk.com/' },
  { name: 'OpenStreetMap Status', detail: 'Community map tiles and related services', href: 'https://uptime.openstreetmap.org/' },
] as const;

const STATUS_STYLE: Record<
  ComponentStatus,
  { label: string; dot: string; text: string }
> = {
  operational: { label: 'Operational', dot: 'bg-gray-900', text: 'text-gray-900' },
  degraded: { label: 'Degraded', dot: 'bg-gray-500', text: 'text-gray-700' },
  outage: { label: 'Outage', dot: 'bg-red-500', text: 'text-red-700' },
  maintenance: { label: 'Maintenance', dot: 'bg-gray-600', text: 'text-gray-700' },
};

export default function StatusPage() {
  const allOperational = COMPONENTS.every((c) => c.status === 'operational');

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {/* Page header */}
      <div className="mb-10 border-b border-gray-200 pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
          <span className="text-xl" aria-hidden="true">📡</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">
          System Status
        </h1>
        <p className="max-w-xl leading-relaxed text-gray-600">
          ORAN&apos;s published application status, including resource discovery, chat,
          authentication, and map access.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Last updated: <time dateTime={LAST_UPDATED_ISO}>{LAST_UPDATED_DISPLAY}</time>
        </p>
      </div>

      {/* Overall status banner */}
      <div
        className={`mb-10 flex items-center gap-4 rounded-xl border px-6 py-5 ${
          allOperational
            ? 'border-gray-200 bg-gray-50'
            : 'border-gray-300 bg-gray-100'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full ${
            allOperational ? 'bg-gray-900' : 'bg-gray-600'
          }`}
          aria-hidden="true"
        />
        <div>
          <p
            className={`font-semibold ${
              allOperational ? 'text-gray-900' : 'text-gray-900'
            }`}
          >
            {allOperational ? 'All systems operational' : 'Service disruption in progress'}
          </p>
          <p
            className={`mt-0.5 text-sm ${
              allOperational ? 'text-gray-700' : 'text-gray-700'
            }`}
          >
            {allOperational
              ? 'ORAN is operating normally across all services.'
              : 'See active incidents below for details.'}
          </p>
        </div>
      </div>

      {/* Component table */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Components</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Component
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {COMPONENTS.map(({ name, status }) => {
                const cfg = STATUS_STYLE[status];
                return (
                  <tr key={name}>
                    <td className="px-4 py-3 font-medium text-gray-900">{name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 ${cfg.text}`}>
                        <span
                          className={`h-2 w-2 rounded-full ${cfg.dot}`}
                          aria-hidden="true"
                        />
                        {cfg.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Active incidents */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Active incidents</h2>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-gray-500">No active incidents.</p>
        </div>
      </section>

      {/* Incident history */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Published incident history</h2>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-8 text-center">
          <p className="text-sm text-gray-500">No ORAN incidents are currently published.</p>
        </div>
      </section>

      {/* Stay informed */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Stay informed</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <div>
              <p className="font-medium text-gray-900">GitHub Releases</p>
              <p className="mt-0.5 text-xs text-gray-500">Watch releases for platform updates</p>
            </div>
            <span className="shrink-0 text-gray-400" aria-hidden="true">↗</span>
          </a>
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/issues?q=is%3Aissue+label%3Aincident"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <div>
              <p className="font-medium text-gray-900">Incident labels on GitHub</p>
              <p className="mt-0.5 text-xs text-gray-500">All past incidents are filed as issues</p>
            </div>
            <span className="shrink-0 text-gray-400" aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      {/* Provider status */}
      <section id="provider-status" className="mb-10 scroll-mt-24">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Provider status</h2>
        <p className="mb-4 text-sm leading-relaxed text-gray-600">
          ORAN runs on dedicated Vercel, Supabase, and Clerk services and uses OpenStreetMap
          for map tiles. Their status pages publish infrastructure-level incidents separately.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PROVIDER_STATUS_LINKS.map(({ name, detail, href }) => (
            <a
              key={name}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
              <div>
                <p className="font-medium text-gray-900">{name}</p>
                <p className="mt-0.5 text-xs text-gray-500">{detail}</p>
              </div>
              <span className="shrink-0 text-gray-400" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      {/* Footer note */}
      <div className="mb-8 border-t border-gray-200 pt-6 text-xs text-gray-600">
        This is a manually published ORAN status summary; it does not poll provider status in real
        time. To report a production issue, open an issue on{' '}
        <a
          href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 underline hover:text-gray-700"
        >
          GitHub
        </a>
        .
      </div>

      {/* Related */}
      <nav aria-label="Related pages" className="mt-6 border-t border-gray-200 pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Related</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href="/changelog" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Changelog</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/contact" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Contact</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
