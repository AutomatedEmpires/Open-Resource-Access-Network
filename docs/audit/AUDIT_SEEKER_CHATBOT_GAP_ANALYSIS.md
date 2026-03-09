# ORAN Seeker Chatbot Product-Spec Gap Analysis

**Date**: 2026-03-09
**Scope**: Seeker chatbot only (`/chat`, `/api/chat`, retrieval shaping, crisis routing, result rendering, quota behavior, empty-state handling, and personalization)
**Method**: Source-of-truth review of implementation plus product-spec gap analysis focused on improving seeker experience without materially increasing operating cost

---

## Executive Summary

The current seeker chatbot is a safe, retrieval-first service finder with strong guardrails around hallucination, eligibility, and crisis escalation. It is not yet a high-quality conversational navigator.

The main product gap is not safety. The main gap is seeker experience quality:

- it behaves like a single-turn search box inside a chat shell
- it does not explain enough about why specific results were chosen
- it does not handle off-topic or ambiguous requests gracefully
- it does not distinguish system-empty, no-match, and system-unavailable states clearly
- it does not use prior turns as active retrieval context
- it does not yet offer a deliberate recommendation-set strategy beyond top-ranked records

These issues can be improved substantially without materially increasing cost by keeping the core model unchanged:

- preserve retrieval-first behavior
- keep deterministic SQL ranking
- avoid new always-on LLM calls
- improve UI state, copy, routing, and lightweight session memory first
- use existing profile signals more explicitly rather than adding new inference layers

This audit defines the current behavior, the desired seeker experience, the gap, and the lowest-cost path to close each gap.

---

## Current System Baseline

The live chatbot currently works as follows:

1. Crisis keyword gate runs first.
2. Optional semantic crisis gate runs only when local distress phrases are present and the feature flag is enabled.
3. Quota is checked.
4. Rate limiting is checked.
5. Intent is classified by deterministic keyword logic.
6. Authenticated profile context may be hydrated from `user_profiles` and `seeker_profiles`.
7. Retrieval runs against stored service records only.
8. Response cards are assembled from stored data only.
9. Optional LLM summarization may replace the top-line message after retrieval.

What is already strong:

- no LLM in retrieval or ranking
- crisis routing is prioritized over quota and rate limits
- recommendation cards are grounded in stored records only
- links are selected from stored URLs only
- eligibility is always qualified rather than promised
- personalized ranking is deterministic and taxonomy-backed

What is structurally weak:

- the backend is effectively single-turn
- anonymous personalization is thin
- off-topic handling is under-specified
- no-match, empty-catalog, and unavailable-system states are collapsed
- recommendation diversity is not deliberate
- quota exhaustion handling is functional but not seeker-friendly

---

## Desired Seeker Experience

The desired experience should be:

1. Safe first.
The seeker is immediately routed to 911, 988, and 211 when risk is credible, but normal users are not over-escalated.

2. Conversational enough to reduce repetition.
The seeker should not need to restate city, urgency, delivery preference, or already-established need on every turn.

3. Honest about certainty.

The chatbot should clearly distinguish between:

- no matching services found
- no services in the catalog for this scope
- chat/search temporarily unavailable

4. Explicit about why results appeared.

The seeker should understand whether results were selected because of the query, active browse filters, trust threshold, city bias, or saved profile signals.

5. Useful for messy real-world requests.

If the request is vague, off-topic, mixed-topic, or phrased unusually, the system should redirect, narrow, or clarify instead of silently falling back to generic search.

6. Cost disciplined.

Improvements should favor:

- deterministic logic
- session-level memory stored locally or server-side in a lightweight table
- UI and copy improvements
- conditional model usage only for truly ambiguous cases

---

## Non-Negotiables

The following must remain true after any improvement pass:

- retrieval comes from stored records only
- no invented service facts, phone numbers, addresses, hours, or URLs
- crisis routing remains higher priority than quota and rate limits
- eligibility is never guaranteed
- profile use remains privacy-aware and approximate by default
- no material increase in always-on per-message cost

---

## Gap Matrix

### Gap 1: Chat UI Is Multi-Turn, Backend Is Single-Turn

**Current behavior**

- The UI shows conversation history, but each API request sends only the current message plus session/filter metadata.
- Prior turns are not sent back for retrieval shaping.
- The seeker can believe the assistant “remembers” more than it actually does.

