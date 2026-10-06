import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'));
} catch { /* Optional native browser integration; unit tests require no dependencies. */ }
const executablePath = process.env.EXTENSION_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

test('installed rule manager merges backups, toggles cosmetic rules and applies native scoped DNR', {
  skip: !chromium || !existsSync(executablePath), timeout: 60000,
}, async t => {
  const extension = fileURLToPath(new URL('..', import.meta.url));
  const profile = await mkdtemp(join(tmpdir(), 'basic-banner-manager-'));
  const browser = await chromium.launchPersistentContext(profile, {
    executablePath, headless: true, viewport: { width: 1200, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  t.after(async () => {
    await browser.close();
    if (resolve(dirname(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('basic-banner-manager-')) throw new Error('Unexpected profile path');
    await rm(profile, { recursive: true, force: true });
  });
  const errors = [];
  browser.on('weberror', event => errors.push(event.error().message));
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  const send = payload => options.evaluate(message => chrome.runtime.sendMessage(message), payload);
  assert.equal((await send({ type: 'GET_STATE' })).ok, true);

  const page = await browser.newPage();
  await page.route('http://news.test/**', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><main><h1>Normal article</h1></main><div id="partner-banner" style="width:300px;height:80px;display:grid!important">Partner offer</div><div id="move-banner" style="width:300px;height:100px;display:grid!important;translate:5px 7px!important;transform:translateX(3px)"><iframe width="280" height="80" srcdoc="<p>Keep this frame loaded</p>"></iframe></div>' }));
  await page.goto('http://news.test/article');
  const backup = {
    format: 'basic-banner-blocker-rules', version: 1, disabledSites: [],
    customRules: [{ id: 'import-cosmetic', site: 'news.test', frameHost: 'news.test', selector: '#partner-banner', label: '협찬 카드', enabled: true, createdAt: 1 }],
    networkRules: [{ id: 'import-network', domain: 'ads.vendor.test', site: 'news.test', enabled: true, createdAt: 1 }],
  };
  const preview = await send({ type: 'PREVIEW_IMPORT_BACKUP', backup });
  assert.equal(preview.ok, true, preview.error);
  assert.equal(preview.preview.added.customRules, 1);
  assert.equal(preview.preview.added.networkRules, 1);
  assert.equal((await send({ type: 'GET_STATE' })).state.customRules.length, 0, 'Preview must not mutate storage');
  const imported = await send({ type: 'IMPORT_BACKUP', backup });
  assert.equal(imported.ok, true, imported.error);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#partner-banner')).display === 'none');
  assert.equal(await page.locator('main').isVisible(), true);
  const ruleId = imported.state.customRules[0].id;
  const networkId = imported.state.networkRules[0].id;
  assert.equal((await send({ type: 'SET_RULE_ENABLED', id: ruleId, enabled: false })).ok, true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#partner-banner')).display === 'grid');
  assert.equal((await send({ type: 'SET_RULE_ENABLED', id: ruleId, enabled: true })).ok, true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#partner-banner')).display === 'none');

  const matchesUserBlock = async (url, type, initiator) => worker.evaluate(async request => {
    const result = await chrome.declarativeNetRequest.testMatchOutcome(request);
    return result.matchedRules.some(rule => rule.rulesetId === '_dynamic' && rule.ruleId >= 10000);
  }, { url, type, initiator });
  assert.equal(await matchesUserBlock('https://ads.vendor.test/a.js', 'script', 'https://news.test'), true);
  assert.equal(await matchesUserBlock('https://cdn.ads.vendor.test/a.png', 'image', 'https://sub.news.test'), true);
  assert.equal(await matchesUserBlock('https://notads.vendor.test/a.js', 'script', 'https://news.test'), false);
  assert.equal(await matchesUserBlock('https://ads.vendor.test/a.js', 'script', 'https://unrelated.test'), false);
  assert.equal(await matchesUserBlock('https://ads.vendor.test/a.mp4', 'media', 'https://news.test'), false);
  assert.equal(await matchesUserBlock('https://ads.vendor.test/', 'main_frame', 'https://news.test'), false);

  await send({ type: 'SET_NETWORK_RULE_ENABLED', id: networkId, enabled: false });
  assert.equal(await matchesUserBlock('https://ads.vendor.test/a.js', 'script', 'https://news.test'), false);
  await send({ type: 'SET_NETWORK_RULE_ENABLED', id: networkId, enabled: true });
  await send({ type: 'SET_ENABLED', enabled: false });
  assert.equal(await matchesUserBlock('https://ads.vendor.test/a.js', 'script', 'https://news.test'), false);
  await send({ type: 'SET_ENABLED', enabled: true });

  const globalRule = await send({ type: 'ADD_NETWORK_RULE', domain: 'global-ad.test', site: null });
  assert.equal(globalRule.ok, true, globalRule.error);
  assert.equal(await matchesUserBlock('https://global-ad.test/a.js', 'script', 'https://news.test'), true);
  assert.equal(await matchesUserBlock('https://global-ad.test/a.js', 'script', 'https://global-ad.test'), false, 'First-party assets must not be blocked by this third-party rule');
  await send({ type: 'DELETE_NETWORK_RULE', id: globalRule.rule.id });

  const duplicate = await send({ type: 'IMPORT_BACKUP', backup });
  assert.equal(duplicate.state.customRules.length, 1);
  assert.equal(duplicate.state.networkRules.length, 1);
  const invalid = await send({ type: 'IMPORT_BACKUP', backup: { ...backup, networkRules: [{ ...backup.networkRules[0], domain: 'https://invalid.test/path' }] } });
  assert.equal(invalid.ok, false);
  assert.equal((await send({ type: 'GET_STATE' })).state.networkRules.length, 1);

  await options.reload();
  await options.getByRole('heading', { name: '규칙 관리', exact: true }).waitFor();
  await options.getByText('ads.vendor.test', { exact: true }).first().waitFor();
  const downloadEvent = options.waitForEvent('download');
  await options.getByRole('button', { name: '백업 다운로드', exact: true }).click();
  const download = await downloadEvent;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.customRules.length, 1);
  assert.equal(exported.networkRules.length, 1);
  assert.equal(exported.enabled, undefined);
  await options.getByRole('button', { name: '협찬 카드 삭제', exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#partner-banner')).display === 'grid');
  await options.locator('#import-file').setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await options.getByRole('heading', { name: '가져올 내용 확인', exact: true }).waitFor();
  assert.equal((await send({ type: 'GET_STATE' })).state.customRules.length, 0);
  assert.equal(await options.locator('#import-custom-count').textContent(), '1개');
  await options.getByRole('button', { name: '확인한 내용 가져오기', exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#partner-banner')).display === 'none');

  // A native content script receives the new action through persisted state;
  // moving retains the embedded document rather than removing/reloading it.
  await page.evaluate(() => {
    const element = document.querySelector('#move-banner');
    const frame = element.querySelector('iframe');
    window.moveOriginal = { element, frame, frameWindow: frame.contentWindow, frameDocument: frame.contentDocument,
      width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height };
  });
  const moved = await send({ type: 'IMPORT_BACKUP', backup: {
    format: 'basic-banner-blocker-rules', version: 2, disabledSites: [], networkRules: [],
    customRules: [{ id: 'import-move', site: 'news.test', frameHost: 'news.test', selector: '#move-banner', action: 'move', label: '이동 카드', enabled: true, createdAt: 2 }],
  } });
  assert.equal(moved.ok, true, moved.error);
  const moveId = moved.state.customRules.find(rule => rule.action === 'move').id;
  await page.waitForFunction(() => document.querySelector('#move-banner').getBoundingClientRect().right < 0);
  assert.equal(await page.evaluate(() => {
    const { element, frame, frameWindow, frameDocument, width, height } = window.moveOriginal;
    const rect = element.getBoundingClientRect();
    return element.isConnected && frame.contentWindow === frameWindow && frame.contentDocument === frameDocument &&
      rect.width === width && rect.height === height && getComputedStyle(element).display === 'grid' &&
      element.style.transform === 'translateX(3px)';
  }), true);
  assert.equal(await page.locator('main').isVisible(), true);
  await options.getByText('이동 카드', { exact: true }).waitFor();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#move-banner').getBoundingClientRect().right < 0);
  await send({ type: 'SET_RULE_ENABLED', id: moveId, enabled: false });
  await page.waitForFunction(() => document.querySelector('#move-banner').style.translate === '5px 7px');
  assert.equal(await page.locator('#move-banner').evaluate(el => el.style.getPropertyPriority('translate')), 'important');
  await send({ type: 'SET_RULE_ENABLED', id: moveId, enabled: true });
  await page.waitForFunction(() => document.querySelector('#move-banner').getBoundingClientRect().right < 0);
  const movedDownloadEvent = options.waitForEvent('download');
  await options.getByRole('button', { name: '백업 다운로드', exact: true }).click();
  const movedExport = JSON.parse(await readFile(await (await movedDownloadEvent).path(), 'utf8'));
  assert.equal(movedExport.version, 2);
  assert.equal(movedExport.customRules.find(rule => rule.id === moveId).action, 'move');
  await options.getByRole('button', { name: '이동 카드 삭제', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#move-banner').style.translate === '5px 7px');

  // Exercise the actual popup entry point into the options page.
  await options.close();
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const openedOptions = browser.waitForEvent('page');
  await popup.getByRole('button', { name: '규칙 관리 · 백업', exact: true }).click();
  const manager = await openedOptions;
  await manager.getByRole('heading', { name: '규칙 관리', exact: true }).waitFor();
  await manager.getByText('ads.vendor.test', { exact: true }).first().waitFor();
  const artifacts = join(extension, 'test-results');
  await mkdir(artifacts, { recursive: true });
  await manager.screenshot({ path: join(artifacts, 'rule-manager.png'), fullPage: true });
  const sideOptions = await worker.evaluate(() => chrome.sidePanel.getOptions({}));
  assert.equal(sideOptions.path, 'sidepanel.html');
  assert.equal(sideOptions.enabled, true);
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByRole('heading', { name: '가벼운 광고 차단', exact: true }).waitFor();
  const panelResult = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: false }));
  assert.equal(panelResult.ok, true, panelResult.error);
  assert.equal(panelResult.state.enabled, false);
  assert.equal((await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: true }))).ok, true);
  assert.deepEqual(errors, []);
});
