# ORAN i18n Workflow

---

## Overview

ORAN uses a file-based i18n system with JSON locale files. The translation function `t()` is available throughout the app.

---

## Locale Files Structure

```
src/
└── locales/
    ├── en.json         (default — English)
    ├── es.json         (Spanish)
    ├── zh.json         (Chinese Simplified)
    ├── ar.json         (Arabic — RTL)
    ├── vi.json         (Vietnamese)
    ├── fr.json         (French)
    └── index.ts        (locale loader)
```

---

## Translation Key Convention

Keys use dot-notation namespaced by feature area:

```
<namespace>.<component>.<key>
```

Examples:
```
chat.crisis.title
chat.crisis.emergency_number
chat.disclaimer.eligibility
chat.input.placeholder
directory.search.placeholder
directory.filters.category
service.confidence.high
service.confidence.medium
service.confidence.low
service.confidence.unverified
common.loading
common.error.generic
common.button.save
nav.chat
nav.map
nav.directory
```

---

## Core English Locale (en.json excerpt)

```json
{
  "chat": {
    "crisis": {
      "title": "It sounds like you may be in crisis. Please reach out for help immediately.",
      "emergency": "Emergency: Call 911",
      "crisis_line": "Crisis Line: Call or text 988",
      "community_line": "Community Resources: Call 211"
    },
    "disclaimer": {
      "eligibility": "Results shown are from verified records. Eligibility is determined by each service provider — ORAN does not guarantee qualification. Always confirm with the provider."
    },
    "input": {
      "placeholder": "Describe what you need help with...",
      "send": "Send"
    },
    "quota": {
      "exceeded": "You've reached the message limit for this session. Please start a new conversation."
    }
  },
  "service": {
    "confidence": {
      "high": "High confidence",
      "medium": "Medium confidence — information may have changed",
      "low": "Low confidence — please verify before visiting",
      "unverified": "Unverified record"
    },
    "eligibility_hint": "You may qualify for this service. Confirm eligibility with the provider."
  }
}
```

---

## RTL Support

For Arabic (`ar`) and other RTL languages:
- Set `<html dir="rtl" lang="ar">` via locale detection
- Tailwind CSS supports RTL with the `rtl:` variant prefix
- Use logical CSS properties (`margin-inline-start` instead of `margin-left`)
- Test with at least one RTL locale in visual regression suite

---

## Pluralization

Use ICU message format for pluralization:

```json
{
  "results_count": "{count, plural, =0 {No results found} =1 {1 result found} other {# results found}}"
}
```

The `t()` function accepts an optional `params` object for interpolation:

```typescript
t('results_count', { count: 5 }) // → "5 results found"
```

---

## Adding a New Locale

1. Copy `src/locales/en.json` to `src/locales/<locale_code>.json`
2. Translate all values (leave keys unchanged)
3. Add locale code to `SUPPORTED_LOCALES` in `src/services/i18n/i18n.ts`
4. Add locale direction to `RTL_LOCALES` if applicable
5. Test with `npm run test:i18n` (checks for missing keys vs. en.json)

---

## Locale Detection Order

1. User's saved profile preference (authenticated users)
2. `Accept-Language` HTTP header
3. Default: `en`

---

## Missing Key Behavior

- In development: throw error (surface missing translations immediately)
- In production: fall back to `en.json` value, log warning to Sentry
- Never display raw translation keys to end users
