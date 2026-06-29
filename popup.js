/**
 * FocusForces — Popup
 * Contest listing, theme cycling, and Zen Mode toggle.
 */

const PLATFORM_CONFIG = {
    CodeForces: { badge: 'CF', cls: 'cf', color: '#1976d2' },
    AtCoder: { badge: 'ATC', cls: 'atcoder', color: '#e65100' },
    LeetCode: { badge: 'LC', cls: 'leetcode', color: '#f9a825' },
    CodeChef: { badge: 'CC', cls: 'codechef', color: '#c62828' }
};

const FETCH_TIMEOUT_MS = 6000;
const GYM_TIMEOUT_MS = 35000; // Gym API payload is massive and often takes 15-30 seconds

// 15 days in milliseconds for the contest horizon filter
const CONTEST_HORIZON_MS = 15 * 24 * 60 * 60 * 1000;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Cache TTL: 2 minutes (contests don't change that often)
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_KEY = 'ff_contests_cache';

// Gym cache: 30 minutes (gym contests change rarely)
const GYM_CACHE_TTL_MS = 30 * 60 * 1000;
const GYM_CACHE_KEY = 'ff_gym_cache';

const getContestStatus = c => c.status === 'CODING' ? 'ongoing' : (c.status === 'BEFORE' ? 'upcoming' : 'other');

const formatDuration = m => {
    const t = Math.max(0, Math.round(m || 0));
    const h = Math.floor(t / 60), mm = t % 60;
    return h > 0 ? `${h}h${mm > 0 ? ` ${mm}m` : ''}` : `${mm}m`;
};

const formatDateTime = iso => {
    const d = new Date(iso);
    return isNaN(d) ? 'Unknown' : d.toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
};

const timeUntil = iso => {
    const target = new Date(iso);
    if (isNaN(target)) return null;
    const diff = target - Date.now();
    if (diff <= 0) return null;
    const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
    return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : (h > 0 ? `${h}h ${m}m` : `${m}m`);
};

/**
 * Parse AtCoder contest data from the HTML of atcoder.jp/contests.
 * The page has a <div> with id="contest-table-upcoming" containing upcoming contests.
 */
function parseAtCoderContests(html) {
    if (!html) return [];
    const contests = [];
    // Locate the upcoming contests table body — matches from the id through to closing </tbody>
    const tableMatch = html.match(/id="contest-table-upcoming"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
    if (!tableMatch) return [];
    const tbody = tableMatch[1];
    // Match each row
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tbody)) !== null) {
        const row = rowMatch[1];
        // Find all contest links; the last one is the contest name (the first is the time link)
        const allLinks = [...row.matchAll(/<a href="(\/contests\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
        if (!allLinks.length) continue;
        const lastLink = allLinks[allLinks.length - 1];
        const contestPath = lastLink[1];
        const contestName = lastLink[2].trim();
        // Extract start time from <time> element
        const timeMatch = row.match(/<time[^>]*>([^<]*)<\/time>/);
        if (!timeMatch) continue;
        const startTimeStr = timeMatch[1].trim();
        const startTime = new Date(startTimeStr.replace(' ', 'T'));
        if (Number.isNaN(startTime.getTime())) continue;
        // Extract duration from the second <td class="text-center"> (format: "01:40")
        const tdMatches = [...row.matchAll(/<td[^>]*class="text-center"[^>]*>([\s\S]*?)<\/td>/g)];
        const durationStr = tdMatches[1] ? tdMatches[1][1].trim() : '01:30';
        const [dh = 0, dm = 0] = durationStr.split(':').map(Number);
        const durationMinutes = Number.isFinite(dh) && Number.isFinite(dm) ? dh * 60 + dm : 90;
        contests.push({
            name: contestName,
            url: `https://atcoder.jp${contestPath}`,
            site: 'AtCoder',
            status: 'BEFORE',
            start_time: startTime.toISOString(),
            duration: durationMinutes
        });
    }
    return contests;
}

// ── Caching ────────────────────────────────────
async function getContestCache() {
    try {
        const { [CACHE_KEY]: stored } = await chrome.storage.local.get(CACHE_KEY);
        if (stored && Date.now() - stored.ts < CACHE_TTL_MS) return stored.data;
    } catch { /* cache miss */ }
    return null;
}

async function setContestCache(data) {
    try {
        await chrome.storage.local.set({ [CACHE_KEY]: { data, ts: Date.now() } });
    } catch { /* non-critical */ }
}

async function getGymCache() {
    try {
        const { [GYM_CACHE_KEY]: stored } = await chrome.storage.local.get(GYM_CACHE_KEY);
        if (stored && Date.now() - stored.ts < GYM_CACHE_TTL_MS) return stored.data;
    } catch { /* cache miss */ }
    return null;
}

async function setGymCache(data) {
    try {
        await chrome.storage.local.set({ [GYM_CACHE_KEY]: { data, ts: Date.now() } });
    } catch { /* non-critical */ }
}

// ── Helpers — filter + sort ────────────────────
const contestComparator = (a, b) => {
    const sa = getContestStatus(a), sb = getContestStatus(b);
    if (sa !== sb) return sa === 'ongoing' ? -1 : 1;
    const ta = new Date(a.start_time).getTime();
    const tb = new Date(b.start_time).getTime();
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return ta - tb;
};

function filterAndSort(contests) {
    const now = Date.now();
    const filtered = contests.filter(c => {
        if (getContestStatus(c) === 'ongoing') return true;
        const startMs = new Date(c.start_time).getTime();
        if (isNaN(startMs)) return false;
        return startMs - now <= CONTEST_HORIZON_MS && startMs > now;
    });
    return [...filtered].sort(contestComparator);
}

// ── Fetching — all sources (including gym) ────────
function safeFetch(input, init) {
    try {
        return fetch(input, init)
            .then(r => r.ok ? r : null)
            .catch(() => null);
    } catch {
        return Promise.resolve(null);
    }
}

function parseGymContests(data) {
    if (data?.status !== 'OK' || !Array.isArray(data.result)) return [];
    return data.result
        .filter(c => ['BEFORE', 'CODING'].includes(c.phase))
        .map(c => ({
            name: c.name,
            url: `https://codeforces.com/gym/${c.id}`,
            site: 'CodeForces',
            isGym: true,
            status: c.phase,
            start_time: new Date(c.startTimeSeconds * 1000).toISOString(),
            duration: Math.round((c.durationSeconds || 0) / 60)
        }));
}

async function fetchMainContests() {
    const [cfResp, ccResp, acResp, lcResp] = await Promise.all([
        safeFetch('https://codeforces.com/api/contest.list', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
            .then(r => r ? r.json() : null)
            .catch(() => null),
        safeFetch('https://www.codechef.com/api/list/contests/all', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
            .then(r => r ? r.json() : null)
            .catch(() => null),
        safeFetch('https://atcoder.jp/contests', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
            .then(r => r ? r.text() : null)
            .catch(() => null),
        safeFetch('https://leetcode.com/graphql', {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: '{ upcomingContests { title titleSlug startTime duration } }'
            })
        }).then(r => r ? r.json() : null).catch(() => null)
    ]);

    // Parse Codeforces regular contests
    const cfContests = cfResp?.status === 'OK' ? cfResp.result
        .filter(c => ['BEFORE', 'CODING'].includes(c.phase))
        .map(c => ({
            name: c.name,
            url: `https://codeforces.com/contest/${c.id}`,
            site: 'CodeForces',
            status: c.phase,
            start_time: new Date(c.startTimeSeconds * 1000).toISOString(),
            duration: Math.round((c.durationSeconds || 0) / 60)
        })) : [];

    // Parse CodeChef contests — validate start_time
    const parseCCDate = (dateStr) => {
        if (!dateStr || typeof dateStr !== 'string') return null;
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d.toISOString();
    };
    const ccContests = [];
    if (ccResp) {
        (ccResp.future_contests || []).forEach(c => {
            const start_time = parseCCDate(c.contest_start_date_iso);
            if (!start_time) return;
            ccContests.push({
                name: c.contest_name || 'CodeChef Contest',
                url: c.contest_code ? `https://www.codechef.com/${c.contest_code}` : null,
                site: 'CodeChef',
                status: 'BEFORE',
                start_time,
                duration: parseInt(c.contest_duration, 10) || 120
            });
        });
        (ccResp.present_contests || []).forEach(c => {
            const start_time = parseCCDate(c.contest_start_date_iso);
            if (!start_time) return;
            ccContests.push({
                name: c.contest_name || 'CodeChef Contest',
                url: c.contest_code ? `https://www.codechef.com/${c.contest_code}` : null,
                site: 'CodeChef',
                status: 'CODING',
                start_time,
                duration: parseInt(c.contest_duration, 10) || 120
            });
        });
    }

    // Parse AtCoder contests
    let acContests = [];
    try {
        acContests = parseAtCoderContests(acResp);
    } catch { /* malformed HTML – skip AtCoder */ }

    // Parse LeetCode contests — skip entries with invalid start times
    const lcContests = [];
    if (lcResp?.data?.upcomingContests) {
        lcResp.data.upcomingContests.forEach(c => {
            const start_time = c.startTime ? new Date(c.startTime * 1000).toISOString() : null;
            if (!start_time) return;
            lcContests.push({
                name: c.title || 'LeetCode Contest',
                url: c.titleSlug ? `https://leetcode.com/contest/${c.titleSlug}` : null,
                site: 'LeetCode',
                status: 'BEFORE',
                start_time,
                duration: c.duration ? Math.round(c.duration / 60) : 90
            });
        });
    }

    // Check if the primary 4 contest sources all failed
    if (!cfResp && !ccResp && !acResp && !lcResp) {
        throw new Error('Could not reach contest servers. Check your network connection.');
    }

    return filterAndSort([...cfContests, ...ccContests, ...acContests, ...lcContests]);
}

async function fetchGymContests() {
    const gymResp = await safeFetch('https://codeforces.com/api/contest.list?gym=true', { signal: AbortSignal.timeout(GYM_TIMEOUT_MS) })
        .then(r => r ? r.json() : null)
        .catch(() => null);
    return parseGymContests(gymResp);
}

// ── Theme ────────────────────────────────────
const THEME_KEY = 'ff_theme';

// Theme state: 'system' | 'light' | 'dark'
let currentTheme = 'system';

function getPreferredDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(mode) {
    currentTheme = mode;
    if (mode === 'dark') {
        document.body.classList.add('dark-mode');
    } else if (mode === 'light') {
        document.body.classList.remove('dark-mode');
    } else {
        // 'system' — follow OS preference
        document.body.classList.toggle('dark-mode', getPreferredDark());
    }
    saveTheme(mode);
    updateThemeButton(mode);
}

async function saveTheme(mode) {
    try {
        await chrome.storage.local.set({ [THEME_KEY]: mode });
    } catch { /* non-critical */ }
}

async function loadTheme() {
    try {
        const { [THEME_KEY]: saved } = await chrome.storage.local.get(THEME_KEY);
        applyTheme(saved || 'system');
    } catch {
        applyTheme('system');
    }
}

function updateThemeButton(mode) {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    // Sun icon (for light / system modes)
    const sunSvg = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>`;
    // Moon icon (for dark mode)
    const moonSvg = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>`;
    if (mode === 'system') {
        btn.innerHTML = sunSvg;
        btn.setAttribute('aria-label', 'Theme: System');
    } else if (mode === 'dark') {
        btn.innerHTML = moonSvg;
        btn.setAttribute('aria-label', 'Theme: Dark');
    } else {
        btn.innerHTML = sunSvg;
        btn.setAttribute('aria-label', 'Theme: Light');
    }
}

function cycleTheme() {
    const modes = ['system', 'light', 'dark'];
    const idx = modes.indexOf(currentTheme);
    applyTheme(modes[(idx + 1) % modes.length]);
}

// ── UI Components ───────────────────────────────
function setListMessage(list, txt) {
    const div = document.createElement('div');
    div.className = 'state-message';
    div.textContent = txt;
    list.replaceChildren(div);
}

// ── Tab state ────────────────────────────────
let activeTab = 'near'; // 'near' | 'later'
let cachedNear = [];
let cachedLater = [];

function sortByTime(items) {
    return items.slice().sort(contestComparator);
}

// ── Build a single contest card element ────────────
function createContestCard(contest) {
    if (!contest || !contest.site) return null;
    const status = getContestStatus(contest);
    const cfg = PLATFORM_CONFIG[contest.site] || { badge: contest.site, cls: 'other', color: '#616161' };
    const card = document.createElement('div');
    const isOngoing = status === 'ongoing';

    // Compute urgency for upcoming contests
    let urgencyClass = '';
    let urgencyLabel = '';
    if (!isOngoing) {
        const msUntil = new Date(contest.start_time).getTime() - Date.now();
        if (msUntil <= 60 * 60 * 1000) {            // < 1 hour
            urgencyClass = 'urgency-critical';
            urgencyLabel = '< 1h';
        } else if (msUntil <= 4 * 60 * 60 * 1000) { // < 4 hours
            urgencyClass = 'urgency-high';
            urgencyLabel = '< 4h';
        }
    }

    card.className = [
        'contest-card',
        isOngoing ? 'is-ongoing' : '',
        urgencyClass
    ].filter(Boolean).join(' ');

    // CSS classes drive color for ongoing/urgency; only inline for platform color
    if (!isOngoing && !urgencyClass) {
        card.style.borderLeftColor = cfg.color;
    }

    const name = document.createElement('div');
    name.className = 'contest-name';
    if (contest.url) {
        const a = document.createElement('a');
        a.href = contest.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = contest.name || 'Untitled';
        name.appendChild(a);
    } else {
        name.textContent = contest.name || 'Untitled';
    }

    const badges = document.createElement('div');
    badges.className = 'contest-card-badges';

    if (isOngoing) {
        const live = document.createElement('span');
        live.className = 'live-badge';
        live.textContent = 'LIVE';
        badges.appendChild(live);
    }

    const platform = document.createElement('span');
    platform.className = `platform-badge ${cfg.cls}`;
    platform.textContent = cfg.badge;
    badges.appendChild(platform);

    if (contest.isGym) {
        const gym = document.createElement('span');
        gym.className = 'gym-badge';
        gym.textContent = 'GYM';
        badges.appendChild(gym);
    }

    if (urgencyLabel) {
        const urg = document.createElement('span');
        urg.className = `urgency-badge ${urgencyClass === 'urgency-critical' ? 'critical' : 'high'}`;
        urg.textContent = urgencyLabel;
        badges.appendChild(urg);
    }

    const meta = document.createElement('div');
    meta.className = 'contest-meta';
    meta.appendChild(Object.assign(document.createElement('span'), {
        className: 'contest-time',
        textContent: `🕒 ${formatDateTime(contest.start_time)}`
    }));
    const countdown = !isOngoing ? timeUntil(contest.start_time) : null;
    meta.appendChild(Object.assign(document.createElement('span'), {
        className: isOngoing ? 'live-text' : 'contest-duration',
        textContent: isOngoing
            ? 'Running now'
            : (countdown
                ? `⏱ ${formatDuration(contest.duration)} · starts in ${countdown}`
                : `⏱ ${formatDuration(contest.duration)}`)
    }));

    card.append(name, badges, meta);
    card.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        if (contest.url) chrome.tabs.create({ url: contest.url, active: false });
    });
    return card;
}

