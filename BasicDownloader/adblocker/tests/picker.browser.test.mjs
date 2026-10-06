import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Optional integration suite: PLAYWRIGHT_MODULE can point to a bundled Playwright
// index.mjs without adding any dependency to the unpacked extension.
let chromium;
try {
  const moduleName = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright';
  ({ chromium } = await import(moduleName));
} catch { /* Regular node tests remain usable without browser tooling. */ }

const contentScript = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const fixture = `<!doctype html><html><head><style>
  body { font: 16px sans-serif; padding: 30px; }
  .advert { width: 300px; height: 90px; margin: 15px; background: #ffdca9; }
  #generic { display: block !important; }
  main { width: 500px; height: 120px; background: #ddd; }
</style></head><body>
  <main id="main"><p>Keep the main content visible.</p></main>
  <ins id="generic" class="adsbygoogle advert" style="display: inline-block !important">Generic banner</ins>
  <section><div id="custom-banner" class="advert" style="display: grid !important">Unfiltered advertisement</div></section>
  <div id="video-wrapper"><video width="300" height="80"></video></div>
  <div id="other">Ordinary content</div>
</body></html>`;

async function setup(t, options = {}) {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.route('http://picker.test/**', route => route.fulfill({ contentType: 'text/html', body: options.fixture || fixture }));
  await page.addInitScript(options => {
    // Expose the test dialog to semantic Playwright locators. Production uses closed roots.
    const originalAttach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { return originalAttach.call(this, { ...options, mode: 'open' }); };
    let messageListener;
    let storageListener;
    window.testContext = options.context || { ok: true, enabled: true, site: 'picker.test', frameHost: 'picker.test', rules: [] };
    const contextGate = options.pauseContext ? new Promise(resolve => { window.testReleaseContext = resolve; }) : Promise.resolve();
    window.testSetEnabled = enabled => { window.testContext.enabled = enabled; storageListener({ adblockState: {} }, 'local'); };
    window.testPick = action => new Promise(resolve => messageListener({ type: 'PICK_ELEMENT', action }, {}, resolve));
    window.testStartPicker = action => new Promise(resolve => messageListener({ type: 'START_PICKER', action }, {}, resolve));
    window.testPageStatus = () => new Promise(resolve => messageListener({ type: 'GET_PAGE_STATUS' }, {}, resolve));
    window.testSavedCalls = 0;
    window.chrome = {
      runtime: {
        onMessage: { addListener: listener => { messageListener = listener; } },
        sendMessage: async message => {
          if (message.type === 'GET_CONTEXT') { await contextGate; return structuredClone(window.testContext); }
          if (message.type === 'ADD_RULE') {
            window.testSavedCalls++;
            if (window.testSaveDelay) await new Promise(resolve => setTimeout(resolve, window.testSaveDelay));
            const rule = { id: String(window.testSavedCalls), site: window.testContext.site, frameHost: window.testContext.frameHost, selector: message.selector, label: message.label, action: message.action, createdAt: Date.now() };
            window.testContext.rules.push(rule);
            storageListener({ adblockState: {} }, 'local');
            return { ok: true, rule, undoToken: rule.id };
          }
          if (message.type === 'UNDO_RULE') {
            window.testContext.rules = window.testContext.rules.filter(rule => rule.id !== message.undoToken);
            storageListener({ adblockState: {} }, 'local');
            return { ok: true };
          }
          return { ok: false };
        },
      },
      storage: { onChanged: { addListener: listener => { storageListener = listener; } } },
    };
  }, options);
  await page.goto(options.blank ? 'about:blank' : 'http://picker.test/');
  if (options.blank) await page.setContent(fixture);
  await page.addScriptTag({ content: contentScript });
  if (!options.pauseContext && options.context?.ok !== false) await page.waitForFunction(() => getComputedStyle(document.querySelector('#generic')).display === 'none');
  return page;
}

async function openPicker(page, selector = '#custom-banner', action = 'hide') {
  await page.locator(selector).click({ button: 'right' });
  assert.deepEqual(await page.evaluate(action => window.testPick(action), action), { ok: true });
  await page.getByRole('dialog').waitFor();
}

