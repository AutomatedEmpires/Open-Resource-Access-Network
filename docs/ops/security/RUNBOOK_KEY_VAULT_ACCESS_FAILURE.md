# Runbook: runtime secret/configuration failure

> Historical filename retained for links. ORAN no longer uses Key Vault as its
> production secret source.

## Scope

Use this runbook when the Vercel application or an ORAN-only worker cannot read
required values from the dedicated Doppler/Vercel configuration.

## Triggers

- Readiness reports missing production settings.
- Clerk identity fails because a publishable or secret key is unavailable.
- Supabase connections fail after a credential/configuration change.
- Internal worker calls fail because `INTERNAL_API_KEY` differs by runtime.

## Diagnosis

1. Confirm the incident is in the dedicated ORAN projects; do not inspect or
   copy configuration from another business.
2. Compare the Vercel deployment's configured variable names with
   `.github/runtime/webapp-production-settings.txt` without printing values.
3. Review Doppler and Vercel audit history for the incident window.
4. Confirm environment scope (Production, Preview, or Development) and redeploy
   after correcting a value; existing deployments do not always receive changes.
5. Rotate any value that may have been exposed during diagnosis.

## Required validation

- `/api/health` returns configuration `ready` and database `connected`.
- Clerk sign-in, sign-up, sign-out, and `/api/auth/context` succeed.
- Protected routes still deny unauthenticated and underprivileged requests.
- Sentry release/error reporting works without transmitting secret values.
- Worker calls authenticate only with the ORAN `INTERNAL_API_KEY`.

## References

- `.env.example`
- `.github/runtime/webapp-production-settings.txt`
- `docs/platform/STACK_MIGRATION.md`
- `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
