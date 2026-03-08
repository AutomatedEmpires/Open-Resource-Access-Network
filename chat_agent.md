# Chat Agent Review And Improvement Plan

## Purpose

This document captures a grounded review of the current ORAN chat agent as implemented in the live codebase. It focuses on:

- which kinds of users may interact with the chatbot
- whether the current profile model can represent them accurately enough
- what the system actually reads from the profile today
- whether any LLM is reviewing the profile for retrieval or confidence
- how ranking works against the database
- what happens when users dislike the output or want more options
- what happens when users hit the 50-message limit
- concrete recommendations and phased remediation paths

This is not a speculative design memo. It reflects the current live implementation, then extends it with findings, risks, and proposed fixes.

---

## Executive Summary

The current chat system is strong on safety, determinism, and auditability. It is not yet strong enough to claim high-fidelity personalization for all seekers or all service-navigation scenarios.

Current strengths:

- crisis routing is hard-gated before normal retrieval
- retrieval is database-backed and deterministic
- seeker-visible confidence is grounded in stored service trust data, not model guesswork
- authenticated profile hydration is server-side and fail-open
- explicit directory/map filters remain separate from chat personalization

Current limitations:

- the profile model is broad but not comprehensive enough to accurately capture many real-world constraint combinations
- several saved profile fields are not currently used in retrieval at all
- no LLM reviews the user profile for retrieval fit or output confidence
- the system uses deterministic soft-ordering, not a true structured fit engine
- chat does not yet have a strong “show me more options” flow
- the 50-message limit is session-based, not a durable conversational continuity design

Bottom line:

The current system is a safe and explainable first-phase personalized retrieval system. It is not yet a robust seeker-fit engine.

---

## Non-Negotiable Reality

The current chat retrieval path does not use an LLM to decide what services to return.

What the LLM may do today:

- optionally reclassify an ambiguous `general` message into a more specific intent category
- optionally summarize already-retrieved service records

What the LLM does not do today:

- it does not read the seeker profile to score fit
- it does not compare the seeker profile to service rows to choose winners
- it does not generate confidence scores for the returned services
- it does not infer hidden facts about the user or the service
- it does not rerank retrieved services based on model judgment

This is an important architectural strength for safety and reproducibility, but it also means the current “personalization” is narrower than a user may assume.

---

## User Types The Chatbot Must Support

### 1. Anonymous first-time seekers

Characteristics:

- no stored profile
- often exploratory
- may not know the right service taxonomy terms
- may be in distress, time pressure, or confusion

Current support level:

- reasonable for broad discovery
- limited personalization

Current system behavior:

- uses message text and any request filters
- no persistent seeker context
- crisis gate still applies

Key limitation:

- no continuity across sessions
- no ability to preserve known constraints without sign-in

### 2. Authenticated seekers with minimal profile data

Characteristics:

- signed in
- may have language and city set
- may have little else configured

Current support level:

- modestly better than anonymous

Current system behavior:

- hydrates approximate city and any saved structured seeker fields
- may bias ordering by city and a few structured profile tags

Key limitation:

- if the profile is sparse, retrieval remains close to generic search

### 3. Authenticated seekers with rich profile data

Characteristics:

- have selected service interests
- may have self-identifiers, accessibility needs, and housing/household context

Current support level:

- best-supported current cohort

Current system behavior:

- structured fields can create a soft profile match signal
- profile match only reorders already-eligible services

Key limitation:

- not all stored fields are operative in retrieval
- several major life constraints still cannot be represented

### 4. Multilingual seekers

Characteristics:

- may need non-English support
- may need language interpretation or bilingual staff

Current support level:

- partially supported

Current system behavior:

- request locale can contribute `language_barrier`
- explicit interpretation need can contribute `interpreter_on_site`
- request locale and interpretation need can contribute `bilingual_services`
- optional translation can localize returned descriptions after retrieval

Key limitation:

- this is not exact language availability matching
- it is a deterministic hint, not proof the service speaks the exact language needed

### 5. Crisis users

Characteristics:

- self-harm or imminent-risk indicators

Current support level:

- strong and appropriately hard-gated

Current system behavior:

- crisis routing short-circuits normal retrieval
- quota and rate limits do not prevent crisis routing

Key limitation:

- none of the normal personalization work matters here, which is correct by design

### 6. Complex-needs seekers

Examples:

- no transportation + food insecurity + rent risk
- undocumented family + child care need + evening availability
- domestic violence survivor + privacy concerns + relocation needs
- disabled senior + language interpretation + remote intake preference

