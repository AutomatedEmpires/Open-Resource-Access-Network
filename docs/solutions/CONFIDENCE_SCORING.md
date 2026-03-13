# ORAN Confidence Scoring Systems

> **Last Updated**: 2026-03-13
> **Purpose**: Single Source of Truth for all confidence scoring across ORAN

## Executive Summary

ORAN uses **multiple confidence scoring systems** for different purposes. All scores use the **0-100 integer scale** as the standard (never 0-1 decimals in storage or internal processing).

| System | Purpose | Scale | Location |
|--------|---------|-------|----------|
| Service Trust + Match | Seeker-facing trust + fit signals | 0-100 | `confidence_scores` table |
| Candidate Confidence | Ingestion data quality | 0-100 | `extracted_candidates.confidence_score` |
| Tag Confidence | Per-tag certainty | 0-100 | `tag_confirmations.agent_confidence` |
| Field Suggestion Confidence | LLM field fill certainty | 0-100 | `field_suggestions.suggestion_confidence` |
| Publish Readiness | Go/no-go checklist | Boolean + Score | `publish_readiness` table |
| Admin Priority | Routing weight | 10-100 | Runtime only |

---

## 1. Scale Standard: 0-100 Integer

### Why 0-100 (not 0-1)?

- **Human readability**: "85% confident" is clearer than "0.85"
- **Integer storage**: No floating point precision issues in PostgreSQL
- **Consistent thresholds**: 80/60/40 are easy to remember and communicate
- **Database efficiency**: INT columns are more efficient than NUMERIC

### Public Search Contract

The public `/api/search` endpoint accepts `minConfidenceScore` on the canonical 0-100 scale.

The legacy `minConfidence` alias was retired at the API boundary on 2026-03-13 and now returns `400` so seeker-facing callers cannot silently mix scales.

### Normalization Utility

Use `normalizeConfidence()` from `src/domain/confidence.ts` to safely convert any input:

```typescript
import { normalizeConfidence } from '@/domain/confidence';

normalizeConfidence(0.85)    // → 85
normalizeConfidence(85)      // → 85
normalizeConfidence('0.75')  // → 75
normalizeConfidence(null)    // → 0
```

---

## 2. Tier Thresholds (Canonical Source)

All tiers use the same boundaries defined in `src/domain/confidence.ts`:

```typescript
export const CONFIDENCE_THRESHOLDS = {
  GREEN: 80,   // Ready / High confidence
  YELLOW: 60,  // Review needed / Likely
  ORANGE: 40,  // Attention needed / Possible
  RED: 0,      // Insufficient / Needs work
} as const;
```

### Admin-Facing Tiers (Ingestion)

| Tier | Score Range | Color | Meaning | Action |
|------|-------------|-------|---------|--------|
| green | 80-100 | #22c55e | Ready | Auto-approve possible |
| yellow | 60-79 | #eab308 | Review | Standard review |
| orange | 40-59 | #f97316 | Attention | Priority review |
| red | 0-39 | #ef4444 | Incomplete | Needs work |

### Seeker-Facing Bands (Search/Chat)

| Band | Score Range | Label | Messaging |
|------|-------------|-------|-----------|
| HIGH | 80-100 | "High confidence" | Service is well-verified |
| LIKELY | 60-79 | "Likely" | Confirm hours/eligibility |
| POSSIBLE | 0-59 | "Possible" | Here's what to verify |

---

## 3. Scoring Systems in Detail

### 3.1 Service Trust + Match (Seeker-Facing)

**Location**: `src/services/scoring/scorer.ts`, DB: `confidence_scores` table

**Purpose**:

- **Trust**: shown prominently to seekers (verification confidence)
- **Match**: optional secondary indicator (eligibility + constraints)

**Stored overall score formula** (historical contract):

```
final = 0.45 * verification_confidence
      + 0.40 * eligibility_match
      + 0.15 * constraint_fit
```

**Trust (seeker-facing) score**:

- `trust_score = verification_confidence`

**Match (seeker-facing) score** (normalized blend of match subscores):

```
match_score = (0.40 * eligibility_match + 0.15 * constraint_fit) / (0.40 + 0.15)
```

| Component | Weight | What It Measures |
|-----------|--------|------------------|
| verification_confidence | 45% | Is this service verified? |
| eligibility_match | 40% | Does it match seeker's profile? |
| constraint_fit | 15% | Is it accessible right now? |

**Verification Signals** (additive):

