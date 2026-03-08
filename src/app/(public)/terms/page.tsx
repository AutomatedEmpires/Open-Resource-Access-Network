import type { Metadata } from 'next';
import Link from 'next/link';

const EFFECTIVE_DATE_ISO = '2026-03-06';
const EFFECTIVE_DATE_DISPLAY = 'March 6, 2026';
const VERSION = '0.9 — Pre-release (pending legal review)';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: "ORAN's terms of use governing platform access and conduct.",
};

const PROHIBITED = [
  'Submit false, misleading, or fraudulent service listings or verification evidence.',
  'Impersonate an organization, community administrator, or ORAN staff.',
  'Scrape, copy, or systematically harvest service data without prior written permission.',
  'Circumvent authentication, access controls, or rate limiting.',
  'Upload malicious code or attempt to compromise platform integrity.',
  'Use the platform to harass, threaten, or harm any individual or group.',
  'Infer or expose sensitive personal attributes (immigration status, health conditions, etc.) from service queries.',
];

const TOC_ITEMS: [string, string][] = [
  ['acceptance', '1. Acceptance'],
  ['eligibility', '2. Eligibility'],
  ['service-accuracy', '3. Service accuracy'],
  ['crisis', '4. Crisis disclaimer'],
  ['conduct', '5. Prohibited conduct'],
  ['ugc', '6. User content'],
  ['ip', '7. Intellectual property'],
  ['liability', '8. Liability'],
  ['governing-law', '9. Governing law'],
  ['changes', '10. Changes'],
];

