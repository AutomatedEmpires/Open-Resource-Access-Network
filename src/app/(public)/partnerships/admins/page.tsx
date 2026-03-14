import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Become a Community Admin | ORAN Partnerships',
  description:
    'Help vet and maintain resource listings for people seeking help in your community. Community admins are the quality backbone of ORAN.',
};

const PORTAL_TOOLS = [
  {
    emoji: '📊',
    label: 'Dashboard',
    route: '/dashboard',
    desc: 'Live queue depth, SLA health, items assigned to you, zone context, and a running activity log. Your operational home base.',
  },
  {
    emoji: '📋',
    label: 'Review Queue',
    route: '/queue',
    desc: 'Browse, claim, and work through pending org submissions assigned to your zone. Supports batch-handling and priority filtering.',
  },
  {
    emoji: '✅',
    label: 'Verify',
    route: '/verify',
    desc: 'Review supporting evidence for each submission. Record approve, deny, or escalate decisions with a required written justification.',
  },
  {
    emoji: '📝',
    label: 'Community Forms',
    route: '/community-forms',
    desc: 'Build and manage intake forms specific to your zone or review focus — used to standardize how orgs submit complex service data.',
  },
  {
    emoji: '🗺️',
    label: 'Coverage',
    route: '/coverage',
    desc: 'Zone-level coverage statistics: what categories are well-served, where gaps exist, and how listing density has changed over time.',
  },
];

const ABILITIES = [
  { emoji: '🔍', title: 'Review org claims', desc: 'Evaluate new organization submissions against ORAN standards before they go live.' },
  { emoji: '✔️', title: 'Approve and deny', desc: 'Approve high-quality listings and deny inaccurate ones with written rationale.' },
  { emoji: '📝', title: 'Request corrections', desc: 'Return a submission with specific feedback so the org can fix and resubmit.' },
  { emoji: '⬆️', title: 'Escalate edge cases', desc: 'Flag submissions requiring senior review or policy clarification to ORAN staff.' },
  { emoji: '📡', title: 'Monitor zone health', desc: 'See coverage stats and SLA metrics for your geographic or categorical zone.' },
  { emoji: '📋', title: 'Manage intake forms', desc: 'Create zone-specific intake forms that improve submission quality for orgs in your area.' },
  { emoji: '🤝', title: 'Mentor new admins', desc: 'Experienced admins are encouraged to support onboarding of newer reviewers.' },
];