// ── Tab bar ──────────────────────────────────
function createTabBar(nearCount, laterCount) {
    const bar = document.createElement('div');
    bar.className = 'tab-bar';

    const nearTab = document.createElement('button');
    nearTab.className = 'tab' + (activeTab === 'near' ? ' active' : '');
    nearTab.dataset.tab = 'near';
    nearTab.innerHTML = `Next 24 Hours <span class="tab-count">${nearCount}</span>`;

    const laterTab = document.createElement('button');
    laterTab.className = 'tab' + (activeTab === 'later' ? ' active' : '');
    laterTab.dataset.tab = 'later';
    laterTab.innerHTML = `All Contests <span class="tab-count">${laterCount}</span>`;

    bar.append(nearTab, laterTab);

    // Click handler
    bar.addEventListener('click', e => {
        const btn = e.target.closest('.tab');
        if (!btn || btn.classList.contains('active')) return;
        activeTab = btn.dataset.tab;
        renderCurrentTab();
    });

    return bar;
}

// ── Shared pane builder (used by both renderContests and renderCurrentTab) ─
function buildPane(items, emptyMsg) {
    const pane = document.createElement('div');
    pane.className = 'tab-pane';
    if (!items.length) {
        pane.appendChild(Object.assign(document.createElement('div'), {
            className: 'state-message',
            textContent: emptyMsg
        }));
        return pane;
    }
    let hasCards = false;
    sortByTime(items).forEach(c => {
        const card = createContestCard(c);
        if (card) { pane.appendChild(card); hasCards = true; }
    });
    if (!hasCards) {
        pane.appendChild(Object.assign(document.createElement('div'), {
            className: 'state-message',
            textContent: 'No contests to display.'
        }));
    }
    return pane;
}

