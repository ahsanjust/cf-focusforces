/**
 * FocusForces — Background Service Worker
 * Contest notifications, timer alarms, and notification lifecycle.
 */

// ══════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════

const CONTEST_CHECK_INTERVAL = 30;
const CONTEST_WINDOW_MARGIN = 15 * 60;
const CONTEST_FETCH_TIMEOUT_MS = 10000;
const NOTIFICATION_AUTO_DISMISS_MS = 20000;
const TIMER_STORAGE_KEY = 'ff_timer_state';
const DEFAULT_REMINDER_INTERVALS = [86400, 43200, 18000, 7200, 3600, 1800, 600, 300];

const ICON_URL = chrome.runtime.getURL('icons/icon128.png');

// ── Timer Icon Badge ──────────────────────────────────
const BADGE_COLOR_NORMAL = [124, 58, 237, 255];   // purple (#7c3aed)
const BADGE_COLOR_DANGER = [239, 68, 68, 255];     // red (#ef4444)

function formatBadgeTime(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    if (totalSec <= 0) return '';

    if (totalSec >= 3600) {
        const h = Math.floor(totalSec / 3600);
        return h > 99 ? '99+h' : `${h}h`;
    }
    if (totalSec >= 60) {
        const m = Math.floor(totalSec / 60);
        return m > 99 ? '99m' : `${m}m`;
    }
    return `${totalSec}s`;
}

async function updateTimerBadge() {
    try {
        const { [TIMER_STORAGE_KEY]: state } = await chrome.storage.local.get(TIMER_STORAGE_KEY);
        if (!state || state.status !== 'RUNNING') {
            chrome.action.setBadgeText({ text: '' });
            stopBadgeUpdateInterval();
            return;
        }

        if (state.mode === 'countdown') {
            const msLeft = Math.max(0, state.endTime - Date.now());
            if (msLeft <= 0) {
                chrome.action.setBadgeText({ text: '' });
                stopBadgeUpdateInterval();
                return;
            }
            const text = formatBadgeTime(msLeft);
            chrome.action.setBadgeText({ text });
            chrome.action.setBadgeBackgroundColor({
                color: msLeft <= 300000 ? BADGE_COLOR_DANGER : BADGE_COLOR_NORMAL
            });
        } else {
            // Stopwatch: show elapsed time
            const elapsed = state.elapsed + (Date.now() - state.lastStarted);
            const text = formatBadgeTime(elapsed);
            chrome.action.setBadgeText({ text });
            chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_NORMAL });
        }

        if (badgeUpdateInterval === null) {
            badgeUpdateInterval = setInterval(updateTimerBadge, 1000);
        }
    } catch {
        chrome.action.setBadgeText({ text: '' });
    }
}

function stopBadgeUpdates() {
    chrome.action.setBadgeText({ text: '' });
}

let badgeUpdateInterval = null;

function stopBadgeUpdateInterval() {
    if (badgeUpdateInterval !== null) {
        clearInterval(badgeUpdateInterval);
        badgeUpdateInterval = null;
    }
}

let inflightCheck = null;

// ══════════════════════════════════════════════════════
// ALARM SETUP
// ══════════════════════════════════════════════════════

function setupAlarms() {
    chrome.alarms.create('checkContests', { periodInMinutes: CONTEST_CHECK_INTERVAL });
    chrome.alarms.create('pruneStaleKeys', { periodInMinutes: 1440 });
}

chrome.runtime.onStartup.addListener(async () => {
    setupAlarms();
    await Promise.allSettled([
        checkUpcomingContests(),
        pruneStaleKeys(),
        recoverTimerAlarms()
    ]);
});

chrome.runtime.onInstalled.addListener(async () => {
    setupAlarms();
    await Promise.allSettled([
        checkUpcomingContests(),
        pruneStaleKeys(),
        recoverTimerAlarms()
    ]);
});

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'checkContests') {
        checkUpcomingContests();
    } else if (alarm.name.startsWith('timer_')) {
        handleTimerAlarm(alarm.name);
        updateTimerBadge();
    } else if (alarm.name.startsWith('dismiss_')) {
        const notificationId = alarm.name.slice('dismiss_'.length);
        chrome.notifications.clear(notificationId).catch(() => {});
    } else if (alarm.name === 'pruneStaleKeys') {
        pruneStaleKeys();
    }
});

