# Runbook: Observability Outage

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Security Lead, Release Manager
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

Respond when ORAN's privacy-filtered Sentry error, trace, release, or source-map
signals are delayed or unavailable. Vercel deployment/runtime logs and direct
synthetic checks provide the independent fallback; observability loss must not
be mistaken for application recovery.

## Safety Constraints

- Do not add chat text, search text, precise location, form content, email,
  phone, auth headers, cookies, tokens, or raw error messages to restore signal.
- Preserve server-side redaction and sampling controls during the incident.
- Treat simultaneous telemetry loss and user-facing degradation as at least
  SEV-2 until direct checks establish the blast radius.

## Triggers

- Sentry event volume drops unexpectedly while production traffic remains.
- A known safe synthetic failure does not appear in the dedicated ORAN project.
- A release lacks expected source maps or release association.
- Sentry reports an ingestion, quota, or provider incident.
- Vercel and Sentry disagree materially about function failures.

## Diagnosis

1. Verify `/api/health` and critical routes directly from outside the affected
   telemetry path.
2. Confirm the latest Vercel deployment is Ready and identify its release SHA.
3. Check the dedicated ORAN Sentry project and provider status without widening
   access to another business's project.
4. Confirm `NEXT_PUBLIC_SENTRY_DSN` is present in the correct Vercel environment.
   Check `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` only when build
   source-map upload is affected; do not print their values.
5. Inspect Vercel build output for source-map upload results and runtime logs for
   initialization errors.
6. Verify `src/instrumentation.ts`, `src/instrumentation-client.ts`, and the
   server/edge Sentry configs are included in the deployed release.

## Mitigation

1. Increase bounded direct health and journey checks while Sentry is impaired.
2. Restore the last known-good ORAN configuration or roll back the affected
   deployment; do not disable privacy filtering to gain diagnostic detail.
3. Rotate `SENTRY_AUTH_TOKEN` if exposure is possible, revoke the prior token,
   and redeploy before retrying source-map upload.
4. Record the blind interval and manually reconcile security, auth, publication,
   and scheduled-job outcomes before closing the incident.

## Validation

```bash
npx vitest run src/services/telemetry/__tests__/sentry.test.ts src/services/telemetry/__tests__/sentry-redaction.test.ts
```

Then verify:

- `/api/health` reports ready/connected
- a safe synthetic exception reaches the dedicated ORAN Sentry project
- the current release has source maps
- the event contains no raw user content, credentials, or precise location
- Vercel runtime logs and Sentry agree on the tested request outcome

## References

- `src/instrumentation.ts`
- `src/instrumentation-client.ts`
- `src/sentry.server.config.ts`
- `src/sentry.edge.config.ts`
- `src/services/telemetry/sentry.ts`
- `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`
