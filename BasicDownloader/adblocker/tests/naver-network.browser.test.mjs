import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let chromium;
try {
  const moduleName = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright';
  ({ chromium } = await import(moduleName));
} catch { /* Browser tooling is optional for the regular unit test run. */ }
const executablePath = process.env.EXTENSION_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// These URLs were observed on www.naver.com on 2026-10-05. testMatchOutcome
// evaluates Chrome's real declarative rules without contacting external servers.
test('native DNR blocks Naver homepage display ads while preserving normal assets and players', {
  skip: !chromium || !existsSync(executablePath), timeout: 30000,
}, async t => {
  const extension = fileURLToPath(new URL('..', import.meta.url));
  const profile = await mkdtemp(join(tmpdir(), 'basic-banner-naver-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  t.after(async () => {
    await context.close();
    if (resolve(dirname(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('basic-banner-naver-')) throw new Error('Unexpected test profile path');
    await rm(profile, { recursive: true, force: true });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  // This is the focused regression test for our hand-reviewed Naver rules.
  // Public-list behavior has its own native integration test.
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'SET_PUBLIC_FILTERS_ENABLED', enabled: false }));
  await settings.close();
  await worker.evaluate(async () => {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['public_ads'] });
  });
  const ads = [
    ['https://nam.veta.naver.com/gfp/v1', 'xmlhttprequest'],
    ['https://siape.veta.naver.com/fxshow?su=SU10868', 'sub_frame'],
    ['https://ssl.pstatic.net/tveta/libs/glad/prod/3.10.7/gfp-display-sdk.js', 'script'],
    ['https://ssl.pstatic.net/tveta/libs/glad/prod/gfp-core.js', 'script'],
    ['https://ssl.pstatic.net/tveta/libs/ndpsdk/prod/ndp-loader.js', 'script'],
    ['https://ssl.pstatic.net/melona/libs/glad/bridge/gfp-bridge.js', 'script'],
    ['https://sstatic.naver.net/tveta/libs/glad/prod/gfp-core.js', 'script'],
    ['https://sstatic.naver.net/tveta/libs/ndpsdk/prod/ndp-loader.js', 'script'],
    ['https://recoshopping.naver.com/', 'sub_frame'],
  ];
  const allowed = [
    ['https://www.naver.com/', 'main_frame'],
    ['https://shopsquare.naver.com/', 'sub_frame'],
    ['https://s.pstatic.net/static/www/mobile/edit/logo.png', 'image'],
    ['https://ssl.pstatic.net/static/common/search.js', 'script'],
    ['https://glad-vod.pstatic.net/banner.mp4', 'media'],
    ['https://b01-kr-naver-vod.pstatic.net/movie.mp4', 'media'],
  ];
  const results = await worker.evaluate(async ({ ads, allowed }) => {
    const matches = async (entries, initiator) => Promise.all(entries.map(async ([url, type]) => ({
      url, type, ...(await chrome.declarativeNetRequest.testMatchOutcome({ url, type, initiator })),
    })));
    return {
      ads: await matches(ads, 'https://www.naver.com'),
      normal: await matches(allowed, 'https://www.naver.com'),
      player: await matches(ads, 'https://tv.naver.com'),
      unrelated: await matches(ads, 'https://example.com'),
      media: await matches(ads.map(([url]) => [url, 'media']), 'https://www.naver.com'),
    };
  }, { ads, allowed });
  for (const result of results.ads) assert.ok(result.matchedRules.some(rule => rule.rulesetId === 'banner_ads'), `Expected blocked display ad: ${result.url}`);
  for (const result of [...results.normal, ...results.player, ...results.unrelated, ...results.media]) {
    assert.deepEqual(result.matchedRules, [], `Unexpected block: ${result.type} ${result.url}`);
  }
});