// ══════════════════════════════════════════════════════
// CONTEST NOTIFICATIONS
// ══════════════════════════════════════════════════════

async function checkUpcomingContests() {
    if (inflightCheck) return inflightCheck;

    inflightCheck = (async () => {
        try {
            const { ff_reminders_enabled, ff_reminder_intervals } = await chrome.storage.local.get({
                ff_reminders_enabled: true,
                ff_reminder_intervals: DEFAULT_REMINDER_INTERVALS
            });
            if (ff_reminders_enabled === false) return;

            const intervals = Array.isArray(ff_reminder_intervals) && ff_reminder_intervals.length
                ? ff_reminder_intervals
                : DEFAULT_REMINDER_INTERVALS;

            const contests = await fetchContestsForNotifications(intervals);
            if (!contests.length) return;

            const keys = contests.map(c => `notified_${c.site}_${c.id}_${c.triggeredInterval}`);
            const stored = await chrome.storage.local.get(keys);
            const toNotify = contests.filter(c => !stored[`notified_${c.site}_${c.id}_${c.triggeredInterval}`]);

            for (const contest of toNotify) {
                try {
                    await sendContestNotification(contest);
                    if (contest.url) {
                        await chrome.storage.local.set({
                            [`notified_${contest.site}_${contest.id}_${contest.triggeredInterval}`]: Date.now()
                        });
                    }
                } catch (e) {
                    console.warn('Failed to notify contest:', contest.site, contest.id, e);
                }
            }
        } catch (e) {
            console.error('Contest check failed:', e);
        } finally {
            inflightCheck = null;
        }
    })();

    return inflightCheck;
}

