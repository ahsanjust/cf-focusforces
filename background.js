/**
 * FocusForces — Background Service Worker
 * Contest notifications, timer alarms, and notification lifecycle.
 */

importScripts('contest-utils.js', 'timer-utils.js');

// ══════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════

const CONTEST_CHECK_INTERVAL = 30;
const CONTEST_FETCH_TIMEOUT_MS = 10000;
const CONTEST_NOTIFICATION_AUTO_DISMISS_MS = 5 * 1000;        // contest reminders auto-dismiss 5s
const TIMER_NOTIFICATION_AUTO_DISMISS_MS = 8 * 1000;          // timer alerts auto-dismiss 8s
const TIMER_STORAGE_KEY = 'ff_timer_state';
const TIMER_FINISH_SENT_KEY = 'ff_timer_finish_sent';
const BADGE_REFRESH_ALARM = 'ffBadgeTick';
const CONTEST_REMINDER_ALARM_PREFIX = 'crem_'; // crem_<site>_<id>_<intervalSec>
const CONTEST_HORIZON_S = 15 * 24 * 60 * 60;  // only schedule reminders within 15 days

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
        stopBadgeUpdateInterval();
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
let recoveryPromise = null;

// ══════════════════════════════════════════════════════
// ALARM SETUP
// ══════════════════════════════════════════════════════

/**
 * Create the periodic alarms only when they are missing. `alarms.create`
 * replaces a same-name alarm, so re-creating them blindly on every worker
 * boot would keep pushing the next contest check another 30 minutes out.
 * @returns {Promise<{names: Set<string>, lost: boolean}>}
 */
async function setupAlarms() {
    let names = new Set();
    let lost = false;
    try {
        const existing = await chrome.alarms.getAll();
        names = new Set(existing.map(a => a.name));
        if (!names.has('checkContests')) {
            lost = true;
            names.add('checkContests');
            chrome.alarms.create('checkContests', { periodInMinutes: CONTEST_CHECK_INTERVAL }).catch(() => {});
        }
        if (!names.has('pruneStaleKeys')) {
            lost = true;
            names.add('pruneStaleKeys');
            chrome.alarms.create('pruneStaleKeys', { periodInMinutes: 1440 }).catch(() => {});
        }
    } catch (e) {
        console.warn('Alarm setup failed:', e);
    }
    return { names, lost };
}

// Chrome does not guarantee alarm persistence before v150, and this worker is
// started by many events that never fire onStartup/onInstalled (messages,
// alarm fires, notification clicks). Re-assert the periodic alarms on every
// worker boot, and rebuild the timer alarms when they look lost.
(async () => {
    const { names, lost } = await setupAlarms();
    if (lost || !names.has(BADGE_REFRESH_ALARM)) {
        await recoverTimerAlarms();
    }
})();