Current support level:

- inconsistent

Reason:

- the profile model does not yet capture enough structured constraints to represent these situations reliably
- the search side does not yet query all potentially relevant service metadata dimensions

### 7. Dissatisfied seekers who want alternatives

Characteristics:

- the first result set feels too narrow, too generic, or too repetitive

Current support level:

- weak in the chat surface

Current system behavior:

- another chat turn can be sent
- explicit browsing can continue in directory/map
- chat itself does not have a strong built-in broader-results workflow

### 8. Session-exhausted users

Characteristics:

- have used all 50 messages in a session

Current support level:

- operational but not ideal

Current system behavior:

- chat returns a friendly “start a new conversation” message
- the quota is session-scoped, not a permanent per-account lockout

### 9. Potential future non-seeker users

Examples:

- caseworkers
- family members helping someone else
- provider staff
- admins or hosts testing the chat surface

Current support level:

- not explicitly modeled

Key limitation:

- the current profile model and retrieval logic are seeker-centric
- there is no role-aware chat mode specialization today

---

## Current Profile Model

### Structured fields currently available

The seeker profile currently supports these substantive matching fields:

- `serviceInterests`
- `ageGroup`
- `householdType`
- `housingSituation`
- `selfIdentifiers`
- `currentServices`
- `accessibilityNeeds`
- `preferredLocale`
- `approximateCity`

Additional saved but mostly non-retrieval fields:

- `pronouns`
- `profileHeadline`
- `avatarEmoji`
- `accentTheme`
- `contactPhone`
- `contactEmail`
- `additionalContext`

### Current assessment

This is enough to improve broad seeker-tailoring, but not enough to accurately cover everyone.

Why it is not enough:

- it does not explicitly capture transportation barriers
- it does not capture schedule availability in a seeker-centered way
- it does not capture urgency gradations like “eviction in 3 days” or “utilities shut off tomorrow”
- it does not capture exact language requested
- it does not capture internet/device access constraints
- it does not capture ID/documentation barriers
- it does not capture income band or household size
- it does not capture preferred intake mode in a structured way
- it does not capture safety/privacy handling needs beyond a few coarse proxies
- it does not capture child age ranges, elder dependency, or caregiver burden in enough detail

### Important distinction

The profile has two separate problems today:

1. coverage problem
   Some important seeker realities are not represented at all.

2. operability problem
   Some represented fields are stored, but not yet used by retrieval.

---

## What The System Actually Reads From The Profile Today

The chat hydration layer loads structured seeker profile data server-side for authenticated users.

Hydrated fields:

- approximate city
- service interests
- age group
- household type
- housing situation
- self identifiers
- current services
- accessibility needs

These hydrated values are placed into the chat context and then used selectively by retrieval shaping.

### Fields that currently affect retrieval

1. `approximateCity`
   Used as `cityBias` for soft geographic ordering.

2. `serviceInterests`
   Used only when the intent classifier falls back to `general`.
   Up to three normalized interest phrases are appended to the text query.

3. `selfIdentifiers`
   Used to generate exact `population` and `culture` signals.

4. `householdType`
   Used for exact `population` signals such as `single_parent`.

5. `housingSituation`
   Used for exact `situation` signals such as `no_fixed_address`.

6. `accessibilityNeeds`
   Used for exact `access`, `delivery`, and some `culture` signals.

7. request `locale`
   Used for `language_barrier` and `bilingual_services` hints.

### Fields that are stored but currently non-operative in retrieval

- `ageGroup`
- `currentServices`
- `pronouns`
- `profileHeadline`
- `avatarEmoji`
- `accentTheme`
- `contactPhone`
- `contactEmail`
- `additionalContext`

This is a major design point: the saved profile is currently broader than the effective retrieval model.

---

## What The LLM Is Reviewing Today

### Retrieval path

No LLM reviews the profile for retrieval.

The retrieval path is deterministic and DB-only.

### LLM intent enrichment

An LLM may be called only when:

- the initial intent classifier returns `general`
- the `llm_intent_enrich` feature flag is enabled

Its job is narrow:

- classify an ambiguous user message into a single category name

It is not asked to:

- read or weigh the seeker profile
- reason over service fit
- produce confidence scores for returned services

### LLM summarization

An LLM may also be called after services have already been retrieved, if summarization is enabled.

Its job is narrow:

- summarize already retrieved records

It is not asked to:

- choose the services
- rank the services
- infer missing service facts
- infer missing seeker facts

### Conclusion

There is currently no model-based profile review loop in retrieval.