async function fetchContestsForNotifications(intervals) {
    const now = Math.floor(Date.now() / 1000);

    const results = await Promise.allSettled([
        (async () => {
            const cfResp = await fetch('https://codeforces.com/api/contest.list', {
                signal: AbortSignal.timeout(CONTEST_FETCH_TIMEOUT_MS)
            }).then(r => r.ok ? r.json() : null).catch(() => null);

            if (cfResp?.status !== 'OK' || !Array.isArray(cfResp.result)) return [];
            return cfResp.result.filter(c => c.phase === 'BEFORE').reduce((acc, c) => {
                const until = c.startTimeSeconds - now;
                if (until < 0) return acc;
                const triggeredInterval = intervals.find(i => Math.abs(until - i) <= CONTEST_WINDOW_MARGIN);
                if (triggeredInterval !== undefined) {
                    acc.push({
                        id: c.id,
                        site: 'CodeForces',
                        name: c.name,
                        url: `https://codeforces.com/contest/${c.id}`,
                        start_time: c.startTimeSeconds * 1000,
                        startTimeSeconds: c.startTimeSeconds,
                        triggeredInterval
                    });
                }
                return acc;
            }, []);
        })(),

        (async () => {
            const ccResp = await fetch('https://www.codechef.com/api/list/contests/all', {
                signal: AbortSignal.timeout(CONTEST_FETCH_TIMEOUT_MS)
            }).then(r => r.ok ? r.json() : null).catch(() => null);

            if (!ccResp) return [];
            const parseDate = (dateStr) => {
                if (!dateStr) return null;
                const d = new Date(dateStr);
                return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
            };
            const future = Array.isArray(ccResp.future_contests) ? ccResp.future_contests : [];
            const present = Array.isArray(ccResp.present_contests) ? ccResp.present_contests : [];
            return [...future, ...present].reduce((acc, c) => {
                const startTimeSec = parseDate(c.contest_start_date_iso);
                if (!startTimeSec) return acc;
                const until = startTimeSec - now;
                if (until < 0) return acc;
                const triggeredInterval = intervals.find(i => Math.abs(until - i) <= CONTEST_WINDOW_MARGIN);
                if (triggeredInterval !== undefined) {
                    acc.push({
                        id: c.contest_code || `cc_${startTimeSec}_${(c.contest_name || 'unknown').replace(/\s+/g, '_')}`,
                        site: 'CodeChef',
                        name: c.contest_name || 'CodeChef Contest',
                        url: c.contest_code ? `https://www.codechef.com/${c.contest_code}` : 'https://www.codechef.com/contests',
                        start_time: startTimeSec * 1000,
                        startTimeSeconds: startTimeSec,
                        triggeredInterval
                    });
                }
                return acc;
            }, []);
        })(),

        (async () => {
            const acResp = await fetch('https://atcoder.jp/contests', {
                signal: AbortSignal.timeout(CONTEST_FETCH_TIMEOUT_MS)
            }).then(r => r.ok ? r.text() : null).catch(() => null);

            if (!acResp) return [];
            const tableMatch = acResp.match(/<div id="contest-table-upcoming".*?<tbody>(.*?)<\/tbody>/s);
            if (!tableMatch) return [];
            const contests = [];
            const rowRegex = /<tr>(.*?)<\/tr>/gs;
            let rowMatch;
            while ((rowMatch = rowRegex.exec(tableMatch[1])) !== null) {
                const rowHtml = rowMatch[1];
                const hrefMatch = rowHtml.match(/<a[^>]+href="(\/contests\/[^"]+)"[^>]*>([^<]*)<\/a>/);
                const timeMatch = rowHtml.match(/<time[^>]*>([^<]*)<\/time>/);
                if (!hrefMatch || !timeMatch) continue;
                const href = hrefMatch[1];
                const name = hrefMatch[2].trim();
                if (!href || !name) continue;
                const startTimeSec = Math.floor(new Date(timeMatch[1]).getTime() / 1000);
                if (Number.isNaN(startTimeSec)) continue;
                const until = startTimeSec - now;
                if (until < 0) continue;
                const triggeredInterval = intervals.find(i => Math.abs(until - i) <= CONTEST_WINDOW_MARGIN);
                if (triggeredInterval !== undefined) {
                    contests.push({
                        id: href.split('/').pop(),
                        site: 'AtCoder',
                        name,
                        url: `https://atcoder.jp${href}`,
                        start_time: startTimeSec * 1000,
                        startTimeSeconds: startTimeSec,
                        triggeredInterval
                    });
                }
            }
            return contests;
        })(),

        (async () => {
            const lcResp = await fetch('https://leetcode.com/graphql', {
                signal: AbortSignal.timeout(CONTEST_FETCH_TIMEOUT_MS),
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: '{ upcomingContests { title titleSlug startTime duration } }' })
            }).then(r => r.ok ? r.json() : null).catch(() => null);

            if (!lcResp?.data?.upcomingContests) return [];
            return lcResp.data.upcomingContests.reduce((acc, c) => {
                let startTimeSec = c.startTime;
                if (!startTimeSec) return acc;
                if (startTimeSec > 1e12) startTimeSec = Math.floor(startTimeSec / 1000);
                const until = startTimeSec - now;
                if (until < 0) return acc;
                const triggeredInterval = intervals.find(i => Math.abs(until - i) <= CONTEST_WINDOW_MARGIN);
                if (triggeredInterval !== undefined) {
                    acc.push({
                        id: c.titleSlug || c.title,
                        site: 'LeetCode',
                        name: c.title || 'LeetCode Contest',
                        url: c.titleSlug ? `https://leetcode.com/contest/${c.titleSlug}` : null,
                        start_time: startTimeSec * 1000,
                        startTimeSeconds: startTimeSec,
                        triggeredInterval
                    });
                }
                return acc;
            }, []);
        })(),
    ]);

    const allContests = [];
    for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            allContests.push(...r.value);
        }
    }
    return allContests;
}

