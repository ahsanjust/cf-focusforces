/* FocusForces — synchronous theme boot.
   Runs from <head> before first paint so the popup never flashes the wrong
   palette while chrome.storage resolves. Mirrors the theme written by popup.js. */
(function () {
  'use strict';
  try {
    var theme = localStorage.getItem('ff_theme_boot');
    if (theme) document.documentElement.setAttribute('data-ff-theme', theme);
  } catch (_) { /* storage unavailable — default theme is fine */ }
})();