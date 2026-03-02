# Ingestion Agent Processing Specification

> **For the ingestion agent developer**: This is the complete contract for how the ORAN ingestion agent extracts, tags, scores, and routes resources.

---

## End-to-End Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  RAW INPUT (scraped webpage, PDF, manual entry, partner feed)               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: EVIDENCE CAPTURE                                                   │
│  - Snapshot the source (hash, timestamp, blob storage)                      │
│  - Extract canonical URL, HTTP status, content type                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: FIELD EXTRACTION (structured data)                                 │
│  - Organization name, service name, description                             │
│  - Phone(s), address, hours, website                                        │
│  - Each field gets: value + evidenceId + confidenceHint (high/medium/low)   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: TAG EXTRACTION (LLM-based)                                         │
│  - Feed text to generateTaggingPrompt()                                     │
│  - LLM returns structured JSON against taxonomy                             │
│  - Each tag gets confidence score (0-100)                                   │
│  - Validate against canonical taxonomy → reject invented tags               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: CONFIDENCE SCORING                                                 │
│  - Compute overall candidate confidence (0-100)                             │
│  - Run verification checks (domain allowlist, contact validity, etc.)       │
│  - Determine tier: green (≥80), yellow (≥60), orange (≥40), red (<40)       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 5: TAG CONFIRMATION ROUTING                                           │
│  - Green tags (≥80%): auto-approved                                         │
│  - Yellow/orange/red tags: go to admin confirmation queue                   │
│  - Each uncertain tag stored with: suggestedValue, confidence, reasoning    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 6: ADMIN ASSIGNMENT                                                   │
│  - Geocode address → lat/lng                                                │
│  - Find ~5 closest admin_profiles with matching category_expertise          │
│  - Create AdminAssignment records with 48hr SLA                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 7: ADMIN REVIEW (human)                                               │
│  - Admin sees: agent-extracted data + uncertain tags                        │
│  - Confirms/modifies/rejects uncertain tags                                 │
│  - Can add missing tags (host-side tagging)                                 │
│  - Makes final decision: approve, reject, needs_more_info, escalate         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 8: PUBLISH (to live database)                                         │
│  - If approved + green tier: publish to services, locations, etc.           │
│  - All tags (agent + host-confirmed) written to service_attributes, etc.    │
│  - Schedule reverification based on confidence tier                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step: Processing a Real Example

### Input: Raw Scraped Text

```
St. Mary's Community Food Pantry

Serving San Jose families since 1982. Open Tuesdays and Thursdays 10am-2pm.
No ID required - just show up! We provide emergency food boxes for families
in need. Halal boxes available with 48-hour advance request.

Wheelchair accessible entrance on west side of building. Free parking lot.
Bus stop (#23) on corner of 3rd and Main.

Languages: English, Spanish, Vietnamese

Eligibility: Must live in Santa Clara County. Income below 200% FPL.
All family sizes welcome.

Contact: (408) 555-1234
Address: 456 Main Street, San Jose, CA 95112
Website: www.stmaryspantry.org

We also partner with Second Harvest for weekly produce distribution every Saturday.
```

---

### Step 1: Evidence Capture

```typescript
import { EvidenceSnapshotSchema } from './contracts';

const evidence: EvidenceSnapshot = {
  evidenceId: 'ev-abc123',
  canonicalUrl: 'https://stmaryspantry.org/services',
  fetchedAt: '2026-03-02T14:30:00Z',
  httpStatus: 200,
  contentType: 'text/html',
  contentHashSha256: 'a1b2c3d4e5f6...', // SHA-256 of raw content
  blobUri: 'https://oranstorage.blob.core.windows.net/evidence/ev-abc123.html',
};
```

**Why**: Immutable proof of what we saw. If data is challenged, we can verify.

---

### Step 2: Field Extraction

The agent extracts structured fields. Each field tracks **where** it came from and **how confident** we are.