// ── Render only the active tab’s content ───────────
function renderCurrentTab() {
    const list = document.getElementById('contest-list');
    const tabBar = list.querySelector('.tab-bar');
    const oldPane = list.querySelector('.tab-pane');

    if (tabBar) {
        tabBar.querySelectorAll('.tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === activeTab);
        });
    }

    const items = activeTab === 'near' ? cachedNear : cachedLater;
    const emptyMsg = activeTab === 'near' ? 'No contests in the next 24 hours.' : 'No upcoming contests.';
    const pane = buildPane(items, emptyMsg);
    if (oldPane) pane.classList.add('entering');

    if (oldPane) {
        oldPane.classList.add('exiting');
        setTimeout(() => oldPane.remove(), 250);
    }

    if (tabBar) tabBar.after(pane);
    else list.appendChild(pane);
}

// ── Contest Rendering (tabbed) ────────────────────
function renderContests(contests) {
    const list = document.getElementById('contest-list');

    if (!contests.length) {
        setListMessage(list, 'No active contests.');
        return;
    }

    const now = Date.now();
    cachedNear = [];
    cachedLater = [];

    contests.forEach(c => {
        const isOngoing = getContestStatus(c) === 'ongoing';
        const startMs = new Date(c.start_time).getTime();
        if (!isNaN(startMs) && (isOngoing || (startMs - now <= TWENTY_FOUR_HOURS_MS && startMs > now))) {
            cachedNear.push(c);
        }
        cachedLater.push(c);
    });

    const items = activeTab === 'near' ? cachedNear : cachedLater;
    const emptyMsg = activeTab === 'near' ? 'No contests in the next 24 hours.' : 'No upcoming contests.';

    const fragment = document.createDocumentFragment();
    fragment.appendChild(createTabBar(cachedNear.length, cachedLater.length));
    fragment.appendChild(buildPane(items, emptyMsg));

    list.className = 'contest-list';
    list.replaceChildren(fragment);
}

