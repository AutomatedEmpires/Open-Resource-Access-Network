# Ingestion Agent Output 001

**Date:** 2026-03-08
**URL:** `https://www.samhsa.gov/find-help/national-helpline`
**LLM:** Azure OpenAI `gpt-4o-mini` via `oranhf57ir-prod-oai`
**Pipeline:** 9-stage `PipelineOrchestrator` — all stages completed
**Duration:** 8,466 ms
**Correlation ID:** `7a9099da-3502-438b-81a3-ca789fcb0447`

---

## 1. Pipeline Summary

| Field | Value |
|---|---|
| Status | ✅ completed |
| Canonical URL | `https://www.samhsa.gov/find-help/helplines/national-helpline` |
| Source Trust | allowlisted (`bootstrap-gov`) |
| Confidence | **93** (🟢 green) |
| Evidence ID | `ddc518a012fb1d0abbecefbec934b85f` |
| Extraction ID | `dc69e485-dc02-4b02-88cc-e76fb46f4781` |
| Candidate ID | `91ae8d79-c1ea-44b8-8d96-35a63a795e44` |

---

## 2. What the LLM Actually Returned

### Stage 5 — `llm_extract` (5,595 ms)

The extraction prompt sends the page's extracted text (972 words) plus context (source URL, page title, source quality) to `gpt-4o-mini`. The LLM returns a JSON object validated by `ExtractionResultSchema` (Zod):

```json
{
  "services": [
    {
      "organizationName": "SAMHSA",
      "serviceName": "National Helpline",
      "description": "SAMHSA's National Helpline is a free, confidential, 24/7, 365-day-a-year treatment referral and information service for individuals and families facing mental and/or substance use disorders.",
      "category": null,
      "websiteUrl": "https://www.samhsa.gov/find-help/helplines/national-helpline",
      "phones": [
        { "number": "1-800-662-HELP (4357)", "type": "hotline", "context": null }
      ],
      "email": null,
      "address": {
        "line1": "",
        "line2": null,
        "city": "",
        "region": "",
        "postalCode": "",
        "country": "US"
      },
      "hours": [],
      "eligibility": null,
      "applicationProcess": null,
      "fees": null,
      "languages": ["English", "Spanish"],
      "isRemoteService": false,
      "serviceAreaDescription": null
    }
  ],
  "confidences": [
    {
      "organizationName": { "confidence": 95, "reasoning": null, "sourceSnippet": null },
      "serviceName":      { "confidence": 90, "reasoning": null, "sourceSnippet": null },
      "description":      { "confidence": 85, "reasoning": null, "sourceSnippet": null },
      "phones":           { "confidence": 95, "reasoning": null, "sourceSnippet": null }
    }
  ],
  "pageType": "service_listing",
  "extractionNotes": null
}
```

**Key observations:**

- The LLM returns explicit `null` for fields it can't determine (not `undefined`)
- `category` is `null` at this stage — the LLM extract prompt does NOT assign categories
- Field-level confidence scores: `organizationName` 95, `phones` 95, `serviceName` 90, `description` 85
- The LLM correctly identified the phone as a `hotline` type
- Address was returned as empty strings (national phone service, no physical location)
- Languages were correctly extracted: English and Spanish

### Stage 6 — `llm_categorize` (1,594 ms)

A separate LLM call is made specifically for categorization. The categorize prompt sends the extracted service data (org name, service name, description, eligibility, etc.) and asks the LLM to assign:

1. Exactly ONE `primaryCategory`
2. Up to 5 taxonomy tags with confidence scores

The LLM returned:

```json
{
  "tags": [
    { "tag": "mental_health",  "confidence": 90, "reasoning": null },
    { "tag": "substance_use",  "confidence": 90, "reasoning": null },
    { "tag": "crisis",         "confidence": 70, "reasoning": null }
  ],
  "primaryCategory": "mental_health"
}
```

**Key observations:**

- 3 category tags assigned with individual confidence scores
- `mental_health` and `substance_use` both scored 90 — the SAMHSA helpline covers both equally
- `crisis` scored 70 (strongly implied but not the primary purpose)
- The LLM was instructed: below 50 confidence → don't include the tag. All 3 cleared that threshold.

---

## 3. Database Table Mapping (Mocked)

