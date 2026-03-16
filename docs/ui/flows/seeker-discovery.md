---
title: "Seeker Discovery Flow"
description: "End-to-end flow for a seeker finding and viewing a service — Chat, Directory, Map, and Service Detail."
updated: "2025-07"
---

This document describes the primary user journey for a community member finding verified services on ORAN.

## Overview

A seeker arriving on ORAN has three entry points into service discovery:

- **Chat** — conversational, intent-driven (default landing experience)
- **Directory** — filterable browse list with trust/confidence scoring
- **Map** — geographic proximity view of verified services

All three surfaces read from the same verified service database and use the same confidence scoring model. No LLM participates in retrieval or ranking — AI may only summarize *already retrieved records* when the `llm_summarize` feature flag is enabled.

---

## Flow Chart

```mermaid
flowchart TD
    A([User arrives on ORAN]) --> B{Entry point}

    B -->|Conversational| C[/chat\nChatPageClient]
    B -->|Browse / filter| D[/directory\nDirectoryPageClient]
    B -->|Near me| E[/map\nMapPageClient]

    C --> F[ChatWindow\nforms message → API /api/chat]
    F --> G{AI feature flag\nllm_summarize?}
    G -->|disabled| H[Retrieval-only results\nfrom DB]
    G -->|enabled| I[Retrieved records\n+ LLM summary layer]
    H --> J[ServiceCard list\nin chat results]
    I --> J

    D --> K[DirectoryPageClient\nloads /api/services with filters]
    K --> L[ServiceCard grid\nwith trust badges]

    E --> M[MapPageClient\nloads /api/services with geo filter]
    M --> N[Map pins + ServiceCard list]

    J --> O[User taps 'View details']
    L --> O
    N --> O

    O --> P[/service/:id\nServiceDetailClient]
    P --> Q[Full service record\neligibility · hours · contact]
    Q --> R{User action}
    R -->|Save| S[Saved → /saved\nSavedPageClient]
    R -->|Report issue| T[/report\nReportPageClient]
    R -->|Back| U{Return surface}
    U --> D
    U --> E
    U --> C

    style A fill:#fff7ed,stroke:#fb923c
    style J fill:#ecfdf5,stroke:#34d399
    style L fill:#ecfdf5,stroke:#34d399
    style N fill:#ecfdf5,stroke:#34d399
    style P fill:#eff6ff,stroke:#60a5fa
```

---

## Page-by-Page Notes

### `/chat` — ChatPageClient

| Element | Mobile behaviour |
|---------|-----------------|
| Context strip | Horizontal scroll, chips non-wrapping |
| Discovery tabs (Chat/Directory/Map) | Compact `px-3` padding, `min-h-[44px]` |
| Chat input | Full-width, `min-h-[44px]` |
| Trust filter buttons | `min-h-[44px]`, stacked below input on xs |
| Result cards | Same `ServiceCard` as directory — full-width on xs, two-column on sm+ |

### `/directory` — DirectoryPageClient

| Element | Mobile behaviour |
|---------|-----------------|
| Search bar | Full-width `w-full` |
| Search + Clear buttons | Stack vertically on xs, row on sm+ |
| Attribute filter chips | Label above chips, `flex-wrap gap-2` |
| Trust/Sort row | Column on xs → row on sm+ |
| Results grid | 1 col → 2 col (sm) → 3 col (lg) |

### `/map` — MapPageClient

| Element | Mobile behaviour |
|---------|-----------------|
| Search/refine panel | Search first, then location state, then expandable refinement |
| Common need chips | Icon-led quick topics stay visible as large tap targets |
| Map canvas | Full-width, fixed height |
| Map scale | Visible distance scale for orientation |
| Result order | `Best fit` or `Nearest first` for the result list |
| Results sidebar | Collapses to bottom on mobile |

### `/service/:id` — ServiceDetailClient

| Element | Mobile behaviour |
|---------|-----------------|
| Main content + sidebar | 1 col → 2 col at `lg:` |
| Breadcrumb / back navigation | Visible above card on all sizes |
| Contact section | `grid gap-4 md:grid-cols-2` |
| Confidence / eligibility cards | Full-width on xs |

---

## ARIA Map

| Surface | Key ARIA patterns |
|---------|------------------|
| ChatWindow | `aria-label` on input; `aria-live="polite"` on results |
| Directory/Map filters | `role="group"` or `<fieldset>` wrapping filters |
| ServiceCard | Semantic landmark; `<article>` with heading |
| ServiceDetailClient | `role="status" aria-busy` loading state; `role="alert"` error |
| Notifications | `aria-live="polite"` on list container; `role="group"` on filter tabs |
| Profile collapsibles | `aria-expanded`, `aria-controls` on toggle buttons |

---

## Related Docs

- [Discovery surface contracts](../contracts/) — query parameters, response shape
- [Scoring model](../SCORING_MODEL.md) — how confidence scores are calculated
- [Chat architecture](../CHAT_ARCHITECTURE.md) — pipeline and safety gates
