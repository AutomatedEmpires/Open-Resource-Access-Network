# ORAN Ingestion Agent — Comprehensive Audit Report

**Audit Date:** 2026-03-03
**Audit Scope:** Complete end-to-end analysis of the Ingestion Agent subsystem
**Status:** ~70% Complete (contracts, fetcher, LLM integration, pipeline) — Missing Azure Functions runtime deployment

---

## Executive Summary

The ORAN Ingestion Agent is a **sophisticated, multi-stage pipeline** designed to locate, extract, verify, score, and route service records from official sources (`.gov`, `.edu`, 211 networks) to the ORAN platform. The agent is designed with **safety-first principles**: no data reaches seekers without human approval, no LLM-generated content is auto-published, and all actions emit audit events.

### Completion Status

| Component | Status | Notes |
|-----------|--------|-------|
| Core contracts (Zod schemas) | ✅ Complete | 18+ TypeScript modules with comprehensive schemas |
| Source Registry | ✅ Complete | Domain matching, URL canonicalization, bootstrap registry |
| Fetcher module | ✅ Complete | PageFetcher, HTML extraction, link discovery, evidence builder |
| LLM integration | ✅ Complete | Azure OpenAI client, extraction/categorization prompts |
| Pipeline orchestrator | ✅ Complete | 7-stage orchestrator with event emissions |
| Confidence scoring | ✅ Complete | 0-100 scoring with tier classification |
| Admin routing | ✅ Complete | Capacity-limited geographic routing |
| Tag confirmations | ✅ Complete | Color-coded confidence queue |
| Publish readiness | ✅ Complete | 12-criteria deterministic gate |
| Database schema | ✅ Complete | 9+ tables with triggers and indexes |
| Unit tests | ✅ Complete | 100+ tests across 12 test files |
| Azure Functions runtime | ❌ Not Started | Queue-driven functions not yet deployed |
| Admin review UI wiring | ❌ Not Started | UI pages exist but not connected to agent |

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Pipeline Stages](#2-pipeline-stages)
3. [Core Contracts & Schemas](#3-core-contracts--schemas)
4. [Source Registry](#4-source-registry)
5. [LLM Integration](#5-llm-integration)
6. [Confidence Scoring](#6-confidence-scoring)
7. [Admin Routing & Capacity](#7-admin-routing--capacity)
8. [Tag Confirmation System](#8-tag-confirmation-system)
9. [Publish Gate](#9-publish-gate)
10. [Database Schema](#10-database-schema)
11. [Triggers & Automation](#11-triggers--automation)
12. [Safety Controls](#12-safety-controls)
13. [Test Coverage](#13-test-coverage)
14. [Gaps & Recommendations](#14-gaps--recommendations)

---

## 1. System Architecture

### High-Level Flow

```
RAW SOURCE (URL submission, partner feed, scheduled crawl)
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 1: SOURCE CHECK                                          │
│  - Validate URL against Source Registry                         │
│  - Classify: allowlisted / quarantine / blocked                 │
│  - Reject unregistered domains                                  │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 2: FETCH                                                 │
│  - HTTP fetch with redirect handling                            │
│  - Content hashing (SHA-256)                                    │
│  - Store evidence snapshot (immutable)                          │
│  - Deduplication by content hash                                │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 3: EXTRACT TEXT                                          │
│  - HTML → clean text (remove scripts, nav, ads)                 │
│  - Preserve semantic structure                                  │
│  - Extract title, description, language                         │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 4: DISCOVER LINKS                                        │
│  - Extract and classify links (contact, apply, hours, etc.)     │
│  - Build investigation pack                                     │
│  - Filter to allowlisted domains only                           │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 5: LLM EXTRACTION                                        │
│  - Send text to Azure OpenAI (GPT-4o)                           │
│  - Extract structured HSDS fields                               │
│  - Per-field confidence scoring                                 │
│  - NEVER invent data — omit if not stated                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 6: LLM CATEGORIZATION                                    │
│  - Tag with taxonomy categories                                 │
│  - Assign confidence per tag                                    │
│  - Route uncertain tags to confirmation queue                   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 7: PERSIST                                               │
│  - Write to staging tables (NOT live DB)                        │
│  - Emit audit events                                            │
│  - Route to admin reviewers                                     │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 8: ADMIN REVIEW (Human-in-the-loop)                      │
│  - Confirm/modify/reject tags                                   │
│  - Verify extracted fields                                      │
│  - Make publish decision                                        │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 9: PUBLISH (if approved)                                 │
│  - Write to live services/locations/organizations tables        │
│  - Schedule reverification                                      │
│  - Seekers can now discover the service                         │
└─────────────────────────────────────────────────────────────────┘
```

### Code Location

| Layer | Location | Description |
|-------|----------|-------------|
| Contracts | `src/agents/ingestion/contracts.ts` | Core Zod schemas |
| Jobs | `src/agents/ingestion/jobs.ts` | Job lifecycle management |
| Tags | `src/agents/ingestion/tags.ts` | Resource tagging system |
| Scoring | `src/agents/ingestion/scoring.ts` | Confidence calculation |
| Routing | `src/agents/ingestion/routing.ts` | Admin assignment |
| Confirmations | `src/agents/ingestion/confirmations.ts` | Tag confirmation queue |
| Publish | `src/agents/ingestion/publish.ts` | Publish readiness |
| Source Registry | `src/agents/ingestion/sourceRegistry.ts` | Domain allowlist |
| Checklist | `src/agents/ingestion/checklist.ts` | Verification checklist |
| Dedupe | `src/agents/ingestion/dedupe.ts` | Deduplication keys |
| Audit | `src/agents/ingestion/audit.ts` | Audit writer interface |
| Stores | `src/agents/ingestion/stores.ts` | Database interfaces |
| Fetcher | `src/agents/ingestion/fetcher/**` | HTTP fetcher, HTML extractor |
| LLM | `src/agents/ingestion/llm/**` | LLM client, prompts |
| Pipeline | `src/agents/ingestion/pipeline/**` | Orchestrator, stages |
| Persistence | `src/agents/ingestion/persistence/**` | DB implementations |

---

## 2. Pipeline Stages

### Implemented Stages (7 total)

Located in `src/agents/ingestion/pipeline/stages.ts`:

| Stage | Class | Purpose | Stop on Failure? |
|-------|-------|---------|------------------|
| 1 | `SourceCheckStage` | Validate URL against registry | ✅ Critical |
| 2 | `FetchStage` | HTTP fetch + evidence snapshot | ✅ Critical |
| 3 | `ExtractTextStage` | HTML → clean text | ❌ Continue |
| 4 | `DiscoverLinksStage` | Extract/classify links | ❌ Continue |
| 5 | `LLMExtractionStage` | Extract structured fields | ❌ Continue |
| 6 | `LLMCategorizationStage` | Tag with taxonomy | ❌ Continue |
| 7 | `PersistStage` | Write to staging tables | ❌ Continue |

### Pipeline Configuration

```typescript
// src/agents/ingestion/pipeline/types.ts
const PipelineConfigSchema = z.object({
  fetchTimeoutMs: z.number().default(30000),
  maxContentLength: z.number().default(5 * 1024 * 1024), // 5MB
  llmTimeoutMs: z.number().default(60000),
  maxLLMRetries: z.number().default(2),
  stopOnFailure: z.boolean().default(false),
});
```

### Pipeline Events

The orchestrator emits events for observability:

```typescript
type PipelineEventType =
  | 'pipeline_started'
  | 'pipeline_completed'
  | 'stage_started'
  | 'stage_completed'
  | 'stage_failed'
  | 'stage_skipped';
```

---

## 3. Core Contracts & Schemas

All schemas use **Zod** for runtime validation. Key types:

### EvidenceSnapshot

```typescript
// Immutable record of what was fetched
const EvidenceSnapshotSchema = z.object({
  evidenceId: z.string().min(1),
  canonicalUrl: z.string().url(),
  fetchedAt: z.string().datetime(),
  httpStatus: z.number().int().min(100).max(599),
  contentType: z.string().min(1).optional(),
  contentHashSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  blobUri: z.string().url().optional(),
});
```

### ExtractedCandidate

```typescript
// Staging record for extracted service
const ExtractedCandidateSchema = z.object({
  extractionId: z.string().min(1),
  candidateId: z.string().min(1),
  extractKeySha256: z.string().regex(/^[a-f0-9]{64}$/i),
  extractedAt: z.string().datetime(),
  review: z.object({
    status: ReviewStatusSchema.default('pending'),
    jurisdiction: JurisdictionHintSchema.optional(),
    timers: ReviewTimersSchema.default({}),
    assignedToRole: z.enum(['community_admin', 'oran_admin']).optional(),
    assignedToKey: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).default([]),
    checklist: VerificationChecklistSchema.default(() => buildDefaultChecklist()),
  }),
  fields: z.object({
    organizationName: z.string().min(1),
    serviceName: z.string().min(1),
    description: z.string().min(1),
    websiteUrl: z.string().url().optional(),
    phone: z.string().min(1).optional(),
    phones: z.array(PhoneSchema).optional(),
    address: AddressSchema.optional(),
    isRemoteService: z.boolean().default(false),
  }),
  investigation: InvestigationPackSchema.optional(),
  provenance: z.record(z.string(), ProvenanceSchema).default({}),
});
```

### IngestionJob

```typescript
// Tracks crawl/extraction jobs
const IngestionJobSchema = z.object({
  id: z.string().uuid(),
  correlationId: z.string().min(1),
  jobType: z.enum(['seed_crawl', 'scheduled_reverify', 'manual_submission',
                   'rss_feed', 'sitemap_discovery', 'registry_change']),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  seedUrls: z.array(z.string().url()).default([]),
  urlsDiscovered: z.number().int().min(0).default(0),
  urlsFetched: z.number().int().min(0).default(0),
  candidatesExtracted: z.number().int().min(0).default(0),
  candidatesVerified: z.number().int().min(0).default(0),
  errorsCount: z.number().int().min(0).default(0),
  queuedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  agentId: z.string().min(1).default('oran-ingestion-agent/1.0'),
});
```

### AuditEvent

```typescript
// Every action is logged
const AuditEventSchema = z.object({
  eventId: z.string().min(1),
  correlationId: z.string().min(1),
  eventType: z.enum([
    'candidate.located', 'evidence.fetched', 'extract.completed',
    'verify.completed', 'review.assigned', 'review.status_changed',
    'publish.approved', 'publish.rejected', 'reverify.completed',
  ]),
  actorType: z.enum(['system', 'service_principal', 'human']),
  actorId: z.string().min(1),
  targetType: z.enum(['candidate', 'evidence', 'extraction', 'service']),
  targetId: z.string().min(1),
  timestamp: z.string().datetime(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  outputs: z.record(z.string(), z.unknown()).default({}),
  evidenceRefs: z.array(z.string().min(1)).default([]),
});
```

---

## 4. Source Registry

### Trust Levels

| Level | Behavior |
|-------|----------|
| `allowlisted` | Fetch + expand discovery allowed |
| `quarantine` | Fetch allowed for seeded URLs only; no expansion without admin approval |
| `blocked` | Reject immediately |

### Bootstrap Registry

```typescript
// src/agents/ingestion/sourceRegistry.ts
function buildBootstrapRegistry(): SourceRegistryEntry[] {
  return [
    { id: 'bootstrap-gov', trustLevel: 'allowlisted', domainRules: [{ type: 'suffix', value: '.gov' }] },
    { id: 'bootstrap-edu', trustLevel: 'allowlisted', domainRules: [{ type: 'suffix', value: '.edu' }] },
    { id: 'bootstrap-mil', trustLevel: 'quarantine', domainRules: [{ type: 'suffix', value: '.mil' }] },
  ];
}
```

### URL Matching

```typescript
function matchSourceForUrl(rawUrl: string, registry: SourceRegistryEntry[]): DomainMatchResult {
  // 1. Canonicalize URL (strip tracking params, normalize host)
  // 2. Check against all registry entries
  // 3. Return allowed/blocked status with source ID
}
```

### URL Canonicalization

```typescript
function canonicalizeUrl(rawUrl: string): string {
  // - Lowercase hostname
  // - Strip fragments (#)
  // - Strip tracking params (utm_*, fbclid, gclid, etc.)
  // - Remove default ports (80, 443)
  // - Normalize trailing slashes
}
```

---

## 5. LLM Integration

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  LLMClient Interface                                            │
│  - extract(input): ExtractionResult                             │
│  - categorize(input): CategorizationResult                      │
│  - healthCheck(): boolean                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  AzureOpenAIClient (Primary)                                    │
│  - Uses Azure OpenAI GPT-4o                                     │
│  - Structured JSON output mode                                  │
│  - Rate limiting + retry logic                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Extraction Prompt Safety Rules

From `src/agents/ingestion/llm/prompts/extraction.ts`:

```
## CRITICAL RULES
1. ONLY extract information explicitly stated on the page.
   NEVER invent names, phone numbers, addresses, URLs, hours, or eligibility criteria.
2. If a field is not mentioned or cannot be determined, OMIT it (do not guess).
3. For eligibility, use cautious language: "may qualify" — never guarantee eligibility.
4. Phone numbers: preserve the exact format found on the page.
```

### Confidence Scoring by LLM

```typescript
// Per-field confidence in extraction result
{
  "confidences": [
    {
      "organizationName": { "confidence": 95, "sourceSnippet": "exact text from page" },
      "serviceName": { "confidence": 90 },
      "description": { "confidence": 85 },
      "phones": { "confidence": 95, "sourceSnippet": "(555) 123-4567" }
    }
  ]
}
```

### Environment Variables

```
LLM_PROVIDER=azure_openai
LLM_MODEL=gpt-4o
LLM_ENDPOINT=https://<resource>.openai.azure.com
LLM_API_KEY=<key>
LLM_API_VERSION=2024-08-01-preview
LLM_TEMPERATURE=0.1
```

---

## 6. Confidence Scoring

### Tier System

| Tier | Score Range | UI Color | Meaning |
|------|-------------|----------|---------|
| Green | 80-100 | `#22c55e` | Ready for publication |
| Yellow | 60-79 | `#eab308` | Likely good, needs review |
| Orange | 40-59 | `#f97316` | Needs additional verification |
| Red | 0-39 | `#ef4444` | Insufficient data |

### Score Calculation

```typescript
function computeConfidenceScore(inputs: ConfidenceInputs): number {
  let score = 0;

  // Base points
  if (inputs.hasEvidenceSnapshot) score += 20;           // +20
  if (inputs.sourceAllowlisted) score += 20;             // +20
  if (inputs.requiredFieldsPresent) score += 20;         // +20

  // Verification check points
  for (const check of inputs.verificationChecks) {
    const weight = check.severity === 'critical' ? 20 :
                   check.severity === 'warning' ? 10 : 4;
    if (check.status === 'pass') score += weight;
    if (check.status === 'fail') score -= weight;
  }

  // Checklist completion bonus (up to +20)
  // ...

  return clamp0to100(score);
}
```

### Verification Checks

| Check Type | Severity | Description |
|------------|----------|-------------|
| `domain_allowlist` | critical | Source URL matches allowed domain |
| `contact_validity` | warning | Phone/email format valid |
| `cross_source_agreement` | info | Multiple sources agree |
| `hours_stability` | info | Hours haven't changed frequently |
| `location_plausibility` | warning | Address geocodes to valid location |
| `policy_constraints` | critical | No disallowed content |

### Review SLA & Reverification Cadence

```typescript
function computeReviewSlaHours(score: number, hasCriticalFailure: boolean): number {
  if (hasCriticalFailure) return 24;   // 1 day
  if (score >= 80) return 168;          // 7 days (green)
  if (score >= 60) return 72;           // 3 days (yellow)
  if (score >= 40) return 48;           // 2 days (orange)
  return 168;                           // 7 days (red - needs work first)
}

function computeReverifyCadenceDays(score: number): number {
  if (score >= 80) return 180;  // 6 months
  if (score >= 60) return 90;   // 3 months
  if (score >= 40) return 30;   // 1 month
  return 14;                     // 2 weeks
}
```

---

## 7. Admin Routing & Capacity

### Capacity Management

```typescript
// src/agents/ingestion/routing.ts
const AdminCapacitySchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  pendingCount: z.number().int().min(0).default(0),
  inReviewCount: z.number().int().min(0).default(0),
  maxPending: z.number().int().min(1).default(10),
  maxInReview: z.number().int().min(1).default(5),
  coverageZoneId: z.string().uuid().nullable(),
  coverageStates: z.array(z.string()).default([]),
  coverageCounties: z.array(z.string()).default([]), // "STATE_COUNTY" format
  isActive: z.boolean().default(true),
  isAcceptingNew: z.boolean().default(true),
  // Performance metrics
  totalVerified: z.number().int().min(0).default(0),
  avgReviewHours: z.number().nullable(),
});
```

### Priority Scoring for Routing

| Match Level | Score | Description |
|-------------|-------|-------------|
| `exact_county` | 100 | Admin covers exact county |
| `state` | 50 | Admin covers state |
| `zone` | 25 | Admin covers coverage zone |
| `fallback` | 10 | Admin with no geo restriction |

### Routing Algorithm

```typescript
function sortAdminsByPriority(admins, state, county) {
  return admins
    .filter(canAcceptAssignment)          // Check capacity
    .map(admin => computeAdminPriority(admin, state, county))
    .filter(admin => admin.priorityScore > 0)
    .sort((a, b) => {
      // Primary: priority score (higher = better)
      // Secondary: pending count (lower = better)
      // Tertiary: avg review hours (lower = better)
    });
}
```

### Assignment Status Flow

```
pending → claimed → completed
    │         │
    └──────→ declined
    │
    └──────→ expired
```

---

## 8. Tag Confirmation System

### Confidence Color Coding

| Tier | Confidence | Action |
|------|------------|--------|
| Green | 80-100% | Auto-approved (except category/geographic) |
| Yellow | 60-79% | Admin review required |
| Orange | 40-59% | Admin review required |
| Red | 0-39% | Admin review required |

### Tag Types

```typescript
const TagType = z.enum([
  'category',      // food, housing, healthcare...
  'geographic',    // us_ca_santa_clara_san_jose
  'audience',      // veteran, senior, family...
  'program',       // snap, wic, medicaid...
  'eligibility',
  'service_area',
  'language',
  'custom',
]);
```

### Tag Confirmation Schema

```typescript
const TagConfirmationSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  tagType: TagType,
  suggestedValue: z.string(),
  agentConfidence: z.number().int().min(0).max(100),
  evidenceText: z.string().nullable(),
  evidenceSelector: z.string().nullable(),
  status: z.enum(['pending', 'confirmed', 'rejected', 'modified']),
  confirmedValue: z.string().nullable(),
  confirmedByUserId: z.string().nullable(),
  isAutoConfirmed: z.boolean().default(false),
});
```

### Manual Confirmation Rules

```typescript
function requiresManualConfirmation(tag: TagConfirmation): boolean {
  const tier = getConfidenceTier(tag.agentConfidence);
  if (tier === 'green') {
    // Category and geographic tags always need confirmation
    return ['category', 'geographic'].includes(tag.tagType);
  }
  return true; // All non-green tags need confirmation
}
```

---

## 9. Publish Gate

### Publish Readiness Criteria (12 total)

```typescript
function isReadyForPublish(readiness: PublishReadiness): boolean {
  return (
    readiness.hasOrgName &&              // ✓ Organization name
    readiness.hasServiceName &&          // ✓ Service name
    readiness.hasDescription &&          // ✓ Description
    readiness.hasContactMethod &&        // ✓ Phone OR email OR website
    readiness.hasLocationOrVirtual &&    // ✓ Location OR marked virtual
    readiness.hasCategoryTag &&          // ✓ Category tag confirmed
    readiness.hasGeographicTag &&        // ✓ Geographic tag confirmed
    readiness.criticalTagsConfirmed &&   // ✓ All critical tags confirmed
    readiness.noRedTagsPending &&        // ✓ No low-confidence tags pending
    readiness.passedDomainCheck &&       // ✓ Domain verification passed
    readiness.noCriticalFailures &&      // ✓ No critical check failures
    readiness.confidenceScore >= 60      // ✓ At least yellow tier
  );
}
```

### Readiness UI Breakdown

```typescript
function getReadinessBreakdown(readiness: PublishReadiness): ReadinessRequirement[] {
  return [
    { key: 'org_name', label: 'Organization name', met: readiness.hasOrgName, required: true },
    { key: 'service_name', label: 'Service name', met: readiness.hasServiceName, required: true },
    { key: 'description', label: 'Description', met: readiness.hasDescription, required: true },
    { key: 'contact', label: 'Contact method', met: readiness.hasContactMethod, required: true },
    { key: 'location', label: 'Location or virtual', met: readiness.hasLocationOrVirtual, required: true },
    // ... 7 more criteria
  ];
}
```

---

## 10. Database Schema

### Tables (db/migrations/0002_ingestion_tables.sql)

| Table | Purpose |
|-------|---------|
| `ingestion_sources` | Source Registry entries |
| `ingestion_jobs` | Job tracking with correlation IDs |
| `evidence_snapshots` | Immutable evidence records |
| `extracted_candidates` | Staging for extracted services |
| `resource_tags` | Tags for candidates/services |
| `discovered_links` | Links found during crawl |
| `ingestion_audit_events` | Audit trail |
| `llm_suggestions` | LLM-generated field suggestions |

### Admin Routing Tables (db/migrations/0018_admin_capacity_routing.sql)

| Table | Purpose |
|-------|---------|
| `admin_review_profiles` | Admin capacity and coverage |
| `candidate_admin_assignments` | Multi-admin assignment tracking |

### Key Indexes

```sql
-- Candidates by review status
CREATE INDEX idx_candidates_status ON extracted_candidates(review_status);

-- Candidates by jurisdiction for routing
CREATE INDEX idx_candidates_jurisdiction ON extracted_candidates(jurisdiction_state, jurisdiction_county);

-- Candidates by confidence tier for prioritization
CREATE INDEX idx_candidates_tier ON extracted_candidates(confidence_tier);

-- Admin profiles by availability
CREATE INDEX idx_admin_review_profiles_available
  ON admin_review_profiles(is_active, is_accepting_new, pending_count)
  WHERE is_active = true AND is_accepting_new = true;

-- Admin profiles by geographic coverage
CREATE INDEX idx_admin_review_profiles_location
  ON admin_review_profiles USING GIST (location);
```

---

## 11. Triggers & Automation

### Auto-Calculate Confidence Tier

```sql
CREATE OR REPLACE FUNCTION calculate_confidence_tier()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.confidence_score >= 80 THEN
    NEW.confidence_tier = 'green';
  ELSIF NEW.confidence_score >= 60 THEN
    NEW.confidence_tier = 'yellow';
  ELSIF NEW.confidence_score >= 40 THEN
    NEW.confidence_tier = 'orange';
  ELSE
    NEW.confidence_tier = 'red';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_candidates_tier_calc
  BEFORE INSERT OR UPDATE OF confidence_score ON extracted_candidates
  FOR EACH ROW EXECUTE FUNCTION calculate_confidence_tier();
```

### Maintain Admin Queue Counts

```sql
CREATE OR REPLACE FUNCTION update_admin_queue_counts()
RETURNS TRIGGER AS $$
BEGIN
  -- On INSERT: increment pending/in_review count
  -- On UPDATE: decrement old status, increment new status
  -- On DELETE: decrement appropriate count
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assignment_queue_counts
  AFTER INSERT OR UPDATE OR DELETE ON candidate_admin_assignments
  FOR EACH ROW EXECUTE FUNCTION update_admin_queue_counts();
```

### Updated_at Auto-Update

```sql
CREATE TRIGGER trg_ingestion_sources_updated
  BEFORE UPDATE ON ingestion_sources
  FOR EACH ROW EXECUTE FUNCTION update_ingestion_updated_at();
```

---

## 12. Safety Controls

### Non-Negotiables (from SSOT)

| Control | Status | Implementation |
|---------|--------|----------------|
| Seekers only see stored records | ✅ | Agent writes to staging only; publish requires human approval |
| No LLM in retrieval/ranking | ✅ | LLM only extracts/categorizes; never affects seeker search |
| Auditability required | ✅ | Every action emits `AuditEvent` with correlation ID |
| Idempotent + deduped | ✅ | `extractKeySha256 = SHA256(canonicalUrl + contentHash)` |
| Known sources only | ✅ | Source Registry gates all URLs |
| No hallucinated facts | ✅ | LLM prompt explicitly forbids invention |
| Eligibility caution | ✅ | "may qualify" language enforced in prompts |

### Privacy Controls

- No authenticated scraping (no cookies, no logins)
- URL hygiene (strip tracking params)
- PII-safe telemetry (audit logs don't contain secrets)

### Verification Checks

All candidates must pass verification before publish:

```typescript
const VerificationCheckTypeSchema = z.enum([
  'domain_allowlist',      // Critical
  'contact_validity',      // Warning
  'cross_source_agreement',// Info
  'hours_stability',       // Info
  'location_plausibility', // Warning
  'policy_constraints',    // Critical
]);
```

---

## 13. Test Coverage

### Test Files (12 files, 100+ tests)

| File | Tests | Coverage |
|------|-------|----------|
| `fetcher.test.ts` | 57 | Schema validation, HTML extraction, link discovery |
| `llm.test.ts` | 25 | Client interface, prompt builders, error handling |
| `contracts-and-scoring.test.ts` | 15+ | Zod schemas, scoring functions |
| `jobs.test.ts` | 10+ | Job lifecycle, status transitions |
| `routing.test.ts` | 10+ | Admin priority, capacity, assignment |
| `confirmations.test.ts` | 10+ | Tag confirmation actions |
| `publish.test.ts` | 10+ | Publish readiness criteria |
| `tags.test.ts` | 10+ | Tag creation, geographic parsing |
| `sourceRegistry.test.ts` | 10+ | URL matching, canonicalization |
| `pipeline.test.ts` | 10+ | Pipeline orchestration |
| `persistence.test.ts` | 5+ | Store implementations |
| `admin-approval.test.ts` | 5+ | Admin approval workflow |

### Running Tests

```bash
npm test -- src/agents/ingestion/__tests__/
```

---

## 14. Gaps & Recommendations

### Critical Gaps

| Gap | Priority | Status |
|-----|----------|--------|
| Azure Functions runtime | P1 | Not implemented |
| Queue-driven execution | P1 | Not implemented |
| Scheduled reverification | P1 | Not implemented |
| Admin UI wiring | P1 | UI exists but not connected |

### Recommended Next Steps

1. **Sprint 3: Azure Functions Runtime**
   - Create `functions/` directory
   - Implement queue-driven functions:
     - `scheduledCrawl` (Timer trigger)
     - `fetchPage` (Queue trigger)
     - `extractService` (Queue trigger)
     - `verifyCandidate` (Queue trigger)
     - `routeToAdmin` (Queue trigger)
     - `manualSubmit` (HTTP trigger)

2. **Sprint 4: Admin UI Wiring**
   - Connect `/community-admin/queue` to `candidate_admin_assignments`
   - Wire tag confirmation UI to `tag_confirmations`
   - Wire field suggestion acceptance to `llm_suggestions`

3. **Sprint 5: Scheduled Reverification**
   - Implement reverification job type
   - Add drift detection (content hash change)
   - Implement confidence downgrade on drift

4. **Sprint 6: Monitoring & Alerts**
   - Application Insights integration
   - SLA violation alerts
   - Error rate monitoring

### Deferred Items (Future Work)

- Sitemap/RSS discovery beyond seeded URLs
- Cross-source verification (multiple sources for same service)
- 211 API integration
- PDF extraction improvements
- Multi-language support for extraction

---

## Appendix: Key Files Quick Reference

```
src/agents/ingestion/
├── AGENT_PROCESSING_SPEC.md    # 869-line detailed processing specification
├── AUDIT_SPRINT_1_2.md         # Audit checklist for Sprint 1-2
├── contracts.ts                # Core Zod schemas (170 lines)
├── jobs.ts                     # Job lifecycle (120 lines)
├── scoring.ts                  # Confidence scoring (180 lines)
├── routing.ts                  # Admin routing (395 lines)
├── confirmations.ts            # Tag confirmations (550 lines)
├── publish.ts                  # Publish readiness (550 lines)
├── sourceRegistry.ts           # Source Registry (210 lines)
├── checklist.ts                # Verification checklist (55 lines)
├── dedupe.ts                   # Deduplication (15 lines)
├── audit.ts                    # Audit writer (20 lines)
├── stores.ts                   # Store interfaces (700 lines)
├── tags.ts                     # Resource tags (275 lines)
├── adminAssignments.ts         # Admin assignments
├── adminProfiles.ts            # Admin profiles
├── tagConfirmations.ts         # Tag confirmations
├── llmSuggestions.ts           # LLM suggestions
├── fetcher/
│   ├── fetcher.ts              # HTTP fetcher (315 lines)
│   ├── htmlExtractor.ts        # HTML to text
│   ├── linkDiscovery.ts        # Link classification
│   ├── evidenceBuilder.ts      # Evidence snapshot
│   └── dedupIntegration.ts     # Deduplication
├── llm/
│   ├── client.ts               # LLM client interface (205 lines)
│   ├── types.ts                # LLM types
│   ├── prompts/
│   │   ├── extraction.ts       # Extraction prompt (140 lines)
│   │   └── categorization.ts   # Categorization prompt
│   └── providers/
│       └── azureOpenai.ts      # Azure OpenAI implementation
├── pipeline/
│   ├── orchestrator.ts         # Pipeline orchestrator (275 lines)
│   ├── stages.ts               # Stage implementations (810 lines)
│   └── types.ts                # Pipeline types
├── persistence/
│   ├── candidateStore.ts       # Candidate DB ops
│   └── evidenceStore.ts        # Evidence DB ops
└── __tests__/                  # 12 test files
    ├── fetcher.test.ts         # 57 tests
    ├── llm.test.ts             # 25 tests
    └── ...
```

---

*Report generated: 2026-03-03*
*Agent subsystem version: oran-ingestion-agent/1.0*