The pipeline produces two artifacts that would be written to the database. Here is exactly what each table row would contain:

### Table: `evidence_snapshots`

This is the raw fetch evidence — the immutable record of what we downloaded.

| Column | Value |
|---|---|
| `id` | *(auto UUID)* |
| `evidence_id` | `ddc518a012fb1d0abbecefbec934b85f` |
| `canonical_url` | `https://www.samhsa.gov/find-help/helplines/national-helpline` |
| `fetched_at` | `2026-03-08T03:57:01.173Z` |
| `http_status` | `200` |
| `content_hash_sha256` | `3bf2d36a868381065ab03c80df22e3cca9ad26ece385f223140eacd3b9b3e92e` |
| `content_type` | `text/html; charset=UTF-8` |
| `content_length` | `785027` |
| `blob_storage_key` | *(null — blob storage not configured)* |
| `html_raw` | *(784,883 chars of raw HTML)* |
| `text_extracted` | `"Main page content\n\nTitle\n\nSAMHSA's National Helpline\n\nSAMHSA's National Helpline is a free, confidential, 24/7, 365-day-a-year treatment referral..."` *(972 words)* |
| `title` | `National Helpline for Mental Health, Drug, Alcohol Issues \| SAMHSA` |
| `meta_description` | `SAMHSA's National Helpline is a free, confidential, 24/7, 365-day-a-year treatment referral and information service (in English and Spanish) for individuals and families facing mental and/or substance use disorders.` |
| `language` | `en` |
| `job_id` | *(null — ad-hoc run, no job)* |
| `correlation_id` | `7a9099da-3502-438b-81a3-ca789fcb0447` |
| `created_at` | `2026-03-08T03:57:08.660Z` |

### Table: `ingestion_candidates`

This is the extracted + scored candidate ready for human review.

| Column | Value |
|---|---|
| `id` | *(auto UUID)* |
| `candidate_id` | `91ae8d79-c1ea-44b8-8d96-35a63a795e44` |
| `extraction_id` | `dc69e485-dc02-4b02-88cc-e76fb46f4781` |
| `extract_key_sha256` | `ccab6314b85135ab3df24a3dde012027ab4d3542d80e8901e7512143a4e7272e` |
| `extracted_at` | `2026-03-08T03:57:08.660Z` |
| `organization_name` | `SAMHSA` |
| `service_name` | `National Helpline` |
| `description` | `SAMHSA's National Helpline is a free, confidential, 24/7, 365-day-a-year treatment referral and information service for individuals and families facing mental and/or substance use disorders.` |
| `website_url` | `https://www.samhsa.gov/find-help/helplines/national-helpline` |
| `phone` | `1-800-662-HELP (4357)` |
| `phones` | `[{"number":"1-800-662-HELP (4357)","type":"hotline","context":null}]` |
| `address_line1` | *(empty — remote/phone service)* |
| `address_line2` | *(null)* |
| `address_city` | *(empty)* |
| `address_region` | *(empty)* |
| `address_postal_code` | *(empty)* |
| `address_country` | `US` |
| `is_remote_service` | `false` |
| `review_status` | `pending` |
| `assigned_to_role` | *(null)* |
| `assigned_to_user_id` | *(null)* |
| `confidence_score` | `93` |
| `confidence_tier` | `green` |
| `score_verification` | `92` |
| `score_completeness` | `100` |
| `score_freshness` | `80` |
| `verification_checklist` | *(see Section 5)* |
| `investigation_pack` | `{}` |
| `primary_evidence_id` | `ddc518a012fb1d0abbecefbec934b85f` |
| `provenance_records` | `[]` |
| `published_service_id` | *(null — not yet published)* |
| `correlation_id` | `7a9099da-3502-438b-81a3-ca789fcb0447` |

### Table: `resource_tags` (3 rows)

Each category tag from the LLM becomes a separate row in `resource_tags`:

| `target_id` | `target_type` | `tag_type` | `tag_value` | `confidence` | `source` |
|---|---|---|---|---|---|
| `91ae8d79-...` | `candidate` | `category` | `mental_health` | `90` | `llm` |
| `91ae8d79-...` | `candidate` | `category` | `substance_use` | `90` | `llm` |
| `91ae8d79-...` | `candidate` | `category` | `crisis` | `70` | `llm` |