export default function TermsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {/* Header */}
      <div className="mb-10 border-b border-gray-200 pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
          <span className="text-xl" aria-hidden="true">📄</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">Terms of Use</h1>
        <div className="flex flex-wrap gap-3 text-sm text-gray-500">
          <span>{VERSION}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={EFFECTIVE_DATE_ISO}>Effective {EFFECTIVE_DATE_DISPLAY}</time>
        </div>
      </div>

      {/* Legal review notice */}
      <div className="mb-10 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-sm font-semibold text-amber-900">Under legal review</p>
        <p className="mt-1 text-sm text-amber-800 leading-relaxed">
          These terms are operative now but a formally reviewed document is in preparation.
          By using ORAN, you agree to the provisions below. The terms will be updated with formal
          legal review before ORAN accepts general-public traffic at scale.
        </p>
      </div>

      {/* Table of contents */}
      <nav aria-label="Section navigation" className="mb-10 rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">Sections</p>
        <ol className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {TOC_ITEMS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-indigo-600 hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* 1. Acceptance */}
      <section className="mb-8" id="acceptance">
        <h2 className="mb-3 text-base font-semibold text-gray-900">1. Acceptance of terms</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          By accessing or using the Open Resource Access Network (&ldquo;ORAN&rdquo;,
          &ldquo;the platform&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), you agree to be
          bound by these Terms of Use. If you do not agree, do not use the platform. Continued
          use after any updated effective date constitutes acceptance of the updated terms,
          provided material changes are communicated in advance.
        </p>
      </section>

      {/* 2. Eligibility */}
      <section className="mb-8" id="eligibility">
        <h2 className="mb-3 text-base font-semibold text-gray-900">2. Eligibility</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          You must be at least 13 years old to create an account. By creating an account, you
          represent that you meet this requirement. Users under 18 should have parental or guardian
          awareness of their use of the platform.
        </p>
      </section>

      {/* 3. Service accuracy */}
      <section className="mb-8" id="service-accuracy">
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          3. Service information and accuracy
        </h2>
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="mt-0.5 shrink-0 text-base" aria-hidden="true">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Service information may be outdated.
            </p>
            <p className="mt-1 text-sm text-amber-800">
              Always confirm hours, eligibility, and availability directly with the service
              provider before acting on any information found on ORAN.
            </p>
          </div>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-gray-700">
          ORAN provides best-effort verified information about government, nonprofit, and community
          services. While we use community review, automated verification, and confidence scoring
          to maintain data quality, we cannot guarantee that any listing is current, complete, or
          accurate at the time you access it. Service hours, eligibility criteria, phone numbers,
          and locations may change without notice.
        </p>
        <p className="text-sm leading-relaxed text-gray-700">
          ORAN does not guarantee eligibility for any service. Language such as &ldquo;may
          qualify&rdquo; on search results is an indication only — final eligibility is determined
          solely by the service provider.
        </p>
      </section>

      {/* 4. Crisis disclaimer */}
      <section className="mb-8" id="crisis">
        <h2 className="mb-3 text-base font-semibold text-gray-900">4. Crisis disclaimer</h2>
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <span className="mt-0.5 shrink-0 text-base" aria-hidden="true">🚨</span>
          <div>
            <p className="text-sm font-semibold text-red-900">ORAN is not an emergency service.</p>
            <p className="mt-1 text-sm text-red-800">
              If you or someone else is in immediate danger, call <strong>911</strong>. For mental
              health crises, call or text <strong>988</strong>. For social service emergencies,
              call <strong>211</strong>.
            </p>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-gray-700">
          ORAN is a service-discovery platform. It is not a substitute for emergency services,
          mental health crisis lines, or immediate in-person support. Do not rely on ORAN during
          an active emergency. In any life-threatening situation, call 911 immediately.
        </p>
      </section>

      {/* 5. Prohibited conduct */}
      <section className="mb-8" id="conduct">
        <h2 className="mb-3 text-base font-semibold text-gray-900">5. Prohibited conduct</h2>
        <p className="mb-3 text-sm text-gray-700">You agree not to:</p>
        <ul className="space-y-2 text-sm text-gray-700">
          {PROHIBITED.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-red-400" aria-hidden="true">✗</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 6. User-generated content */}
      <section className="mb-8" id="ugc">
        <h2 className="mb-3 text-base font-semibold text-gray-900">6. User-generated content</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          By submitting service listings, feedback ratings, verification evidence, or other content
          to ORAN, you grant ORAN a perpetual, royalty-free, worldwide license to use, display, and
          distribute that content as part of the platform. You warrant that you have the right to
          submit the content and that it is accurate to the best of your knowledge.
        </p>
      </section>

      {/* 7. Intellectual property */}
      <section className="mb-8" id="ip">
        <h2 className="mb-3 text-base font-semibold text-gray-900">7. Intellectual property</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          The ORAN platform code is open source under the MIT License, available on{' '}
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline hover:text-indigo-800"
          >
            GitHub
          </a>
          . Service data is made available under Creative Commons Zero (CC0) where applicable
          to maximize reuse. The ORAN name and marks are proprietary.
        </p>
      </section>

      {/* 8. Limitation of liability */}
      <section className="mb-8" id="liability">
        <h2 className="mb-3 text-base font-semibold text-gray-900">8. Limitation of liability</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          To the maximum extent permitted by applicable law, ORAN and its operators are not liable
          for any indirect, incidental, special, consequential, or punitive damages arising from
          your use of or reliance on information found on the platform. The platform is provided
          &ldquo;as is&rdquo; without warranty of any kind. Our total liability for any claim
          shall not exceed the amount you paid to use the platform (if any) in the 12 months
          preceding the claim.
        </p>
      </section>

      {/* 9. Governing law */}
      <section className="mb-8" id="governing-law">
        <h2 className="mb-3 text-base font-semibold text-gray-900">9. Governing law</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          Governing jurisdiction will be specified as part of the formal legal review. This section
          will be updated before general-public launch.
        </p>
      </section>

      {/* 10. Changes to terms */}
      <section className="mb-10" id="changes">
        <h2 className="mb-3 text-base font-semibold text-gray-900">10. Changes to these terms</h2>
        <p className="text-sm leading-relaxed text-gray-700">
          We will post changes on this page with a revised version number and effective date.
          Material changes will be communicated to registered users by email before taking effect.
          Continued use after the effective date of changes constitutes acceptance.
        </p>
      </section>

      {/* Contact CTA */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Questions about these terms?</p>
          <p className="mt-0.5 text-xs text-gray-500">We&rsquo;re happy to clarify.</p>
        </div>
        <Link
          href="/contact"
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Contact us →
        </Link>
      </div>
    </div>
  );
}
