// Persistent document-start registration avoids a settings-message race with
// page scripts. Top-level documents only: paused sites never inherit a patch.
export const PROTECTION_SCRIPT_IDS = ['basic-fingerprint-protection', 'basic-gpc-signal', 'basic-sandbox-protection', 'basic-youtube-ads'];
export function protectionRegistrations(state) {
  if (!state.enabled) return [];
  const excludeMatches = state.disabledSites.flatMap(host => [
    `*://${host}/*`, ...(/^\d+(?:\.\d+){3}$/.test(host) ? [] : [`*://*.${host}/*`]),
  ]);
  return [
    [state.fingerprintProtectionEnabled, PROTECTION_SCRIPT_IDS[0], 'fingerprint-protection.js'],
    [state.globalPrivacyControlEnabled, PROTECTION_SCRIPT_IDS[1], 'gpc-signal.js'],
    [state.privacySandboxBlocked, PROTECTION_SCRIPT_IDS[2], 'sandbox-protection.js'],
    [state.youtubeAdBlockingEnabled, PROTECTION_SCRIPT_IDS[3], 'youtube-ads.js', ['https://www.youtube.com/*', 'https://m.youtube.com/*', 'https://youtube.com/*']],
  ].filter(([enabled]) => enabled).map(([, id, file, matches]) => ({ id, js: [file],
    matches: matches || ['http://*/*', 'https://*/*'], excludeMatches,
    allFrames: false, runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true }));
}

// Additional policies restrict use in documents/descendants; existing policies
// remain present. API surface reduction alone is not a browser-level denial.
export const SANDBOX_POLICY = [
  'browsing-topics', 'join-ad-interest-group', 'run-ad-auction',
  'attribution-reporting', 'private-aggregation', 'shared-storage',
  'private-state-token-issuance', 'private-state-token-redemption',
].map(feature => `${feature}=()`).join(', ');

export function privacyApiRules(state) {
  const rules = [];
  if (state.globalPrivacyControlEnabled) rules.push({ id: 23000, priority: 100001,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] },
    // DNR omits main_frame when resourceTypes is unspecified. Include the
    // navigation explicitly so the document's JS signal agrees with its header.
    condition: { urlFilter: '|http', resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script',
      'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'] } });
  if (state.privacySandboxBlocked) rules.push({ id: 23001, priority: 100001,
    action: { type: 'modifyHeaders', responseHeaders: [{ header: 'Permissions-Policy', operation: 'append', value: SANDBOX_POLICY }] },
    condition: { urlFilter: '|http', resourceTypes: ['main_frame', 'sub_frame'] } });
  return rules;
}

export function videoRules(state) {
  if (!state.videoAdBlockingEnabled) return [];
  // The generic IMA/VAST mode must not override the banner rules' YouTube
  // exclusions. These requests can be part of the player's delivery contract.
  const excludedInitiatorDomains = ['youtube.com', 'youtube-nocookie.com', 'youtu.be'];
  return [
    { id: 22000, priority: 100001, action: { type: 'block' }, condition: {
      urlFilter: '||imasdk.googleapis.com/js/sdkloader/ima3.js^', resourceTypes: ['script'], excludedInitiatorDomains } },
    { id: 22001, priority: 100001, action: { type: 'block' }, condition: {
      urlFilter: '||googleads.g.doubleclick.net/pagead/ads?', resourceTypes: ['xmlhttprequest'], excludedInitiatorDomains } },
  ];
}
