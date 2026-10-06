import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')); } catch { /* Optional browser tooling. */ }
const executablePath = process.env.EXTENSION_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

test('packaged public filters load in native Chromium, block both lists, preserve exceptions and toggle CSS', {
  skip: !chromium || !existsSync(executablePath), timeout: 90000,
}, async t => {
  const extension = fileURLToPath(new URL('..', import.meta.url));
  const profile = await mkdtemp(join(tmpdir(), 'basic-banner-public-'));
  const browser = await chromium.launchPersistentContext(profile, {
    executablePath, headless: true, viewport: { width: 1280, height: 960 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  t.after(async () => {
    await browser.close();
    if (resolve(dirname(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('basic-banner-public-')) throw new Error('Unexpected test profile path');
    await rm(profile, { recursive: true, force: true });
  });
  const errors = [];
  browser.on('weberror', event => errors.push(event.error().message));
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(worker.url()).host;
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  const send = payload => options.evaluate(message => chrome.runtime.sendMessage(message), payload);
  const status = await send({ type: 'GET_FILTER_STATUS' });
  assert.equal(status.ok, true, status.error);
  assert.equal(status.filterStatus.enabled, true, status.filterStatus.error);
  assert.equal(status.filterStatus.error, null);
  assert.ok(status.filterStatus.metadata.network.ruleCount > 10000);
  await options.getByRole('switch', { name: '공개 필터 사용' }).waitFor();
  await options.waitForFunction(() => document.querySelector('#public-filter-toggle').checked);
  const rules = JSON.parse(await readFile(new URL('../rules/public-ads.json', import.meta.url), 'utf8'));
  const regexChecks = await worker.evaluate(async rules => Promise.all(rules.map(async rule => ({
    id: rule.id, ...(await chrome.declarativeNetRequest.isRegexSupported({
      regex: rule.condition.regexFilter, isCaseSensitive: rule.condition.isUrlFilterCaseSensitive === true,
      requireCapturing: false,
    })),
  }))), rules.filter(rule => rule.condition.regexFilter));
  assert.deepEqual(regexChecks.filter(result => !result.isSupported), [], 'Every packaged regex must pass the native engine');
  const actionById = new Map(rules.map(rule => [rule.id, rule.action.type]));
  const matches = request => worker.evaluate(request => chrome.declarativeNetRequest.testMatchOutcome(request), request);
  const publicBlock = result => result.matchedRules.some(rule => rule.rulesetId === 'public_ads' && actionById.get(rule.ruleId) === 'block');
  for (const url of ['https://01counter.com/ad.js', 'https://adflow.kr/ad.js']) {
    assert.equal(publicBlock(await matches({ url, type: 'script', initiator: 'https://news.test' })), true, url);
    assert.equal(publicBlock(await matches({ url, type: 'media', initiator: 'https://news.test' })), false, 'Media must remain excluded');
    assert.equal(publicBlock(await matches({ url, type: 'main_frame', initiator: 'https://news.test' })), false, 'Navigation must remain excluded');
  }
  assert.equal(publicBlock(await matches({ url: 'https://news.test/article.js', type: 'script', initiator: 'https://news.test' })), false);
  const exception = await matches({ url: 'https://newliweb.com/ad.js', type: 'script', initiator: 'https://namu.wiki' });
  assert.ok(exception.matchedRules.some(rule => rule.rulesetId === 'public_ads' && actionById.get(rule.ruleId) === 'allow'), 'Korean allow exception must survive conversion');

  const page = await browser.newPage();
  await page.route(/^http:\/\/(?:news\.test|arca\.live)\//, route => route.fulfill({ contentType: 'text/html',
    headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'none'; script-src 'none'" }, body: `<!doctype html>
    <main><h1>Ordinary article</h1><p>Visible main content</p></main>
    <div id="public-ad" class="a-ad" style="width:300px;height:80px">Public list banner</div>
    <div id="manual-ad" style="width:300px;height:80px">Saved manual banner</div>
    <div id="player" class="a-ad"><video width="300" height="80"></video></div>
    <input id="search" aria-label="Search" value="normal">` }));
  await page.goto('http://news.test/article');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#public-ad')).display === 'none');
  assert.equal(await page.locator('main').isVisible(), true);
  assert.equal(await page.locator('#player').isVisible(), true);
  assert.equal(await page.locator('#search').inputValue(), 'normal');
  const backup = { format: 'basic-banner-blocker-rules', version: 1, disabledSites: [], networkRules: [],
    customRules: [{ id: 'public-integration-manual', site: 'news.test', frameHost: 'news.test', selector: '#manual-ad', label: 'Saved banner', enabled: true, createdAt: 1 }] };
  assert.equal((await send({ type: 'IMPORT_BACKUP', backup })).ok, true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#manual-ad')).display === 'none');
  assert.equal((await send({ type: 'SET_PUBLIC_FILTERS_ENABLED', enabled: false })).ok, true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#public-ad')).display !== 'none');
  assert.equal(await page.locator('#manual-ad').isVisible(), false, 'Manual rules must survive public filter disable');
  assert.equal(publicBlock(await matches({ url: 'https://adflow.kr/ad.js', type: 'script', initiator: 'https://news.test' })), false);
  assert.equal((await send({ type: 'SET_PUBLIC_FILTERS_ENABLED', enabled: true })).ok, true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#public-ad')).display === 'none');
  await send({ type: 'SET_ENABLED', enabled: false });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#public-ad')).display !== 'none' && getComputedStyle(document.querySelector('#manual-ad')).display !== 'none');
  const off = await matches({ url: 'https://adflow.kr/ad.js', type: 'script', initiator: 'https://news.test' });
  assert.ok(off.matchedRules.some(rule => rule.rulesetId === '_dynamic' && rule.ruleId === 1));
  assert.equal(publicBlock(off), false);
  await send({ type: 'SET_ENABLED', enabled: true });
  await send({ type: 'SET_SITE_ENABLED', site: 'news.test', enabled: false });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#public-ad')).display !== 'none');
  await send({ type: 'SET_SITE_ENABLED', site: 'news.test', enabled: true });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#public-ad')).display === 'none');
  await page.goto('http://arca.live/article');
  // Upstream @@||arca.live^$generichide exempts generic CSS on this host.
  await page.waitForFunction(() => document.querySelector('#public-ad') && [...document.querySelectorAll('style')].length > 0);
  const tab = await options.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('http://arca.live/')));
  const diagnostic = await send({ type: 'GET_DIAGNOSTICS', tabId: tab.id });
  assert.equal(diagnostic.diagnostics.publicCosmeticsError, null);
  assert.equal(await page.locator('#public-ad').isVisible(), true, 'Generic exception must preserve content');
  await mkdir(join(extension, 'test-results'), { recursive: true });
  await options.reload();
  await options.waitForFunction(() => document.querySelector('#public-network-count').textContent !== '—');
  await options.screenshot({ path: join(extension, 'test-results/public-filter-options.png'), fullPage: false });
  assert.deepEqual(errors, []);
});
