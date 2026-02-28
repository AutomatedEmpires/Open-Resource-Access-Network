## Summary (What / Why)

## Safety-critical checklist
- [ ] No invented services/data; all facts originate from DB records or approved constants (911/988/211)
- [ ] Crisis routing unaffected OR updated with a spec and tested
- [ ] Confidence messaging unchanged OR updated per spec

## Scoring Contract
- [ ] If scoring is touched: preserve the 3-score model and final weight formula (0.45/0.40/0.15), unless approved in a spec + ADR

## Testing
- [ ] Unit tests added/updated
- [ ] DB/migration tested (if applicable)
- [ ] CI green (lint/typecheck/tests/build)

## Accessibility
- [ ] Keyboard navigation verified
- [ ] ARIA labels checked / screen-reader sanity pass
- [ ] Respects prefers-reduced-motion where relevant

## Observability
- [ ] Sentry/logging considered (errors, critical paths)

## Screenshots (UI changes)

## Docs updated (if behavior changed)