test('cosmetic rules override inline important, restore on disable, and handle reinsertion', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.evaluate(() => window.testSetEnabled(false));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#generic')).display === 'inline-block');
  assert.equal(await page.locator('#generic').evaluate(element => element.style.getPropertyPriority('display')), 'important');
  await page.evaluate(() => window.testSetEnabled(true));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#generic')).display === 'none');
  await page.evaluate(() => { const old = document.querySelector('#generic'); const replacement = document.createElement('ins'); replacement.id = old.id; replacement.className = old.className; replacement.textContent = 'Replacement'; old.replaceWith(replacement); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#generic')).display === 'none');
  assert.notEqual(await page.locator('main').evaluate(element => getComputedStyle(element).display), 'none');
});

test('unrelated DOM changes do not rewrite or remeasure already hidden banners or cause an observer loop', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const banner = document.querySelector('#generic');
    window.testCosmeticWork = { styleWrites: 0, markerWrites: 0, rectReads: 0, ruleQueries: 0 };
    const style = banner.style;
    for (const method of ['setProperty', 'removeProperty']) {
      const original = style[method].bind(style);
      style[method] = (...args) => { window.testCosmeticWork.styleWrites++; return original(...args); };
    }
    for (const method of ['setAttribute', 'removeAttribute']) {
      const original = banner[method].bind(banner);
      banner[method] = (...args) => {
        if (args[0].startsWith('data-basic-block-')) window.testCosmeticWork.markerWrites++;
        return original(...args);
      };
    }
    const bounds = banner.getBoundingClientRect.bind(banner);
    banner.getBoundingClientRect = () => { window.testCosmeticWork.rectReads++; return bounds(); };
    const query = document.querySelectorAll.bind(document);
    document.querySelectorAll = selector => {
      if (selector === 'ins.adsbygoogle') window.testCosmeticWork.ruleQueries++;
      return query(selector);
    };
    const ordinary = document.querySelector('#other');
    ordinary.textContent = 'Updated ordinary content';
    ordinary.classList.add('updated');
    const sibling = document.createElement('p');
    sibling.textContent = 'A newly inserted ordinary paragraph';
    document.body.append(sibling);
  });
  await page.waitForTimeout(160);
  const work = await page.evaluate(() => ({ ...window.testCosmeticWork }));
  assert.deepEqual(work, { styleWrites: 0, markerWrites: 0, rectReads: 0, ruleQueries: 1 });
  await page.waitForTimeout(160);
  assert.deepEqual(await page.evaluate(() => window.testCosmeticWork), work);
  assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 1);
  assert.deepEqual(await page.evaluate(() => ({ ...window.testCosmeticWork, ruleQueries: 1 })), work);
  await page.evaluate(() => window.testSetEnabled(false));
  await page.waitForFunction(() => document.querySelector('#generic').style.getPropertyValue('display') === 'inline-block');
  assert.equal(await page.locator('#generic').evaluate(element => element.style.getPropertyPriority('display')), 'important');
});

