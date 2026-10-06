(() => {
  'use strict';
  // Opt-in preference paired with Sec-GPC: 1 on real HTTP requests.
  // Do not replace a native true signal, DNT, consent state, or other APIs.
  if (navigator.globalPrivacyControl === true) return;
  const target = Navigator.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(target, 'globalPrivacyControl');
  if (!descriptor || descriptor.configurable) Object.defineProperty(target, 'globalPrivacyControl', {
    configurable: true, enumerable: true, get() { return true; },
  });
})();