function sendContestNotification(contest) {
    if (!contest.url) return Promise.resolve();
    const time = new Date(contest.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const rawMinutes = contest.startTimeSeconds
        ? (contest.startTimeSeconds - Math.floor(Date.now() / 1000)) / 60
        : null;
    const until = rawMinutes !== null ? Math.max(0, Math.round(rawMinutes)) : null;
    const timeStr = until !== null
        ? (until >= 60 ? `${Math.floor(until / 60)}h ${until % 60}m` : `${until}m`)
        : 'soon';

    return new Promise(resolve => {
        const notificationId = `contest_${contest.site}_${contest.id}_${contest.triggeredInterval}`;
        chrome.notifications.clear(notificationId).catch(() => {}).then(() => {
            chrome.notifications.create(notificationId, {
                type: 'basic',
                iconUrl: ICON_URL,
                title: `🚀 Upcoming ${contest.site} Contest`,
                message: `${contest.name}\nStarts at ${time} (in ~${timeStr})`,
                priority: 2,
                requireInteraction: false,
                buttons: [{ title: 'Open Contest' }]
            }, createdId => {
                try {
                    if (createdId) {
                        chrome.storage.local.set({
                            [`notification_${createdId}`]: contest.url
                        }).catch(() => {});
                        scheduleNotificationDismiss(createdId);
                    }
                } catch {} finally {
                    resolve();
                }
            });
        });
    });
}

// ══════════════════════════════════════════════════════
// TIMER ALARM SYSTEM
// ══════════════════════════════════════════════════════

async function recoverTimerAlarms() {
    try {
        const { [TIMER_STORAGE_KEY]: state } = await chrome.storage.local.get(TIMER_STORAGE_KEY);
        if (!state || state.status !== 'RUNNING') return;

        if (state.mode === 'countdown') {
            if (Date.now() >= state.endTime) {
                // Timer expired while browser was closed
                await handleTimerFinished(state);
                return;
            }
            // Re-schedule alarms for remaining milestones
            scheduleTimerAlarms(state);
        }
        // Start badge updates for both countdown and stopwatch
        updateTimerBadge();
    } catch (e) { console.warn('Timer recovery failed:', e); }
}

function scheduleTimerAlarms(state) {
    clearTimerAlarms();

    if (state.status !== 'RUNNING' || state.mode !== 'countdown') return;

    const now = Date.now();
    const msLeft = state.endTime - now;
    const durationMs = state.durationMs || state.remainingMs || msLeft;

    const milestones = [
        { name: 'timer_10min', offset: 10 * 60 * 1000, minDuration: 10 * 60 * 1000 },
        { name: 'timer_5min',  offset: 5 * 60 * 1000,  minDuration: 5 * 60 * 1000 },
        { name: 'timer_1min',  offset: 1 * 60 * 1000,  minDuration: 1 * 60 * 1000 },
        { name: 'timer_end',   offset: 0,               minDuration: 0 }
    ];

    for (const m of milestones) {
        if (msLeft >= m.offset && durationMs >= m.minDuration) {
            const fireTime = new Date(state.endTime - m.offset);
            if (fireTime > now) {
                chrome.alarms.create(m.name, { when: fireTime.getTime() });
            }
        }
    }
}

function clearTimerAlarms() {
    chrome.alarms.clear('timer_10min');
    chrome.alarms.clear('timer_5min');
    chrome.alarms.clear('timer_1min');
    chrome.alarms.clear('timer_end');
}

async function handleTimerAlarm(alarmName) {
    try {
        const { [TIMER_STORAGE_KEY]: state } = await chrome.storage.local.get(TIMER_STORAGE_KEY);
        if (!state || state.status !== 'RUNNING') return;

        if (alarmName === 'timer_end') {
            await handleTimerFinished(state);
        } else if (alarmName === 'timer_10min') {
            const milestones = state.notifiedMilestones || [];
            if (!milestones.includes('10min')) {
                sendTimerNotification('10 Minutes Left', 'Keep pushing, you are doing great!');
                state.notifiedMilestones = [...milestones, '10min'];
                await chrome.storage.local.set({ [TIMER_STORAGE_KEY]: state });
            }
        } else if (alarmName === 'timer_5min') {
            const milestones = state.notifiedMilestones || [];
            if (!milestones.includes('5min')) {
                sendTimerNotification('5 Minutes Left', 'Focus in — finalize your logic.');
                state.notifiedMilestones = [...milestones, '5min'];
                await chrome.storage.local.set({ [TIMER_STORAGE_KEY]: state });
            }
        } else if (alarmName === 'timer_1min') {
            const milestones = state.notifiedMilestones || [];
            if (!milestones.includes('1min')) {
                sendTimerNotification('1 Minute Left', 'Almost there — wrap up your solution!');
                state.notifiedMilestones = [...milestones, '1min'];
                await chrome.storage.local.set({ [TIMER_STORAGE_KEY]: state });
            }
        }
    } catch (e) {
        console.error('Timer alarm handling failed:', e);
    }
}

async function handleTimerFinished(state) {
    clearTimerAlarms();
    state.status = 'STOPPED';
    state.endTime = 0;
    state.remainingMs = 0;
    state.elapsed = 0;
    state.durationMs = 0;
    state.lastStarted = 0;
    await chrome.storage.local.set({ [TIMER_STORAGE_KEY]: state });
    sendTimerNotification('Time is Up!', 'Your focus session has concluded.');
    stopBadgeUpdateInterval();
    stopBadgeUpdates();
}

function targetTimerSound() {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
        if (tabs.length) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'PLAY_TIMER_SOUND' }).catch(() => {});
        }
    });
}