This is good for reproducibility.
This is limiting for nuanced fit.

---

## How The Current Retrieval And Ranking Works

### Step 1: base search eligibility

The search engine first determines which records are eligible to be returned.

It uses:

- `services.status`
- optional taxonomy filters through `service_taxonomy`
- optional trust threshold through `confidence_scores.verification_confidence`
- optional full-text query against `services.name` and `services.description`
- optional geo filters using `locations.geom`

### Step 2: profile soft-ordering

If a user has relevant profile signals, the engine computes a `profile_match_score`.

Current weights:

- `population`: 18
- `situation`: 14
- `access`: 10
- `delivery`: 8
- `culture`: 8

These weights are deterministic constants in the SQL builder.

### Step 3: final order

Results are ordered by:

1. `verification_confidence DESC`
2. `profile_match_score DESC`
3. stored overall service `score DESC`
4. `distance ASC`

### Crucial implication

Trust is still primary.

That means a highly verified listing with weaker personalization can outrank a lower-trust listing with better profile alignment.

This is a deliberate safety choice.

---

## How The System Would Handle The Example Scenario

Example seeker:

- no transportation
- needs food assistance
- needs rent help

### What the system can represent today

- `food_assistance` can be captured via `serviceInterests`
- `housing` can roughly stand in for rent/housing support
- approximate city can bias ordering geographically

### What the system cannot represent well today

- “no transportation” is not a first-class seeker profile field
- “rent help specifically” is coarser than `housing`
- urgency level on housing instability is not structured beyond broad housing situation
- willingness or inability to travel is not explicitly queryable

### What the engine would likely do today

If the message is broad and falls into `general`, it may append normalized interest hints like:

- `food assistance`
- `housing`

If the user has matching self-identifiers or accessibility needs, those may create extra soft-ordering signals.

If the user is in a saved city, nearby services may rank higher through `cityBias`.

### What it would not do today

- it would not explicitly detect “transportation barrier” from the saved profile
- it would not verify transit-friendliness as a seeker-fit input
- it would not compute a model-based “best fit” confidence from the combined scenario

---

## Confidence On The Output: What It Really Means

This area is easy to misunderstand.

### Seeker-visible confidence in chat cards

The confidence shown on chat cards is derived from `confidence_scores.verification_confidence`.

It answers:

- how trustworthy / verified is this listing?

It does not answer:

- how perfectly does this service fit this person’s situation?

### Profile personalization score

The `profile_match_score` is a runtime ordering hint only.

It is not a public trust score.
It is not a general confidence score.
It is not exposed as “we are X% sure this is the best fit.”

### Key finding

The current system does not produce a seeker-facing, explainable, structured fit confidence.

It produces:

- trust confidence
- deterministic soft personalization order

That is not the same as a full fit confidence model.

---

## Which Database Columns Actually Matter Today

### Directly important to current chat retrieval

#### Core service discovery

- `services.name`
- `services.description`
- `services.status`

#### Category filtering

- `service_taxonomy.service_id`
- `service_taxonomy.taxonomy_term_id`

#### Personalization and structured fit hints

- `service_attributes.service_id`
- `service_attributes.taxonomy`
- `service_attributes.tag`

#### Geographic ordering and geo filtering

- `locations.geom`
- `locations.latitude`
- `locations.longitude`
- `addresses.city`
- `addresses.state_province`
- `addresses.postal_code`

#### Trust and stored ranking

- `confidence_scores.verification_confidence`
- `confidence_scores.score`
- `confidence_scores.eligibility_match`
- `confidence_scores.constraint_fit`

### More important to card assembly than ranking

- `organizations.name`
- `services.url`
- `services.application_process`
- `services.wait_time`
- `services.fees`
- phones and schedules joins

### Important nuance

The database contains more service information than the chat retrieval path currently exploits.

Examples of metadata that exist or partially exist but are not fully leveraged in current fit ranking:

- language-related service details
- interpretation metadata
- application process detail
- wait time
- fees
- richer schedules
- accessibility and adaptation detail outside the active `service_attributes` match path

---

## Additional Findings Beyond The Initial Review

### Finding A: profile breadth and retrieval breadth are mismatched

The UI and persistence layer invite users to provide a richer profile than the retrieval engine currently uses.

Risk:

- users may believe the system is considering fields that it is currently ignoring

Recommendation:

- add UI copy that distinguishes “saved for your account” vs “currently used for tailoring” until retrieval parity improves

### Finding B: dissatisfaction handling in chat is underdeveloped

There is no strong second-pass recovery flow for:

