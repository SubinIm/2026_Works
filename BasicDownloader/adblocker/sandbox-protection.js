(() => {
  'use strict';
  // Paired with restrictive Permissions-Policy response headers. Remove only
  // advertising/private-token APIs; keep login, media, storage access and WebAuthn.
  function remove(prototype, names) {
    if (!prototype) return;
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (descriptor?.configurable) Reflect.deleteProperty(prototype, name);
    }
  }
  remove(globalThis.Document?.prototype, ['browsingTopics', 'hasPrivateToken', 'hasRedemptionRecord']);
  remove(globalThis.Navigator?.prototype, [
    'joinAdInterestGroup', 'leaveAdInterestGroup', 'updateAdInterestGroups', 'runAdAuction',
    'clearOriginJoinedAdInterestGroups', 'createAuctionNonce', 'adAuctionComponents',
    'deprecatedURNToURL', 'deprecatedReplaceInURN',
  ]);
  for (const prototype of [globalThis.HTMLAnchorElement?.prototype, globalThis.HTMLImageElement?.prototype,
    globalThis.HTMLScriptElement?.prototype]) remove(prototype, ['attributionSrc']);
})();