```typescript
import { ExtractedCandidateSchema } from './contracts';

const candidate = {
  extractionId: 'ext-xyz789',
  candidateId: 'cand-001',
  extractKeySha256: 'hash-of-normalized-name-address',
  extractedAt: '2026-03-02T14:32:00Z',

  fields: {
    organizationName: "St. Mary's Community Food Pantry",
    serviceName: 'Emergency Food Boxes',
    description: 'Emergency food boxes for families in need. Halal boxes available with advance request.',
    websiteUrl: 'https://www.stmaryspantry.org',
    phone: '(408) 555-1234',
    phones: [
      { number: '(408) 555-1234', type: 'voice', context: 'Main line' }
    ],
    address: {
      line1: '456 Main Street',
      city: 'San Jose',
      region: 'CA',
      postalCode: '95112',
      country: 'US',
    },
    isRemoteService: false,
  },

  // PROVENANCE: Link each field to evidence
  provenance: {
    'fields.organizationName': {
      evidenceId: 'ev-abc123',
      selectorOrHint: 'h1.org-name',
      confidenceHint: 'high',  // Clear heading, unambiguous
    },
    'fields.phone': {
      evidenceId: 'ev-abc123',
      selectorOrHint: 'Contact section, formatted phone',
      confidenceHint: 'high',  // Standard phone format
    },
    'fields.address': {
      evidenceId: 'ev-abc123',
      selectorOrHint: 'Address section',
      confidenceHint: 'high',  // Structured address
    },
  },

  review: {
    status: 'pending',
    jurisdiction: {
      country: 'US',
      stateProvince: 'CA',
      countyOrRegion: 'Santa Clara',
      city: 'San Jose',
      postalCode: '95112',
      kind: 'local',
    },
  },
};
```

#### Confidence Hints for Fields

| Confidence | When to Use | Examples |
|------------|-------------|----------|
| **high** | Clear, unambiguous, well-formatted | Phone in standard format, address in dedicated section, org name in heading |
| **medium** | Likely correct but needs verification | Phone found in body text, hours mentioned casually |
| **low** | Uncertain, inferred, or conflicting info | Multiple phone numbers unclear which is primary, partial address |

---

### Step 3: Tag Extraction (LLM)

The agent calls `generateTaggingPrompt(rawText)` and receives:

```json
{
  "serviceAttributes": {
    "delivery": ["in_person", "pickup_available"],
    "cost": ["free"],
    "access": ["walk_in", "no_id_required", "first_come_first_served"],
    "culture": ["faith_based", "family_centered"],
    "population": [],
    "situation": ["no_documents"]
  },
  "adaptations": [],
  "dietary": [
    { "type": "halal", "availability": "by_request", "details": "48hr advance notice required" }
  ],
  "location": {
    "accessibility": ["wheelchair"],
    "transitAccess": ["bus_stop_nearby"],
    "parking": "yes"
  },
  "service": {
    "estimatedWaitDays": 0,
    "capacityStatus": "available"
  },
  "eligibility": {
    "householdSizeMin": null,
    "householdSizeMax": null,
    "incomePctFpl": 200,
    "ageMin": null,
    "ageMax": null
  },
  "languages": ["en", "es", "vi"],
  "confidence": 0.82,
  "warnings": ["Hours only specifies Tue/Thu - may have additional days"]
}
```

---

### Step 4: Per-Tag Confidence Scoring

The agent assigns **individual confidence scores** to each tag:

