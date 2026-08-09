# ORAN Chat Architecture

The ORAN chatbot is a **retrieval-first** pipeline. No LLM participates in crisis routing, retrieval, ranking, eligibility assessment, or publication. The production `/api/chat` route is deterministic and does not wire the optional LLM summarizer or intent-enrichment adapters. The retrieval architecture can support multiple regions, but current trusted regional supply is the reviewed Washington cohort.

---

## Pipeline Overview

```
User Message
     │
     ▼
┌──────────────────────────┐
│  1a. Crisis Scope +      │  ← Visible-message keyword gate (sync, local)
│      Keyword Detection   │
└──────────────────────────┘
     │ crisis detected?
     ├── YES → Return 911/988/211 routing immediately. STOP.
     │
     ▼ no keyword match
┌──────────────────────────────────────────────────┐
│  1b. Indirect Distress Signals                   │  ← hasDistressSignals() (sync, local)
│      Provider-independent; no text leaves ORAN   │
└──────────────────────────────────────────────────┘
     │ first-person distress signal?
     ├── YES → Return 911/988/211 routing immediately. STOP.
     │
     ▼ not crisis
┌──────────────────────────────────────────────┐
│  2–3. Shared Usage Reservation               │  ← Atomic PostgreSQL quota, rate, in-flight guard
│      Anonymous/authenticated 24-hour quota   │  ← Configured DB failure returns 503
└──────────────────────────────────────────────┘
     │ denied?
     ├── YES → Return 429 or retryable 503. STOP.
     │
     ▼ reserved
┌─────────────────────┐
│  4. Intent Detection │  ← Schema-based keyword + pattern matching
└─────────────────────┘
     │
     ▼
┌──────────────────────────────────────────────┐
│  4a. Clarification + Crisis Scope Guard      │  ← Deterministic weak-query and third-party crisis handling
└──────────────────────────────────────────────┘
     │ clarification required?
     ├── YES → Return clarification response with truthful next-step chips. STOP.
     │
     ▼ can search
┌─────────────────────┐
│  4b. Scope Guard     │  ← Deterministic off-topic / out-of-scope check
└─────────────────────┘
     │ out of scope?
     ├── YES → Return service-finding boundary message. STOP.
     │
     ▼ in scope
┌─────────────────────┐
│  5. Profile Hydration│  ← Load saved user preferences if authenticated
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│  6. Retrieval        │  ← Pure SQL/PostGIS query, NO LLM
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│  7. Response Assembly│  ← Build structured response from records
└─────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│  8. LLM Summarization Gate (DORMANT)    │  ← Requires explicit adapter wiring and flag
│     LLM may ONLY summarize retrieved    │  ← Never retrieve or rank
│     records. Input = DB records only.   │
└─────────────────────────────────────────┘
     │
     ▼
Return ChatResponse (with eligibility disclaimer always included)
```

Client-side execution note:

- The seeker chat surface may intercept explicit local execution commands before the API call when the user references the most recent result set with deterministic phrases such as `add the first result to my plan` or `remind me tomorrow about the second result`.
- These commands remain local-first, require explicit confirmation in the UI, and only mutate seeker plan/reminder state on the current device.
- They do not bypass crisis routing, do not invent provider facts, and do not create server-side execution history in the current phase.

---

## Stage Details

### Stage 1a: Crisis Scope and Keyword Gate

- Runs synchronously before any other processing
- Checks message against `CRISIS_KEYWORDS` constant (50+ terms)
- Applies subject-awareness before hard-routing so clearly third-party or informational crisis language does not trigger the self-harm hard stop
- Categories: suicidal ideation, self-harm, domestic violence, imminent danger, overdose, child abuse, homelessness emergency
- **On detection**: Immediately return response containing:
  - Emergency numbers: **911** (life-threatening emergency)
  - Crisis line: **988** (Suicide & Crisis Lifeline)
  - Community support: **211** (local social services)

### Stage 1b: Indirect Distress Signal Gate

- Runs synchronously when the explicit keyword gate does not decide the turn
- Uses local `hasDistressSignals()` patterns for indirect first-person phrases such as "no way out" or "nobody would miss me"
- Uses the same subject-awareness boundary as the explicit keyword gate so third-party and informational requests receive conservative guidance without being mislabeled as a self-crisis
- Makes no network call and sends no distress text to an external provider
- The deprecated `contentSafety` compatibility module delegates to the same local helper; the legacy `content_safety_crisis` flag does not control production crisis routing
- Crisis routing fires regardless of quota, rate-limit, or database availability

### Stage 2: Quota Check

