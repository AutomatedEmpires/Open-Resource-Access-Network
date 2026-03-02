# ORAN UI Surface Map

Complete inventory of all UI routes, access control, and component hierarchy.

---

## Implementation Status Legend

- ✅ Implemented and meets Page DoD
- 🔲 Placeholder / shell only

---

## Public Entry Routes

### `/` — Landing / Entry ✅
**Access**: Public
**Purpose**: Explain ORAN's trust model ("verified records"), route into seeker discovery

Component hierarchy:
```
HomePage
├── TopBar (ORAN brand + Sign in)
├── Hero
│   ├── PrimaryCTA (Find services → /chat)
│   └── EscapeHatches (Directory → /directory, Map → /map)
├── TrustCards (×3: Verified records, Search naturally, Location-aware)
└── Footer (eligibility disclaimer)
```

## Seeker Routes (public-facing)

### `/chat` — Chatbot Interface ✅
**Access**: Public (anonymous or authenticated)
**Purpose**: Primary interface for finding services conversationally

Component hierarchy:
```
ChatPage
└── ChatWindow
    ├── CrisisBanner (shown when crisis detected)
    ├── MessageList
    │   ├── AssistantMessage
    │   │   └── ServiceCardList
    │   │       └── ServiceCard (×N)
    │   │           └── ConfidenceBadge
    │   └── UserMessage
    ├── EligibilityDisclaimer (always visible)
    ├── QuotaIndicator
    └── ChatInputForm
        ├── TextInput
        └── SendButton
```

### `/map` — Interactive Map ✅
**Access**: Public
**Purpose**: Geographic browse and filter of services

Component hierarchy:
```
MapPage
├── SearchBar (text input + submit)
├── SearchThisArea button (enables bbox-on-pan)
├── ErrorBoundary
│   └── MapContainer (Azure Maps SDK)
│       ├── HtmlMarker (×N, blue pins)
│       └── Popup (on click: name + org)
├── PinCount label
└── ResultsList
    └── ServiceCard (×N, compact)
```

### `/directory` — Searchable Directory ✅
**Access**: Public
**Purpose**: Fast text search + filter of all services

Component hierarchy:
```
DirectoryPage
├── SearchBar (text input + submit)
├── FilterToggle button
├── FilterPanel (collapsible)
│   └── ConfidenceFilter (All / Likely+ / High)
├── ErrorBoundary
│   ├── SkeletonCard grid (loading)
│   ├── EmptyState (before search / no results)
│   ├── ServiceCardGrid
│   │   └── ServiceCard (×N)
│   └── Pagination (Prev / Next)
└── EscapeHatches (Map, Chat)
```

### `/saved` — Saved Services ✅
**Access**: Public (localStorage-based, no auth required)
**Purpose**: Bookmarked services stored on-device only (privacy-first)

Component hierarchy:
```
SavedPage
├── Header (title + Clear All button)
├── ErrorBoundary
│   ├── SkeletonCard grid (loading)
│   ├── EmptyState (no saves → escape hatches to Chat/Directory/Map)
│   ├── ServiceCardGrid
│   │   └── ServiceCard (×N) + RemoveButton overlay
│   └── FallbackState (IDs saved but services not fetchable)
└── PrivacyNote ("stored on your device only")
```

### `/profile` — Seeker Profile ✅
**Access**: Public (localStorage-based, no auth required for local prefs)
**Purpose**: Manage preferences, view privacy posture, delete local data

Component hierarchy:
```
ProfilePage
├── ApproximateLocation section (city input, device-only)
├── SavedServicesSummary section (count + link to /saved)
├── PrivacyChecklist section (4 privacy guarantees)
├── AccountSection (Entra ID sign-in placeholder)
├── DeleteAllData section (confirm/cancel flow)
└── EscapeHatch (→ /chat)
```

---

## Host Routes (organization management)

### `/claim` — Claim Organization 🔲
**Access**: Authenticated
**Purpose**: Submit organization ownership claim for review

Component hierarchy:
```
ClaimPage
├── ClaimHeader (title + description)
├── ClaimForm
│   ├── OrgNameInput (required)
│   ├── DescriptionTextarea (optional)
│   ├── UrlInput (optional)
│   ├── ContactEmailInput (required)
│   └── ClaimNotesTextarea (optional)
├── SubmitButton → POST /api/host/claim
├── SuccessState (confirmation + next steps info)
├── ErrorState (inline error message)
└── InfoBlock ("What happens next" — verification process)
```

