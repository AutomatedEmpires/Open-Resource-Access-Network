import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'List Your Organization | ORAN Partnerships',
  description:
    'Register your nonprofit, government agency, or community service organization on ORAN. Free, community-verified, discoverable by people actively searching for help.',
};

const HOST_PORTAL_TOOLS = [
  {
    emoji: '📊',
    label: 'Dashboard',
    route: '/host',
    desc: 'At-a-glance overview of your orgs, services, locations, team size, claims in flight, and any SLA-breached items that need attention.',
  },
  {
    emoji: '🏷️',
    label: 'Organization Profile',
    route: '/org/profile',
    desc: 'Build your public-facing profile: logo, description, mission, contact links. Complete profiles earn a Verified badge faster.',
  },
  {
    emoji: '🏢',
    label: 'Organizations',
    route: '/org',
    desc: 'View and manage all organization records tied to your account. Each record tracks verification status and listing history.',
  },
  {
    emoji: '⚙️',
    label: 'Services',
    route: '/services',
    desc: 'Create, update, and archive individual services your org provides — hours, eligibility, languages, intake instructions, and more.',
  },
  {
    emoji: '🗂️',
    label: 'Resource Studio',
    route: '/resource-studio',
    desc: 'A card-based workflow for building and submitting complete resource records. Start new listings, reopen drafts, or fix returned items.',
  },
  {
    emoji: '📍',
    label: 'Locations',
    route: '/locations',
    desc: 'Manage physical service sites. Correct addresses, hours, and site details before they go stale — stale records lower your confidence score.',
  },
  {
    emoji: '📋',
    label: 'Forms',
    route: '/host-forms',
    desc: 'Create structured intake forms specific to your organization or service area. Helps seekers submit pre-qualified eligibility information.',
  },
  {
    emoji: '👥',
    label: 'Team',
    route: '/admins',
    desc: 'Invite staff members, assign host admin roles, and clear pending invites. Multiple team members can manage your account.',
  },
  {
    emoji: '📤',
    label: 'Claim',
    route: '/claim',
    desc: 'Submit a new organization claim or continue one already in flight. Each claim goes through community admin review before going live.',
  },
];

const FAQ = [
  {
    q: 'Do I need nonprofit status to list?',
    a: 'No. Any community service organization, government agency, library, clinic, mutual aid group, or social enterprise providing a genuine public-facing service is eligible.',
  },
  {
    q: 'What if my information changes frequently?',
    a: 'Use the Services or Locations section of the host portal to push updates at any time. Major changes trigger a lightweight re-verification pass to keep your confidence score accurate.',
  },
  {
    q: 'Can I have multiple service locations?',
    a: 'Yes. Each physical location is a separate record but linked to the same org account. Mobile or outreach services can be listed with approximate service-area boundaries.',
  },
  {
    q: 'What if my submission is denied?',
    a: 'Administrators provide a reason and, where possible, a corrective path. Resubmission is always free. Escalation to an ORAN admin is available if you believe a denial was made in error.',
  },
  {
    q: 'Is there a cost?',
    a: 'No. ORAN listings are and will remain free for service providers. We are funded by institutional partnerships and community supporters.',
  },
];

