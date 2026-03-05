# ORAN — Azure Foundry Integration Plan

**Maintainer:** Engineering
**Last updated:** 2026-03-05
**Status legend:** ✅ Live · 🟡 Stub/Partial · 🔲 Planned · ❌ Deferred

---

## Overview

This document is the single source of truth for every Azure AI / Foundry integration in ORAN — planned, in-progress, or complete. It records the **what, where, how, why, and cost model** for each idea. Update this file whenever an integration changes state.

### Non-negotiables that govern every AI integration

1. **Retrieval-first**: LLMs participate in summarization only — never in retrieval or ranking.
2. **No hallucinated facts**: LLMs receive only already-retrieved DB records. They cannot invent service names, numbers, addresses, hours, eligibility, or URLs.
3. **Crisis hard gate**: AI inference never delays or blocks crisis routing (911/988/211).
4. **Eligibility caution**: No AI output may guarantee eligibility. "may qualify" language only.
5. **Fail-open/fail-closed by intent**: Safety gates are fail-open (never block crisis routing on AI error). Feature flags default to off unless explicitly activated.
6. **Privacy-first**: Message content, user queries, and PII are never logged to telemetry.

---

## Azure Resources Provisioned

| Resource | Kind | SKU | Region | Purpose |
|---|---|---|---|---|
| `oranhf57ir-prod-oai` | Azure OpenAI (`OpenAI`) | S0 | eastus | GPT chat models |
| `ORAN-FOUNDRY-resource` | Azure AI Services (`AIServices`) | S0 | westus2 | Foundry model catalog, Content Safety |
| `oranhf57ir-prod-kv` | Key Vault | Standard | — | All secrets |
| `oranhf57ir-prod-func` | Azure Functions | — | — | Ingestion pipeline triggers |
| `oranhf57ir-prod-app` | App Service (Linux, Node 20 LTS) | — | — | Next.js app |

### Model Deployments

| Model | Resource | Deployment Name | TPM | Purpose |
|---|---|---|---|---|
| `gpt-4o-mini` (2024-07-18) | `oranhf57ir-prod-oai` | `gpt-4o-mini` | 50K Standard | Chat summarization |
| `Phi-4-mini-instruct` | `ORAN-FOUNDRY-resource` | `phi-4-mini-instruct` | — | Ingestion extraction |
| `Cohere-embed-v3-multilingual` | `ORAN-FOUNDRY-resource` | `cohere-embed-v3-multilingual` | — | Semantic embeddings |
| Content Safety (built-in) | `ORAN-FOUNDRY-resource` | *(endpoint native)* | F0 free tier | Crisis detection |

### Key Vault Secrets (AI-relevant)

| Secret name | Maps to env var | Set |
|---|---|---|
| `azure-openai-endpoint` | `AZURE_OPENAI_ENDPOINT` | ✅ |
| `azure-openai-key` | `AZURE_OPENAI_KEY` | ✅ |
| `azure-content-safety-endpoint` | `AZURE_CONTENT_SAFETY_ENDPOINT` | ✅ |
| `azure-content-safety-key` | `AZURE_CONTENT_SAFETY_KEY` | ✅ |

---

## Cost Bucket Reference

| Bucket | Definition |
|---|---|
| **A — Free / existing infra** | No new Azure spend; free-tier limits cover expected volume |
| **B — Watch** | Minimal per-call cost ($0–$5/month at current scale); monitor usage |
| **C — Selective** | Non-trivial cost; only activate with volume justification or explicit product decision |

---

## Integration Ideas — Full Inventory

---

### Idea 1 — Chat LLM Summarization (gpt-4o-mini)

