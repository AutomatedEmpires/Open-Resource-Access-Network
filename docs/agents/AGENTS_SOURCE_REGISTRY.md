# ORAN Source Registry (SSOT)

This document defines the **Source Registry** contract: how ingestion agents decide **what is allowed to be fetched**, **how discovery works**, and **how we stay nationwide without hand-curating tens of thousands of URLs**.

## Non-negotiables

- The Source Registry is the **only** entry point for automated crawling.
- Unknown domains are **quarantined** by default.
- Allowlisting a domain does **not** imply publishability. Publish still requires verification + human approval.
- Seekers never see unverified or non-stored facts.

## Nationwide bootstrap strategy (practical)

You do not need every URL.

Instead, we operate with:

1. **Seeded discovery** (always):
   - user submissions
   - partner feeds
   - curated lists

2. **Within-host expansion** (only after a host is seen and allowed):
   - optional sitemap discovery
   - optional directory pagination patterns
   - optional link-following rules

This is safe, manageable, and scalable.

## Trust levels

- `allowlisted`: agent may fetch + snapshot + extract + verify.
- `quarantine`: agent may fetch/snapshot/extract into staging for seeded URLs but **may not** expand discovery without admin approval.
- `blocked`: agent must not fetch.

## Default allowlist (initial)

For “nationwide immediately”, the safe default is:

- allowlisted: `*.gov`, `*.edu`
- quarantined-by-default (seed fetch allowed, no expansion): `*.mil` (primarily veteran-only relevant sources)
- everything else: quarantine unless explicitly added as allowlisted

Rationale:

- `*.gov` covers most federal/state/county/city official programs.
- `*.edu` often hosts official student/basic-needs resources and campus/community programs, but still requires verification.
- `*.mil` can be relevant for veteran resources, but should be treated as restricted: allowed for seeded ingestion, flagged for admin review, and never expanded automatically.

Note on “city sites”:

- Many large-city sites are already `*.gov` (e.g., `nyc.gov`) and are covered.
- City/municipal sites that are not `*.gov` should be added explicitly as Source Registry entries (usually as `quarantine` first, then promoted).

## What a Source Registry entry contains

A Source entry defines:

- **Domain rules** (exact host or suffix): e.g. `idaho.gov`, `.gov`
- **Crawl policy**:
  - obey robots.txt
  - allow/deny path prefixes
  - request budgets (rpm/concurrency)
- **Discovery rules** (optional):
  - sitemap
  - feed
  - directory index patterns
- **Coverage hint** (optional):
  - national/state/county/virtual

## How it interacts with verification

- `domain_allowlist` is a **critical** verification check.
- If the candidate URL matches an entry with trustLevel `quarantine`:
  - ingestion is allowed for the seeded URL (snapshot/extract into staging)
  - mark as `Needs Verification` + tag `source:quarantine`
  - route to ORAN-admin for allowlist decision (promote/demote)
- If the candidate URL is **unregistered** or `blocked`:
  - do not fetch
  - route to ORAN-admin for allowlist decision (register or reject)

## Promotion (student → prod)

- The Source Registry is data/config.
- Maintain it in staging tables and promote it via export/import or admin UI approval.
- Never auto-promote newly discovered domains to prod allowlist.
