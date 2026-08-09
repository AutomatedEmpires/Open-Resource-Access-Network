import { Phone } from 'lucide-react';

const WASHINGTON_211_SEARCH_URL = 'https://search.wa211.org/';

export interface ResourceSearchRecoveryProps {
  className?: string;
  reason?: 'no_match' | 'temporarily_unavailable';
  showOranBrowse?: boolean;
}

/**
 * Truthful recovery path for a publication-gated search with no usable result.
 * Washington 211 stays explicitly external; ORAN never presents its records as
 * verified ORAN listings or carries private search text into the URL.
 */
export function ResourceSearchRecovery({
  className = '',
  reason = 'no_match',
  showOranBrowse = false,
}: ResourceSearchRecoveryProps) {
  const isTemporarilyUnavailable = reason === 'temporarily_unavailable';

  return (
    <section
      aria-label="Other ways to find help"
      className={`rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-left text-xs text-slate-800 ${className}`}
    >
      <p className="font-semibold text-slate-950">Try another trusted path</p>
      <p className="mt-1 leading-5 text-slate-700">
        {isTemporarilyUnavailable
          ? 'ORAN could not complete this search right now. You can retry here, or use Washington 211 while search recovers.'
          : 'ORAN will not substitute an unrelated listing. Washington 211 has a broader external resource directory and can help by phone.'}
      </p>
      <div className={`mt-3 grid gap-2 ${showOranBrowse ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {showOranBrowse ? (
          <a
            href="/directory"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-300 bg-white px-3 py-2 text-center font-semibold text-slate-900 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
          >
            Browse all ORAN listings
          </a>
        ) : null}
        <a
          href={WASHINGTON_211_SEARCH_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-300 bg-white px-3 py-2 text-center font-semibold text-slate-900 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
        >
          Search Washington 211
          <span className="sr-only"> (opens an external site)</span>
        </a>
        <a
          href="tel:211"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-700 bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          Call 211
        </a>
      </div>
      <p className="mt-2 leading-5 text-slate-600">
        Washington 211 is outside ORAN. Confirm current eligibility, hours, and availability
        directly with any provider it suggests.
      </p>
    </section>
  );
}
