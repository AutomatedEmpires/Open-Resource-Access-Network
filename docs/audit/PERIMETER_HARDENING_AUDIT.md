# ORAN Perimeter Hardening Audit (Audit 3)

**Client-Side · Headers · Secrets · Dependencies · Storage · SSRF · Crypto**

| Field | Value |
|---|---|
| **Audit date** | 2026-03-17 |
| **Scope** | Client-side security, CORS/CSP/security headers, environment/secrets management, dependency supply chain, file upload/blob storage, OAuth/OIDC/JWT, scheduled tasks, error handling/information disclosure, SSRF vectors, cryptographic usage, browser storage patterns |
| **Codebase snapshot** | Commit 3b0f324 (HEAD of main) |
| **Prior audits** | `ADVERSARIAL_SYSTEMS_AUDIT.md` — 12 launch blockers, all resolved. `BOUNDARY_LAYER_AUDIT.md` — 8 findings (B1-B8), all resolved. |
| **Auditor** | Automated perimeter analysis |

---

## Section A — Executive Summary

**Overall posture: PRODUCTION-READY.** No critical or P1 vulnerabilities found across 12 previously-unaudited surfaces. All findings are P3 operational observations or future-proofing recommendations. The platform demonstrates mature security patterns across all layers.

**Key strengths:**

- Strict CSP with `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`
- HSTS with preload directive (`max-age=63072000; includeSubDomains; preload`)
- All production secrets isolated in Azure Key Vault with RBAC authorization
- Zero `dangerouslySetInnerHTML` without sanitization — all uses wrapped in `safeJsonLd()`
- CSRF protection via same-origin enforcement in middleware
- Fail-closed auth in production (503 when auth unavailable)
- No file upload endpoints — all submissions are JSON-validated via Zod
- Blob storage `allowBlobPublicAccess: false` — queue-only model
- Allowlist-only federation for ingestion with adversarial test coverage
- Privacy-first browser storage — no auth tokens or PII in localStorage/sessionStorage
- No eval/Function constructors in application code
- No server-only env vars exposed to client components

---

## Section B — Findings

### C1. CSP allows `'unsafe-inline'` for scripts in production (P3 — observation)

| Property | Detail |
|---|---|
| **Severity** | P3 (hardening — no active exploit vector) |
| **Status** | 🟡 OBSERVATION — documented trade-off |
| **File** | `next.config.mjs:30` |
| **Detail** | Production CSP includes `script-src 'self' 'unsafe-inline'`. This is required because Tailwind CSS and Next.js inject inline styles/scripts at build time. Nonce-based CSP would be the ideal upgrade but requires Next.js middleware integration for dynamic nonce injection. |
| **Risk** | LOW — no user-controlled content is injected into `<script>` tags. All `dangerouslySetInnerHTML` uses are sanitized JSON-LD. XSS via inline script injection would require bypassing React's default escaping + Zod input validation. |
| **Recommendation** | When Next.js ships stable nonce-based CSP support, migrate from `'unsafe-inline'` to nonce-based script sources. |

### C2. Azure Maps SAS token rotation is manual (P3 — operational)

| Property | Detail |
|---|---|
| **Severity** | P3 (operational hygiene) |
| **Status** | 🟡 OBSERVATION |
| **File** | `infra/main.bicep:226-234`, `scripts/azure/rotate-maps-sas.sh` |
| **Detail** | Azure Maps SAS token is stored in Key Vault but rotation is a manual process. Automated rotation (e.g., Key Vault rotation policy or CI/CD pipeline) would reduce risk of stale tokens. |
| **Risk** | LOW — SAS tokens are scoped to map tile rendering only, not data access. |

### C3. Chat transcript stored in sessionStorage without size cap (P3 — hardening)

