# ORAN runtime environment contract

This is a names-only contract. Secret values, fingerprints, connection strings,
and generated credentials must remain in Doppler and the destination provider.
The current Doppler `dev`, `stg`, and `prd` configs contain metadata only; this
document does not claim that any application value is installed.

## Required deployed web application names

| Name | Scope | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | secret, per lane | Direct PostgreSQL connection; Preview must use a disposable lane or reviewed read-only role |
| `INTERNAL_API_KEY` | secret, per lane | Authorizes internal worker-to-app calls |
| `CRON_SECRET` | secret, per lane | Authenticates Vercel cron requests |
| `NEXT_PUBLIC_SITE_URL` | public, per lane | Canonical origin for metadata, sitemap, and JSON-LD |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | public, per Clerk instance | Clerk browser identity configuration |
| `CLERK_SECRET_KEY` | secret, per Clerk instance | Clerk server identity configuration |
| `REDIS_URL` | secret, per lane | Shared rate limiting/cache required before multi-instance production |

Clerk route settings use these non-secret names and may retain the defaults in
`.env.example`: `NEXT_PUBLIC_CLERK_SIGN_IN_URL`,
`NEXT_PUBLIC_CLERK_SIGN_UP_URL`,
`NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, and
`NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`.

## Conditional provider names

| Activation | Names | Rule |
| --- | --- | --- |
| Resend | `RESEND_API_KEY`, `RESEND_FROM` | Install both together; a key without an approved sender is invalid |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN` | Venture-specific DSN only; source-map credentials are deployment-only if later added |
| Anthropic-assisted ingestion | `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TEMPERATURE`, `LLM_TIMEOUT_MS` | Optional, review-gated extraction only. `LLM_PROVIDER` must be `anthropic`; the key is required and the adapter uses Anthropic's fixed public API origin |
| NDP 211 polling | `NDP_211_POLLING_ENABLED`, `NDP_211_SUBSCRIPTION_KEY`, `NDP_211_DATA_OWNERS` | The latter two become mandatory when polling is enabled |
| Source-feed automation | `SOURCE_FEED_POLLING_ENABLED`, `SOURCE_FEED_AUTO_PUBLISH_ENABLED` | Keep disabled until cron and data-write gates pass |
| Geocoding | `NOMINATIM_BASE_URL`, `GEOCODER_USER_AGENT` | Optional override/contact identity for Nominatim |
| Site identity | `NEXT_PUBLIC_ORAN_SAME_AS`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION`, `NEXT_PUBLIC_YANDEX_SITE_VERIFICATION` | Non-secret metadata only |
| Interaction telemetry | `NEXT_PUBLIC_TELEMETRY_INTERACTIONS` | Public feature toggle; no cross-venture analytics key |
| Ingestion thresholds | `ORAN_CURATED_AUTO_PUBLISH_MIN_CONFIDENCE`, `ORAN_TRUSTED_PARTNER_AUTO_PUBLISH_MIN_CONFIDENCE`, `ORAN_INGESTION_DEGRADED_DEPENDENCIES` | Operational policy; review before enabling writes |

`NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, and
`SENTRY_TRACES_SAMPLE_RATE` are reserved in `.env.example` but are not currently
consumed by production application code. Do not install them merely to make the
config look complete.

## Retired provider names

Azure and Foundry settings, endpoints, SDKs, and adapters are prohibited. The
application rejects their presence at startup and readiness, and CI scans active
runtime code and package manifests for reintroduction. Do not install legacy
settings as placeholders and do not create a rollback or fallback path.

The only bundled optional model adapter is Anthropic for review-gated ingestion.
Seeker retrieval, crisis routing, ranking, eligibility, translation, and speech
must not depend on an external model.

## Database transport controls

`PGSSLMODE` may explicitly require TLS. `DATABASE_SSL_NO_VERIFY` must remain
unset or false in managed environments; setting it true disables certificate
verification and is an emergency diagnostic override, not a deployment setting.

## Deployment-only GitHub environment

The exact-SHA Preview workflow uses the non-runtime GitHub environment `Preview`.
Its only credential is the environment-scoped secret
`ORAN_VERCEL_PREVIEW_TOKEN`. The workflow binds the public team/project resource
IDs in source, accepts only the exact selected branch head, requires that SHA to
be the head of an open non-draft same-repository PR to `main`, and never passes a
production deployment flag.
