# ORAN — Open Resource Access Network

ORAN is a civic-grade, safety-critical platform for finding government, state, county, nonprofit, and community services quickly and safely.

## Non-negotiables

- **Retrieval-first**: recommendations must come from stored records only.
- **No hallucinated facts**: never invent services, phone numbers, addresses, hours, eligibility, or URLs.
- **Crisis hard gate**: if imminent risk is detected, route immediately to **911 / 988 / 211**.
- **Eligibility caution**: never guarantee eligibility; use "may qualify" and "confirm with provider" language.
- **Privacy-first**: approximate location by default; explicit consent before saving profile details.

## Current foundation (TAKEOFF)

- Next.js App Router + TypeScript shell
- HSDS-aligned schema + ORAN governance extensions (PostGIS-ready)
- Deterministic chat/search/scoring contracts
- Import-first pipeline scaffolding (`db/import`)
- Verification/moderation workflow scaffolding
- CI (lint, typecheck, tests, build)

## Import-first posture (default)

ORAN is designed to start with an **empty directory** and populate services through imports + verification.

1. Import HSDS CSV/JSON into staging
2. Mark imported records as `unverified`
3. Review via moderation queue
4. Verify and publish records
5. Recompute confidence scores

`db/seed/demo.sql` is optional and for **DEMO ONLY** with fictional data.

## Local setup

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deployment (Azure-first)

ORAN is **Azure-first** for hosting and production operations.

- Azure deployment guide: `docs/DEPLOYMENT_AZURE.md`
- Environment variable reference: `.env.example` (never commit real secrets)

## Database local setup

```bash
cd db
docker compose up -d
```

See `db/README.md`, `docs/IMPORT_PIPELINE.md`, and `docs/SCORING_MODEL.md` for workflow details.
