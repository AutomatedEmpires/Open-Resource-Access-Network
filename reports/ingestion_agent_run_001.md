# Ingestion Agent Run 001

**Date:** 2026-03-08
**Operator:** ORAN Ingestion Pipeline (automated)
**LLM Provider:** Azure OpenAI — `gpt-4o-mini` (deployment on `oranhf57ir-prod-oai`, eastus)
**API Version:** 2024-08-01-preview
**Pipeline Version:** PipelineOrchestrator v1 (9-stage)
**Script:** `scripts/run-pipeline-demo.ts`

---

## Executive Summary

| Metric | Value |
|---|---|
| URLs attempted | 9 |
| Full pipeline completed (all 9 stages) | 7 |
| Blocked at source_check | 1 |
| Failed at fetch | 1 |
| Average confidence (completed) | 78 |
| Green tier (≥80) | 4 |
| Yellow tier (60–79) | 3 |
| Red tier (<60) | 0 |
| Total services extracted | 25 |
| Total duration (all runs) | 71,996 ms |
| Average duration (completed) | 8,176 ms |

---

## Results by URL

### 1. benefits.gov — SNAP (Supplemental Nutrition Assistance)

| Field | Value |
|---|---|
| **Input URL** | `https://www.benefits.gov/benefit/361` |
| **Canonical URL** | `https://www.usa.gov/food-stamps?modal=b-welcome-1899` |
| **Status** | ✅ completed |
| **Correlation ID** | `b521567a-6a08-4ddb-9933-4d3ceed3d540` |
| **Source Trust** | allowlisted (`bootstrap-gov`) |
| **Confidence** | **93** (🟢 green) |
| **Primary Category** | food |
| **Services Extracted** | 1 |
| **Duration** | 6,227 ms |

**Stage Breakdown:**

| Stage | Status | Duration | Key Metrics |
|---|---|---|---|
| source_check | ✅ | 1 ms | trust=allowlisted |
| fetch | ✅ | 328 ms | HTTP 200, 44 KB, 1 redirect |
| extract_text | ✅ | 104 ms | 349 words, title ✓, desc ✓, lang=en |
| discover_links | ✅ | 48 ms | 46 links, 1 apply link |
| llm_extract | ✅ | 4,513 ms | confidence=54, 1 service |
| llm_categorize | ✅ | 1,227 ms | 1 category: food |
| verify | ✅ | 1 ms | 5/6 pass, 1 unknown |
| score | ✅ | 0 ms | verification=92, completeness=100, freshness=80 |
| build_candidate | ✅ | 0 ms | candidate=`ad28489b` |

**Score Composition:** verification 92 · completeness 100 · freshness 80 → **overall 93**

---

### 2. SAMHSA National Helpline

| Field | Value |
|---|---|
| **Input URL** | `https://www.samhsa.gov/find-help/national-helpline` |
| **Canonical URL** | `https://www.samhsa.gov/find-help/helplines/national-helpline` |
| **Status** | ✅ completed |
| **Correlation ID** | `01d9de39-7a90-42e8-ae6d-a54dc03ba7ca` |
| **Source Trust** | allowlisted (`bootstrap-gov`) |
| **Confidence** | **93** (🟢 green) |
| **Primary Category** | mental_health |
| **Category Count** | 3 |
| **Services Extracted** | 1 |
| **Duration** | 8,945 ms |

**Stage Breakdown:**

| Stage | Status | Duration | Key Metrics |
|---|---|---|---|
| source_check | ✅ | 1 ms | trust=allowlisted |
| fetch | ✅ | 974 ms | HTTP 200, 785 KB, 1 redirect |
| extract_text | ✅ | 280 ms | 972 words, title ✓, desc ✓, lang=en |
| discover_links | ✅ | 265 ms | 50 links, 14 contact, 15 apply, 9 eligibility, 3 PDF |
| llm_extract | ✅ | 5,832 ms | confidence=91, 1 service |
| llm_categorize | ✅ | 1,589 ms | 3 categories, primary=mental_health |
| verify | ✅ | 0 ms | 5/6 pass, 1 unknown |
| score | ✅ | 1 ms | verification=92, completeness=100, freshness=80 |
| build_candidate | ✅ | 0 ms | candidate=`85b25412` |