- Anonymous devices receive 10 successful non-crisis messages per rolling 24-hour window; authenticated accounts receive 20
- The API reserves usage atomically by hashed device/account identity in private PostgreSQL functions before retrieval, preventing logout or horizontal-scaling bypasses
- A bounded session counter remains for orchestrator compatibility and local development, but it is not the production enforcement boundary
- On quota exhaustion the API returns `429` with `Retry-After` and the known reset time
- Temporary search-unavailable responses do not consume quota, so infrastructure faults do not burn seeker turns

### Stage 3: Rate Limiting

- Sliding window rate limit uses the authenticated user identity or server-derived caller IP; stored control keys are hashed
- Default window: `RATE_LIMIT_WINDOW_MS = 60000` (1 minute)
- Default chat limit: 6 requests per window
- Production enforcement shares the same atomic PostgreSQL reservation as the daily quota and in-flight exclusion guard
- When PostgreSQL is intentionally absent, local development uses a bounded in-memory fallback. When PostgreSQL is configured but unavailable, the API fails closed with a retryable `503`.
- Contract: `429` responses include `Retry-After` (seconds)
- Ordering: the shared usage reservation runs only after crisis detection; quota, rate, and in-flight decisions are atomic and none can block crisis routing

### Stage 4: Intent Detection

Schema-based intent classification — **no LLM**. Pattern matching against a predefined intent schema:

| Intent Category    | Example Triggers |
|--------------------|-----------------|
| `food_assistance`  | food, hungry, meal, pantry, snap, ebt |
| `housing`          | housing, shelter, eviction, rent, homeless |
| `mental_health`    | therapy, counseling, mental, anxiety, depression |
| `healthcare`       | doctor, clinic, medical, prescription, insurance |
| `employment`       | job, work, unemployment, career, resume |
| `childcare`        | childcare, daycare, after school, babysitter |
| `transportation`   | bus, ride, transit, car, transportation |
| `legal_aid`        | legal, lawyer, attorney, court, eviction |
| `utility_assistance`| electric, gas, water, utility, bill |
| `general`          | (fallback for unmatched queries) |

Intent also extracts:

- Geographic qualifier (city/county/ZIP from message)
- Population qualifier (veteran, senior, child, family)
- Urgency qualifier (urgent, emergency, immediate, today)

### Stage 4a: Clarification + Crisis Scope Guard

- Weak general queries now trigger a deterministic clarification response before retrieval
- Clarification only fires when the system lacks enough structured scope to search honestly
- Clarification responses include `retrievalStatus='clarification_required'` plus suggestion chips for common service categories
- If the active chat session already has structured scope, ambiguous follow-up turns may inherit:
  - active need
  - active city
  - trust filter
  - taxonomy filters
  - attribute filters
  - preferred delivery modes
- Third-party or informational crisis language returns immediate 911/988 guidance without showing the self-harm crisis banner, then asks the seeker to specify the local service type they want to find

### Stage 4b: Scope Guard

- After intent detection and before retrieval, the orchestrator applies a deterministic out-of-scope guard for requests that are clearly not about finding services or support resources
- Examples: weather, sports scores, stock prices, generic trivia, unrelated translation requests, sexual-roleplay prompts, and harmful how-to requests unrelated to service discovery
- On out-of-scope detection, the system returns a boundary message explaining that ORAN Chat is only for finding services from stored records and refuses unrelated or inappropriate requests
- Out-of-scope handling still respects crisis-first behavior because crisis routing happens earlier in the pipeline

### Stage 5: Profile Hydration

For authenticated users (Clerk session with an ORAN authorization context):

- Load saved approximate city from `user_profiles`
- Load saved seeker context from `seeker_profiles`
- The request may explicitly disable saved profile shaping with `profileMode='ignore'`; this strips saved city and seeker-profile shaping fields for the active session while preserving explicit browse filters supplied in the request
- Hydrate only schema-backed fields into chat context:
  - `serviceInterests`
  - `selfIdentifiers`
  - `currentServices`
  - `accessibilityNeeds`
  - `ageGroup`
  - `householdType`
  - `housingSituation`
  - `transportationBarrier`
  - `preferredDeliveryModes`
  - `urgencyWindow`
  - `documentationBarriers`
  - `digitalAccessBarrier`
- Fail open: if hydration fails, chat continues with the request-only context
- Request-time locale remains authoritative for the active turn. Saved locale may guide UI defaults, but must not silently override an in-flight chat request.
- Response assembly discloses whether saved profile shaping was used or explicitly ignored

For anonymous users:

- Use geo from request (IP-based approximate location) if explicitly allowed
- No profile persistence

For all sessions:

- The request may include a lightweight `sessionContext` contract carried in browser session storage
- Session context is limited to structured scope only, not raw transcript history
- Current session context may carry forward active need, city, urgency, delivery preferences, trust filter, taxonomy filters, and attribute filters
- Session context is visible in the UI and can be cleared field-by-field
- The client may also use the most recent result set as a local reference frame for explicit execution commands, but only through deterministic result ordinals and explicit user confirmation

### Stage 6: Retrieval

Pure SQL query against PostgreSQL/PostGIS:

- Filter by intent category (taxonomy join)
- Filter by geographic radius (PostGIS `ST_DWithin`) or bbox
- Filter by status = 'active'
- Apply authenticated approximate-city soft sorting via `cityBias` when no explicit geo query is present
- For authenticated users, optionally append up to 3 normalized `serviceInterests` hints to the text query only when the intent classifier falls back to `general`
- For authenticated users, optionally compute deterministic profile-match signals from canonical taxonomies only:
  - `population`
  - `situation`
  - `access`
  - `delivery`
  - `culture`
- Profile-match signals only re-order already eligible results; they do not widen retrieval and do not bypass trust filters
- Personalized chat retrieval skips the shared search cache
- Order by: verification confidence DESC, profile match DESC, stored score DESC, distance ASC
- Limit: 5 results by default
- Chat retrieval may fetch a slightly larger deterministic candidate pool first, then diversify the final 5 seeker-visible cards across organizations without weakening trust-first ordering
- **No LLM involvement. No vector similarity. No reranking beyond SQL ORDER BY.**
- Retrieval outcomes are classified explicitly for the client contract:
  - `results`: matching stored records were returned
  - `no_match`: the catalog has records in scope, but none matched the current query closely enough
  - `catalog_empty_for_scope`: the catalog is effectively empty for the current scope/filter combination
  - `temporarily_unavailable`: search infrastructure or DB access was unavailable
  - `clarification_required`: retrieval was intentionally skipped because the query lacked enough search scope
  - `out_of_scope`: handled before retrieval when the request is outside the service-finding boundary

Current schema-backed mappings:

- approximate city → `cityBias`
- non-English request locale or explicit language-interpretation need → `language_barrier`
- explicit language-interpretation need → `interpreter_on_site`
- non-English request locale or explicit language-interpretation need → `bilingual_services`
- `virtual_option` → `virtual`, `phone`, `hybrid`
- `evening_hours` → `evening_hours`, `weekend_hours`, `after_hours`
- `child_friendly` → `childcare_available`
- `transportationBarrier` → `transportation_barrier` and `transportation_provided`
- `preferredDeliveryModes` → exact `delivery` tags (`in_person`, `virtual`, `phone`, `hybrid`)
- `urgencyWindow=same_day` → `same_day`
- `urgencyWindow=next_day` → `same_day`, `next_day`
- `documentationBarriers` → `no_id_required`, `no_documentation_required`, `no_ssn_required`
- `digitalAccessBarrier` → `digital_barrier`
- `pregnant`, `new_parent`, `caregiver`, `dv_survivor`, `reentry`, `undocumented_friendly`, `refugee` → exact `population` tags
- `single_parent` household → exact `population` tag
- `unhoused`, `shelter`, `couch_surfing` → `no_fixed_address`
- `lgbtq` → `lgbtq_affirming`

Service-interest normalization rules:

- `serviceInterests` are a closed seeker-profile vocabulary, not free text
- only recognized service-interest IDs may influence retrieval shaping
- directory/map explicit filters remain authoritative and are never overridden by chat hydration

Deliberate non-mappings in the current phase:

- free-text `additionalContext`
- exact language availability matching
- transit access and physical accessibility ranking
- service-interest hard filters
- urgency windows beyond same-day / next-day metadata currently present in the live catalog

These stay out of retrieval until the underlying service metadata is queryable in the live search engine without heuristics.

### Stage 7: Response Assembly

Build `ChatResponse` from retrieved records:

- Format each `Service` record into a `ServiceCard`
- Include: name, organization, address, phone, hours, confidence band
- Include the clearest next step supported by the stored record plus a safe provider-confirmation question
- Include stored distance, coverage, eligibility criteria, and required documents when available
- Include exact verification status/check dates only when the record supplies them; missing freshness remains visibly unknown
- Include an expandable stored-source and verification panel plus stale/disputed/unverified/retired warning states
- Optionally include: contextual `links[]` selected deterministically from stored URLs
- Always append `ELIGIBILITY_DISCLAIMER`
- Never generate or infer data not in the record
- Include `retrievalStatus` so the UI can distinguish no-match, sparse-catalog, temporary-unavailability, and out-of-scope states
- Include `activeContextUsed` + `sessionContext` so the UI can disclose and persist structured turn scope between requests
- Include `searchInterpretation` so the UI can disclose the normalized search framing used for the turn, including whether saved profile shaping influenced ordering or was explicitly ignored, and whether session context was inherited
- Include `clarification` metadata when retrieval is intentionally deferred pending a clearer request
- Include deterministic `resultSummary` metadata so the UI can explain the set-level logic behind returned cards without relying on LLM prose
- Include deterministic `followUpSuggestions` so the UI can surface adaptive follow-up chips based on intent, urgency, and retrieval outcome

