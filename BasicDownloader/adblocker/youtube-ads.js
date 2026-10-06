// Packaged, opt-in MAIN-world script. No remote code, global JSON patch,
// media-server block, user-agent spoof or change to playability errors.
(() => {
  'use strict';
  const hosts = new Set(['www.youtube.com', 'm.youtube.com', 'youtube.com']);
  if (!hosts.has(location.hostname) || window.top !== window) return;
  const marker = Symbol.for('basic-banner-blocker.youtube-ads');
  if (window[marker]) return;
  Object.defineProperty(window, marker, { value: true });
  const parse = JSON.parse, stringify = JSON.stringify;
  const adKeys = ['adPlacements', 'adSlots', 'playerAds'];
  const maxText = 5 * 1024 * 1024;

  // SABR can couple ad slots to the media delivery contract. Removing them can
  // leave the first buffer playable but prevent subsequent segments loading.
  // Preserve the entire selected envelope in this mode; use visible skip controls.
  function preservePlayerContract(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6) return false;
    if (Array.isArray(value)) return value.some(entry => preservePlayerContract(entry, depth + 1));
    const url = value.streamingData?.serverAbrStreamingUrl;
    if (typeof url === 'string' && url.length > 0) return true;
    for (const key of ['playerResponse', 'player', 'response']) {
      if (Object.hasOwn(value, key) && preservePlayerContract(value[key], depth + 1)) return true;
    }
    return Array.isArray(value.entries) && value.entries.some(entry =>
      preservePlayerContract(entry?.command?.reelWatchEndpoint?.playerResponse, depth + 1));
  }

  // Only known player envelopes and explicitly labelled Shorts ads. Ordinary
  // recommendations, signed media URLs, captions and error messages stay intact.
  function prune(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6) return false;
    let changed = false;
    if (Array.isArray(value)) {
      for (const entry of value) changed = prune(entry, depth + 1) || changed;
      return changed;
    }
    for (const key of adKeys) {
      if (Object.hasOwn(value, key)) {
        try { changed = delete value[key] || changed; } catch { /* Frozen data: leave it usable. */ }
      }
    }
    for (const key of ['playerResponse', 'player', 'response']) {
      if (Object.hasOwn(value, key)) changed = prune(value[key], depth + 1) || changed;
    }
    if (Array.isArray(value.entries)) {
      for (let i = value.entries.length - 1; i >= 0; i--) {
        const endpoint = value.entries[i]?.command?.reelWatchEndpoint;
        if (endpoint?.adClientParams?.isAd === true) {
          try { value.entries.splice(i, 1); changed = true; } catch {}
        } else if (endpoint?.playerResponse) changed = prune(endpoint.playerResponse, depth + 1) || changed;
      }
    }
    return changed;
  }
  function cleanText(raw) {
    if (typeof raw !== 'string' || raw.length > maxText) return raw;
    const prefix = raw.startsWith(")]}'") && raw.includes('\n') ? raw.slice(0, raw.indexOf('\n') + 1) : '';
    try {
      const data = parse(raw.slice(prefix.length));
      if (preservePlayerContract(data)) return raw;
      return prune(data) ? prefix + stringify(data) : raw;
    } catch { return raw; }
  }
  function safePrune(value) { try { if (!preservePlayerContract(value)) prune(value); } catch {} }
  function playerRequest(input) {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      return url.protocol === 'https:' && hosts.has(url.hostname) &&
        (/^\/youtubei\/v1\/(?:player|get_watch|reel\/reel_watch_sequence|reel\/reel_item_watch)$/.test(url.pathname) ||
         url.pathname === '/playlist' || url.pathname === '/player' ||
         (url.pathname === '/watch' && url.searchParams.get('pbj') === '1'));
    } catch { return false; }
  }
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, name);
      if (descriptor && !descriptor.configurable) { safePrune(window[name]); continue; }
      if (descriptor && 'value' in descriptor && !descriptor.writable) { safePrune(descriptor.value); continue; }
      let value = descriptor?.value;
      safePrune(value);
      Object.defineProperty(window, name, { configurable: true, enumerable: descriptor?.enumerable ?? true,
        get() { return descriptor?.get ? Reflect.apply(descriptor.get, this, []) : value; },
        set(next) {
          safePrune(next);
          if (descriptor?.set) Reflect.apply(descriptor.set, this, [next]);
          else if (!descriptor?.get) value = next;
        },
      });
    } catch { /* The page may own a non-replaceable property. */ }
  }
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await Reflect.apply(originalFetch, this, args);
      if (!playerRequest(args[0]) || !response.ok || response.bodyUsed ||
          Number(response.headers.get('content-length')) > maxText) return response;
      try {
        const raw = await response.clone().text();
        const clean = cleanText(raw);
        if (clean === raw) return response;
        const headers = new Headers(response.headers);
        // Fetch already decoded the body; stale lengths/encodings would be false.
        for (const header of ['content-length', 'content-encoding', 'etag']) headers.delete(header);
        const replacement = new Response(clean, { status: response.status, statusText: response.statusText, headers });
        // Preserve native Response methods, body readers and clones, plus the
        // network response metadata that a reconstructed Response normally loses.
        const metadata = { url: response.url, redirected: response.redirected, type: response.type };
        const attach = target => {
          for (const [key, value] of Object.entries(metadata)) Object.defineProperty(target, key, { value, configurable: true });
          const clone = target.clone;
          Object.defineProperty(target, 'clone', { configurable: true, value: function () { return attach(Reflect.apply(clone, this, [])); } });
          return target;
        };
        // The clone has finished. Cancel the unused original branch without
        // waiting on a tee cancellation promise, which can otherwise stall.
        const result = attach(replacement);
        response.body?.cancel().catch(() => {});
        return result;
      } catch { return response; }
    };
  }
  if (typeof XMLHttpRequest === 'function') {
    const prototype = XMLHttpRequest.prototype, requests = new WeakMap();
    const originalOpen = prototype.open;
    prototype.open = function (...args) {
      const result = Reflect.apply(originalOpen, this, args);
      requests.set(this, { selected: playerRequest(args[1]) });
      return result;
    };
    for (const property of ['responseText', 'response']) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (!descriptor?.configurable || !descriptor.get) continue;
      Object.defineProperty(prototype, property, { ...descriptor, get() {
        const raw = Reflect.apply(descriptor.get, this, []); // Native errors still throw.
        const request = requests.get(this);
        if (!request?.selected || this.readyState !== 4 || this.status < 200 || this.status >= 300) return raw;
        if (property === 'response' && this.responseType === 'json') {
          if (!Object.hasOwn(request, 'json')) { safePrune(raw); request.json = raw; }
          return request.json;
        }
        if (typeof raw !== 'string') return raw;
        if (request.raw !== raw) { request.raw = raw; request.clean = cleanText(raw); }
        return request.clean;
      } });
    }
  }

  // The current skip UI rejects synthetic clicks. For that UI, only finish a
  // separate ad media segment once its skip button is available. Do not seek a
  // combined/main stream, unknown player state or a stale SPA response.
  function finishSeparateAd(player) {
    try {
      const details = window.ytInitialPlayerResponse?.videoDetails;
      const id = new URL(location.href).searchParams.get('v');
      const mainDuration = Number(details?.lengthSeconds);
      const progress = player.getProgressState?.();
      const videos = player.querySelectorAll('video');
      if (!id || details?.videoId !== id || videos.length !== 1 ||
          progress?.allowSeeking !== false ||
          !Number.isFinite(mainDuration) || mainDuration <= 0) return false;
      const video = videos[0], duration = video.duration;
      if (video.readyState < 2 || video.paused || video.seeking || video.ended || !Number.isFinite(duration) || duration <= 1 ||
          duration - video.currentTime < 0.25 ||
          Math.abs(mainDuration - duration) < 2 || !Number.isFinite(progress.duration) ||
          Math.abs(progress.duration - duration) > 1) return false;
      const target = duration - 0.05;
      let seekable = false;
      for (let i = 0; i < video.seekable.length; i++) {
        if (video.seekable.start(i) <= target && video.seekable.end(i) >= target) seekable = true;
      }
      if (!seekable) return false;
      video.currentTime = target;
      return true;
    } catch { return false; }
  }

  // Fallback uses visible, enabled controls only. Never change volume or rate.
  const clicked = new WeakMap();
  const setTimer = window.setTimeout.bind(window), clearTimer = window.clearTimeout.bind(window);
  const now = performance.now.bind(performance);
  let lastMediaScan = -250;
  let timer;
  function visible(element) {
    if (!element.isConnected || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' &&
      !!element.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true });
  }
  function scan() {
    timer = undefined;
    let active = false;
    for (const player of document.querySelectorAll('#movie_player.html5-video-player, #shorts-player.html5-video-player')) {
      if (!player.matches('.ad-showing, .ad-interrupting') || !visible(player)) continue;
      active = true;
      for (const button of player.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button')) {
        if (!visible(button) || Date.now() - (clicked.get(button) || 0) < 1000) continue;
        clicked.set(button, Date.now());
        if (button.matches('.ytp-skip-ad-button')) finishSeparateAd(player);
        else button.click();
        break;
      }
    }
    if (active) timer = setTimer(scan, 500);
  }
  function schedule() { if (timer === undefined) timer = setTimer(scan, 50); }
  // CSS/layout changes do not necessarily mutate the DOM. Media progress also
  // wakes the fallback when a background tab's scheduled timer was throttled.
  function wake(event) {
    if (event?.type === 'visibilitychange' && document.visibilityState !== 'visible') return;
    if (event?.target instanceof HTMLMediaElement) {
      if (!event.target.closest('#movie_player.html5-video-player, #shorts-player.html5-video-player')) return;
      const current = now();
      if (current - lastMediaScan < 250) return;
      lastMediaScan = current;
    }
    clearTimer(timer);
    timer = undefined;
    scan();
  }
  new MutationObserver(schedule).observe(document, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'disabled', 'aria-disabled', 'hidden', 'style'] });
  document.addEventListener('yt-navigate-finish', wake);
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('resize', wake);
  for (const name of ['timeupdate', 'playing', 'loadeddata']) document.addEventListener(name, wake, true);
  schedule();
})();
