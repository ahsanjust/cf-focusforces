# FocusForces

A professional Chrome extension for competitive programmers featuring a universal timer, contest tracker, distraction-free mode, and multiple themes.

## Architecture

```
FocusForces/
├── manifest.json        # Extension manifest (MV3)
├── background.js        # Service worker: alarms, notifications, timer monitoring, badge
├── popup.html           # Popup UI entry point
├── popup.js             # Popup logic: timer, theme, contests, settings
├── popup.css            # Popup styles with full theme system
├── content.js           # Content script: Zen Mode, Scout, Theme Sync
├── content.css          # Content script styles (theme-aware, Zen layout)
├── timer-utils.js       # Pure timer state machine + alarm scheduling (shared & tested)
├── contest-utils.js     # Pure contest helpers + shared constants (shared & tested)
├── catwalk-utils.js     # Pure Zen Paws logic: cat movement, meetings, paw prints (shared & tested)
├── catwalk.js           # Zen Paws overlay: Shadow DOM, SVG cats, rAF animation loop
├── ac-utils.js          # Pure AC Celebration logic: URL parsing, dedup, burst geometry (shared & tested)
├── accelebrate.js       # AC Celebration overlay: verdict watcher, Shadow DOM burst, soft chime
├── submitify.js         # Inline code submission helper (Codeforces)
├── offscreen.html       # Offscreen audio document (plays sounds on any page)
├── offscreen.js         # Offscreen audio logic
├── assets/
│   └── notify.wav       # Timer notification sound
├── icons/               # Extension icons
├── tests/               # Jest unit tests for the pure utility modules
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
- **4 professional themes**: Default, Dark, AMOLED, High Contrast
- Smooth theme switching via dot picker in popup (keyboard-navigable)
- Persistent theme selection across sessions
- Theme syncs to Codeforces/AtCoder/CodeChef pages and the Scout card
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
- **Customizable reminder intervals**: 1 day, 12 hours, 5 hours, 2 hours, 1 hour, 30 minutes, 10 minutes, 5 minutes before contests
- Multi-platform support: Codeforces, CodeChef, AtCoder, LeetCode
- Prevents duplicate notifications via storage flags
- Notifications auto-dismiss after 5 seconds
- Reliable scheduling via chrome.alarms (survives browser restart)

### Timer Notifications
- **10 / 5 / 1 Minute Left** + **Time's Up!** — each milestone is independently toggleable via chips in the popup
- Master on/off switch for all timer notifications
- Auto-dismiss after 8 seconds (no manual dismissal needed)
- Background alarms ensure notifications fire even if popup is closed
- Sound plays on the active page, with an offscreen-audio fallback for non-supported sites
- Finish notification is guaranteed exactly-once (popup-vs-alarm race proof)

### Zen Mode
- Hides distractions (header, nav bar, community stats, news, footer, sidebar)
- Full-width problem statement for distraction-free solving
- Preserves the Scout card and Problem Tags by moving them into a toolbar above the statement
- Toggle synced via `chrome.storage.local`

### Zen Paws (Cat Walk)
- Small, viewport-scaled SVG cats roam the bottom of the page for a calm, enchanting vibe
- Cat density scales with screen width (2–5 cats); cats are 34–84px tall and never block content (`pointer-events: none` overlay)
- Cats pause to rest, blink, leave fading paw prints, and float dust-motes drift upward
- **Meeting choreography**: when two cats cross paths they stop, face each other, hop, share a `meow~` / `♥` bubble, then pass on (per-pair cooldown prevents repeat greetings)
- **Cursor awareness**: a cat near your mouse sits and watches you, occasionally meowing
- Shadow-DOM overlay isolates the animation from the host page's CSS (and vice versa)
- Single `requestAnimationFrame` loop with delta-time; all movement via GPU-composited `transform: translate3d`; loop pauses when the tab is hidden
- Respects `prefers-reduced-motion` (feature stays off); pure logic in `catwalk-utils.js` is unit-tested
- Toggle synced via `chrome.storage.local` (`ff_zenPaws`)

### AC Celebration
- A calm, tasteful burst of light when a Codeforces submission is Accepted — a soft expanding ring, a gentle "Accepted" pill, and a few glowing sparks that drift outward and fade (plus a quiet chime)
- Detects Accepted verdicts via DOM observation (covers live/AJAX updates) and an initial scan (covers the classic submit-then-reload flow)
- Problem-scoped dedup persisted in `chrome.storage.local`, so a post-submit page reload never re-fires and old solved problems don't spam you on revisit
- Shadow-DOM overlay, `pointer-events: none`, pure CSS transform/opacity animations; respects `prefers-reduced-motion`
- Pure logic in `ac-utils.js` is unit-tested; toggle synced via `chrome.storage.local` (`ff_acCelebrate`)

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
