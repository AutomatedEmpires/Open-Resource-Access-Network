# ORAN i18n Workflow

---

## Implementation Status (Truth Contract)

This doc describes the **implemented** behavior. Follows docs/SSOT.md for conflicts.

Implemented:
- File-based JSON locale bundles under `src/locales/{en,es,zh,ar,vi,fr}.json`.
- `t()` supports dot-notation keys and `{param}` interpolation.
- RTL detection helper via `isRTL()`.
- Server-side locale resolution in `src/lib/locale.ts` (cookie → Accept-Language → default).
- `<html lang={locale} dir={dir}>` set in `src/app/layout.tsx` from resolved locale.
- Locale-bound translator via `createTranslator(locale)`.
- Missing key behavior: throws in `NODE_ENV=development`, otherwise returns the key.
- Non-English locale files contain English fallback strings — ready for translator hand-off.

Planned (not yet implemented):
- Missing-key reporting integrated with telemetry (no PII).
- Actual translated string bundles for es / zh / ar / vi / fr (translator hand-off pending).

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

## `<html lang>` Attribute Policy (Phase 8 Resolution)

**Implementation (Phase 8):** `src/app/layout.tsx` calls `resolveLocale()` from
`src/lib/locale.ts` at render time — an async Server Component — and passes the
resolved locale to `<html lang={locale} dir={dir}>`.

`resolveLocale()` reads, in order:
1. `NEXT_LOCALE` cookie (set when user saves language preference in `/profile`)
2. `Accept-Language` request header (best-match against `SUPPORTED_LOCALES`)
3. Falls back to `DEFAULT_LOCALE` ('en')

RTL locales (`ar`) additionally set `dir="rtl"` on `<html>`, enabling Tailwind's
`rtl:` variant prefix for layout mirroring.

**Historical context:** A previous client-side `updateHtmlLang()` was removed
(TASK-17) because setting `lang="es"` while all UI strings were still in English
produces incorrect screen-reader speech output. The current resolved approach
only changes the locale attribute when a locale-specific bundle is active.
Since non-English bundles currently fall back to English strings, `lang="en"` is
effectively the runtime value until actual translated bundles are deployed.
