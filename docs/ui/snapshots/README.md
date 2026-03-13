# UI Snapshots

This directory contains visual screenshots of ORAN seeker pages captured at each canonical viewport size.

**These files are generated — do not hand-edit.**

## Generating snapshots

```bash
# Full capture (dev server must be running on :3000)
npm run dev &
node scripts/capture-ui-snapshots.mjs

# Capture a single page
node scripts/capture-ui-snapshots.mjs --page directory

# Capture a single viewport
node scripts/capture-ui-snapshots.mjs --viewport mobile-xs
```

## Structure

```
snapshots/
├── chat/
│   ├── mobile-xs.png    (360px)
│   ├── mobile-sm.png    (390px)
│   ├── mobile-lg.png    (430px)
│   ├── tablet.png       (768px)
│   ├── desktop-sm.png   (1280px)
│   └── desktop-lg.png   (1920px)
├── directory/   (same structure)
├── map/
├── service-detail/
├── saved/
├── profile/
├── notifications/
├── submit-resource/
├── report/
├── appeal/
└── invitations/
```

## CI baseline updates

```bash
npx playwright test e2e/visual/ --update-snapshots
```

See [docs/ui/SNAPSHOT_SYSTEM.md](../SNAPSHOT_SYSTEM.md) for the full guide.
