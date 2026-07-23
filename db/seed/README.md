# Database Seed Data

This folder contains seed data and utilities for local/dev database initialization.

Use this when you need predictable baseline data for development or testing.

## Files

- `demo.sql` — fictional Demoville organizations, locations, services,
  eligibility, dietary options, adaptations, and confidence scores. All data is
  clearly marked `[DEMO]` and uses reserved 555 phone numbers.
- `demo-publication.sql` — the canonical publication chain for the demo
  services (source system → feed → published records → canonical entities →
  accepted provenance). **Apply this after `demo.sql`.**

## Why both files are required

Seeker discovery runs behind the affirmative publication gate
(`src/services/search/publication.ts`): a service is publicly visible only when
it can prove accepted, published provenance from an active non-manual source
system (or an approved manual submission). `demo.sql` alone inserts services
with no provenance, so every browse surface (directory, map, chat, scroll)
renders empty. `demo-publication.sql` grants the five demo services that
authority so the local app actually shows content.

```bash
# Example against a local disposable Postgres (see scripts/db/disposable-postgres.sh)
psql "$LOCAL_DATABASE_URL" -f db/seed/demo.sql
psql "$LOCAL_DATABASE_URL" -f db/seed/demo-publication.sql
```

Flag-gated seeker surfaces (plan workspace, reminders, execution dashboard)
stay dark by default; flip the corresponding `feature_flags` rows locally if
you need to see them.
