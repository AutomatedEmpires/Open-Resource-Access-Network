import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Partnerships & Get Involved',
  description:
    'List your organization on ORAN, partner with us, donate, or volunteer to help connect people to verified services.',
};

export default function PartnershipsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-20 min-h-[60vh]">
      <div className="flex flex-col items-center text-center mb-12">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-violet-50 text-2xl">
          🤝
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Get Involved</h1>
        <p className="text-gray-500 max-w-md leading-relaxed">
          ORAN is a civic network powered by real organizations and real people.
          Join us in making verified services accessible to everyone.
        </p>
      </div>

      {/* Opportunity cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          {
            icon: '🏢',
            title: 'List Your Organization',
            description:
              'Make your services discoverable to people who need them. Free to list — we verify and publish.',
            cta: 'Coming soon',
          },
          {
            icon: '🔗',
            title: 'Institutional Partnerships',
            description:
              'Hospitals, libraries, schools, government agencies — partner to expand coverage and data quality.',
            cta: 'Coming soon',
          },
          {
            icon: '💛',
            title: 'Donate',
            description:
              'Support the infrastructure that keeps real help findable. Every contribution improves data freshness and reach.',
            cta: 'Coming soon',
          },
          {
            icon: '🙋',
            title: 'Volunteer',
            description:
              'Help verify service listings in your community, moderate submissions, or contribute to the codebase.',
            cta: 'Coming soon',
          },
        ].map(({ icon, title, description, cta }) => (
          <div
            key={title}
            className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col gap-3"
          >
            <span className="text-2xl">{icon}</span>
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-500 leading-relaxed flex-1">{description}</p>
            <span className="inline-block rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-400 w-fit">
              {cta}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
