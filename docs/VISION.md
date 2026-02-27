# ORAN Vision

ORAN is a civic-grade, safety-critical, chatbot-first, GIS-enabled platform that helps people find government, state, county, nonprofit, and community services quickly and safely.

## Core Mission
Connect people in need to real, verified services — never invented ones.

## Non-Negotiables
1. **Truth First**: Every service recommendation comes from a retrieved database record. ORAN never invents services, phone numbers, addresses, hours, eligibility rules, or URLs.
2. **Safety Critical**: If a user indicates imminent risk or crisis, ORAN immediately routes to 911 / 988 / 211 before any other response.
3. **Accessibility**: Keyboard navigable, screen-reader friendly, mobile-first, low-bandwidth tolerant.
4. **Privacy**: Approximate location by default. Explicit consent before saving profile data.
5. **Retrieval-First**: No LLM in retrieval or ranking. LLM (if enabled by flag) may only summarize already-retrieved records.

## Product Surfaces
- **Chatbot** (primary): Conversational navigation using profile + geo + constraints
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