```typescript
import { createTagConfirmation } from './tagConfirmations';

const tagConfirmations = [
  // HIGH CONFIDENCE → AUTO-APPROVED
  createTagConfirmation('cand-001', 'category', 'food', 95, {
    agentReasoning: 'Explicitly says "Food Pantry" in name and description',
    evidenceRefs: ['ev-abc123'],
  }),
  // Result: { confidenceTier: 'green', confirmationStatus: 'auto_approved' }

  createTagConfirmation('cand-001', 'audience', 'family', 90, {
    agentReasoning: '"families in need" appears twice in text',
    evidenceRefs: ['ev-abc123'],
  }),
  // Result: { confidenceTier: 'green', confirmationStatus: 'auto_approved' }

  // MEDIUM CONFIDENCE → NEEDS REVIEW
  createTagConfirmation('cand-001', 'audience', 'immigrant', 65, {
    agentReasoning: 'Vietnamese language support suggests immigrant community focus, but not explicit',
    evidenceRefs: ['ev-abc123'],
  }),
  // Result: { confidenceTier: 'yellow', confirmationStatus: 'pending' }

  // LOW CONFIDENCE → NEEDS REVIEW
  createTagConfirmation('cand-001', 'audience', 'senior', 45, {
    agentReasoning: 'No explicit senior programming mentioned, but food pantries often serve seniors',
    evidenceRefs: ['ev-abc123'],
  }),
  // Result: { confidenceTier: 'orange', confirmationStatus: 'pending' }
];
```

#### Confidence Score Guidelines for Tags

| Score | Tier | UI Color | Action | When to Assign |
|-------|------|----------|--------|----------------|
| 80-100 | green | #22c55e | Auto-approve | Explicit mention, clear evidence |
| 60-79 | yellow | #eab308 | Admin review | Strongly implied, likely correct |
| 40-59 | orange | #f97316 | Admin review | Inferred from context, uncertain |
| 0-39 | red | #ef4444 | Admin review | Very uncertain, guessing |

---

### Step 5: How the Agent Decides Confidence

#### For Service Attributes (delivery, cost, access, etc.)

```typescript
function computeServiceAttributeConfidence(
  taxonomy: string,
  tag: string,
  rawText: string,
  llmConfidence: number
): { score: number; reasoning: string } {
  let score = Math.round(llmConfidence * 100);
  let reasoning = '';

  // Boost: Exact keyword match
  const tagReadable = tag.replace(/_/g, ' ');
  if (rawText.toLowerCase().includes(tagReadable)) {
    score = Math.min(100, score + 15);
    reasoning += `Exact phrase "${tagReadable}" found. `;
  }

  // Boost: Multiple mentions
  const mentionCount = (rawText.toLowerCase().match(new RegExp(tagReadable, 'g')) || []).length;
  if (mentionCount > 1) {
    score = Math.min(100, score + 5 * (mentionCount - 1));
    reasoning += `Mentioned ${mentionCount} times. `;
  }

  // Penalty: Tag inferred from adjacent signals only
  if (llmConfidence < 0.6) {
    reasoning += 'Inferred from context, not explicitly stated. ';
  }

  // Particular signal patterns
  const signalPatterns: Record<string, { pattern: RegExp; boost: number }[]> = {
    no_id_required: [
      { pattern: /no\s+(id|identification|documents?)\s+(required|needed)/i, boost: 25 },
      { pattern: /don't need (id|identification)/i, boost: 20 },
    ],
    free: [
      { pattern: /free|no cost|at no charge/i, boost: 20 },
      { pattern: /\$0|\bfree\b/i, boost: 15 },
    ],
    walk_in: [
      { pattern: /walk[- ]?in|no appointment/i, boost: 20 },
      { pattern: /just show up/i, boost: 15 },
    ],
    halal: [
      { pattern: /halal/i, boost: 25 },
    ],
    wheelchair: [
      { pattern: /wheelchair\s+accessible|ada\s+accessible/i, boost: 25 },
      { pattern: /accessible entrance/i, boost: 15 },
    ],
  };

  const patterns = signalPatterns[tag] || [];
  for (const { pattern, boost } of patterns) {
    if (pattern.test(rawText)) {
      score = Math.min(100, score + boost);
      reasoning += `Pattern "${pattern.source}" matched. `;
      break;
    }
  }

  return { score: Math.max(0, Math.min(100, score)), reasoning: reasoning.trim() };
}
```

#### For Hours Extraction

