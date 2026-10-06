import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

let chromium;
try {
  const moduleName = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright';
  ({ chromium } = await import(moduleName));
} catch { /* Optional browser tests, with the same runtime convention as picker tests. */ }

const initialState = {
  version: 1, enabled: false, publicFiltersEnabled: true, disabledSites: ['paused.test'],
  customRules: [
    { id: 'custom-1', site: 'news.test', frameHost: 'ads.test', selector: '#banner-one', label: '<img src=x onerror="window.injected=true">', enabled: true, createdAt: 1 },
    { id: 'custom-2', site: 'forum.test', frameHost: 'forum.test', selector: '.sponsored-row', label: '댓글 광고', enabled: false, createdAt: 2 },
  ],
  networkRules: [{ id: 'network-1', domain: 'banner.test', site: null, enabled: true, createdAt: 3 }],
};
const importBackup = {
  format: 'basic-banner-blocker-rules', version: 1,
  customRules: [{ id: 'imported-1', site: 'blog.test', frameHost: 'blog.test', selector: '#new-banner', label: '<script>window.injected=true</script>', enabled: false, createdAt: 4 }],
  networkRules: [], disabledSites: ['imported.test'],
};
const filePayload = backup => ({ name: 'rules.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });

async function setup(t) {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const sources = Object.fromEntries(await Promise.all(['options.html', 'options.css', 'options.js', 'backup.js', 'state.js', 'privacy-rules.js', 'protection.js'].map(async name =>
    [name, await readFile(new URL(`../${name}`, import.meta.url), 'utf8')])));
  await page.route('http://options.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'options.html';
    const body = sources[name];
    return body === undefined ? route.abort() : route.fulfill({
      contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript', body,
    });
  });
  await page.addInitScript(state => {
    window.testState = structuredClone(state);
    window.testMessages = [];
    window.testFilterMetadata = {
      schemaVersion: 1, filterVersion: 'snapshot-2026-10-05', generatedAt: '2026-10-05T00:00:00Z',
      network: { ruleCount: 1234 }, cosmetic: { selectorCount: 567 },
      sources: [{ name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt', sourceVersion: '20261005', license: 'GPL-3.0' },
        { name: '한국어 필터', url: 'https://example.test/korean.txt', sourceVersion: '20261005', license: 'GPL-3.0' }],
    };
    let storageListener;
    window.testNotifyState = patch => {
      Object.assign(window.testState, patch);
      storageListener?.({ adblockState: {} }, 'local');
    };
    window.chrome = {
      storage: { onChanged: { addListener(listener) { storageListener = listener; } } },
      runtime: {
        async sendMessage(message) {
          window.testMessages.push(structuredClone(message));
          if (window.testHoldMutation && !['GET_STATE', 'PREVIEW_IMPORT_BACKUP', 'GET_FILTER_STATUS'].includes(message.type)) {
            await new Promise(resolve => { window.testReleaseMutation = resolve; });
          }
          try {
            if (message.type === 'GET_FILTER_STATUS') return { ok: true, filterStatus: {
              enabled: Object.hasOwn(window, 'testFilterActual') ? window.testFilterActual : window.testState.publicFiltersEnabled,
              requestedEnabled: window.testState.publicFiltersEnabled, metadata: window.testFilterMetadata, error: window.testFilterError || null,
            } };
            const helpers = await import('/backup.js');
            if (message.type === 'PREVIEW_IMPORT_BACKUP') return { ok: true, preview: helpers.previewImport(window.testState, message.backup) };
            if (message.type === 'IMPORT_BACKUP') window.testState = helpers.mergeBackup(window.testState, message.backup);
            if (message.type === 'SET_RULE_ENABLED' || message.type === 'SET_NETWORK_RULE_ENABLED') {
              const field = message.type === 'SET_RULE_ENABLED' ? 'customRules' : 'networkRules';
              window.testState[field].find(rule => rule.id === message.id).enabled = message.enabled;
            }
            if (message.type === 'DELETE_RULE' || message.type === 'DELETE_NETWORK_RULE') {
              const field = message.type === 'DELETE_RULE' ? 'customRules' : 'networkRules';
              window.testState[field] = window.testState[field].filter(rule => rule.id !== message.id);
            }
            if (message.type === 'SET_SITE_ENABLED') window.testState.disabledSites = window.testState.disabledSites.filter(site => site !== message.site);
            if (message.type === 'SET_PRIVACY_PROTECTION') window.testState[message.setting] = message.enabled;
            if (message.type === 'SET_PUBLIC_FILTERS_ENABLED') {
              if (window.testRejectPublicToggle) throw new Error('공개 필터 적용 실패: 정적 규칙 한도');
              window.testState.publicFiltersEnabled = message.enabled;
            }
            if (message.type !== 'GET_STATE') storageListener?.({ adblockState: {} }, 'local');
            return { ok: true, state: structuredClone(window.testState) };
          } catch (error) {
            return { ok: false, error: error.message };
          }
        },
      },
    };
  }, initialState);
  await page.goto('http://options.test/options.html');
  await page.waitForFunction(() => document.querySelector('#export-backup').disabled === false);
  return page;
}

test('options safely renders imported text, searches saved rules, and pauses rules without toggling global filtering', { skip: !chromium }, async t => {
  const page = await setup(t);
  assert.equal(await page.locator('#cosmetic-list img').count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator('#global-status').textContent(), '전체 차단 꺼짐');
  await page.locator('#rule-search').fill('sponsored');
  assert.equal(await page.locator('#cosmetic-list > li').count(), 1);
  assert.equal(await page.locator('#network-list > li').count(), 0);
  await page.getByRole('button', { name: '댓글 광고 다시 적용', exact: true }).click();
  await page.waitForFunction(() => window.testState.customRules.find(rule => rule.id === 'custom-2').enabled === true);
  await page.getByRole('button', { name: '댓글 광고 일시 중지', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testState.enabled), false);
  await page.locator('#rule-search').fill('banner.test');
  await page.getByRole('button', { name: 'banner.test 일시 중지', exact: true }).click();
  await page.getByRole('button', { name: 'banner.test 다시 적용', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testState.networkRules[0].enabled), false);
});

test('import is previewed before mutation, invalid replacement clears it, and an explicit merge preserves existing state', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.locator('#import-file').setInputFiles(filePayload(importBackup));
  await page.locator('#import-preview').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#import-custom-count').textContent(), '1개');
  assert.equal(await page.locator('#import-sites-count').textContent(), '1개');
  assert.equal(await page.evaluate(() => window.testMessages.filter(message => message.type === 'IMPORT_BACKUP').length), 0);
  assert.equal(await page.evaluate(() => window.testState.customRules.length), 2);

  await page.locator('#import-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await page.waitForFunction(() => document.querySelector('#feedback').dataset.error === 'true');
  assert.equal(await page.locator('#import-preview').isVisible(), false);
  assert.equal(await page.locator('#apply-import').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.testState.customRules.length), 2);

  await page.locator('#import-file').setInputFiles(filePayload(importBackup));
  await page.getByRole('button', { name: '확인한 내용 가져오기', exact: true }).click();
  await page.waitForFunction(() => window.testState.customRules.length === 3 && !document.querySelector('#export-backup').disabled);
  assert.equal(await page.evaluate(() => window.testState.enabled), false);
  assert.deepEqual(await page.evaluate(() => window.testState.disabledSites), ['paused.test', 'imported.test']);
  assert.equal(await page.evaluate(() => window.testState.customRules.find(rule => rule.id === 'imported-1').enabled), false);
  assert.equal(await page.locator('#cosmetic-list script').count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator('#import-preview').isVisible(), false);
});

test('pending mutations lock import and export, while later storage changes refresh the displayed state and import preview', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.locator('#import-file').setInputFiles(filePayload(importBackup));
  await page.locator('#import-preview').waitFor({ state: 'visible' });
  await page.evaluate(() => { window.testHoldMutation = true; });
  await page.getByRole('button', { name: '댓글 광고 다시 적용', exact: true }).click();
  await page.waitForFunction(() => typeof window.testReleaseMutation === 'function');
  assert.equal(await page.locator('#export-backup').isDisabled(), true);
  assert.equal(await page.locator('#import-file').isDisabled(), true);
  assert.equal(await page.locator('#apply-import').isDisabled(), true);
  assert.equal(await page.locator('#network-domain').isDisabled(), true);
  assert.equal(await page.locator('#refresh-state').isDisabled(), true);
  await page.evaluate(rule => {
    window.testNotifyState({ customRules: [...window.testState.customRules, rule] });
    window.testHoldMutation = false;
    window.testReleaseMutation();
  }, importBackup.customRules[0]);
  await page.waitForFunction(() => !document.querySelector('#export-backup').disabled && document.querySelector('#import-custom-count').textContent === '0개');
  assert.equal(await page.locator('#cosmetic-list > li').count(), 3);
  assert.match(await page.locator('#import-duplicates').textContent(), /숨김·이동 1개/);
  assert.equal(await page.evaluate(() => window.testMessages.filter(message => message.type === 'IMPORT_BACKUP').length), 0);
});