### Table: `discovered_links` (50 rows — top 10 shown)

| `evidence_id` | `url` | `link_type` | `label` | `confidence` |
|---|---|---|---|---|
| `ddc518a0...` | `https://www.samhsa.gov/about/contact` | `contact` | `Contact Us` | `1.0` |
| — | `https://www.samhsa.gov/grants/how-to-apply` | `apply` | `How to Apply` | `1.0` |
| — | `https://www.samhsa.gov/grants/how-to-apply/application-guide` | `apply` | `Application Guide` | `1.0` |
| — | `https://nacoa.org/wp-content/uploads/2018/04/Its-Not-Your-Fault-NACoA.pdf` | `pdf` | `It's Not Your Fault (NACoA) (PDF \| 12 KB)` | `1.0` |
| — | `https://www.samhsa.gov/substance-use/learn/tobacco-vaping/synar/requirements` | `eligibility` | `Requirements` | `0.95` |
| — | `https://www.samhsa.gov/substance-use/treatment/resources/mat-act/training-requirements` | `eligibility` | `Training Requirements (MATE Act) Resources` | `0.95` |
| — | `https://www.samhsa.gov/find-support/.../connecticut` | `contact` | `Connecticut's Medicaid Program or CHIP` | `0.90` |
| — | `https://www.samhsa.gov/substance-use/treatment/contact` | `contact` | `Contact Information` | `0.90` |
| — | `https://www.samhsa.gov/grants/about/contact-information` | `contact` | `Contact Information` | `0.90` |
| — | `https://www.samhsa.gov/about/contact/speaker-request-form` | `contact` | `Speaker Request Form` | `0.90` |

**Link type distribution:** 14 contact, 15 apply, 9 eligibility, 3 PDF, 2 intake_form, 5 privacy, 2 other

---

## 4. Verification Checks (6 checks)

| Check | Severity | Status | Notes |
|---|---|---|---|
| `domain_allowlist` | info | ✅ pass | `samhsa.gov` is a `.gov` allowlisted domain |
| `contact_validity` | info | ✅ pass | Has phone number |
| `cross_source_agreement` | info | ✅ pass | Content hash matches fetched content |
| `hours_stability` | info | ✅ pass | *(no hours to validate)* |
| `location_plausibility` | warning | ❓ unknown | Address is empty — cannot verify location |
| `policy_constraints` | info | ✅ pass | No policy violations |

---

## 5. Verification Checklist

| Key | Required | Status |
|---|---|---|
| `contact_method` | ✅ | satisfied — phone present |
| `physical_address_or_virtual` | ✅ | satisfied — address fields present *(even if empty)* |
| `service_area` | ✅ | satisfied |
| `eligibility_criteria` | ✅ | satisfied |
| `hours` | ✅ | not_applicable |
| `source_provenance` | ✅ | satisfied — evidence ID linked |
| `duplication_review` | ✅ | not_applicable — first ingestion |
| `policy_pass` | ✅ | satisfied — all policy checks passed |

---

## 6. Confidence Score Breakdown

```
Overall Score: 93 (🟢 green tier)

  Verification  ████████████████████████████████████████████ 92
  Completeness  ██████████████████████████████████████████████████ 100
  Freshness     ████████████████████████████████████████ 80
```

| Sub-score | Value | How Computed |
|---|---|---|
| Verification | 92 | Weighted pass rate: 5/6 checks pass, 1 unknown (location) |
| Completeness | 100 | All verification checklist items satisfied or not_applicable |
| Freshness | 80 | Allowlisted source + first fetch = fresh |

---

## 7. Where Taxonomy Labeling Happens — and What's Missing

### Current Flow

```
Stage 5: llm_extract     →  Extracts raw service data (no category assignment)
                              ↓
Stage 6: llm_categorize  →  LLM assigns 1 primaryCategory + up to 5 tags
                              with confidence scores from CATEGORY_TAGS taxonomy
                              ↓
Stage 7: verify           →  Runs 6 automated quality checks
Stage 8: score            →  Computes overall confidence score
Stage 9: build_candidate  →  Packages everything into candidate + tags
                              ↓
                           resource_tags table:
                              mental_health (90), substance_use (90), crisis (70)
                              ↓
                           Candidate goes to review queue (review_status = 'pending')
                              ↓
                           Community Admin reviews → approves/rejects → publish
```