| Signal | Points |
|--------|--------|
| Org verified | +35 |
| Community phone confirmation | +25 |
| Community in-person confirmation | +35 |
| Document proof uploaded | +20 |
| Website health check passed | +10 |
| Multiple confirmations in 90 days | +10 |

**Penalties** (subtractive):

| Condition | Points |
|-----------|--------|
| Stale > 180 days | -25 |
| Repeated user reports trend | -15 |
| Invalid/disconnected contact | -30 |
| Open moderation flags | -10 |

**Seeker-facing contract**:

- Directory/chat/map **band + filtering** are based on **Trust** (`verification_confidence`).
- Match is displayed separately where space permits and never overrides Trust.

**Flow Position**: END — computed after service is published, shown to seekers

---

### 3.2 Candidate Confidence Score (Ingestion)

**Location**: `src/agents/ingestion/scoring.ts`, DB: `extracted_candidates.confidence_score`

**Purpose**: How confident are we in a scraped/imported candidate before publishing?

**Formula** (additive):

| Signal | Points |
|--------|--------|
| Evidence snapshot exists | +20 |
| Source is allowlisted | +20 |
| Required fields present | +20 |
| Verification checks pass | +/- per check |
| Checklist completion | up to +20 |

**Verification Check Weights**:

- Critical check: ±20 points
- Warning check: ±10 points
- Info check: ±4 points

**Flow Position**: MIDDLE — during ingestion, before admin review

---

### 3.3 Per-Tag Confidence Score

**Location**: `src/agents/ingestion/confirmations.ts`, DB: `tag_confirmations.agent_confidence`

**Purpose**: How certain is the agent about each individual tag?

**Assignment Guidelines**:

| Score | Tier | When to Assign |
|-------|------|----------------|
| 85-100 | green | Explicit mention, clear evidence |
| 60-84 | yellow | Strongly implied by context |
| 40-59 | orange | Inferred, needs verification |
| 0-39 | red | Weak signal, likely incorrect |

**Auto-Approval Logic**:

- Green tier (≥80) tags CAN be auto-approved for most tag types
- Category and Geographic tags ALWAYS require human review (regardless of confidence)
- Orange/Red tier tags ALWAYS require human review

**Flow Position**: MIDDLE — during tagging, determines admin queue priority

---

### 3.4 Field Suggestion Confidence

**Location**: `src/agents/ingestion/llmSuggestions.ts`, DB: `field_suggestions.suggestion_confidence`

**Purpose**: How confident is the LLM in a suggested field value?

**Scale**: 0-100 (same as all other systems)

**Usage**: When admin reviews field suggestions, they see the confidence color to guide decisions.

**Flow Position**: MIDDLE — during field gap-filling after extraction

---

### 3.5 Publish Readiness

**Location**: `src/agents/ingestion/publish.ts`, DB: `publish_readiness` table

**Purpose**: Gate for publishing a candidate to the live database

**Type**: Checklist (booleans) + minimum confidence threshold

**Requirements** (ALL must be true):

- ✓ hasOrgName
- ✓ hasServiceName
- ✓ hasDescription
- ✓ hasContactMethod (phone OR email OR website)
- ✓ hasLocationOrVirtual
- ✓ hasCategoryTag
- ✓ hasGeographicTag
- ✓ criticalTagsConfirmed
- ✓ noRedTagsPending
- ✓ passedDomainCheck
- ✓ noCriticalFailures
- ✓ confidenceScore ≥ 60 (yellow tier minimum)

**Flow Position**: LATE — final gate before publishing

---

### 3.6 Admin Routing Priority Score

**Location**: `src/agents/ingestion/routing.ts` (runtime only, not stored)

**Purpose**: Determine which admin should review a candidate

**Scale**: Custom values (NOT 0-100):

| Match Level | Score |
|-------------|-------|
| Exact county match | 100 |
| State match | 50 |
| Zone match | 25 |
| Fallback (no geo restriction) | 10 |

**Why Different Scale**: This is routing priority, not confidence. Higher scores mean better match, but doesn't indicate certainty.

**Flow Position**: MIDDLE — during admin assignment routing

---

## 4. Where Scoring Files Live

