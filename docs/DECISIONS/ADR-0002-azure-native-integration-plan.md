# ADR-0002: Azure-Native Integration Maximization Plan

Status: Accepted

Timestamp: 2026-03-02T00:00:00Z

## Context

ORAN is Azure-first (docs/PLATFORM_AZURE.md). Several planned integrations currently use
external providers or in-memory stubs. The team has:

- **$200 Azure credits** (primary subscription)
- **Student access** (jackson.cole@snhu.edu — Azure for Students, GitHub Student Dev Pack)
- **Startup access** (automatedempires@outlook.com — Microsoft for Startups Founders Hub)
- **GitHub Copilot** (student-eligible)

Goal: maximize Azure-native services, minimize external dependencies, and stay within
free-tier or credit-funded usage.

## Current State

| Component         | Current Implementation              | Monthly Cost |
|-------------------|-------------------------------------|-------------|
| Web Hosting       | App Service B1 (Linux)              | ~$13        |
| Database          | PostgreSQL Flex Server (B1ms, 32GB) | ~$25        |
| Secrets           | Key Vault (RBAC)                    | ~$0.03      |
| Telemetry         | Sentry (external, stub)             | Free tier   |
| Auth              | Clerk (external, stub)              | Free tier   |
| Cache/Rate Limit  | In-memory Map()                     | $0          |
| Maps              | Not implemented                     | —           |
| Translation       | Static dictionary (6 locales)       | $0          |
| LLM Summarize     | Flag exists, no backend             | —           |
| Email             | Not implemented                     | —           |
| File Storage      | Not implemented                     | —           |

**Estimated current: ~$38/month**

## Decision

Replace or supplement external services with Azure-native equivalents. Phase the rollout
by cost/complexity. All Azure services provisioned at lowest viable SKU with free tiers
where available.

### Phase 1 — Immediate (no cost / free tier)

| Service                    | Azure Resource            | Replaces         | Free Tier                       |
|----------------------------|---------------------------|------------------|----------------------------------|
| Application Insights       | `microsoft.insights`      | Sentry (stub)    | 5 GB/mo ingestion, 90d retention |
| Azure Monitor / Alerts     | `Microsoft.Insights`      | (none)           | Free for basic metrics/alerts    |
| Azure Maps                 | `Microsoft.Maps` (S0)     | (not built)      | 250K map loads/mo free           |
| Azure AI Translator        | `Microsoft.CognitiveServices` | Static i18n dict | 2M chars/mo free (F0)        |
| Budget + Cost Alerts       | `Microsoft.Consumption`   | (none)           | Free                             |
| Resource Tags               | (metadata)                | (none)           | Free                             |
| Node.js 22 LTS upgrade     | App Service config        | Node 20 (EOL)    | $0                               |
| Diagnostic Settings         | Log Analytics workspace   | (none)           | 5 GB/mo free                     |

### Phase 2 — Low cost, high value

| Service                     | Azure Resource           | Replaces           | Cost                            |
|-----------------------------|--------------------------|--------------------|---------------------------------|
| Azure OpenAI (GPT-4o-mini) | `Microsoft.CognitiveServices` | LLM stub       | ~$0.15/1M input tokens          |
| Azure Blob Storage          | `Microsoft.Storage`      | (not built)        | $0.018/GB/mo (Hot)              |
| Azure Communication Services (Email) | `Microsoft.Communication` | (not built) | 100 emails/day free             |

### Phase 3 — Future consideration

| Service                   | Azure Resource            | Replaces         | Notes                           |
|---------------------------|---------------------------|------------------|---------------------------------|
| Azure Cache for Redis     | `Microsoft.Cache`         | In-memory Map()  | $17/mo min — defer until load justifies |
| Microsoft Entra ID        | `Microsoft.AAD`           | Clerk            | Free tier, but migration is large |
| Azure AI Search           | `Microsoft.Search`        | PostGIS search   | $0.10/hr min — only if search complexity grows |

## Budget Allocation

With $200/mo credits + student/startup supplements:

| Item                       | Monthly     |
|----------------------------|-------------|
| App Service B1             | $13         |
| PostgreSQL B1ms            | $25         |
| Key Vault                  | <$1         |
| Application Insights (5GB) | $0          |
| Azure Maps S0              | $0          |
| AI Translator F0           | $0          |
| Log Analytics (5GB)        | $0          |
| Azure OpenAI (light usage) | ~$2         |
| Blob Storage (1GB)         | <$1         |
| **Total**                  | **~$42/mo** |

That leaves ~$158/mo headroom within the $200 credit.

### Budget Alerts

- **$30/mo** (50%) — informational email
- **$50/mo** (80%) — warning email
- **$60/mo** (100%) — critical alert
- **Hard ceiling**: monitor and adjust if trending above $80/mo

### Student + Startup Credits Strategy

- **Azure for Students** (jackson.cole@snhu.edu): $100/year, renewable. Use for dev/staging.
- **Microsoft for Startups Founders Hub** (automatedempires@outlook.com): Apply for up to $1,000-$150,000 in credits.
  This can cover production costs for 1-3 years.
- **GitHub Student Dev Pack**: Free Copilot, free Actions minutes, free Codespaces hours.
- **GitHub Copilot**: Available on both accounts for AI-assisted development.

## Implementation Notes

### Telemetry (Application Insights replacing Sentry)

The existing `src/services/telemetry/sentry.ts` already has a clean abstraction
(`captureException`, `captureMessage`, `addBreadcrumb`). Create an Application Insights
implementation behind the same interface. Keep Sentry as fallback if DSN is set.

### Maps (Azure Maps)

The map surface (`src/components/map/MapContainer.tsx`, `src/app/(seeker)/map/page.tsx`)
is planned but not yet rendering. Wire Azure Maps Web SDK (free tier) as the tile/interaction
provider. PostGIS remains the spatial query engine.

### Translation (Azure AI Translator)

The i18n service (`src/services/i18n/i18n.ts`) has 6 hardcoded locales. Use Azure AI Translator
for dynamic translation of service descriptions and chat responses. Keep the static dictionary
for UI chrome (buttons, labels) — translate service content dynamically.

### LLM Summarization (Azure OpenAI)

Create `src/services/llm/summarizer.ts` behind the `llm_summarize` feature flag. Input is
already-retrieved service records only. Output is 1-2 sentence summary. Must not add facts
not in the records.

### Rate Limiting

Keep in-memory for now (low traffic). When load grows, migrate to Azure Cache for Redis.
The `checkRateLimit()` interface is already clean enough to swap backends.

## Consequences

- External dependency count drops (Sentry optional, Clerk stays for now).
- All core services map to a single Azure subscription for unified billing.
- Cost is predictable and within free/credit-funded tiers.
- Student and startup credits extend runway significantly.

## Alternatives Considered

- Keep Sentry as primary telemetry: Rejected (Azure-first principle; App Insights is free
  and integrates with Azure Monitor).
- Use Google Maps: Rejected (Azure-first; Azure Maps S0 is free).
- Use AWS Translate: Rejected (Azure-first; AI Translator F0 is free).
- Deploy Redis immediately: Deferred (in-memory is fine at current scale).
