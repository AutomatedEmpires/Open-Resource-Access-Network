# ORAN Confidence Scoring Model

ORAN confidence is a trust score, not generic relevance. It is deterministic and retrieval-first.

## Public score contract (required)

ORAN exposes exactly three public sub-scores, each on **0–100**:

1. **Verification Confidence**
2. **Eligibility Match**
3. **Constraint Fit**

Final score:

```text
final = 0.45 * verification
      + 0.40 * eligibility
      + 0.15 * constraint
```

No other public values may drive confidence messaging across chat/map/directory.

---

## 1) Verification Confidence (0–100)

Deterministic signals:

- org verified: +35
- community phone confirmation: +25
- community in-person confirmation: +35
- document proof uploaded: +20
- website health check passed: +10
- multiple confirmations in 90 days: +10

Penalties:

- stale over 180 days: -25
- repeated user reports trend: -15
- invalid/disconnected contact: -30

The score is clamped to 0–100.

---

## 2) Eligibility Match (0–100)

Structured rule-based matching only. ORAN never infers sensitive attributes.

Examples of deterministic boosts:

- kids in household → child/TANF/childcare-oriented services
- SNAP enrolled → food/SNAP office services
- no transportation → walkable/transit-compatible services

Unknown remains unknown. If a missing field materially changes ranking, ask exactly one clarifying question.

---

## 3) Constraint Fit (0–100)

Actionability now, using structured fields only:

- open now / next open time
- intake compatibility
- language match
- distance/time fit for transportation mode
- accessibility needs

Unknown constraint inputs remain unknown until clarified.

---

## Confidence bands and messaging

- **80–100**: High confidence
- **60–79**: Likely — confirm hours/eligibility
- **<60**: Possible — here's what to verify

All surfaces must display the band and the three sub-scores.

---

## Safety constraint

A high confidence score does **not** guarantee eligibility. ORAN must always use
"may qualify / likely qualifies / confirm with provider" language.