test('attribute, content, style and safety changes are reconsidered without stale hidden content', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    const dynamic = document.createElement('ins');
    dynamic.id = 'dynamic-slot'; dynamic.className = 'advert';
    dynamic.style.setProperty('display', 'grid', 'important');
    dynamic.textContent = 'Initially ordinary';
    document.body.append(dynamic);
  });
  assert.equal(await page.locator('#dynamic-slot').isVisible(), true);
  await page.locator('#dynamic-slot').evaluate(element => element.classList.add('adsbygoogle'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#dynamic-slot')).display === 'none');
  await page.locator('#dynamic-slot').evaluate(element => element.classList.remove('adsbygoogle'));
  await page.waitForFunction(() => document.querySelector('#dynamic-slot').style.getPropertyValue('display') === 'grid');
  assert.equal(await page.locator('#dynamic-slot').evaluate(element => element.style.getPropertyPriority('display')), 'important');
  await page.locator('#dynamic-slot').evaluate(element => element.classList.add('adsbygoogle'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#dynamic-slot')).display === 'none');
  await page.locator('#dynamic-slot').evaluate(element => element.setAttribute('role', 'main'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#dynamic-slot')).display === 'grid');
  await page.locator('#dynamic-slot').evaluate(element => element.removeAttribute('role'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#dynamic-slot')).display === 'none');
  await page.locator('#dynamic-slot').evaluate(element => element.append(document.createElement('video')));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#dynamic-slot')).display === 'grid');
  await page.locator('#dynamic-slot').evaluate(element => element.querySelector('video').remove());
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#dynamic-slot')).display === 'none');
  await page.locator('#dynamic-slot').evaluate(element => { element.firstChild.data = 'Ordinary content '.repeat(400); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#dynamic-slot')).display === 'grid');
  await page.locator('#dynamic-slot').evaluate(element => { element.firstChild.data = 'Small advertisement'; });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#dynamic-slot')).display === 'none');
  // The page changes layout while our display:none is still present. This must
  // not be mistaken for our own style write or bypass the viewport size guard.
  await page.locator('#dynamic-slot').evaluate(element => {
    Object.assign(element.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', margin: '0' });
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#dynamic-slot')).display === 'grid');
  assert.equal(await page.locator('#dynamic-slot').isVisible(), true);
});

test('page display edits made while hidden are preserved when a rule is disabled', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.locator('#generic').evaluate(element => element.style.setProperty('display', 'flex', 'important'));
  await page.waitForFunction(() => document.querySelector('#generic').style.getPropertyValue('display') === 'none');
  await page.evaluate(() => window.testSetEnabled(false));
  await page.waitForFunction(() => document.querySelector('#generic').style.getPropertyValue('display') === 'flex');
  assert.equal(await page.locator('#generic').evaluate(element => element.style.getPropertyPriority('display')), 'important');
});

test('preview and Escape do not save; save persists, replacement hides, undo restores', { skip: !chromium }, async t => {
  const page = await setup(t);
  await openPicker(page);
  await page.getByRole('button', { name: '숨김 미리보기', exact: true }).click();
  assert.equal(await page.locator('#custom-banner').evaluate(element => getComputedStyle(element).display), 'none');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#custom-banner').evaluate(element => getComputedStyle(element).display), 'grid');
  assert.equal(await page.evaluate(() => window.testSavedCalls), 0);
  await openPicker(page);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testContext.rules[0].selector), '#custom-banner');
  assert.equal(await page.locator('#custom-banner').evaluate(element => getComputedStyle(element).display), 'none');
  await page.evaluate(() => { const old = document.querySelector('#custom-banner'); const replacement = document.createElement('div'); replacement.id = old.id; replacement.className = old.className; replacement.textContent = 'Replacement'; old.replaceWith(replacement); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#custom-banner')).display === 'none');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#custom-banner')).display !== 'none');
  assert.equal(await page.evaluate(() => window.testContext.rules.length), 0);
});

test('missing target, main, media, and hostile broad saved selectors stay visible', { skip: !chromium }, async t => {
  const page = await setup(t);
  assert.equal((await page.evaluate(() => window.testPick())).ok, false);
  await page.locator('main').click({ button: 'right', position: { x: 490, y: 110 } });
  assert.equal((await page.evaluate(() => window.testPick())).ok, false);
  await page.locator('video').click({ button: 'right' });
  assert.equal((await page.evaluate(() => window.testPick())).ok, false);
  await page.evaluate(() => {
    window.testContext.rules = ['body', 'main', '#video-wrapper', 'div'].map((selector, index) => ({ id: String(index), site: 'picker.test', frameHost: 'picker.test', selector }));
    window.testSetEnabled(true);
  });
  await page.waitForTimeout(100);
  for (const selector of ['body', 'main', '#video-wrapper', '#other']) assert.notEqual(await page.locator(selector).evaluate(element => getComputedStyle(element).display), 'none');
});

test('structural fallback stays unique and parent/child navigation selects the intended area', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    const container = document.createElement('section');
    container.id = 'slots';
    container.innerHTML = '<div style="width:220px;height:55px">First ordinary slot</div><div style="width:220px;height:55px"><span>Advertisement here</span></div>';
    document.body.append(container);
  });
  await openPicker(page, '#slots > div:nth-child(2) > span');
  await page.getByRole('button', { name: '상위 영역', exact: true }).click();
  assert.equal(await page.getByText('페이지 구조를 이용한 규칙입니다.', { exact: false }).count(), 1);
  await page.getByRole('button', { name: '하위 영역', exact: true }).click();
  await page.getByRole('button', { name: '상위 영역', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).waitFor();
  const rule = await page.evaluate(() => window.testContext.rules[0]);
  assert.equal(rule.selector, '#slots > div:nth-of-type(2)');
  assert.notEqual(await page.locator('#slots > div:first-child').evaluate(element => getComputedStyle(element).display), 'none');
  assert.equal(await page.locator('#slots > div:nth-child(2)').evaluate(element => getComputedStyle(element).display), 'none');
});

test('Escape does not imply cancellation after Save was submitted', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.evaluate(() => { window.testSaveDelay = 250; });
  await openPicker(page);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 1);
  await page.getByRole('button', { name: '실행 취소', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testContext.rules.length), 1);
});

test('page status reports initialization, automatic matches, manual matches, and disabled state separately', { skip: !chromium }, async t => {
  const page = await setup(t, { pauseContext: true });
  const loading = await page.evaluate(() => window.testPageStatus());
  assert.equal(loading.ok, false);
  assert.equal(loading.ready, false);
  assert.equal('autoHiddenCount' in loading, false);
  await page.evaluate(() => window.testReleaseContext());
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#generic')).display === 'none');
  const publicStatus = { publicCosmeticsEnabled: false, publicSelectorCount: 0, publicCosmeticsError: null };
  assert.deepEqual(await page.evaluate(() => window.testPageStatus()), { ok: true, ready: true, enabled: true, autoHiddenCount: 1, manualHiddenCount: 0, ...publicStatus });
  await openPicker(page);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.testPageStatus()), { ok: true, ready: true, enabled: true, autoHiddenCount: 1, manualHiddenCount: 1, ...publicStatus });
  await page.evaluate(() => { document.querySelector('#custom-banner').remove(); });
  assert.equal((await page.evaluate(() => window.testPageStatus())).manualHiddenCount, 0);
  await page.evaluate(() => window.testSetEnabled(false));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#generic')).display !== 'none');
  assert.deepEqual(await page.evaluate(() => window.testPageStatus()), { ok: true, ready: true, enabled: false, autoHiddenCount: 0, manualHiddenCount: 0, ...publicStatus });
});

test('popup selection starts without a right-click, cancels, prevents link navigation, and saves', { skip: !chromium }, async t => {
  const page = await setup(t);
  assert.deepEqual(await page.evaluate(() => window.testStartPicker()), { ok: true });
  await page.getByRole('heading', { name: '광고 직접 선택', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.evaluate(() => window.testSavedCalls), 0);
  await page.evaluate(() => { document.querySelector('#custom-banner').innerHTML = '<a id="ad-link" href="https://example.com/advertiser">Visit advertiser</a>'; });
  assert.deepEqual(await page.evaluate(() => window.testStartPicker()), { ok: true });
  await page.locator('main').click({ position: { x: 490, y: 110 } });
  await page.getByText('페이지 전체나 동영상 영역은 선택할 수 없습니다.', { exact: false }).waitFor();
  await page.locator('#ad-link').hover();
  await page.locator('#ad-link').click();
  assert.equal(page.url(), 'http://picker.test/');
  await page.getByRole('heading', { name: '이 광고 숨기기', exact: true }).waitFor();
  await page.getByRole('button', { name: '상위 영역', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testContext.rules[0].selector), '#custom-banner');
  assert.equal((await page.evaluate(() => window.testPageStatus())).manualHiddenCount, 1);
});

test('about:blank injection uses background-provided scope and rejects a missing scope', { skip: !chromium }, async t => {
  const page = await setup(t, { blank: true });
  assert.equal(page.url(), 'about:blank');
  assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 1);
  assert.deepEqual(await page.evaluate(() => window.testStartPicker()), { ok: true });
  await page.locator('#custom-banner').click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.testPageStatus())).manualHiddenCount, 1);
  const denied = await setup(t, { blank: true, context: { ok: false } });
  assert.equal((await denied.evaluate(() => window.testPageStatus())).ok, false);
  assert.equal((await denied.evaluate(() => window.testStartPicker())).ok, false);
  assert.notEqual(await denied.locator('#generic').evaluate(element => getComputedStyle(element).display), 'none');
});

test('popup selection can select an iframe banner without entering its document', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.id = 'custom-ad-frame';
    frame.srcdoc = '<a href="https://example.com/advertiser">Framed advertisement</a>';
    document.body.append(frame);
  });
  assert.deepEqual(await page.evaluate(() => window.testStartPicker()), { ok: true });
  const bounds = await page.locator('#custom-ad-frame').boundingBox();
  await page.mouse.click(bounds.x + 20, bounds.y + 20);
  await page.getByRole('heading', { name: '이 광고 숨기기', exact: true }).waitFor();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testContext.rules[0].selector), '#custom-ad-frame');
  assert.equal(await page.locator('#custom-ad-frame').evaluate(element => getComputedStyle(element).display), 'none');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#custom-ad-frame')).display !== 'none');
});

