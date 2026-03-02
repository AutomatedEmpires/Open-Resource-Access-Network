# API Routes (src/app/api)

All API routes must:

- validate untrusted input using Zod
- avoid logging PII
- enforce safety gates before returning service recommendations
- guard on `isDatabaseConfigured()` and return **503** if `DATABASE_URL` is not set

## Endpoints

| Route              | Method       | Status      | DB-backed | Notes                                        |
|--------------------|--------------|-------------|-----------|----------------------------------------------|
| `/api/search`      | GET          | Wired       | Yes       | Parameterized SQL via `ServiceSearchEngine`  |
| `/api/chat`        | POST         | Wired       | Yes       | Retrieval-first pipeline, intent → text search|
| `/api/feedback`    | POST         | Wired       | Yes       | INSERT into `seeker_feedback`                |
| `/api/maps/token`  | GET          | Wired       | No        | Server-side Azure Maps key broker, rate-limited|
| `/api/host/claim`  | POST         | Wired       | Yes       | Creates org + verification_queue entry       |
| `/api/host/organizations` | GET   | Wired       | Yes       | List host orgs with search + pagination      |
| `/api/host/organizations/[id]` | GET/PUT/DELETE | Wired | Yes | Single org read/update/delete              |
| `/api/host/services` | GET/POST   | Wired       | Yes       | List + create services with org filter       |
| `/api/host/services/[id]` | GET/PUT/DELETE | Wired | Yes   | Single service read/update/delete            |
| `/api/host/locations` | GET/POST  | Wired       | Yes       | List + create locations with org filter      |
| `/api/host/locations/[id]` | GET/PUT/DELETE | Wired | Yes  | Single location read/update/delete           |
| `/api/host/admins` | GET/POST      | Wired       | Yes       | List + invite org members (auth required)    |
| `/api/host/admins/[id]` | GET/PUT/DELETE | Wired | Yes       | Single member get/update role/remove         |
| `/api/community/queue` | GET/POST | Wired       | Yes       | List queue entries + claim (assign to self)  |
| `/api/community/queue/[id]` | GET/PUT | Wired    | Yes       | Full entry detail + submit decision (verify/reject/escalate) |
| `/api/community/coverage` | GET   | Wired       | Yes       | Aggregate verification stats, activity, top orgs |

## Update-on-touch

If you add or change an API route:

- Document the API boundary in the relevant SSOT doc (chat/search/security/privacy)
- Add targeted unit tests for the underlying service module
- Add rate limiting where the endpoint is exposed publicly
