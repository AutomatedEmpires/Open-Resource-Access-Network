# ORAN Integrations

---

## Authentication: Clerk

ORAN uses [Clerk](https://clerk.com) for authentication and session management.

### Configuration
- Environment variables required:
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
  - `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
  - `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
  - `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/chat`
  - `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/chat`

### Implementation
- `src/middleware.ts`: Clerk middleware protecting authenticated routes
- `src/app/layout.tsx`: `ClerkProvider` wraps the entire app (conditional on env var presence)
- Role claims stored in Clerk user's `publicMetadata.role` field
- ORAN admin provisions roles via Clerk dashboard or Clerk Backend API

### Protected Routes
| Route Pattern         | Minimum Role     |
|-----------------------|-----------------|
| `/saved`, `/profile`  | seeker (any auth)|
| `/claim`, `/org/**`   | host_member      |
| `/queue`, `/verify`   | community_admin  |
| `/approvals/**`       | oran_admin       |

---

## Database: Neon (PostgreSQL + PostGIS)

ORAN uses [Neon](https://neon.tech) serverless PostgreSQL with the PostGIS extension.

### Configuration
- Environment variable: `DATABASE_URL` (Neon connection string with `?sslmode=require`)

### ORM: Drizzle ORM
- Schema defined in `db/schema/` (future: migrate from raw SQL to Drizzle schema files)
- Migrations in `db/migrations/` (plain SQL files)
- Run migrations: `npx drizzle-kit migrate`
- Generate migrations: `npx drizzle-kit generate`

### PostGIS
- Enable extension: `CREATE EXTENSION IF NOT EXISTS postgis;`
- Location geometry column: `geom GEOMETRY(Point, 4326)`
- Spatial queries use `ST_DWithin` for radius search and `ST_MakeEnvelope` for bbox search

---

## Feature Flags

ORAN uses a lightweight in-house feature flag system backed by the `feature_flags` table.

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

---

## 211 API (Interface Only)

ORAN defines an interface for potential 211 API integration. **No live 211 API is wired up without explicit configuration.**

### Interface (`src/services/external/211.ts`) (future)
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
| Redis | Rate limiting, session quota, cache | Planned |
| AWS S3 / Cloudflare R2 | Evidence file storage for verification | Planned |
| Mapbox / Leaflet | Interactive map tiles | Planned |
| OpenAI / Anthropic | LLM summarization (gated by flag) | Planned |
| Resend / SendGrid | Email notifications to hosts | Planned |
| Codecov | Test coverage reporting in CI | Configured |
