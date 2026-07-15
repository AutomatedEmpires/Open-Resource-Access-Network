# ORAN Vision

**Building Bridges | Strengthening Communities**

ORAN is a nationwide, civic-grade, safety-critical, chatbot-first, GIS-enabled platform that helps people across the United States find government, state, county, nonprofit, and community services quickly and safely.

## Core Mission

Connect people in need to real, verified services — never invented ones.

The core journey is situation → need → eligibility and access constraints → the best verified next step. ORAN is not a collection of benefit-adjacent directories. Supporting datasets such as stores that accept SNAP may enrich a recommendation, but direct services, official programs, application paths, and human help remain the seeker-facing product.

## Non-Negotiables

1. **Truth First**: Every service recommendation comes from a retrieved database record. ORAN never invents services, phone numbers, addresses, hours, eligibility rules, or URLs.
2. **Safety Critical**: If a user indicates imminent risk or crisis, ORAN immediately routes to 911 / 988 / 211 before any other response.
3. **Accessibility**: Keyboard navigable, screen-reader friendly, mobile-first, low-bandwidth tolerant.
4. **Privacy**: Approximate location by default. Explicit consent before saving profile data.
5. **Retrieval-First**: No LLM in retrieval or ranking. LLM (if enabled by flag) may only summarize already-retrieved records.
6. **Nationwide by Design**: Local quality canaries help validate the system, but they never narrow the product's United States coverage boundary.
7. **Source Purpose**: Trustworthiness and usefulness are distinct. Supporting reference data may enrich results but cannot masquerade as a standalone service.

## Product Surfaces

- **Chat-first intake** (primary): plain-language need intake, focused follow-up, and conversational navigation using only the profile, approximate geography, and constraints that can change the match
- **Map UI**: Live filtering on pan/zoom, clustering, listing cards
- **Directory UI**: Fast searchable list with filters

## Governance Moat

ORAN's differentiation is its verification workflow + confidence scoring system. Record accuracy is maintained through:

- Host-submitted evidence
- Community Admin verification
- Automated staleness detection
- User feedback loops

## Stakeholders

- **Seekers**: People looking for services
- **Hosts**: Organizations managing their listings
- **Community Admins**: Local verifiers
- **ORAN Admins**: Platform governors
