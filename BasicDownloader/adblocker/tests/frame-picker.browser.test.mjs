import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'));
} catch { /* Native integration is optional when browser tooling is absent. */ }
const executablePath = process.env.EXTENSION_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const frameBody = (id, label) => `<!doctype html><html><head><style>
  body { margin:0; padding:8px; font:14px/1.5 sans-serif; background:#f2f5fa; }
  .creative { width:140px; height:160px; box-sizing:border-box; padding:12px; background:#fee2aa; }
  p { margin:10px 0; }
  iframe { width:140px; height:190px; border:1px solid #9aa7ba; display:block; }
</style></head><body>
  <div id="${id}" class="creative" style="display:grid!important">${label}</div>
  <p id="frame-normal">Normal frame content remains available.</p>
</body></html>`;

async function eventually(check, description, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(`Timed out: ${description}`);
}

// CDP exposes closed shadow roots for verification without changing production
// attachShadow behavior. Do not traverse iframe contentDocument: only this
// document's controls count as top-page controls.
function descendants(node) {
  return [node, ...(node.children || []).flatMap(descendants), ...(node.shadowRoots || []).flatMap(descendants)];
}
const attributes = node => Object.fromEntries(Array.from({ length: (node.attributes || []).length / 2 }, (_, index) => [node.attributes[index * 2], node.attributes[index * 2 + 1]]));
const textOf = node => descendants(node).filter(child => child.nodeType === 3).map(child => child.nodeValue).join('').trim();

