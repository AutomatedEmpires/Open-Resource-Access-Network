# ORAN Agents Overview (Dev Guide)

This doc explains where agent code lives, how it is developed independently from seeker-facing ORAN surfaces, and how it aligns with SSOT.

## Where agent code lives

- Ingestion/verification agent primitives and contracts:
  - `src/agents/ingestion/**`
- Azure Functions (runtime triggers):
  - `functions/scheduledCrawl/` — Daily crawl timer
  - `functions/fetchPage/` — Queue-driven page fetcher
  - `functions/extractService/` — Queue-driven LLM extraction
  - `functions/verifyCandidate/` — Queue-driven verification
  - `functions/routeToAdmin/` — Queue-driven admin routing
  - `functions/manualSubmit/` — HTTP endpoint for staff submission
  - `functions/checkSlaBreaches/` — Timer-driven SLA monitoring

## Ingestion Pipeline — Built Inventory

### 9-stage stateless orchestrator
`SourceCheck → FetchPage → ExtractHtml → LlmExtract → LlmCategorize → Verify → Score → BuildCandidate → RouteToAdmin`

### Core modules
| Module | Path |
|---|---|
| LLM client + Azure OpenAI | `src/agents/ingestion/llm/` |
| Extraction + categorization prompts | `src/agents/ingestion/llm/prompts/` |
| Zod-validated response parser | `src/agents/ingestion/llm/parser.ts` |
| HTML sanitizer | `src/agents/ingestion/html/sanitizer.ts` |
| Content chunker (4K tokens) | `src/agents/ingestion/html/chunker.ts` |
| PDF text extraction | `src/agents/ingestion/html/pdfExtractor.ts` |
| HTTP fetcher + robots.txt | `src/agents/ingestion/fetch/` |
| Verification check runner | `src/agents/ingestion/verify/runner.ts` |
| 8 verification checks | `src/agents/ingestion/verify/checks/` |
| Confidence scorer (0–100) | `src/agents/ingestion/scoring/` |
| Admin routing (PostGIS proximity) | `src/agents/ingestion/routing/` |
| Pipeline orchestrator | `src/agents/ingestion/pipeline.ts` |
| Domain types + contracts | `src/agents/ingestion/contracts.ts` |

### Database layer
- 16 Drizzle ORM store implementations under `src/db/`
- 27 SQL migrations under `db/migrations/`

### API endpoints (admin)
- `src/app/api/admin/**` — ORAN admin: approvals, audit, rules, zones, ingestion jobs, scopes
- `src/app/api/community/**` — Community admin: queue, verify, coverage

### Test coverage
19 test files covering:
- All pipeline stage contracts
- LLM parser edge cases (missing fields, null values, schema mismatches)
- Verification check logic
- Confidence scoring model
- Admin routing coverage zone queries
- API route authorization

---

## Copilot chatmodes (developer tooling)

This repo also contains **Copilot chatmode profiles** under `.github/agents/`.

- Purpose: give contributors a safe, ORAN-aligned "mode" for each major workstream.
- These chatmodes are complementary to the detailed activation prompts in `docs/agents/activation/AGENT_*_ACTIVATION.md`.
- If a chatmode instruction conflicts with `.github/copilot-instructions.md` or SSOT docs, the SSOT wins.

Current chatmodes:

- `Azure_function_codegen_and_deployment.chatmode.md`
- `ORAN_apex_admin_portals.chatmode.md`
- `ORAN_actions_ci_maintainer.chatmode.md`
- `ORAN_delta_data_layer.chatmode.md`
- `ORAN_omega_seeker_ui.chatmode.md`
- `ORAN_ssot_docs_editor.chatmode.md`
- `ORAN_sigma_api_security.chatmode.md`
- `ORAN_triage_boardkeeper.chatmode.md`

## SSOT documents

- Ingestion pipeline spec: `docs/agents/AGENTS_INGESTION_PIPELINE.md`
- Ingestion roadmap + status: `docs/agents/ROADMAP.md`
- Source Registry spec: `docs/agents/AGENTS_SOURCE_REGISTRY.md`
- Control plane model: `docs/agents/AGENT_CONTROL_PLANE.md`
- Scoring SSOT: `docs/SCORING_MODEL.md`
- Safety contract: `docs/SSOT.md`

## Safety boundaries

- Agents may write only to **staging + audit** tables until a human approves publish.
- Seekers only see **stored verified records**.
- If an LLM is used, it may only assist with extraction/summarization and must be treated as unverified.

## Copilot Studio (optional)

Microsoft Copilot Studio can be used for **admin-only helper agents** (e.g., summarizing already stored evidence, checklist assistance, drafting reviewer notes).

Hard boundaries:

- Copilot Studio agents must not bypass the Source Registry for crawling.
- Copilot Studio agents must not publish records directly.
- Seeker-facing surfaces must continue to read only from stored verified records.

## How other workstreams integrate

- SQL agent:
  - implements staging/audit/source-registry schemas to match `src/agents/ingestion/contracts.ts` + SSOT docs
- UI/UX agent:
  - builds admin queues (`Needs Verification`, `In Progress`, `Upcoming Re-Verifications`) and guided field completion flows

## Testing

- Agent contracts and helpers must have unit tests in `src/agents/ingestion/__tests__/`.
