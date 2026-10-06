import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { routeFixture } from './youtube-fixture.mjs';
let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')); } catch {}
const executablePath = process.env.EXTENSION_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
test('native YouTube option starts before inline scripts, persists, pauses and restores without changing other rules', {
  skip: !chromium || !existsSync(executablePath), timeout:90000,
}, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'basic-banner-youtube-'));
  const extension = fileURLToPath(new URL('..', import.meta.url));
  const browser = await chromium.launchPersistentContext(profile, { executablePath, headless:true,
    args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  t.after(async () => {
    await browser.close();
    if (resolve(dirname(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('basic-banner-youtube-')) throw new Error('Unexpected profile path');
    await rm(profile, { recursive:true,force:true });
  });
  const worker=browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const options=await browser.newPage();
  await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  const send=payload=>options.evaluate(message=>chrome.runtime.sendMessage(message),payload);
  const toggle=enabled=>send({type:'SET_PRIVACY_PROTECTION',setting:'youtubeAdBlockingEnabled',enabled});
  const page=await browser.newPage();await routeFixture(page);
  await page.goto('https://www.youtube.com/watch?v=fixture-main');
  assert.ok((await page.evaluate(()=>window.boot)).adSlots, 'Default OFF control');
  await options.locator('#youtube-ad-toggle').click();
  await options.waitForFunction(()=>document.querySelector('#youtube-ad-toggle').checked && !document.querySelector('#youtube-ad-toggle').disabled);
  await page.reload();
  assert.equal('adSlots' in await page.evaluate(()=>window.boot), false, 'Real registration runs before inline script');
  assert.equal('adSlots' in await page.evaluate(async()=>(await fetch('/youtubei/v1/player')).json()),false);
  await options.reload();assert.equal(await options.locator('#youtube-ad-toggle').isChecked(),true);
  await page.goto('https://www.youtube.com/watch?v=fixture-main&transport=sabr');
  assert.ok((await page.evaluate(()=>window.boot)).adSlots,'SABR initial contract is preserved with feature ON');
  assert.ok((await page.evaluate(async()=>(await fetch('/youtubei/v1/player?mode=sabr')).json())).adSlots);
  await page.goto('https://www.youtube.com/watch?v=fixture-main');
  const saved=await send({type:'GET_STATE'});
  assert.equal(saved.state.youtubeAdBlockingEnabled,true); assert.equal(saved.state.videoAdBlockingEnabled,false);
  await page.evaluate(()=>document.querySelector('#movie_player').classList.add('ad-showing'));
  await page.waitForFunction(()=>window.skips===1);
  await send({type:'SET_SITE_ENABLED',site:'youtube.com',enabled:false});await page.reload();
  assert.ok((await page.evaluate(()=>window.boot)).adSlots);
  await page.evaluate(()=>document.querySelector('#movie_player').classList.add('ad-showing'));
  await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>window.skips),0);
  await send({type:'SET_SITE_ENABLED',site:'youtube.com',enabled:true});await page.reload();
  assert.equal('adSlots' in await page.evaluate(()=>window.boot),false);
  await send({type:'SET_ENABLED',enabled:false});await page.reload();
  assert.ok((await page.evaluate(()=>window.boot)).adSlots);
  await send({type:'SET_ENABLED',enabled:true});await toggle(false);await page.reload();
  assert.ok((await page.evaluate(()=>window.boot)).adSlots);
  assert.match(await page.evaluate(()=>window.fetchBoot), /\[native code\]/);
  assert.match(await page.evaluate(()=>window.xhrBoot), /\[native code\]/);
});