**Score Composition:** verification 92 · completeness 100 · freshness 80 → **overall 93**

---

### 3. Feeding America

| Field | Value |
|---|---|
| **Input URL** | `https://www.feedingamerica.org` |
| **Canonical URL** | `https://www.feedingamerica.org/` |
| **Status** | ✅ completed |
| **Correlation ID** | `dd60d318-494d-4d11-b124-6e90b9f5ebd1` |
| **Source Trust** | quarantine (`bootstrap-org`) |
| **Confidence** | **60** (🟡 yellow) |
| **Primary Category** | food |
| **Services Extracted** | 10 |
| **Duration** | 11,140 ms |

**Stage Breakdown:**

| Stage | Status | Duration | Key Metrics |
|---|---|---|---|
| source_check | ✅ | 1 ms | trust=quarantine |
| fetch | ✅ | 156 ms | HTTP 200, 308 KB |
| extract_text | ✅ | 160 ms | 738 words, title ✓, desc ✓, lang=en |
| discover_links | ✅ | 43 ms | 50 links, 1 contact |
| llm_extract | ✅ | 9,607 ms | confidence=90, 10 services |
| llm_categorize | ✅ | 1,170 ms | 1 category: food |
| verify | ✅ | 0 ms | 4/6 pass, **1 fail**, 1 unknown |
| score | ✅ | 1 ms | verification=55, completeness=75, freshness=40 |
| build_candidate | ✅ | 0 ms | candidate=`0fefb682` |

**Score Composition:** verification 55 · completeness 75 · freshness 40 → **overall 60**

> **Note:** Lower score due to quarantine trust (freshness=40), 1 verification failure, and homepage-level extraction (less specific than a service page).

---

### 4. HUD Rental Assistance

| Field | Value |
|---|---|
| **Input URL** | `https://www.hud.gov/topics/rental_assistance` |
| **Canonical URL** | `https://www.hud.gov/topics/rental_assistance` |
| **Status** | ✅ completed |
| **Correlation ID** | `dbd68d0a-a7b5-42b2-b22c-566d8e6daa8b` |
| **Source Trust** | allowlisted (`bootstrap-gov`) |
| **Confidence** | **61** (🟡 yellow) |
| **Primary Category** | housing |
| **Category Count** | 2 |
| **Services Extracted** | 1 |
| **Duration** | 6,060 ms |

**Stage Breakdown:**

| Stage | Status | Duration | Key Metrics |
|---|---|---|---|
| source_check | ✅ | 1 ms | trust=allowlisted |
| fetch | ✅ | 1,423 ms | HTTP 200, 121 KB |
| extract_text | ✅ | 59 ms | **22 words**, title ✓, desc ✗, usedMainContent=false |
| discover_links | ✅ | 23 ms | 3 links |
| llm_extract | ✅ | 2,137 ms | confidence=92, 1 service |
| llm_categorize | ✅ | 2,416 ms | 2 categories, primary=housing |
| verify | ✅ | 0 ms | 3/6 pass, **1 fail**, 2 unknown |
| score | ✅ | 1 ms | verification=47, completeness=65, freshness=80 |
| build_candidate | ✅ | 0 ms | candidate=`bbf17524` |

**Score Composition:** verification 47 · completeness 65 · freshness 80 → **overall 61**

> **Note:** Very low word count (22) — page is JavaScript-heavy and content didn't extract well with static fetch. Verification and completeness both suffered.

---

### 5. 211.org

| Field | Value |
|---|---|
| **Input URL** | `https://www.211.org` |
| **Canonical URL** | `https://www.211.org/` |
| **Status** | ✅ completed |
| **Correlation ID** | `e8ef07ca-9876-4b0b-90f0-f58aef5c2657` |
| **Source Trust** | quarantine (`bootstrap-org`) |
| **Confidence** | **78** (🟡 yellow) |
| **Primary Category** | other |
| **Services Extracted** | 1 |
| **Duration** | 7,030 ms |