**Desired behavior**

- The chatbot should preserve lightweight turn context for the active session:
  - current need
  - city or approximate location
  - urgency
  - delivery preference
  - trust/filter scope

**Impact**

- users must repeat context
- follow-up questions feel brittle
- trust in the assistant drops because the visible chat state implies continuity that the backend does not honor

**Low-cost fix**

- Add lightweight session context memory, not full chat memory.
- Store only structured fields, not raw conversational transcripts.
- Update structured session context after each successful turn.
- Use that context to fill missing filters on later turns.

**Cost note**

- No model cost required.
- Can be stored in `sessionStorage` client-side first, or in a lightweight server-side session table keyed by `sessionId` if cross-device continuity is later needed.

**Acceptance criteria**

- If a seeker says “I need rent help in Denver” and then asks “anything open today?”, the second query inherits housing + Denver unless the user changes scope.
- The UI shows the inherited scope explicitly.

---

### Gap 2: Logged-In Personalization Exists, But It Is Quiet and Partially Invisible

**Current behavior**

- Authenticated users may get city bias, profile-derived ranking signals, and service-interest text expansion for general queries.
- The UI does not clearly explain which profile signals influenced the result set.

**Desired behavior**

- The seeker should see what profile-based shaping was used and be able to clear it for the current session.

**Impact**

- personalization feels opaque
- seekers may not understand why certain services appear first
- profile-derived shaping may look arbitrary

**Low-cost fix**

- Add a compact “Using your profile” disclosure panel above results when profile signals were applied.
- Display only high-level signals such as:
  - city bias applied
  - same-day help prioritized
  - language support prioritized
  - transportation-friendly results prioritized
- Add a one-click “ignore profile for this search” toggle.

**Cost note**

- No new infrastructure.
- Uses already-computed profile signals.

**Acceptance criteria**

- Seekers can see when profile context changed the sort order.
- Seekers can disable profile shaping for the current search without editing their profile.

---

### Gap 3: Logged-Out Experience Is Underpowered and Under-Specified

**Current behavior**

- Anonymous users mostly search from the raw query and any seeded browse filters.
- Docs mention request-geo support if allowed, but chat routing does not visibly surface anonymous approximate location shaping.

**Desired behavior**

- Anonymous users should still get a strong experience with minimal friction:
  - optional approximate city prompt
  - session-only context persistence
  - transparent location use

**Impact**

- logged-out seekers get lower relevance
- the product is less helpful to first-time and privacy-sensitive users

**Low-cost fix**

- Add an optional pre-chat or first-turn chip set:
  - “Use my city only”
  - “I prefer not to share location”
  - “Search nationwide/remote options”
- Persist chosen city only for the session unless the user signs in and consents to save.

**Cost note**

- No paid service required.
- Session-only storage is enough.

**Acceptance criteria**

- Anonymous seekers can choose a city once and avoid repeating it.
- The UI makes clear when location is or is not being used.

---

### Gap 4: Off-Topic and Abnormal Requests Fall Through Too Quietly

**Current behavior**

- If a request is not a crisis and does not match a supported service category, it falls to `general`.
- The system then tries broad search.
- If nothing matches, it returns a generic no-results response.

**Desired behavior**

- The chatbot should distinguish:
  - unsupported or off-topic questions
  - vague but service-related questions
  - mixed-topic questions needing narrowing

**Impact**

- the assistant feels unhelpful or confused on abnormal requests
- seekers get weak feedback instead of useful redirection

**Low-cost fix**

- Add a deterministic out-of-scope classifier before retrieval.
- Use simple rules, not always-on LLM:
  - if the request clearly asks for non-resource content, respond with a redirect pattern
  - if the request is too vague, return narrowing prompts

**Desired response pattern**

- “I can help find services and community resources. If you want, tell me the kind of help you need, such as housing, food, mental health, transportation, legal help, or healthcare.”

**Cost note**

- No model cost needed.
- Keyword and pattern-based handling is enough for most off-topic traffic.

**Acceptance criteria**

- Off-topic requests do not silently flow into generic search.
- Ambiguous requests trigger narrowing suggestions instead of empty results on the first pass.

---

### Gap 5: Crisis Detection Is Safe, But Too Coarse at the First Layer

