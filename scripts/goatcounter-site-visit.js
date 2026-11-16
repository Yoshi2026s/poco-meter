// Shared event for the four published pages. GoatCounter deduplicates this
// constant event within its ~8-hour session, independently of page visits.
// No extra identifier, cookie or browser storage is created here.
(() => {
  'use strict';
  const tracker = document.querySelector('script[data-goatcounter]');
  if (!tracker || tracker.dataset.siteVisitBound) return;
  tracker.dataset.siteVisitBound = 'true';
  let sent = false;
  function countSiteVisit() {
    if (sent || document.prerendering ||
        ('visibilityState' in document && document.visibilityState !== 'visible')) return;
    const counter = window.goatcounter;
    if (!counter || typeof counter.count !== 'function') return;
    sent = true;
    document.removeEventListener('visibilitychange', countSiteVisit);
    document.removeEventListener('prerenderingchange', countSiteVisit);
    try {
      // Use count(), including its normal self-access/local/frame filters.
      // Do not use no_session: the same event must be counted only once.
      counter.count({
        path: 'site-visitor',
        title: 'サイト全体の訪問者数（約8時間単位）',
        event: true,
      });
    } catch (_) { /* Analytics failure must not interrupt the calculator. */ }
  }
  // Either script may finish first; failed CDN loads leave no polling timer.
  tracker.addEventListener('load', countSiteVisit, {once: true});
  document.addEventListener('visibilitychange', countSiteVisit);
  document.addEventListener('prerenderingchange', countSiteVisit);
  countSiteVisit();
})();