test('Naver slots are scoped to the trusted frame host and keep search, shopping, and media visible', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.route('https://recoshopping.naver.com/**', route => route.fulfill({ contentType: 'text/html', body: 'Sponsored banner' }));
  await page.evaluate(() => {
    const slots = document.createElement('section');
    slots.innerHTML = '<header id="header" class="type_ad">Search</header><div id="timeboard-ex" class="advert">Top ad</div><div id="right-ad-1" class="advert">Right ad</div><div id="pc-main-ad-div-knowledge-0" class="advert">Bottom ad</div><iframe title="AD" id="da_public_left_tgtLREC"></iframe><iframe title="right-shopping" data-test-ad></iframe><iframe title="shoppingbox"></iframe><div id="right-ad-2"><video></video></div>';
    // Keep synthetic tests offline while preserving the selector's exact source URL.
    slots.querySelector('[data-test-ad]').setAttribute('src', 'https://recoshopping.naver.com/');
    document.body.append(slots);
  });
  assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 1);
  assert.notEqual(await page.locator('#timeboard-ex').evaluate(element => getComputedStyle(element).display), 'none');
  await page.evaluate(() => { window.testContext.frameHost = 'www.naver.com'; window.testContext.site = 'www.naver.com'; window.testSetEnabled(true); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#timeboard-ex')).display === 'none');
  assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 6);
  for (const selector of ['#header', 'iframe[title="shoppingbox"]', '#right-ad-2']) assert.notEqual(await page.locator(selector).evaluate(element => getComputedStyle(element).display), 'none');
});