chrome.runtime.onStartup.addListener(async () => {
    await setupAlarms();
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

chrome.alarms.onAlarm.addListener(async alarm => {
    // Await the handler so the alarm event stays alive for the async work it
    // starts (fetch + storage writes can outlive the synchronous callback).
    try {
        if (alarm.name === 'checkContests') {
            await checkUpcomingContests();
        } else if (alarm.name.startsWith(CONTEST_REMINDER_ALARM_PREFIX)) {
            await handleContestReminderAlarm(alarm.name);
        } else if (alarm.name.startsWith('timer_')) {
            await handleTimerAlarm(alarm.name);
            await updateTimerBadge();
        } else if (alarm.name.startsWith('dismiss_')) {
            const notificationId = alarm.name.slice('dismiss_'.length);
            await chrome.notifications.clear(notificationId).catch(() => {});
        } else if (alarm.name === BADGE_REFRESH_ALARM) {
            // Safety net for the 1s badge interval: chrome can terminate the
            // service worker, freezing the badge. A periodic alarm re-arms it.
            await updateTimerBadge();
        } else if (alarm.name === 'pruneStaleKeys') {
            await pruneStaleKeys();
        }
    } catch (e) {
        console.warn('Alarm handler failed:', alarm.name, e);
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
            if (ff_reminders_enabled === false) {
                await clearAllContestReminderAlarms();
                return;
            }

            // Determine the active interval set. A MISSING/non-array value
            // means the user never configured reminders → use the defaults.
            // An EMPTY array means the user deliberately unchecked every chip
            // → no reminders at all. Do NOT fall back to defaults for an empty
            // array, or unchecking every chip would silently re-enable all
            // reminders (the previous behavior).
            const intervals = resolveReminderIntervals(ff_reminder_intervals, DEFAULT_REMINDER_INTERVALS);
            if (!intervals.length) {
                // User wants no reminders: cancel anything pending and stop.
                await clearAllContestReminderAlarms();
                return;
            }

            const contests = await fetchContestsForNotifications();
            if (!contests.length) return;

            // Schedule an exact absolute-time alarm for every (contest, enabled
            // interval) whose fire time is still ahead. This replaces the old
            // poll-and-match scheme whose ±margin detection windows for the
            // 5m/10m/30m reminders were narrower than the 30-minute poll
            // period, causing those reminders to be silently missed ~58-75%
            // of the time. Absolute `when` alarms fire reliably (and fire on
            // device wake after sleep), so every enabled reminder is delivered.
            const nowMs = Date.now();
            const dedupKeys = [];
            for (const contest of contests) {
                for (const interval of intervals) {
                    const fireTimeMs = contest.startTimeSeconds * 1000 - interval * 1000;
                    if (fireTimeMs > nowMs) {
                        scheduleContestReminder(contest, interval, fireTimeMs);
                    } else if (fireTimeMs > nowMs - CONTEST_CATCHUP_WINDOW_MS
                               && contest.startTimeSeconds * 1000 > nowMs) {
                        // Catch-up: a reminder whose fire time just passed while
                        // the browser was closed/sleeping should still be
                        // delivered (once) if the contest hasn't started yet.
                        dedupKeys.push(`notified_${contest.site}_${contest.id}_${interval}`);
                    }
                }
            }

            if (dedupKeys.length) {
                const stored = await chrome.storage.local.get(dedupKeys);
                for (const contest of contests) {
                    for (const interval of intervals) {
                        const fireTimeMs = contest.startTimeSeconds * 1000 - interval * 1000;
                        if (fireTimeMs <= nowMs
                            && fireTimeMs > nowMs - CONTEST_CATCHUP_WINDOW_MS
                            && contest.startTimeSeconds * 1000 > nowMs
                            && !stored[`notified_${contest.site}_${contest.id}_${interval}`]) {
                            try {
                                await fireContestReminder(contest, interval);
                            } catch (e) {
                                console.warn('Catch-up notify failed:', contest.site, contest.id, e);
                            }
                        }
                    }
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

/**
 * Maximum window after a reminder's scheduled fire time during which a missed
 * reminder is still delivered as catch-up (browser may have been closed/sleeping
 * across the fire time). 2 hours balances "deliver soon reminders that just
 * passed" against "don't spam stale reminders from a long offline period".
 */
const CONTEST_CATCHUP_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Build the alarm name for a (contest, interval) reminder. Chrome 150+ caps
 * alarm names at 1024 bytes; ids are short so this is well within range.
 */
function contestReminderAlarmName(site, id, interval) {
    return `${CONTEST_REMINDER_ALARM_PREFIX}${site}_${id}_${interval}`;
}

/**
 * Schedule (or re-schedule) a single absolute-time contest reminder alarm.
 * Re-creating an alarm with the same name cleanly replaces the prior one.
 */
function scheduleContestReminder(contest, interval, fireTimeMs) {
    const name = contestReminderAlarmName(contest.site, contest.id, interval);
    chrome.alarms.create(name, { when: fireTimeMs }).catch(() => {});
}

/**
 * Clear all outstanding contest-reminder alarms (used when reminders are
 * disabled, so no stale future notifications pop up).
 */
async function clearAllContestReminderAlarms() {
    try {
        const all = await chrome.alarms.getAll();
        const names = all
            .map(a => a.name)
            .filter(n => n.startsWith(CONTEST_REMINDER_ALARM_PREFIX));
        await Promise.all(names.map(n => chrome.alarms.clear(n).catch(() => {})));
    } catch {}
}

/**
 * Fire a contest reminder notification once per (contest, interval).
 *
 * This is the SINGLE canonical guard for "already notified?": it reads the
 * `notified_<site>_<id>_<interval>` dedup key and aborts if already set,
 * otherwise marks it as notified BEFORE sending. Checking-and-setting up front
 * (instead of notify-then-set) closes two defects:
 *   1. The alarm-fired path (handleContestReminderAlarm) used to send without
 *      consulting dedup, so on browser wake it could race the catch-up path
 *      and deliver the same reminder twice.
 *   2. Contests with no URL (e.g. a LeetCode contest missing titleSlug) were
 *      marked notified even though no notification was ever shown, permanently
 *      suppressing them.
 *
 * Calls are serialized via `reminderFireChain` so that two concurrent callers
 * (an overdue `crem_` alarm firing on startup while `checkUpcomingContests`
 * catch-up runs the same (contest, interval)) cannot interleave their
 * get-then-set and both see "not notified". Chrome storage.local has no
 * compare-and-swap, so this in-SW mutex is the only way to make the
 * check-and-set race-free. Each link catches its own errors so a single
 * failure never poisons the chain.
 *
 * `interval` is the reminder setting (seconds before start); the displayed
 * time-to-start is computed from the actual remaining time, not the setting,
 * so the message is always accurate.
 *
 * @returns {Promise<boolean>} resolves true if a notification was actually sent
 */
let reminderFireChain = Promise.resolve();

async function fireContestReminder(contest, interval) {
    const run = async () => {
        if (!contest || !contest.url) return false;

        const dedupKey = `notified_${contest.site}_${contest.id}_${interval}`;
        const { [dedupKey]: alreadyNotified } = await chrome.storage.local.get(dedupKey);
        if (alreadyNotified) return false;

        // Set the dedup key BEFORE sending so a concurrent caller that starts
        // after this set (next link in the chain) sees it as notified.
        await chrome.storage.local.set({ [dedupKey]: Date.now() });
        await sendContestNotification(contest, interval);
        return true;
    };
    // Serialize: chain this call after the previous one. Wrap so a rejection in
    // a prior link doesn't propagate (each link is independent).
    const next = reminderFireChain.then(run, run);
    reminderFireChain = next.catch(() => {});
    return next;
}

/**
 * Handler for fired contest-reminder alarms. Parses (site, id, interval) from
 * the alarm name and delivers the notification from the stashed contest payload
 * (saved at schedule time under contest_data_<site>_<id>).
 */
async function handleContestReminderAlarm(alarmName) {
    const body = alarmName.slice(CONTEST_REMINDER_ALARM_PREFIX.length);
    const lastUnderscore = body.lastIndexOf('_');
    if (lastUnderscore < 0) return;
    const interval = parseInt(body.slice(lastUnderscore + 1), 10);
    const siteAndId = body.slice(0, lastUnderscore);
    if (!Number.isFinite(interval) || !siteAndId) return;
    const key = `contest_data_${siteAndId}`;
    try {
        const { [key]: contest } = await chrome.storage.local.get(key);
        if (contest) await fireContestReminder(contest, interval);
    } catch (e) {
        console.warn('Contest reminder alarm handler failed:', e);
    }
}

async function fetchContestsForNotifications() {
    const now = Math.floor(Date.now() / 1000);

    const results = await Promise.allSettled([
        (async () => {
            const cfResp = await fetch('https://codeforces.com/api/contest.list', {
                signal: AbortSignal.timeout(CONTEST_FETCH_TIMEOUT_MS)
            }).then(r => r.ok ? r.json() : null).catch(() => null);

            if (cfResp?.status !== 'OK' || !Array.isArray(cfResp.result)) return [];
            return cfResp.result.filter(c => c.phase === 'BEFORE').reduce((acc, c) => {
                const until = c.startTimeSeconds - now;
                if (until < 0 || until > CONTEST_HORIZON_S) return acc;
                acc.push({
                    id: String(c.id),
                    site: 'CodeForces',
                    name: c.name,
                    url: `https://codeforces.com/contest/${c.id}`,
                    start_time: c.startTimeSeconds * 1000,
                    startTimeSeconds: c.startTimeSeconds
                });
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
                if (until < 0 || until > CONTEST_HORIZON_S) return acc;
                acc.push({
                    id: c.contest_code || `cc_${startTimeSec}_${(c.contest_name || 'unknown').replace(/\s+/g, '_')}`,
                    site: 'CodeChef',
                    name: c.contest_name || 'CodeChef Contest',
                    url: c.contest_code ? `https://www.codechef.com/${c.contest_code}` : 'https://www.codechef.com/contests',
                    start_time: startTimeSec * 1000,
                    startTimeSeconds: startTimeSec
                });
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
                // AtCoder rows can contain multiple /contests/ links (e.g. rating
                // predictors) before the actual contest name; pick the LAST one,
                // mirroring the popup's DOMParser-based parser (AtCoderParser.parse).
                const linkMatches = [...rowHtml.matchAll(/<a[^>]+href="(\/contests\/[^"]+)"[^>]*>([^<]*)<\/a>/g)];
                const timeMatch = rowHtml.match(/<time[^>]*>([^<]*)<\/time>/);
                if (!linkMatches.length || !timeMatch) continue;
                const lastLink = linkMatches[linkMatches.length - 1];
                const href = lastLink[1];
                // Decode common HTML entities in the contest name (regex can't use DOM)
                const rawName = lastLink[2].trim();
                const name = rawName
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#039;/g, "'")
                    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
                if (!href || !name) continue;
                // AtCoder uses "2024-06-01 12:00:00+0900" — replace space with T for ISO parsing
                const startTimeSec = Math.floor(new Date(timeMatch[1].replace(' ', 'T')).getTime() / 1000);
                if (Number.isNaN(startTimeSec)) continue;
                const until = startTimeSec - now;
                if (until < 0 || until > CONTEST_HORIZON_S) continue;
                contests.push({
                    id: href.split('/').pop(),
                    site: 'AtCoder',
                    name,
                    url: `https://atcoder.jp${href}`,
                    start_time: startTimeSec * 1000,
                    startTimeSeconds: startTimeSec
                });
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
                if (until < 0 || until > CONTEST_HORIZON_S) return acc;
                acc.push({
                    id: c.titleSlug || c.title,
                    site: 'LeetCode',
                    name: c.title || 'LeetCode Contest',
                    url: c.titleSlug ? `https://leetcode.com/contest/${c.titleSlug}` : null,
                    start_time: startTimeSec * 1000,
                    startTimeSeconds: startTimeSec
                });
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

    // Stash each contest's payload in storage so the fired-alarm handler can
    // deliver the notification without re-fetching. Keyed by site+id (no
    // interval) since the payload is shared across all of a contest's reminders.
    if (allContests.length) {
        const dataObj = {};
        for (const c of allContests) {
            dataObj[`contest_data_${c.site}_${c.id}`] = c;
        }
        chrome.storage.local.set(dataObj).catch(() => {});
    }

    return allContests;
}

/**
 * Build & send a contest notification. `interval` is the reminder setting that
 * triggered this notification; the displayed time-to-start is computed from the
 * REAL remaining time (contest.start_time - now), so the message is always
 * accurate instead of parroting the setting.
 */
function sendContestNotification(contest, interval) {
    if (!contest.url) return Promise.resolve();
    const startMs = contest.start_time;
    const time = new Date(startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timeStr = formatTimeUntil(startMs - Date.now());

    return new Promise(resolve => {
        // Namespace the notification id by interval so two reminders for the
        // same contest don't clear-and-replace each other.
        const notificationId = `contest_${contest.site}_${contest.id}_${interval}`;

        // Arm the auto-dismiss alarm up front instead of inside the
        // notifications.create() callback: a worker teardown between create()
        // and its callback would otherwise leave a requireInteraction toast on
        // screen forever. The id is deterministic, so the callback buys nothing.
        scheduleNotificationDismiss(notificationId, CONTEST_NOTIFICATION_AUTO_DISMISS_MS);
        chrome.storage.local.set({
            [`notification_${notificationId}`]: contest.url
        }).catch(() => {});

        chrome.notifications.clear(notificationId).catch(() => {}).then(() => {
            chrome.notifications.create(notificationId, {
                type: 'basic',
                iconUrl: ICON_URL,
                title: `🚀 Upcoming ${contest.site} Contest`,
                message: `${contest.name}\nStarts at ${time} (in ~${timeStr})`,
                priority: 2,
                // Contest reminders stay until interacted with (requireInteraction)
                // so a user who glances away doesn't miss the one notification for
                // this interval, but a separate auto-dismiss alarm clears it after
                // CONTEST_NOTIFICATION_AUTO_DISMISS_MS (5s) as a safety net.
                requireInteraction: true,
                buttons: [{ title: 'Open Contest' }]
            }, () => resolve());
        });
    });
}

// ══════════════════════════════════════════════════════
// TIMER ALARM SYSTEM
// ══════════════════════════════════════════════════════

function recoverTimerAlarms() {
    // Collapse concurrent recoveries (boot-time ensure + onStartup can overlap).
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
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
                await scheduleTimerAlarms(state);
            }
            // Start badge updates for both countdown and stopwatch
            startBadgeRefresh();
            await updateTimerBadge();
        } catch (e) { console.warn('Timer recovery failed:', e); }
    })().finally(() => { recoveryPromise = null; });
    return recoveryPromise;
}

async function scheduleTimerAlarms(state) {
    await clearTimerAlarms();

    if (state.status !== 'RUNNING' || state.mode !== 'countdown') return;

    // Read which milestones the user has enabled
    const { ff_timer_notify_milestones: enabledMilestones = DEFAULT_TIMER_NOTIFY_MILESTONES } =
        await chrome.storage.local.get({ ff_timer_notify_milestones: DEFAULT_TIMER_NOTIFY_MILESTONES });

    // Shared, unit-tested pure logic (timer-utils.computeTimerAlarmSchedules)
    // computes which absolute-time alarms to create. Note: timer_end is always
    // scheduled even if the 'finish' milestone is disabled — it is what
    // finalizes the timer state and clears the badge, and the notification
    // itself is gated separately inside handleTimerFinished/notifyTimerFinishedOnce.
    const schedules = computeTimerAlarmSchedules(state, enabledMilestones, Date.now());
    schedules.forEach(s => { chrome.alarms.create(s.name, { when: s.when }).catch(() => {}); });
}

async function clearTimerAlarms() {
    await Promise.all([
        chrome.alarms.clear('timer_10min'),
        chrome.alarms.clear('timer_5min'),
        chrome.alarms.clear('timer_1min'),
        chrome.alarms.clear('timer_end'),
    ]);
}

// Maps alarm name → milestone id used in ff_timer_notify_milestones storage key
const ALARM_TO_MILESTONE_ID = {
    'timer_10min': '10min',
    'timer_5min':  '5min',
    'timer_1min':  '1min',
    'timer_end':   'finish'
};

// Per-milestone notification content
const MILESTONE_NOTIFICATIONS = {
    '10min': {
        title: '10 Minutes Remaining',
        message: 'Wrap up your current approach and start checking edge cases.'
    },
    '5min': {
        title: '5 Minutes Left',
        message: 'Submit what you have — then optimise if time allows.'
    },
    '1min': {
        title: '⚠️ 1 Minute Left!',
        message: 'Final minute — submit now if you have not already!'
    },
    'finish': {
        title: '🏁 Time\'s Up!',
        message: 'Session complete. Review your solution and submit.'
    }
};

async function handleTimerAlarm(alarmName) {
    try {
        const { [TIMER_STORAGE_KEY]: state } = await chrome.storage.local.get(TIMER_STORAGE_KEY);
        if (!state || state.status !== 'RUNNING') return;

        if (alarmName === 'timer_end') {
            await handleTimerFinished(state);
            return;
        }

        const milestoneId = ALARM_TO_MILESTONE_ID[alarmName];
        if (!milestoneId) return;

        // Double-check the user still has this milestone enabled (they may have
        // changed it after the alarm was scheduled).
        const { ff_timer_notify_milestones: enabledMilestones = DEFAULT_TIMER_NOTIFY_MILESTONES } =
            await chrome.storage.local.get({ ff_timer_notify_milestones: DEFAULT_TIMER_NOTIFY_MILESTONES });
        if (!enabledMilestones.includes(milestoneId)) return;

        const notified = state.notifiedMilestones || [];
        if (!notified.includes(milestoneId)) {
            const { title, message } = MILESTONE_NOTIFICATIONS[milestoneId];
            sendTimerNotification(title, message);
            state.notifiedMilestones = [...notified, milestoneId];
            await chrome.storage.local.set({ [TIMER_STORAGE_KEY]: state });
        }
    } catch (e) {
        console.error('Timer alarm handling failed:', e);
    }
}

async function handleTimerFinished(state) {
    await clearTimerAlarms();
    state.status = 'STOPPED';
    state.endTime = 0;
    state.remainingMs = 0;
    state.elapsed = 0;
    state.durationMs = 0;
    state.lastStarted = 0;
    state.notifiedMilestones = [];
    await chrome.storage.local.set({ [TIMER_STORAGE_KEY]: state });

    // Deliver the finish notification exactly once — the shared dedup flag
    // (TIMER_FINISH_SENT_KEY) also covers the popup-side finish path so the
    // notification can never be skipped NOR duplicated.
    await notifyTimerFinishedOnce();

    stopBadgeRefresh();
    stopBadgeUpdateInterval();
    stopBadgeUpdates();
}

/**
 * Deliver the "Time's Up!" finish notification exactly once per timer run.
 *
 * Both the background alarm path (handleTimerFinished) and the popup-side
 * finish path (TIMER_FINISHED with `expired`) converge here. A dedicated
 * storage flag (TIMER_FINISH_SENT_KEY) — cleared on every TIMER_STARTED —
 * guarantees a notification is never skipped (the old popup-vs-alarm race
 * could silently drop it) and never duplicated (the alarm path can't double
 * with the popup path). Calls are serialized via `finishNotifyChain` because
 * chrome.storage.local has no compare-and-swap.
 */
let finishNotifyChain = Promise.resolve();

function notifyTimerFinishedOnce() {
    const run = async () => {
        try {
            const {
                ff_timer_notify_milestones: enabledMilestones = DEFAULT_TIMER_NOTIFY_MILESTONES,
                [TIMER_FINISH_SENT_KEY]: alreadyNotified = false,
                [TIMER_STORAGE_KEY]: current
            } = await chrome.storage.local.get({
                ff_timer_notify_milestones: DEFAULT_TIMER_NOTIFY_MILESTONES,
                [TIMER_FINISH_SENT_KEY]: false,
                [TIMER_STORAGE_KEY]: null
            });
            if (alreadyNotified) return;

            // A new timer run may have started while this call was queued (the
            // popup can finish one session and start another within the same
            // second). The "Time's Up!" notification belongs to the session
            // that just ended — bail if a fresh RUNNING state is already in
            // storage.
            if (current && current.status === 'RUNNING') return;

            // Mark BEFORE sending so a concurrent caller that starts after this
            // set sees it as notified.
            await chrome.storage.local.set({ [TIMER_FINISH_SENT_KEY]: true });

            // Respect the user's opt-in milestone set and master toggle
            // (sendTimerNotification re-checks ff_timer_notifications_enabled).
            if (!enabledMilestones.includes('finish')) return;
            const { title, message } = MILESTONE_NOTIFICATIONS['finish'];
            sendTimerNotification(title, message);
        } catch (e) {
            console.warn('Finish notification failed:', e);
        }
    };
    const next = finishNotifyChain.then(run, run);
    finishNotifyChain = next.catch(() => {});
    return next;
}

// ── Badge refresh safety net ──────────────────────────
// The 1s badge interval lives in this service worker; if Chrome terminates
// the worker the badge would freeze until the next alarm. A 1-minute periodic
// alarm re-arms/updates the badge so staleness is bounded to ~1 minute even
// in the worst case.

function startBadgeRefresh() {
    chrome.alarms.create(BADGE_REFRESH_ALARM, { periodInMinutes: 1 }).catch(() => {});
}

function stopBadgeRefresh() {
    chrome.alarms.clear(BADGE_REFRESH_ALARM).catch(() => {});
}

// ── Notification sound ────────────────────────────────
// Play the timer sound on the active tab's content script when possible;
// otherwise fall back to an offscreen audio document so the sound works on
// ANY page (previously it was silently dropped on non-supported sites).

let offscreenReadyPromise = null;

async function ensureOffscreenDocument() {
    const offscreenApi = chrome && chrome['offscreen'];
    if (!offscreenApi || typeof offscreenApi.hasDocument !== 'function') return;
    if (!offscreenReadyPromise) {
        offscreenReadyPromise = (async () => {
            const hasDoc = await offscreenApi.hasDocument();
            if (!hasDoc) {
                await offscreenApi.createDocument({
                    url: 'offscreen.html',
                    reasons: ['AUDIO_PLAYBACK'],
                    justification: 'Play FocusForces timer notification sounds on any page'
                });
            }
        })().catch(err => {
            offscreenReadyPromise = null; // allow retry on the next sound
            console.debug('FocusForces: offscreen audio unavailable', err);
            throw err;
        });
    }
    return offscreenReadyPromise;
}

async function sendOffscreenSound() {
    try {
        await chrome.runtime.sendMessage({ type: 'FF_PLAY_SOUND' });
    } catch {
        // First-ever use: the offscreen document may still be booting.
        await new Promise(r => setTimeout(r, 250));
        await chrome.runtime.sendMessage({ type: 'FF_PLAY_SOUND' });
    }
}

async function playTimerSound() {
    // Preferred path: the active tab's content script (crisp, zero overhead).
    try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tabs.length) {
            await chrome.tabs.sendMessage(tabs[0].id, { type: 'PLAY_TIMER_SOUND' });
            return;
        }
    } catch (_) {}

    // Firefox background script direct audio playback
    if (typeof Audio !== 'undefined') {
        try {
            const audio = new Audio(chrome.runtime.getURL('assets/notify.wav'));
            await audio.play();
            return;
        } catch (e) {
            console.debug('FocusForces: direct audio playback failed', e);
        }
    }

    // Chrome Fallback: play in an offscreen document.
    if (typeof chrome.offscreen !== 'undefined') {
        try {
            await ensureOffscreenDocument();
            await sendOffscreenSound();
        } catch (e) {
            console.debug('FocusForces: could not play timer sound', e);
        }
    }
}

async function sendTimerNotification(title, message) {
    const { ff_timer_notifications_enabled } = await chrome.storage.local.get({
        ff_timer_notifications_enabled: true
    });
    if (ff_timer_notifications_enabled === false) return;

    const notificationId = `timer_${title.replace(/\s/g, '_').toLowerCase()}`;
    // Arm the auto-dismiss safety net before creating the toast so a worker
    // teardown can't leave a requireInteraction notification on screen.
    // requireInteraction keeps the toast up until dismissed; without this
    // alarm an ignored timer milestone would linger indefinitely.
    scheduleNotificationDismiss(notificationId, TIMER_NOTIFICATION_AUTO_DISMISS_MS);
    chrome.notifications.clear(notificationId).catch(() => {});
    chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: ICON_URL,
        title: `⏳ ${title}`,
        message,
        priority: 2,
        requireInteraction: true
    }).catch(() => {});
    playTimerSound();
}

async function clearContestNotifications() {
    try {
        const all = await chrome.notifications.getAll();
        for (const id of Object.keys(all)) {
            if (id.startsWith('contest_')) {
                chrome.notifications.clear(id).catch(() => {});
            }
        }
        // Also cancel any not-yet-fired reminder alarms so disabling reminders
        // truly stops future contest notifications.
        await clearAllContestReminderAlarms();
    } catch {}
}

// ══════════════════════════════════════════════════════
// NOTIFICATION LIFECYCLE — Auto-dismiss
// ══════════════════════════════════════════════════════

function scheduleNotificationDismiss(notificationId, ttlMs = TIMER_NOTIFICATION_AUTO_DISMISS_MS) {
    chrome.alarms.create(`dismiss_${notificationId}`, {
        when: Date.now() + ttlMs
    }).catch(() => {});
}

// ══════════════════════════════════════════════════════
// MESSAGE HANDLER
// ══════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === 'TIMER_STARTED') {
        // A new timer run begins: clear the finish-notification dedup flag.
        chrome.storage.local.remove(TIMER_FINISH_SENT_KEY).catch(() => {});
        startBadgeRefresh();
        scheduleTimerAlarms(req.state).then(() => updateTimerBadge()).catch(() => {});
    } else if (req.type === 'TIMER_PAUSED') {
        stopBadgeRefresh();
        clearTimerAlarms().then(() => {
            stopBadgeUpdateInterval();
            stopBadgeUpdates();
        });
    } else if (req.type === 'TIMER_FINISHED') {
        stopBadgeRefresh();
        clearTimerAlarms().then(() => {
            stopBadgeUpdateInterval();
            stopBadgeUpdates();
        });
        // The popup detected the countdown hit zero (it may have beaten the
        // timer_end alarm). Deliver the finish notification from here so the
        // popup-vs-alarm race can never drop it.
        if (req.expired) {
            notifyTimerFinishedOnce();
        }
    } else if (req.type === 'REMINDERS_TOGGLED') {
        if (req.enabled) {
            checkUpcomingContests();
        } else {
            clearContestNotifications();
        }
    } else if (req.type === 'TIMER_NOTIFY_TOGGLED') {
        // Toggle is read from storage on each alarm fire, so no immediate action needed.
    } else if (req.type === 'TIMER_NOTIFY_MILESTONES_CHANGED') {
        // Milestone set changed: re-schedule timer alarms so newly-disabled milestones
        // won't fire and newly-enabled ones will (if timer is currently running).
        (async () => {
            try {
                const { [TIMER_STORAGE_KEY]: state } = await chrome.storage.local.get(TIMER_STORAGE_KEY);
                if (state && state.status === 'RUNNING' && state.mode === 'countdown') {
                    await scheduleTimerAlarms(state);
                }
            } catch {}
        })();
    } else if (req.type === 'REMINDER_INTERVALS_CHANGED') {
        // Reminder interval set changed: clear all scheduled contest reminders
        // and re-schedule from the fresh interval list so removed intervals
        // don't fire and newly-added ones do.
        clearAllContestReminderAlarms().then(() => checkUpcomingContests());
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
    // Note: no sendResponse is ever used, so the channel is not held open.
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

// Clicking the notification body (not the button) also opens the contest URL.
// The URL is already stashed under notification_<id> at create time, so this
// reuses it rather than leaving a body click as a no-op.
chrome.notifications.onClicked.addListener(async (notificationId) => {
    const key = `notification_${notificationId}`;
    const { [key]: url } = await chrome.storage.local.get(key);
    if (url) chrome.tabs.create({ url, active: true }).catch(() => {});
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

        const now = Date.now();
        for (const k of Object.keys(all)) {
            if (k.startsWith('notification_')) {
                const notifId = k.slice('notification_'.length);
                if (!activeIds.has(notifId)) {
                    toRemove.push(k);
                }
            } else if (k.startsWith('notified_')) {
                notifiedKeys.push({ key: k, time: all[k] });
            } else if (k.startsWith('contest_data_')) {
                // Drop stashed contest payloads whose start time has passed by
                // more than a day; they're no longer needed by any reminder.
                const c = all[k];
                if (c && c.start_time && now - c.start_time > 24 * 60 * 60 * 1000) {
                    toRemove.push(k);
                }
            }
        }
        // Expire `notified_*` dedup keys once the corresponding contest has
        // started (so a future contest that reuses an id — unlikely but safe —
        // can notify again). Keys without matching contest_data are kept under
        // the existing 500-entry LRU below.
        const expired = notifiedKeys
            .filter(({ key }) => {
                // key = notified_<site>_<id>_<interval>
                const m = key.match(/^notified_(.+?)_(\d+)$/);
                if (!m) return false;
                const dataKey = `contest_data_${m[1]}`;
                const c = all[dataKey];
                return c && c.start_time && now > c.start_time + 60 * 60 * 1000;
            })
            .map(({ key }) => key);
        toRemove.push(...expired);

        if (notifiedKeys.length > 500) {
            notifiedKeys.sort((a, b) => a.time - b.time);
            toRemove.push(...notifiedKeys.slice(0, notifiedKeys.length - 50).map(x => x.key));
        }
        if (toRemove.length) await chrome.storage.local.remove(toRemove);
    } catch (e) { console.warn('pruneStaleKeys failed:', e); }
}
