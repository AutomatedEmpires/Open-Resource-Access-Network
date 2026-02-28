# ORAN Engineering Log

This is a human-readable, append-only log for safety-critical and contract-level repository changes.

Rules:
- Use UTC timestamps (ISO 8601).
- Keep entries short.
- Link to PRs/issues when available.
- Do not include PII.

## Entries

- 2026-02-28T00:00:00Z — Added SSOT + operating model docs; established ADR structure; created forensic audit baseline. (docs/SSOT.md, docs/OPERATING_MODEL.md, docs/DECISIONS/*, docs/AUDIT_REPORT.md)
- 2026-02-28T00:10:00Z — Added Azure bootstrap + GitHub OIDC helper scripts for Azure-first deployment; documented scripted quickstart. (scripts/azure/*, docs/DEPLOYMENT_AZURE.md)
- 2026-02-28T03:33:20Z — Hardened API abuse controls: shared in-memory rate limiting added to search/feedback, and search confidence filtering normalized to 0–100 via `minConfidenceScore` (legacy `minConfidence` still supported). (src/services/security/rateLimit.ts, src/app/api/search/route.ts, src/app/api/feedback/route.ts)
- 2026-02-28T03:37:32Z — Hardened auth/telemetry defaults: protected routes fail closed in production when auth is unavailable/misconfigured; sanitized dev telemetry logging to avoid dumping arbitrary extra context. (src/middleware.ts, src/services/telemetry/sentry.ts)
