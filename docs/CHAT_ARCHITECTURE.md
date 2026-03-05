# ORAN Chat Architecture

The ORAN chatbot is a **retrieval-first** pipeline. No LLM participates in retrieval or ranking. LLM summarization is an optional post-retrieval step gated by a feature flag.

---

## Pipeline Overview

```
User Message
     │
     ▼
┌──────────────────────────┐
│  1a. Crisis Detection    │  ← Keyword-match against CRISIS_KEYWORDS (sync, free)
└──────────────────────────┘
     │ crisis detected?
     ├── YES → Return 911/988/211 routing immediately. STOP.
     │
     ▼ no keyword match
┌──────────────────────────────────────────────────────┐
│  1b. Content Safety Crisis Gate (OPTIONAL)           │  ← Flag: content_safety_crisis
│      Pre-filter: hasDistressSignals() (sync, free)   │  ← Only calls API if signals found
│      API: Azure AI Content Safety SelfHarm severity  │  ← FAIL-OPEN on any error
└──────────────────────────────────────────────────────┘
     │ SelfHarm severity ≥ medium (4)?
     ├── YES → Return 911/988/211 routing immediately. STOP.
     │
     ▼ not crisis
┌─────────────────────┐
│  2. Quota Check      │  ← MAX_CHAT_QUOTA per session
└─────────────────────┘
     │ quota exceeded?
     ├── YES → Return quota exceeded message. STOP.
     │
     ▼ within quota
┌─────────────────────┐
│  3. Rate Limit Check │  ← RATE_LIMIT_WINDOW_MS sliding window
└─────────────────────┘
     │ rate limited?
     ├── YES → Return 429 response. STOP.
     │
     ▼ not rate limited
┌─────────────────────┐
│  4. Intent Detection │  ← Schema-based keyword + pattern matching
└─────────────────────┘
     │
     ▼
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
│  8. LLM Summarization Gate (OPTIONAL)   │  ← Only if 'llm_summarize' flag is ON
│     LLM may ONLY summarize retrieved    │  ← Never retrieve or rank
│     records. Input = DB records only.   │
└─────────────────────────────────────────┘
     │
     ▼
Return ChatResponse (with eligibility disclaimer always included)
```

---

## Stage Details

### Stage 1a: Crisis Detection (Keyword Gate)

- Runs synchronously before any other processing
- Checks message against `CRISIS_KEYWORDS` constant (50+ terms)
- Categories: suicidal ideation, self-harm, domestic violence, imminent danger, overdose, child abuse, homelessness emergency
- **On detection**: Immediately return response containing:
  - Emergency numbers: **911** (life-threatening emergency)
  - Crisis line: **988** (Suicide & Crisis Lifeline)
  - Community support: **211** (local social services)

### Stage 1b: Content Safety Semantic Crisis Gate (Optional, async)

- Only runs when feature flag `content_safety_crisis` is **enabled**
- Only fires when keyword gate (Stage 1a) did **not** detect crisis
- **Pre-filter**: `hasDistressSignals()` — synchronous, free local check against indirect distress phrases (e.g. "no way out", "nobody would miss me"). If this returns false, the API is never called.
- **API call**: Azure AI Content Safety `text:analyze` endpoint, `SelfHarm` category only
- **Routing threshold**: SelfHarm severity ≥ 4 (medium or high) → route to 911/988/211
- **FAIL-OPEN**: any API error (network, timeout, 4xx/5xx, malformed response) returns false — the pipeline continues normally. Crisis routing is never blocked by API unavailability.
- **Cost control**: Azure AI Content Safety F0 free tier = 5,000 text records/month. Combined with the pre-filter, expected API call rate is &lt;5% of total messages.
- **Configuration**: `AZURE_CONTENT_SAFETY_ENDPOINT` + `AZURE_CONTENT_SAFETY_KEY` env vars; module is a no-op when either is absent
- **No LLM**: Azure AI Content Safety is a classifier, not a generative model
  - Warm handoff message: "I can see you may be going through something difficult. Please reach out to these services immediately."