- “show me more options”
- “broaden this”
- “near me only”
- “virtual only”
- “less strict”

Risk:

- repeated or near-duplicate result sets
- quota burn without meaningful exploration

Recommendation:

- add explicit refinement and broadening controls in chat state

### Finding C: explanation quality is weaker than ranking rigor

The ranking logic is deterministic, but the explanation layer does not yet expose why a given service ranked well for the user.

Risk:

- results may feel arbitrary
- users may distrust ranking even when it is actually structured

Recommendation:

- add a seeker-safe “why this surfaced” explanation model derived from structured signals only

### Finding D: current quota model favors session churn over guided continuation

The system tells the user to start a new session after 50 messages.

Risk:

- conversational context resets
- users in difficult circumstances may lose continuity

Recommendation:

- add explicit carry-forward or handoff behavior before session exhaustion

### Finding E: transportation is a meaningful missing first-class constraint

The example raised by the user is correct: transportation can dramatically affect fit.

Risk:

- nearby or transit-compatible services may not be distinguished strongly enough for seekers with travel constraints

Recommendation:

- add seeker-side transportation constraint fields and integrate them with location, delivery, and transit metadata in search

### Finding F: exact language fit is not yet modeled strongly enough

The current system uses `language_barrier`, `interpreter_on_site`, and `bilingual_services` as coarse hints.

Risk:

- a user may need a specific language but only receive coarse bilingual/interpretation signals

Recommendation:

- add exact language-request fields on the seeker side and exact language availability matching on the service side

### Finding G: current services are saved but not reducing duplicates yet

`currentServices` are hydrated into context but not used to suppress redundant recommendations.

Risk:

- chat may suggest services the seeker already uses

Recommendation:

- add duplicate-avoidance logic or de-prioritization rules using current service participation

### Finding H: age group is captured but not active in chat retrieval

Risk:

- age-specific service relevance may be missed

Recommendation:

- wire age-group-specific population or adaptation tags into deterministic profile signals once service-side metadata support is confirmed

### Finding I: no explicit fit-confidence contract exists yet

Trust is modeled clearly.
Fit is partially implied.

Risk:

- product and UX can drift into overstating relevance without a defensible fit score contract

Recommendation:

- define a separate, explainable seeker-fit contract before surfacing any “best fit” claims

### Finding J: non-seeker chat modes are undefined

Risk:

- future use by helpers, advocates, or staff may overload the seeker model

Recommendation:

- define actor modes if the chatbot is expected to serve more than direct seekers

---

## Gaps In Current Field Coverage

### Important missing seeker constraints

The following should be considered high-value additions if the product goal is stronger real-world fit:

- transportation barrier / mobility constraint
- travel radius tolerance
- preferred service mode: in-person, phone, virtual, any
- work/school schedule availability
- urgency windows: today, 72 hours, 7 days, ongoing
- exact language requested
- documentation / ID barriers
- immigration-sensitive eligibility concerns
- insurance status
- income band or benefit threshold context
- household size
- ages of dependent children
- privacy or safety handling needs
- phone-only access / no internet / no printer
- disability accommodation detail beyond coarse accessibility flags

### Important service metadata still under-leveraged

- exact language availability
- transit access
- intake complexity
- document requirements
- wait time
- cost severity / fee burden
- capacity status and availability timing

---

## What Happens If The User Does Not Like The Output

### Current behavior

- the user can ask again in another turn
- the user can rephrase
- the user can go to directory or map views for explicit filtering

### Current weaknesses

- no explicit “more options” protocol in chat state
- no visible page-2 or exclude-previous-results behavior
- likely repetition risk for similar prompts
- every retry consumes quota

### Desirable fixes

#### Option 1: structured follow-up controls in chat

Add assistant suggestions such as:

- show more like this
- broaden results
- only near me
- virtual only
- higher trust only
- different types of services

#### Option 2: result diversification

When the user asks for more, exclude previously shown service IDs and retrieve the next window.

#### Option 3: branch-aware refinement state

Preserve the original query and apply deltas like:

- broader geography
- lower personalization influence
- stronger delivery preference

#### Option 4: explainability prompting without LLM ranking

Add deterministic chips like:

- matched because it is near you
- matched because it offers virtual access
- matched because it supports language interpretation

---

## What Happens At 50 Messages

### Current behavior

- quota is per session
- quota check happens before normal retrieval
- when exceeded, the user receives a friendly message to start a new conversation
- the session counter is stored in `chat_sessions.message_count` when the database is available
- if the DB is unavailable, in-memory fallback is used

