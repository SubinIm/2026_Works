import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

let chromium;
try {
  const moduleName = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright';
  ({ chromium } = await import(moduleName));
} catch { /* Browser tests use the same optional runtime convention as the existing tests. */ }

async function setup(t, surface = 'popup') {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 380, height: 900 } });
  const sources = Object.fromEntries(await Promise.all(['popup.html', 'sidepanel.html', 'popup.css', 'popup.js', 'icons/mark.svg'].map(async name =>
    [name, await readFile(new URL(`../${name}`, import.meta.url), 'utf8')])));
  await page.route('http://popup.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'popup.html';
    const body = sources[name];
    return body === undefined ? route.abort() : route.fulfill({
      contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript', body,
    });
  });
  await page.addInitScript(() => {
    window.testState = {
      version: 1, enabled: true, disabledSites: [], networkRules: [],
      customRules: [
        { id: 'hide-one', site: 'news.test', frameHost: 'news.test', selector: '#banner', label: '숨김 배너', enabled: true, createdAt: 1 },
        { id: 'move-one', site: 'news.test', frameHost: 'news.test', selector: '#rail', label: '이동 배너', action: 'move', enabled: true, createdAt: 2 },
      ],
    };
    window.testMessages = [];
    window.testCloseCount = 0;
    window.testPanelOpens = [];
    window.testTab = { id: 81, windowId: 7, url: 'https://news.test/article/1' };
    window.close = () => { window.testCloseCount += 1; };
    window.chrome = {
      windows: { async getCurrent() { return { id: 7 }; } },
      sidePanel: { async open(options) { window.testPanelOpens.push(options); } },
      tabs: {
        async query() { return [structuredClone(window.testTab)]; },
        onActivated: { addListener(fn) { window.testActivate = fn; } },
        onUpdated: { addListener(fn) { window.testUpdate = fn; } },
      },
      storage: { onChanged: { addListener() {} } },
      runtime: {
        async sendMessage(message) {
          window.testMessages.push(structuredClone(message));
          if (message.type === 'START_PICKER') return { ok: true };
          if (message.type === 'GET_DIAGNOSTICS') return {
            ok: true, diagnostics: { networkEnabled: true, contentReady: true, autoHiddenCount: 1, menuReady: true },
          };
          if (message.type === 'SET_SITE_ENABLED') window.testState.disabledSites = message.enabled ? [] : ['news.test'];
          if (message.type === 'DELETE_RULE') window.testState.customRules = window.testState.customRules.filter(rule => rule.id !== message.id);
          if (message.type === 'CLEAR_SITE_RULES') window.testState.customRules = [];
          const response = { ok: true, state: structuredClone(window.testState), site: window.testTab.url.startsWith('https:') ? new URL(window.testTab.url).hostname : null };
          if (message.type === 'GET_STATE' && window.testHoldNextRead) {
            window.testHoldNextRead = false;
            await new Promise(resolve => { window.testReleaseRead = resolve; });
          }
          return response;
        },
      },
    };
  });
  await page.goto(`http://popup.test/${surface}.html`);
  await page.waitForFunction(() => !document.querySelector('#start-move-picker').disabled);
  return page;
}

test('popup distinguishes hide and move, routes both picker actions, and locks them on paused sites', { skip: !chromium }, async t => {
  const page = await setup(t);
  assert.equal(await page.locator('#rule-count').textContent(), '2');
  const rows = page.locator('#rules-list > li');
  assert.match(await rows.nth(0).textContent(), /이동 배너화면 밖 이동/);
  assert.match(await rows.nth(1).textContent(), /숨김 배너숨김/);
  await page.getByRole('button', { name: '요소 이동시키기', exact: true }).click();
  await page.waitForFunction(() => window.testCloseCount === 1);
  await page.getByRole('button', { name: '요소 숨기기', exact: true }).click();
  await page.waitForFunction(() => window.testCloseCount === 2);
  assert.deepEqual(await page.evaluate(() => window.testMessages.filter(message => message.type === 'START_PICKER')), [
    { type: 'START_PICKER', tabId: 81, action: 'move' },
    { type: 'START_PICKER', tabId: 81, action: 'hide' },
  ]);
  await page.locator('#site-toggle').click();
  await page.waitForFunction(() => window.testState.disabledSites.length === 1 && !document.querySelector('#site-toggle').disabled);
  assert.equal(await page.locator('#start-picker').isDisabled(), true);
  assert.equal(await page.locator('#start-move-picker').isDisabled(), true);
});

