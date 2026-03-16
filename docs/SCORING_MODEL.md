# ORAN Trust + Match Scoring Model

ORAN scoring is deterministic and retrieval-first. We explicitly separate:

- **Trust** ("Is this listing verified and reliable?")
- **Match** ("Is this listing a good fit for this user's needs/constraints?")

## Public score contract (required)

ORAN exposes exactly three public sub-scores, each on **0–100**:

1. **Verification Confidence** (Trust)
2. **Eligibility Match** (Match)
3. **Constraint Fit** (Match)

Stored overall score (0–100):

```text
final = 0.45 * verification
      + 0.40 * eligibility
      + 0.15 * constraint
```

Seeker-facing messaging MUST be driven by **Trust** (verification) and MAY optionally show a
separate **Match** indicator. No other public values may drive trust/match messaging across
chat/map/directory.

---

## 1) Verification Confidence / Trust (0–100)

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
- open moderation flags: -10

The score is clamped to 0–100.

---

## 2) Eligibility Match (0–100)

Structured rule-based matching only. ORAN never infers sensitive attributes.

Examples of deterministic boosts:

- kids in household → child/TANF/childcare-oriented services
- SNAP enrolled → food/SNAP office services
- no transportation → walkable/transit-compatible services

Unknown match signals should not be treated as hard failures. If a missing field materially changes ranking,
ask exactly one clarifying question.

---

## 3) Constraint Fit (0–100)

Actionability now, using structured fields only:

- open now / next open time
- intake compatibility
- language match
- distance/time fit for transportation mode
- accessibility needs

Unknown constraint inputs should not be treated as hard failures until clarified.

## Chat retrieval shaping

Authenticated chat may apply deterministic profile-derived ordering hints during retrieval.
These hints are not a fourth public score and are not shown to seekers as a trust label.

Rules:

- Trust remains primary in ordering (`verification_confidence` first).
- Explicit seeker-facing `distance` sort is allowed as an alternate deterministic ordering for map/list surfaces, but it may only use stored coordinates and may not widen eligibility or bypass trust/confidence floors.
- Profile match is a secondary sort only.
- Only exact, schema-backed taxonomy mappings may contribute to profile match.
- Profile match may never override crisis routing, trust filtering, or the eligibility disclaimer.
- Free-text seeker context is not used for retrieval ranking in the current phase.
- Explicit directory/map/search filters remain authoritative; chat hydration is a soft ordering aid only.

---

## Trust bands and messaging

- **80–100**: High confidence
- **60–79**: Likely — confirm hours/eligibility
- **<60**: Possible — here's what to verify

All seeker-facing surfaces MUST display the **trust band** (HIGH / LIKELY / POSSIBLE).

The overall score MAY be shown on admin/detail views.
Expanded cards MAY show sub-scores (verification/eligibility/constraint) and/or a separate Match indicator.
Compact cards (chat bubbles, map list) display the trust band only.

---

## Safety constraint

A high confidence score does **not** guarantee eligibility. ORAN must always use
"may qualify / likely qualifies / confirm with provider" language.