test('public pack displays its snapshot metadata and toggles independently of user rules and global pause', { skip: !chromium }, async t => {
  const page = await setup(t);
  assert.equal(await page.locator('#public-filter-toggle').isChecked(), true);
  assert.equal(await page.locator('#public-filter-version').textContent(), 'snapshot-2026-10-05');
  assert.equal(await page.locator('#public-network-count').textContent(), '1,234개');
  assert.equal(await page.locator('#public-cosmetic-count').textContent(), '567개');
  assert.match(await page.locator('#public-filter-status').textContent(), /전체 차단은 꺼져/);
  assert.equal(await page.locator('#public-filter-sources a').count(), 2);
  await page.locator('#public-filter-toggle').click();
  await page.waitForFunction(() => window.testState.publicFiltersEnabled === false && !document.querySelector('#public-filter-toggle').disabled);
  assert.equal(await page.locator('#public-filter-status').textContent(), '공개 필터 꺼짐');
  assert.equal(await page.evaluate(() => window.testState.enabled), false);
  assert.equal(await page.evaluate(() => window.testState.customRules.length), 2);
  assert.equal(await page.evaluate(() => window.testState.networkRules.length), 1);
  await page.locator('#public-filter-toggle').click();
  await page.waitForFunction(() => window.testState.publicFiltersEnabled === true && !document.querySelector('#public-filter-toggle').disabled);
  assert.equal(await page.evaluate(() => window.testState.enabled), false);
});

