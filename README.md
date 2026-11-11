<div align="center">

<img src="icons/icon128.png" alt="FocusForces Logo" width="96" height="96" />

# FocusForces

### *The Ultimate Competitive Programming Companion*

An ultra-refined, distraction-free browser extension built for competitive programmers across **Codeforces**, **AtCoder**, **CodeChef**, and **LeetCode**.

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-6366f1?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Firefox Add-on](https://img.shields.io/badge/Firefox%20Add--on-Official%20Store-ff7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/focusforces/)
[![Version](https://img.shields.io/badge/Version-2.1.0-emerald?style=for-the-badge)](package.json)
[![Tests Passing](https://img.shields.io/badge/Tests-237%2F237%20Passed-success?style=for-the-badge&logo=jest&logoColor=white)](tests/)
[![Code Quality](https://img.shields.io/badge/Linter-web--ext%200%20errors-blue?style=for-the-badge)](https://github.com/mozilla/web-ext)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

<br/>

[Features](#-key-features) •
[Supported Platforms](#-supported-platforms) •
[Installation](#-installation--getting-started) •
[Theme System](#-theme-system) •
[Keyboard Shortcuts](#-keyboard-shortcuts) •
[Architecture](#-architecture--codebase) •
[Development](#-development--testing)

</div>

---

## 💡 Why FocusForces?

Competitive programming requires intense focus and rapid problem comprehension. Standard contest platforms often surround problem statements with distracting community chatter, unread blogs, spoiler tags, and clunky file upload dialogs.

**FocusForces** eliminates the clutter while giving you an elite set of productivity tools: a precision focus chronometer that survives popup closes, a multi-platform contest radar with instant timezone conversion, in-place problem difficulty scouting without spoilers, full-width distraction-free Zen mode, and handcrafted dark themes that preserve iconic competitive programming rank colors.

---

## ⚡ Key Features

### ⏱️ Precision Focus Chronometer
- **Precision Dial Display:** Calibrated SVG dial with 60 engraved tick marks and 12 reinforced quarter markers.
- **Dual Timing Engines:**
  - **Countdown Mode:** Preset or custom countdown durations with danger threshold pulse (< 5 minutes).
  - **Stopwatch Mode:** Seamless elapsed time tracking with dedicated status banner and head-bead silencing.
- **Unbroken State Persistence:** Powered by `chrome.storage.local` and `chrome.alarms`—your timer keeps ticking accurately across popup closes, tab navigations, and browser restarts.
- **Smart Milestone Alarms:** Optional audio alerts at `10m`, `5m`, `1m`, and `Time's Up!`, playable through on-page audio and offscreen documents with a built-in sound test button.

### 📡 Multi-Platform Contest Radar
- **4 Platforms in 1 Feed:** Live and upcoming rounds from **Codeforces**, **AtCoder**, **CodeChef**, and **LeetCode**.
- **Modern 2-Row Cards:** Displays platform badge, real-time countdown, unclipped round titles, local start time, and duration.
- **Instant Platform Filtering:** 1-click filter pills for `All`, `CF`, `AtCoder`, `CodeChef`, and `LeetCode`.
- **Live Search:** Instant client-side search across all round titles with empty state recovery.
- **Urgency Spine Indicators:** Color-coded card spines highlight rounds starting soon or currently in progress.
- **Custom Contest Reminders:** Schedule notifications from 1 day up to 5 minutes prior to contest start.

### 🧘 Zen Mode & Floating HUD
- **Distraction-Free Problem View:** One click strips away headers, navigation bars, community stats, blog sideboxes, and footers.
- **Full-Width Canvas:** Expands problem statements to maximize readable horizontal space.
- **Persistent Tag & Scout Preservation:** Safely moves problem tags and the Scout widget into an accessible top bar without destroying DOM listeners.
- **Zen HUD Bar:** Unobtrusive top toolbar displaying active Zen status with an instant "Exit Zen" action button.

### 🕵️ Stealth Scout (Tags & Rating)
- **Anti-Spoiler Practice:** Conceal problem difficulty ratings and topic tags while practicing so you aren't biased by known algorithmic techniques.
- **On-Demand Peek:** Reveal tags or ratings with a single click when you need a nudge.
- **Dual Retrieval Engine:** Instant DOM extraction with fallback to the Codeforces REST API.

### 💻 Submitify Inline Code Editor
- **No More File Uploads:** Replaces Codeforces' legacy file upload input with an inline syntax-styled monospace editor.
- **Developer Ergonomics:** Full support for `Tab` key indentation (inserts 4 spaces instead of shifting focus) and `Ctrl+Enter` / `Cmd+Enter` form submission.
- **PyPy Language Notices:** Helpful memory and execution hints when selecting Python/PyPy runtimes.

### ✨ Ambient Companions & AC Celebration
- **Zen Paws (Cat Walk):** Optional calming animated SVG cats that gracefully walk along the bottom of the viewport with custom pause, meeting, and cursor-interaction choreography.
- **AC Celebration:** A gentle, celebratory ring of light and subtle chime whenever your submission verdict returns **Accepted (AC)**.

---

## 🎨 Theme System

FocusForces features four meticulously engineered palettes designed for long contest sessions, with full Codeforces rank color preservation:

| Theme | Aesthetic | Palette Details |
| :--- | :--- | :--- |
| **Paper Light** | Warm Editorial | Cream card surfaces (`#faf9f5`), crisp sepia borders (`#ded8ca`), and classic rank colors. |
| **Midnight Dark** | Deep Navy Slate | Dark navy background (`#0a0b10`), elevated cards (`#12141d`), and indigo accent (`#a99bff`). |
| **Ink AMOLED** | Pitch Black | Pure OLED black (`#000000`), subtle cards (`#0a0b0c`), and electric cyan accent (`#2fd6e8`). |
| **Studio Contrast** | WCAG AAA Contrast | Pure black (`#000000`), bright yellow (`#facc15`), and high-definition borders (`#555555`). |

### Codeforces Rank & Verdict Integrity
- **Handle Ranks Preserved:** User handles retain their iconic rank hues (`.user-legendary`, `.user-red`, `.user-orange`, `.user-violet`, `.user-blue`, `.user-cyan`, `.user-green`, `.user-gray`).
- **Legendary GM First-Letter Fix:** Restores the white first letter on dark themes (eliminating the classic black-on-black bug).
- **Legible Verdicts:** TLE and MLE verdicts render in accessible sky blue (`#93c5fd`), eliminating invisible navy text on dark surfaces.
- **Clean Sample Tests:** Sample test titles feature flexbox spacing with dedicated right-aligned "Copy" buttons.

---

## 🌐 Supported Platforms

| Platform | Theme Integration | Contest Radar | Zen Mode | Scout Card | Submitify |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Codeforces** | ✅ Full | ✅ Live | ✅ Native | ✅ Full | ✅ Full |
| **AtCoder** | ✅ Full | ✅ Live | ✅ Compatible | — | — |
| **CodeChef** | ✅ Full | ✅ Live | ✅ Compatible | — | — |
| **LeetCode** | — | ✅ Live | — | — | — |

---

## 🚀 Installation & Getting Started

### Chrome, Brave, Edge & Chromium Browsers
1. Clone or download this repository:
   ```bash
   git clone https://github.com/ahsanjust/cf-focusforces.git
   cd cf-focusforces
   ```
2. Open your browser and navigate to the Extensions page:
   - Chrome / Brave: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. Toggle on **Developer mode** (top right switch).
4. Click **Load unpacked** and select the `cf-focusforces` project root folder.
5. Pin the **FocusForces** icon to your toolbar for quick access.

### 🦊 Mozilla Firefox
- **Official Store (Recommended):** Install directly from Mozilla with automatic updates:
  👉 **[Add to Firefox (addons.mozilla.org)](https://addons.mozilla.org/en-US/firefox/addon/focusforces/)**
- **From Source (Developer):**
  1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
  2. Click **Load Temporary Add-on...**
  3. Select the `manifest.json` file inside the cloned `cf-focusforces` folder.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| `Tab` | Submitify Codearea | Inserts 4 spaces for clean indentation |
| `Ctrl + Enter` / `Cmd + Enter` | Submitify Codearea | Instantly submits the solution |
| `Click Outside` | Live Search | Clears and collapses active contest filters |

---

## 🏗️ Architecture & Codebase

The extension is architected according to **Chrome Manifest V3** and **Firefox WebExtension** standards with zero third-party runtime frameworks for maximum performance and security:

```text
cf-focusforces/
├── manifest.json            # Extension configuration (MV3 permissions, CSP, content scripts)
├── background.js            # Background service worker (alarms, notifications, audio routing)
├── popup.html               # Popup interface (Chronometer, Radar, Settings tabs)
├── popup.js                 # Popup state management, DOM rendering & event handlers
├── popup.css                # Scoped theme tokens, responsive layouts, micro-animations
├── content.js               # Content script (Zen mode DOM manager, Scout engine, theme sync)
├── content.css              # Content script styles (Zen layout, Scout card, HUD bar)
├── cf-theme.css             # Codeforces dark/amoled/contrast CSS overrides
├── atcoder-theme.css        # AtCoder theme stylesheets
├── codechef-theme.css       # CodeChef theme stylesheets
├── submitify.js             # Inline code submission controller
├── catwalk.js               # Zen Paws companion animation loop (Shadow DOM)
├── catwalk-utils.js         # Pure mathematical utilities for companion movement
├── accelebrate.js           # AC Celebration burst controller (Shadow DOM)
├── ac-utils.js              # Pure verdict parsing and particle math utilities
├── timer-utils.js           # Pure timer state machine & alarm calculation engine
├── contest-utils.js         # Contest data transformation, sorting & filtering logic
├── offscreen.html / .js     # Dedicated audio playback document for cross-page sound alerts
├── tests/                   # Jest unit test suites for all utility modules
├── assets/notify.wav        # Audio notification chime
└── icons/                   # High-DPI application icons (16, 48, 128px)
```

---

## 🧪 Development & Testing

FocusForces maintains a test suite covering timer state transitions, milestone alarms, contest formatting, and animation physics:

```bash
# Install dependencies
npm install

# Run Jest unit test suite (237 tests)
npm test

# Run tests in watch mode
npm run test:watch

# Run Mozilla web-ext linter for manifest and security checks
npm run lint

# Build production ZIP package
npm run build
```

---

## 🛡️ Privacy & Permissions

FocusForces values your privacy:
- **No Personal Data Collected:** FocusForces does not track your browsing history or transmit your credentials.
- **Local Storage Only:** All settings, timer states, and cached contest schedules are stored strictly in `chrome.storage.local` on your machine.
- **Open Source:** Every line of code is inspectable in this repository.

---

## 🤝 Contributing

Contributions, feature suggestions, and bug reports are warmly welcome!
1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feat/AmazingFeature`).
3. Commit your Changes (`git commit -m 'feat: add some AmazingFeature'`).
4. Ensure all tests and linting pass (`npm test && npm run lint`).
5. Push to the Branch (`git push origin feat/AmazingFeature`).
6. Open a Pull Request.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more details.

Developed with ❤️ by [Ahsanul Haque](https://github.com/ahsanjust).
