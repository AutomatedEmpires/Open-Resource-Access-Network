# Foundry + AI Integrations — ORAN Integration Record (SSOT)

**Last updated (UTC):** 2026-03-05

This document is the running, meticulous record of **all AI/Foundry-related integrations** in ORAN:

- what exists vs. what’s wired vs. what’s enabled
- where the code lives
- which Azure resources back it
- why it exists (guardrails, product intent)
- what’s next (owners, rollout, evaluation)

ORAN is **safety-critical** and **retrieval-first**:

- **No LLM** may participate in retrieval or ranking.
- Any LLM output (if enabled) must be constrained to **summarize already retrieved records** and must **not add facts**.
- If imminent-risk indicators are detected, the system must route to **911 / 988 / 211** before anything else.

---

## 0) Non‑negotiable guardrails

- **Truth-first**: seeker-facing facts must originate from stored service records only.
- **Crisis hard gate**: keyword-based crisis detection always runs before any other stage.
- **Eligibility caution**: never guarantee eligibility; use “may qualify” + “confirm with provider”.
- **Privacy-first**: approximate location by default; avoid PII in telemetry/logs.
- **Fail-open safety design**: if AI safety APIs fail, do not block (but still preserve crisis hard gate).

---

## 1) Current Azure / Foundry inventory

### 1.1 Foundry project + deployed models (prod)

- **Foundry Project:** `ORAN_FOUNDRY`
- **Foundry Project Endpoint:** `https://oran-foundry-resource.services.ai.azure.com//api/projects/ORAN_FOUNDRY`

**Deployed models:**

- **Phi-4-mini-instruct** (deployment: `phi-4-mini-instruct`)
  - Intended use: fast/cheap summarization, extraction helpers, brief generation.
- **Cohere-embed-v3-multilingual**
  - Intended use: embeddings for semantic clustering and multilingual similarity tasks.

### 1.2 Provisioned production resources (westus2 unless noted)

Resource Group: `oranhf57ir-prod-rg`

- **Web App:** `oranhf57ir-prod-web` (App Service)
- **Key Vault:** `oranhf57ir-prod-kv` (RBAC mode, Key Vault references in app settings)
- **Redis:** `oranhf57ir-prod-redis` (Azure Cache for Redis Basic C0; TLS)
- **Communication Services:** `oranhf57ir-prod-comm`
- **Email Communication Services:** `oranhf57ir-prod-email` with Azure-managed domain
- **Function App:** `oranhf57ir-prod-func` (Consumption)

### 1.3 Secrets + configuration (no plaintext)

Stored in Key Vault and referenced via `@Microsoft.KeyVault(...)`:

- `azure-communication-connection-string`
- `redis-url`
- `internal-api-key`
- `azure-content-safety-endpoint` (present)
- `azure-content-safety-key` (present)
- `azure-openai-endpoint` (present)
- `azure-openai-key` (present)

---

## 2) What’s implemented vs enabled (high-level)

### 2.1 Chat pipeline (retrieval-first)

Core orchestration is implemented as a deterministic pipeline:

- Crisis detection: always-on keyword gate
- (Optional) Azure Content Safety distress gate: implemented, flag-controlled
- Intent detection: deterministic keyword/pattern rules
- Retrieval: SQL/PostGIS only
- (Optional) LLM summarization: flag-controlled

**Key files:**

- `src/services/chat/orchestrator.ts`
- `docs/CHAT_ARCHITECTURE.md`

### 2.2 Ingestion agent framework

Extraction/categorization/verification pipeline exists in-process, with serverless stubs present for future activation.

**Key files:**

- `src/agents/ingestion/**`
- `functions/**` (stubs for ingestion queues/timers)

---

## 3) Integration ledger (done / in progress / planned)

### 3.1 Implemented + wired (DONE)

| Capability | Why | Where (code) | Azure backing | Status |
|---|---|---|---|---|
| Search caching | Reduce repeated DB load; speed | `src/services/cache/redis.ts`, `src/services/search/cache.ts`, `src/app/api/search/route.ts` | Azure Cache for Redis (`oranhf57ir-prod-redis`) | DONE |
| SLA timer check | Enforce workflow SLAs | `functions/checkSlaBreaches/*`, `src/app/api/internal/sla-check/route.ts` | Function App (`oranhf57ir-prod-func`) | DONE |
| Email sending (ACS) | Transactional notifications | `src/services/email/azureEmail.ts`, `src/services/notifications/service.ts` | Communication Services + Email Domain | DONE |
| Internal auth for SLA endpoint | Prevent public access | `src/app/api/internal/sla-check/route.ts` | Key Vault secret `internal-api-key` | DONE |

### 3.2 Implemented in code, but feature-flagged OFF (NOT ENABLED YET)

| Capability | Why | Where (code) | Config | Status |
|---|---|---|---|---|
| `content_safety_crisis` | 2nd-layer crisis screening | `src/services/security/contentSafety.ts` + chat orchestrator gate | `AZURE_CONTENT_SAFETY_*` + feature flag | Code ready; enablement in progress |
| `llm_summarize` | More helpful chat UX (summarize retrieved records only) | Chat orchestrator stage 8 | LLM config + feature flag | Not enabled |

### 3.3 In progress (BY OTHER AGENT)

| Capability | Notes | Expected outcome | Status |
|---|---|---|---|
| Foundry Content Safety integration | You stated another agent is integrating content safety “in Foundry” and using GPT-4 in eastus | Centralized safety policy + monitoring | IN PROGRESS |
| EastUS GPT-4.0 service usage | You stated a service is provisioned in eastus and uses GPT-4.0 | Higher-quality model option for specific workflows | IN PROGRESS |

> Recording note: details (resource names, env vars, endpoints, rollout plan) should be appended here when finalized.

