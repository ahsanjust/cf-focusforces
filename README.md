# FocusForces

A professional Chrome extension for Codeforces competitive programmers featuring stealth tags, precision timer, and Zen Mode.

## Architecture

```
Extensions/
├── FocusForces/        # Extension (loaded into Chrome)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── timer-utils.js
│   ├── content.css
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── FocusForces-tests/  # Jest unit tests (sibling so the extension
                       # folder has no `_`-prefixed entries, which
                       # Chrome's loader refuses to package)
    └── timer-notification.test.js
```

## Development

```bash
cd FocusForces
npm test          # Run unit tests (reads ../FocusForces-tests)
npm run test:watch # Watch mode
```

## Features

### Zen Mode
- Hides distractions (`.community-stats-box`, `.news-item`, etc.)
- Preserves FocusForces components (`ff timer`, `ff scout`, `problem tags`)
- Toggle synced via `chrome.storage.local`

### Tag Toggler
- Extracts problem tags/rating from DOM or falls back to CF API
- Caches API response for performance
- Buttons toggle visibility of topics/rating

### Precision Timer
- Persistent state via `localStorage`
- Recovers running timers on page load
- Desktop notifications at 10m/5m warning and completion
- Zen Mode compatible
- Logic shared with `timer-utils.js` (single source of truth, fully tested)

### Contest Notifications
- Checks for upcoming contests every 30 minutes
- Notifies when contest starts in ~2h 15m
- "Open Codeforces" button navigates to contest page