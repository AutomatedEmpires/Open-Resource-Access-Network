# Possible Additions (Azure / Foundry / AI Toolkit) — Detailed Brainstorms

This doc captures **implementation-oriented** ideas aligned with ORAN’s non-negotiables:

- **Retrieval-first**: seeker-facing facts must come from stored records only.
- **No hallucinated facts**: LLMs (if used) may only summarize/transform already-retrieved records.
- **Safety-critical**: crisis routing is always first.
- **Privacy-first**: avoid PII in telemetry; keep derived artifacts minimal.

Where AI is used, prefer:

- **Deterministic** logic for decisions/ranking.
- **LLMs only for optional briefs/summaries** that are explicitly constrained to provided inputs.
- **Evaluation + tracing** via AI Toolkit so safety/faithfulness becomes testable.

---

## 1) Confidence Regression Alerts (Operations Loop, Unified with Notifications)

### Goal

When a service/org’s **trust signals degrade** (failed checks, staleness, negative feedback), automatically:

1) create an **admin task** (triaged into the right queue), and
2) notify the responsible actor (org admin / community admin / platform admin),
so scoring becomes a **closed-loop operations system**, not just a label.

### Why it matters

- Prevents “silent rot” (stale hours, dead phone numbers, moved locations).
- Makes the trust score actionable and explainable.
- Turns verification into a predictable workflow with SLAs.

### What triggers a regression

Deterministic triggers (examples — use your existing scoring inputs):

- **Website health check failure** (timeouts, 404, TLS errors) repeated N times.
- **Contact invalid** (phone disconnected, email bounces, address geocode mismatch).
- **Staleness threshold** (last_verified_at exceeds category-dependent window).
- **User feedback severity** (e.g., “closed permanently”, “fraud”, repeated “wrong hours”).
- **Verification confidence drop** crossing a band boundary (HIGH→LIKELY, LIKELY→POSSIBLE).

### Data model additions (recommended)

Create a dedicated set of tables for alerts + tasks so you can audit, dedupe, and resolve:

- `confidence_regressions`
  - `id`, `entity_type` (`service`/`org`), `entity_id`
  - `previous_score`, `new_score`, `previous_band`, `new_band`
  - `reasons_json` (machine-readable list of triggers)
  - `detected_at`, `status` (`open`/`acknowledged`/`resolved`/`suppressed`)
  - `dedupe_key` (hash of entity + reasons + time window)
- `admin_tasks`
  - `id`, `task_type` (e.g. `reverify_service`, `contact_check`, `website_fix`)
  - `entity_type`, `entity_id`, `priority`, `due_at`, `assigned_to_user_id?`
  - `queue` (`pending_verification`, `disputes`, `staleness_review`, …)
  - `status` (`open`/`in_progress`/`done`)
  - `created_by` (`system`/`user`), `metadata_json`

If an `admin_tasks` system already exists, extend it rather than duplicating.

### Pipeline architecture (Azure-first)

**Event source options** (pick one; start simple):

- **Azure Functions Timer Trigger** (hourly/daily) runs `checkConfidenceRegressions()`.
- Or **DB-trigger-like**: schedule function after scoring recalculation jobs.

**Processing steps**:

1) Query recent scoring changes (services/orgs updated in last 24h).
2) Compute regression state transitions.
3) Write `confidence_regressions` + create/merge `admin_tasks`.
4) Send notifications (existing notifications service) via:
   - in-app (DB),
   - email (Azure Communication Services Email) when configured.

**Operational guardrails**:

- Dedupe within a window (e.g., 72h) to avoid spam.
- Backoff escalation: if unresolved after X days, escalate to platform admin.
- Suppression: allow admins to “snooze” known outages.

### Where Foundry/AI fits (optional)

- **Optional: admin brief** for a regression:
  - Input: the regression reasons + evidence snippets already stored (no new crawling).
  - Output: a short bullet list “What changed / what to verify / suggested next step”.
  - Model: GPT-4.0 (your eastus) or Phi-4-mini for cheaper briefs.
  - Must include a “no new facts” constraint.

### AI Toolkit leverage

