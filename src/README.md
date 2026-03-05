# Source Code

This folder contains the ORAN application source code.

## Map

- `app/`: Next.js App Router pages and layouts
- `services/`: core business logic (chat/search/scoring/security/etc.)
- `domain/`: domain types/constants shared across the app
- `components/`: UI components used by pages
- `db/`: DB access + schema helpers used by services and routes
- `agents/`: ingestion pipeline and related automation code
- `lib/`: shared utilities and hooks
- `__tests__/`: cross-cutting tests and safety checks

## Related docs

- SSOT: `docs/SSOT.md`
- Chat pipeline: `docs/CHAT_ARCHITECTURE.md`
- Data model: `docs/DATA_MODEL.md`