### `/org` — Organization Dashboard ✅
**Access**: host_member, host_admin
**Purpose**: Overview of organization status and pending tasks

Component hierarchy:
```
OrgDashboardPage
├── OrgHeader (title + "Claim new" link)
├── SearchInput (filter by name)
├── OrgGrid (×N cards, LIMIT=12)
│   └── OrgCard
│       ├── OrgName + Status badge
│       ├── Website link
│       ├── EditButton → EditModal
│       └── DeleteButton → DeleteConfirmDialog
├── Pagination (prev/next)
├── EditModal (name, description, url, email)
│   ├── SaveButton → PUT /api/host/organizations/[id]
│   └── CancelButton
└── DeleteConfirmDialog
    ├── DeleteButton → DELETE /api/host/organizations/[id]
    └── CancelButton
```

### `/locations` — Location Management ✅
**Access**: host_member (read), host_admin (write)
**Purpose**: Manage physical and virtual service locations

Component hierarchy:
```
LocationsPage
├── LocationHeader (title + Add button)
├── OrgFilterSelect (filter by organization)
├── LocationGrid (×N cards, LIMIT=12)
│   └── LocationCard
│       ├── Name + OrgName badge
│       ├── Address display
│       ├── Coordinates (if set)
│       ├── EditButton → LocationFormModal
│       └── DeleteButton → DeleteConfirmDialog
├── Pagination (prev/next)
├── LocationFormModal (create/edit)
│   ├── OrgSelect (required)
│   ├── NameInput
│   ├── DescriptionTextarea
│   ├── Address fields (address1, address2, city, state, postal, country)
│   ├── CoordinateInputs (lat, lng — optional)
│   ├── TransportationInput
│   ├── SaveButton → POST/PUT /api/host/locations[/id]
│   └── CancelButton
└── DeleteConfirmDialog
```

### `/services` — Service Management ✅
**Access**: host_member (read), host_admin (write)
**Purpose**: Manage service listings

Component hierarchy:
```
ServicesPage
├── ServiceHeader (title + Add button)
├── OrgFilterSelect (filter by organization)
├── ServiceGrid (×N cards, LIMIT=12)
│   └── ServiceCard
│       ├── Name + StatusBadge (active/inactive/defunct)
│       ├── OrgName badge
│       ├── Description excerpt
│       ├── URL + Email links
│       ├── EditButton → ServiceFormModal
│       └── DeleteButton → DeleteConfirmDialog
├── Pagination (prev/next)
├── ServiceFormModal (create/edit)
│   ├── OrgSelect (required)
│   ├── NameInput (required)
│   ├── DescriptionTextarea
│   ├── StatusSelect (active/inactive/defunct)
│   ├── Url + Email inputs
│   ├── SaveButton → POST/PUT /api/host/services[/id]
│   └── CancelButton
└── DeleteConfirmDialog
```

### `/admins` — Team Management ✅
**Access**: host_admin only
**Purpose**: Manage host_member access

Component hierarchy:
```
AdminsPage
├── TeamHeader (title + description)
├── AuthGatedNotice (Entra ID dependency warning)
├── InviteForm
│   ├── EmailInput
│   ├── RoleSelect (Host Admin / Host Member)
│   ├── SendInviteButton
│   └── InviteSuccessMessage
├── TeamMemberList
│   └── MemberRow (×N)
│       ├── Avatar (initial)
│       ├── Email + AddedDate
│       ├── StatusBadge (Active / Invited)
│       └── RoleBadge
└── RoleReference
    └── RoleCard (×2: host_admin, host_member descriptions)
```

---

## Community Admin Routes

### `/queue` — Verification Queue ✅
**Access**: community_admin
**Purpose**: Review and act on pending verification submissions

Component hierarchy:
```
QueuePage
├── QueueHeader (title + refresh button)
├── StatusFilterTabs (All / Pending / In Review / Verified / Rejected / Escalated)
├── ErrorState (inline alert)
├── SkeletonCard grid (loading)
├── EmptyState (no entries for current filter)
├── QueueTable
│   └── QueueRow (×N)
│       ├── ServiceNameLink (→ /verify?id=…)
│       ├── OrganizationName
│       ├── StatusBadge (color-coded)
│       ├── SubmittedDate + StaleIndicator (>14 days)
│       ├── AssignedTo (user or dash)
│       └── ActionButtons
│           ├── ClaimButton (pending only → POST /api/community/queue)
│           └── ReviewLink (→ /verify?id=…)
└── Pagination (entry count + prev/next)
```

