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
- In-memory feature flags with typed constants and fail-closed semantics (DB-backed reads/writes planned).
- Content Security Policy (see ADR-0005).
- Rate limiting on all API routes with Retry-After headers.
- Azure Communication Services — transactional email dispatch for notification channel='email' (`src/services/email/azureEmail.ts`).
- Azure Cache for Redis — search result caching with 5-min TTL (`src/services/cache/redis.ts`, `src/services/search/cache.ts`).
- Azure Functions Timer Trigger — hourly SLA breach checker (`functions/checkSlaBreaches/`, `src/app/api/internal/sla-check/route.ts`).

Planned:
- Any external 211 API integration.

## Authentication: Microsoft Entra ID

ORAN uses [Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/) for authentication and session management via NextAuth.js with the Azure AD provider.

### Configuration
- Environment variables required:
  - `AZURE_AD_CLIENT_ID`
  - `AZURE_AD_CLIENT_SECRET`
  - `AZURE_AD_TENANT_ID`
  - `NEXTAUTH_URL` (e.g., `https://yourapp.azurewebsites.net`)
  - `NEXTAUTH_SECRET` (random secret for JWT encryption)

### Implementation
- `src/middleware.ts`: JWT extraction via `getToken()` + role enforcement via `isRoleAtLeast()` for protected page routes.
- `src/app/api/auth/[...nextauth]/route.ts`: NextAuth.js handler with Azure AD provider. Rate-limited per IP.
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
- Planned: Drizzle ORM adoption (no db/schema/** folder in the repo today).

### PostGIS
- Enable extension: `CREATE EXTENSION IF NOT EXISTS postgis;`
- Location geometry column: `geom GEOMETRY(Point, 4326)`
- Spatial queries use `ST_DWithin` for radius search and `ST_MakeEnvelope` for bbox search

---

## Feature Flags

ORAN uses a lightweight in-house feature flag interface. The database table `feature_flags` exists, but runtime usage is currently in-memory unless wired up.

### Interface (`src/services/flags/flags.ts`)
```typescript
interface FlagService {
  isEnabled(flagName: string): Promise<boolean>;
  getFlag(flagName: string): Promise<FeatureFlag | null>;
  setFlag(flagName: string, enabled: boolean, rolloutPct?: number): Promise<void>;
}
```

### Active Flags
| Flag Name       | Default | Description |
|-----------------|---------|-------------|
| `llm_summarize` | false   | Enable LLM post-retrieval summarization |
| `map_enabled`   | true    | Show map surface in nav |
| `feedback_form` | true    | Allow seeker feedback submission |
| `host_claims`   | true    | Allow new host claims |

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
- Environment variable: `AZURE_MAPS_KEY` (stored as Key Vault reference in App Service)
- Production resource: `oranhf57ir-prod-maps` in `westus2`

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

---

## Translation: Azure AI Translator

ORAN uses **Azure AI Translator** (F0 free tier — 2M characters/month) for dynamic content translation.

### Configuration
- Environment variables:
  - `AZURE_TRANSLATOR_KEY` (stored as Key Vault reference)
  - `AZURE_TRANSLATOR_ENDPOINT` (`https://api.cognitive.microsofttranslator.com/`)
  - `AZURE_TRANSLATOR_REGION` (`westus2`)

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

## Future Integrations (Planned)

| Integration | Purpose | Status |
|-------------|---------|--------|
| Azure Application Insights | Production observability + telemetry | **Implemented** |
| Azure Maps | Geocoding (forward + reverse) | **Implemented** |
| Azure AI Translator | Dynamic content translation (F0 free tier) | **Implemented** |
| Redis (Azure Cache for Redis) | Rate limiting, session quota, cache | Planned |
| Azure Blob Storage | Evidence file storage for verification | Planned |
| Azure OpenAI | LLM summarization (gated by flag; summarize retrieved records only) | Planned |
| Azure Communication Services (Email) | Email notifications to hosts (Azure-first) | Planned |
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
