# Wiki And Handbook Index

This page defines what should live in the GitHub Wiki versus this repository.

## Source Of Truth Rule

- Repository docs under `docs/**` remain authoritative for specifications, contracts, and runbooks.
- Wiki pages should summarize and point back to canonical repo paths.

## Recommended Wiki Structure

| Wiki Page | Canonical Repo Source |
| --- | --- |
| Mission and principles | `docs/VISION.md` |
| System overview | `README.md`, `docs/REPO_MAP.md` |
| Onboarding by role | `START_HERE.md` |
| Contracts overview | `docs/contracts/README.md` |
| Operational playbooks | `docs/ops/README.md` |
| Deployment model | `docs/platform/DEPLOYMENT_AZURE.md` |

## Publishing Guidance

1. Copy concise summaries to wiki pages.
2. Include direct links back to canonical docs.
3. Do not duplicate long-form specs in the wiki.
4. When repo docs change, update wiki summaries in the same iteration.

## Change Control

- Contract or safety-critical edits must be made in repo docs first.
- Wiki should never be the first or only place where contractual behavior is defined.