- Crisis routing fires regardless of quota or rate limit status

### Stage 2: Quota Check

- Each chat session has a message quota (`MAX_CHAT_QUOTA = 50` messages)
- Session identified by `sessionId` from request
- Count stored in-memory per session with TTL + bounded eviction (future: Redis)
- On quota exceeded: friendly message explaining the limit with option to start new session

### Stage 3: Rate Limiting

- Sliding window rate limit per IP + (server-derived) userId
- Default window: `RATE_LIMIT_WINDOW_MS = 60000` (1 minute)
- Default limit: 20 requests per window
- Implementation: in-memory map (future: Redis)
- Contract: `429` responses include `Retry-After` (seconds)
- Ordering: rate limiting runs **after** crisis detection and quota checks, so crisis routing is never blocked by rate limiting

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

### Stage 5: Profile Hydration

For authenticated users (Entra ID / NextAuth.js session present):
- Load saved location preference
- Load saved service category preferences
- Load accessibility requirements
- Merge with current message context

For anonymous users:
- Use geo from request (IP-based approximate location) if explicitly allowed
- No profile persistence

### Stage 6: Retrieval

Pure SQL query against PostgreSQL/PostGIS:
- Filter by intent category (taxonomy join)
- Filter by geographic radius (PostGIS `ST_DWithin`) or bbox
- Filter by status = 'active'
- Order by: confidence_score DESC, distance ASC
- Limit: 5 results by default
- **No LLM involvement. No vector similarity. No reranking beyond SQL ORDER BY.**

### Stage 7: Response Assembly

Build `ChatResponse` from retrieved records:
- Format each `Service` record into a `ServiceCard`
- Include: name, organization, address, phone, hours, confidence band
- Optionally include: contextual `links[]` selected deterministically from stored URLs
- Always append `ELIGIBILITY_DISCLAIMER`
- Never generate or infer data not in the record

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

**Status: ACTIVE** (flag `llm_summarize` = `true`, 100% rollout, activated 2026-03-05)

Model: `gpt-4o-mini` on Azure OpenAI resource `oranhf57ir-prod-oai` (eastus). Implemented in `src/services/chat/llm.ts`.

Only activated when feature flag `llm_summarize` is enabled:
- **Input**: The already-retrieved and assembled service records (plain text)
- **Task**: Write 2–4 sentence natural language summary of what was found
- **Constraints**: LLM must not add any information not present in the records; temperature=0.2; max_tokens=300
- **Eligibility disclaimer**: Always appended unconditionally after LLM content
- **Fail-open**: On any LLM error the orchestrator silently falls back to the assembled plain-text message
- **Not activated for**: retrieval, ranking, eligibility assessment, crisis routing

---

## Quota & Rate Limiting

| Parameter              | Value    | Notes |
|------------------------|----------|-------|
| MAX_CHAT_QUOTA         | 50       | Messages per session |
| SESSION_QUOTA_TTL_MS   | 21600000 | 6-hour TTL for in-memory quota state |
| MAX_SESSION_QUOTA_ENTRIES | 2000  | Max sessions tracked in-memory (evicts oldest) |
| RATE_LIMIT_WINDOW_MS   | 60000    | 1-minute sliding window |
| RATE_LIMIT_MAX_REQUESTS| 20       | Requests per window per identity |

---

## Response Schema

```typescript
interface ChatResponse {
  message: string;           // Assembled response text
  services: ServiceCard[];   // Retrieved service records (max 5)
  isCrisis: boolean;         // True if crisis detected
  crisisResources?: {        // Populated when isCrisis=true
    emergency: '911';
    crisisLine: '988';
    communityLine: '211';
  };
  intent: Intent;            // Detected intent
  sessionId: string;         // Session identifier
  quotaRemaining: number;    // Messages remaining in session quota
  eligibilityDisclaimer: string; // Always present
  llmSummarized: boolean;    // Whether LLM summarization was applied
}
```