| | |
|---|---|
| **Status** | ✅ **Live** — activated 2026-03-05 |
| **Bucket** | B — Watch (≈$0–2/month at current volume) |
| **Feature flag** | `llm_summarize` = `true`, 100% rollout |
| **Why** | Raw service records from the DB read like data dumps. A concise 2–4 sentence narrative dramatically improves seeker comprehension and trust. |
| **What** | gpt-4o-mini narrates already-retrieved service records in plain English after Stage 7 of the chat pipeline. It never retrieves, ranks, or invent facts. On any error, the pipeline falls back silently to the plain assembled message. |
| **Where** | `src/services/chat/llm.ts` — `summarizeWithLLM()` · `src/app/api/chat/route.ts` — Stage 8 dep · `src/services/flags/flags.ts` — flag |
| **How** | Lazy singleton `AzureOpenAI` client reads `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_API_VERSION`. System prompt has 5 hard anti-hallucination rules. `temperature=0.2`, `max_tokens=300`. ELIGIBILITY_DISCLAIMER always appended. |
| **Tests** | `src/services/chat/__tests__/llm.test.ts` — 8 tests |
| **Env vars** | `AZURE_OPENAI_ENDPOINT` · `AZURE_OPENAI_KEY` · `AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini` · `AZURE_OPENAI_API_VERSION=2024-07-01-preview` |
| **Docs** | `docs/CHAT_ARCHITECTURE.md` Stage 8 |

---

### Idea 2 — Azure AI Content Safety Crisis Gate

| | |
|---|---|
| **Status** | ✅ **Live** — activated 2026-03-05 |
| **Bucket** | A — Free (F0 tier: 5,000 text records/month; pre-filter keeps actual call rate <5% of messages) |
| **Feature flag** | `content_safety_crisis` = `true`, 100% rollout |
| **Why** | ORAN serves vulnerable populations. Keyword matching alone misses indirect, metaphorical, or culturally varied distress language ("I don't see a way out", "nobody would miss me"). A semantic classifier catches what keywords cannot. |
| **What** | Stage 1b of the chat pipeline. Runs only when Stage 1a (keyword gate) misses. A free local pre-filter (`hasDistressSignals()`) screens 34 indirect distress phrases before making any API call. If signals found, Azure AI Content Safety `text:analyze` endpoint evaluates SelfHarm severity. Score ≥ 4 (medium) triggers immediate 911/988/211 routing. Fail-open on any error. |
| **Where** | `src/services/security/contentSafety.ts` — `checkCrisisContentSafety()`, `hasDistressSignals()` · `src/services/chat/orchestrator.ts` — Stage 1b wiring |
| **How** | `fetch()` POST to `AZURE_CONTENT_SAFETY_ENDPOINT/text:analyze` with `Ocp-Apim-Subscription-Key` header. `SelfHarm` category only. Severity scale 0–7; threshold ≥ 4. No SDK dependency (raw fetch). |
| **Tests** | `src/services/security/__tests__/contentSafety.test.ts` — 19 tests |
| **Env vars** | `AZURE_CONTENT_SAFETY_ENDPOINT` · `AZURE_CONTENT_SAFETY_KEY` |
| **Docs** | `docs/CHAT_ARCHITECTURE.md` Stage 1b |

---

### Idea 3 — Phi-4-mini-instruct: Ingestion Service Extraction

| | |
|---|---|
| **Status** | 🟡 **Model deployed; function stub; not wired** |
| **Bucket** | B — Watch |
| **Feature flag** | None yet — will use `auto_check_gate` or new flag when wired |
| **Why** | ORAN's ingestion pipeline fetches raw web pages and PDF snapshots. Converting unstructured HTML/text into HSDS-structured service records by hand is not scalable. Phi-4-mini-instruct is a compact, fast, cost-efficient model well suited to structured extraction tasks. |
| **What** | The `extractService` Azure Function reads a fetched page snapshot, calls Phi-4-mini-instruct to extract HSDS fields (service name, org, phones, eligibility, hours, address, URL), creates a candidate record, and enqueues to `ingestion-verify`. |
| **Where** | `functions/extractService/index.ts` — stub with full implementation outline · `src/agents/ingestion/pipeline/stages/llmExtract.ts` · `src/agents/ingestion/pipeline/stages/llmCategorize.ts` |
| **How** | Function app already has queue bindings (`ingestion-extract` → `ingestion-verify`). Wire `llmExtractStage.execute()` using the ORAN-FOUNDRY-resource endpoint. Model is chat-completion format. Structured output (JSON mode) to match HSDS field schema. |
| **Next step** | Wire `extractService` to `llmExtractStage` in `src/agents/ingestion/pipeline/`. Add env vars to Function App. |
| **Env vars needed** | `AZURE_FOUNDRY_ENDPOINT` (= ORAN-FOUNDRY-resource endpoint) · `AZURE_FOUNDRY_KEY` · `FOUNDRY_EXTRACT_DEPLOYMENT=phi-4-mini-instruct` |
| **Docs** | `functions/extractService/index.ts` (inline outline) · `docs/agents/AGENTS_INGESTION_PIPELINE.md` |

