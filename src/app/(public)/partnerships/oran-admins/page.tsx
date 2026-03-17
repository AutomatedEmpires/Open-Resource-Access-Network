import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Become an ORAN Admin',
  description:
    'Learn how ORAN admins oversee approvals, platform governance, and verification policy across the network.',
  alternates: { canonical: '/partnerships/oran-admins' },
  openGraph: {
    title: 'Become an ORAN Admin — ORAN',
    description: 'Learn how ORAN admins oversee approvals, platform governance, and verification policy across the network.',
    url: `${SITE.baseUrl}/partnerships/oran-admins`,
    type: 'website',
  },
};

const RESPONSIBILITIES = [
  {
    title: 'Govern approval policy',
    body: 'ORAN admins define how submissions are escalated, approved, denied, and re-routed when edge cases need senior review.',
  },
  {
    title: 'Oversee verification quality',
    body: 'They review appeals, audit moderation actions, and make sure every approval pipeline stays consistent across zones and partner organizations.',
  },
  {
    title: 'Manage platform operations',
    body: 'The ORAN admin workspace includes rules, scopes, ingestion oversight, template management, and triage tools for platform-wide coordination.',
  },
];

const ADMIN_SURFACES = [
  { label: 'Approvals', route: '/approvals' },
  { label: 'Audit', route: '/audit' },
  { label: 'Rules', route: '/rules' },
  { label: 'Scopes', route: '/scopes' },
  { label: 'Triage', route: '/triage' },
  { label: 'Zone Management', route: '/zone-management' },
];

export default function OranAdminsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <nav aria-label="Breadcrumb" className="mb-8 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/partnerships" className="hover:text-gray-800">Get Involved</Link>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-gray-900">ORAN Admins</span>
      </nav>

      <div className="mb-10">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
          <span className="text-xl" aria-hidden="true">🧭</span>
        </div>
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-gray-900">Become an ORAN Admin</h1>
        <p className="mb-2 max-w-2xl text-base leading-relaxed text-gray-600">
          ORAN admins are trusted operators responsible for platform governance, approval policy,
          escalations, and data quality standards across the full network.
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-gray-500">
          This is a high-trust role. Access is reviewed manually and granted only after role-fit,
          workflow readiness, and operational need are confirmed.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/auth/signin"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-900 bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          >
            Request access →
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          >
            Contact ORAN
          </Link>
        </div>
      </div>

      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-5">
          <p className="text-2xl font-bold text-gray-900">Manual</p>
          <p className="mt-1 text-xs text-gray-500">Access review and approval</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-5">
          <p className="text-2xl font-bold text-gray-900">Cross-network</p>
          <p className="mt-1 text-xs text-gray-500">Platform-wide governance scope</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-5">
          <p className="text-2xl font-bold text-gray-900">High-trust</p>
          <p className="mt-1 text-xs text-gray-500">Operational and policy ownership</p>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold text-gray-900">What ORAN admins handle</h2>
        <p className="mb-6 text-sm text-gray-500">
          This role sits above listing submission and community moderation. It is designed for
          platform governance, escalations, and system stewardship.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {RESPONSIBILITIES.map(({ title, body }) => (
            <div key={title} className="rounded-xl border border-gray-200 bg-white px-5 py-5">
              <p className="mb-1 text-sm font-semibold text-gray-900">{title}</p>
              <p className="text-sm leading-relaxed text-gray-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold text-gray-900">Admin workspace surfaces</h2>
        <p className="mb-6 text-sm text-gray-500">
          Existing ORAN admins work across these operational areas once access is granted.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {ADMIN_SURFACES.map(({ label, route }) => (
            <div key={route} className="rounded-xl border border-gray-200 bg-white px-5 py-4">
              <p className="mb-1 text-sm font-semibold text-gray-900">{label}</p>
              <p className="text-sm text-gray-500">{route}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-6">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">How access works</h2>
        <ol className="space-y-2 text-sm leading-relaxed text-gray-600">
          <li>1. Submit your request and sign in so ORAN can associate the application with your account.</li>
          <li>2. The request is reviewed against platform need, trust level, and operational fit.</li>
          <li>3. Approved applicants are onboarded into the admin workspace and governance pipeline.</li>
        </ol>
      </section>
    </div>
  );
}
