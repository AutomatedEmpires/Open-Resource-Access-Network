# ORAN Confidence Scoring Model

The confidence score quantifies how trustworthy a service record is. It drives display prominence, warning banners, and verification prioritization. **It does not determine eligibility** — only data quality.

---

## Score Formula

```
confidence_score = (
  data_completeness    × 0.25 +
  verification_recency × 0.30 +
  community_feedback   × 0.20 +
  host_responsiveness  × 0.15 +
  source_authority     × 0.10
) + penalties
```

Final score is clamped to **[0.000, 1.000]**.

---

## Factor Definitions

### `data_completeness` (weight: 0.25)
Measures the percentage of important fields that are populated.

Required fields (must all be present for full score):
- `name`, `description`, `status`
- At least one `phone`
- At least one `address`
- At least one `schedule`
- `organization.name`

Scoring:
- All required fields present → 1.0
- Each missing required field → subtract (1.0 / count_required_fields)
- Optional but valuable fields (url, email, fees, eligibility) → +0.05 each, capped at 1.0

### `verification_recency` (weight: 0.30)
How recently a human verifier confirmed the record's accuracy.

| Time Since Last Verification | Score |
|------------------------------|-------|
| < 30 days                    | 1.00  |
| 30–90 days                   | 0.90  |
| 90–180 days                  | 0.75  |
| 180–365 days                 | 0.50  |
| 365–730 days                 | 0.25  |
| > 730 days or never verified | 0.00  |

### `community_feedback` (weight: 0.20)
Aggregated seeker feedback signal.

- Computed from `seeker_feedback.rating` (1–5 scale) and `contact_success` (boolean)
- Formula: `(avg_rating / 5.0 × 0.7) + (contact_success_rate × 0.3)`
- Minimum 3 feedback entries required; below threshold defaults to 0.50 (neutral)

### `host_responsiveness` (weight: 0.15)
How actively the host organization maintains their records.

| Behavior                              | Score |
|---------------------------------------|-------|
| Updated within 30 days               | 1.00  |
| Updated within 90 days               | 0.80  |
| Updated within 180 days              | 0.60  |
| Updated within 365 days              | 0.40  |
| Not updated in > 365 days            | 0.20  |
| No host claimed (unowned record)     | 0.10  |

### `source_authority` (weight: 0.10)
Reliability of the original data source.

| Source Type                    | Score |
|--------------------------------|-------|
| Government database import     | 1.00  |
| 211/AIRS taxonomy-linked       | 0.90  |
| Verified nonprofit filing      | 0.80  |
| Host-submitted + admin verified| 0.70  |
| Host-submitted (unverified)    | 0.40  |
| Community-contributed          | 0.30  |
| Unknown origin                 | 0.10  |

---

## Penalties

Penalties are subtracted from the weighted sum **after** factor computation.

| Penalty Condition                         | Deduction |
|-------------------------------------------|-----------|
| Staleness: >30 days past due for review   | -0.05 per 30-day period (max -0.30) |
| Unresolved flag in verification_queue     | -0.10 per open flag (max -0.30) |
| Bounced contact (phone/email unreachable) | -0.20     |
| Duplicate record detected                 | -0.15     |

---

## Confidence Bands

| Band        | Score Range | Display Color | Behavior |
|-------------|-------------|---------------|----------|
| HIGH        | 0.75 – 1.00 | Green         | Show prominently, no warning |
| MEDIUM      | 0.50 – 0.74 | Yellow        | Show with "information may have changed" note |
| LOW         | 0.25 – 0.49 | Orange        | Show with "please verify before visiting" warning |
| UNVERIFIED  | 0.00 – 0.24 | Gray          | Show with "this record has not been verified" banner; deprioritized in results |

---

## Update Triggers

The confidence score is recalculated whenever:

1. Any field on the associated `service` record is updated
2. A `verification_queue` entry status changes (verified/rejected/escalated)
3. New `seeker_feedback` is submitted for the service
4. The host updates their organization record
5. The `computed_at` timestamp is > 24 hours old (background job recalculation)
6. A contact bounce is reported via the feedback API

---

## Recalculation Rules

- **Synchronous**: Score updated immediately on field changes (lightweight delta)
- **Asynchronous**: Full recalculation runs nightly via background job
- **Score history**: Previous scores are retained in `confidence_scores` with `computed_at` timestamps for audit purposes
- **Display**: UI always shows the most recent score with its `computed_at` timestamp

---

## Eligibility Disclaimer

> **IMPORTANT**: Confidence scores measure data quality only. A HIGH confidence score does NOT mean a person qualifies for a service. Eligibility is determined solely by the service provider. ORAN uses "may qualify," "likely qualifies," or "confirm with provider" language — never guarantees.
