// Reviewed tracking endpoints. Generic Matomo/Piwik and analytics collection
// patterns are selected from EasyPrivacy (GPL-3.0-or-later), not its full list.
// Source: https://easylist.to/easylist/easyprivacy.txt (202610051633).
// Restrict collection to resource requests; never block document navigation/media.
const REQUEST_TYPES = ['script', 'xmlhttprequest', 'ping', 'image', 'other'];
const TRACKING = [
  '||google-analytics.com^', '||googletagmanager.com/gtag/js',
  '||hotjar.com^', '||hotjar.io^', '||mc.yandex.ru^', '||mc.yandex.com^',
  '||clarity.ms^', '||connect.facebook.net/*/fbevents.js^', '||facebook.com/tr/',
  '||snap.licdn.com/li.lms-analytics/', '||px.ads.linkedin.com^',
  '||s.pinimg.com/ct/', '||ct.pinterest.com^', '||analytics.tiktok.com^',
  '||redditstatic.com/ads/pixel.js^', '||alb.reddit.com^',
  '||static.ads-twitter.com/uwt.js^', '||analytics.twitter.com^',
  '||scorecardresearch.com^', '||quantserve.com^',
  '||cdn.segment.com/analytics.js/', '||api.segment.io^',
  '||api.mixpanel.com^', '||api-js.mixpanel.com^',
  '||cdn.mxpnl.com/libs/mixpanel', '||api2.amplitude.com^',
  '||cdn.amplitude.com/libs/', '||heapanalytics.com^',
  '||fullstory.com/s/fs.js^', '||rs.fullstory.com^',
  '||cdn.mouseflow.com^', '||o2.mouseflow.com^',
  '||openfpcdn.io/fingerprintjs/', '||fpnpmcdn.net^',
  '/matomo.js^', '/matomo.php^', '/piwik.js^', '/piwik.php^',
];
const ERROR_MONITORING = [
  '||sentry.io^', '||sentry-cdn.com^', '||bugsnag.com^',
  '||d2wy8f7a9ursnm.cloudfront.net/v4/bugsnag.min.js',
];
const block = (urlFilter, id, resourceTypes = REQUEST_TYPES) => ({
  id, priority: 100001, action: { type: 'block' },
  condition: { urlFilter, resourceTypes: [...resourceTypes] },
});

export function privacyRules(state) {
  const rules = [];
  if (state.trackingProtectionEnabled) {
    rules.push(...TRACKING.map((filter, index) => block(filter, 20000 + index)));
    // A telemetry endpoint pattern from EasyPrivacy; don't match /decoy/collect
    // or normal /api/collect paths. Limit it to collection transports.
    rules.push(block('/analytics/collect?', 20500, ['xmlhttprequest', 'ping']));
  }
  if (state.errorMonitoringBlocked) rules.push(...ERROR_MONITORING.map((filter, index) => block(filter, 21000 + index)));
  return rules;
}