### The Taxonomy Today

The taxonomy is defined in `src/agents/ingestion/tags.ts` and has **four tag dimensions**:

| Dimension | Tag Count | Examples | When Applied |
|---|---|---|---|
| **Category** (`CATEGORY_TAGS`) | 20 | food, housing, healthcare, mental_health, crisis, other | Stage 6 (`llm_categorize`) — LLM assigns with confidence scores |
| **Audience** (`AUDIENCE_TAGS`) | 17 | veteran, senior, family, youth, homeless, lgbtq, rural | **⚠️ NOT currently assigned during ingestion** |
| **Program** (`PROGRAM_TAGS`) | 13+ | snap, wic, medicaid, section8, liheap, ssi, va_benefits | **⚠️ NOT currently assigned during ingestion** |
| **Source Quality** | 4 | gov_source, edu_source, quarantine_source | Derivable from source trust level but **not written as tags** |

### The Gap You Identified

**The `llm_categorize` stage only assigns category-dimension tags.** It does NOT:

1. **Assign audience tags** — SAMHSA's helpline serves "family", "youth", "immigrant" (Spanish-language), etc. This information is in the extracted text but never tagged.
2. **Assign program tags** — The helpline connects callers to Medicaid programs. This could be tagged `medicaid`.
3. **Assign source quality tags** — We have `trustLevel = allowlisted` but don't persist a `gov_source` tag.
4. **Apply geographic tags** — No geographic taxonomy is applied (national service → `national` tag).
5. **Cross-validate against the full taxonomy** — There's no post-extraction step that systematically compares the candidate against all 50+ possible tag values.

### Where in the Pipeline Should Full Taxonomy Labeling Happen?

There are two natural insertion points:

**Option A: Expand Stage 6 (`llm_categorize`)**

Add audience, program, and geographic dimensions to the existing categorization prompt. The LLM already sees the full service description — it could simultaneously assign:

- Category tags (already done)
- Audience tags: "Who is this service for?"
- Program tags: "Which public benefit programs does this relate to?"

**Pros:** Single LLM call, data is available.
**Cons:** More complex prompt, higher token usage, potential quality dilution.

**Option B: Add a new Stage 6b (`taxonomy_label`) between categorize and verify**

A dedicated taxonomy labeling step that takes the extracted service + category tags and runs a focused LLM call comparing against all AUDIENCE_TAGS + PROGRAM_TAGS.

**Pros:** Separation of concerns, can be iterated independently.
**Cons:** Additional LLM call (~1-2s), additional latency.

**Option C: Post-ingestion enrichment (before publish)**

When a community admin reviews the candidate, a "taxonomy enrichment" step runs automatically — comparing the candidate against the full tag set and suggesting additional labels. The admin confirms or corrects.

**Pros:** Human-in-the-loop for taxonomy quality, doesn't slow pipeline.
**Cons:** Delays full labeling until review time.

### What Would Full Taxonomy Output Look Like for This SAMHSA Candidate?

If we applied all taxonomy dimensions, the `resource_tags` table would contain:

| `tag_type` | `tag_value` | `confidence` | `source` | Status |
|---|---|---|---|---|
| category | `mental_health` | 90 | llm | ✅ exists today |
| category | `substance_use` | 90 | llm | ✅ exists today |
| category | `crisis` | 70 | llm | ✅ exists today |
| audience | `family` | 80 | llm | ⚠️ missing — "for individuals and families" |
| audience | `youth` | 60 | llm | ⚠️ missing — implied by linked resources |
| audience | `low_income` | 65 | llm | ⚠️ missing — "sliding fee scale" |
| audience | `immigrant` | 55 | llm | ⚠️ missing — Spanish language service |
| program | `medicaid` | 60 | llm | ⚠️ missing — "accept Medicare or Medicaid" |
| program | `medicare` | 55 | llm | ⚠️ missing — explicitly mentioned |
| source_quality | `gov_source` | 100 | system | ⚠️ missing — derivable from trust level |
| geographic | `national` | 95 | llm | ⚠️ missing — "365-day-a-year" nationwide service |
| verification_status | `pending` | 100 | system | ⚠️ missing — derivable from review_status |

**That's 12 tags vs the current 3.** The missing 9 tags would significantly improve search faceting and seeker matching.