```
src/
├── domain/
│   ├── confidence.ts        # Canonical normalization & tier functions
│   └── constants.ts         # Threshold constants (ORAN_CONFIDENCE_WEIGHTS)
├── services/
│   └── scoring/
│       └── scorer.ts        # Service confidence scorer
└── agents/
    └── ingestion/
        ├── scoring.ts       # Candidate confidence scorer
        ├── confirmations.ts # Tag confirmation logic
        ├── llmSuggestions.ts# Field suggestion logic
        ├── publish.ts       # Publish readiness logic
        └── routing.ts       # Admin routing priority
```

---

## 5. Database Tables

### confidence_scores (service-level)

```sql
CREATE TABLE confidence_scores (
  id                    UUID PRIMARY KEY,
  service_id            UUID NOT NULL REFERENCES services(id),
  score                 NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  verification_confidence NUMERIC(5,2) NOT NULL,
  eligibility_match     NUMERIC(5,2) NOT NULL,
  constraint_fit        NUMERIC(5,2) NOT NULL,
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### extracted_candidates (candidate-level)

```sql
-- Relevant columns:
confidence_score      INT NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
confidence_tier       TEXT GENERATED ALWAYS AS (
  CASE
    WHEN confidence_score >= 80 THEN 'green'
    WHEN confidence_score >= 60 THEN 'yellow'
    WHEN confidence_score >= 40 THEN 'orange'
    ELSE 'red'
  END
) STORED,
```

### tag_confirmations (per-tag)

```sql
-- Relevant columns:
agent_confidence      INT NOT NULL DEFAULT 50 CHECK (agent_confidence >= 0 AND agent_confidence <= 100),
confidence_color      TEXT GENERATED ALWAYS AS (
  CASE
    WHEN agent_confidence >= 80 THEN 'green'
    WHEN agent_confidence >= 60 THEN 'yellow'
    WHEN agent_confidence >= 40 THEN 'orange'
    ELSE 'red'
  END
) STORED,
```

---

## 6. API Contract

### GET /api/search

```typescript
// Query parameters:
minConfidenceScore?: number;  // Canonical: 0-100
```

### Response includes:

```typescript
{
  results: [{
    id: string;
    name: string;
    confidenceScore: number | null;  // 0-100
    confidenceBand: 'HIGH' | 'LIKELY' | 'POSSIBLE' | null;
    // ...
  }]
}
```

---

## 7. UI Components

### Badge Display (seeker-facing)

```tsx
// src/components/ui/badge.tsx
<ConfidenceBadge band={result.confidenceBand} />
// Renders: "High confidence" / "Likely" / "Possible"
```

### Tier Display (admin-facing)

```tsx
// Uses getTierDisplayInfo() from confidence.ts
const { label, color, description } = getTierDisplayInfo(tier);
<Badge style={{ backgroundColor: color }}>{label}</Badge>
```

---

## 8. Common Mistakes to Avoid

### ❌ Using 0-1 Scale Internally

```typescript
// WRONG
const confidence = 0.85;

// CORRECT
const confidence = 85;
// Or use normalizeConfidence() if input is ambiguous
```

### ❌ Hardcoding Thresholds

```typescript
// WRONG
if (score >= 80) return 'green';

// CORRECT
import { CONFIDENCE_THRESHOLDS, getConfidenceTier } from '@/domain/confidence';
return getConfidenceTier(score);
```

### ❌ Mixing Tier Systems

```typescript
// WRONG - mixing admin tiers with seeker bands
if (tier === 'HIGH') // This is a band, not a tier!

// CORRECT
if (tier === 'green') // Use tiers with tiers
if (band === 'HIGH')  // Use bands with bands
```

---

## 9. Testing Confidence Logic

### Unit Tests Location

- `src/services/scoring/__tests__/scoring.test.ts`
- `src/agents/ingestion/__tests__/scoring.test.ts`
- `src/agents/ingestion/__tests__/confirmations.test.ts`

### Key Test Cases

1. Score normalization (0-1 → 0-100)
2. Tier boundary conditions (exactly 80, exactly 60, exactly 40)
3. Clamping to valid range (negative → 0, >100 → 100)
4. Penalty stacking doesn't go negative
5. Missing data defaults to 0, not undefined

---

## 10. Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-02 | Initial documentation | @copilot |
| 2026-03-02 | Standardized all systems to 0-100 | @copilot |

---

## Related Documentation

- [SCORING_MODEL.md](./SCORING_MODEL.md) — Public scoring contract
- [AGENT_PROCESSING_SPEC.md](../src/agents/ingestion/AGENT_PROCESSING_SPEC.md) — Ingestion agent tagging
- [DATA_MODEL.md](./DATA_MODEL.md) — Database schema overview