---

### Idea 4 — Phi-4-mini-instruct: Ingestion Service Verification Assist

| | |
|---|---|
| **Status** | 🟡 **Model deployed; function stub; not wired** |
| **Bucket** | B — Watch |
| **Feature flag** | `auto_check_gate` (exists, currently off) |
| **Why** | Admin reviewers manually compare candidate fields against original source pages. Phi-4-mini can pre-score confidence, flag suspicious fields, and suggest corrections — reducing reviewer burden and accelerating verification. |
| **What** | The `verifyCandidate` Azure Function re-fetches the source, compares extracted fields against live page content, and uses Phi-4 to produce a discrepancy report and adjusted confidence score before the record reaches admin review. |
| **Where** | `functions/verifyCandidate/index.ts` — stub |
| **How** | Queue-triggered on `ingestion-verify`. Model prompt: "Given the extracted service record [JSON] and the following source page content [text], identify any fields that appear inconsistent or missing. Return a JSON discrepancy report." |
| **Next step** | Wire verification comparison logic and Phi-4 API call inside the stub. |
| **Env vars needed** | `AZURE_FOUNDRY_ENDPOINT` · `AZURE_FOUNDRY_KEY` · `FOUNDRY_EXTRACT_DEPLOYMENT=phi-4-mini-instruct` (reuse) |

---

### Idea 5 — Cohere-embed-v3-multilingual: Vector Semantic Search

| | |
|---|---|
| **Status** | 🔲 **Model deployed; not wired anywhere** |
| **Bucket** | B — Watch |
| **Feature flag** | New flag needed: `vector_search` |
| **Why** | Current retrieval is keyword + taxonomy join + PostGIS radius. Users who say "help for seniors who can't pay rent" may not match taxonomy terms exactly. Vector similarity search surfaces relevant services even when the user's phrasing doesn't match field values. |
| **What** | At index time: embed each service record's name + description + eligibility into a vector. At query time: embed the user message, compute cosine similarity against stored vectors, merge with existing SQL results and re-rank. |
| **Where** | New service: `src/services/search/vectorSearch.ts` · `src/services/search/embeddings.ts` · Chat orchestrator Stage 6 (retrieval extension) |
| **How** | Use `Cohere-embed-v3-multilingual` on ORAN-FOUNDRY-resource. Store vectors in a `pgvector`-enabled column (requires new migration). At query time, embed query → HNSW approximate nearest-neighbor search in PG. Blend with keyword score. |
| **DB migration needed** | Add `pgvector` extension + `embedding vector(1024)` column to `services` |
| **Cost note** | Embedding at import time is one-time per record. Query-time embedding: ~1 call per chat message. Very low cost. |
| **Next step** | Add migration for pgvector. Write embeddings service. Wire to ingestion pipeline to embed on import. |
| **Env vars needed** | `AZURE_FOUNDRY_ENDPOINT` · `AZURE_FOUNDRY_KEY` · `FOUNDRY_EMBED_DEPLOYMENT=cohere-embed-v3-multilingual` |

---

### Idea 6 — Cohere-embed-v3-multilingual: Service Deduplication

| | |
|---|---|
| **Status** | 🔲 **Planned** |
| **Bucket** | B — Watch (batch job, infrequent) |
| **Feature flag** | None needed — admin-triggered job |
| **Why** | The ingestion pipeline imports from multiple sources. The same service ("City Food Bank") may appear under different names, addresses, or phone number formats across sources. Deduplication prevents confusing seekers with duplicate results. |
| **What** | Scheduled or admin-triggered batch job: embed all service records, cluster by cosine similarity > threshold, surface clusters to admin as merge candidates. |
| **Where** | New admin route or Azure Function. Could reuse `src/services/merge/service.ts` |
| **How** | Embed all records → pairwise similarity → cluster. Threshold ~0.92 for near-duplicate. Present to `oran_admin` for 2-person approval merge. |
| **Next step** | Depends on Idea 5 (vector store). Implement after pgvector migration. |

---

### Idea 7 — LLM-Assisted Admin Review Recommendations (gpt-4o-mini)

