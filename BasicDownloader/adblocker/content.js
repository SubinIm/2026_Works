(() => {
  'use strict';

  // Chrome may inject into an ad's about:blank/srcdoc/blob frame using its
  // initiator origin. Only the background's trusted sender context grants scope.
  if (!/^(https?:|about:|blob:|data:)$/.test(location.protocol)) return;

  const token = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('');
  const hiddenAttribute = `data-basic-block-${token}`;
  const previewAttribute = `data-basic-preview-${token}`;
  const offscreenAttribute = `data-basic-offscreen-${token}`;
  const offscreenTranslation = '-100000px -100000px';
  const genericSelectors = [
    'ins.adsbygoogle',
    'div[data-ad-client][data-ad-slot]',
    'iframe[id^="google_ads_iframe_"]',
    'div[aria-label="Advertisement"]',
    'aside[aria-label="Advertisement"]',
    'div[aria-label="광고"][data-ad-slot]',
    ':is(article, [role="article"]).sponsored-post[aria-label="Sponsored"]',
    '.social-feed-ad[data-ad-type="social_feed"]',
  ];
  const naverSelectors = [
    '#timeboard-ex',
    '#right-ad-1',
    '#right-ad-2',
    '[id^="pc-main-ad-div-"]',
    '#p_main_linebanner_bottom',
    'iframe[title="AD"][id$="_tgtLREC"]',
    'iframe[title="right-shopping"][src^="https://recoshopping.naver.com/"]',
  ];
  // DCInside inserts promotional rows among normal comments. Their content,
  // position, and even duplicated comment_li_0 IDs are not stable identifiers.
  // Match the dedicated outer rows so regular comments/replies remain intact.
  const dcinsideSelectors = [
    '.comment_box ul.cmt_list > li.power_link.cmt_power_link',
    '.comment_box ul.cmt_list > li.ub-content.dory',
    '.view_ad_wrap > div.power_link:has(.adicon)',
  ];
  const protectedTags = new Set(['HTML', 'BODY', 'HEAD', 'MAIN', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK']);
  const protectedIds = new Set(['root', 'app', '__next', '__nuxt', 'main', 'content', 'main-content']);
  const hiddenElements = new Set();
  const offscreenElements = new Set();
  const autoHiddenElements = new Set();
  const manualHiddenElements = new Set();
  const previousDisplays = new Map();
  const decorationStyles = new Map();
  const previousTranslations = new Map();
  const previousMoveDisplays = new Map();
  const appliedStyles = new WeakMap();
  const layoutDirtyElements = new Set();
  const uiHosts = new WeakSet();
  let context = { enabled: false, publicFiltersEnabled: false, site: null, frameHost: null, rules: [] };
  let contextReady = false;
  let styleElement = null;
  let publicStyleElement = null;
  let publicStyleTextNode = null;
  let publicStyleDirty = false;
  let publicCss = null;
  let publicCssPending = null;
  let publicCssError = null;
  let rightClickTarget = null;
  let picker = null;
  let selectionMode = null;
  let toastHost = null;
  let refreshVersion = 0;
  let applyTimer = null;
  let remotePanel = null;
  let lastRemoteSession = null;
  let lastFrameToken = null;
  let remoteUndo = null;

  async function send(message) {
    try { return await chrome.runtime.sendMessage(message); }
    catch { return { ok: false, error: '확장 프로그램 연결이 끊겼습니다. 페이지를 새로고침해 주세요.' }; }
  }

  function belongsToUi(element) {
    return Boolean(element && (element === picker?.host || picker?.host.contains(element) || element === remotePanel?.host || remotePanel?.host.contains(element) || element === selectionMode?.host || selectionMode?.host.contains(element) || element === toastHost || toastHost?.contains(element)));
  }

  function isSafeElement(element, checkSize = true) {
    if (!(element instanceof Element) || !element.isConnected || element.ownerDocument !== document || belongsToUi(element)) return false;
    if (protectedTags.has(element.tagName) || protectedIds.has((element.id || '').toLowerCase())) return false;
    if (element.matches('[role="main"], [contenteditable="true"]') || element.querySelector('main, [role="main"], video, audio')) return false;
    if ((element.textContent || '').length > 5000 || element.querySelectorAll('input, button, select, textarea, a[href]').length > 45) return false;
    if (checkSize) {
      const rect = element.getBoundingClientRect();
      const viewportArea = Math.max(1, innerWidth * innerHeight);
      const visibleArea = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      if ((window === window.top || viewportArea > 200000) && visibleArea / viewportArea > 0.82) return false;
    }
    return true;
  }

  function query(selector) {
    if (typeof selector !== 'string' || selector.length > 2048 || /[{};\u0000-\u001f]/.test(selector)) return [];
    try { return Array.from(document.querySelectorAll(selector)); } catch { return []; }
  }

  function syncDcinsideDecorationStyles() {
    // This dedicated sheet makes the article background transparent as well as
    // animating the mascot. Hiding a STYLE node does not disable its CSS.
    const sheets = context.enabled && context.frameHost === 'gall.dcinside.com'
      ? query('body > style#styleGaejuki').filter(element =>
        element.textContent.includes('.moveimg') && /@keyframes\s+mymove\b/.test(element.textContent)) : [];
    const desired = new Set(sheets.length === 1 ? sheets : []);
    for (const [element, original] of decorationStyles) {
      if (desired.has(element)) continue;
      if (element.getAttribute('media') === 'not all') {
        if (original === null) element.removeAttribute('media');
        else element.setAttribute('media', original);
      }
      decorationStyles.delete(element);
    }
    for (const element of desired) {
      // Retain newer page-written media values when temporarily overriding them.
      if (!decorationStyles.has(element) || element.getAttribute('media') !== 'not all') {
        decorationStyles.set(element, element.getAttribute('media'));
        element.setAttribute('media', 'not all');
      }
    }
    return desired.size > 0;
  }

  function dcinsideDecorations(hasSheet) {
    if (!hasSheet) return [];
    const mascots = query('body > div#gaejukimg').filter(element => {
      if (element.children.length !== 1 || element.textContent.trim()) return false;
      const image = element.firstElementChild;
      if (image.tagName !== 'IMG') return false;
      try {
        const url = new URL(image.src);
        return url.hostname === 'nstatic.dcinside.com' && url.pathname === '/dc/w/images/moveimg.png';
      } catch { return false; }
    });
    if (mascots.length !== 1) return [];
    // The same mascot script temporarily inserts a full-screen click blocker.
    // Exact structure and sheet/mascot checks keep ordinary dialogs untouched.
    const blockers = query('body > div.click-blocker').filter(element => {
      if (element.children.length || element.textContent.trim()) return false;
      const css = getComputedStyle(element);
      return css.position === 'fixed' && [css.top, css.right, css.bottom, css.left].every(value => value === '0px');
    });
    return [...mascots, ...(blockers.length <= 4 ? blockers : [])];
  }

  function sportsSeoulBanners() {
    if (!['sportsseoul.com', 'www.sportsseoul.com'].includes(context.frameHost)) return [];
    // These outer rail slots use changing IDs/classes and blank-source frames.
    // Match their observed, site-specific structure rather than random names or
    // banner dimensions alone, independent of their moved viewport coordinates.
    return query('main#container > section.contents > span').filter(element => {
      if (getComputedStyle(element).position !== 'fixed') return false;
      const children = Array.from(element.children);
      if (children.some(child => !['STYLE', 'DIV'].includes(child.tagName))) return false;
      const boxes = children.filter(child => child.tagName === 'DIV');
      if (boxes.length !== 1 || boxes[0].children.length !== 1) return false;
      const frame = boxes[0].firstElementChild;
      if (frame.tagName !== 'IFRAME' || !frame.hasAttribute('src') || frame.getAttribute('src').trim() || frame.hasAttribute('srcdoc')) return false;
      if (frame.getAttribute('status') !== 'success' || frame.getAttribute('width')?.trim() !== '160' || frame.getAttribute('height')?.trim() !== '600') return false;
      // Preserve a rail if it ever contains real content in addition to the ad.
      const hasText = node => Array.from(node.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
      return !hasText(element) && !boxes[0].textContent.trim();
    });
  }

  function ensureStyle() {
    if (!document.documentElement) return;
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.textContent = `body [${hiddenAttribute}], body [${previewAttribute}] { display: none !important; }`;
    }
    if (!styleElement.isConnected) document.documentElement.append(styleElement);
  }

  function syncPublicStyle() {
    const active = context.enabled && context.publicFiltersEnabled && publicCss?.cssText;
    if (!active) {
      publicStyleElement?.remove();
      // A detached node can be edited without an observed mutation. Verify its
      // text once when enabling again, rather than on every page mutation.
      publicStyleDirty = true;
      return;
    }
    if (!document.documentElement) return;
    if (!publicStyleElement) {
      publicStyleElement = document.createElement('style');
      publicStyleDirty = true;
    }
    if (publicStyleDirty) {
      if (publicStyleElement.textContent !== publicCss.cssText || publicStyleElement.childNodes.length !== 1 || publicStyleElement.firstChild.nodeType !== Node.TEXT_NODE) {
        publicStyleElement.textContent = publicCss.cssText;
      }
      publicStyleTextNode = publicStyleElement.firstChild;
      publicStyleElement.removeAttribute('media');
      publicStyleElement.removeAttribute('type');
      publicStyleElement.removeAttribute('disabled');
      publicStyleDirty = false;
    }
    if (!publicStyleElement.isConnected) document.documentElement.append(publicStyleElement);
    // The disabled property changes CSSOM state without a DOM mutation. This
    // cheap check also runs when the popup requests status; no CSS text scan.
    if (publicStyleElement.disabled) publicStyleElement.disabled = false;
    if (publicStyleElement.sheet?.disabled) publicStyleElement.sheet.disabled = false;
  }

  function loadPublicCosmetics() {
    if (!context.enabled || !context.publicFiltersEnabled || publicCss || publicCssPending) return;
    publicCssPending = (async () => {
      const response = await send({ type: 'GET_PUBLIC_COSMETICS' });
      if (!response?.ok || !response.selection) throw new Error(response?.error || '공개 숨김 필터를 불러오지 못했습니다.');
      if (!globalThis.BasicPublicCosmetics?.compileSelection) throw new Error('페이지를 새로고침해 공개 숨김 필터를 연결해 주세요.');
      // Native CSS applies to newly inserted ads without scanning the page for
      // thousands of public selectors on every DOM mutation.
      publicCss = globalThis.BasicPublicCosmetics.compileSelection(response.selection);
      publicCssError = null;
      syncPublicStyle();
    })().catch(error => { publicCssError = error.message; }).finally(() => { publicCssPending = null; });
  }

  function setHidden(element, attribute, hidden) {
    if (hidden) {
      const alreadyForced = element.style.getPropertyValue('display') === 'none' && element.style.getPropertyPriority('display') === 'important';
      if (!previousDisplays.has(element) || !alreadyForced) previousDisplays.set(element, { value: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display') });
      if (!element.hasAttribute(attribute)) element.setAttribute(attribute, '');
      if (!alreadyForced) element.style.setProperty('display', 'none', 'important');
      appliedStyles.set(element, element.getAttribute('style'));
      return;
    }
    if (element.hasAttribute(attribute)) element.removeAttribute(attribute);
    if (element.hasAttribute(hiddenAttribute) || element.hasAttribute(previewAttribute)) return;
    const previous = previousDisplays.get(element);
    // Keep a newer inline display value set by the page while the element was hidden.
    if (previous && element.style.getPropertyValue('display') === 'none' && element.style.getPropertyPriority('display') === 'important') {
      if (previous.value) element.style.setProperty('display', previous.value, previous.priority);
      else element.style.removeProperty('display');
    }
    previousDisplays.delete(element);
    appliedStyles.set(element, element.getAttribute('style'));
  }

  function setOffscreen(element, offscreen) {
    const alreadyForced = element.style.getPropertyValue('translate') === offscreenTranslation && element.style.getPropertyPriority('translate') === 'important';
    if (offscreen) {
      if (!previousTranslations.has(element) || !alreadyForced) {
        previousTranslations.set(element, { value: element.style.getPropertyValue('translate'), priority: element.style.getPropertyPriority('translate') });
      }
      if (!element.hasAttribute(offscreenAttribute)) element.setAttribute(offscreenAttribute, '');
      // A non-replaced inline box does not accept CSS transforms. Give it a
      // transformable box without detaching its children or replacing frames.
      // Replaced inline elements (images/iframes/etc.) already accept translate.
      if (getComputedStyle(element).display === 'inline' && !['IMG', 'IFRAME', 'INPUT', 'OBJECT', 'EMBED', 'CANVAS'].includes(element.tagName)) {
        previousMoveDisplays.set(element, { value: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display') });
        element.style.setProperty('display', 'inline-block', 'important');
      }
      // Individual translate preserves the page's transform and iframe identity.
      if (!alreadyForced) element.style.setProperty('translate', offscreenTranslation, 'important');
    } else {
      if (element.hasAttribute(offscreenAttribute)) element.removeAttribute(offscreenAttribute);
      const previous = previousTranslations.get(element);
      // A newer page-written value wins even if pause beats the observer.
      if (previous && alreadyForced) {
        if (previous.value) element.style.setProperty('translate', previous.value, previous.priority);
        else element.style.removeProperty('translate');
      }
      previousTranslations.delete(element);
      const previousDisplay = previousMoveDisplays.get(element);
      if (previousDisplay && element.style.getPropertyValue('display') === 'inline-block' && element.style.getPropertyPriority('display') === 'important') {
        if (previousDisplay.value) element.style.setProperty('display', previousDisplay.value, previousDisplay.priority);
        else element.style.removeProperty('display');
      }
      previousMoveDisplays.delete(element);
    }
    appliedStyles.set(element, element.getAttribute('style'));
  }

  function applyRules() {
    if (applyTimer !== null) clearTimeout(applyTimer);
    applyTimer = null;
    ensureStyle();
    syncPublicStyle();
    const hasDecorationSheet = syncDcinsideDecorationStyles();
    const desired = new Set();
    const desiredOffscreen = new Set();
    autoHiddenElements.clear();
    manualHiddenElements.clear();
    // Keep unchanged matches hidden. Only relevant external changes require
    // restoring their display to recheck the size guard before the next paint.
    // Also detect a page style write when status/context refresh beats the observer.
    for (const element of hiddenElements) {
      if (appliedStyles.get(element) !== element.getAttribute('style')) layoutDirtyElements.add(element);
      if (layoutDirtyElements.has(element)) setHidden(element, hiddenAttribute, false);
    }
    for (const element of offscreenElements) {
      if (appliedStyles.get(element) !== element.getAttribute('style')) layoutDirtyElements.add(element);
      if (layoutDirtyElements.has(element)) setOffscreen(element, false);
    }
    const safety = new Map();
    if (context.enabled && context.site && context.frameHost) {
      const selectors = [
        ...genericSelectors.map(selector => ({ selector, limit: 50, manual: false })),
        ...(['naver.com', 'www.naver.com'].includes(context.frameHost) ? naverSelectors.map(selector => ({ selector, limit: 50, manual: false })) : []),
        ...(context.frameHost === 'gall.dcinside.com' ? dcinsideSelectors.map(selector => ({ selector, limit: 50, manual: false })) : []),
        ...context.rules.filter(rule => rule.enabled !== false && rule.site === context.site && rule.frameHost === context.frameHost).map(rule => ({ selector: rule.selector, limit: 1, manual: true, action: rule.action === 'move' ? 'move' : 'hide' })),
      ];
      const manualHides = new Set();
      const manualMoves = new Set();
      for (const element of dcinsideDecorations(hasDecorationSheet)) {
        // The known full-screen blocker is empty; retain all other safety guards.
        if (isSafeElement(element, false)) {
          desired.add(element);
          autoHiddenElements.add(element);
        }
      }
      for (const { selector, limit, manual, action } of selectors) {
        const matches = query(selector);
        // Unexpectedly broad selectors should never blank a document after a layout change.
        if (matches.length > limit) continue;
        for (const element of matches) {
          if (!safety.has(element)) safety.set(element, isSafeElement(element, (!hiddenElements.has(element) && !offscreenElements.has(element)) || layoutDirtyElements.has(element)));
          if (safety.get(element)) {
            if (manual && action === 'move') {
              if (!canMoveElement(element)) continue;
              desiredOffscreen.add(element);
              manualMoves.add(element);
            } else {
              desired.add(element);
              if (manual) manualHides.add(element);
            }
            (manual ? manualHiddenElements : autoHiddenElements).add(element);
          }
        }
      }
      // Manual relocation overrides automatic hiding for the same element.
      // Two explicit overlapping rules still favor hide over relocation.
      for (const element of manualMoves) {
        if (!manualHides.has(element)) desired.delete(element);
        else desiredOffscreen.delete(element);
        autoHiddenElements.delete(element);
      }
      const railBanners = sportsSeoulBanners();
      if (railBanners.length <= 8) {
        for (const element of railBanners) {
          if (isSafeElement(element, (!hiddenElements.has(element) && !offscreenElements.has(element)) || layoutDirtyElements.has(element))) {
            // An explicit user rule still takes precedence. Otherwise these
            // rails use relocation instead of display:none, including matches
            // from another automatic selector. Count each rail only once.
            if (!manualHiddenElements.has(element)) {
              desired.delete(element);
              desiredOffscreen.add(element);
              autoHiddenElements.add(element);
            } else {
              autoHiddenElements.delete(element);
            }
          }
        }
      }
    }
    if (context.enabled && picker?.action === 'move' && picker.previewing && isSafeElement(picker.selected, false)) {
      desiredOffscreen.add(picker.selected);
    }
    for (const element of offscreenElements) {
      if (!desiredOffscreen.has(element)) {
        setOffscreen(element, false);
        offscreenElements.delete(element);
      }
    }
    for (const element of hiddenElements) {
      if (!desired.has(element)) {
        setHidden(element, hiddenAttribute, false);
        hiddenElements.delete(element);
      }
    }
    for (const element of desired) {
      if (!hiddenElements.has(element) || !element.hasAttribute(hiddenAttribute) || element.style.getPropertyValue('display') !== 'none' || element.style.getPropertyPriority('display') !== 'important') {
        setHidden(element, hiddenAttribute, true);
        hiddenElements.add(element);
      }
    }
    for (const element of desiredOffscreen) {
      setOffscreen(element, true);
      offscreenElements.add(element);
    }
    layoutDirtyElements.clear();
    if (picker && !picker.selected.isConnected) {
      closePicker();
      showToast('선택한 요소가 사라졌습니다. 광고를 다시 우클릭해 주세요.');
    }
  }

  function scheduleApply() {
    if (applyTimer === null) applyTimer = setTimeout(applyRules, 40);
  }

  async function refreshContext() {
    const version = ++refreshVersion;
    const response = await send({ type: 'GET_CONTEXT' });
    if (version !== refreshVersion) return;
    contextReady = Boolean(response?.ok);
    context = response?.ok ? {
      enabled: Boolean(response.enabled),
      publicFiltersEnabled: Boolean(response.publicFiltersEnabled),
      site: response.site || null,
      frameHost: response.frameHost || null,
      rules: Array.isArray(response.rules) ? response.rules : [],
    } : { enabled: false, publicFiltersEnabled: false, site: null, frameHost: null, rules: [] };
    if (!context.enabled && picker) closePicker();
    if (!context.enabled) closeSelectionMode();
    applyRules();
    loadPublicCosmetics();
  }

  function pageStatus() {
    if (!contextReady) return { ok: false, ready: false, error: '페이지 연결을 확인하는 중입니다. 잠시 후 다시 열어 주세요.' };
    applyRules();
    const count = elements => Array.from(elements).filter(element => {
      if (!element.isConnected) return false;
      if (element.hasAttribute(hiddenAttribute) && getComputedStyle(element).display === 'none') return true;
      if (!element.hasAttribute(offscreenAttribute)) return false;
      const rect = element.getBoundingClientRect();
      return rect.right <= 0 && rect.bottom <= 0;
    }).length;
    return {
      ok: true, ready: true, enabled: context.enabled,
      autoHiddenCount: count(autoHiddenElements), manualHiddenCount: count(manualHiddenElements),
      publicCosmeticsEnabled: Boolean(context.enabled && context.publicFiltersEnabled && publicCss),
      publicSelectorCount: publicCss?.selectors.length || 0,
      publicCosmeticsError: context.enabled && context.publicFiltersEnabled ? publicCssError : null,
    };
  }

  function stable(value) {
    return value && value.length < 80 &&
      !(/^[a-z\d]{14,}$/i.test(value) && /\d/.test(value)) &&
      !/\d{5,}|[a-f\d]{12,}|^:r|^(active|selected|open|closed|hidden|visible|focus|hover)$/i.test(value);
  }

  function unique(selector, element) {
    const matches = query(selector);
    return matches.length === 1 && matches[0] === element;
  }

  function stableSelector(element, requireUnique = true) {
    const escape = CSS.escape;
    if (stable(element.id)) {
      const selector = `#${escape(element.id)}`;
      if (!requireUnique || unique(selector, element)) return selector;
    }
    const tag = element.localName;
    const classes = Array.from(element.classList).filter(stable).sort((a, b) => Number(/ad|banner|sponsor/i.test(b)) - Number(/ad|banner|sponsor/i.test(a))).slice(0, 6);
    for (const className of classes) {
      const selector = `${tag}.${escape(className)}`;
      if (!requireUnique || unique(selector, element)) return selector;
    }
    for (let count = 2; count <= Math.min(classes.length, 4); count++) {
      const selector = `${tag}${classes.slice(0, count).map(value => `.${escape(value)}`).join('')}`;
      if (!requireUnique || unique(selector, element)) return selector;
    }
    return null;
  }

  function sportsSeoulSlotSelector(element) {
    if (!['sportsseoul.com', 'www.sportsseoul.com'].includes(context.frameHost)) return null;
    const slot = element.closest('span');
    if (!slot || !slot.closest('main#container > section.contents')) return null;
    const boxes = Array.from(slot.children).filter(child => child.tagName === 'DIV');
    if (boxes.length !== 1 || Array.from(slot.children).some(child => !['STYLE', 'DIV'].includes(child.tagName))) return null;
    const box = boxes[0], frame = box.firstElementChild;
    if (box.children.length !== 1 || frame?.tagName !== 'IFRAME' || frame.getAttribute('src') !== '' || frame.hasAttribute('srcdoc')) return null;
    if (![slot, box, frame].includes(element) || box.textContent.trim() ||
        Array.from(slot.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) return null;
    const width = frame.getAttribute('width')?.trim(), height = frame.getAttribute('height')?.trim();
    if (!/^(?:\d{2,4}|100%)$/.test(width || '') || !/^\d{2,4}$/.test(height || '')) return null;
    const anchor = stableSelector(slot.parentElement);
    if (!anchor) return null;
    // The site's ad IDs/classes change on reload. Save the enclosing slot's
    // stable parent and frame dimensions; don't depend on ad creative or status.
    const selector = `${anchor} > span:has(> div > iframe:only-child[src=""][width~="${width}"][height~="${height}"])${element === slot ? '' : element === box ? ' > div' : ' > div > iframe'}`;
    return unique(selector, element) ? { selector, structural: false } : null;
  }

  function selectorFor(element) {
    const slot = sportsSeoulSlotSelector(element);
    if (slot) return slot;
    const direct = stableSelector(element);
    if (direct) return { selector: direct, structural: false };
    const segments = [];
    let cursor = element;
    while (cursor && cursor !== document.body && cursor !== document.documentElement) {
      const anchor = cursor !== element ? stableSelector(cursor) : null;
      if (anchor) {
        const selector = `${anchor} > ${segments.join(' > ')}`;
        if (unique(selector, element)) return { selector, structural: true };
      }
      const siblings = cursor.parentElement ? Array.from(cursor.parentElement.children).filter(sibling => sibling.localName === cursor.localName) : [cursor];
      const simple = stableSelector(cursor, false) || cursor.localName;
      segments.unshift(`${simple}:nth-of-type(${siblings.indexOf(cursor) + 1})`);
      cursor = cursor.parentElement;
      if (segments.join(' > ').length > 1900) return null;
    }
    const selector = `body > ${segments.join(' > ')}`;
    return unique(selector, element) ? { selector, structural: true } : null;
  }

  function labelFor(element) {
    const text = (element.getAttribute('aria-label') || element.getAttribute('alt') || element.textContent || '').replace(/\s+/g, ' ').trim();
    return `${element.localName}${element.id ? `#${element.id}` : ''}${text ? ` · ${text.slice(0, 70)}` : ''}`.slice(0, 120);
  }

  function el(tag, attributes = {}, text = '') {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.textContent = text;
    return node;
  }

  const panelCss = `
    :host { all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; color-scheme: light !important; }
    *, *::before, *::after { box-sizing: border-box; }
    .outline { position: fixed; border: 3px solid #2563eb; background: #2563eb18; pointer-events: none; border-radius: 3px; }
    .panel { position: fixed; top: 12px; right: 12px; width: min(352px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; pointer-events: auto; background: #fff; color: #152238; border: 1px solid #d5dbe5; border-radius: 14px; box-shadow: 0 10px 40px #0004; padding: 18px; font: 14px/1.55 system-ui, sans-serif; text-align: left; }
    h2 { margin: 0 0 8px; font-size: 17px; line-height: 1.4; }
    p { margin: 8px 0; overflow-wrap: anywhere; }
    .scope { font-size: 12px; color: #64748b; }
    .selection { padding: 9px; background: #f1f5f9; border-radius: 7px; font-size: 12px; word-break: break-all; }
    .notice { color: #475569; font-size: 12px; min-height: 20px; }
    .error { color: #b42318; }
    .buttons { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
    button { appearance: none; border: 1px solid #cbd5e1; border-radius: 7px; padding: 7px 10px; background: #fff; color: #1e293b; font: inherit; font-size: 12px; cursor: pointer; }
    button:hover { background: #eff6ff; }
    button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
    button:disabled { opacity: .45; cursor: default; }
    .save { background: #2563eb; border-color: #2563eb; color: #fff; }
    .save:hover { background: #1d4ed8; }
    @media (max-height: 220px) { .panel { top: 4px; right: 4px; padding: 8px; max-height: calc(100vh - 8px); } p { margin: 4px 0; } }
  `;

  function updateOutline() {
    if (!picker) return;
    const rect = picker.selected.getBoundingClientRect();
    const left = Math.max(0, Math.min(innerWidth, rect.left));
    const top = Math.max(0, Math.min(innerHeight, rect.top));
    const width = Math.max(0, Math.min(innerWidth, rect.right) - left);
    const height = Math.max(0, Math.min(innerHeight, rect.bottom) - top);
    Object.assign(picker.outline.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, display: picker.previewing || !width || !height ? 'none' : 'block' });
  }

  function canMoveElement(element) {
    const display = getComputedStyle(element).display;
    return !['contents', 'table-column', 'table-column-group'].includes(display) && (display !== 'none' || hiddenElements.has(element));
  }

  function previewLabel(action) { return action === 'move' ? '이동 미리보기' : '숨김 미리보기'; }

  function setPreview(enabled) {
    if (!picker) return;
    picker.previewing = enabled;
    if (picker.action === 'move') {
      applyRules();
      if (enabled) {
        const rect = picker.selected.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.right > 0 || rect.bottom > 0) {
          picker.previewing = enabled = false;
          applyRules();
          picker.notice.textContent = '이 요소는 화면 밖으로 옮길 수 없습니다. 상위 영역을 선택해 주세요.';
          picker.notice.classList.add('error');
          picker.saveButton.disabled = true;
        }
      }
    } else setHidden(picker.selected, previewAttribute, enabled);
    picker.previewButton.textContent = enabled ? '미리보기 되돌리기' : previewLabel(picker.action);
    picker.previewButton.setAttribute('aria-pressed', String(enabled));
    picker.parentButton.disabled = enabled || !isSafeElement(picker.selected.parentElement);
    picker.childButton.disabled = enabled || !picker.children.length;
    updateOutline();
    publishPickerView();
  }

  function selectElement(element, previous = null) {
    if (!picker || !isSafeElement(element)) return false;
    setPreview(false);
    picker.selected = element;
    picker.children = Array.from(element.children).filter(child => isSafeElement(child) && child.getBoundingClientRect().width > 0 && child.getBoundingClientRect().height > 0);
    picker.preferredChild = picker.children.includes(previous) ? previous : picker.children[0];
    picker.selector = selectorFor(element);
    picker.label.textContent = labelFor(element);
    picker.notice.classList.remove('error');
    picker.notice.textContent = picker.selector?.structural ? '페이지 구조를 이용한 규칙입니다. 사이트가 바뀌면 다시 선택해야 할 수 있습니다.' : picker.action === 'move' ? '저장하면 이 사이트의 같은 영역을 화면 밖으로 옮깁니다. 광고 요청과 원래 자리의 여백은 남을 수 있습니다.' : '저장하면 이 사이트의 같은 광고 영역을 계속 숨깁니다.';
    if (!picker.selector) picker.notice.textContent = '안전한 규칙을 만들 수 없습니다. 더 작은 영역을 선택해 주세요.';
    const unsupportedMove = picker.action === 'move' && !canMoveElement(element);
    if (unsupportedMove) picker.notice.textContent = '이 요소에는 이동할 수 있는 영역이 없습니다. 상위 또는 하위 영역을 선택해 주세요.';
    picker.saveButton.disabled = !picker.selector || unsupportedMove;
    picker.previewButton.disabled = !picker.selector || unsupportedMove;
    picker.parentButton.disabled = !isSafeElement(element.parentElement);
    picker.childButton.disabled = !picker.children.length;
    updateOutline();
    publishPickerView();
    return true;
  }

  function closePicker(notify = true) {
    if (!picker) return;
    const old = picker;
    setHidden(old.selected, previewAttribute, false);
    picker = null;
    if (old.action === 'move' && old.previewing) applyRules();
    old.host.remove();
    document.removeEventListener('keydown', onPickerKey, true);
    document.removeEventListener('click', onPageClick, true);
    window.removeEventListener('scroll', updateOutline, true);
    window.removeEventListener('resize', updateOutline);
    if (notify && old.remoteAnnounced) void send({ type: 'PICKER_BRIDGE', event: 'close', token: old.remoteToken });
    if (old.previousFocus?.isConnected && typeof old.previousFocus.focus === 'function') old.previousFocus.focus({ preventScroll: true });
  }

  function onPickerKey(event) {
    if (!picker) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (picker.saving) return;
      closePicker();
    }
    if (event.key === 'Tab' && !picker.remoteToken) {
      const buttons = Array.from(picker.shadow.querySelectorAll('button:not(:disabled)'));
      const focused = picker.shadow.activeElement;
      const index = buttons.indexOf(focused);
      if (!buttons.length) return;
      event.preventDefault();
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  }

  function onPageClick(event) {
    if (!picker || belongsToUi(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (picker.saving || picker.previewing) return;
    if (!selectElement(event.target)) {
      picker.notice.textContent = '페이지 전체나 동영상 영역은 선택할 수 없습니다. 광고 안쪽을 선택해 주세요.';
      picker.notice.classList.add('error');
      publishPickerView();
    }
  }

  async function saveSelection() {
    const active = picker;
    if (!active || active.saving || active.saveButton.disabled || !active.selector || !isSafeElement(active.selected, !active.previewing)) return;
    if (active.action === 'move' && !active.previewing) {
      setPreview(true);
      if (!active.previewing) return;
    }
    active.saving = true;
    for (const button of active.shadow.querySelectorAll('button')) button.disabled = true;
    // Frame controls are detached from the outline host, so disable them too.
    for (const button of active.panel.querySelectorAll('button')) button.disabled = true;
    publishPickerView();
    const response = await send({ type: 'ADD_RULE', selector: active.selector.selector, label: labelFor(active.selected), action: active.action });
    if (picker !== active) return;
    active.saving = false;
    if (!response?.ok) {
      setPreview(false);
      selectElement(active.selected);
      active.cancelButton.disabled = false;
      active.notice.textContent = response?.error || '규칙을 저장하지 못했습니다.';
      active.notice.classList.add('error');
      publishPickerView();
      return;
    }
    closePicker();
    await refreshContext();
    showToast(active.action === 'move' ? '이 사이트에서 선택한 요소를 화면 밖으로 옮겼습니다.' : '이 사이트에서 선택한 광고 영역을 숨겼습니다.', response.undoToken, null, active.remoteToken);
  }

  function createPickerUi(action = 'hide') {
    const host = document.createElement('div');
    host.setAttribute('data-basic-blocker-ui', '');
    uiHosts.add(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    const styles = el('style', {}, panelCss);
    const outline = el('div', { class: 'outline', 'aria-hidden': 'true' });
    const panel = el('section', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'basic-block-title' });
    panel.append(el('h2', { id: 'basic-block-title' }, action === 'move' ? '이 요소 이동시키기' : '이 광고 숨기기'));
    panel.append(el('p', { class: 'scope' }, `${context.site}${context.frameHost !== context.site ? ` · 프레임: ${context.frameHost}` : ''}`));
    panel.append(el('p', { class: 'help' }, '파란 테두리로 선택한 영역을 확인하세요. 페이지의 다른 요소를 눌러 바꿀 수도 있습니다.'));
    const label = el('p', { class: 'selection' });
    const notice = el('p', { class: 'notice', role: 'status', 'aria-live': 'polite' });
    const sizeButtons = el('div', { class: 'buttons' });
    const parentButton = el('button', { type: 'button' }, '상위 영역');
    const childButton = el('button', { type: 'button' }, '하위 영역');
    sizeButtons.append(parentButton, childButton);
    const actionButtons = el('div', { class: 'buttons' });
    const previewButton = el('button', { type: 'button', 'aria-pressed': 'false' }, previewLabel(action));
    const saveButton = el('button', { type: 'button', class: 'save' }, '저장');
    const cancelButton = el('button', { type: 'button' }, '취소 (Esc)');
    actionButtons.append(previewButton, saveButton, cancelButton);
    panel.append(label, sizeButtons, notice, actionButtons);
    shadow.append(styles, outline, panel);
    return { host, shadow, outline, panel, label, notice, parentButton, childButton, previewButton, saveButton, cancelButton };
  }

  async function openPicker(element, action = 'hide') {
    closeSelectionMode();
    closePicker();
    dismissRemotePanel();
    lastRemoteSession = null;
    if (!isSafeElement(element)) return { ok: false, error: '페이지 전체나 동영상 영역은 숨길 수 없습니다. 광고 안쪽을 다시 우클릭해 주세요.' };
    const ui = createPickerUi(action);
    const { host, panel, parentButton, childButton, previewButton, saveButton, cancelButton } = ui;
    // randomUUID is unavailable on ordinary HTTP pages; getRandomValues is not.
    const remoteToken = window !== window.top ? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') : null;
    if (remoteToken) {
      // Only the highlight lives in the ad frame. Controls are rendered in the
      // outer document through extension messages, even for cross-origin frames.
      panel.remove();
      lastFrameToken = remoteToken;
    }
    const active = picker = { ...ui, action, remoteToken, remoteAnnounced: false, selected: element, children: [], previewing: false, saving: false, previousFocus: document.activeElement };
    document.documentElement.append(host);
    parentButton.addEventListener('click', () => selectElement(picker.selected.parentElement, picker.selected));
    childButton.addEventListener('click', () => { if (picker.preferredChild) selectElement(picker.preferredChild); });
    previewButton.addEventListener('click', () => setPreview(!picker.previewing));
    saveButton.addEventListener('click', saveSelection);
    cancelButton.addEventListener('click', closePicker);
    selectElement(element);
    document.addEventListener('keydown', onPickerKey, true);
    document.addEventListener('click', onPageClick, true);
    window.addEventListener('scroll', updateOutline, true);
    window.addEventListener('resize', updateOutline);
    if (remoteToken) {
      const result = await send({ type: 'PICKER_BRIDGE', event: 'show', token: remoteToken, payload: pickerView(active) });
      if (!result?.ok || picker !== active) {
        if (picker === active) closePicker(false);
        if (result?.ok) void send({ type: 'PICKER_BRIDGE', event: 'close', token: remoteToken });
        return { ok: false, error: '페이지 바깥에 선택 도구를 열지 못했습니다. 웹페이지를 새로고침한 뒤 다시 선택해 주세요.' };
      }
      active.remoteAnnounced = true;
    } else previewButton.focus({ preventScroll: true });
    return { ok: true };
  }

  function pickerView(active = picker) {
    active.viewRevision = (active.viewRevision || 0) + 1;
    return {
      revision: active.viewRevision,
      action: active.action,
      site: context.site, frameHost: context.frameHost,
      label: active.label.textContent, notice: active.notice.textContent,
      error: active.notice.classList.contains('error'), previewing: active.previewing, saving: active.saving,
      parentDisabled: active.parentButton.disabled, childDisabled: active.childButton.disabled,
      previewDisabled: active.previewButton.disabled, saveDisabled: active.saveButton.disabled,
    };
  }

  function publishPickerView() {
    const active = picker;
    if (!active?.remoteAnnounced) return;
    void send({ type: 'PICKER_BRIDGE', event: 'update', token: active.remoteToken, payload: pickerView(active) }).then(result => {
      if (!result?.ok && picker === active) closePicker(false);
    });
  }

  function sameRemoteSession(a, b) {
    return a && b && a.token === b.token && a.sourceFrameId === b.sourceFrameId && a.sourceDocumentId === b.sourceDocumentId;
  }

  function frameCommand(session, command) {
    return send({ type: 'PICKER_COMMAND', token: session.token, command,
      frameId: session.sourceFrameId, documentId: session.sourceDocumentId });
  }

  function dismissRemotePanel(notify = true) {
    const active = remotePanel;
    if (!active) return;
    remotePanel = null;
    clearInterval(active.timer);
    active.host.remove();
    document.removeEventListener('keydown', onRemotePickerKey, true);
    if (notify) void frameCommand(active, 'cancel');
    if (active.previousFocus?.isConnected && typeof active.previousFocus.focus === 'function') active.previousFocus.focus({ preventScroll: true });
  }

  function renderRemotePanel(active) {
    if (remotePanel !== active) return;
    const view = active.view;
    const busy = active.rpcBusy || view.saving;
    active.panel.querySelector('h2').textContent = view.action === 'move' ? '이 요소 이동시키기' : '이 광고 숨기기';
    active.panel.querySelector('.scope').textContent = `${view.site || ''} · 프레임: ${view.frameHost || ''}`;
    active.panel.querySelector('.help').textContent = '파란 테두리로 선택한 광고를 확인하세요. 광고 프레임 안의 다른 요소를 누르거나 상위·하위 영역으로 조정할 수 있습니다.';
    active.label.textContent = view.label || '선택한 광고';
    active.notice.textContent = view.notice || '';
    active.notice.classList.toggle('error', Boolean(view.error));
    active.parentButton.disabled = busy || view.parentDisabled;
    active.childButton.disabled = busy || view.childDisabled;
    active.previewButton.disabled = busy || view.previewDisabled;
    active.saveButton.disabled = busy || view.saveDisabled;
    active.cancelButton.disabled = busy;
    active.previewButton.textContent = view.previewing ? '미리보기 되돌리기' : previewLabel(view.action);
    active.previewButton.setAttribute('aria-pressed', String(Boolean(view.previewing)));
  }

  async function runRemoteCommand(active, command, quiet = false) {
    if (remotePanel !== active || active.view.saving) return;
    if (active.rpcBusy) {
      // Preview/selection can be visible in the source before its reply reaches
      // the top panel. Remember Escape until that reversible command completes.
      // Saving has a separate lifetime and must never imply cancellation.
      if (command === 'cancel' && ['parent', 'child', 'preview'].includes(active.rpcCommand)) active.cancelQueued = true;
      return;
    }
    if (quiet) {
      if (active.statusPending) return;
      active.statusPending = true;
    } else { active.rpcBusy = true; active.rpcCommand = command; renderRemotePanel(active); }
    const result = await frameCommand(active, command);
    if (quiet) active.statusPending = false;
    if (remotePanel !== active) return;
    // A status reply may overlap a later click. It checks liveness only and
    // must never unlock that click's controls or replace its newer view.
    if (!quiet) { active.rpcBusy = false; active.rpcCommand = null; }
    if (!result?.ok || result.closed) {
      dismissRemotePanel(false);
      if (!result?.ok) showToast('선택한 광고와의 연결이 끊겼습니다. 광고를 다시 우클릭해 주세요.');
      return;
    }
    if (quiet) return;
    if (result.view && result.view.revision >= (active.view.revision || 0)) active.view = result.view;
    if (active.cancelQueued) {
      active.cancelQueued = false;
      if (!active.view.saving) {
        await runRemoteCommand(active, 'cancel');
        return;
      }
    }
    renderRemotePanel(active);
  }

  function onRemotePickerKey(event) {
    const active = remotePanel;
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void runRemoteCommand(active, 'cancel');
    } else if (event.key === 'Tab') {
      const buttons = Array.from(active.panel.querySelectorAll('button:not(:disabled)'));
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(active.shadow.activeElement);
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  }

  function receiveFramePicker(message) {
    if (window !== window.top || typeof message.token !== 'string' || !Number.isInteger(message.sourceFrameId) || message.sourceFrameId <= 0) return { ok: false };
    const session = { token: message.token, sourceFrameId: message.sourceFrameId, sourceDocumentId: message.sourceDocumentId ?? null };
    if (message.event === 'show') {
      closePicker();
      closeSelectionMode();
      dismissRemotePanel();
      const ui = createPickerUi();
      ui.outline.remove();
      const active = remotePanel = { ...ui, ...session, view: message.payload || {}, rpcBusy: false, previousFocus: document.activeElement };
      lastRemoteSession = session;
      document.documentElement.append(active.host);
      for (const [button, command] of [[active.parentButton, 'parent'], [active.childButton, 'child'], [active.previewButton, 'preview'], [active.saveButton, 'save'], [active.cancelButton, 'cancel']]) {
        button.addEventListener('click', () => void runRemoteCommand(active, command));
      }
      document.addEventListener('keydown', onRemotePickerKey, true);
      renderRemotePanel(active);
      active.previewButton.focus({ preventScroll: true });
      // A frame can navigate or disappear without delivering an unload message.
      // Address status checks to its original browser document ID, never a new ad.
      active.timer = setInterval(() => void runRemoteCommand(active, 'status', true), 1500);
      return { ok: true };
    }
    if (message.event === 'update' && sameRemoteSession(remotePanel, session)) {
      if (message.payload?.revision >= (remotePanel.view.revision || 0)) remotePanel.view = message.payload;
      renderRemotePanel(remotePanel);
      return { ok: true };
    }
    if (message.event === 'close' && sameRemoteSession(remotePanel, session)) dismissRemotePanel(false);
    if (message.event === 'toast' && sameRemoteSession(lastRemoteSession, session)) {
      showToast(message.payload?.message || '선택 작업을 마쳤습니다.', null,
        message.payload?.undoToken ? () => frameCommand(session, 'undo') : null);
    }
    return { ok: true };
  }

  async function receiveFrameCommand(message) {
    if (window === window.top) return { ok: false, error: '광고 프레임이 아닙니다.' };
    if (message.command === 'undo' && remoteUndo?.token === message.token) {
      const undo = remoteUndo;
      const response = await send({ type: 'UNDO_RULE', undoToken: undo.undoToken });
      if (response?.ok) {
        if (remoteUndo === undo) remoteUndo = null;
        await refreshContext();
      }
      return response;
    }
    if (message.command === 'undo') return { ok: false, error: '이 실행 취소는 더 이상 사용할 수 없습니다. 규칙 관리 화면에서 복원해 주세요.' };
    const active = picker;
    if (!active || active.remoteToken !== message.token) return { ok: true, closed: true };
    if (!active.selected.isConnected) { closePicker(); return { ok: true, closed: true }; }
    if (active.saving && message.command !== 'status') return { ok: false, error: '저장 중입니다.' };
    switch (message.command) {
      case 'parent': if (!active.parentButton.disabled) selectElement(active.selected.parentElement, active.selected); break;
      case 'child': if (!active.childButton.disabled && active.preferredChild) selectElement(active.preferredChild); break;
      case 'preview': if (!active.previewButton.disabled) setPreview(!active.previewing); break;
      case 'save': await saveSelection(); break;
      case 'cancel': closePicker(); break;
      case 'status': break;
      default: return { ok: false, error: '지원하지 않는 선택 작업입니다.' };
    }
    return { ok: true, closed: picker !== active, ...(picker === active ? { view: pickerView(active) } : {}) };
  }

  function closeSelectionMode() {
    if (!selectionMode) return;
    selectionMode.host.remove();
    selectionMode = null;
    document.removeEventListener('mousemove', onSelectionHover, true);
    document.removeEventListener('click', onSelectionClick, true);
    document.removeEventListener('keydown', onSelectionKey, true);
    window.removeEventListener('scroll', updateSelectionFrames, true);
    window.removeEventListener('resize', updateSelectionFrames);
  }

  function outlineSelection(element) {
    if (!selectionMode) return;
    const rect = element.getBoundingClientRect();
    Object.assign(selectionMode.outline.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, display: 'block' });
  }

  function updateSelectionFrames() {
    if (!selectionMode) return;
    selectionMode.frameLayer.replaceChildren();
    selectionMode.outline.style.display = 'none';
    // Frame clicks do not bubble to the parent document, including about:blank
    // frames used by Naver. Temporary targets let the user select the iframe box.
    for (const frame of document.querySelectorAll('iframe')) {
      if (!isSafeElement(frame)) continue;
      const rect = frame.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const width = Math.min(innerWidth, rect.right) - left;
      const height = Math.min(innerHeight, rect.bottom) - top;
      if (width <= 0 || height <= 0) continue;
      const target = el('div', { 'aria-hidden': 'true' });
      Object.assign(target.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, pointerEvents: 'auto', cursor: 'crosshair' });
      target.addEventListener('mousemove', () => outlineSelection(frame));
      target.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        openPicker(frame, selectionMode.action);
      });
      selectionMode.frameLayer.append(target);
    }
  }

  function onSelectionHover(event) {
    if (!selectionMode) return;
    const element = event.target;
    if (belongsToUi(element)) return;
    if (!isSafeElement(element) || element.getRootNode() !== document) {
      selectionMode.outline.style.display = 'none';
      return;
    }
    outlineSelection(element);
  }

  function onSelectionClick(event) {
    if (!selectionMode || belongsToUi(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!isSafeElement(event.target) || event.target.getRootNode() !== document) {
      selectionMode.notice.textContent = '페이지 전체나 동영상 영역은 선택할 수 없습니다. 광고 안쪽을 선택해 주세요.';
      return;
    }
    openPicker(event.target, selectionMode.action);
  }

  function onSelectionKey(event) {
    if (!selectionMode || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeSelectionMode();
  }

  function startPicker(action = 'hide') {
    closePicker();
    closeSelectionMode();
    dismissRemotePanel();
    lastRemoteSession = null;
    const host = document.createElement('div');
    host.setAttribute('data-basic-blocker-ui', '');
    uiHosts.add(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    const frameLayer = el('div');
    const outline = el('div', { class: 'outline', 'aria-hidden': 'true' });
    outline.style.display = 'none';
    const panel = el('section', { class: 'panel', role: 'dialog', 'aria-labelledby': 'basic-select-title' });
    const notice = el('p', { role: 'status', 'aria-live': 'polite' }, `${action === 'move' ? '화면 밖으로 옮길 요소' : '숨길 광고'}를 클릭하세요. 다음 화면에서 영역을 확인하고 저장할 수 있습니다. Esc를 누르면 취소합니다.`);
    const cancel = el('button', { type: 'button' }, '취소 (Esc)');
    panel.append(el('h2', { id: 'basic-select-title' }, '광고 직접 선택'), notice, cancel);
    shadow.append(el('style', {}, panelCss), frameLayer, outline, panel);
    selectionMode = { host, action, outline, notice, frameLayer };
    document.documentElement.append(host);
    cancel.addEventListener('click', closeSelectionMode);
    document.addEventListener('mousemove', onSelectionHover, true);
    document.addEventListener('click', onSelectionClick, true);
    document.addEventListener('keydown', onSelectionKey, true);
    window.addEventListener('scroll', updateSelectionFrames, true);
    window.addEventListener('resize', updateSelectionFrames);
    updateSelectionFrames();
    cancel.focus({ preventScroll: true });
    return { ok: true };
  }

  function showToast(message, undoToken, undoAction = null, frameToken = lastFrameToken) {
    if (window !== window.top && frameToken) {
      if (frameToken === lastFrameToken) remoteUndo = undoToken ? { token: frameToken, undoToken } : null;
      void send({ type: 'PICKER_BRIDGE', event: 'toast', token: frameToken, payload: { message, undoToken: undoToken || null } });
      return;
    }
    toastHost?.remove();
    const host = document.createElement('div');
    host.setAttribute('data-basic-blocker-ui', '');
    uiHosts.add(host);
    toastHost = host;
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.append(el('style', {}, `${panelCss} .panel { top: auto; bottom: 12px; }`));
    const panel = el('div', { class: 'panel', role: 'status', 'aria-live': 'polite' });
    panel.append(el('p', {}, message));
    const buttons = el('div', { class: 'buttons' });
    if (undoToken || undoAction) {
      const undo = el('button', { type: 'button' }, '실행 취소');
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        const result = undoAction ? await undoAction() : await send({ type: 'UNDO_RULE', undoToken });
        if (result?.ok) {
          host.remove();
          await refreshContext();
        } else {
          panel.querySelector('p').textContent = result?.error || '취소하지 못했습니다. 확장 프로그램에서 규칙을 삭제해 주세요.';
          undo.disabled = false;
        }
      });
      buttons.append(undo);
    }
    const dismiss = el('button', { type: 'button' }, '닫기');
    dismiss.addEventListener('click', () => host.remove());
    buttons.append(dismiss);
    panel.append(buttons);
    shadow.append(panel);
    document.documentElement.append(host);
    setTimeout(() => { host.remove(); if (toastHost === host) toastHost = null; }, 12000);
  }

  document.addEventListener('contextmenu', event => {
    if (!event.isTrusted || belongsToUi(event.target)) { rightClickTarget = null; return; }
    // Shadow-root internals cannot be persisted with a normal document CSS selector.
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    rightClickTarget = target?.getRootNode() === document ? target : null;
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'FRAME_PICKER_EVENT') {
      if (_sender.id !== chrome.runtime.id) { reply({ ok: false }); return; }
      reply(receiveFramePicker(message));
      return;
    }
    if (message?.type === 'FRAME_PICKER_COMMAND') {
      if (_sender.id !== chrome.runtime.id) { reply({ ok: false }); return; }
      receiveFrameCommand(message).then(reply).catch(() => reply({ ok: false, error: '선택한 광고를 다시 확인해 주세요.' }));
      return true;
    }
    if (message?.type === 'GET_PAGE_STATUS') {
      reply(pageStatus());
      return;
    }
    if (!['PICK_ELEMENT', 'START_PICKER'].includes(message?.type)) return;
    const selected = rightClickTarget;
    rightClickTarget = null;
    (async () => {
      await refreshContext();
      if (!context.enabled || !context.site || !context.frameHost) return { ok: false, error: '먼저 이 사이트에서 광고 차단을 켜 주세요.' };
      const action = message.action === 'move' ? 'move' : 'hide';
      if (message.type === 'START_PICKER') return startPicker(action);
      if (!selected?.isConnected) return { ok: false, error: '선택한 광고를 찾지 못했습니다. 광고를 다시 우클릭해 주세요.' };
      return openPicker(selected, action);
    })().then(reply).catch(() => reply({ ok: false, error: '광고 선택 도구를 열지 못했습니다. 페이지를 새로고침해 주세요.' }));
    return true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.adblockState) void refreshContext();
  });

  new MutationObserver(mutations => {
    let changed = false;
    for (const change of mutations) {
      const target = change.target;
      if (target === publicStyleElement || publicStyleElement?.contains(target)) {
        const ownTextWrite = change.type === 'childList' && target === publicStyleElement &&
          publicStyleElement.childNodes.length === 1 && publicStyleElement.firstChild === publicStyleTextNode &&
          [...change.addedNodes].every(node => node === publicStyleTextNode);
        const externalText = (change.type === 'childList' && !ownTextWrite) || change.type === 'characterData';
        const externalAttribute = change.type === 'attributes' && ['media', 'type', 'disabled'].includes(change.attributeName) && publicStyleElement.hasAttribute(change.attributeName);
        if (externalText || externalAttribute) {
          publicStyleDirty = true;
          if (context.enabled && context.publicFiltersEnabled) changed = true;
        }
        continue;
      }
      if (belongsToUi(target) || uiHosts.has(target) || target === styleElement) continue;
      if (change.attributeName === 'media' && decorationStyles.has(target) && target.getAttribute('media') === 'not all') continue;
      if (change.attributeName === hiddenAttribute || change.attributeName === previewAttribute || change.attributeName === offscreenAttribute) {
        // Ignore our markers, but repair removal of an active hiding marker.
        if (change.attributeName === hiddenAttribute && hiddenElements.has(target) && !target.hasAttribute(hiddenAttribute)) changed = true;
        if (change.attributeName === offscreenAttribute && offscreenElements.has(target) && !target.hasAttribute(offscreenAttribute)) changed = true;
        continue;
      }
      if (change.attributeName === 'style' && appliedStyles.has(target) && target.getAttribute('style') === appliedStyles.get(target)) continue;
      const movedNodes = change.type === 'childList' ? [...change.addedNodes, ...change.removedNodes] : [];
      if (change.removedNodes?.length && [...change.removedNodes].includes(publicStyleElement) && context.enabled && context.publicFiltersEnabled) changed = true;
      if (movedNodes.length && movedNodes.every(node => node === styleElement || node === publicStyleElement || uiHosts.has(node))) continue;
      changed = true;
      // Stylesheet edits can affect any ad. Otherwise, remeasure only hidden
      // elements whose own subtree/attributes or ancestor attributes changed.
      const isStylesheet = node => node.nodeType === Node.ELEMENT_NODE && (node.matches('style, link[rel="stylesheet"]') || node.querySelector('style, link[rel="stylesheet"]'));
      const stylesheetChanged = target.parentElement?.closest('style') || (target.nodeType === Node.ELEMENT_NODE && target.matches('style, link[rel="stylesheet"]')) || movedNodes.some(isStylesheet);
      for (const element of [...hiddenElements, ...offscreenElements]) {
        if (stylesheetChanged || element.contains(target) || (change.type === 'attributes' && target.contains(element)) || movedNodes.some(node => node.contains(element))) layoutDirtyElements.add(element);
      }
    }
    if (changed) scheduleApply();
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

  window.addEventListener('resize', () => {
    for (const element of [...hiddenElements, ...offscreenElements]) layoutDirtyElements.add(element);
    scheduleApply();
  });

  window.addEventListener('pagehide', () => {
    closePicker();
    dismissRemotePanel();
  });

  void refreshContext();
})();