export default function OrganizationsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-8 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/partnerships" className="hover:text-gray-800">Get Involved</Link>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-gray-900">Organizations</span>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="mb-10">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50">
          <span className="text-xl" aria-hidden="true">🏢</span>
        </div>
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-gray-900">List Your Organization</h1>
        <p className="mb-2 max-w-xl text-base leading-relaxed text-gray-600">
          Listing on ORAN is free, takes 10–20 minutes, and makes your services reach the people who
          need them most — including 211 networks and downstream social work platforms.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/claim"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Claim your organization →
          </Link>
          <Link
            href="/host"
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-5 py-2.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Already listed? Open Host Portal →
          </Link>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          A free account is required. You&apos;ll be prompted to sign in before the claim form opens.
        </p>
      </div>

      {/* ── Stats bar ────────────────────────────────────────── */}
      <div className="mb-10 grid grid-cols-3 divide-x divide-gray-200 rounded-xl border border-gray-200 bg-gray-50">
        <div className="px-6 py-5 text-center">
          <p className="text-2xl font-bold text-gray-900">Free</p>
          <p className="mt-1 text-xs text-gray-500">Always free to list</p>
        </div>
        <div className="px-6 py-5 text-center">
          <p className="text-2xl font-bold text-gray-900">1–3 days</p>
          <p className="mt-1 text-xs text-gray-500">Typical review time</p>
        </div>
        <div className="px-6 py-5 text-center">
          <p className="text-2xl font-bold text-gray-900">30+</p>
          <p className="mt-1 text-xs text-gray-500">Service categories</p>
        </div>
      </div>

      {/* ── What you get ─────────────────────────────────────── */}
      <section aria-label="Listing benefits" className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">What your listing unlocks</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { emoji: '🔍', label: 'Searchable', sub: 'Map, directory & keyword search' },
            { emoji: '📡', label: '211-ready', sub: 'Included in 211 API exports' },
            { emoji: '🏅', label: 'Confidence score', sub: 'Ranked by verification depth' },
            { emoji: '🔄', label: 'Always updatable', sub: 'Edit anytime via the portal' },
          ].map(({ emoji, label, sub }) => (
            <div key={label} className="flex flex-col items-center rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-5 text-center">
              <span className="mb-2 text-2xl" aria-hidden="true">{emoji}</span>
              <p className="text-sm font-semibold text-gray-900">{label}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Application pipeline ─────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold text-gray-900">Application pipeline</h2>
        <p className="mb-6 text-sm text-gray-500">From first submission to live listing and beyond.</p>
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-6">
          {[
            {
              n: '1',
              label: 'Submit a claim',
              detail: 'Fill out the structured claim form — service categories, hours, eligibility, contact, and location. Takes 10–20 minutes.',
              tag: null,
            },
            {
              n: '2',
              label: 'Community admin review',
              detail: 'A trained admin in your geographic zone reviews your submission. They may request clarification or cross-reference public sources.',
              tag: '1–3 business days',
            },
            {
              n: '3',
              label: 'Listing goes live',
              detail: 'Approved orgs appear in ORAN search, map views, and the 211-compatible API. A confidence score is assigned based on verification depth.',
              tag: null,
            },
            {
              n: '4',
              label: 'Manage via Host Portal',
              detail: 'Once approved, your team gets an authenticated host workspace to update hours, services, locations, and profile at any time without re-review.',
              tag: 'Ongoing',
            },
            {
              n: '5',
              label: 'Re-verification on major changes',
              detail: 'Significant changes to eligibility, services, or operating hours trigger a lightweight re-verification to maintain your confidence score.',
              tag: null,
            },
          ].map(({ n, label, detail, tag }, i, arr) => (
            <div key={n} className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                  {n}
                </span>
                {i < arr.length - 1 && <div className="mt-1 h-10 w-px bg-gray-200" />}
              </div>
              <div className="pb-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900">{label}</p>
                  {tag && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{tag}</span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-gray-600">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Inside the Host Portal ───────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold text-gray-900">Inside the Host Portal</h2>
        <p className="mb-2 text-sm text-gray-500">
          Once approved, your team accesses these tools at{' '}
          <Link href="/host" className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800">
            /host
          </Link>
          .
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {HOST_PORTAL_TOOLS.map(({ emoji, label, route, desc }) => (
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

      {/* ── Account & data management ────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold text-gray-900">Account &amp; data management</h2>
        <p className="mb-6 text-sm text-gray-500">What you can do with your account once you&apos;re in the system.</p>
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Update your user profile</p>
            <p className="text-sm text-gray-600">
              Your personal profile (display name, email) is accessible from the{' '}
              <strong>Profile</strong> button in the portal header, or directly at{' '}
              <Link href="/profile" className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800">/profile</Link>.
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Update your organization profile</p>
            <p className="text-sm text-gray-600">
              Edit logo, description, mission, and public-facing details anytime inside the portal at{' '}
              <Link href="/org/profile" className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800">/org/profile</Link>.
              Changes to core fields may trigger a re-verification pass.
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Invite and manage team members</p>
            <p className="text-sm text-gray-600">
              Add or remove staff members, assign host admin roles, and revoke invitations in the{' '}
              <Link href="/admins" className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800">Team section</Link>{' '}
              of the portal.
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Sign out</p>
            <p className="text-sm text-gray-600">
              Use the <strong>Sign out</strong> button in the portal header (top right) to end your session.
              You will be redirected to the ORAN homepage.
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Request account deletion or data export</p>
            <p className="text-sm text-gray-600">
              To delete your account, remove your organization from ORAN, or request a data export under
              GDPR / CCPA, submit a request via the{' '}
              <Link href="/contact" className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800">Contact page</Link>{' '}
              or review the process in our{' '}
              <Link href="/privacy" className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800">Privacy Policy</Link>.
              Requests are processed within 30 days.
            </p>
          </div>
        </div>
      </section>

      {/* ── Institutional callout ────────────────────────────── */}
      <section className="mb-10 rounded-xl border border-teal-200 bg-teal-50 px-6 py-6">
        <div className="flex items-start gap-3">
          <span className="text-xl" aria-hidden="true">🔗</span>
          <div>
            <p className="mb-1 text-sm font-semibold text-gray-900">Hospital, library, or 211 network?</p>
            <p className="mb-3 text-sm leading-relaxed text-gray-600">
              Large institutions with high listing volumes, data-feed integration needs, or co-branding
              requirements should explore our institutional partnership track instead.
            </p>
            <Link
              href="/contact"
              className="text-sm font-medium text-teal-700 underline underline-offset-2 hover:text-teal-900"
            >
              Inquire about institutional partnerships →
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-6 text-xl font-semibold text-gray-900">Common questions</h2>
        <div className="space-y-3">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="rounded-xl border border-gray-100 bg-white px-5 py-5">
              <p className="mb-2 text-sm font-semibold text-gray-900">{q}</p>
              <p className="text-sm leading-relaxed text-gray-500">{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-indigo-200 bg-indigo-50 px-6 py-6 text-center">
        <p className="mb-1 text-base font-semibold text-gray-900">Ready to get listed?</p>
        <p className="mb-4 text-sm text-gray-600">
          The claim form takes 10–20 minutes and is reviewed by a real community administrator.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/claim"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Claim your organization →
          </Link>
          <Link
            href="/host"
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-5 py-2.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Open Host Portal →
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
          <Link href="/partnerships/admins" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Become an Admin</span>
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
