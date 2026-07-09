/**
 * FocusForces — Background Service Worker
 * Contest notifications, timer alarms, and notification lifecycle.
 */

// ══════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════

const CONTEST_CHECK_INTERVAL = 30;
const CONTEST_NOTIFICATION_WINDOW = 2 * 60 * 60 + 15 * 60;
const CONTEST_WINDOW_MARGIN = 15 * 60;
const CONTEST_FETCH_TIMEOUT_MS = 10000;
const NOTIFICATION_AUTO_DISMISS_MS = 5000;
const TIMER_STORAGE_KEY = 'ff_timer_state';
const NOTIFICATION_DISMISS_PREFIX = 'ff_dismiss_';
const DEFAULT_REMINDER_INTERVALS = [86400, 3600, 1800, 600, 300];

const ICON_URL = chrome.runtime.getURL('icons/icon128.png');

let inflightCheck = null;

// ══════════════════════════════════════════════════════
// ALARM SETUP
// ══════════════════════════════════════════════════════

function setupAlarms() {
    chrome.alarms.create('checkContests', { periodInMinutes: CONTEST_CHECK_INTERVAL });
}

chrome.runtime.onStartup.addListener(() => {
    setupAlarms();
    checkUpcomingContests();
    pruneStaleKeys();
    recoverTimerAlarms();
});

chrome.runtime.onInstalled.addListener(() => {
    setupAlarms();
    checkUpcomingContests();
    pruneStaleKeys();
});

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'checkContests') {
        checkUpcomingContests();
    } else if (alarm.name.startsWith('timer_')) {
        handleTimerAlarm(alarm.name);
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

            const keys = contests.map(c => `notified_${c.site}_${c.id}`);
            const stored = await chrome.storage.local.get(keys);
            const toNotify = contests.filter(c => !stored[`notified_${c.site}_${c.id}`]);

            for (const contest of toNotify) {
                await sendContestNotification(contest);
            }

            if (toNotify.length) {
                const updates = {};
                for (const contest of toNotify) {
                    updates[`notified_${contest.site}_${contest.id}`] = true;
                }
                await chrome.storage.local.set(updates);
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
    const allContests = [];
    const now = Math.floor(Date.now() / 1000);

    try {
        const cfResp = await fetch('https://codeforces.com/api/contest.list', {
            signal: AbortSignal.timeout(CONTEST_FETCH_TIMEOUT_MS)
        }).then(r => r.ok ? r.json() : null).catch(() => null);

        if (cfResp?.status === 'OK' && Array.isArray(cfResp.result)) {
            cfResp.result.filter(c => c.phase === 'BEFORE').forEach(c => {
                const until = c.startTimeSeconds - now;
                if (intervals.some(i => Math.abs(until - i) <= CONTEST_WINDOW_MARGIN)) {
                    allContests.push({
                        id: c.id,
                        site: 'CodeForces',
                        name: c.name,
                        url: `https://codeforces.com/contest/${c.id}`,
                        start_time: c.startTimeSeconds * 1000,
                        startTimeSeconds: c.startTimeSeconds
                    });
                }
            });
        }
    } catch {}

    try {
        const ccResp = await fetch('https://www.codechef.com/api/list/contests/all', {
            signal: AbortSignal.timeout(CONTEST_FETCH_TIMEOUT_MS)
        }).then(r => r.ok ? r.json() : null).catch(() => null);

        if (ccResp) {
            const nowDate = new Date();
            const parseDate = (dateStr) => {
                if (!dateStr) return null;
                const d = new Date(dateStr);
                return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
            };

            [...(ccResp.future_contests || []), ...(ccResp.present_contests || [])].forEach(c => {
                const startTimeSec = parseDate(c.contest_start_date_iso);
                if (!startTimeSec) return;
                const until = startTimeSec - now;
                if (intervals.some(i => Math.abs(until - i) <= CONTEST_WINDOW_MARGIN)) {
                    allContests.push({
                        id: c.contest_code || c.contest_name,
                        site: 'CodeChef',
                        name: c.contest_name || 'CodeChef Contest',
                        url: c.contest_code ? `https://www.codechef.com/${c.contest_code}` : null,
                        start_time: startTimeSec * 1000,
                        startTimeSeconds: startTimeSec
                    });
                }
            });
        }
    } catch {}

    return allContests;
}

function sendContestNotification(contest) {
    const time = new Date(contest.start_time).toLocaleTimeString();
    const until = contest.startTimeSeconds
        ? Math.floor((contest.startTimeSeconds - Math.floor(Date.now() / 1000)) / 60)
        : null;
    const timeStr = until !== null
        ? (until >= 60 ? `${Math.floor(until / 60)}h ${until % 60}m` : `${until}m`)
        : 'soon';

    return new Promise(resolve => {
        chrome.notifications.create(`contest_${contest.site}_${contest.id}`, {
            type: 'basic',
            iconUrl: ICON_URL,
            title: `FocusForces: Upcoming Contest`,
            message: `${contest.name}\n${contest.site} • Starts at ${time} (~${timeStr})`,
            priority: 2,
            requireInteraction: false,
            buttons: [{ title: 'Open Contest' }]
        }, async notificationId => {
            if (notificationId) {
                await chrome.storage.local.set({
                    [`notification_${notificationId}`]: contest.url
                });
                scheduleNotificationDismiss(notificationId);
            }
            resolve();
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
            } else {
                // Re-schedule alarms for remaining milestones
                scheduleTimerAlarms(state);
            }
        }
    } catch {}
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
    state.lastStarted = 0;
    await chrome.storage.local.set({ [TIMER_STORAGE_KEY]: state });
    sendTimerNotification('Time is Up!', 'Your focus session has concluded.');
}

function sendTimerNotification(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: ICON_URL,
        title: `FocusForces: ${title}`,
        message,
        priority: 2,
        requireInteraction: false
    }, notificationId => {
        if (notificationId) {
            scheduleNotificationDismiss(notificationId);
        }
    });
}

// ══════════════════════════════════════════════════════
// NOTIFICATION LIFECYCLE — Auto-dismiss
// ══════════════════════════════════════════════════════

function scheduleNotificationDismiss(notificationId) {
    setTimeout(() => {
        chrome.notifications.clear(notificationId).catch(() => {});
    }, NOTIFICATION_AUTO_DISMISS_MS);
}

// ══════════════════════════════════════════════════════
// MESSAGE HANDLER
// ══════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === 'TIMER_STARTED') {
        scheduleTimerAlarms(req.state);
    } else if (req.type === 'TIMER_PAUSED') {
        clearTimerAlarms();
    } else if (req.type === 'TIMER_FINISHED') {
        clearTimerAlarms();
    } else if (req.type === 'REMINDERS_TOGGLED') {
        if (req.enabled) {
            checkUpcomingContests();
        }
    } else if (req.type === 'TIMER_NOTIFY') {
        sendTimerNotification(req.title, req.message);
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
    if (url) chrome.tabs.create({ url, active: false });
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
        for (const k of Object.keys(all)) {
            if (k.startsWith('notification_') || k.startsWith(NOTIFICATION_DISMISS_PREFIX)) {
                toRemove.push(k);
            } else if (k.startsWith('notified_')) {
                notifiedKeys.push(k);
            }
        }
        if (notifiedKeys.length > 50) {
            toRemove.push(...notifiedKeys.slice(0, notifiedKeys.length - 50));
        }
        if (toRemove.length) await chrome.storage.local.remove(toRemove);
    } catch {}
}