```typescript
interface ExtractedHours {
  text: string;           // Raw text: "Tuesdays and Thursdays 10am-2pm"
  structured: ScheduleSlot[] | null;
  confidence: number;
  missing: string[];      // What's unclear
}

function extractHours(rawText: string): ExtractedHours {
  // Pattern matching for structured hours
  const dayPattern = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/gi;
  const timePattern = /(\d{1,2})(:\d{2})?\s*(am|pm)?/gi;

  const days = rawText.match(dayPattern);
  const times = rawText.match(timePattern);

  if (days && times && times.length >= 2) {
    return {
      text: rawText,
      structured: parseSchedule(days, times),
      confidence: 85,
      missing: [],
    };
  }

  if (days && times?.length === 1) {
    return {
      text: rawText,
      structured: null,
      confidence: 50,
      missing: ['End time unclear'],
    };
  }

  return {
    text: rawText,
    structured: null,
    confidence: 20,
    missing: ['Days unclear', 'Times unclear'],
  };
}

// Example output for our text:
// {
//   text: "Tuesdays and Thursdays 10am-2pm",
//   structured: [
//     { day: 'tuesday', open: '10:00', close: '14:00' },
//     { day: 'thursday', open: '10:00', close: '14:00' },
//   ],
//   confidence: 90,
//   missing: ['May have additional unstated days']
// }
```

#### For Address/Location

```typescript
interface ExtractedLocation {
  address: AddressFields | null;
  coordinates: { lat: number; lng: number } | null;
  confidence: number;
  geocodeStatus: 'verified' | 'pending' | 'failed';
}

async function extractAndGeocodeLocation(rawText: string): Promise<ExtractedLocation> {
  // Extract address components
  const addressMatch = rawText.match(
    /(\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way)),?\s*([^,]+),?\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/i
  );

  if (!addressMatch) {
    return {
      address: null,
      coordinates: null,
      confidence: 10,
      geocodeStatus: 'failed',
    };
  }

  const address: AddressFields = {
    line1: addressMatch[1].trim(),
    city: addressMatch[2].trim(),
    region: addressMatch[3].toUpperCase(),
    postalCode: addressMatch[4],
    country: 'US',
  };

  // Geocode via Azure Maps
  const geocodeResult = await geocodeAddress(address);

  if (geocodeResult.success && geocodeResult.confidence > 0.8) {
    return {
      address,
      coordinates: geocodeResult.coordinates,
      confidence: 95,
      geocodeStatus: 'verified',
    };
  }

  return {
    address,
    coordinates: geocodeResult.coordinates ?? null,
    confidence: 60,
    geocodeStatus: 'pending', // Needs human verification
  };
}
```

---

### Step 6: Overall Candidate Confidence Score

The candidate's overall confidence aggregates multiple signals:

```typescript
import { computeConfidenceScore, computeScoreBreakdown } from './scoring';

const inputs = {
  hasEvidenceSnapshot: true,           // +20 points
  sourceAllowlisted: true,             // +20 points (stmaryspantry.org is .org)
  requiredFieldsPresent: true,         // +20 points (has name, address, phone)
  verificationChecks: [
    { checkType: 'domain_allowlist', severity: 'critical', status: 'pass' },    // +20
    { checkType: 'contact_validity', severity: 'warning', status: 'pass' },     // +10
    { checkType: 'location_plausibility', severity: 'warning', status: 'pass' }, // +10
    { checkType: 'hours_stability', severity: 'info', status: 'unknown' },       // +0
  ],
  checklist: [
    { key: 'contact_method', status: 'satisfied' },
    { key: 'physical_address_or_virtual', status: 'satisfied' },
    { key: 'service_area', status: 'satisfied' },
    { key: 'eligibility_criteria', status: 'satisfied' },
    { key: 'hours', status: 'satisfied' },
    { key: 'source_provenance', status: 'satisfied' },
    { key: 'duplication_review', status: 'missing' },
    { key: 'policy_pass', status: 'missing' },
  ],
};

const { score, tier, breakdown } = computeScoreBreakdown(inputs);
// score: 85
// tier: 'green'
// breakdown: [
//   { label: 'Evidence snapshot', points: 20, max: 20 },
//   { label: 'Allowlisted source', points: 20, max: 20 },
//   { label: 'Required fields', points: 20, max: 20 },
//   { label: 'Verification checks', points: 40, max: 44 },
//   { label: 'Checklist completion', points: 15, max: 20 },
// ]
```