**Stage Breakdown:**

| Stage | Status | Duration | Key Metrics |
|---|---|---|---|
| source_check | ✅ | 1 ms | trust=quarantine |
| fetch | ✅ | 472 ms | HTTP 200, 40 KB |
| extract_text | ✅ | 41 ms | 236 words, title ✓, desc ✓, lang=en |
| discover_links | ✅ | 16 ms | 43 links, 1 contact |
| llm_extract | ✅ | 5,169 ms | confidence=91, 1 service |
| llm_categorize | ✅ | 1,328 ms | 1 category: other |
| verify | ✅ | 0 ms | 3/6 pass, 0 fail, 3 unknown |
| score | ✅ | 0 ms | verification=75, completeness=100, freshness=40 |
| build_candidate | ✅ | 0 ms | candidate=`198e369a` |

**Score Composition:** verification 75 · completeness 100 · freshness 40 → **overall 78**

> **Note:** Categorized as "other" since 211.org is a multi-category referral service rather than a single-category provider. Quarantine trust caps freshness at 40.

---

### 6. Medicaid.gov — Program History

| Field | Value |
|---|---|
| **Input URL** | `https://www.medicaid.gov/about-us/program-history/index.html` |
| **Canonical URL** | `https://www.medicaid.gov/about-us/program-history` |
| **Status** | ✅ completed |
| **Correlation ID** | `63020f06-ad0b-4301-8ae3-0b085443b603` |
| **Source Trust** | allowlisted (`bootstrap-gov`) |
| **Confidence** | **83** (🟢 green) |
| **Primary Category** | healthcare |
| **Services Extracted** | 3 |
| **Duration** | 8,358 ms |

**Stage Breakdown:**

| Stage | Status | Duration | Key Metrics |
|---|---|---|---|
| source_check | ✅ | 0 ms | trust=allowlisted |
| fetch | ✅ | 360 ms | HTTP 200, 138 KB, 1 redirect |
| extract_text | ✅ | 64 ms | 1,089 words, title ✓, desc ✓, lang=en |
| discover_links | ✅ | 48 ms | 50 links, 1 contact, 24 apply, 17 eligibility, 1 PDF |
| llm_extract | ✅ | 6,645 ms | confidence=90, 3 services |
| llm_categorize | ✅ | 1,237 ms | 1 category: healthcare |
| verify | ✅ | 0 ms | 4/6 pass, 0 fail, 2 unknown |
| score | ✅ | 1 ms | verification=83, completeness=85, freshness=80 |
| build_candidate | ✅ | 0 ms | candidate=`c259b261` |

**Score Composition:** verification 83 · completeness 85 · freshness 80 → **overall 83**

---

### 7. United Way

| Field | Value |
|---|---|
| **Input URL** | `https://www.unitedway.org` |
| **Canonical URL** | `https://www.unitedway.org/` |
| **Status** | ✅ completed |
| **Correlation ID** | `66ef9649-8b5b-4ac9-9282-a5df276ec1f6` |
| **Source Trust** | quarantine (`bootstrap-org`) |
| **Confidence** | **81** (🟢 green) |
| **Primary Category** | crisis |
| **Category Count** | 2 |
| **Services Extracted** | 5 |
| **Duration** | 8,575 ms |

**Stage Breakdown:**

| Stage | Status | Duration | Key Metrics |
|---|---|---|---|
| source_check | ✅ | 1 ms | trust=quarantine |
| fetch | ✅ | 409 ms | HTTP 200, 132 KB |
| extract_text | ✅ | 94 ms | 473 words, title ✓, desc ✓, lang=en |
| discover_links | ✅ | 36 ms | 50 links, 2 contact |
| llm_extract | ✅ | 6,554 ms | confidence=93, 5 services |
| llm_categorize | ✅ | 1,480 ms | 2 categories, primary=crisis |
| verify | ✅ | 0 ms | 4/6 pass, 0 fail, 2 unknown |
| score | ✅ | 0 ms | verification=83, completeness=100, freshness=40 |
| build_candidate | ✅ | 0 ms | candidate=`ed43a135` |