| | |
|---|---|
| **Status** | 🔲 **Planned** |
| **Bucket** | C — Selective (only used during admin review, not on critical path) |
| **Feature flag** | New flag needed: `llm_admin_assist` |
| **Why** | Admin reviewers currently read raw candidate records and decide approve/reject/request-changes with no AI support. gpt-4o-mini can pre-check completeness, flag likely errors, suggest missing fields, and highlight policy conflicts — saving reviewer time without removing human decision authority. |
| **What** | During admin review of a candidate, an async "AI check" panel surfaces: field completeness score, suggested corrections, detected inconsistencies between fields, confidence in address/phone format validity. Human reviewer retains full approve/reject authority. |
| **Where** | New: `src/services/admin/reviewAssist.ts` · Admin review page |
| **How** | POST extracted candidate JSON to gpt-4o-mini with a structured prompt. Return JSON with `completenessScore`, `warnings[]`, `suggestions[]`. Displayed as advisory — never auto-approved. |
| **Constraint** | No PII (real seeker data) sent to LLM. Only service record metadata. |

---

### Idea 8 — Azure AI Translator: Multilingual Service Descriptions

| | |
|---|---|
| **Status** | 🟡 **Service module scaffolded; not fully integrated** |
| **Bucket** | B — Watch |
| **Feature flag** | New flag needed: `multilingual_descriptions` |
| **Why** | ORAN serves communities where English is not the primary language. Service descriptions are stored in English. Machine translation allows seekers to read descriptions in their preferred language without requiring providers to submit translations. |
| **What** | Service descriptions, eligibility text, and hours descriptions are translated on-demand (or cached) to the user's locale. Translation is applied at response assembly time, only for the returned records. |
| **Where** | `src/services/i18n/translator.ts` (existing scaffold) · Response assembly stage |
| **How** | Azure AI Translator REST API. Cache translations in Redis by `(serviceId, locale)` key to avoid re-translating unchanged records. Never translate stored records — only the response payload. |
| **Env vars needed** | `AZURE_TRANSLATOR_ENDPOINT` · `AZURE_TRANSLATOR_KEY` · `AZURE_TRANSLATOR_REGION` |
| **Cost note** | Azure Translator F0: 2M chars/month free. At ~500 chars/service × 5 results × estimated daily queries — will remain in free tier for a long time. |

---

### Idea 9 — Azure Maps: Enhanced Geocoding & Distance Display

| | |
|---|---|
| **Status** | 🟡 **Service scaffolded; partial integration** |
| **Bucket** | A — Free (Azure Maps Gen2 free tier: 5K requests/month) |
| **Feature flag** | `map_enabled` = `true`, 100% rollout |
| **Why** | Seekers need to know how far services are from them. Address strings must be converted to coordinates for distance sorting and map display. Batch geocoding at import time avoids per-query geocoding cost. |
| **What** | Two flows: (1) Import-time: geocode service addresses when records are ingested, store lat/lng in `location` table. (2) Query-time: geocode user's stated location string when a city/ZIP is extracted from their message (via Stage 4 intent detection). |
| **Where** | `src/services/geocoding/azureMaps.ts` (existing) · Ingestion pipeline · Stage 5 profile hydration |
| **How** | Azure Maps Search Address API. Returns lat/lng. Stored in PostGIS `geography(Point, 4326)` column. Distance computed with `ST_DWithin`. |
| **Env vars needed** | `AZURE_MAPS_KEY` |
| **Next step** | Wire import-time batch geocoding in ingestion pipeline. |

---

### Idea 10 — LLM Intent Enrichment (gpt-4o-mini, opt-in)

| | |
|---|---|
| **Status** | 🔲 **Planned** |
| **Bucket** | C — Selective (per-query LLM call on hot path is expensive at scale) |
| **Feature flag** | New flag needed: `llm_intent_enrich` |
| **Why** | Current Stage 4 intent detection is schema-based keyword matching. It handles well-formed queries but may misclassify ambiguous or complex messages ("I just got out of the hospital and can't afford food and my landlord says I have 3 days"). An LLM classifier could detect multi-intent queries and weighted category assignments. |
| **What** | Optional replacement or supplement to keyword intent detection. gpt-4o-mini classifies message into one or more `IntentCategory` values with confidence weights. Only activated for messages that the keyword classifier rates as `general` (fallback) or that contain multiple potential categories. |
| **Where** | `src/services/chat/intentEnrich.ts` (new) · Stage 4 in orchestrator |
| **How** | Constrained generation: LLM prompt returns JSON `{categories: [{category, weight}], urgency}`. Output validated with Zod before use. Fallback to keyword intent on error. |
| **Constraint** | Never runs for messages that already trigger crisis routing. |
| **Cost concern** | One extra LLM call per general-fallback query. At S0 pricing this is ~$0.003/1K tokens. Volume-dependent — gate behind flag and monitor. |

