// One site-wide visit per browser per Japanese calendar day.
// Only the last queued date is stored locally; no visitor ID is created/sent.
(() => {
  'use strict';
  const tracker = document.querySelector('script[data-goatcounter]');
  if (!tracker || tracker.dataset.siteVisitBound) return;
  tracker.dataset.siteVisitBound = 'true';
  const key = 'poco-meter-daily-visit-v1';
  const dayMs = 86400000, japanOffset = 9 * 3600000;
  let running = false, midnightTimer;
  const visible = () => !document.prerendering &&
    (!('visibilityState' in document) || document.visibilityState === 'visible');

  async function countSiteVisit() {
    const counter = window.goatcounter;
    if (!counter || typeof counter.filter !== 'function' || typeof counter.url !== 'function') return;
    // A foreground page left open across midnight also belongs to the new day.
    clearTimeout(midnightTimer);
    midnightTimer = setTimeout(countSiteVisit, dayMs - ((Date.now() + japanOffset) % dayMs) + 50);
    if (running || !visible() || navigator.onLine === false ||
        !navigator.locks || typeof navigator.sendBeacon !== 'function') return;
    running = true;
    try {
      // A Web Lock serializes all four pages/tabs on this origin. Without it,
      // skip this extra metric instead of risking duplicate daily visits.
      await navigator.locks.request(key, () => {
        if (!visible() || navigator.onLine === false || counter.filter()) return;
        const day = new Date(Date.now() + japanOffset).toISOString().slice(0, 10);
        const previous = localStorage.getItem(key);
        if (/^\d{4}-\d{2}-\d{2}$/.test(previous || '') && previous >= day) return;
        const url = new URL(counter.url({
          path: 'site-visitor-daily',
          title: 'サイト全体の訪問者数（1日・日本時間）',
          event: true,
        }));
        // count.v5.js predates no_session support. Use the same ns parameter
        // as the official current count.js, only for this client-deduped event.
        // Otherwise a visit just after midnight could be lost to the 8h session.
        url.searchParams.set('ns', 'true');
        // Save before queueing: storage failures must never lead to duplicates.
        // This marks a queued attempt, not an acknowledged server-side count.
        localStorage.setItem(key, day);
        if (localStorage.getItem(key) !== day) return;
        let queued = false;
        try { queued = navigator.sendBeacon(url.href); }
        finally {
          // false/throw means the browser did not queue it; allow a later retry.
          // Once queued, do not replay an ambiguous delivery on the same day.
          if (!queued) {
            if (previous === null) localStorage.removeItem(key);
            else localStorage.setItem(key, previous);
          }
        }
      });
    } catch (_) { /* Analytics/storage failure must not interrupt the calculator. */ }
    finally { running = false; }
  }
  tracker.addEventListener('load', countSiteVisit, {once: true});
  document.addEventListener('visibilitychange', countSiteVisit);
  document.addEventListener('prerenderingchange', countSiteVisit);
  window.addEventListener('pageshow', countSiteVisit);
  window.addEventListener('focus', countSiteVisit);
  window.addEventListener('online', countSiteVisit);
  window.addEventListener('pagehide', () => clearTimeout(midnightTimer));
  countSiteVisit();
})();
