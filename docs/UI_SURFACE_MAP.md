# ORAN UI Surface Map

Complete inventory of all UI routes, access control, and component hierarchy.

---

## Seeker Routes (public-facing)

### `/chat` — Chatbot Interface
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

### `/map` — Interactive Map
**Access**: Public
**Purpose**: Geographic browse and filter of services

Component hierarchy:
```
MapPage
└── MapLayout
    ├── MapFilterPanel
    │   ├── CategoryFilter
    │   ├── RadiusSlider
    │   └── ConfidenceFilter
    ├── MapContainer (PostGIS-backed tiles)
    │   ├── ServiceMarker (×N)
    │   └── ClusterGroup
    └── MapResultsList
        └── ServiceCard (×N)
```

### `/directory` — Searchable Directory
**Access**: Public
**Purpose**: Fast text search + filter of all services

Component hierarchy:
```
DirectoryPage
└── DirectoryLayout
    ├── SearchBar
    ├── FilterPanel
    │   ├── CategoryCheckboxGroup
    │   ├── LocationFilter
    │   └── ConfidenceFilter
    ├── SortControls
    ├── ServiceCardGrid
    │   └── ServiceCard (×N)
    └── Pagination
```

### `/saved` — Saved Services
**Access**: Authenticated (seeker)
**Purpose**: Bookmarked services from search/chat sessions

Component hierarchy:
```
SavedPage
└── SavedLayout
    ├── SavedHeader
    ├── ServiceCardGrid
    │   └── ServiceCard (×N)
    └── EmptyState
```

### `/profile` — Seeker Profile
**Access**: Authenticated (seeker)
**Purpose**: Manage saved preferences, consent settings, location

Component hierarchy:
```
ProfilePage
└── ProfileLayout
    ├── ProfileForm
    │   ├── LocationPreference (approximate only)
    │   ├── CategoryPreferences
    │   └── AccessibilityNeeds
    ├── ConsentPanel
    │   ├── ProfileSaveConsent (explicit toggle)
    │   └── LocationShareConsent (explicit toggle)
    └── DangerZone
        └── DeleteProfileButton
```

---

## Host Routes (organization management)

### `/claim` — Claim Organization
**Access**: Authenticated
**Purpose**: Submit organization ownership claim for review

Component hierarchy:
```
ClaimPage
└── ClaimWizard
    ├── OrgSearchStep
    ├── VerificationStep (upload evidence)
    └── SubmissionConfirmation
```

### `/org` — Organization Dashboard
**Access**: host_member, host_admin
**Purpose**: Overview of organization status and pending tasks

Component hierarchy:
```
OrgDashboardPage
└── OrgLayout
    ├── OrgHeader
    ├── ConfidenceSummary
    ├── PendingVerificationList
    └── QuickActions
```

### `/locations` — Location Management
**Access**: host_member (read), host_admin (write)
**Purpose**: Manage physical and virtual service locations

Component hierarchy:
```
LocationsPage
└── LocationsLayout
    ├── LocationTable
    │   └── LocationRow (×N)
    ├── AddLocationButton
    └── LocationEditDialog
        └── LocationForm
```

### `/services` — Service Management
**Access**: host_member (read), host_admin (write)
**Purpose**: Manage service listings

Component hierarchy:
```
ServicesPage
└── ServicesLayout
    ├── ServiceTable
    │   └── ServiceRow (×N)
    ├── AddServiceButton
    └── ServiceEditDialog
        └── ServiceForm
```

### `/admins` — Team Management
**Access**: host_admin only
**Purpose**: Manage host_member access

Component hierarchy:
```
AdminsPage
└── TeamLayout
    ├── MemberTable
    │   └── MemberRow (×N)
    └── InviteMemberButton
```

---

## Community Admin Routes

### `/queue` — Verification Queue
**Access**: community_admin
**Purpose**: Review and act on pending verification submissions

Component hierarchy:
```
QueuePage
└── QueueLayout
    ├── QueueFilters
    ├── QueueTable
    │   └── QueueRow (×N)
    │       ├── ServicePreview
    │       └── ActionButtons (verify/reject/escalate)
    └── QueueStats
```

### `/verify` — Record Verification
**Access**: community_admin
**Purpose**: Deep-review individual service records

Component hierarchy:
```
VerifyPage
└── VerifyLayout
    ├── ServiceDetailView
    ├── FieldComparisonTable
    ├── EvidencePanel
    ├── HistoryTimeline
    └── DecisionForm
```

### `/coverage` (community-admin) — Zone Management
**Access**: community_admin
**Purpose**: View and manage assigned coverage zone

Component hierarchy:
```
CoveragePage
└── CoverageLayout
    ├── ZoneMap
    ├── ZoneStats
    └── ZoneSettings
```

---

## ORAN Admin Routes

### `/approvals` — Claim Approvals
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

### `/rules` — Scoring & System Rules
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

### `/audit` — Audit Log
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

### `/zone-management` (oran-admin) — Coverage Zone Admin
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