---

### Step 7: UI Separation — Agent vs Host Tags

In the admin review UI, tags are displayed with clear provenance:

```tsx
// Simplified React component showing the concept

interface TagDisplayProps {
  tag: TagConfirmation;
  onConfirm: () => void;
  onModify: (newValue: string) => void;
  onReject: () => void;
}

function TagDisplay({ tag, onConfirm, onModify, onReject }: TagDisplayProps) {
  return (
    <div className={`tag-card tier-${tag.confidenceTier}`}>
      {/* Visual confidence indicator */}
      <div className="confidence-badge" style={{ backgroundColor: getTierColor(tag.confidenceTier) }}>
        {tag.suggestedConfidence}%
      </div>

      {/* Tag info */}
      <div className="tag-info">
        <span className="tag-type">{tag.tagType}</span>
        <span className="tag-value">{tag.suggestedValue}</span>

        {/* Source indicator */}
        <span className="source-badge">
          {tag.confirmationStatus === 'auto_approved' ? '🤖 Auto-approved' : '🤖 Agent suggestion'}
        </span>
      </div>

      {/* Agent's reasoning */}
      {tag.agentReasoning && (
        <div className="reasoning">
          <small>Why: {tag.agentReasoning}</small>
        </div>
      )}

      {/* Action buttons (only for pending) */}
      {tag.confirmationStatus === 'pending' && (
        <div className="actions">
          <button onClick={onConfirm}>✓ Confirm</button>
          <button onClick={() => onModify('')}>✏️ Modify</button>
          <button onClick={onReject}>✗ Reject</button>
        </div>
      )}
    </div>
  );
}
```

#### UI Layout Sections

```
┌─────────────────────────────────────────────────────────────────────┐
│  CANDIDATE: St. Mary's Community Food Pantry                        │
│  Overall Confidence: 85 (GREEN)                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  📋 EXTRACTED FIELDS (Agent-populated)                              │
├─────────────────────────────────────────────────────────────────────┤
│  Organization: St. Mary's Community Food Pantry        ✓ HIGH       │
│  Service: Emergency Food Boxes                         ✓ HIGH       │
│  Phone: (408) 555-1234                                ✓ HIGH       │
│  Address: 456 Main St, San Jose, CA 95112             ✓ HIGH       │
│  Hours: Tue/Thu 10am-2pm                              ⚠️ MEDIUM     │
│         [Host: Add more hours if applicable]                        │
│  Website: www.stmaryspantry.org                       ✓ HIGH       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  🤖 AGENT-SUGGESTED TAGS (Need Review)                              │
├─────────────────────────────────────────────────────────────────────┤
│  ✅ food (95%) - Auto-approved                                      │
│  ✅ family (90%) - Auto-approved                                    │
│  ⚠️ immigrant (65%) - "Vietnamese language suggests focus"          │
│     [Confirm] [Modify] [Reject]                                     │
│  ⚠️ senior (45%) - "Inferred, not explicit"                         │
│     [Confirm] [Modify] [Reject]                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  ➕ HOST TAGGING (Add your own)                                     │
├─────────────────────────────────────────────────────────────────────┤
│  The agent may have missed tags. Add any that apply:                │
│                                                                     │
│  DELIVERY: [in_person ✓] [pickup_available ✓] [+ Add more...]      │
│  COST: [free ✓] [+ Add more...]                                    │
│  ACCESS: [walk_in ✓] [no_id_required ✓] [+ Add more...]            │
│  DIETARY: [halal (by_request) ✓] [+ Add more...]                   │
│                                                                     │
│  [+ Add population tags...]                                         │
│  [+ Add situation tags...]                                          │
│  [+ Add adaptation tags...]                                         │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  ✅ FINAL DECISION                                                  │
├─────────────────────────────────────────────────────────────────────┤
│  [Approve for Publish] [Reject] [Needs More Info] [Escalate]       │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Step 8: Database Tag Attribution

When tags are saved, we track who added them:

```typescript
// service_attributes table entry
interface ServiceAttributeRow {
  id: string;
  service_id: string;
  taxonomy: 'delivery' | 'cost' | 'access' | 'culture' | 'population' | 'situation';
  tag: string;
  details: string | null;
  created_at: string;
  created_by_user_id: string | null;  // NULL = agent, UUID = human
  updated_at: string;
  updated_by_user_id: string | null;
}