async function insertCommentRows(page) {
  await page.evaluate(() => {
    const comments = document.createElement('section');
    comments.id = 'dc-comments-fixture';
    comments.innerHTML = `
      <div class="comment_box"><ul class="cmt_list add">
        <li class="ub-content" id="ordinary-first">일반 댓글: 파워링크와 댓글돌이에 관한 이야기</li>
        <li class="power_link cmt_power_link"><h3>파워링크 <span class="adicon">광고</span></h3><a href="#">광고 A</a></li>
        <li class="ub-content dory" id="comment_li_0"><div class="cmt_info"><span class="nickname cmtboy">댓글돌이</span><div class="comment_dory clean"><a href="#">추천 기사 A</a></div></div></li>
        <li class="ub-content" id="ordinary-second">다른 일반 댓글</li>
        <li id="reply-wrapper"><ul class="reply_list"><li id="ordinary-reply">일반 답글</li></ul></li>
        <li class="power_link cmt_power_link"><h3>파워링크 <span class="adicon">광고</span></h3><a href="#">다른 광고 B</a></li>
        <li class="ub-content dory" id="comment_li_0"><div class="cmt_info"><span class="nickname cmtboy">댓글돌이</span><div class="comment_dory clean">사진과 제목 B</div></div></li>
      </ul><nav id="comments-paging">댓글 페이지 이동</nav><textarea id="comment-editor" aria-label="댓글 입력"></textarea></div>
      <div class="view_ad_wrap"><div class="power_link"><h3>파워링크 <span class="adicon">광고</span></h3><a href="#">하단 광고</a></div><p id="after-ad">보존할 안내</p></div>
      <div class="power_link" id="outside-ad-slot">광고 전용 영역 바깥의 유사 클래스</div>
    `;
    document.body.append(comments);
  });
}

test('DCInside ad rows survive creative changes, duplicate IDs, reordering and reinsertion without hiding ordinary comments', { skip: !chromium }, async t => {
  const page = await setup(t, { context: { ok: true, enabled: true, site: 'gall.dcinside.com', frameHost: 'gall.dcinside.com', rules: [] } });
  await insertCommentRows(page);
  const ads = '.cmt_list > .cmt_power_link, .cmt_list > .dory, .view_ad_wrap > .power_link';
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].length === 5 && [...document.querySelectorAll(selector)].every(element => getComputedStyle(element).display === 'none'), ads);
  assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 6); // Includes the generic fixture banner.
  for (const selector of ['#ordinary-first', '#ordinary-second', '#ordinary-reply', '#comments-paging', '#comment-editor', '#after-ad', '#outside-ad-slot']) {
    assert.equal(await page.locator(selector).isVisible(), true, selector);
  }

  await page.evaluate(() => {
    const list = document.querySelector('.cmt_list');
    const dory = list.querySelector('.dory');
    dory.innerHTML = '<div class="comment_dory"><img alt="새 광고 사진"><a href="#new-creative">완전히 달라진 제목</a></div>';
    list.prepend(dory);
    const replacement = list.querySelector('.cmt_power_link').cloneNode(true);
    replacement.removeAttribute('style');
    for (const attribute of replacement.getAttributeNames()) if (attribute.startsWith('data-basic-block-')) replacement.removeAttribute(attribute);
    replacement.innerHTML = '<h3>파워링크 <span class="adicon">광고</span></h3><a href="#">새 업체</a>';
    list.querySelector('.cmt_power_link').replaceWith(replacement);
    const ordinary = document.createElement('li');
    ordinary.id = 'new-ordinary'; ordinary.className = 'ub-content'; ordinary.textContent = '새로 추가된 일반 댓글';
    list.prepend(ordinary);
  });
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(element => getComputedStyle(element).display === 'none'), ads);
  assert.equal(await page.locator('#new-ordinary').isVisible(), true);
  assert.equal(await page.locator('#ordinary-first').isVisible(), true);
  assert.equal(await page.locator('#ordinary-reply').isVisible(), true);
  await page.evaluate(() => window.testSetEnabled(false));
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(element => getComputedStyle(element).display !== 'none'), ads);
  await page.evaluate(() => window.testSetEnabled(true));
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(element => getComputedStyle(element).display === 'none'), ads);
});

test('DCInside selectors require the exact trusted frame host and dedicated ad containers', { skip: !chromium }, async t => {
  const page = await setup(t);
  await insertCommentRows(page);
  assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 1);
  for (const hostname of ['gall.dcinside.com.example.test', 'dcinside.com']) {
    await page.evaluate(hostname => { window.testContext.frameHost = hostname; window.testSetEnabled(true); }, hostname);
    assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 1);
    assert.equal(await page.locator('.cmt_list > .dory').first().isVisible(), true);
  }
});

async function insertGaejuki(page) {
  await page.evaluate(() => {
    const sheet = document.createElement('style');
    sheet.id = 'styleGaejuki';
    sheet.textContent = '.content_box { background: rgb(1, 2, 3) } .moveimg { position:fixed; inset:0; animation:mymove 10s infinite } @keyframes mymove {from{opacity:1}to{opacity:.9}}';
    document.body.append(sheet);
    const mascot = document.createElement('div');
    mascot.id = 'gaejukimg'; mascot.className = 'moveimg';
    mascot.innerHTML = '<img src="https://nstatic.dcinside.com/dc/w/images/moveimg.png" width="1400" height="900">';
    document.body.append(mascot);
    const blocker = document.createElement('div');
    blocker.id = 'mascot-blocker'; blocker.className = 'click-blocker';
    blocker.style.cssText = 'position:fixed;inset:0;z-index:99998;background:transparent';
    document.body.append(blocker);
    const article = document.createElement('div'); article.id = 'article-photo'; article.className = 'content_box';
    article.innerHTML = '<img src="https://nstatic.dcinside.com/dc/w/images/moveimg.png" width="100" height="100"><p>Keep article text and images</p>';
    document.querySelector('main').append(article);
    const dialog = document.createElement('div'); dialog.id = 'ordinary-dialog'; dialog.className = 'click-blocker';
    dialog.style.cssText = 'position:fixed;inset:0;pointer-events:none';
    dialog.innerHTML = '<button>Normal dialog</button>';
    document.body.append(dialog);
  });
}