**Current behavior**

- Explicit crisis keywords trigger immediate crisis routing.
- Semantic crisis detection is optional and only runs after distress-signal prefiltering.
- The first layer is substring-based and may over-trigger on informational or third-person phrasing.

**Desired behavior**

- Crisis escalation should remain fast, but distinguish more reliably between:
  - self-risk
  - concern about someone else
  - informational questions about crisis topics

**Impact**

- unnecessary crisis routing can feel jarring or alienating
- overly blunt escalation may reduce trust with normal users

**Low-cost fix**

- Add deterministic phrase families around subject and intent:
  - self-risk language
  - third-party concern language
  - informational language
- Preserve hard escalation for direct self-risk.
- For third-party concern or ambiguous mentions, use a warm branching response:
  - still surface crisis resources
  - ask whether the danger is immediate
  - avoid terminating the service-search path if the user clarifies it is not an immediate crisis

**Cost note**

- No new paid dependency required.
- Existing semantic gate remains optional and sparse.

**Acceptance criteria**

- Direct self-risk still routes immediately.
- Informational mentions like “what does 988 do?” do not hard-switch into emergency mode.
- Third-party concern gets supportive routing without misclassifying the user as the one in crisis.

---

### Gap 6: No-Match, Empty Catalog, and System-Unavailable States Are Collapsed

**Current behavior**

- If retrieval returns no services, the chatbot says it found no matching services.
- If the database is not configured, chat retrieval returns an empty list and the seeker sees effectively the same outcome.

**Desired behavior**

- The chatbot should distinguish three states:
  - no services matched your request
  - the catalog has no records in this area/category yet
  - search is temporarily unavailable

**Impact**

- system problems are hidden as user mismatch
- seekers lose trust because the product appears empty rather than temporarily degraded

**Low-cost fix**

- Add a typed retrieval status from the server:
  - `ok_with_results`
  - `ok_no_match`
  - `catalog_empty_for_scope`
  - `temporarily_unavailable`
- Render different copy and call-to-action for each.

**Cost note**

- No material cost.
- This is API contract and copy work.

**Acceptance criteria**

- Search outages return a transparent service-unavailable message.
- True no-match cases recommend rephrasing or adjusting filters.
- Sparse-catalog cases recommend broader area or alternate channels like 211.

---

### Gap 7: Recommendation Sets Are Ranked, But Not Curated

**Current behavior**

- Chat returns up to 5 results.
- Ranking is trust-first, then profile-match, then stored score, then distance/city bias.
- There is no explicit diversity logic, alternate-option logic, or “also consider” strategy.

**Desired behavior**

- The result set should feel intentionally composed:
  - top direct matches first
  - when useful, include one alternate path or adjacent option
  - avoid returning five near-duplicates if they are all effectively the same type of resource

**Impact**

- result sets can feel repetitive
- seekers may miss a better next-step option nearby in the ranking

**Low-cost fix**

- Add deterministic light diversification after ranking.
- Keep trust-first order, but reserve one slot for a non-duplicate alternate if available.
- De-duplicate by same organization + same access pattern + same service family.

**Cost note**

- No new model cost.
- SQL or post-query deterministic logic only.

**Acceptance criteria**

- Results remain trustworthy and relevant.
- Sets avoid obvious duplication.
- When an alternate path exists, the chatbot may explicitly label it as “another option to consider.”

---

### Gap 8: Query Influence Is Real, But Poorly Explained to the Seeker

**Current behavior**

- The query drives category, urgency, action, and search text.
- The UI does not clearly tell the user how their wording changed the response.

**Desired behavior**

- The chatbot should make the active interpretation visible:
  - what need it understood
  - whether urgency shaped ranking
  - whether it prioritized apply/contact/hours links

**Impact**

- seekers may not know why “apply” returned different links than “contact”
- users may not notice when the system interpreted their request incorrectly

**Low-cost fix**

- Add a compact “Search interpretation” line under the assistant message:
  - “Interpreted as: housing help, urgent, contact details prioritized”
- Add “Change search scope” shortcuts.

**Cost note**

- Pure UI contract.

**Acceptance criteria**

- Seekers can see and correct the system’s interpretation without rewriting from scratch.

---