---

## 8. Field Confidences (from LLM)

The LLM reports per-field confidence on extraction quality. These are stored in the candidate artifact's `fieldConfidences` object:

| Field | Confidence | Interpretation |
|---|---|---|
| `organizationName` | **95** | "SAMHSA" — explicitly stated in page title and body |
| `phones` | **95** | "1-800-662-HELP (4357)" — prominently displayed |
| `serviceName` | **90** | "National Helpline" — stated but the LLM shortened it |
| `description` | **85** | Extracted from first paragraph — good but summarized |
| `address` | *(not reported)* | Empty fields — no physical address on page |
| `eligibility` | *(not reported)* | The LLM didn't extract structured eligibility |
| `hours` | *(not reported)* | "24/7, 365-day-a-year" — present in text but not structured |

**Unreported fields get no confidence score, which means the pipeline uses a default of 50 when computing the overall average.**

Average: (95 + 95 + 90 + 85) / 4 = **91.25** → reported as 91

---

## 9. What Happens Next in the Lifecycle

```
                    WE ARE HERE
                        ↓
  ┌──────────────────────────────────────────────────────────┐
  │  Pipeline Output → ingestion_candidates (pending)        │
  │                  → resource_tags (3 category tags)       │
  │                  → evidence_snapshots (raw HTML + text)   │
  │                  → discovered_links (50 links)            │
  └──────────┬───────────────────────────────────────────────┘
             │
             ▼
  ┌──────────────────────────────────────────────────────────┐
  │  COMMUNITY ADMIN REVIEW QUEUE                            │
  │  • Candidate appears with confidence 93 (green tier)     │
  │  • Admin sees: org name, service name, description,      │
  │    phone, category tags, verification checklist,         │
  │    investigation links                                   │
  │  • Admin can: approve, reject, edit fields, add tags     │
  └──────────┬───────────────────────────────────────────────┘
             │  approve
             ▼
  ┌──────────────────────────────────────────────────────────┐
  │  PUBLISH TO SERVICES TABLE                               │
  │  • review_status → 'approved'                            │
  │  • published_service_id → new services row UUID          │
  │  • published_at → timestamp                              │
  │  • Resource becomes searchable by seekers                │
  └──────────────────────────────────────────────────────────┘
```

**The resource is NOT publicly listed until a human admin approves it.** The pipeline outputs a draft candidate that goes into the review queue. At no point does the pipeline auto-publish.

---

## 10. Extracted Text (what the LLM saw)

The text extraction stage produced 972 words from the SAMHSA page. This is the input the LLM used for both extraction and categorization:

> **SAMHSA's National Helpline**
>
> SAMHSA's National Helpline is a free, confidential, 24/7, 365-day-a-year treatment referral and information service (in English and Spanish) for individuals and families facing mental and/or substance use disorders.
>
> 1-800-662-HELP (4357)
>
> **What is SAMHSA's National Helpline?**
>
> SAMHSA's National Helpline, 1-800-662-HELP (4357) (also known as the Treatment Referral Routing Service), or TTY: 1-800-487-4889 is a confidential, free, 24-hour-a-day, 365-day-a-year, information service, in English and Spanish, for individuals and family members facing mental and/or substance use disorders. This service provides referrals to local treatment facilities, support groups, and community-based organizations.
>
> **Do I need health insurance to receive this service?**
>
> The referral service is free of charge. If you have no insurance or are underinsured, we will refer you to your state office, which is responsible for state-funded treatment programs. In addition, we can often refer you to facilities that charge on a sliding fee scale or accept Medicare or Medicaid.
>
> **Will my information be kept confidential?**
>
> The service is confidential. We will not ask you for any personal information.
>
> *(+ 600 more words covering FAQ, SMS service, suggested resources)*

---

## Environment

```
Node.js       : v22.x
Pipeline      : PipelineOrchestrator (src/agents/ingestion/pipeline/orchestrator.ts)
LLM Provider  : azure_openai
LLM Model     : gpt-4o-mini (deployment: oranhf57ir-prod-oai)
LLM Endpoint  : https://oranhf57ir-prod-oai.openai.azure.com/
API Version   : 2024-08-01-preview
Fetch Timeout : 30,000 ms
LLM Timeout   : 120,000 ms
```