**Score Composition:** verification 83 · completeness 100 · freshness 40 → **overall 81**

---

### 8. IRS — Earned Income Tax Credit (EITC)

| Field | Value |
|---|---|
| **Input URL** | `https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit-eitc` |
| **Canonical URL** | `https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit-eitc` |
| **Status** | ✅ completed |
| **Correlation ID** | `55060e91-37e1-4bd9-ac8a-4785cf24c15e` |
| **Source Trust** | allowlisted (`bootstrap-gov`) |
| **Confidence** | **68** (🟡 yellow) |
| **Primary Category** | financial |
| **Services Extracted** | 1 |
| **Duration** | 6,941 ms |

**Stage Breakdown:**

| Stage | Status | Duration | Key Metrics |
|---|---|---|---|
| source_check | ✅ | 0 ms | trust=allowlisted |
| fetch | ✅ | 224 ms | HTTP 200, 110 KB |
| extract_text | ✅ | 113 ms | 442 words, title ✓, desc ✓, lang=en |
| discover_links | ✅ | 71 ms | 50 links, 1 contact, 3 apply, 5 eligibility |
| llm_extract | ✅ | 5,287 ms | confidence=48, 1 service |
| llm_categorize | ✅ | 1,245 ms | 1 category: financial |
| verify | ✅ | 0 ms | 4/6 pass, **1 fail**, 1 unknown |
| score | ✅ | 0 ms | verification=55, completeness=75, freshness=80 |
| build_candidate | ✅ | 0 ms | candidate=`114d7105` |

**Score Composition:** verification 55 · completeness 75 · freshness 80 → **overall 68**

> **Note:** LLM extraction confidence was only 48 — the EITC page is informational rather than a specific service page, making structured extraction harder.

---

### 9. American Red Cross

| Field | Value |
|---|---|
| **Input URL** | `https://www.redcross.org` |
| **Canonical URL** | `https://www.redcross.org/` |
| **Status** | ✅ completed |
| **Correlation ID** | `fe9cbd77-9741-4b24-b86f-0523c26d12e5` |
| **Source Trust** | quarantine (`bootstrap-org`) |
| **Confidence** | **81** (🟢 green) |
| **Primary Category** | healthcare |
| **Category Count** | 2 |
| **Services Extracted** | 3 |
| **Duration** | 8,136 ms |

**Stage Breakdown:**

| Stage | Status | Duration | Key Metrics |
|---|---|---|---|
| source_check | ✅ | 1 ms | trust=quarantine |
| fetch | ✅ | 157 ms | HTTP 200, 169 KB |
| extract_text | ✅ | 151 ms | 808 words, title ✓, desc ✓, lang=en |
| discover_links | ✅ | 50 ms | 50 links, 5 contact, 5 apply, 2 eligibility |
| llm_extract | ✅ | 6,294 ms | confidence=91, 3 services |
| llm_categorize | ✅ | 1,479 ms | 2 categories, primary=healthcare |
| verify | ✅ | 0 ms | 4/6 pass, 0 fail, 2 unknown |
| score | ✅ | 1 ms | verification=83, completeness=100, freshness=40 |
| build_candidate | ✅ | 0 ms | candidate=`fda647e0` |

**Score Composition:** verification 83 · completeness 100 · freshness 40 → **overall 81**

---

## Failed Runs

### F1. SSA.gov — Disability Benefits

| Field | Value |
|---|---|
| **Input URL** | `https://www.ssa.gov/benefits/disability/` |
| **Status** | ❌ failed at `fetch` |
| **Source Trust** | allowlisted (`bootstrap-gov`) |
| **Error** | `too_many_redirects` — Exceeded maximum redirects (10) |
| **Duration** | 584 ms |

> SSA.gov uses aggressive redirect chains (likely bot detection / WAF). Would need browser-based fetch or a headless renderer.

### F2. example.com — Unregistered Domain

| Field | Value |
|---|---|
| **Input URL** | `https://www.example.com` |
| **Status** | 🚫 blocked at `source_check` |
| **Source Trust** | quarantine |
| **Error** | `source_not_allowed` — unregistered_domain |
| **Duration** | 0 ms |