### Gap 9: Chips and Browse Context Exist, But They Are Not a Full Guidance System

**Current behavior**

- The UI has suggestion chips and can inherit browse filters from map/directory.
- This is helpful, but static.

**Desired behavior**

- The chatbot should offer adaptive next-step chips based on current state:
  - clarify city
  - widen to nearby area
  - show only high-trust results
  - look for same-day help
  - switch from apply links to call/contact links

**Impact**

- seekers who stall after weak results do not get guided recovery paths

**Low-cost fix**

- Add deterministic follow-up chips generated from result state and intent:
  - “Show only high-trust”
  - “Include virtual options”
  - “Search a larger area”
  - “Show contact options”

**Cost note**

- No model cost.
- Generated from existing intent + results + filter state.

**Acceptance criteria**

- Users can refine the current search with one tap instead of composing a new message manually.

---

### Gap 10: Quota Exhaustion Is Accurate but Abrupt

**Current behavior**

- The seeker sees remaining message count.
- At zero, input is disabled and the UI says to start a new session.

**Desired behavior**

- Quota should still protect cost and abuse, but the experience should degrade gracefully.

**Impact**

- hard stop feels punitive for legitimate seekers
- users lose current context when forced into a new session

**Low-cost fix**

- Keep the hard cap, but add a soft landing:
  - before final messages, warn earlier and offer a “continue in directory/map” handoff
  - allow a one-click “Start new session with current search scope” action
  - preserve structured context into the next session unless the user clears it

**Cost note**

- No meaningful cost increase.

**Acceptance criteria**

- Users hitting quota can continue with preserved search state in a new session.
- Chat does not silently lose the search scope they built.

---

### Gap 11: Link Behavior Is Correct but Not Fully Intentional From a UX Perspective

**Current behavior**

- Service names link internally to the ORAN service detail page.
- External stored links open directly in a new tab.
- Phone links call directly.

**Desired behavior**

- The seeker should understand which action keeps them in ORAN and which action leaves ORAN.
- Deep links should reflect the intent behind the query more explicitly.

**Impact**

- users may not know whether a click is taking them to a provider site or a database detail page

**Low-cost fix**

- Add clearer action labels:
  - “View details in ORAN”
  - “Visit provider website”
  - “Apply on provider site”
  - “Call provider”
- Prefer the internal detail page when the user has not yet seen the record summary.

**Cost note**

- UI-only.

**Acceptance criteria**

- Link destinations are obvious before interaction.
- Query intent and link action stay aligned.

---

### Gap 12: Match Reasons Exist, But They Are Underused as a Trust Device

**Current behavior**

- Service cards can show `matchReasons`, but these are secondary card details.
- The top-level assistant response does not summarize why the set fits.

**Desired behavior**

- The chatbot should explain the set-level rationale before the seeker reads five cards.

**Impact**

- seekers may not understand the search logic
- personalization may feel arbitrary rather than helpful

**Low-cost fix**

- Add a set-level summary sentence built deterministically from result reasons:
  - “These were prioritized because they match your housing request, same-day need, and phone/virtual access preferences.”

**Cost note**

- Can be deterministic template logic.
- No LLM required.

**Acceptance criteria**

- The seeker can understand why the top set appeared without opening each card.

---

### Gap 13: The System Lacks a Deliberate Clarification Step for Weak Queries

**Current behavior**

- Weak or short queries may go straight to search.
- If search fails, only then does the user see a generic no-results message.

**Desired behavior**

- For low-information queries, the chatbot should ask one cheap clarifying question before retrieval when confidence is low.

**Impact**

- wasted requests
- lower relevance
- more avoidable empty results

**Low-cost fix**

- Add deterministic low-confidence rules:
  - very short query
  - no supported category detected
  - no location and no delivery preference and no profile context
- Ask a single narrowing question instead of immediately searching.

**Examples**

- “What kind of help are you looking for?”
- “Do you want help near you, virtual help, or both?”

**Cost note**

- No model cost.

**Acceptance criteria**

- Weak queries trigger clarification first.
- Users see fewer low-value empty responses.

---

### Gap 14: System Copy Does Not Yet Fully Reflect Product Truth

**Current behavior**

- The UI accurately states “Verified records only,” but some message copy still makes empty states or failures sound more conclusive than they are.

**Desired behavior**

