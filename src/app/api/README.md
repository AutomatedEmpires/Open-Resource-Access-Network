# API Routes (src/app/api)

All API routes must:

- validate untrusted input using Zod
- avoid logging PII
- enforce safety gates before returning service recommendations

## Update-on-touch

If you add or change an API route:

- Document the API boundary in the relevant SSOT doc (chat/search/security/privacy)
- Add targeted unit tests for the underlying service module
- Add rate limiting where the endpoint is exposed publicly
