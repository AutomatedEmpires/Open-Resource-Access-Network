# ORAN i18n Workflow

---

## Implementation Status (Truth Contract)

This doc describes both **Implemented** and **Planned** behavior. When it conflicts with executable behavior, follow docs/SSOT.md.

Implemented today:
- In-code English translation dictionary and helpers in `src/services/i18n/i18n.ts`.
- `t()` supports dot-notation keys and `{param}` interpolation.
- RTL detection helper via `isRTL()`.
- Missing key behavior: throws in `NODE_ENV=development`, otherwise returns the key.

Planned:
- File-based JSON locale bundles (e.g., `src/locales/en.json`) and a locale loader.
- Locale detection (profile preference → `Accept-Language` → default).
- Missing-key reporting integrated with telemetry (no PII).

---

## Translation Key Convention

Keys use dot-notation namespaced by feature area:

```
<namespace>.<component>.<key>
```

Examples:
```
chat.crisis.title
chat.crisis.emergency
chat.disclaimer.eligibility
chat.input.placeholder
chat.input.send
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

## RTL Support

For Arabic (`ar`) and other RTL languages:
- Set `<html dir="rtl" lang="ar">` via locale detection
- Tailwind CSS supports RTL with the `rtl:` variant prefix
- Use logical CSS properties (`margin-inline-start` instead of `margin-left`)
- Test with at least one RTL locale in UI reviews


## Missing Key Behavior

- In development: throw error (surface missing translations immediately).
- In non-development environments: return the key as a fallback so the UI does not break.

Note: “never display raw translation keys to end users” is a **design goal**, but is not currently enforced.
---

## `<html lang>` Attribute Policy (Decision Record — TASK-17)

**Decision (Option C — remove premature mutation):** The `updateHtmlLang()` function that
directly mutated `document.documentElement.lang` has been removed from
`src/app/(seeker)/profile/ProfilePageClient.tsx`.

**Rationale:** Setting `lang="es"` on `<html>` while all UI text is still rendered in
English is *worse* for screen readers than leaving it at the default `lang="en"` — the
browser will apply a Spanish pronunciation engine to English words, producing incorrect
speech output. The lang attribute must only change when the actual translated strings are
served.

**Path to correct implementation:**
1. Adopt `next-intl` or similar and serve locale-specific string bundles.
2. Set `<html lang={locale}>` in `src/app/layout.tsx` at render time based on the resolved
   locale — not via `document.documentElement.lang` mutation in a client component.
3. RTL locales additionally need `dir="rtl"`.

Until translated string bundles are available, the `<html lang>` attribute remains `en`.
