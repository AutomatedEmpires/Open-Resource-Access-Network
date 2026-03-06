import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How ORAN collects, uses, and protects your information.',
};

export default function PrivacyPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-20 flex flex-col items-center text-center min-h-[60vh]">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-2xl">
        🔒
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-3">Privacy Policy</h1>
      <p className="text-gray-500 max-w-md leading-relaxed mb-8">
        ORAN collects and processes data — including location data — to help connect you with
        verified services. Our full privacy policy will detail what we collect, how it may be used,
        your rights under applicable law, and how to reach us with requests.
      </p>
      <span className="rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-500">
        Full policy coming soon
      </span>
    </div>
  );
}