test('public pack failure restores the saved switch and missing metadata does not disable rule management', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.evaluate(() => { window.testRejectPublicToggle = true; });
  await page.locator('#public-filter-toggle').click();
  await page.waitForFunction(() => document.querySelector('#feedback').dataset.error === 'true' && !document.querySelector('#public-filter-toggle').disabled);
  assert.equal(await page.locator('#public-filter-toggle').isChecked(), true);
  assert.equal(await page.evaluate(() => window.testState.publicFiltersEnabled), true);
  await page.evaluate(() => {
    window.testFilterActual = null;
    window.testFilterMetadata = null;
    window.testFilterError = '공개 필터 배포 정보를 읽지 못했습니다.';
  });
  await page.locator('#refresh-state').click();
  await page.waitForFunction(() => !document.querySelector('#refresh-state').disabled);
  assert.equal(await page.locator('#public-filter-status').textContent(), '공개 필터 적용 확인 필요');
  assert.equal(await page.locator('#public-filter-error').isVisible(), true);
  assert.equal(await page.locator('#public-filter-version').textContent(), '정보 없음');
  assert.equal(await page.locator('#export-backup').isEnabled(), true);
  assert.equal(await page.locator('#network-domain').isEnabled(), true);
});

test('move rules remain distinct after v2 import and support search, pause, resume, and deletion', { skip: !chromium }, async t => {
  const page = await setup(t);
  const backup = structuredClone(importBackup);
  backup.version = 2;
  Object.assign(backup.customRules[0], { id: 'moved-banner', label: '이동 배너', action: 'move', enabled: true });
  await page.locator('#import-file').setInputFiles(filePayload(backup));
  await page.getByRole('button', { name: '확인한 내용 가져오기', exact: true }).click();
  await page.waitForFunction(() => window.testState.customRules.some(rule => rule.id === 'moved-banner') && !document.querySelector('#export-backup').disabled);
  assert.equal(await page.evaluate(() => window.testState.customRules.find(rule => rule.id === 'moved-banner').action), 'move');
  assert.match(await page.locator('#cosmetic-list').textContent(), /동작: 숨김/);
  await page.locator('#rule-search').fill('화면 밖 이동');
  assert.equal(await page.locator('#cosmetic-list > li').count(), 1);
  assert.match(await page.locator('#cosmetic-list').textContent(), /이동 배너.*동작: 화면 밖 이동/);
  await page.getByRole('button', { name: '이동 배너 일시 중지', exact: true }).click();
  await page.getByRole('button', { name: '이동 배너 다시 적용', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testState.customRules.find(rule => rule.id === 'moved-banner').action), 'move');
  await page.getByRole('button', { name: '이동 배너 다시 적용', exact: true }).click();
  await page.getByRole('button', { name: '이동 배너 일시 중지', exact: true }).waitFor();
  await page.getByRole('button', { name: '이동 배너 삭제', exact: true }).click();
  await page.waitForFunction(() => !window.testState.customRules.some(rule => rule.id === 'moved-banner') && !document.querySelector('#export-backup').disabled);
  assert.equal(await page.locator('#cosmetic-list > li').count(), 0);
  assert.equal(await page.evaluate(() => window.testState.customRules.length), 2);
});

