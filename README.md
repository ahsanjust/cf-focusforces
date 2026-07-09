# FocusForces

A professional Chrome extension for competitive programmers featuring a universal timer, contest tracker, distraction-free mode, and multiple themes.

## Architecture

```
FocusForces/
├── manifest.json        # Extension manifest (MV3)
├── background.js        # Service worker: alarms, notifications, timer monitoring
├── popup.html           # Popup UI entry point
├── popup.js             # Popup logic: timer, theme, contests, settings
├── popup.css            # Popup styles with full theme system
├── content.js           # Content script: Zen Mode, Scout, sidebar Timer
├── content.css          # Content script styles (theme-aware)
├── timer-utils.js       # Pure timer state machine (shared with tests)
├── submitify.js         # Inline code submission helper
├── assets/
│   └── notify.wav       # Timer notification sound
├── icons/               # Extension icons
├── jest.config.js       # Test configuration
└── package.json         # Project metadata
```

## Development

```bash
npm test          # Run unit tests
npm run test:watch # Watch mode
```

## Features

### Theme System
- **6 professional themes**: Light, Dark, AMOLED, Blue, Minimal, High Contrast
- Smooth theme switching via dot picker in popup
- Persistent theme selection across sessions
- Theme syncs to Codeforces sidebar cards (Timer + Scout)
- CSS custom property architecture for clean, maintainable theming

### Universal Focus Timer
- **Countdown mode**: Set custom duration, counts down to zero
- **Stopwatch mode**: Count up from zero for elapsed time tracking
- Start / Pause / Resume / Reset controls
- Timer persists in `chrome.storage.local` — survives popup close and browser restart
- Background service worker monitors timer via alarms for reliable notifications
- Content script sidebar timer on Codeforces problem pages stays in sync
- Danger state (red pulsing) when under 5 minutes remain
- Milestone notifications: 10min, 5min, 1min before end, and Time's Up!

### Contest Tracker
- Aggregates contests from **Codeforces**, **CodeChef**, **AtCoder**, and **LeetCode**
- Tabbed view: "Next 24 Hours" and "All Contests"
- Live contest badges with pulsing indicator
- Urgency badges (< 1h critical, < 4h high)
- 2-minute cache for main contests, 30-minute cache for gym contests
- Click any contest card to open in a new tab

### Contest Reminders
- Configurable on/off toggle in popup
- **Customizable reminder intervals**: 1 day, 1 hour, 30 minutes, 10 minutes, 5 minutes before contests
- Multi-platform support: Codeforces, CodeChef, AtCoder, LeetCode
- Prevents duplicate notifications via storage flags
- Notifications auto-dismiss after 5 seconds
- Reliable scheduling via chrome.alarms (survives browser restart)

### Timer Notifications
- **10 Minutes Left** / **5 Minutes Left** / **1 Minute Left** / **Time's Up!**
- Auto-dismiss after 5 seconds (no manual dismissal needed)
- Background alarms ensure notifications fire even if popup is closed
- Sound notification with WAV file + Web Audio API fallback

### Zen Mode
- Hides distractions (community stats, news, footer, non-essential sidebar)
- Preserves FocusForces components (Timer, Scout, Problem Tags)
- Toggle synced via `chrome.storage.local`

### Scout (Tag Toggler)
- Extracts problem tags and rating from DOM or Codeforces API
- Two-step API strategy: fast `contest.standings` then fallback `problemset.problems`
- Toggle visibility of topics and rating independently
- Caches API response for performance
- Handles gym, contest, problemset, and group URLs

### Inline Submit (Submitify)
- Replaces file upload with a textarea for direct code submission
- Opens submissions in a new tab
- PyPy performance notice for applicable languages