#### Contextual link selection (deep links vs general links)

Some user questions require different URLs for the **same** service, e.g.:

- “How do I apply?” → application/intake form deep link
- “Am I eligible?” → eligibility/requirements page
- “How do I contact them?” → contact page

Contract:

- Links must come from **stored records only**:
  - `service.url` and `organization.url` (HSDS fields)
  - and/or a future verified-links table populated from ingestion evidence (never generated URLs)
- Link selection is **deterministic** and based on explicit parameters:
  - `intent.category` (domain need)
  - `intent.actionQualifier` (apply/contact/eligibility/hours/website)
  - `context.locale`
  - optional `userProfile.audienceTags` (self-identified; must not be persisted without consent)
- If a link is constrained to an audience tag (e.g., `veteran`) and the tag is missing, it must not be shown.

Safety rule:

- The chat system must never invent URLs or suggest navigation to pages that were not stored/verified.

### Stage 8: LLM Summarization Gate

**Status: RETIRED AND INERT.** The `llm_summarize` compatibility key is forced off and cannot be edited. Seeker responses use deterministic assembly from stored records.

The seeker chat route has no external LLM summarizer, translator, or intent enricher. Classification, crisis handling, retrieval, and response composition remain deterministic and stored-record-only.

If a summarizer is deliberately wired in a future release, all of these gates remain mandatory:

- **Input**: The already-retrieved and assembled service records (plain text)
- **Task**: Write 2–4 sentence natural language summary of what was found
- **Constraints**: LLM must not add any information not present in the records; temperature=0.2; max_tokens=300
- **Eligibility disclaimer**: Always appended unconditionally after LLM content
- **Fail-open**: On any LLM error the orchestrator silently falls back to the assembled plain-text message
- **Not activated for**: retrieval, ranking, eligibility assessment, crisis routing
- **Activation proof**: provider-specific privacy review, feature-flag evidence, exact release SHA, and live fallback verification

---

## Quota & Rate Limiting

| Parameter | Value | Notes |
| --- | --- | --- |
| `ANONYMOUS_CHAT_QUOTA` | 10 | Successful non-crisis messages per anonymous device in a rolling 24-hour window |
| `AUTHENTICATED_CHAT_QUOTA` | 20 | Successful non-crisis messages per authenticated account in a rolling 24-hour window |
| `MAX_CHAT_QUOTA` | 20 | Legacy orchestrator/session compatibility ceiling; not the production identity boundary |
| `SESSION_QUOTA_TTL_MS` | 21600000 | 6-hour TTL for bounded in-memory compatibility state |
| `MAX_SESSION_QUOTA_ENTRIES` | 2000 | Maximum local entries before oldest-first eviction |
| `RATE_LIMIT_WINDOW_MS` | 60000 | 1-minute sliding window |
| `RATE_LIMIT_MAX_REQUESTS` | 6 | Chat requests per window per server-derived identity |

---

## Response Schema

```typescript
interface ChatResponse {
  message: string;                    // Deterministically assembled response text
  resultSummary?: string;             // Stored-result set explanation
  services: ServiceCard[];            // Retrieved service records (max 5)
  isCrisis: boolean;                  // True if a self-crisis was detected
  crisisResources?: {                 // Populated when isCrisis=true
    emergency: '911';
    crisisLine: '988';
    communityLine: '211';
  };
  intent: Intent;
  sessionId: string;
  quotaRemaining: number;             // Remaining daily identity quota
  quotaResetAt?: string;
  eligibilityDisclaimer: string;      // Always present
  llmSummarized: boolean;             // False on the production route
  retrievalStatus?: 'results' | 'no_match' | 'catalog_empty_for_scope'
    | 'temporarily_unavailable' | 'clarification_required' | 'out_of_scope';
  sessionContext?: ChatSessionContext; // Structured scope only, never raw history
  searchInterpretation?: SearchInterpretation;
  clarification?: ChatClarification;
  followUpSuggestions?: string[];
}
```
