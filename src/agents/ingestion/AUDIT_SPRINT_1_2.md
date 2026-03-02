# Ingestion Agent Audit — Sprints 1 & 2

**For:** Audit Agent
**Created:** 2026-03-02
**Scope:** Code quality, safety compliance, and contract alignment audit

---

## Your Task

You are auditing the first two sprints of the ORAN Ingestion Agent implementation. Your job is to review the code for correctness, safety compliance, and alignment with the project's SSOT documents. This is a **read-only research task** — do not modify any files.

---

## Files to Audit

### Sprint 1 — LLM Extraction Core
- `src/agents/ingestion/llm/client.ts` — LLM client interface
- `src/agents/ingestion/llm/types.ts` — Zod schemas for extraction/categorization
- `src/agents/ingestion/llm/providers/azureOpenai.ts` — Azure OpenAI implementation
- `src/agents/ingestion/llm/prompts/extraction.ts` — Extraction prompt builder
- `src/agents/ingestion/llm/prompts/categorization.ts` — Categorization prompt builder
- `src/agents/ingestion/llm/prompts/index.ts` — Barrel export
- `src/agents/ingestion/llm/providers/index.ts` — Barrel export
- `src/agents/ingestion/llm/index.ts` — Module barrel export
- `src/agents/ingestion/__tests__/llm.test.ts` — Unit tests (25 tests)

### Sprint 2 — Fetcher + HTML Extraction
- `src/agents/ingestion/fetcher/types.ts` — Zod schemas for fetch/extraction types
- `src/agents/ingestion/fetcher/fetcher.ts` — PageFetcher with redirect handling
- `src/agents/ingestion/fetcher/htmlExtractor.ts` — HTML-to-text using cheerio
- `src/agents/ingestion/fetcher/linkDiscovery.ts` — Link classification
- `src/agents/ingestion/fetcher/evidenceBuilder.ts` — EvidenceSnapshot creation
- `src/agents/ingestion/fetcher/dedupIntegration.ts` — Deduplication
- `src/agents/ingestion/fetcher/index.ts` — Module barrel export
- `src/agents/ingestion/__tests__/fetcher.test.ts` — Unit tests (57 tests)

### SSOT Documents to Cross-Reference
- `docs/AGENTS_INGESTION_PIPELINE.md` — Pipeline contract specification
- `docs/AGENTS_SOURCE_REGISTRY.md` — Source allowlist/quarantine rules
- `docs/AGENTS_OVERVIEW.md` — Agent architecture overview
- `src/agents/ingestion/AGENT_PROCESSING_SPEC.md` — Processing specification
- `src/agents/ingestion/contracts.ts` — Core Zod contracts (EvidenceSnapshot, ExtractedCandidate, etc.)
- `.github/copilot-instructions.md` — Safety non-negotiables

---

## Audit Checklist

### 1. Safety Compliance (CRITICAL)
Check each file against the non-negotiables in `.github/copilot-instructions.md`:
- [ ] **No hallucinated facts**: LLM prompts must instruct model to only extract facts present in source text
- [ ] **Retrieval-first**: Extraction prompts must not allow LLM to invent service names, phones, addresses, hours, or URLs
- [ ] **Eligibility caution**: No code should guarantee eligibility — use "may qualify" / "confirm with provider"
- [ ] **Privacy-first**: No PII logging, no unauthorized data collection

### 2. Contract Alignment
- [ ] LLM extraction output schema (`ExtractionResultSchema`) aligns with `ExtractedCandidateSchema` in contracts.ts
- [ ] `EvidenceSnapshot` created by EvidenceBuilder matches `EvidenceSnapshotSchema` in contracts.ts
- [ ] Service categories in categorization prompt match `ServiceCategorySchema` taxonomy
- [ ] Link types in LinkDiscovery match `DiscoveredLinkSchema.type` enum

### 3. Error Handling
- [ ] LLM client classifies errors (rate_limited, timeout, auth_error, content_filtered)
- [ ] PageFetcher classifies errors (timeout, dns_error, ssl_error, connection_refused, etc.)
- [ ] All error types have `retryable` flag properly set
- [ ] No unhandled promise rejections or bare `catch {}` blocks

### 4. Type Safety
- [ ] All exports have explicit types (no implicit `any`)
- [ ] Zod schemas used for runtime validation at boundaries
- [ ] Factory functions return properly typed instances

### 5. Test Coverage
- [ ] Schema validation tests exist for all public Zod schemas
- [ ] Error classification tests cover all error codes
- [ ] Prompt builders have output format tests
- [ ] No tests rely on network calls (should be unit tests only)

### 6. Security Concerns
- [ ] No hardcoded API keys or secrets
- [ ] Environment variables properly named (LLM_ENDPOINT, LLM_API_KEY, etc.)
- [ ] User-Agent string is identifiable for responsible crawling
- [ ] maxContentLength limit prevents memory exhaustion
- [ ] Redirect handling has max limit to prevent infinite loops

### 7. Documentation
- [ ] Each module has JSDoc on public exports
- [ ] Complex logic has inline comments
- [ ] Barrel exports (index.ts) are comprehensive

---

## Expected Output

Produce a report with:

1. **Summary**: Overall assessment (PASS / NEEDS ATTENTION / CRITICAL ISSUES)

2. **Findings by Category**: For each checklist section, list:
   - Items that pass ✅
   - Items that need attention ⚠️ (with file:line references)
   - Critical issues 🚨 (with file:line references and fix recommendations)

3. **Contract Drift**: Any mismatches between implementation and SSOT docs

4. **Recommendations**: Prioritized list of improvements for Sprint 3+

---

## How to Run

```bash
# Verify tests pass
npm test

# Check TypeScript compiles
npx tsc --noEmit

# Run linter
npm run lint
```

All three should pass cleanly. If any fail, note the failures in your report.

---

## Notes

- The LLM module is designed but not yet wired to a live Azure OpenAI endpoint
- The fetcher module has network-dependent code that is tested via mocks
- Sprint 3 will create the Pipeline Orchestrator that chains these components