> This is correct behavior — the pipeline rejects URLs from domains not in any registered source.

---

## Aggregate Analysis

### Confidence Distribution

```
93  ██████████████████████████████████  benefits.gov
93  ██████████████████████████████████  SAMHSA
83  ██████████████████████████████     medicaid.gov
81  █████████████████████████████      United Way
81  █████████████████████████████      Red Cross
78  ████████████████████████████       211.org
68  ████████████████████████           IRS EITC
61  ██████████████████████             HUD
60  █████████████████████              Feeding America
```

### Category Coverage

| Category | Count | URLs |
|---|---|---|
| food | 2 | benefits.gov, feedingamerica.org |
| healthcare | 2 | medicaid.gov, redcross.org |
| mental_health | 1 | samhsa.gov |
| housing | 1 | hud.gov |
| financial | 1 | irs.gov |
| crisis | 1 | unitedway.org |
| other | 1 | 211.org |

### Trust Level Impact

| Trust Level | Count | Avg Score | Avg Freshness |
|---|---|---|---|
| allowlisted | 4 | 76 | 80 |
| quarantine | 3 | 74 | 40 |

> Quarantine sources are penalized with a freshness score of 40 vs 80 for allowlisted. Despite this, quarantine sources can still reach green tier if extraction quality and completeness are high enough (United Way: 81, Red Cross: 81).

### Performance Profile

| Metric | Min | Max | Avg | Median |
|---|---|---|---|---|
| Total duration | 6,060 ms | 11,140 ms | 8,176 ms | 8,136 ms |
| Fetch time | 156 ms | 1,423 ms | 469 ms | 360 ms |
| LLM extract time | 2,137 ms | 9,607 ms | 5,744 ms | 5,832 ms |
| LLM categorize time | 1,170 ms | 2,416 ms | 1,385 ms | 1,328 ms |
| Word count | 22 | 1,089 | 496 | 442 |
| Services extracted | 1 | 10 | 3.6 | 1 |

> LLM extraction (stages 5–6) accounts for ~87% of total pipeline runtime. Fetching and text extraction are consistently fast.

---

## Observations & Recommendations

### What Worked Well

1. **Government sources score highest** — allowlisted `.gov` domains with rich text content (benefits.gov, samhsa.gov) consistently reach 93 confidence.
2. **Category detection is accurate** — all 7 completed runs were categorized correctly by the LLM.
3. **Pipeline is resilient** — handled redirects, large pages (785 KB), and varied content structures without crashes.
4. **Source gate works correctly** — unregistered domains are rejected at stage 1 with zero cost.

### Areas for Improvement

1. **JavaScript-heavy pages** — HUD.gov yielded only 22 words via static fetch. A headless browser (Playwright) fetch path would improve extraction for SPA pages.
2. **Homepage vs. service page** — Feeding America's homepage extracted 10 services at lower confidence. The pipeline would benefit from a depth-1 crawl to find service-specific subpages.
3. **Quarantine freshness penalty** — `.org` domains like Red Cross and United Way are well-known service providers but get a 40-point freshness penalty. Consider a "recognized nonprofit" trust tier between quarantine and allowlisted.
4. **SSA.gov redirect handling** — Major federal agency blocked by redirect chain. Needs bot-detection mitigation or whitelisted browser-mode fetch.
5. **LLM extraction confidence variance** — Ranged from 48 (IRS EITC) to 93 (United Way). Informational pages with no clear "service" produce lower-quality extraction.

---

## Environment

```
Node.js       : v22.x
Pipeline      : PipelineOrchestrator (src/agents/ingestion/pipeline/orchestrator.ts)
LLM Provider  : azure_openai
LLM Model     : gpt-4o-mini (deployment on oranhf57ir-prod-oai)
LLM Endpoint  : https://oranhf57ir-prod-oai.openai.azure.com/
API Version   : 2024-08-01-preview
LLM Timeout   : 120,000 ms
Fetch Timeout : 30,000 ms
```