// Examples:
// Agent auto-approved tag:
{ service_id: 'svc-001', taxonomy: 'cost', tag: 'free', created_by_user_id: null }

// Agent tag confirmed by human:
{ service_id: 'svc-001', taxonomy: 'population', tag: 'immigrant',
  created_by_user_id: null,
  updated_by_user_id: 'user-12345' // Admin who confirmed it
}

// Host-added tag (not from agent):
{ service_id: 'svc-001', taxonomy: 'situation', tag: 'language_barrier',
  created_by_user_id: 'user-12345' // Admin/host who added it
}
```

#### Query: "Show me agent-generated vs host-added tags"

```sql
-- Agent-generated tags
SELECT * FROM service_attributes
WHERE created_by_user_id IS NULL;

-- Host/admin-added tags
SELECT * FROM service_attributes
WHERE created_by_user_id IS NOT NULL;

-- Tags that agent suggested but human modified
SELECT * FROM service_attributes
WHERE created_by_user_id IS NULL
  AND updated_by_user_id IS NOT NULL;
```

---

## Handling Sparse Data (Narrow Information)

When the agent receives minimal information:

```
"Food bank at corner of 5th and Main, San Jose"
```

The agent should:

1. **Extract what's certain**:
   - Category: food (95%)
   - City: San Jose (90%)
   - Approximate location: intersection mention (60%)

2. **Mark many fields as MISSING**:
   ```typescript
   const checklist = [
     { key: 'contact_method', status: 'missing', missingFields: ['phone', 'email', 'website'] },
     { key: 'physical_address_or_virtual', status: 'missing', missingFields: ['street_address'] },
     { key: 'hours', status: 'missing', missingFields: ['days', 'times'] },
     { key: 'eligibility_criteria', status: 'missing' },
   ];
   ```

3. **Generate LLM suggestions for missing fields**:
   ```typescript
   import { createLlmSuggestion } from './llmSuggestions';

   createLlmSuggestion('cand-001', 'hours', 'Likely weekday business hours (9am-5pm)', 0.3, {
     promptContext: 'No hours mentioned, used general food bank patterns',
   });
   // LOW confidence (30%) — needs human to fill in or verify
   ```

4. **Compute LOW overall confidence**:
   ```
   Score: 35
   Tier: RED
   Action: Cannot publish without human adding critical fields
   ```

---

## Handling Rich Data (Abundant Information)

When the agent receives comprehensive information from a well-structured source:

```
{
  "name": "Community Health Center",
  "services": ["Primary Care", "Mental Health", "Dental"],
  "hours": {
    "monday": "8:00-18:00",
    "tuesday": "8:00-18:00",
    ...
    "saturday": "9:00-13:00"
  },
  "phone": "(555) 123-4567",
  "address": "789 Oak Ave, San Jose, CA 95112",
  "eligibility": {
    "income_limit": "200% FPL",
    "insurance": ["Medicaid", "Medicare", "Uninsured welcome"],
    "age": "All ages"
  },
  "languages": ["English", "Spanish", "Vietnamese", "Mandarin"],
  "accessibility": ["Wheelchair accessible", "ASL interpreter available"],
  "accepts_walk_ins": true,
  "sliding_scale": true
}
```

The agent should:

1. **Extract ALL available fields with HIGH confidence**:
   - Structured data = higher confidence than free text

2. **Generate MANY tags automatically**:
   ```typescript
   const autoApprovedTags = [
     { taxonomy: 'delivery', tag: 'in_person', confidence: 98 },
     { taxonomy: 'cost', tag: 'sliding_scale', confidence: 98 },
     { taxonomy: 'cost', tag: 'medicaid', confidence: 98 },
     { taxonomy: 'cost', tag: 'medicare', confidence: 98 },
     { taxonomy: 'cost', tag: 'no_insurance_required', confidence: 95 },
     { taxonomy: 'access', tag: 'walk_in', confidence: 98 },
     { taxonomy: 'access', tag: 'weekend_hours', confidence: 98 },
   ];
   ```

3. **Generate service adaptations**:
   ```typescript
   const adaptations = [
     { type: 'disability', tag: 'deaf', details: 'ASL interpreter available', confidence: 95 },
   ];
   ```

4. **Compute HIGH overall confidence**:
   ```
   Score: 95
   Tier: GREEN
   Action: Ready for publish with minimal review
   ```

---

## Training the LLM to Infer

The tagging prompt includes explicit instructions for inference:

```typescript
// In generateTaggingPrompt():

