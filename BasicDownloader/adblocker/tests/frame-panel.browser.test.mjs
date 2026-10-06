import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// This suite runs the production top-document UI with a mocked extension
// transport. Native cross-origin routing is covered by the full-extension suite.
let chromium;
try {
  const moduleName = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright';
  ({ chromium } = await import(moduleName));
} catch { /* Browser tooling is optional for normal unit-test runs. */ }

const contentScript = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const sessionA = { token: 'picker-session-a', sourceFrameId: 9, sourceDocumentId: 'frame-document-a' };
const sessionB = { token: 'picker-session-b', sourceFrameId: 12, sourceDocumentId: 'frame-document-b' };
const view = (patch = {}) => ({
  revision: 1, site: 'frame-panel.test', frameHost: 'ads.test', label: '처음 선택한 광고', notice: '선택 영역을 확인하세요.',
  error: false, previewing: false, saving: false,
  parentDisabled: false, childDisabled: false, previewDisabled: false, saveDisabled: false, ...patch,
});

async function setup(t, deferred = []) {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.route('http://frame-panel.test/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body><main>Ordinary page content</main></body></html>',
  }));
  await page.addInitScript(deferredCommands => {
    const originalAttach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { return originalAttach.call(this, { ...options, mode: 'open' }); };
    let messageListener;
    const intervals = new Map();
    let intervalId = 0;
    window.setInterval = callback => { const id = ++intervalId; intervals.set(id, callback); return id; };
    window.clearInterval = id => intervals.delete(id);
    window.testTickStatus = () => { for (const callback of [...intervals.values()]) callback(); };
    window.testCommands = [];
    const pending = new Map();
    window.testResolveCommand = (command, response) => {
      const resolve = pending.get(command)?.shift();
      if (!resolve) throw new Error(`No pending ${command} command`);
      resolve(response);
    };
    window.testFrameEvent = message => new Promise(resolve => messageListener(message, { id: 'frame-panel-fixture' }, resolve));
    window.chrome = {
      runtime: {
        id: 'frame-panel-fixture',
        onMessage: { addListener(listener) { messageListener = listener; } },
        async sendMessage(message) {
          if (message.type === 'GET_CONTEXT') return { ok: true, enabled: true, site: 'frame-panel.test', frameHost: 'frame-panel.test', rules: [] };
          if (message.type !== 'PICKER_COMMAND') return { ok: false, error: 'Unexpected test message' };
          window.testCommands.push(structuredClone(message));
          if (deferredCommands.includes(message.command)) {
            return new Promise(resolve => {
              if (!pending.has(message.command)) pending.set(message.command, []);
              pending.get(message.command).push(resolve);
            });
          }
          return { ok: true, ...(message.command === 'cancel' ? { closed: true } : {}) };
        },
      },
      storage: { onChanged: { addListener() {} } },
    };
  }, deferred);
  await page.goto('http://frame-panel.test/');
  await page.addScriptTag({ content: contentScript });
  return page;
}

async function frameEvent(page, event, payload, session = sessionA) {
  const result = await page.evaluate(message => window.testFrameEvent(message), { type: 'FRAME_PICKER_EVENT', event, payload, ...session });
  assert.equal(result.ok, true);
}

async function resolveCommand(page, command, response) {
  await page.evaluate(async ({ command, response }) => {
    window.testResolveCommand(command, response);
    await new Promise(resolve => requestAnimationFrame(resolve));
  }, { command, response });
}

test('a delayed status reply cannot unlock save controls or queue Escape during an in-flight save', { skip: !chromium }, async t => {
  const page = await setup(t, ['status', 'save']);
  await frameEvent(page, 'show', view());
  const save = page.getByRole('button', { name: '저장', exact: true });
  const cancel = page.getByRole('button', { name: '취소 (Esc)', exact: true });
  await page.evaluate(() => { window.testTickStatus(); window.testTickStatus(); });
  assert.equal(await page.evaluate(() => window.testCommands.filter(call => call.command === 'status').length), 1);
  await save.click();
  await frameEvent(page, 'update', view({ revision: 2, saving: true, label: '저장 중인 광고' }));
  await resolveCommand(page, 'status', { ok: true, view: view({ revision: 1, saving: false }) });
  assert.equal(await save.isDisabled(), true);
  assert.equal(await cancel.isDisabled(), true);
  assert.equal(await page.getByText('저장 중인 광고', { exact: true }).count(), 1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.testTickStatus());
  assert.deepEqual(await page.evaluate(() => window.testCommands.map(call => call.command)), ['status', 'save']);
  await resolveCommand(page, 'save', { ok: true, view: view({ revision: 3, saving: false, error: true, notice: '저장하지 못했습니다. 다시 시도해 주세요.' }) });
  assert.equal(await page.getByRole('dialog').count(), 1, 'Escape during Save must not turn into a delayed cancellation after a failed save');
  assert.deepEqual(await page.evaluate(() => window.testCommands.map(call => call.command)), ['status', 'save']);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
});