- **Evaluation**: create a test dataset of regressions and verify the pipeline:
  - correct queue routing,
  - no duplicate spam,
  - correct prioritization.
- **Tracing**: measure job runtime, notification volume, failure rates.

### Minimal MVP (fast path)

- Start with timer job + `admin_tasks` insert + in-app notification.
- Add email + briefs after the pipeline is stable.

---

## 2) Admin/Org/Community Templates + Unified Training / Onboarding “Universe”

### Goal

A gated, beautiful, role-specific knowledge system for:

- org onboarding,
- verification guidelines,
- dispute handling,
- standardized outreach messages,
- FAQs / scripts,
- and policy training.

This should be **universal** (shared core) plus **role overlays**.

### Content strategy

- **Core canonical modules** (shared):
  - How verification works (evidence types, what counts, what doesn’t).
  - Privacy + safety principles.
  - “How to keep your listing accurate” best practices.
- **Role overlays**:
  - Org admin: “How to respond to feedback”, “How to update hours”, “What evidence to upload”.
  - Community admin: “Verification checklist”, “When to escalate”, “Fraud indicators”.
  - Platform admin: “Enforcement”, “Appeals”, “Policy updates”.

### Product surface

- A **Templates Library** inside portals:
  - Browse by category, role, and workflow stage.
  - “Copy to clipboard” / “Use template” buttons.
  - Template variants by jurisdiction/language where needed.

### Data model

- `templates`
  - `id`, `title`, `slug`, `role_scope` (`org_admin`, `community_admin`, `platform_admin`, `shared`)
  - `category` (`faq`, `outreach`, `verification_script`, `policy`, `training`, …)
  - `content_markdown` (or structured blocks)
  - `version`, `updated_at`, `updated_by`
  - `tags` (array)
  - `jurisdiction_scope?` (nullable)
  - `language` (default `en`)
- `template_usage_events` (optional)
  - track what gets used to inform improvements (avoid user PII)

### Where Foundry/AI fits (carefully)

Two safe uses:

1) **Template personalization** (constrained):
   - Input: selected template + role + workflow context (no user PII).
   - Output: a filled-in draft that only rephrases and inserts allowed placeholders.
   - Hard rule: it cannot invent phone numbers/addresses/hours; placeholders remain placeholders.
2) **Quality checks** for templates:
   - Ensure reading level, clarity, and policy compliance.
   - Output issues list (not auto-edits) for human review.

### AI Toolkit leverage

- Use **Model Playground** to iteratively craft the “template personalization” prompt.
- Use **Evaluation** to verify it never inserts forbidden fields.

### Governance

- Treat templates like policy artifacts:
  - versioning,
  - audit log,
  - change review (two-person approval for platform-wide templates).

---

## 3) Queue Triage with Anomaly Prioritization (Deterministic)

### Goal

Admin review queues should be automatically prioritized by risk/impact signals, while staying explainable.

### Queues (example)

- Pending verification
- Upcoming re-verification
- Disputes / appeals
- High-risk feedback clusters
- Regression alerts (from #1)

### Deterministic priority score

Compute a `triage_priority` for each task:

- Higher when:
  - high traffic / high saves,
  - low trust score,
  - recent negative feedback volume,
  - high staleness likelihood,
  - crisis-adjacent categories (without exposing sensitive details).

Add `triage_explanations` (short machine-readable list) so UI can show “Why prioritized”.

### Where Foundry/AI fits

- Optional: **review brief** per task:
  - Summarize the task context using only already-stored records + evidence.
  - Produce: “Top 3 checks to perform” + “what evidence exists already”.

### AI Toolkit leverage

- **Bulk Run**: generate briefs for a batch of tasks and measure:
  - time saved,
  - faithfulness,
  - usefulness ratings.

---

## 4) Policy-as-Code “No Hallucinations” (Enforceable Safety Net)

### Goal

Prevent any LLM-generated output (summaries, briefs, personalization) from adding facts not present in the inputs.

### Approach (practical)

For any LLM output, run a **post-check** that validates:

- no new phone numbers,
- no new emails,
- no new addresses,
- no new URLs,
- no new hours/time ranges,
unless those exact tokens existed in the provided record set.

Implementation options:

- **Regex extractors** for sensitive fields (phones/emails/URLs) + exact match against allowed set.
- For addresses/hours (harder), use structured data:
  - supply the allowed structured fields,
  - require the model output in structured JSON with `citations` keys referencing record IDs.

### Enforcement points

- CI tests for prompt handlers.
- Runtime check before returning response.

### AI Toolkit leverage

- **Evaluation dataset** containing adversarial prompts that try to induce fabrication.
- Continuous regression scoring (“faithfulness rate”).

---

## 5) Feedback Clustering → Root-Cause Buckets → Reverification Campaigns

### Goal

Turn raw feedback into an operational map of systemic issues:

- “wrong hours” cluster
- “moved location” cluster
- “phone disconnected” cluster
- “closed permanently” cluster

Then generate targeted campaigns:

- re-check phone numbers for this cluster,
- schedule reverification tasks,
- contact org owners with a standardized template.

### Azure-first design

1) Store feedback text as-is (already likely). Ensure privacy rules (no PII in telemetry).
2) Generate embeddings for feedback text using:
   - Azure AI Foundry embeddings (you already have Cohere embed v3 multilingual deployed).