test('privacy settings UI independently enables and disables tracking protection', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.locator('#tracking-protection-toggle').click();
  await page.waitForFunction(() => window.testState.trackingProtectionEnabled === true);
  assert.equal(await page.locator('#error-monitoring-toggle').isChecked(), false);
  await page.waitForFunction(() => document.querySelector('#tracking-protection-toggle').checked && !document.querySelector('#error-monitoring-toggle').disabled);
  await page.locator('#error-monitoring-toggle').click();
  await page.waitForFunction(() => window.testState.errorMonitoringBlocked === true);
  await page.waitForFunction(() => document.querySelector('#error-monitoring-toggle').checked && !document.querySelector('#tracking-protection-toggle').disabled);
  await page.locator('#tracking-protection-toggle').click();
  await page.waitForFunction(() => window.testState.trackingProtectionEnabled === false);
  assert.equal(await page.locator('#error-monitoring-toggle').isChecked(), true);
  assert.equal(await page.evaluate(() => window.testState.enabled), false);
});

test('advanced UI stores independent video and fingerprint switches without enabling tracing', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.locator('#video-ad-toggle').click();
  await page.waitForFunction(() => document.querySelector('#video-ad-toggle').checked && !document.querySelector('#fingerprint-toggle').disabled);
  await page.locator('#fingerprint-toggle').click();
  await page.waitForFunction(() => document.querySelector('#fingerprint-toggle').checked && !document.querySelector('#video-ad-toggle').disabled);
  await page.locator('#video-ad-toggle').click();
  await page.waitForFunction(() => !document.querySelector('#video-ad-toggle').checked && !document.querySelector('#fingerprint-toggle').disabled);
  assert.equal(await page.locator('#fingerprint-toggle').isChecked(), true);
  assert.equal(await page.locator('#tracking-protection-toggle').isChecked(), false);
});

test('privacy API UI independently controls GPC and Sandbox without changing video or fingerprints', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.locator('#gpc-toggle').click();
  await page.waitForFunction(() => document.querySelector('#gpc-toggle').checked && !document.querySelector('#sandbox-toggle').disabled);
  await page.locator('#sandbox-toggle').click();
  await page.waitForFunction(() => document.querySelector('#sandbox-toggle').checked && !document.querySelector('#gpc-toggle').disabled);
  await page.locator('#gpc-toggle').click();
  await page.waitForFunction(() => !document.querySelector('#gpc-toggle').checked && !document.querySelector('#sandbox-toggle').disabled);
  assert.equal(await page.locator('#sandbox-toggle').isChecked(), true);
  assert.equal(await page.locator('#fingerprint-toggle').isChecked(), false);
  assert.equal(await page.locator('#video-ad-toggle').isChecked(), false);
});

test('YouTube switch is independent from IMA and existing stored user rules', { skip: !chromium }, async t => {
  const page = await setup(t);
  const rules = await page.evaluate(() => structuredClone(window.testState.customRules));
  await page.locator('#youtube-ad-toggle').click();
  await page.waitForFunction(() => document.querySelector('#youtube-ad-toggle').checked && !document.querySelector('#youtube-ad-toggle').disabled);
  assert.equal(await page.evaluate(() => window.testState.youtubeAdBlockingEnabled), true);
  assert.equal(await page.locator('#video-ad-toggle').isChecked(), false);
  assert.equal(await page.locator('#fingerprint-toggle').isChecked(), false);
  assert.deepEqual(await page.evaluate(() => window.testState.customRules), rules);
  await page.locator('#youtube-ad-toggle').click();
  await page.waitForFunction(() => window.testState.youtubeAdBlockingEnabled === false);
});
