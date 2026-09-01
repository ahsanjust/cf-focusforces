/**
 * FocusForces — Offscreen Audio
 *
 * Plays the timer notification sound (assets/notify.wav) when the active tab
 * has no content script to play it (i.e. the user is on a non-supported page).
 * The background service worker creates this document on demand and keeps it
 * alive, so it can be reused without recreation races.
 */
'use strict';

const SOUND_URL = chrome.runtime.getURL('assets/notify.wav');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'FF_PLAY_SOUND') {
        const audio = new Audio(SOUND_URL);
        audio.play().catch(() => {});
        sendResponse(true);
    }
});