test('native picker controls escape narrow third-party, nested and srcdoc frames while preserving source scope', {
  skip: !chromium || !existsSync(executablePath), timeout: 120000,
}, async t => {
  const extension = fileURLToPath(new URL('..', import.meta.url));
  const profile = await mkdtemp(join(tmpdir(), 'basic-banner-frame-picker-'));
  const browser = await chromium.launchPersistentContext(profile, {
    executablePath, headless: true, viewport: { width: 1200, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  t.after(async () => {
    await browser.close();
    if (resolve(dirname(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('basic-banner-frame-picker-')) throw new Error('Unexpected temporary profile path');
    await rm(profile, { recursive: true, force: true });
  });
  const errors = [];
  browser.on('weberror', event => errors.push(event.error().message));
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker', { timeout: 15000 });
  await worker.evaluate(() => {
    globalThis.testPickerDocuments = {};
    chrome.runtime.onMessage.addListener((_message, sender) => {
      if (sender.tab && sender.url) globalThis.testPickerDocuments[`${sender.tab.id}:${sender.url}`] = {
        frameId: sender.frameId, documentId: sender.documentId, origin: sender.origin,
      };
    });
  });
  const page = await browser.newPage();
  const srcdoc = frameBody('srcdoc-ad', 'Ad in an inherited-origin srcdoc frame');
  const creative = frameBody('frame-ad', 'Narrow third-party banner').replace('</body>',
    `<iframe id="nested-frame" title="Nested creative" src="http://nested.test/content"></iframe>
     <iframe id="srcdoc-frame" title="Srcdoc creative" srcdoc="${srcdoc.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body>`);
  const top = `<!doctype html><html><head><style>
    body { margin:24px; font:16px/1.5 sans-serif; background:#fff; color:#182338; }
    main { width:750px; display:inline-block; vertical-align:top; padding-right:36px; }
    iframe { width:160px; height:600px; border:1px solid #8f9bb0; }
  </style></head><body><main><h1>Normal publisher article</h1><p>The control panel belongs to this full page, even when the selected ad is in the narrow frame.</p></main>
    <iframe id="narrow-frame" title="Third-party banner" src="http://creative.test/banner"></iframe>
  </body></html>`;
  await page.route(/^http:\/\/(publisher|creative|nested|replacement)\.test\//, route => {
    const host = new URL(route.request().url()).hostname;
    const body = host === 'publisher.test' ? top : host === 'creative.test' ? creative
      : host === 'nested.test' ? frameBody('nested-ad', 'Nested third-party banner')
        : frameBody('frame-ad', 'Replacement document must stay untouched');
    return route.fulfill({ contentType: 'text/html', body });
  });
  await page.goto('http://publisher.test/article');
  await page.frameLocator('#narrow-frame').locator('#frame-ad').waitFor();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'http://publisher.test/article').id);
  const cdp = await browser.newCDPSession(page);
  const nodes = async () => descendants((await cdp.send('DOM.getDocument', { depth: -1, pierce: true })).root);
  const dialogs = async () => (await nodes()).filter(node => attributes(node).role === 'dialog');
  const storedRules = () => worker.evaluate(async () => (await chrome.storage.local.get('adblockState')).adblockState?.customRules || []);

  async function sourceDocument(frame) {
    let source;
    await eventually(async () => {
      source = await worker.evaluate(key => globalThis.testPickerDocuments[key], `${tabId}:${frame.url()}`);
      return Number.isInteger(source?.frameId) && source.frameId > 0;
    }, `content-script identity for ${frame.url()}`);
    return source;
  }
  async function pick(frame, selector, action = 'hide') {
    const source = await sourceDocument(frame);
    await frame.locator(selector).click({ button: 'right', position: { x: 12, y: 12 } });
    const response = await worker.evaluate(async ({ tabId, frameId, documentId, action }) =>
      chrome.tabs.sendMessage(tabId, { type: 'PICK_ELEMENT', action }, { frameId, documentId }), { tabId, ...source, action });
    assert.equal(response?.ok, true, response?.error);
    await eventually(async () => (await dialogs()).length === 1, 'one picker dialog in the top document');
    return source;
  }
  async function clickTopButton(label) {
    let button;
    await eventually(async () => {
      button = (await nodes()).find(node => node.nodeName === 'BUTTON' && textOf(node) === label);
      return Boolean(button);
    }, `top-page button ${label}`);
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: button.nodeId });
    const xs = model.content.filter((_, index) => index % 2 === 0);
    const ys = model.content.filter((_, index) => index % 2 === 1);
    await page.mouse.click((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
  }

  const source = page.frames().find(frame => frame.url() === 'http://creative.test/banner');
  assert.ok(source);
  await pick(source, '#frame-ad');
  const panel = (await dialogs())[0];
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId: panel.nodeId });
  assert.ok(model.width >= 300 && model.width <= 380, `Panel width ${model.width} must exceed the 160px frame`);
  const xs = model.border.filter((_, index) => index % 2 === 0);
  const ys = model.border.filter((_, index) => index % 2 === 1);
  assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 1200 && Math.min(...ys) >= 0 && Math.max(...ys) <= 900, 'All controls fit in the top viewport');
  // The cross-site source must contain its outline, but no clipped control panel.
  const sourceCdp = await browser.newCDPSession(source);
  const sourceNodes = descendants((await sourceCdp.send('DOM.getDocument', { depth: -1, pierce: true })).root);
  assert.equal(sourceNodes.filter(node => attributes(node).role === 'dialog').length, 0);
  await sourceCdp.detach();
  const results = join(extension, 'test-results');
  await mkdir(results, { recursive: true });
  await page.screenshot({ path: join(results, 'frame-picker-fixed.png') });
  await page.keyboard.press('Enter');
  await eventually(() => source.locator('#frame-ad').isHidden(), 'top keyboard preview hides source ad');
  await page.keyboard.press('Escape');
  await eventually(() => source.locator('#frame-ad').isVisible(), 'Escape restores source preview');
  assert.equal((await storedRules()).length, 0);
  assert.equal((await dialogs()).length, 0);

  // Parent/child navigation must act on the source frame, even though its
  // controls and current selection label live in the top document.
  await source.locator('#frame-ad').evaluate(element => { element.innerHTML = '<span id="frame-ad-label">Inner ad label</span>'; });
  await pick(source, '#frame-ad-label');
  const selectedLabel = async () => textOf((await nodes()).find(node => attributes(node).class === 'selection'));
  await clickTopButton('상위 영역');
  await eventually(async () => (await selectedLabel()).startsWith('div#frame-ad '), 'top parent selects source container');
  await clickTopButton('하위 영역');
  await eventually(async () => (await selectedLabel()).startsWith('span#frame-ad-label '), 'top child returns to source label');
  await clickTopButton('상위 영역');
  await eventually(async () => (await selectedLabel()).startsWith('div#frame-ad '), 'source parent selected again');
  await clickTopButton('숨김 미리보기');
  await eventually(() => source.locator('#frame-ad').isHidden(), 'top parent preview hides whole source container');
  await page.keyboard.press('Escape');
  await eventually(() => source.locator('#frame-ad').isVisible(), 'parent preview cancellation restores container');
  await source.locator('#frame-ad').evaluate(element => { element.textContent = 'Narrow third-party banner'; });

  async function saveAndUndo(frame, selector, expectedHost) {
    await pick(frame, selector);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await eventually(() => frame.locator(selector).isHidden(), `top Save hides ${selector}`);
    const rules = await storedRules();
    assert.equal(rules.length, 1);
    assert.equal(rules[0].site, 'publisher.test');
    assert.equal(rules[0].frameHost, expectedHost);
    assert.equal(rules[0].selector, selector);
    assert.equal(await frame.locator('#frame-normal').isVisible(), true);
    assert.equal(await page.locator('main').isVisible(), true);
    await clickTopButton('실행 취소');
    await eventually(() => frame.locator(selector).isVisible(), `top Undo restores ${selector}`);
    assert.equal(await frame.locator(selector).evaluate(element => element.style.getPropertyValue('display')), 'grid');
    assert.equal(await frame.locator(selector).evaluate(element => element.style.getPropertyPriority('display')), 'important');
    assert.equal((await storedRules()).length, 0);
  }
  await saveAndUndo(source, '#frame-ad', 'creative.test');

  // Move controls also belong to the outer page; the source box keeps its
  // layout/display and the source document owns Save and its scoped Undo token.
  await pick(source, '#frame-ad', 'move');
  assert.ok(textOf((await dialogs())[0]).includes('이 요소 이동시키기'));
  await clickTopButton('이동 미리보기');
  await eventually(() => source.locator('#frame-ad').evaluate(element => element.getBoundingClientRect().right < 0), 'top Move preview relocates source ad');
  assert.equal(await source.locator('#frame-ad').evaluate(element => getComputedStyle(element).display), 'grid');
  await page.keyboard.press('Escape');
  await eventually(() => source.locator('#frame-ad').evaluate(element => element.getBoundingClientRect().right > 0), 'Escape restores moved source ad');
  assert.equal((await storedRules()).length, 0);
  await pick(source, '#frame-ad', 'move');
  await clickTopButton('저장');
  await eventually(async () => (await storedRules())[0]?.action === 'move', 'Save persists source move action');
  assert.equal(await source.locator('#frame-ad').evaluate(element => element.offsetWidth), 140);
  await clickTopButton('실행 취소');
  await eventually(() => source.locator('#frame-ad').evaluate(element => element.getBoundingClientRect().right > 0), 'Undo restores source move');
  assert.equal((await storedRules()).length, 0);

  // Saving A leaves an Undo toast. Opening B in the same source frame must not
  // replace the source token/rule that A's existing Undo action refers to.
  await pick(source, '#frame-ad');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await eventually(() => source.locator('#frame-ad').isHidden(), 'A is saved before selecting B');
  await pick(source, '#frame-normal');
  await clickTopButton('실행 취소');
  await eventually(() => source.locator('#frame-ad').isVisible(), 'A undo remains valid while B picker is open');
  assert.equal((await storedRules()).length, 0);
  assert.equal((await dialogs()).length, 1, 'Undo A must not dismiss B controls');
  assert.ok((await selectedLabel()).startsWith('p#frame-normal '), 'B remains the current source selection');
  assert.equal(await source.locator('#frame-normal').isVisible(), true);
  await page.keyboard.press('Escape');
  await eventually(async () => (await dialogs()).length === 0, 'B picker can still cancel after A undo');

  const nested = page.frames().find(frame => frame.url() === 'http://nested.test/content');
  const inline = page.frames().find(frame => frame.url() === 'about:srcdoc');
  assert.ok(nested && inline);
  await saveAndUndo(nested, '#nested-ad', 'nested.test');
  await saveAndUndo(inline, '#srcdoc-ad', 'creative.test');

  await pick(source, '#frame-ad');
  await page.locator('#narrow-frame').evaluate(frame => { frame.src = 'http://replacement.test/banner'; });
  await eventually(() => Promise.resolve(page.frames().some(frame => frame.url() === 'http://replacement.test/banner')), 'source iframe navigates');
  await eventually(async () => (await dialogs()).length === 0, 'source navigation removes stale top controls');
  const replacement = page.frames().find(frame => frame.url() === 'http://replacement.test/banner');
  assert.equal(await replacement.locator('#frame-ad').isVisible(), true);
  assert.equal((await storedRules()).length, 0, 'Navigation must not persist a rule for another document');
  await pick(replacement, '#frame-ad');
  await page.locator('#narrow-frame').evaluate(frame => frame.remove());
  await eventually(async () => (await dialogs()).length === 0, 'source frame removal removes stale controls');
  assert.equal((await storedRules()).length, 0);
  assert.deepEqual(errors, []);
});