---

### Idea 11 — Phi-4-mini: Scheduled Source Crawl Extraction

| | |
|---|---|
| **Status** | 🟡 **Function stub; pipeline not wired** |
| **Bucket** | B — Watch |
| **Feature flag** | None — background process |
| **Why** | ORAN's data freshness depends on regular re-crawling of provider website sources. The `scheduledCrawl` Azure Function currently runs daily but is a no-op stub. Phi-4-mini can extract structured updates from re-crawled HTML without human intervention. |
| **What** | Daily timer trigger: crawl all known source URLs, run Phi-4-mini extraction on changed pages (compare content hash), queue candidates with `source: 'scheduled_crawl'` and lower initial confidence for admin review. |
| **Where** | `functions/scheduledCrawl/index.ts` — stub (timer trigger, daily 06:00 UTC) · `functions/fetchPage/index.ts` — fetches raw HTML |
| **How** | `scheduledCrawl` → enqueue source URLs → `fetchPage` fetches and hashes → `extractService` runs Phi-4 extraction → `verifyCandidate` runs AI verification → `routeToAdmin` queues for human review. |
| **Shape** | Full ingestion pipeline (Ideas 3, 4, 11 together form the complete cycle). |

---

### Idea 12 — Cohere Embeddings: Confidence Score Calibration

| | |
|---|---|
| **Status** | 🔲 **Planned** |
| **Bucket** | B — Watch |
| **Feature flag** | None — background signal |
| **Why** | Current confidence scoring uses a rule-based weighted model (docs/SCORING_MODEL.md). Embedding-based similarity between a candidate's extracted fields and its source evidence can serve as an additional calibration signal: high similarity = high confidence the extraction is correct. |
| **What** | After extraction, compute cosine similarity between the extracted field text and the source evidence body. Feed this as an additional weight into the confidence score formula. |
| **Where** | `src/services/scoring/` (new signal) · `functions/verifyCandidate/index.ts` |
| **How** | Embed the extracted record fields (joined text) + the source page text. Compute similarity. Map to a 0–1 calibration multiplier. |
| **Depends on** | Idea 5 (embeddings service). |

---

### Idea 13 — Azure Document Intelligence: Intake Form Parsing

| | |
|---|---|
| **Status** | 🔲 **Planned** |
| **Bucket** | C — Selective (per-document billing; only on demand) |
| **Feature flag** | New flag needed: `doc_intelligence_intake` |
| **Why** | Many service providers submit updates via PDFs or scanned intake forms. Current ingestion only handles HTML. Azure Document Intelligence's prebuilt layout and key-value models can extract structured data from PDFs, scanned documents, and forms. |
| **What** | When a provider submits a PDF evidence document via `manualSubmit`, route it through Document Intelligence before running Phi-4 extraction. Parse tables, key-value pairs, and layout sections into clean text. |
| **Where** | `functions/manualSubmit/index.ts` — PDF ingestion path · New: `src/services/ingestion/docIntelligence.ts` |
| **How** | Azure Document Intelligence `prebuilt-layout` model. Returns page layout + key-value pairs as JSON. Feed cleaned JSON to Phi-4 for final HSDS structuring. |
| **Env vars needed** | `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` · `AZURE_DOCUMENT_INTELLIGENCE_KEY` |
| **Cost note** | $0.001/page for prebuilt-layout. Only activated for PDF submissions. At current volume this is effectively zero. |

---

### Idea 14 — gpt-4o-mini: Seeker Feedback Triage

