export interface RateLimitState {
  key: string;
  count: number;
  windowStart: number;
  exceeded: boolean;
}

const rateLimitWindows = new Map<string, { count: number; windowStart: number }>();

// ============================================================
// PRUNING — prevents unbounded memory growth
// ============================================================

/** Max staleness before an entry is eligible for pruning (10 minutes) */
const MAX_STALE_MS = 10 * 60 * 1_000;
/** Hard cap on tracked keys; oldest are evicted if exceeded */
const MAX_RATE_LIMIT_ENTRIES = 10_000;
/** Run a full prune sweep every N calls */
const PRUNE_INTERVAL = 100;
let pruneCounter = 0;

function maybePrune(): void {
  pruneCounter++;
  if (pruneCounter < PRUNE_INTERVAL && rateLimitWindows.size <= MAX_RATE_LIMIT_ENTRIES) return;
  pruneCounter = 0;

  const now = Date.now();
  for (const [k, entry] of rateLimitWindows.entries()) {
    if (now - entry.windowStart > MAX_STALE_MS) {
      rateLimitWindows.delete(k);
    }
  }
}

// ============================================================
// CHECK
// ============================================================

export function checkRateLimit(
  key: string,
  options: {
    windowMs: number;
    maxRequests: number;
  }
): RateLimitState {
  maybePrune();

  const now = Date.now();
  const window = rateLimitWindows.get(key);

  if (!window || now - window.windowStart > options.windowMs) {
    rateLimitWindows.set(key, { count: 1, windowStart: now });
    return { key, count: 1, windowStart: now, exceeded: false };
  }

  const newCount = window.count + 1;
  rateLimitWindows.set(key, { count: newCount, windowStart: window.windowStart });

  return {
    key,
    count: newCount,
    windowStart: window.windowStart,
    exceeded: newCount > options.maxRequests,
  };
}

export function resetRateLimitsForTests(): void {
  rateLimitWindows.clear();
  pruneCounter = 0;
}
