import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')); } catch {}
const executablePath = process.env.EXTENSION_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const html = `<!doctype html><body><main>Normal content</main><canvas id="canvas" width="16" height="16"></canvas><iframe id="raw" srcdoc="<!doctype html><body>"></iframe><video id="video" muted playsinline></video><script>
const canvas=document.querySelector('canvas'), ctx=canvas.getContext('2d');
ctx.fillStyle='rgb(120,80,40)';ctx.fillRect(0,0,16,16);
const pixels=ctx.getImageData(0,0,16,16).data;
const expected=[120,80,40,255];
const changed=[...pixels].filter((v,i)=>v!==expected[i%4]).length;
const buffer=new AudioBuffer({length:128,numberOfChannels:1,sampleRate:44100});
buffer.copyToChannel(new Float32Array(128).fill(0.25),0);
const samples=buffer.getChannelData(0), snapshot=Array.from(samples);
const repeated=buffer.getChannelData(0);
window.boot={changed,audioChanged:snapshot.filter(v=>v!==0.25).length,
delta:Math.max(...snapshot.map(v=>Math.abs(v-0.25))),
sameView:samples===repeated,stable:snapshot.every((v,i)=>v===repeated[i])};
window.ctx=ctx;window.audioBuffer=buffer;
</script></body>`;

test('native MAIN protection precedes inline scripts, keeps rendering/writable audio/video, and restores on reload', {
  skip: !chromium || !existsSync(executablePath), timeout: 90000,
}, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'basic-banner-advanced-'));
  const extension = fileURLToPath(new URL('..', import.meta.url));
  const browser = await chromium.launchPersistentContext(profile, { executablePath, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  t.after(async () => {
    await browser.close();
    if (resolve(dirname(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('basic-banner-advanced-')) throw new Error('Unexpected profile path');
    await rm(profile, { recursive: true, force: true });
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  const send = payload => options.evaluate(message => chrome.runtime.sendMessage(message), payload);
  const toggle = (setting, enabled) => send({ type: 'SET_PRIVACY_PROTECTION', setting, enabled });
  assert.equal((await toggle('fingerprintProtectionEnabled', true)).ok, true);
  assert.equal((await toggle('videoAdBlockingEnabled', true)).ok, true);
  const page = await browser.newPage();
  await page.route('http://protect.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://protect.test/');
  const protectedRead = await page.evaluate(() => window.boot);
  assert.equal(protectedRead.changed, 1);
  assert.equal(protectedRead.audioChanged, 1);
  assert.ok(protectedRead.delta > 0 && protectedRead.delta < 1e-6);
  assert.equal(protectedRead.sameView, true);
  assert.equal(protectedRead.stable, true);
  const checks = await page.evaluate(async () => {
    const raw=document.querySelector('#raw').contentWindow.CanvasRenderingContext2D.prototype.getImageData;
    const rendered=Reflect.apply(raw,window.ctx,[0,0,16,16]).data;
    const originalExact=[...rendered].every((v,i)=>v===[120,80,40,255][i%4]);
    const stable=Array.from(window.ctx.getImageData(0,0,16,16).data).every((v,i)=>v===window.ctx.getImageData(0,0,16,16).data[i]);
    let error;try{window.ctx.getImageData(0,0,0,0)}catch(e){error=e.name}
    const exported=document.querySelector('canvas').toDataURL();
    const blob=await new Promise(r=>document.querySelector('canvas').toBlob(r));
    window.audioBuffer.getChannelData(0).set([0.75],0);
    const writable=window.audioBuffer.getChannelData(0)[0];
    const capture=document.createElement('canvas');capture.width=16;capture.height=16;
    capture.getContext('2d').fillRect(0,0,16,16);
    const stream=capture.captureStream(5),video=document.querySelector('video');
    video.srcObject=stream;await video.play();
    return {originalExact,stable,error,exported:exported.startsWith('data:image/png'),blob:blob?.type,writable,video:!video.paused && video.readyState>=2};
  });
  assert.equal(checks.originalExact, true, 'Rendered canvas is not mutated');
  assert.equal(checks.stable, true, 'Repeated reads in a document are stable');
  assert.equal(checks.error, 'IndexSizeError');
  assert.equal(checks.exported, true);
  assert.equal(checks.blob, 'image/png');
  assert.ok(Math.abs(checks.writable - 0.75) < 1e-6);
  assert.equal(checks.video, true, 'Ordinary HTML5 video still plays');
  const match = await options.evaluate(() => chrome.declarativeNetRequest.testMatchOutcome({
    url: 'https://imasdk.googleapis.com/js/sdkloader/ima3.js', type: 'script', initiator: 'http://protect.test/' }));
  assert.ok(match.matchedRules.some(rule => rule.ruleId === 22000));
  const youtubeMatch = await options.evaluate(() => chrome.declarativeNetRequest.testMatchOutcome({
    url: 'https://googleads.g.doubleclick.net/pagead/ads?test=1', type: 'xmlhttprequest', initiator: 'https://www.youtube.com/' }));
  assert.equal(youtubeMatch.matchedRules.some(rule=>rule.ruleId===22001),false,'Generic VAST does not break YouTube');
  assert.equal((await send({ type: 'SET_SITE_ENABLED', site: 'protect.test', enabled: false })).ok, true);
  await page.reload();
  assert.deepEqual(await page.evaluate(() => [window.boot.changed,window.boot.audioChanged]), [0,0]);
  await send({ type: 'SET_SITE_ENABLED', site: 'protect.test', enabled: true });
  await page.reload();
  assert.equal((await page.evaluate(() => window.boot)).changed, 1);
  await toggle('fingerprintProtectionEnabled', false);
  await page.reload();
  assert.deepEqual(await page.evaluate(() => [window.boot.changed,window.boot.audioChanged]), [0,0]);
});
