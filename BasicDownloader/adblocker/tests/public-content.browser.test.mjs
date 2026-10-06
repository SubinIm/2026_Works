import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')); } catch { /* Optional browser tooling. */ }
const content = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const helper = await readFile(new URL('../cosmetic-filters.js', import.meta.url), 'utf8');

async function setup(t, delayed = false) {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://public-filter.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <main>Ordinary article</main><div class="public-ad">Advertisement</div><div class="manual-ad">Manual advertisement</div>
    <div class="public-ad"><video></video></div><div id="ordinary">Ordinary content</div>` }));
  await page.addInitScript(delayed => {
    let listener, storageListener;
    window.testContext = { ok: true, enabled: true, publicFiltersEnabled: true, site: 'public-filter.test', frameHost: 'public-filter.test', rules: [] };
    window.publicLoads = 0;
    const gate = delayed ? new Promise(resolve => { window.releasePublic = resolve; }) : Promise.resolve();
    window.changeContext = values => { Object.assign(window.testContext, values); storageListener({ adblockState: {} }, 'local'); };
    window.getStatus = () => new Promise(resolve => listener({ type: 'GET_PAGE_STATUS' }, {}, resolve));
    window.chrome = {
      storage: { onChanged: { addListener: callback => { storageListener = callback; } } },
      runtime: {
        onMessage: { addListener: callback => { listener = callback; } },
        sendMessage: async message => {
          if (message.type === 'GET_CONTEXT') return structuredClone(window.testContext);
          if (message.type === 'GET_PUBLIC_COSMETICS') {
            window.publicLoads++;
            await gate;
            return { ok: true, selection: { selectors: ['.public-ad'], counts: {}, disabled: {} } };
          }
          return { ok: false };
        },
      },
    };
  }, delayed);
  await page.goto('http://public-filter.test/');
  await page.addScriptTag({ content: helper });
  await page.addScriptTag({ content });
  return page;
}

test('public native CSS handles new ads, toggle restoration and does not scan selectors per mutation', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.public-ad')).display === 'none');
  assert.equal(await page.locator('main').isVisible(), true);
  assert.notEqual(await page.locator('video').evaluate(el => getComputedStyle(el.parentElement).display), 'none');
  await page.evaluate(() => {
    window.publicQueries = 0;
    const original = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (selector) { if (selector.includes('public-ad')) window.publicQueries++; return original.call(this, selector); };
    const el = document.createElement('div'); el.className = 'public-ad'; el.id = 'new-ad'; el.textContent = 'New advertisement'; document.body.append(el);
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#new-ad')).display === 'none');
  const status = await page.evaluate(() => window.getStatus());
  assert.equal(status.publicCosmeticsEnabled, true);
  assert.equal(status.publicSelectorCount, 1);
  assert.equal(status.autoHiddenCount, 0, 'Public rule count must not be reported as hidden elements');
  assert.equal(await page.evaluate(() => window.publicQueries), 0);
  await page.evaluate(() => window.changeContext({ publicFiltersEnabled: false }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#new-ad')).display !== 'none');
  await page.evaluate(() => window.changeContext({ publicFiltersEnabled: true }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#new-ad')).display === 'none');
  assert.equal(await page.evaluate(() => window.publicLoads), 1, 'Cached packaged data must survive toggles');
  await page.evaluate(() => window.changeContext({ enabled: false }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#new-ad')).display !== 'none');
});

test('a late public filter reply respects a newer disabled context and recovers on enable', { skip: !chromium }, async t => {
  const page = await setup(t, true);
  await page.waitForFunction(() => window.publicLoads === 1);
  await page.evaluate(() => window.changeContext({ publicFiltersEnabled: false }));
  await page.evaluate(() => window.releasePublic());
  await page.waitForFunction(async () => (await window.getStatus()).publicSelectorCount === 1);
  assert.equal((await page.evaluate(() => window.getStatus())).publicCosmeticsEnabled, false);
  assert.equal(await page.locator('.public-ad').first().isVisible(), true);
  await page.evaluate(() => window.changeContext({ publicFiltersEnabled: true }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.public-ad')).display === 'none');
});

test('public stylesheet repairs observed edits and status-detected disabling without repeated text scans or observer loops', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.public-ad')).display === 'none');
  await page.evaluate(() => {
    const style = [...document.documentElement.children].find(element => element.tagName === 'STYLE' && element.textContent.includes(':is('));
    window.publicTestStyle = style;
    window.publicRepairWork = { textReads: 0, ruleQueries: 0 };
    const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    Object.defineProperty(style, 'textContent', {
      get() { window.publicRepairWork.textReads++; return text.get.call(this); },
      set(value) { return text.set.call(this, value); },
    });
    const query = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (selector) {
      if (selector === 'ins.adsbygoogle') window.publicRepairWork.ruleQueries++;
      return query.call(this, selector);
    };
    document.querySelector('#ordinary').textContent = 'Updated ordinary content';
    document.body.append(document.createElement('p'));
  });
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => window.publicRepairWork), { textReads: 0, ruleQueries: 1 });

  await page.evaluate(() => { window.publicTestStyle.textContent = ''; });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.public-ad')).display === 'none');
  assert.equal(await page.evaluate(() => window.publicRepairWork.textReads), 1);
  await page.evaluate(() => { window.publicTestStyle.firstChild.data = ''; });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.public-ad')).display === 'none');
  assert.equal(await page.evaluate(() => window.publicRepairWork.textReads), 2);
  await page.evaluate(() => { window.publicTestStyle.media = 'print'; });
  await page.waitForFunction(() => !window.publicTestStyle.hasAttribute('media') && getComputedStyle(document.querySelector('.public-ad')).display === 'none');
  await page.evaluate(() => { window.publicTestStyle.type = 'text/plain'; });
  await page.waitForFunction(() => !window.publicTestStyle.hasAttribute('type') && getComputedStyle(document.querySelector('.public-ad')).display === 'none');
  await page.evaluate(() => { window.publicTestStyle.sheet.disabled = true; });
  assert.equal(await page.locator('.public-ad').first().isVisible(), true);
  assert.equal((await page.evaluate(() => window.getStatus())).publicCosmeticsEnabled, true);
  assert.equal(await page.locator('.public-ad').first().isHidden(), true);
  await page.evaluate(() => window.publicTestStyle.remove());
  await page.waitForFunction(() => window.publicTestStyle.isConnected && getComputedStyle(document.querySelector('.public-ad')).display === 'none');

  await page.evaluate(() => window.changeContext({ publicFiltersEnabled: false }));
  await page.waitForFunction(() => !window.publicTestStyle.isConnected);
  await page.evaluate(() => { window.publicTestStyle.textContent = ''; });
  await page.evaluate(() => window.changeContext({ publicFiltersEnabled: true }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.public-ad')).display === 'none');
  assert.equal(await page.evaluate(() => window.publicLoads), 1);
  await page.waitForTimeout(150);
  const settled = await page.evaluate(() => ({ ...window.publicRepairWork }));
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => window.publicRepairWork), settled, 'Repairs must not repeatedly trigger themselves');
});
