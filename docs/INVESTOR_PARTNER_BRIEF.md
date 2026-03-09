# ORAN Investor, Partner, And Collaborator Brief

ORAN is building a user-friendly, modern system that rapidly connects people to the resources most applicable to them, using verified inputs, transparent scoring, and reproducible results.

This project is aimed at a simple but stubborn problem: people often need help quickly, but the systems around service discovery are fragmented, stale, hard to navigate, and often built for institutional convenience instead of real user behavior. ORAN is being shaped to close that gap with a platform that feels modern, trustworthy, and operationally serious.

## What ORAN Is

ORAN is a civic-grade resource matching platform for:

- seekers trying to find relevant help quickly
- organizations maintaining services and updates
- community reviewers verifying records and coverage
- platform operators enforcing trust, safety, and governance

The product direction is designed to support web today and mobile-forward experiences next.

## Why It Matters

ORAN is built around a few strong beliefs:

- People should not have to dig through broken directories to figure out what help may apply to them.
- Modern users expect fast, low-friction, high-clarity interfaces.
- Trust must be designed into the system, not stapled on afterward.
- Relevance without verification is not enough.
- AI without boundaries is not acceptable in a safety-sensitive context.

## What Makes It Defensible

| Capability | ORAN Position |
| --- | --- |
| Retrieval discipline | User-facing recommendations come from stored records only |
| Verification workflow | Candidate data moves through staging, review, verification, and publish controls |
| Reproducible scoring | Ranking is deterministic and documented |
| Crisis safety | Imminent-risk signals route to 911, 988, or 211 before normal flow |
| Privacy posture | Approximate location by default and explicit consent before saving profile detail |
| Operating model | Docs, contracts, workflows, and platform posture are tied together intentionally |

## How Data Enters The System

ORAN uses an import-first and verification-first posture.

- structured imports and staging pipelines
- source-governed ingestion and discovery
- organization or staff submissions
- review and routing workflows before trusted publication

External content may assist ingestion. It does not bypass staging and does not get served directly to seekers as trusted content.

References:

- [docs/contracts/INGESTION_CONTRACT.md](contracts/INGESTION_CONTRACT.md)
- [docs/solutions/IMPORT_PIPELINE.md](solutions/IMPORT_PIPELINE.md)
- [docs/agents/AGENTS_SOURCE_REGISTRY.md](agents/AGENTS_SOURCE_REGISTRY.md)

## How Verification And Scoring Work

ORAN treats trust and fit as separate concerns.

- Verification Confidence: how reliable and verified the listing appears
- Eligibility Match: how well the listing fits the user’s stated needs
- Constraint Fit: how actionable the listing is under practical constraints

The platform documents and enforces deterministic scoring behavior so results remain explainable and reproducible.

References:

- [docs/SCORING_MODEL.md](SCORING_MODEL.md)
- [docs/contracts/SCORING_CONTRACT.md](contracts/SCORING_CONTRACT.md)

## How AI Is Used

AI is used as an assistant, not as the authority.

- AI may help with extraction, categorization, ingestion assistance, and optional summarization of already retrieved records.
- AI does not retrieve records for seeker responses.
- AI does not rank seeker results.
- AI does not invent service facts.

References:

- [docs/CHAT_ARCHITECTURE.md](CHAT_ARCHITECTURE.md)
- [docs/agents/AGENTS_OVERVIEW.md](agents/AGENTS_OVERVIEW.md)
- [docs/platform/OWNER_INFO.md](platform/OWNER_INFO.md)

## Who ORAN Serves

| User Area | Purpose | Reference |
| --- | --- | --- |
| Seeker | Find help quickly through chat, map, and directory experiences | [src/app/(seeker)/README.md](../src/app/(seeker)/README.md) |
| Host | Manage organizations, locations, services, and team workflows | [src/app/(host)/README.md](../src/app/(host)/README.md) |
| Community admin | Review, verify, and manage coverage workflows | [src/app/(community-admin)/README.md](../src/app/(community-admin)/README.md) |
| ORAN admin | Govern approvals, audits, rules, and platform controls | [src/app/(oran-admin)/README.md](../src/app/(oran-admin)/README.md) |

## Partnership Direction

ORAN is interested in conversations with:

- investors aligned with trust-centric civic infrastructure
- government and nonprofit partners that can improve verified supply and data quality
- universities, youth-support ecosystems, and community programs
- technical builders who care about product design, civic data, AI boundaries, and platform rigor

## Product Direction

Near-term direction includes:

- stronger public trust evidence and platform briefings
- more refined user and organization experiences
- deeper sourcing and verification coverage
- continued Azure-first operational maturity
- a mobile app path for everyday access and younger-user engagement

## Proof Links

- [README.md](../README.md)
- [docs/VISION.md](VISION.md)
- [docs/SSOT.md](SSOT.md)
- [docs/EVIDENCE_DASHBOARD.md](EVIDENCE_DASHBOARD.md)
- [docs/platform/PLATFORM_AZURE.md](platform/PLATFORM_AZURE.md)
- [infra/README.md](../infra/README.md)
