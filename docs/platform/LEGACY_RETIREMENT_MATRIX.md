# ORAN Legacy Retirement Matrix

This matrix tracks compatibility shims, duplicate contracts, and boundary leftovers that remain visible in the platform after the architecture realignment work.

It exists to keep additive compatibility work from becoming permanent drift.

## Active Items

| Area | Legacy element | Current state | Retirement target | Owner surface |
| --- | --- | --- | --- | --- |
| Public search | `status` query override on `/api/search` | Retired at the public boundary on 2026-03-13; public search is always published-only active retrieval | Remove any remaining external references and treat non-active status selection as unsupported on seeker surfaces | `src/app/api/search/**`, seeker clients, public API docs |
| Ingestion architecture | `src/services/ingestion/**` as a quasi-runtime layer | Still present as a documented helper layer; canonical runtime is now `src/agents/ingestion/**` | Continue moving runtime logic and source-specific orchestration into `src/agents/ingestion/**` only | `src/services/ingestion/**`, `src/agents/ingestion/**` |
| Workflow language | Legacy `verification_queue` framing in docs and old notes | Live product, SSOT, and activation docs are largely aligned; remaining references are concentrated in compatibility/history material and a small set of internal prompt docs | Continue replacing misleading active guidance; preserve explicit compatibility/history labels where accurate | `docs/**`, agent prompt docs, historical runbooks |
| Public distribution | Route-local publication assumptions | Core search, services lookup, and HSDS routes now use shared publication primitives | Continue converging any remaining read paths and helper callers on the shared publication model | `src/services/search/publication.ts`, public API routes |
| Migrations and bridge artifacts | Deprecated migrations, maps, and bridge code still discoverable without lifecycle labels | Known in architecture docs but not consistently marked near the code/docs they support | Label legacy-only artifacts more explicitly and archive when superseded | `db/migrations/**`, legacy docs, bridge helpers |

## Stewardship Rules

- New compatibility shims must add an entry here when they are expected to survive beyond the immediate change set.
- Retiring a shim should update this matrix, the relevant SSOT doc, and `docs/ENGINEERING_LOG.md` when the public or safety contract changes.
- If a compatibility path has no stated owner surface or retirement target, it is architectural drift.
