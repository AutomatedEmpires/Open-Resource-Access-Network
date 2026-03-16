# ORAN Integrations

---

## Implementation Status (Truth Contract)

This doc describes both **Implemented** and **Planned** integrations. When it conflicts with executable behavior, follow docs/SSOT.md.

Implemented today:

- Local Postgres/PostGIS via db/docker-compose.yml.
- SQL migrations in db/migrations/**.
- Optional Microsoft Entra ID wiring (middleware gating when env vars exist).
- Sentry wrapper exists; DSN-dependent activation.
- Azure Application Insights (connection-string-dependent; `src/instrumentation.ts` + `src/services/telemetry/appInsights.ts`).
- Azure Maps geocoding service (`src/services/geocoding/azureMaps.ts`).
- Azure AI Translator service (`src/services/i18n/translator.ts`).

Platform direction:

- **Azure-first** for hosting, production DB, secrets, observability, geocoding, and translation.
- See `docs/platform/DEPLOYMENT_AZURE.md` and `docs/platform/PLATFORM_AZURE.md`.

Implemented (recently):

- Full RBAC enforcement (middleware + API route guards + `shouldEnforceAuth()` production fail-closed).
- Hybrid feature flags with a DB-backed authoritative catalog when `DATABASE_URL` is configured, plus an in-memory fallback for local development and runtime recovery.
- Content Security Policy (see ADR-0005).
- Rate limiting on all API routes with Retry-After headers, with Redis-backed shared enforcement available for high-value endpoints when `REDIS_URL` is configured.
- Azure Communication Services — transactional email dispatch for notification channel='email' (`src/services/email/azureEmail.ts`).
- Azure Cache for Redis — search result caching with 5-min TTL (`src/services/cache/redis.ts`, `src/services/search/cache.ts`).
- Azure Functions Timer Trigger — hourly SLA breach checker (`functions/checkSlaBreaches/`, `src/app/api/internal/sla-check/route.ts`).
- Azure OpenAI — post-retrieval summarization and guarded intent-enrichment hooks (`src/services/chat/llm.ts`, `src/services/chat/intentEnrich.ts`).
- Azure Speech — authenticated TTS summary endpoint behind `tts_summaries` (`src/services/tts/azureSpeech.ts`, `src/app/api/tts/summary/route.ts`).

Planned:

- Any external 211 API integration.

## Authentication: Microsoft Entra ID

ORAN uses [Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/) for authentication and session management via NextAuth.js with the Azure AD provider.

Optional auth providers are deliberately gated:

- Apple OAuth is enabled only when `ORAN_ENABLE_APPLE_AUTH=1` is set alongside `APPLE_CLIENT_ID` and `APPLE_CLIENT_SECRET`.
- Google OAuth is enabled only when `ORAN_ENABLE_GOOGLE_AUTH=1` is set alongside Google client credentials.
- Credentials auth supports email, username, or phone number plus password and must be explicitly enabled in production with `ORAN_ENABLE_CREDENTIALS_AUTH=1`.
- A single `user_profiles` row may now support both Microsoft Entra sign-in and password-based credentials sign-in when a password hash is present; credentials lookup is keyed by stored password hash, not by forcing `auth_provider = 'credentials'`.
- Phone is an alternate identifier for credentials auth only; ORAN does not currently implement SMS or OTP-based phone authentication.

### Configuration

- Environment variables required:
  - `AZURE_AD_CLIENT_ID`
  - `AZURE_AD_CLIENT_SECRET`
  - `AZURE_AD_TENANT_ID`
  - `NEXTAUTH_URL` (e.g., `https://yourapp.azurewebsites.net`)
  - `NEXTAUTH_SECRET` (random secret for JWT encryption)
- Optional provider variables:
  - `APPLE_CLIENT_ID`
  - `APPLE_CLIENT_SECRET`
  - `ORAN_ENABLE_APPLE_AUTH=1`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `ORAN_ENABLE_GOOGLE_AUTH=1`
  - `ORAN_ENABLE_CREDENTIALS_AUTH=1`

### Implementation

- `src/proxy.ts`: JWT extraction via `getToken()` + role enforcement via `isRoleAtLeast()` for protected page routes.
- `src/app/api/auth/[...nextauth]/route.ts`: NextAuth.js handler with Azure AD provider. Rate-limited per IP.
- `src/app/providers.tsx`: client-side `SessionProvider` boundary for authenticated UI surfaces.
- `src/services/auth/guards.ts`: `isRoleAtLeast()`, `requireMinRole()`, `requireOrgAccess()`, `requireOrgRole()`.
- `src/services/auth/session.ts`: `getAuthContext()` for server-side session extraction; `shouldEnforceAuth()` for production fail-closed behavior.
- Roles: currently derived from org memberships via `organization_members` table. Entra ID app roles planned.

### Protected Routes

| Route Pattern         | Minimum Role     |
|-----------------------|-----------------|
| `/saved`, `/profile`  | seeker (any auth)|
| `/claim`, `/org/**`   | host_member      |
| `/queue`, `/verify`   | community_admin  |
| `/approvals/**`       | oran_admin       |

Status: Implemented — middleware enforces role-based page access; API routes enforce auth+RBAC server-side.

---

## Hosting: Azure App Service (Azure-first)

ORAN is deployed to **Azure App Service (Linux)** with Node.js 20 LTS.

- Deployment guide: `docs/platform/DEPLOYMENT_AZURE.md`
- Deploy workflow: `.github/workflows/deploy-azure-appservice.yml`
- Secrets: App Service Application Settings and/or Azure Key Vault references
- Bootstrap helper: `scripts/azure/bootstrap.sh` now provisions the core web stack plus Azure Maps account parity, but still requires a caller-supplied scoped `--azure-maps-sas-token` secret.

---

## Database: PostgreSQL + PostGIS (Azure in production)

ORAN runs on PostgreSQL with the PostGIS extension.

Production target (Azure-first):

- **Azure Database for PostgreSQL Flexible Server** with PostGIS enabled.

Optional alternative:

- Neon can be used for non-Azure environments, as long as the `DATABASE_URL` contract is maintained.

### Configuration

- Environment variable: `DATABASE_URL` (PostgreSQL connection string; SSL required in production)

### ORM: Drizzle ORM

Status: Raw SQL migrations are the source of truth today.

- Implemented: migrations in db/migrations/** (plain SQL files).
- Implemented: `.github/workflows/db-migrate.yml` applies the SQL migration chain via `psql` and records applied files in `schema_migrations`.
- Drizzle remains part of the repository for schema typing and related tooling, not as the production migration orchestrator.

### PostGIS

- Enable extension: `CREATE EXTENSION IF NOT EXISTS postgis;`
- Location geometry column: `geom GEOMETRY(Point, 4326)`
- Spatial queries use `ST_DWithin` for radius search and `ST_MakeEnvelope` for bbox search

---

## Feature Flags

ORAN uses a hybrid in-house feature flag service. When `DATABASE_URL` is configured, the `feature_flags` table is the authoritative catalog; otherwise the service falls back to an in-memory baseline and last-known-good cache.

### Interface (`src/services/flags/flags.ts`)

```typescript
interface FlagService {
  isEnabled(flagName: string, subjectKey?: string): Promise<boolean>;
  getFlag(flagName: string): Promise<FeatureFlag | null>;
  setFlag(flagName: string, enabled: boolean, rolloutPct?: number): Promise<void>;
}
```

Current implementation notes:

- The expanded catalog is maintained in `db/migrations/0035_feature_flag_catalog.sql`.
- DB-backed writes record best-effort audit metadata and keep the in-memory fallback synchronized.
- Safety-critical AI flags default off unless explicitly enabled.

### Representative Flags

| Flag Name       | Default | Description |
|-----------------|---------|-------------|
| `llm_summarize` | false   | Enable LLM post-retrieval summarization |
| `content_safety_crisis` | true | Run Azure AI Content Safety as the second-layer crisis gate |
| `vector_search` | false | Enable pgvector-backed semantic search and re-ranking |
| `llm_intent_enrich` | false | Enable LLM-based intent enrichment for ambiguous chat queries |
| `multilingual_descriptions` | false | Enable translated service descriptions post-retrieval |
| `tts_summaries` | false | Enable spoken service summaries via Azure Speech |
| `map_enabled`   | true    | Show map surface in nav |
| `feedback_form` | true    | Allow seeker feedback submission |
| `host_claims`   | true    | Allow new host claims |

For the full registry, see `src/services/flags/README.md` and `src/services/flags/flags.ts`.

---

## Error Tracking: Sentry

ORAN uses [Sentry](https://sentry.io) for error monitoring and performance tracking.

### Configuration

- Environment variable: `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN` for source map uploads

### Wrapper (`src/services/telemetry/sentry.ts`)

Provides typed wrappers:

- `captureException(error, context?)` — report errors
- `captureMessage(message, level?)` — report events
- `addBreadcrumb(message, category?, data?)` — add context

### Privacy Rules

- No user PII in Sentry events
- SessionId (UUID) is allowed as a correlation identifier
- Location data: city-level only, no coordinates in Sentry

### Azure-first note

- **Azure Application Insights** is now the primary production observability backend (see below).
- If Sentry is also used, it must remain strictly PII-free per `docs/SECURITY_PRIVACY.md`.

---

## Observability: Azure Application Insights

ORAN uses **Azure Application Insights** (backed by a Log Analytics workspace) as the primary production telemetry backend.

### Configuration

- Environment variable: `APPLICATIONINSIGHTS_CONNECTION_STRING`
- The SDK auto-initializes via the Next.js instrumentation hook (`src/instrumentation.ts`).

### Wrapper (`src/services/telemetry/appInsights.ts`)

Provides typed wrappers:

- `trackException(error, context?)` — report errors
- `trackEvent(name, properties?)` — report custom events
- `trackMetric(name, value)` — report numeric metrics
- `trackTrace(message, severityLevel?)` — structured log entries
- `flush()` — drain pending telemetry

### Auto-instrumentation

- HTTP incoming/outgoing requests
- PostgreSQL queries (via `pg` driver)
- Azure SDK instrumentation is disabled to reduce noise

### Privacy Rules

- Same PII constraints as Sentry: no user PII in telemetry events.
- Session correlation uses anonymous IDs only.

---

## Geocoding: Azure Maps

ORAN uses **Azure Maps** (G2 Gen2 SKU) for geocoding queries.

### Configuration

- Server-side geocoding key: `AZURE_MAPS_KEY` (stored as Key Vault reference in App Service)
- Interactive web map token broker: `AZURE_MAPS_SAS_TOKEN` (scoped SAS token returned by `/api/maps/token`)
- Production resource: `oranhf57ir-prod-maps` in `westus2`
- Provisioning status: the Azure Maps account is provisioned by `infra/main.bicep`

### Service (`src/services/geocoding/azureMaps.ts`)

```typescript
interface AzureMapsGeocodingResult {
  lat: number;
  lon: number;
  formattedAddress: string;
  confidence: 'High' | 'Medium' | 'Low';
  type: string;
}
```

- `isConfigured()` — checks for API key
- `geocode(query, options?)` — forward geocoding with optional bbox/country filters
- `reverseGeocode(lat, lon)` — reverse geocoding

### Privacy

- Only query text is sent to Azure Maps; no user PII.
- Approximate location by default (city-level for seekers).
- Raw Azure Maps shared keys are never exposed to the client. The web map consumes only the brokered SAS token from `/api/maps/token`.

---

## Translation: Azure AI Translator

ORAN uses **Azure AI Translator** (F0 free tier — 2M characters/month) for dynamic content translation.

### Configuration

- Environment variables:
  - `AZURE_TRANSLATOR_KEY` (stored as Key Vault reference)
  - `AZURE_TRANSLATOR_ENDPOINT` (`https://api.cognitive.microsofttranslator.com/`)
  - `AZURE_TRANSLATOR_REGION` (`westus2`)
- Provisioning status: supported by application code and runtime validation; not currently provisioned by `infra/main.bicep`

### Service (`src/services/i18n/translator.ts`)

```typescript
async function translate(request: TranslateRequest): Promise<TranslateResult>
async function translateBatch(texts: string[], to: string, from?: string): Promise<TranslateResult[]>
```

- `isConfigured()` — checks for key + endpoint + region
- In-memory LRU cache (500 entries) to minimize API calls
- Batch support (up to 100 items per API call)
- 10,000 character limit per text; 8-second timeout

### Privacy

- Only service record text (names, descriptions) is translated; no user PII.
- Translation cache is server-side only.

---

## 211 API (Interface Only)

ORAN defines an interface for potential 211 API integration. **No live 211 API is wired up without explicit configuration.**

### Interface (future)

```typescript
interface TwoOneOneService {
  search(params: { zip: string; category: string }): Promise<ExternalService[]>;
  isConfigured(): boolean;
}
```

### Policy

- Results from 211 API must go through the same staging/validation pipeline as CSV imports
- Never served directly to seekers from external API without verification step
- Feature flag `use_211_api` must be enabled

---

## Integration Snapshot

| Integration | Purpose | Status |
|-------------|---------|--------|
| Azure Application Insights | Production observability + telemetry | **Implemented** |
| Azure Maps | Geocoding (forward + reverse) | **Implemented** |
| Azure AI Translator | Dynamic content translation (F0 free tier) | **Implemented** |
| Azure Cache for Redis | Search result caching and shared cache infrastructure | **Implemented** |
| Azure Blob Storage | Evidence file storage for verification | Planned |
| Azure OpenAI | LLM summarization and intent enrichment hooks (both flag-gated) | **Implemented** |
| Azure Communication Services (Email) | Email notifications to hosts (Azure-first) | **Implemented** |
| Azure Functions | Queue and timer workloads for ingestion and operational workflows | **Implemented** |
| Azure Speech | Optional spoken summaries behind `tts_summaries` | **Implemented** |
| Codecov | Test coverage reporting in CI | Configured |

---

## GitHub-Native Integrations

ORAN uses GitHub-native automation for quality and security.

### CI: GitHub Actions

- Workflow: `.github/workflows/ci.yml`
- Runs lint, typecheck, tests (with coverage), and build on PRs and main.

### Dependency Updates: Dependabot

- Config: `.github/dependabot.yml`
- Weekly update PRs for npm dependencies and GitHub Actions.

### Security Scanning: CodeQL

- Workflow: `.github/workflows/codeql.yml`
- Runs on PRs, pushes to main, and a weekly schedule.
