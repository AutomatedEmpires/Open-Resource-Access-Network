# Ingestion Agent Build Plan

## Vision Recap
Extract, categorize, verify, and connect resources from official sources (211, .gov) to people in need. The agent reads raw HTML/PDF → LLM extracts structured service data → system verifies → routes to admins → publishes to live DB for seekers.

---

## Phase 1: LLM Extraction Core (Priority: NOW)
Build the extraction prompt and structured output parsing.

### 1.1 Extraction Prompt Design
- **Input**: Raw HTML/text + source URL + source quality tier
- **Output**: Structured JSON matching `ExtractedCandidate` schema
- **Prompt structure**:
  1. System context: "You are extracting social service information..."
  2. Safety rules: "Do not invent data. Use 'null' for missing fields."
  3. Field definitions: Organization, service name, description, contact, eligibility, hours, location, service area
  4. Output schema: JSON with confidence signals per field
  5. Examples: Few-shot with real 211/gov examples

### 1.2 Tag Generation Prompt
- Separate prompt (or chained) for categorization
- Input: Extracted service data
- Output: Category tags + confidence scores
- Tags: `food`, `housing`, `healthcare`, `legal`, `employment`, `utilities`, `transportation`, `childcare`, `mental_health`, `substance_use`, `disability`, `veteran`, `senior`, `youth`, `domestic_violence`

### 1.3 LLM Client Abstraction
```typescript
// src/agents/ingestion/llm/client.ts
interface LLMClient {
  extract(html: string, sourceUrl: string): Promise<ExtractionResult>;
  categorize(service: ExtractedService): Promise<TagResult[]>;
}

// Implementations:
// - AzureOpenAIClient (GPT-4o)
// - OpenAIClient (fallback)
// - Future: AnthropicClient, etc.
```

### 1.4 Structured Output Parsing
- Zod validation of LLM response
- Confidence score mapping (LLM certainty → our 0-100 scale)
- Field-level provenance (what text led to this extraction)

**Files to create**:
- `src/agents/ingestion/llm/client.ts` — Interface + factory
- `src/agents/ingestion/llm/azureOpenAI.ts` — Azure OpenAI implementation
- `src/agents/ingestion/llm/prompts/extraction.ts` — Extraction prompt templates
- `src/agents/ingestion/llm/prompts/categorization.ts` — Tagging prompt
- `src/agents/ingestion/llm/parser.ts` — Response parsing + validation

---

## Phase 2: HTML Processing Pipeline
Convert raw pages to LLM-ready text.

### 2.1 HTML Sanitization
- Strip scripts, styles, navigation, ads, footers
- Extract main content (heuristics + common selectors)
- Preserve semantic structure (headings, lists, tables)
- Handle encoding, character sets

### 2.2 Content Chunking
- Large pages → split into chunks (≤4K tokens for LLM context)
- Smart chunking: don't break mid-service-listing
- Overlap strategy for context preservation

### 2.3 PDF Extraction
- PDF → text extraction (for downloadable service guides)
- Table-aware parsing for eligibility charts

**Files to create**:
- `src/agents/ingestion/html/sanitizer.ts` — Clean HTML for LLM
- `src/agents/ingestion/html/chunker.ts` — Split large content
- `src/agents/ingestion/html/pdfExtractor.ts` — PDF text extraction

---

## Phase 3: Source Registry & Fetching
Manage allowed sources and fetch content safely.

### 3.1 Initial Source Seeds
**211 Network** (primary):
- `211.org` API (if available)
- State-specific 211 sites: `211idaho.org`, `211sandiego.org`, etc.
- Pattern: `211*.org`, `*211.org`

**Government directories**:
- `benefits.gov`
- State HHS portals: `healthandwelfare.idaho.gov`, etc.
- `usa.gov/food-assistance`, etc.

**Format in Source Registry**:
```sql
INSERT INTO source_registry (domain_pattern, source_quality, auto_approve, crawl_policy) VALUES
('%.211%.org', 'official', true, '{"maxDepth": 2, "respectRobots": true}'),
('%.gov', 'official', false, '{"maxDepth": 1, "respectRobots": true}'),
('%.edu', 'vetted', false, '{"maxDepth": 1, "respectRobots": true}');
```

