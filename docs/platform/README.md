# Platform

ORAN's active platform target is Vercel + Supabase + Clerk + Sentry.

- Start with [STACK_MIGRATION.md](STACK_MIGRATION.md) for the decision, current state, cutover gates, and environment contract.
- Azure documents and `infra/` are retained as rollback/decommission history. They are not the source of truth for new platform work.
- Product safety and verified-resource rules remain authoritative regardless of provider.