export default function AdminsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-8 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/partnerships" className="hover:text-gray-800">Get Involved</Link>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-gray-900">Community Admins</span>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="mb-10">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-green-50">
          <span className="text-xl" aria-hidden="true">🛡️</span>
        </div>
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-gray-900">Become a Community Admin</h1>
        <p className="mb-2 max-w-xl text-base leading-relaxed text-gray-600">
          Community admins are volunteers and civic professionals who review organization claims,
          verify evidence, and maintain the quality of ORAN&apos;s resource data. Your work directly
          affects whether people in crisis find accurate help.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            Apply via GitHub Discussions ↗
          </a>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-5 py-2.5 text-sm font-medium text-green-700 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            Already an admin? Open Portal →
          </Link>
        </div>
      </div>

      {/* ── Stats bar ────────────────────────────────────────── */}
      <div className="mb-10 grid grid-cols-3 divide-x divide-gray-200 rounded-xl border border-gray-200 bg-gray-50">
        <div className="px-6 py-5 text-center">
          <p className="text-2xl font-bold text-gray-900">Volunteer</p>
          <p className="mt-1 text-xs text-gray-500">Non-paid civic role</p>
        </div>
        <div className="px-6 py-5 text-center">
          <p className="text-2xl font-bold text-gray-900">Zone-scoped</p>
          <p className="mt-1 text-xs text-gray-500">Geographic or topic focus</p>
        </div>
        <div className="px-6 py-5 text-center">
          <p className="text-2xl font-bold text-gray-900">5 tools</p>
          <p className="mt-1 text-xs text-gray-500">Dedicated admin portal</p>
        </div>
      </div>

      {/* ── What you'll do ───────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold text-gray-900">What you&apos;ll do</h2>
        <p className="mb-6 text-sm text-gray-500">
          Community admins are trusted reviewers. Here&apos;s what the role involves day-to-day.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {ABILITIES.map(({ emoji, title, desc }) => (
            <div key={title} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white px-5 py-5">
              <span className="mt-0.5 text-lg" aria-hidden="true">{emoji}</span>
              <div>
                <p className="mb-0.5 text-sm font-semibold text-gray-900">{title}</p>
                <p className="text-sm text-gray-600">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Inside the Admin Portal ──────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold text-gray-900">Inside the Community Admin Portal</h2>
        <p className="mb-2 text-sm text-gray-500">
          Once onboarded, you access all five tools at{' '}
          <Link href="/dashboard" className="font-medium text-green-700 underline underline-offset-2 hover:text-green-900">
            /dashboard
          </Link>
          .
        </p>
        <div className="grid gap-3">
          {PORTAL_TOOLS.map(({ emoji, label, route, desc }) => (
            <div key={label} className="rounded-xl border border-gray-100 bg-white px-5 py-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-lg" aria-hidden="true">{emoji}</span>
                <p className="text-sm font-semibold text-gray-900">{label}</p>
                <span className="ml-auto font-mono text-xs text-gray-400">{route}</span>
              </div>
              <p className="text-sm leading-relaxed text-gray-600">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Your impact ──────────────────────────────────────── */}
      <section aria-label="Admin impact" className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Your contribution matters</h2>
        <div className="grid grid-cols-3 divide-x divide-gray-200 rounded-xl border border-gray-200 bg-white">
          <div className="px-4 py-5 text-center">
            <p className="text-2xl font-bold text-green-600">Your pace</p>
            <p className="mt-1 text-xs leading-snug text-gray-500">No minimum quota — work at the pace that fits your schedule</p>
          </div>
          <div className="px-4 py-5 text-center">
            <p className="text-2xl font-bold text-green-600">1–3 days</p>
            <p className="mt-1 text-xs leading-snug text-gray-500">SLA target for pending org reviews</p>
          </div>
          <div className="px-4 py-5 text-center">
            <p className="text-2xl font-bold text-green-600">Real people</p>
            <p className="mt-1 text-xs leading-snug text-gray-500">Who find accurate help because of your work</p>
          </div>
        </div>
      </section>

      {/* ── Application process ──────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold text-gray-900">Application process</h2>
        <p className="mb-6 text-sm text-gray-500">How to go from interested → active admin in four steps.</p>
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-6">
          {[
            {
              n: '1',
              label: 'Post in Discussions',
              detail: 'Open a thread on GitHub Discussions under "Community Admin Applications." Briefly describe your background and the zone or topic area you want to cover.',
            },
            {
              n: '2',
              label: 'Maintainer review',
              detail: 'A project maintainer will review your background and respond with next steps, a clarifying question, or onboarding instructions within 5 business days.',
            },
            {
              n: '3',
              label: 'Onboarding & access',
              detail: 'You will receive a role invite, portal access credentials, and a short onboarding walkthrough covering review standards and escalation policy.',
            },
            {
              n: '4',
              label: 'Start reviewing',
              detail: 'Your queue is scoped to your zone from day one. You can claim items, work at your own pace, and escalate anything uncertain.',
            },
          ].map(({ n, label, detail }, i, arr) => (
            <div key={n} className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white">
                  {n}
                </span>
                {i < arr.length - 1 && <div className="mt-1 h-10 w-px bg-gray-200" />}
              </div>
              <div className="pb-5">
                <p className="text-sm font-semibold text-gray-900">{label}</p>
                <p className="mt-0.5 text-sm text-gray-600">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Who this is for ───────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Who is this for?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <span aria-hidden="true">🎯</span> Ideal candidates
            </p>
            <ul className="space-y-1.5 text-sm text-gray-700">
              <li>• Social workers, community navigators, or 211 staff</li>
              <li>• Civic advocates familiar with local services</li>
              <li>• Library staff, public health workers, or case managers</li>
              <li>• People who care about accurate community data</li>
            </ul>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <span aria-hidden="true">📋</span> What we ask
            </p>
            <ul className="space-y-1.5 text-sm text-gray-700">
              <li>• A few hours per month, at your own pace</li>
              <li>• Written rationale for every approve / deny decision</li>
              <li>• Comfort working in a structured digital tool</li>
              <li>• Sustained availability — not just a one-time sprint</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Account & data management ────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold text-gray-900">Account &amp; data management</h2>
        <p className="mb-6 text-sm text-gray-500">What you can do with your admin account.</p>
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Update your user profile</p>
            <p className="text-sm text-gray-600">
              Display name and contact details are editable via the{' '}
              <strong>Profile</strong> button in the portal header or at{' '}
              <Link href="/profile" className="font-medium text-green-700 underline underline-offset-2 hover:text-green-900">/profile</Link>.
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Sign out</p>
            <p className="text-sm text-gray-600">
              Use the <strong>Sign out</strong> button in the top-right portal header.
              You will be redirected to the ORAN homepage.
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Step down from the admin role</p>
            <p className="text-sm text-gray-600">
              To resign from the community admin role, send a message via the{' '}
              <Link href="/contact" className="font-medium text-green-700 underline underline-offset-2 hover:text-green-900">Contact page</Link>.
              Your account access will be adjusted within 1–2 business days.
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Request account deletion or data export</p>
            <p className="text-sm text-gray-600">
              GDPR / CCPA deletion or export requests are handled via the{' '}
              <Link href="/contact" className="font-medium text-green-700 underline underline-offset-2 hover:text-green-900">Contact page</Link>{' '}
              or per our{' '}
              <Link href="/privacy" className="font-medium text-green-700 underline underline-offset-2 hover:text-green-900">Privacy Policy</Link>.
              Requests are fulfilled within 30 days.
            </p>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-green-200 bg-green-50 px-6 py-6 text-center">
        <p className="mb-1 text-base font-semibold text-gray-900">Ready to help build accurate resource coverage?</p>
        <p className="mb-4 text-sm text-gray-600">
          Applications open on GitHub Discussions. Existing admins can go straight to the portal.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            Apply via GitHub Discussions ↗
          </a>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-white px-5 py-2.5 text-sm font-medium text-green-700 hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            Open Admin Portal →
          </Link>
        </div>
      </div>

      {/* ── Related nav ──────────────────────────────────────── */}
      <nav aria-label="Related pages" className="border-t border-gray-200 pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Related</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/partnerships" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Get Involved</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/partnerships/organizations" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">List an Organization</span>
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