test('popup restores a moved rule independently and clears the remaining manual rules', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.getByRole('button', { name: '이동 배너 복원', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#rule-count').textContent === '1' && !document.querySelector('#clear-rules').disabled);
  assert.deepEqual(await page.evaluate(() => window.testState.customRules.map(rule => rule.id)), ['hide-one']);
  assert.match(await page.locator('#feedback').textContent(), /화면 밖 이동 규칙을 삭제/);
  await page.locator('#clear-rules').click();
  assert.match(await page.locator('#clear-confirmation').textContent(), /숨기거나 이동한 항목/);
  await page.locator('#confirm-clear').click();
  await page.waitForFunction(() => document.querySelector('#rule-count').textContent === '0');
  assert.equal(await page.locator('#empty-rules').isVisible(), true);
  assert.match(await page.locator('#empty-rules').textContent(), /숨기거나 이동한/);
});

test('popup opens a window-scoped sidebar and sidebar remains open during element selection', { skip: !chromium }, async t => {
  const popup = await setup(t);
  await popup.getByRole('button', { name: '사이드바에서 열기', exact: true }).click();
  assert.deepEqual(await popup.evaluate(() => window.testPanelOpens), [{ windowId: 7 }]);
  assert.equal(await popup.evaluate(() => window.testCloseCount), 1);
  const panel = await setup(t, 'sidepanel');
  await panel.setViewportSize({ width: 320, height: 900 });
  assert.equal(await panel.locator('#open-sidebar').isVisible(), false);
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await panel.screenshot({ path: fileURLToPath(new URL('../test-results/sidepanel.png', import.meta.url)), fullPage: true });
  await panel.locator('#start-move-picker').click();
  assert.equal(await panel.evaluate(() => window.testCloseCount), 0);
  assert.match(await panel.locator('#feedback').textContent(), /열린 상태/);
});

test('sidebar follows its own window tabs and discards stale reads and confirmations', { skip: !chromium }, async t => {
  const panel = await setup(t, 'sidepanel');
  await panel.locator('#clear-rules').click();
  await panel.evaluate(() => {
    window.testHoldNextRead = true;
    window.testUpdate(81, { status: 'complete' });
  });
  await panel.waitForFunction(() => typeof window.testReleaseRead === 'function');
  await panel.evaluate(() => {
    window.testTab = { id: 82, windowId: 7, url: 'https://other.test/article' };
    window.testActivate({ tabId: 82, windowId: 7 });
  });
  await panel.waitForFunction(() => document.querySelector('#start-picker').disabled);
  await panel.evaluate(() => window.testReleaseRead());
  await panel.waitForFunction(() => document.querySelector('#site-name').textContent === 'other.test' && !document.querySelector('#start-picker').disabled);
  assert.equal(await panel.locator('#rule-count').textContent(), '0');
  assert.equal(await panel.locator('#clear-confirmation').isVisible(), false);
  const before = await panel.evaluate(() => window.testMessages.length);
  await panel.evaluate(() => window.testActivate({ tabId: 90, windowId: 8 }));
  assert.equal(await panel.evaluate(() => window.testMessages.length), before);
  await panel.locator('#start-picker').click();
  assert.deepEqual(await panel.evaluate(() => window.testMessages.filter(x => x.type === 'START_PICKER').at(-1)), { type: 'START_PICKER', tabId: 82, action: 'hide' });
  await panel.evaluate(() => {
    window.testTab.url = 'chrome://extensions/';
    window.testUpdate(82, { url: window.testTab.url });
  });
  await panel.waitForFunction(() => document.querySelector('#site-name').textContent === '일반 웹사이트를 열어 주세요');
  assert.equal(await panel.locator('#start-picker').isDisabled(), true);
  assert.equal(await panel.locator('#site-toggle').isDisabled(), true);
});
