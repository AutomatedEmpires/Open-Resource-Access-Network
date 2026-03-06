import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with the ORAN team.',
};

export default function ContactPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-20 flex flex-col items-center text-center min-h-[60vh]">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-sky-50 text-2xl">
        ✉️
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-3">Contact</h1>
      <p className="text-gray-500 max-w-md leading-relaxed mb-8">
        Have a question, found an issue, or want to partner with ORAN? A full contact form and
        support channels will be available here.
      </p>
      <span className="rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-500">
        Contact form coming soon
      </span>
    </div>
  );
}
