import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: "ORAN's terms of service governing platform use.",
};

export default function TermsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-20 flex flex-col items-center text-center min-h-[60vh]">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-2xl">
        📄
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-3">Terms of Use</h1>
      <p className="text-gray-500 max-w-md leading-relaxed mb-8">
        By using ORAN, you agree that service information may change and you should always confirm
        eligibility and availability directly with providers. Our complete terms of service will
        be published here.
      </p>
      <span className="rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-500">
        Full terms coming soon
      </span>
    </div>
  );
}