### 3.2 Fetch Service
- Respectful crawling (robots.txt, rate limiting)
- Store evidence snapshot (hash + timestamp)
- Detect redirects, store canonical URL
- Handle auth walls (skip, don't bypass)

### 3.3 Link Discovery
- Extract links from fetched pages
- Filter to allowlisted domains
- Queue for extraction (breadth-first, depth-limited)

**Files to create**:
- `src/agents/ingestion/fetch/fetcher.ts` — HTTP fetch + snapshot
- `src/agents/ingestion/fetch/robotsTxt.ts` — Robots.txt parser
- `src/agents/ingestion/fetch/linkExtractor.ts` — Discover follow links
- `db/seed/sources.sql` — Initial source seeds

---

## Phase 4: Azure Functions Runtime
Serverless execution with queue-driven architecture.

### 4.1 Function Architecture
```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────┐
│ Timer Trigger   │────▶│ Queue: fetch     │────▶│ Fetch Function │
│ (scheduled run) │     └──────────────────┘     └────────────────┘
└─────────────────┘                                      │
                                                         ▼
┌─────────────────┐     ┌──────────────────┐     ┌────────────────┐
│ HTTP Trigger    │────▶│ Queue: extract   │────▶│ Extract Func   │
│ (manual submit) │     └──────────────────┘     └────────────────┘
└─────────────────┘                                      │
                                                         ▼
                                               ┌────────────────┐
                                               │ Queue: verify  │
                                               └────────┬───────┘
                                                        │
                                               ┌────────▼───────┐
                                               │ Verify Func    │
                                               └────────┬───────┘
                                                        │
                                               ┌────────▼───────┐
                                               │ Route to Admin │
                                               └────────────────┘
```

### 4.2 Functions to Create
| Function | Trigger | Purpose |
|----------|---------|---------|
| `scheduledCrawl` | Timer (daily) | Enqueue sources for re-crawl |
| `fetchPage` | Queue | Fetch URL → store snapshot → enqueue extract |
| `extractService` | Queue | Run LLM extraction → store candidate |
| `verifyCandidate` | Queue | Run verification checks |
| `routeToAdmin` | Queue | Assign to admins via routing logic |
| `manualSubmit` | HTTP | Staff submits URL for ingestion |

### 4.3 Queue Design
Azure Storage Queues (simple) or Service Bus (advanced):
- `ingestion-fetch` — URLs to fetch
- `ingestion-extract` — Snapshots to extract
- `ingestion-verify` — Candidates to verify
- `ingestion-route` — Verified candidates to route

**Files to create**:
- `functions/` — Azure Functions project (separate or monorepo)
- `functions/scheduledCrawl/index.ts`
- `functions/fetchPage/index.ts`
- `functions/extractService/index.ts`
- `functions/verifyCandidate/index.ts`
- `functions/routeToAdmin/index.ts`
- `functions/manualSubmit/index.ts`

---

## Phase 5: Verification Pipeline
Run automated checks on extracted data.

### 5.1 Verification Checks (from existing checklist)
- **Domain allowlist**: Source URL matches registered domain
- **Phone format**: Valid US phone number format
- **Email format**: Valid email syntax
- **URL reachability**: Contact URLs are reachable
- **Geocoding**: Address geocodes to valid location
- **Service area plausibility**: Stated area matches location

### 5.2 Check Runner
```typescript
interface VerificationCheck {
  checkType: string;
  severity: 'critical' | 'warning' | 'info';
  run(candidate: ExtractedCandidate): Promise<CheckResult>;
}
```

**Files to create**:
- `src/agents/ingestion/verify/runner.ts` — Orchestrate checks
- `src/agents/ingestion/verify/checks/domainCheck.ts`
- `src/agents/ingestion/verify/checks/phoneCheck.ts`
- `src/agents/ingestion/verify/checks/geocodeCheck.ts`
- `src/agents/ingestion/verify/checks/urlCheck.ts`

---

## Phase 6: Admin UI Enhancements
Wire the existing queue pages to the new pipeline.

### 6.1 ORAN Admin: Source Management
- `/oran-admin/sources` — View/add/edit source registry
- Approve quarantine → vetted promotions
- View crawl history + error logs

### 6.2 Community Admin: Review Queue
- Existing `/community-admin/queue` → wire to `candidate_assignments`
- Tag confirmation UI (color-coded)
- Field suggestion acceptance
- Publish button when ready

---

## Implementation Order

### Sprint 1 (This Week): LLM Extraction
1. ✅ Contracts exist (jobs, tags, routing, confirmations, publish)
2. Create LLM client abstraction (`src/agents/ingestion/llm/`)
3. Design extraction prompt + create prompts module
4. Design categorization prompt
5. Build response parser with Zod validation
6. Unit tests with mock LLM responses

### Sprint 2: HTML Pipeline + Fetch
1. HTML sanitizer (strip noise, extract main content)
2. Content chunker for large pages
3. Fetch service with robots.txt respect
4. Evidence snapshot storage
5. Integration tests with real 211 pages

### Sprint 3: Azure Functions
1. Set up Functions project structure
2. Implement queue-driven functions
3. Wire to existing DB tables
4. Manual submission endpoint
5. Scheduled crawl trigger

### Sprint 4: Verification + Routing
1. Implement verification checks
2. Confidence scoring integration
3. Admin routing with capacity
4. End-to-end test: URL → admin queue

### Sprint 5: Admin UI + Launch
1. Source management UI
2. Enhanced review queue
3. Publish workflow
4. Monitor + iterate

---

## Key Design Decisions

### LLM Prompt Strategy
- **Extraction**: Single prompt for full service extraction (org + service + contact + hours + eligibility)
- **Categorization**: Separate prompt for tagging (after extraction, so tags see full context)
- **Confidence**: LLM rates its own certainty per field (1-5 scale → map to 0-100)

### Error Handling
- LLM fails → log error, mark job as failed, alert
- Parse fails → store raw response, allow manual review
- Fetch fails → retry with backoff, then skip

### Cost Control
- Chunk large pages to minimize tokens
- Cache extractions by content hash
- Rate limit LLM calls per source domain
- Monitor usage via Azure Cost Management

### Safety Rails
- LLM output is NEVER auto-published
- All extractions go to staging → admin review → publish
- Source Registry gates what URLs can be fetched
- No user-submitted URLs without admin approval

---

## Next Steps
1. Create `src/agents/ingestion/llm/` directory structure
2. Define extraction prompt in natural language
3. Build `AzureOpenAIClient` with structured output
4. Test with sample 211 pages