test('DCInside mascot sheet, large decoration and empty click shield restore and survive reinsertion', { skip: !chromium }, async t => {
  const page = await setup(t, { context: { ok: true, enabled: true, site: 'gall.dcinside.com', frameHost: 'gall.dcinside.com', rules: [] } });
  await insertGaejuki(page);
  const check = () => page.waitForFunction(() =>
    document.querySelector('#styleGaejuki').media === 'not all' &&
    ['#gaejukimg', '#mascot-blocker'].every(s => getComputedStyle(document.querySelector(s)).display === 'none'));
  await check();
  assert.equal(await page.locator('#article-photo img').isVisible(), true);
  assert.equal(await page.locator('#ordinary-dialog').isVisible(), true);
  assert.notEqual(await page.locator('#article-photo').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(1, 2, 3)');
  assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 3);
  await page.evaluate(() => {
    document.querySelector('#styleGaejuki').media = 'screen';
    document.querySelector('#gaejukimg').style.setProperty('display', 'block', 'important');
  });
  await check();
  await page.evaluate(() => window.testSetEnabled(false));
  await page.waitForFunction(() => document.querySelector('#styleGaejuki').media === 'screen' && getComputedStyle(document.querySelector('#mascot-blocker')).display !== 'none');
  assert.equal(await page.locator('#gaejukimg').evaluate(e => getComputedStyle(e).display), 'block');
  assert.equal(await page.locator('#article-photo').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(1, 2, 3)');
  await page.evaluate(() => window.testSetEnabled(true));
  await check();
  await page.evaluate(() => {
    const old = document.querySelector('#gaejukimg');
    const replacement = old.cloneNode(true);
    replacement.removeAttribute('style');
    for (const attribute of replacement.getAttributeNames()) if (attribute.startsWith('data-basic-block-')) replacement.removeAttribute(attribute);
    old.replaceWith(replacement);
    const sheet = document.querySelector('#styleGaejuki');
    const freshSheet = document.createElement('style'); freshSheet.id = sheet.id; freshSheet.textContent = sheet.textContent;
    sheet.replaceWith(freshSheet);
  });
  await check();
  await page.evaluate(() => window.testSetEnabled(false));
  await page.waitForFunction(() => !document.querySelector('#styleGaejuki').hasAttribute('media'));
  assert.equal(await page.locator('#article-photo img').isVisible(), true);
});

test('mascot suppression requires trusted DCInside host, dedicated sheet and image structure', { skip: !chromium }, async t => {
  const page = await setup(t);
  await insertGaejuki(page);
  assert.equal(await page.locator('#gaejukimg').isVisible(), true);
  assert.equal(await page.locator('#styleGaejuki').getAttribute('media'), null);
  for (const hostname of ['gall.dcinside.com.example.test', 'dcinside.com']) {
    await page.evaluate(hostname => { window.testContext.frameHost = hostname; window.testSetEnabled(true); }, hostname);
    assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 1);
    assert.equal(await page.locator('#styleGaejuki').getAttribute('media'), null);
  }
  await page.evaluate(() => {
    window.testContext.frameHost = 'gall.dcinside.com';
    document.querySelector('#styleGaejuki').textContent = '.moveimg { color:red }';
    window.testSetEnabled(true);
  });
  assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 1);
  assert.equal(await page.locator('#styleGaejuki').getAttribute('media'), null);
  assert.equal(await page.locator('#mascot-blocker').isVisible(), true);
  await page.evaluate(() => {
    document.querySelector('#styleGaejuki').textContent += '@keyframes mymove {from{opacity:1}to{opacity:.9}}';
    document.querySelector('#gaejukimg').innerHTML = '<p>Real content, not a mascot</p>';
  });
  assert.equal((await page.evaluate(() => window.testPageStatus())).autoHiddenCount, 1);
  assert.equal(await page.locator('#gaejukimg').isVisible(), true);
  assert.equal(await page.locator('#mascot-blocker').isVisible(), true);
});