### Design implications

- a user is not permanently blocked
- a new session can continue
- continuity is not preserved automatically across session resets

### Risks

- long problem-solving interactions may be interrupted
- vulnerable users may lose accumulated conversational context
- repeated refinement attempts consume quota quickly because chat lacks a strong “more options” mechanism

### Desirable fixes

#### Option 1: pre-exhaustion warning

Warn at thresholds such as:

- 10 remaining
- 5 remaining
- 1 remaining

#### Option 2: session rollover support

Allow a user to start a new session with a summarized carry-forward context that preserves only safe, structured information.

#### Option 3: cheaper “more options” flow

Do not force full conversational turns for pagination or diversification.

#### Option 4: account-aware continuity

For authenticated users, consider a bounded continuity model that can preserve safe search context without preserving unsafe or over-personalized history.

---

## Phased Remediation Plan

## Phase 0: product truthfulness and guardrails

Goal:

- ensure the product does not imply stronger personalization than the engine actually performs

Work:

- label which profile fields currently affect chat matching
- add deterministic “why this surfaced” explanations
- clarify that trust confidence is not fit confidence
- document session-based quota behavior clearly in the UI

Success criteria:

- no mismatch between user expectation and actual retrieval logic

## Phase 1: high-value structured seeker constraints

Goal:

- improve representation of common real-world barriers

Recommended new fields:

- transportation barrier
- preferred delivery mode
- exact language requested
- urgency window
- documentation/ID barrier
- digital access constraints

Considerations:

- only add fields if service-side metadata can eventually support deterministic matching
- avoid collecting sensitive data without clear operational value

Success criteria:

- common seeker scenarios like “no transportation” become first-class and queryable

## Phase 2: retrieval parity with saved profile breadth

Goal:

- close the gap between stored profile fields and operative retrieval fields

Work:

- decide whether `ageGroup` should map into deterministic population/adaptation signals
- decide how `currentServices` should reduce duplicate recommendations
- decide whether selected household and caregiving states should map more strongly to service attributes

Success criteria:

- every retained field is either actively used, intentionally dormant, or removed

## Phase 3: stronger service metadata exploitation

Goal:

- improve fit without sacrificing determinism

Work:

- exact language matching
- transit-aware or travel-aware ranking
- schedule-fit signals
- intake-mode matching
- cost/fee sensitivity alignment
- capacity and wait-time aware ranking where reliable

Success criteria:

- fit is meaningfully stronger while remaining explainable and reproducible

## Phase 4: dissatisfied-user recovery path

Goal:

- make “I don’t like these results” a first-class interaction path

Work:

- add `show more` / `broaden` / `different options` states
- exclude already-shown results on subsequent expansion
- preserve explicit user steering over profile suggestions

Success criteria:

- repeat turns become meaningfully different, not redundant

## Phase 5: fit-confidence contract

Goal:

- define whether ORAN wants an explicit seeker-fit score

Important caution:

- do not surface a fit confidence score until it is deterministic, explainable, and backed by structured service metadata

Work:

- define the fit dimensions
- define allowed inputs
- define how unknown data is handled
- define seeker-safe explanation text

Success criteria:

- no ambiguous “best fit” claims without a defensible contract

## Phase 6: continuity and session exhaustion improvements

Goal:

- reduce friction caused by session-scoped quota exhaustion

Work:

- quota warnings
- account-aware continuation
- safe rollover summaries
- non-conversational result navigation controls

Success criteria:

- long seeker journeys do not collapse when the 50-message session cap is reached

---

## Recommended Immediate Priorities

If only a few changes can be made next, prioritize these in order:

1. Add truthful explainability for why a result surfaced.
2. Add a real “show more options” chat path with result exclusion/pagination.
3. Add transportation barrier, preferred delivery mode, and exact language requested as structured seeker fields.
4. Wire `currentServices` and `ageGroup` into deterministic retrieval only if service-side metadata can support it correctly.
5. Define a formal seeker-fit contract before exposing any stronger “best match” messaging.

---

## Final Position

The current ORAN chat agent is safe, deterministic, and defensible.

It is not yet a comprehensive representation-and-fit system for the full range of real-world seeker situations.

The biggest gaps are not safety gaps. They are representation, fit depth, recovery UX, and expectation alignment.

That is a good foundation.
But if the goal is world-class seeker personalization, the next work should focus on:

- better structured seeker constraints
- stronger service metadata exploitation
- explicit dissatisfaction recovery
- clearer fit explanations
- continuity beyond a single 50-message session