| Property | Detail |
|---|---|
| **Severity** | P3 (defense-in-depth) |
| **Status** | 🟡 OBSERVATION |
| **File** | `src/components/chat/ChatWindow.tsx:261` |
| **Detail** | Chat transcript messages are serialized to `sessionStorage` for tab persistence. No explicit size limit is enforced on the transcript array before serialization. A very long conversation could exceed sessionStorage quota (typically 5-10 MB). |
| **Risk** | LOW — server-side chat quota (per-session + 24-hr window) inherently limits transcript length. `sessionStorage` is cleared on tab close. No security impact — only UX (quota error). |

### C4. localStorage profile data not encrypted at rest (P3 — privacy note)

| Property | Detail |
|---|---|
| **Severity** | P3 (privacy observation) |
| **Status** | 🟡 OBSERVATION — by design (documented in ADR-0013) |
| **Files** | `src/services/profile/clientContext.ts`, `src/services/plans/client.ts`, `src/services/saved/client.ts` |
| **Detail** | Seeker preferences, plan items, and saved services are stored as plaintext JSON in localStorage. This is by design — the local-first architecture (ADR-0013) intentionally keeps data browser-local to avoid server-side PII storage. |
| **Risk** | LOW — data is user-controlled preferences and public service references. No passwords, tokens, or authentication material. Physical device access required to read. |

---

## Section C — Attack Surface Verification Matrix