test('Escape during a delayed preview is queued once and a quiet status reply cannot consume it', { skip: !chromium }, async t => {
  const page = await setup(t, ['status', 'preview', 'cancel']);
  await frameEvent(page, 'show', view());
  await page.evaluate(() => window.testTickStatus());
  await page.getByRole('button', { name: '숨김 미리보기', exact: true }).click();
  // A real frame publishes the changed preview before its command reply is
  // delivered; this is the interval in which the user immediately presses Esc.
  await frameEvent(page, 'update', view({ revision: 2, previewing: true, label: '이미 미리보기가 적용된 광고' }));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => window.testCommands.map(call => call.command)), ['status', 'preview']);
  await resolveCommand(page, 'status', { ok: true, view: view({ revision: 1, previewing: false }) });
  assert.deepEqual(await page.evaluate(() => window.testCommands.map(call => call.command)), ['status', 'preview']);
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).isDisabled(), true);
  await resolveCommand(page, 'preview', { ok: true, view: view({ revision: 2, previewing: true }) });
  await page.waitForFunction(() => window.testCommands.some(call => call.command === 'cancel'));
  assert.deepEqual(await page.evaluate(() => window.testCommands.map(call => call.command)), ['status', 'preview', 'cancel']);
  assert.equal(await page.getByRole('dialog').count(), 1, 'Do not claim cancellation before the source acknowledges it');
  await resolveCommand(page, 'cancel', { ok: true, closed: true });
  assert.equal(await page.getByRole('dialog').count(), 0);
});

test('Escape also cancels delayed parent and child selection after their replies', { skip: !chromium }, async t => {
  const page = await setup(t, ['parent', 'child']);
  for (const [command, label] of [['parent', '상위 영역'], ['child', '하위 영역']]) {
    await frameEvent(page, 'show', view());
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 1);
    await resolveCommand(page, command, { ok: true, view: view({ revision: 2 }) });
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  }
  assert.deepEqual(await page.evaluate(() => window.testCommands.map(call => call.command)), ['parent', 'cancel', 'child', 'cancel']);
});

test('a queued Escape from an old preview cannot cancel a replacement picker session', { skip: !chromium }, async t => {
  const page = await setup(t, ['preview']);
  await frameEvent(page, 'show', view());
  await page.getByRole('button', { name: '숨김 미리보기', exact: true }).click();
  await page.keyboard.press('Escape');
  await frameEvent(page, 'show', view({ label: '다른 문서의 새 선택' }), sessionB);
  await resolveCommand(page, 'preview', { ok: true, view: view({ revision: 2, previewing: true }) });
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await page.getByText('다른 문서의 새 선택', { exact: true }).count(), 1);
  assert.deepEqual(await page.evaluate(() => window.testCommands.map(call => ({ command: call.command, token: call.token }))), [
    { command: 'preview', token: sessionA.token },
    { command: 'cancel', token: sessionA.token },
  ]);
});

test('newer frame view survives both a stale bridge update and an older command response', { skip: !chromium }, async t => {
  const page = await setup(t, ['preview']);
  await frameEvent(page, 'show', view());
  await page.getByRole('button', { name: '숨김 미리보기', exact: true }).click();
  await frameEvent(page, 'update', view({ revision: 5, label: '최신 선택 영역', previewing: true }));
  await frameEvent(page, 'update', view({ revision: 4, label: '오래된 선택 영역', previewing: false, saveDisabled: true }));
  assert.equal(await page.getByText('최신 선택 영역', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '미리보기 되돌리기', exact: true }).getAttribute('aria-pressed'), 'true');
  await resolveCommand(page, 'preview', { ok: true, view: view({ revision: 3, label: '오래된 명령 응답', previewing: false, saveDisabled: true }) });
  assert.equal(await page.getByText('최신 선택 영역', { exact: true }).count(), 1);
  assert.equal(await page.getByText('오래된 명령 응답', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '미리보기 되돌리기', exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).isEnabled(), true);
});

test('old frame events cannot replace a new session and its undo targets the same document and token', { skip: !chromium }, async t => {
  const page = await setup(t);
  await frameEvent(page, 'show', view());
  await frameEvent(page, 'show', view({ label: '새 프레임 선택 영역' }), sessionB);
  await frameEvent(page, 'close', {});
  await frameEvent(page, 'update', view({ revision: 999, label: '이전 프레임 선택 영역' }));
  await frameEvent(page, 'toast', { message: '이전 세션 알림', undoToken: 'old-undo' });
  await frameEvent(page, 'close', {}, { ...sessionB, sourceDocumentId: 'replaced-document' });
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await page.getByText('새 프레임 선택 영역', { exact: true }).count(), 1);
  assert.equal(await page.getByText('이전 세션 알림', { exact: true }).count(), 0);
  await frameEvent(page, 'toast', { message: '새 세션 저장 완료', undoToken: 'new-undo' }, sessionB);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  const commands = await page.evaluate(() => window.testCommands);
  assert.deepEqual(commands, [
    { type: 'PICKER_COMMAND', token: sessionA.token, command: 'cancel', frameId: sessionA.sourceFrameId, documentId: sessionA.sourceDocumentId },
    { type: 'PICKER_COMMAND', token: sessionB.token, command: 'undo', frameId: sessionB.sourceFrameId, documentId: sessionB.sourceDocumentId },
  ]);
  assert.equal(await page.getByText('새 세션 저장 완료', { exact: true }).count(), 0);
});
