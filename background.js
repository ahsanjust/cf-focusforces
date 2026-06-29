/**
 * FocusForces — Background Service Worker
 * Contest notifications and alarm management.
 */

const CONFIG = {
    CHECK_INTERVAL: 30,
    NOTIFICATION_WINDOW_START: 2 * 60 * 60 + 15 * 60,
    WINDOW_MARGIN: 15 * 60,
    CONTEST_FETCH_TIMEOUT_MS: 10000
};

const ICON_URL = chrome.runtime.getURL('icons/icon128.png');

let inflightCheck = null;

// ── Alarm Setup ───────────────────────────────────
function setupAlarm() {
    chrome.alarms.create('checkContests', { periodInMinutes: CONFIG.CHECK_INTERVAL });
}

chrome.runtime.onStartup.addListener(() => {
    setupAlarm();
    checkUpcomingContests();
    pruneStaleNotificationKeys();
});

chrome.runtime.onInstalled.addListener(() => {
    setupAlarm();
    checkUpcomingContests();
    pruneStaleNotificationKeys();
});

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'checkContests') checkUpcomingContests();
});

// ── Contest Processing ───────────────────────────
async function checkUpcomingContests() {
    // Re-entry guard: if a check is already running, return the same promise
    // so the alarm / onInstalled handlers cannot trigger duplicate fetches
    // and storage writes.
    if (inflightCheck) return inflightCheck;

    inflightCheck = (async () => {
        try {
            const res = await fetch(
                'https://codeforces.com/api/contest.list',
                { signal: AbortSignal.timeout(CONFIG.CONTEST_FETCH_TIMEOUT_MS) }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            if (data.status !== 'OK' || !Array.isArray(data.result)) {
                throw new Error(data.comment || 'Invalid response');
            }

            const now = Math.floor(Date.now() / 1000);
            const candidates = data.result
                .filter(c => c.phase === 'BEFORE')
                .filter(c => {
                    const until = c.startTimeSeconds - now;
                    return until > 0 &&
                        until <= (CONFIG.NOTIFICATION_WINDOW_START + CONFIG.WINDOW_MARGIN) &&
                        until >= (CONFIG.NOTIFICATION_WINDOW_START - CONFIG.WINDOW_MARGIN);
                });

            if (!candidates.length) return;

            const keys = candidates.map(c => `notified_${c.id}`);
            const stored = await chrome.storage.local.get(keys);
            const toNotify = candidates.filter(c => !stored[`notified_${c.id}`]);

            for (const contest of toNotify) {
                await sendNotification(contest);
            }

            // Batch the "already notified" flags into a single storage write.
            if (toNotify.length) {
                const updates = {};
                for (const contest of toNotify) {
                    updates[`notified_${contest.id}`] = true;
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

function sendNotification(contest) {
    const time = new Date(contest.startTimeSeconds * 1000).toLocaleTimeString();
    return new Promise(resolve => {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: ICON_URL,
            title: 'FocusForces: Upcoming Contest',
            message: `${contest.name}\nStarts at ${time} (~2h 15m)`,
            priority: 2,
            buttons: [{ title: 'Open Codeforces' }]
        }, async notificationId => {
            if (notificationId) {
                await chrome.storage.local.set({
                    [`notification_${notificationId}`]: `https://codeforces.com/contest/${contest.id}`
                });
            }
            resolve();
        });
    });
}

// ── Notification Button Handler ───────────────────
chrome.notifications.onButtonClicked.addListener(async (notificationId, btnIdx) => {
    if (btnIdx !== 0) return;

    const key = `notification_${notificationId}`;
    const { [key]: url } = await chrome.storage.local.get(key);
    if (url) chrome.tabs.create({ url, active: false });
});

// ── Storage Cleanup ───────────────────────────────
// Prune stale notification_* and notified_* keys once per session start.
// notified_* keys contain a boolean; notification_* keys contain a URL.
// Both are only useful for a short window — purge anything older than 48 h
// by clearing all keys matching these prefixes on every startup/install.
async function pruneStaleNotificationKeys() {
    try {
        const all = await chrome.storage.local.get(null);
        const toRemove = [];
        const notifiedKeys = [];
        for (const k of Object.keys(all)) {
            if (k.startsWith('notification_')) toRemove.push(k); // URL keys are always short-lived
            else if (k.startsWith('notified_')) notifiedKeys.push(k);
        }
        // Keep only the 50 most recent notified_ keys
        if (notifiedKeys.length > 50) {
            toRemove.push(...notifiedKeys.slice(0, notifiedKeys.length - 50));
        }
        if (toRemove.length) await chrome.storage.local.remove(toRemove);
    } catch { /* non-critical */ }
}

// ── Timer Notification Listener ───────────────────
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === 'TIMER_NOTIFY') {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: ICON_URL,
            title: req.title,
            message: req.message,
            priority: 2
        }).catch(e => console.error('Notification create failed:', e));
    }
});