test('move preview preserves the live frame and dimensions, cancels, saves, reinserts and undoes', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.locator('#custom-banner').evaluate(element => {
    element.style.setProperty('translate', '7px 3px', 'important');
    element.style.setProperty('transform', 'scale(0.9)');
    element.innerHTML = '<iframe id="live-ad" srcdoc="<p>Live banner</p>" style="width:100px;height:50px"></iframe>';
    window.originalBanner = element;
    window.originalFrame = element.firstElementChild;
    window.originalFrameWindow = element.firstElementChild.contentWindow;
  });
  const before = await page.locator('#custom-banner').evaluate(element => ({ width: element.offsetWidth, height: element.offsetHeight, transform: element.style.transform }));
  await openPicker(page, '#custom-banner', 'move');
  await page.getByRole('heading', { name: '이 요소 이동시키기', exact: true }).waitFor();
  await page.getByRole('button', { name: '이동 미리보기', exact: true }).click();
  const moved = await page.locator('#custom-banner').evaluate(element => ({
    width: element.offsetWidth, height: element.offsetHeight, transform: element.style.transform,
    display: getComputedStyle(element).display, outside: element.getBoundingClientRect().right < 0,
    same: element === window.originalBanner && element.firstElementChild === window.originalFrame && element.firstElementChild.contentWindow === window.originalFrameWindow,
  }));
  assert.deepEqual(moved, { ...before, display: 'grid', outside: true, same: true });
  assert.equal((await page.evaluate(() => window.testPageStatus())).manualHiddenCount, 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#custom-banner').evaluate(element => element.style.translate), '7px 3px');
  assert.equal(await page.evaluate(() => window.testSavedCalls), 0);
  // Select the outer banner again through the right-click target, then save.
  await openPicker(page, '#custom-banner', 'move');
  await page.getByRole('button', { name: '이동 미리보기', exact: true }).click();
  await page.getByRole('button', { name: '미리보기 되돌리기', exact: true }).click();
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/move-picker.png', import.meta.url)) });
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testContext.rules[0].action), 'move');
  assert.equal((await page.evaluate(() => window.testPageStatus())).manualHiddenCount, 1);
  await page.locator('#custom-banner').evaluate(element => {
    const replacement = document.createElement('div');
    replacement.id = element.id; replacement.className = element.className;
    replacement.textContent = 'Replacement banner'; element.replaceWith(replacement);
  });
  await page.waitForFunction(() => document.querySelector('#custom-banner').getBoundingClientRect().right < 0);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#custom-banner').getBoundingClientRect().right > 0);
  assert.equal(await page.evaluate(() => window.testContext.rules.length), 0);
});

test('move selection from popup retains its action and restores inline text layout and newest page styles', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.locator('#other').evaluate(element => { element.innerHTML = '<span id="inline-ad">Inline promotional text</span>'; });
  assert.deepEqual(await page.evaluate(() => window.testStartPicker('move')), { ok: true });
  await page.locator('#inline-ad').click();
  await page.getByRole('button', { name: '이동 미리보기', exact: true }).click();
  assert.deepEqual(await page.locator('#inline-ad').evaluate(element => ({ display: getComputedStyle(element).display, outside: element.getBoundingClientRect().right < 0 })), { display: 'inline-block', outside: true });
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.locator('#inline-ad').evaluate(element => ({ display: getComputedStyle(element).display, inline: element.style.display, translate: element.style.translate })), { display: 'inline', inline: '', translate: '' });
  await openPicker(page, '#inline-ad', 'move');
  await page.getByRole('button', { name: '이동 미리보기', exact: true }).click();
  await page.locator('#inline-ad').evaluate(element => {
    element.style.setProperty('translate', '11px 13px', 'important');
    element.style.setProperty('display', 'flex', 'important');
  });
  await page.waitForFunction(() => document.querySelector('#inline-ad').style.translate === '-100000px -100000px');
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.locator('#inline-ad').evaluate(element => ({ display: element.style.display, translate: element.style.translate, priority: element.style.getPropertyPriority('translate') })), { display: 'flex', translate: '11px 13px', priority: 'important' });
});

test('manual move overrides the same automatic hide, explicit hide wins and pause restores latest styles', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    window.testContext.rules = [{ id: 'move', site: 'picker.test', frameHost: 'picker.test', selector: '#generic', action: 'move' }];
    window.testSetEnabled(true);
  });
  await page.waitForFunction(() => document.querySelector('#generic').getBoundingClientRect().right < 0 && getComputedStyle(document.querySelector('#generic')).display !== 'none');
  const status = await page.evaluate(() => window.testPageStatus());
  assert.equal(status.manualHiddenCount, 1);
  assert.equal(status.autoHiddenCount, 0);
  await page.evaluate(() => {
    window.testContext.rules.push({ id: 'hide', site: 'picker.test', frameHost: 'picker.test', selector: 'ins#generic', action: 'hide' });
    window.testSetEnabled(true);
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#generic')).display === 'none');
  assert.equal(await page.locator('#generic').evaluate(element => element.style.translate), '');
  await page.evaluate(() => { window.testContext.rules.pop(); window.testSetEnabled(true); });
  await page.waitForFunction(() => document.querySelector('#generic').getBoundingClientRect().right < 0);
  await page.locator('#generic').evaluate(element => { element.style.setProperty('translate', '12px 14px', 'important'); });
  await page.waitForFunction(() => document.querySelector('#generic').style.translate === '-100000px -100000px');
  await page.evaluate(() => window.testSetEnabled(false));
  await page.waitForFunction(() => document.querySelector('#generic').style.translate === '12px 14px');
  assert.equal(await page.locator('#generic').evaluate(element => element.style.display), 'inline-block');
});

