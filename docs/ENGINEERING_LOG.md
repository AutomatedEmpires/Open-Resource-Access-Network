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
- 2026-02-28T03:57:45Z — Hardened in-memory feature flags: clamp rollout percentage, prevent mutable reference leaks, and add unit tests for expected semantics. (src/services/flags/flags.ts, src/services/flags/__tests__/flags.test.ts)
- 2026-02-28T04:00:32Z — Aligned i18n behavior/docs: dev missing-key now throws; added unit tests; updated i18n workflow doc to match in-code dictionary implementation. (src/services/i18n/i18n.ts, src/services/i18n/__tests__/i18n.test.ts, docs/I18N_WORKFLOW.md)