`## INFERENCE RULES

1. EXPLICIT > IMPLICIT
   - "We accept Medicaid" → tag: medicaid (95%)
   - "Low-income patients welcome" → tag: sliding_scale (70%, inferred)

2. CONSERVATIVE on populations
   - Only tag populations if SPECIFIC programming is mentioned
   - "Serves everyone" → NO population tags
   - "Women's shelter" → gender_specific_women (95%)

3. NEVER INVENT
   - If unsure, omit the tag rather than guess
   - Add warnings for things you couldn't determine

4. CONTEXT CLUES
   - Vietnamese language support + San Jose → likely immigrant community (65%)
   - Food pantry + "seniors welcome" → age_group: senior (75%)
   - "No questions asked" → no_id_required (85%), no_documentation_required (85%)

5. ANTI-PATTERNS (don't tag)
   - Generic mission statements ("serving the community") → no population tag
   - "All are welcome" → no specific population or situational tags
   - Buildings without services → don't confuse location with service
`
```

---

## Summary: The Agent's Decision Tree

```
FOR EACH FIELD / TAG:

1. Is it explicitly stated?
   YES → Confidence 85-100%
   NO  → Continue...

2. Is it strongly implied by multiple signals?
   YES → Confidence 60-84%
   NO  → Continue...

3. Is it inferrable from context/patterns?
   YES → Confidence 40-59%
   NO  → Continue...

4. Is it a reasonable guess based on category norms?
   YES → Confidence 20-39%, add to warnings
   NO  → Don't tag at all

FOR OVERALL CANDIDATE:
- GREEN (≥80): Auto-approve eligible, minimal admin review
- YELLOW (60-79): Admin review required, likely publishable
- ORANGE (40-59): Significant gaps, needs work
- RED (<40): Too incomplete, needs investigation or rejection
```

---

## Files Reference

| File | Purpose |
|------|---------|
| [contracts.ts](./contracts.ts) | Candidate, evidence, field schemas |
| [scoring.ts](./scoring.ts) | Confidence score calculation |
| [tags.ts](./tags.ts) | Tag types and validation |
| [tagConfirmations.ts](./tagConfirmations.ts) | Uncertain tag queue |
| [llmSuggestions.ts](./llmSuggestions.ts) | LLM-suggested field values |
| [adminAssignments.ts](./adminAssignments.ts) | Admin routing |
| [checklist.ts](./checklist.ts) | Verification checklist |
| [taxonomy.ts](../../domain/taxonomy.ts) | Canonical tag definitions |
| [tagging-prompt.ts](../../services/ingestion/tagging-prompt.ts) | LLM prompt generator |

---

*Last updated: 2026-03-02*