test('move refuses layouts without a movable box and cannot save an ineffective preview', { skip: !chromium }, async t => {
  const page = await setup(t);
  await openPicker(page, '#custom-banner', 'move');
  await page.locator('#custom-banner').evaluate(element => element.style.setProperty('display', 'contents', 'important'));
  await page.getByRole('button', { name: '이동 미리보기', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.testSavedCalls), 0);
  assert.equal(await page.locator('#custom-banner').evaluate(element => element.style.translate), '');
  await page.keyboard.press('Escape');
});

test('Sports Seoul saved move survives reload with changed ad names and inserted neighboring content', { skip: !chromium }, async t => {
  const markup = (name, prefix = '') => `<!doctype html><main id="container"><section class="contents"><article><div id="article-body">
    <p id="normal">Article text remains.</p>${prefix}<span id="${name}" class="${name}x" style="display:block;width:320px;padding:10px">
    <div><iframe src="" width="   300" height="   250"></iframe></div></span>
    </div></article></section></main><ins id="generic" class="adsbygoogle">generic</ins>`;
  const oldName = 'fykffqwzlc9m9h4ync5f7y949ngc9a';
  const newName = 'fykffqwzlcg0gcn9fcs';
  const options = { fixture: markup(oldName), context: { ok: true, enabled: true, site: 'www.sportsseoul.com', frameHost: 'www.sportsseoul.com', rules: [] } };
  const page = await setup(t, options);
  await page.locator(`#${oldName}`).click({ button: 'right', position: { x: 3, y: 3 } });
  assert.equal((await page.evaluate(() => window.testPick('move'))).ok, true);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).waitFor();
  const rules = await page.evaluate(() => window.testContext.rules);
  assert.match(rules[0].selector, /#article-body > span:has/);
  assert.equal(rules[0].selector.includes(oldName), false);
  options.fixture = markup(newName, '<span id="ordinary-span">A new non-ad element before the banner.</span>');
  await page.addInitScript(rules => { window.testContext.rules = rules; }, rules);
  await page.reload();
  await page.addScriptTag({ content: contentScript });
  await page.waitForFunction(name => document.getElementById(name).getBoundingClientRect().right < 0, newName);
  assert.equal(await page.locator('#normal').isVisible(), true);
  assert.equal(await page.locator('#ordinary-span').isVisible(), true);
  assert.equal(await page.locator(`#${oldName}`).count(), 0);
  // An ambiguous replacement must not silently move both new slots.
  await page.locator(`#${newName}`).evaluate(element => { const other = element.cloneNode(true); other.id = 'another-slot'; element.after(other); });
  await page.waitForFunction(name => document.getElementById(name).style.translate === '', newName);
});

test('opaque alphanumeric names are not persisted as stable selector anchors', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.locator('#other').evaluate(element => { element.innerHTML = '<div id="stable-slot"><span id="fykffqwzlcyygnl92g79j9r790u29nz" class="fykffqwzlcog0sg7s9wug0z9j">Offer</span></div>'; });
  await openPicker(page, '#stable-slot > span', 'move');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).waitFor();
  const selector = await page.evaluate(() => window.testContext.rules[0].selector);
  assert.equal(selector.includes('fykffqwzlc'), false);
  await page.locator('#stable-slot').evaluate(element => { element.innerHTML = '<span id="fykffqwzlcg0gcn9fcs">A different offer</span>'; });
  await page.waitForFunction(() => document.querySelector('#stable-slot > span').getBoundingClientRect().right < 0);
});

test('SNS hiding requires advertising markers and restores on global pause', { skip: !chromium }, async t => {
  const page = await setup(t, { fixture: `<!doctype html><body>
    <ins id="generic" class="adsbygoogle">Generic advertisement</ins>
    <div class="social-feed-ad" data-ad-type="social_feed" id="ad">Sponsored ad</div>
    <article class="sponsored-post" aria-label="Sponsored" id="marked">Paid post</article>
    <article class="sponsored-post" id="normal">Ordinary post discussing sponsorship</article>
    <article class="sponsored-post" aria-label="Sponsored" id="media"><video></video></article>
    <main>Normal article</main></body>` });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#ad')).display === 'none');
  assert.equal(await page.locator('#marked').isVisible(), false);
  assert.equal(await page.locator('#normal').isVisible(), true);
  assert.equal(await page.locator('#media').isVisible(), true);
  await page.evaluate(() => window.testSetEnabled(false));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#ad')).display !== 'none');
  assert.equal(await page.locator('#marked').isVisible(), true);
});