| | |
|---|---|
| **Status** | 🔲 **Planned** |
| **Bucket** | C — Selective |
| **Feature flag** | `feedback_form` = `true` (flag exists); triage LLM sub-flag: new `llm_feedback_triage` |
| **Why** | Seekers submit free-text feedback about service quality, outdated information, or closures. Triaging these manually is slow. An LLM can classify feedback into: `record_outdated`, `service_closed`, `incorrect_phone`, `positive`, `out_of_scope`, etc., and route actionable reports automatically to the review queue. |
| **What** | On feedback submission: gpt-4o-mini classifies into a `FeedbackCategory` enum, extracts the specific field(s) referenced (if any), assigns urgency, and optionally creates a "suspected outdated" flag on the service record for admin review. |
| **Where** | New: `src/services/feedback/triage.ts` · Feedback submission API route |
| **Constraint** | Free-text feedback may contain seeker PII. Strip user-identifying context before sending to LLM. Only the problem description (not the submitter identity) is sent. |

---

### Idea 15 — Azure Speech (Text-to-Speech): Accessibility Audio Summaries

| | |
|---|---|
| **Status** | 🔲 **Planned** |
| **Bucket** | C — Selective (per-character billing; only on user request) |
| **Feature flag** | New flag needed: `tts_summaries` |
| **Why** | Seekers with visual impairments or low-literacy may benefit from audio versions of service summaries. Azure Neural TTS produces natural-sounding speech that integrates with the existing chat UI. |
| **What** | After chat response assembly (Stage 7/8), an optional "Listen" button triggers a TTS API call that returns an audio blob of the LLM-generated or assembled summary. Streamed back to the client. |
| **Where** | New: `src/services/tts/azureSpeech.ts` · Chat UI component |
| **How** | Azure Speech Service REST TTS endpoint. SSML input from the assembled summary. `en-US-JennyNeural` or locale-matched voice. Cache audio by `(messageHash, locale)` in Azure Blob Storage to avoid regenerating for repeated queries. |
| **Env vars needed** | `AZURE_SPEECH_KEY` · `AZURE_SPEECH_REGION` |
| **Cost note** | Azure Speech F0: 5 hours/month free. Neural HD: $16/1M chars at S0. Compress TTS to on-demand only, cache aggressively. |

---

### Idea 16 — Azure Application Insights + Smart Alerts (Observability)

| | |
|---|---|
| **Status** | 🟡 **Service scaffolded; not fully wired to AI-specific traces** |
| **Bucket** | A — Free (Application Insights free tier covers typical volume) |
| **Feature flag** | None — always-on operational hygiene |
| **Why** | As AI integrations go live, ORAN needs visibility into: LLM call latency, token usage, crisis-routing detection rates, model errors, Content Safety hit rates, and feature flag rollout impact. Without traces, it's impossible to know if models are performing as expected or costing more than projected. |
| **What** | Custom event tracking for every AI integration: LLM call duration, tokens used, model name, feature flag state, Content Safety severity distribution (no message content — only severity score), embeddings cache hit/miss rate, and ingestion pipeline stage durations. |
| **Where** | `src/services/telemetry/appInsights.ts` (existing scaffold) · Each AI integration service |
| **How** | Add `trackEvent('llm_summarize', {duration_ms, tokens, model, flag_enabled})` etc. at the call site of every AI service. No message content, no PII. Use Application Insights smart detection alerts for latency spikes and error rate increase. |
| **Next step** | Add telemetry calls to `llm.ts`, `contentSafety.ts`, and all ingestion pipeline stages. |

---

## Summary Status Table

