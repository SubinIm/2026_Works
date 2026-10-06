import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')); } catch {}
const executablePath = process.env.EXTENSION_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const boot = `window.boot={gpc:navigator.globalPrivacyControl===true,topics:typeof document.browsingTopics,join:typeof navigator.joinAdInterestGroup,auction:typeof navigator.runAdAuction,token:typeof document.hasPrivateToken,attribution:'attributionSrc' in HTMLAnchorElement.prototype,storage:typeof document.requestStorageAccess};`;

test('native GPC reaches HTTP server and Sandbox policies restrict documents while pause restores behavior', {
  skip: !chromium || !existsSync(executablePath), timeout: 90000,
}, async t => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ path: req.url, gpc: req.headers['sec-gpc'] ?? null });
    if (req.url === '/echo') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ gpc: req.headers['sec-gpc'] ?? null })); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store',
      'Permissions-Policy': 'geolocation=()' });
    res.end(`<!doctype html><body><main>Normal article preserved</main><script>${boot}</script>${req.url === '/child' ? '' : '<iframe src="/child"></iframe>'}`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(join(tmpdir(), 'basic-banner-api-'));
  const extension = fileURLToPath(new URL('..', import.meta.url));
  const browser = await chromium.launchPersistentContext(profile, { executablePath, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  t.after(async () => {
    await browser.close();
    if (resolve(dirname(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('basic-banner-api-')) throw new Error('Unexpected profile path');
    await rm(profile, { recursive: true, force: true });
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  const send = payload => options.evaluate(message => chrome.runtime.sendMessage(message), payload);
  const toggle = (setting, enabled) => send({ type: 'SET_PRIVACY_PROTECTION', setting, enabled });
  const page = await browser.newPage();
  await page.goto(origin);
  const baseline = await page.evaluate(() => window.boot);
  assert.equal((await page.evaluate(() => fetch('/echo').then(r => r.json()))).gpc, null);
  assert.equal((await toggle('globalPrivacyControlEnabled', true)).ok, true);
  assert.equal((await toggle('privacySandboxBlocked', true)).ok, true);
  await page.reload();
  const protectedRead = await page.evaluate(() => ({ boot: window.boot,
    geo: document.featurePolicy.allowsFeature('geolocation'),
    restricted: document.featurePolicy.features().filter(f => /browsing-topics|private-state-token/.test(f))
      .map(feature => ({ feature, allowed: document.featurePolicy.allowsFeature(feature) })),
    child: document.querySelector('iframe').contentDocument.featurePolicy.features()
      .filter(f => /browsing-topics|private-state-token/.test(f))
      .map(feature => ({ feature, allowed: document.querySelector('iframe').contentDocument.featurePolicy.allowsFeature(feature) })),
    rawTopics: typeof document.querySelector('iframe').contentWindow.Document.prototype.browsingTopics,
  }));
  assert.equal(protectedRead.boot.gpc, true);
  for (const field of ['topics','join','auction','token']) assert.equal(protectedRead.boot[field], 'undefined', field);
  assert.equal(protectedRead.boot.attribution, false);
  assert.equal(protectedRead.boot.storage, baseline.storage, 'Storage access left intact');
  assert.equal(protectedRead.geo, false, 'Existing response policy remains enforced');
  assert.ok(protectedRead.restricted.length > 0, 'Native browser supports policy-controlled APIs');
  assert.ok([...protectedRead.restricted,...protectedRead.child].every(p => p.allowed === false), 'Policy denies even in unpatched child realm');
  assert.equal((await page.evaluate(() => fetch('/echo').then(r => r.json()))).gpc, '1');
  assert.equal(requests.filter(r => r.path === '/').at(-1).gpc, '1');
  assert.equal(requests.filter(r => r.path === '/child').at(-1).gpc, '1');
  const rawCall = await page.evaluate(async () => {
    const method = document.querySelector('iframe').contentWindow.Document.prototype.browsingTopics;
    if (typeof method !== 'function') return 'not-exposed';
    try { await Reflect.apply(method, document, []); return 'unexpected-success'; }
    catch (error) { return error.name; }
  });
  assert.notEqual(rawCall, 'unexpected-success');
  assert.equal(await page.locator('main').isVisible(), true);
  await send({ type: 'SET_SITE_ENABLED', site: '127.0.0.1', enabled: false });
  await page.reload();
  assert.deepEqual(await page.evaluate(() => window.boot), baseline);
  assert.equal((await page.evaluate(() => fetch('/echo').then(r => r.json()))).gpc, null);
  await send({ type: 'SET_SITE_ENABLED', site: '127.0.0.1', enabled: true });
  await page.reload();
  assert.equal((await page.evaluate(() => window.boot)).gpc, true);
  await send({ type: 'SET_ENABLED', enabled: false });
  await page.reload();
  assert.deepEqual(await page.evaluate(() => window.boot), baseline);
  assert.equal((await page.evaluate(() => fetch('/echo').then(r => r.json()))).gpc, null);
  await send({ type: 'SET_ENABLED', enabled: true });
  await toggle('globalPrivacyControlEnabled', false);
  await toggle('privacySandboxBlocked', false);
  await page.reload();
  assert.deepEqual(await page.evaluate(() => window.boot), baseline);
  await writeFile(new URL('../test-results/privacy-api-native-proof.json', import.meta.url),
    JSON.stringify({ baseline, protectedRead, rawCall, requests }, null, 2));
});