### 3.4 Designed and partially scaffolded (EXISTS, NOT DEPLOYED)

| Capability | Why | Where (code) | Blocker |
|---|---|---|---|
| Ingestion pipeline as Azure Functions (fetch/extract/verify/route) | Scale ingestion with queues/timers | `functions/{fetchPage,extractService,verifyCandidate,routeToAdmin,scheduledCrawl,manualSubmit}` | Functions currently stubs / TODO wiring |
| Azure OpenAI extraction provider | High-quality structured extraction | `src/agents/ingestion/llm/providers/azureOpenai.ts` | Not wired to deployed ingestion functions |

---

## 4) Idea backlog (ALL ideas, including the ones already being built)

### 4.1 Costed ideas you listed (tracked here)

| ID | Idea | Primary driver | Notes | State |
|---:|---|---|---|---|
| 1 | Wire extraction | gpt-4o-mini per ingestion page | ingestion-only | In progress (other agent / pipeline activation) |
| 2 | Activate `llm_summarize` | gpt-4o-mini per chat session | post-retrieval summarization only | Planned / being implemented elsewhere |
| 4 | Content Safety | Azure Content Safety F0 | with smart pre-filter | In progress (other agent) |
| 5 | Evidence quality scoring | gpt-4o-mini ingestion-only | quality flags + admin triage | Planned |
| 6 | Semantic dedup | embeddings | similarity for duplicate candidates | Planned |
| 9 | Multilingual | translator + extraction | multilingual UX | Planned |
| 10 | Host conversations | low-volume | controlled assistant for hosts | Planned |
| 11 | Admin review briefs | ingestion-gated | grounded briefs from evidence | Planned |
| 13 | Staleness diff | async | periodic re-check and diff | Planned |
| 3 | Intent classification | LLM per message | cost cliff at DAU | Defer; only if churn/UX demands |
| 16 | Session summarization | LLM per session | watch at scale | Optional |

### 4.2 Fresh ideas (new additions)

These are designed to **strengthen ORAN’s trust moat** while respecting retrieval-first constraints.

#### A) Safety + governance (highest leverage)

1) **Policy-as-code “no new facts” evaluator**

- Goal: automatically fail any LLM-produced summary/brief that contains information not present in retrieved records/evidence.
- Why: makes it safe to ship summarization/briefing features faster.
- Where: add a shared validator in `src/services/ai/` (new) and run in summarization & briefs.
- State: Planned.

1) **Adversarial crisis red-team harness**

- Goal: regression suite for crisis and safety gating (including multilingual tricky phrasing).
- Why: safety-critical, prevents regressions.
- Where: `src/__tests__/` + evaluation dataset under `docs/evals/` or `testdata/`.
- State: Planned.

1) **Grounded verification packets (evidence-only)**

- Goal: generate admin-facing packets that are strictly a digest of stored evidence, with citations/snippets.
- Why: reduces admin work without automating decisions.
- Where: ingestion/admin workflows; UI consumption in admin portals.
- State: Planned.

#### B) Ops flywheel

1) **Confidence regression alerts → tasks**

- Goal: if trust score drops or key checks fail, create tasks and notify owners.
- Why: turns scoring into an operational feedback loop.
- Where: workflow engine + notifications.
- State: Planned.

1) **Queue triage by risk & impact**

- Goal: prioritize reviews by service traffic, risk signals, staleness likelihood.
- Why: best use of scarce admin time.
- Where: admin queue ordering + lightweight summaries.
- State: Planned.

#### C) Data quality + coverage

1) **Feedback clustering (embeddings on feedback only)**

- Goal: cluster reports like “closed/moved/wrong hours” to drive targeted reverification.
- Why: reduces repeated manual triage.
- Where: background job; store cluster IDs.
- State: Planned.

1) **Coverage gap-finding map**

- Goal: identify underserved geos/categories (no shelters within X miles, etc.).
- Why: guides ingestion/outreach.
- Where: analytics queries + admin dashboard.
- State: Planned.

#### D) Accessibility expansion (still retrieval-first)

1) **SMS service-card delivery**

- Goal: deliver retrieved services via SMS for low-bandwidth users.
- Why: increases reach.
- Where: notifications + SMS provider integration.
- State: Planned.

1) **Voice/IVR routing (deterministic)**

- Goal: allow phone-based seekers; optional STT for routing only.
- Why: accessibility.
- Where: telephony integration + retrieval.
- State: Planned.

---

## 5) Practical integration plan (how we wire this safely)

### 5.1 Principles for any generative feature

- All generative prompts must be fed **only**:
  - the user message, and
  - the retrieved record payload / evidence payload
- Output must be validated:
  - no new phone numbers/addresses/URLs/hours beyond retrieved payload
  - no eligibility guarantees
  - no unsafe instructions

### 5.2 Recommended wiring pattern (for summarization/briefs)

1) Retrieval returns `ServiceCard[]` (existing)
2) Summarizer receives only those cards + user intent
3) Summarizer emits:
   - short summary
   - references to record IDs included
4) Run “no new facts” evaluator (planned)
5) Return summary to client

### 5.3 Evaluation + monitoring (use AI Toolkit)

- **Playground**: prompt iteration against real anonymized records
- **Bulk Run**: batch tests for extraction/briefing
- **Evaluation**: faithfulness, safety, relevance, latency budgets
- **Tracing/Inspector**: stage-level debugging + auditability

---

## 6) Open items / to be filled in when your other agent finishes

- EastUS GPT-4.0 resource name(s), endpoints, and which workloads use it
- Foundry Content Safety policy location + how it is enforced (gateway? wrapper? SDK?)
- Which environments (dev/staging/prod) have flags enabled and at what rollout
- Any data retention policy changes required for evaluation datasets
