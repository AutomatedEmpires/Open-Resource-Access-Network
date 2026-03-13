# Security Services

Security-critical utilities (rate limiting, abuse controls, input validation helpers).

Production note:

- `checkRateLimit()` remains the deterministic in-memory fallback for local/test use.
- `checkRateLimitShared()` uses Redis when `REDIS_URL` is configured and falls back to memory when Redis is unavailable, allowing high-value endpoints to enforce limits across scaled web instances.

Keep changes conservative and well-tested.
