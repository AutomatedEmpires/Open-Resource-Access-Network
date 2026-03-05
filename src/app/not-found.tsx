/**
 * Custom 404 — Not Found page.
 *
 * Server component. Provides branded 404 experience with helpful navigation.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'The page you are looking for does not exist or has been moved.',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center"
    >
      <div className="rounded-full bg-blue-100 p-4 mb-6">
        <svg
          className="h-10 w-10 text-blue-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        Page not found
      </h1>
      <p className="text-gray-600 max-w-md mb-8">
        The page you&apos;re looking for doesn&apos;t exist or has been moved. Try
        searching for what you need, or head back to the home page.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/"
          className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors"
        >
          Go home
        </Link>
        <Link
          href="/directory"
          className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
        >
          Search services
        </Link>
      </div>
    </main>
  );
}