3) Cluster embeddings periodically:
   - simple k-means / HDBSCAN in a scheduled job,
   - store cluster IDs and top keywords.
4) Map clusters to action playbooks:
   - deterministic mapping (cluster keywords → `task_type`).

### Data model

- `feedback_embeddings` (or extend feedback table)
  - `feedback_id`, `embedding_vector`, `model`, `created_at`
- `feedback_clusters`
  - `id`, `label`, `top_terms_json`, `created_at`
- `feedback_cluster_members`
  - `cluster_id`, `feedback_id`

### Where Foundry/AI fits

- Optional: label clusters with a model (safe, internal-only):
  - Input: top terms + a few redacted examples.
  - Output: label + suggested playbook.

### AI Toolkit leverage

- **Evaluation**: validate cluster labeling accuracy and ensure it does not expose sensitive content.

---

## 6) Coverage Map + Gap-Finding (Monetizable Analytics)

### Goal

Create high-value insights from your own verified data:

- underserved areas
- category deserts (no shelters within X miles)
- language access gaps
- accessibility gaps
- hours coverage gaps (no after-hours options)

This can drive:

- grant reporting,
- county/city partnerships,
- and paid “coverage intelligence” for organizations.

### Implementation (Azure-first)

- Use PostGIS aggregation + materialized views:
  - counts by category per geo tile,
  - nearest-neighbor distance to category,
  - coverage indices.
- Render on the map UI as an admin-only layer:
  - heatmaps,
  - gap polygons,
  - trend lines.

### Optional AI augmentation (safe)

- Use LLMs only to produce narrative summaries of computed aggregates:
  - “In County X, childcare coverage is low in ZIPs A/B/C.”
  - These statements cite computed metrics, not invented services.

### AI Toolkit leverage

- **Evaluation**: verify narrative summaries match computed aggregates.
- **Tracing**: ensure map analytics jobs don’t degrade DB performance.

---

## Cross-Cutting: How AI Toolkit + Foundry fits ORAN’s constraints

### Recommended usage patterns

- **Playground**: iterate on prompts using *only* retrieved records/evidence.
- **Bulk Run**: run batch jobs for briefs, cluster labeling, template personalization.
- **Evaluation**: build safety/faithfulness regression suites (especially for “no new facts”).
- **Tracing**: correlate job latency, cost, failure rates, and throughput.

### Guardrails (non-negotiable)

- No LLM in seeker retrieval/ranking.
- LLM output must be:
  - optional,
  - clearly labeled,
  - constrained to provided sources,
  - post-validated by policy-as-code checks.

---

## Suggested sequencing (so this stays sane)

1) Confidence regression alerts (deterministic) + notifications.
2) Queue triage (deterministic) + explainability.
3) Templates library (shared content + governance).
4) Feedback clustering (embeddings) + playbooks.
5) Coverage analytics layer (PostGIS + optional narrative).
6) “No hallucinations” enforcement suite for any LLM briefs.