| # | Integration | Status | Bucket | Flag | Resource |
|---|---|---|---|---|---|
| 1 | Chat LLM summarization (gpt-4o-mini) | ✅ Live | B | `llm_summarize` = on | `oranhf57ir-prod-oai` |
| 2 | Content Safety crisis gate | ✅ Live | A | `content_safety_crisis` = on | `ORAN-FOUNDRY-resource` |
| 3 | Phi-4 ingestion extraction | 🟡 Stub | B | `auto_check_gate` (off) | `ORAN-FOUNDRY-resource` |
| 4 | Phi-4 verification assist | 🟡 Stub | B | `auto_check_gate` (off) | `ORAN-FOUNDRY-resource` |
| 5 | Cohere vector semantic search | 🔲 Planned | B | `vector_search` (new) | `ORAN-FOUNDRY-resource` |
| 6 | Cohere service deduplication | 🔲 Planned | B | none (admin job) | `ORAN-FOUNDRY-resource` |
| 7 | gpt-4o-mini admin review assist | 🔲 Planned | C | `llm_admin_assist` (new) | `oranhf57ir-prod-oai` |
| 8 | Azure AI Translator multilingual | 🟡 Scaffolded | B | `multilingual_descriptions` (new) | separate resource |
| 9 | Azure Maps enhanced geocoding | 🟡 Partial | A | `map_enabled` = on | separate resource |
| 10 | gpt-4o-mini intent enrichment | 🔲 Planned | C | `llm_intent_enrich` (new) | `oranhf57ir-prod-oai` |
| 11 | Phi-4 scheduled crawl extraction | 🟡 Stub | B | none (background) | `ORAN-FOUNDRY-resource` |
| 12 | Cohere confidence calibration | 🔲 Planned | B | none (scoring signal) | `ORAN-FOUNDRY-resource` |
| 13 | Document Intelligence intake parsing | 🔲 Planned | C | `doc_intelligence_intake` (new) | separate resource |
| 14 | gpt-4o-mini feedback triage | 🔲 Planned | C | `llm_feedback_triage` (new) | `oranhf57ir-prod-oai` |
| 15 | Azure Speech TTS summaries | 🔲 Planned | C | `tts_summaries` (new) | separate resource |
| 16 | App Insights AI observability | 🟡 Scaffolded | A | always-on | existing App Insights |

---

## Implementation Priority Order

### Phase 1 — Already done (2026-03-05)
- ✅ Idea 2: Content Safety crisis gate (retrieval-safety, highest priority)
- ✅ Idea 1: Chat LLM summarization (seeker UX, immediate value)
- ✅ Azure resources provisioned: `gpt-4o-mini`, `phi-4-mini-instruct`, `cohere-embed-v3-multilingual`, Content Safety
- ✅ KV secrets wired to App Service + Function App

### Phase 2 — Ingestion pipeline (next priority)
Complete the pipeline so new services can be imported without manual data entry:
1. **Idea 3** — Wire `extractService` to `llmExtractStage`
2. **Idea 11** — Wire `scheduledCrawl` → `fetchPage` → `extractService` full cycle
3. **Idea 4** — Wire `verifyCandidate` with Phi-4 discrepancy check
4. **Idea 16** — Add telemetry to AI service call sites

### Phase 3 — Search quality
Improve retrieval relevance:
1. **Idea 5** — pgvector migration + Cohere embedding service + vector search
2. **Idea 6** — Deduplication batch job (depends on Idea 5)
3. **Idea 12** — Confidence calibration from embedding similarity (depends on Idea 5)

### Phase 4 — Seeker UX & accessibility
1. **Idea 8** — Multilingual descriptions (wire `translator.ts` to response assembly)
2. **Idea 9** — Import-time batch geocoding in ingestion pipeline
3. **Idea 10** — Intent enrichment (evaluate need vs cost first)
4. **Idea 15** — TTS summaries (accessibility win; budget before enabling)

### Phase 5 — Admin tooling & feedback
1. **Idea 7** — Admin review assist
2. **Idea 14** — Feedback triage
3. **Idea 13** — Document Intelligence for PDF intakes

---

## Engineering Log Entries

| Date | Event |
|---|---|
| 2026-03-05 | `oranhf57ir-prod-oai` (kind=OpenAI, S0, eastus) provisioned; `gpt-4o-mini` deployed |
| 2026-03-05 | `ORAN-FOUNDRY-resource` (kind=AIServices, S0, westus2); `phi-4-mini-instruct` + `cohere-embed-v3-multilingual` + Content Safety active |
| 2026-03-05 | KV secrets wired: `azure-openai-endpoint/key`, `azure-content-safety-endpoint/key` |
| 2026-03-05 | App Service + Function App env vars: `AZURE_OPENAI_*` + `AZURE_CONTENT_SAFETY_*` |
| 2026-03-05 | Idea 2 (contentSafety.ts) implemented + 19 tests passing |
| 2026-03-05 | Idea 1 (llm.ts) implemented + 8 tests passing; `llm_summarize` flag flipped to `true, 100%` |
| 2026-03-05 | `content_safety_crisis` flag flipped to `true, 100%` |