function renderError(msg) {
    const list = document.getElementById('contest-list');
    const wrapper = document.createElement('div');
    wrapper.className = 'error';
    const icon = document.createElement('div');
    icon.className = 'error-icon';
    icon.textContent = '⚠';
    const span = document.createElement('span');
    span.className = 'error-msg';
    span.textContent = msg;
    wrapper.append(icon, span);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'retry-btn';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
        // Show loading state on retry
        retry.textContent = 'Loading…';
        retry.disabled = true;
        loadContests().finally(() => {
            retry.textContent = 'Retry';
            retry.disabled = false;
        });
    });
    wrapper.appendChild(retry);
    list.replaceChildren(wrapper);
}

// ── Main ───────────────────────────────────────
let currentMain = [];
let currentGym = [];
let refreshIntervalId = null;

async function loadContests() {
    const list = document.getElementById('contest-list');

    // 1. Load cached data — show whatever we have immediately
    const [cachedMain, cachedGym] = await Promise.all([getContestCache(), getGymCache()]);
    currentMain = cachedMain || [];
    currentGym = cachedGym || [];

    if (currentMain.length || currentGym.length) {
        renderContests(sortByTime([...currentMain, ...currentGym]));
    } else {
        setListMessage(list, 'Loading…');
    }

    // 2. Fetch main contests
    fetchMainContests().then(main => {
        currentMain = main;
        setContestCache(main);
        renderContests(sortByTime([...currentMain, ...currentGym]));
    }).catch(e => {
        if (!currentMain.length && !currentGym.length) {
            const msg = !navigator.onLine
                ? 'You appear to be offline. Connect to the internet and try again.'
                : (e.message || 'Error loading contests');
            renderError(msg);
        }
    });

    // 3. Fetch gym contests concurrently
    fetchGymContests().then(gym => {
        if (gym && gym.length) {
            currentGym = gym;
            setGymCache(gym);
            renderContests(sortByTime([...currentMain, ...currentGym]));
        }
    }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', async () => {
    const zenToggle = document.getElementById('zen-toggle');
    const themeToggle = document.getElementById('theme-toggle');

    // ── Theme initialization ─────────────────────
    await loadTheme();

    // Listen for OS theme changes when in 'system' mode
    const darkModeMq = window.matchMedia('(prefers-color-scheme: dark)');
    darkModeMq.addEventListener('change', () => {
        if (currentTheme === 'system') {
            document.body.classList.toggle('dark-mode', darkModeMq.matches);
            updateThemeButton('system');
        }
    });

    themeToggle.addEventListener('click', cycleTheme);

    // ── Zen Mode ─────────────────────────────────
    const { zenMode } = await chrome.storage.local.get('zenMode');
    zenToggle.checked = !!zenMode;

    zenToggle.addEventListener('change', e => {
        const enabled = e.target.checked;
        chrome.storage.local.set({ zenMode: enabled });
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]?.url?.includes('codeforces.com')) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_ZEN', enabled })
                    .catch(() => {});
            }
        });
    });

    // ── Load contests ────────────────────────────
    await loadContests();
    refreshIntervalId = setInterval(loadContests, 60000);
});

window.addEventListener('beforeunload', () => {
    if (refreshIntervalId) clearInterval(refreshIntervalId);
});