### `/verify` — Record Verification ✅
**Access**: community_admin
**Purpose**: Deep-review individual service records and submit decisions

Component hierarchy:
```
VerifyPage
├── NoEntryState (no ?id= param → link to /queue)
├── LoadingSkeleton
├── ErrorState + retry
├── BackToQueueLink
├── VerifyHeader (service name + org name + StatusBadge)
├── TwoColumnLayout
│   ├── LeftColumn (detail panels)
│   │   ├── ServiceDetailPanel (description, URL, email, status)
│   │   ├── OrganizationPanel (name, description, URL, email)
│   │   ├── LocationsPanel (×N: name, address, coordinates)
│   │   └── PhonesPanel (×N: number, type, description)
│   └── RightColumn (scoring + decision)
│       ├── ConfidenceScorePanel
│       │   ├── OverallScore (4xl bold)
│       │   └── ScoreMeter (×3: Verification / Eligibility / Constraint)
│       ├── QueueInfoPanel (submitted, updated, submitter, assignee, notes)
│       └── DecisionForm
│           ├── SubmitResult (success/error alert)
│           ├── DecisionRadios
│           │   ├── Verify (green, confirm accurate)
│           │   ├── Reject (red, send back to host)
│           │   └── Escalate (purple, ORAN admin review)
│           ├── NotesTextarea (required for rejection, 5000 char max)
│           └── SubmitButton → PUT /api/community/queue/[id]
└── AlreadyReviewedState (for terminal statuses)
```

### `/coverage` (community-admin) — Zone Management ✅
**Access**: community_admin
**Purpose**: View verification metrics and activity for assigned zone

Component hierarchy:
```
CoveragePage
├── CoverageHeader (title + refresh button)
├── ErrorState (inline alert)
├── LoadingSkeleton
├── StatCardGrid (row 1)
│   ├── PendingCard (→ /queue?status=pending)
│   ├── InReviewCard (→ /queue?status=in_review)
│   ├── VerifiedCard (→ /queue?status=verified)
│   └── EscalatedCard (→ /queue?status=escalated)
├── StatCardGrid (row 2)
│   ├── TotalEntriesCard
│   ├── RejectedCard (→ /queue?status=rejected)
│   └── StaleCard (>14 days, red when > 0)
├── TwoColumnLayout
│   ├── RecentActivityTable (30-day breakdown)
│   │   └── ActivityRow (×N: date, verified/rejected/escalated counts)
│   └── TopOrganizationsPanel
│       └── OrgRow (×N: name + pending count badge)
└── ZoneMapPlaceholder (dashed border, future feature)
```

---

## ORAN Admin Routes

### `/approvals` — Claim Approvals 🔲
**Access**: oran_admin
**Purpose**: Approve or deny host organization claims

Component hierarchy:
```
ApprovalsPage
└── ApprovalsLayout
    ├── ClaimTable
    │   └── ClaimRow (×N)
    └── ClaimDetailDialog
```

### `/rules` — Scoring & System Rules 🔲
**Access**: oran_admin
**Purpose**: Configure confidence scoring weights, feature flags

Component hierarchy:
```
RulesPage
└── RulesLayout
    ├── FeatureFlagTable
    │   └── FeatureFlagRow (×N)
    └── ScoringWeightForm
```

### `/audit` — Audit Log 🔲
**Access**: oran_admin
**Purpose**: Full system audit trail

Component hierarchy:
```
AuditPage
└── AuditLayout
    ├── AuditFilters
    ├── AuditLogTable
    │   └── AuditRow (×N)
    └── ExportButton
```

### `/zone-management` (oran-admin) — Coverage Zone Admin 🔲
**Access**: oran_admin
**Purpose**: Manage all coverage zones and community admin assignments

Component hierarchy:
```
CoveragePage
└── CoverageAdminLayout
    ├── ZoneMap (full)
    ├── ZoneTable
    │   └── ZoneRow (×N)
    └── AssignAdminDialog
```

---

## Shared Components

- `Layout` — Shell with navigation, auth state
- `ServiceCard` — Used across seeker surfaces
- `ConfidenceBadge` — Color-coded band indicator
- `EligibilityDisclaimer` — Always-shown disclaimer
- `CrisisBanner` — Emergency resource display
- `Button`, `Badge`, `Dialog` — Base UI primitives