- Messaging should communicate product truth precisely:
  - what was searched
  - why results were chosen
  - what failed if something failed
  - what the user can do next

**Impact**

- confidence and trust are reduced when copy oversimplifies system behavior

**Low-cost fix**

- Rewrite assistant system templates for:
  - no match
  - sparse catalog
  - temporary outage
  - clarification request
  - off-topic redirect
  - quota exhaustion handoff

**Cost note**

- Copy only.

**Acceptance criteria**

- Every terminal state offers a truthful next step.

---

## Recommended Product-Spec Changes

### Spec Change 1: Add Structured Session Context

Define a `ChatSessionContext` contract with:

- `activeNeedId`
- `activeCity`
- `urgency`
- `preferredDeliveryModes`
- `trustFilter`
- `taxonomyTermIds`
- `attributeFilters`
- `profileShapingEnabled`

Rules:

- update only from explicit user request or explicit accepted chip action
- show the active context in UI
- allow clearing any part of the context

### Spec Change 2: Add Retrieval Outcome Status

Extend the response contract with:

- `retrievalStatus`
- `activeContextUsed`
- `searchInterpretation`

This enables precise UI states without changing retrieval cost.

### Spec Change 3: Add Deterministic Clarification and Out-of-Scope Branches

Add pre-retrieval branches for:

- weak query clarification
- out-of-scope redirect
- third-party or informational crisis language handling

### Spec Change 4: Add Low-Cost Result Diversification

After ranking, apply deterministic de-duplication and optional one-slot alternate-path logic.

### Spec Change 5: Add Quota Handoff Experience

When quota is low or exhausted:

- warn early
- offer directory/map handoff
- support one-click context carry-forward into a new session

---

## Low-Cost Implementation Plan

### Phase 1: UX and Copy Fixes

Target: highest user-perceived improvement with near-zero runtime cost.

- differentiate no-match vs outage vs sparse-catalog copy
- add search interpretation line
- add profile-shaping disclosure
- improve link labels
- add quota handoff CTA
- add deterministic off-topic response copy

**Cost impact**: negligible

### Phase 2: Deterministic Logic Improvements

Target: meaningfully better conversation quality without LLM cost.

- add structured session context memory
- add low-confidence clarification gate
- add subject-aware crisis branching
- add light result diversification
- add adaptive follow-up chips

**Cost impact**: negligible to low

### Phase 3: Optional Sparse AI Use Only Where It Pays Off

Target: improve only the hardest ambiguous cases.

- keep current optional intent enrichment for ambiguous `general` queries
- do not expand LLM use into retrieval, ranking, or always-on clarification
- keep semantic crisis check sparse and prefiltered

**Cost impact**: low and bounded

---

## Priority Order

### P0

- distinguish no-match vs unavailable vs sparse-catalog
- add out-of-scope response branch
- add search interpretation disclosure
- add profile-shaping disclosure and clear toggle

### P0 Status Update

Status as of 2026-03-09:

- implemented explicit retrieval outcomes in the chat contract and route (`results`, `no_match`, `catalog_empty_for_scope`, `temporarily_unavailable`, `out_of_scope`)
- implemented deterministic out-of-scope handling before retrieval
- implemented response-level search interpretation disclosure
- implemented signed-in seeker controls to ignore saved profile shaping for the active session while preserving explicit browse filters
- added focused regression coverage across route, orchestrator, and seeker chat UI flows

Remaining work after this P0 slice belongs to P1 and P2, not the core gap items above.

### P1

- add structured session context
- add clarification gate for weak queries
- improve quota exhaustion handoff
- improve crisis subject-awareness

### P2

- add result diversification
- add adaptive follow-up chips
- add richer set-level explanation summary

---

## Final Assessment

The current chatbot is a strong safety shell around deterministic service retrieval, but it is not yet a polished seeker guide.

The good news is that the largest user-experience gaps do not require expensive AI expansion. Most can be closed through:

- clearer state modeling
- better UI disclosure
- lightweight structured memory
- deterministic clarification logic
- better empty-state and fallback copy

The recommended path is to improve the product by making the current system more explicit, more honest, and more supportive before adding any broader intelligence layer.

That keeps ORAN aligned with its retrieval-first and civic-safety constraints while materially improving seeker trust and usefulness.