function sendTimerNotification(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: ICON_URL,
        title: `⏳ ${title}`,
        message,
        priority: 2,
        requireInteraction: true
    }).catch(() => {});
    targetTimerSound();
}

async function clearContestNotifications() {
    try {
        const all = await chrome.notifications.getAll();
        for (const id of Object.keys(all)) {
            if (id.startsWith('contest_')) {
                chrome.notifications.clear(id).catch(() => {});
            }
        }
    } catch {}
}

// ══════════════════════════════════════════════════════
// NOTIFICATION LIFECYCLE — Auto-dismiss
// ══════════════════════════════════════════════════════

function scheduleNotificationDismiss(notificationId) {
    chrome.alarms.create(`dismiss_${notificationId}`, {
        when: Date.now() + NOTIFICATION_AUTO_DISMISS_MS
    }).catch(() => {});
}

// ══════════════════════════════════════════════════════
// MESSAGE HANDLER
// ══════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === 'TIMER_STARTED') {
        scheduleTimerAlarms(req.state);
        updateTimerBadge();
    } else if (req.type === 'TIMER_PAUSED') {
        clearTimerAlarms();
        stopBadgeUpdateInterval();
        stopBadgeUpdates();
    } else if (req.type === 'TIMER_FINISHED') {
        clearTimerAlarms();
        stopBadgeUpdateInterval();
        stopBadgeUpdates();
    } else if (req.type === 'REMINDERS_TOGGLED') {
        if (req.enabled) {
            checkUpcomingContests();
        } else {
            clearContestNotifications();
        }
    } else if (req.type === 'TIMER_NOTIFY') {
        sendTimerNotification(req.title, req.message);
    } else if (req.type === 'THEME_CHANGED') {
        const domains = [
            'https://codeforces.com/*',
            'https://atcoder.jp/*',
            'https://www.codechef.com/*'
        ];
        domains.forEach(domain => {
            chrome.tabs.query({ url: domain }, tabs => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { type: 'THEME_CHANGED', theme: req.theme }).catch(() => {});
                });
            });
        });
    }
    return true;
});

// ══════════════════════════════════════════════════════
// NOTIFICATION BUTTON HANDLER
// ══════════════════════════════════════════════════════

chrome.notifications.onButtonClicked.addListener(async (notificationId, btnIdx) => {
    if (btnIdx !== 0) return;
    const key = `notification_${notificationId}`;
    const { [key]: url } = await chrome.storage.local.get(key);
    if (url) chrome.tabs.create({ url, active: false }).catch(() => {});
    chrome.notifications.clear(notificationId).catch(() => {});
});

// ══════════════════════════════════════════════════════
// STORAGE CLEANUP
// ══════════════════════════════════════════════════════

async function pruneStaleKeys() {
    try {
        const all = await chrome.storage.local.get(null);
        const toRemove = [];
        const notifiedKeys = [];

        const activeIds = new Set(Object.keys(await chrome.notifications.getAll()));

        for (const k of Object.keys(all)) {
            if (k.startsWith('notification_')) {
                const notifId = k.slice('notification_'.length);
                if (!activeIds.has(notifId)) {
                    toRemove.push(k);
                }
            } else if (k.startsWith('notified_')) {
                notifiedKeys.push({ key: k, time: all[k] });
            }
        }
        if (notifiedKeys.length > 50) {
            notifiedKeys.sort((a, b) => a.time - b.time);
            toRemove.push(...notifiedKeys.slice(0, notifiedKeys.length - 50).map(x => x.key));
        }
        if (toRemove.length) await chrome.storage.local.remove(toRemove);
    } catch (e) { console.warn('pruneStaleKeys failed:', e); }
}