| Attack vector | Blocked by | Verified |
|---|---|---|
| **XSS via inline script** | React default escaping + `safeJsonLd()` for JSON-LD | ✅ All `dangerouslySetInnerHTML` uses |
| **XSS via eval/Function** | Zero `eval()` / `new Function()` in app code | ✅ Grep verified |
| **Clickjacking** | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` | ✅ next.config.mjs |
| **MIME sniffing** | `X-Content-Type-Options: nosniff` | ✅ next.config.mjs |
| **CORS wildcard** | No `Access-Control-Allow-Origin: *`; same-origin enforced | ✅ Middleware + headers |
| **CSRF** | Middleware rejects cross-origin state-changing requests | ✅ proxy.ts |
| **Open redirect** | No user-controlled redirect targets in API routes | ✅ Zero `NextResponse.redirect` in API layer |
| **Server env leak** | No `process.env.*` (non-NEXT_PUBLIC) in client components | ✅ Grep verified |
| **PII in browser storage** | localStorage: preferences only. sessionStorage: transcripts only. | ✅ All storage keys audited |
| **File upload injection** | No file upload endpoints exist | ✅ JSON-only submissions |
| **Blob storage exposure** | `allowBlobPublicAccess: false` in Bicep | ✅ infra/main.bicep |
| **SSRF via ingestion** | Allowlist-only federation + URL validation + adversarial tests | ✅ sourceRegistry.ts |
| **SSRF via user input** | Zero server-side fetch from user-provided URLs | ✅ All fetch targets are API-internal |
| **Supply chain** | No postinstall/prebuild hooks; `undici` override for CVE fixes | ✅ package.json |
| **Secret exposure in logs** | Sentry PII redaction + `@secure()` Bicep params | ✅ sentry.ts + main.bicep |
| **Weak crypto** | bcrypt for passwords; `crypto.randomBytes(32)` for tokens; JWT via NEXTAUTH_SECRET | ✅ auth.ts + service.ts |
| **Timer function auth bypass** | All 4 functions require Bearer + INTERNAL_API_KEY | ✅ functions/*.ts |
| **Stale session** | 8-hour JWT maxAge; frozen-account triple enforcement | ✅ auth.ts |
| **Version fingerprinting** | `poweredByHeader: false` | ✅ next.config.mjs |

---

## Section D — Strengths Catalog

These security patterns are exemplary and should be preserved:

1. **Comprehensive CSP** — `default-src 'self'` with explicit allowlists per directive, `upgrade-insecure-requests`, and `form-action 'self'`
2. **HSTS preload** — 2-year max-age with `includeSubDomains` and `preload`
3. **Privacy-first storage** — localStorage for user preferences only; sessionStorage for ephemeral transcripts; no PII server-side
4. **JSON-LD sanitization** — All structured data uses `safeJsonLd()` which replaces `<` → `\u003c` to prevent script breakout
5. **Zero-upload architecture** — All data ingestion via JSON APIs or admin-controlled source feeds; no user file uploads
6. **Key Vault RBAC** — `enableRbacAuthorization: true` with managed identity access; no access policies
7. **Dependency hygiene** — `undici` override for CVE mitigation; no suspicious lifecycle hooks
8. **Fail-closed CSRF** — `isSameOriginWriteAllowed()` defaults to reject in production when headers are ambiguous
9. **Queue-only storage** — Azure Storage Account limited to ingestion queue triggers; blob public access disabled
10. **Adversarial SSRF testing** — Dedicated test file with IDN homograph, encoding tricks, file:// protocol, private IP, basic-auth-in-URL tests

---

## Section E — Recommendations Priority Matrix

| ID | Finding | Priority | Effort | Recommendation |
|---|---|---|---|---|
| C1 | CSP `'unsafe-inline'` for scripts | **P3** | Medium | Migrate to nonce-based CSP when Next.js support matures |
| C2 | Manual SAS token rotation | **P3** | Low | Add Key Vault rotation policy or CI/CD rotation step |
| C3 | sessionStorage transcript unbounded | **P3** | Low | Add max-message-count trim before serialization |
| C4 | localStorage not encrypted | **P3** | N/A | By design (ADR-0013); accept as documented |

**All findings are P3 — no action required before production launch.**

---

## Section F — Coverage Summary

| Surface | Files examined | Issues found |
|---|---|---|
| Client-side security (XSS, CSP, cookies) | 15+ client components | 1 (C1 — CSP observation) |
| Environment / secrets management | next.config.mjs, .env.example, infra/main.bicep | 0 |
| Dependencies / supply chain | package.json (90+ deps) | 0 |
| File upload / blob storage | All API routes, Bicep config | 0 |
| CORS / CSP / security headers | next.config.mjs, proxy.ts | 1 (C1) |
| OAuth / OIDC / JWT | src/lib/auth.ts (350 lines) | 0 |
| Webhook endpoints | Full codebase search | 0 (not implemented) |
| Scheduled tasks (timer functions) | 4 Azure Functions | 0 |
| WebSocket / SSE | Full codebase search | 0 (not implemented) |
| Error handling / info disclosure | All API routes | 0 |
| SSRF vectors | Ingestion pipeline + all fetch calls | 0 |
| Cryptographic usage | auth.ts, ownershipTransfer, rateLimit | 0 |
| Browser storage patterns | 15+ files using localStorage/sessionStorage | 2 (C3, C4) |
| **Totals** | **50+ files, 12 surfaces** | **4 findings (0 critical, 0 P1, 0 P2, 4 P3)** |

---

## Section G — Cumulative Audit Status

| Audit | Scope | Findings | Status |
|---|---|---|---|
| **Audit 1** — Adversarial Systems | Ingestion, ownership, dedup, scoring, workflow, merge, notification, governance | 12 launch blockers (LB1-LB12) | ✅ All resolved |
| **Audit 2** — Boundary Layer | Auth/authz, 119 API routes, chat/search, DB, publish path, API keys | 8 findings (B1-B8): 0 critical, 2 P1, 4 P2, 2 P3 | ✅ All resolved |
| **Audit 3** — Perimeter Hardening | Client-side, headers, secrets, deps, storage, SSRF, crypto, functions | 4 findings (C1-C4): 0 critical, 0 P1, 0 P2, 4 P3 | ✅ All observations |

**Combined: 24 findings across 3 audits. 20 resolved with code changes. 4 documented observations (P3). 0 open action items.**

*Audit complete. Platform is production-ready from a security perspective.*
