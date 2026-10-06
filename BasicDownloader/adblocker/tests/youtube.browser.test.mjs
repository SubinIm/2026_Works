import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { routeFixture, playerData } from './youtube-fixture.mjs';
let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')); } catch {}
const source = await readFile(new URL('../youtube-ads.js', import.meta.url), 'utf8');
async function setup(t) {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript({ content: source });
  await routeFixture(page);
  await page.goto('https://www.youtube.com/watch?v=fixture-main');
  return page;
}
test('YouTube initial data is pruned before first inline use without changing main video, captions or errors', { skip: !chromium }, async t => {
  const page = await setup(t);
  const boot = await page.evaluate(() => window.boot);
  const expected = playerData();
  delete expected.adPlacements; delete expected.adSlots; delete expected.playerAds;
  assert.deepEqual(boot, expected);
  const reassigned = await page.evaluate(() => {
    window.ytInitialPlayerResponse = { adSlots: [{}], videoDetails: { title: 'SPA second video' }, playabilityStatus: { status: 'LOGIN_REQUIRED' } };
    return window.ytInitialPlayerResponse;
  });
  assert.deepEqual(reassigned, { videoDetails: { title: 'SPA second video' }, playabilityStatus: { status: 'LOGIN_REQUIRED' } });
});
test('YouTube fetch preserves Response metadata, clones and body readers while removing nested ads', { skip: !chromium }, async t => {
  const page = await setup(t);
  const result = await page.evaluate(async () => {
    const response = await fetch(new Request('/youtubei/v1/player?mode=nested'));
    const clone = response.clone().clone();
    const data = await response.json();
    const bytes = await clone.arrayBuffer();
    return { data, copy: JSON.parse(new TextDecoder().decode(bytes)), status: response.status, ok: response.ok,
      url: response.url, type: response.type, redirected: response.redirected, header: response.headers.get('x-fixture'),
      etag: response.headers.get('etag'), bodyUsed: response.bodyUsed, instance: response instanceof Response };
  });
  assert.equal(result.status, 200); assert.equal(result.ok, true); assert.equal(result.instance, true);
  assert.equal(result.url, 'https://www.youtube.com/youtubei/v1/player?mode=nested');
  assert.equal(result.type, 'basic'); assert.equal(result.redirected, false); assert.equal(result.header, 'preserved');
  assert.equal(result.etag, null); assert.equal(result.bodyUsed, true);
  assert.equal('adSlots' in result.data[0].playerResponse, false);
  assert.equal(result.data[0].playerResponse.videoDetails.videoId, 'fixture-main');
  assert.deepEqual(result.copy, result.data);
});
test('YouTube limits response edits to player endpoints and retains non-JSON and HTTP failures', { skip: !chromium }, async t => {
  const page = await setup(t);
  const result = await page.evaluate(async () => {
    const read = async path => { const r=await fetch(path); return {status:r.status, text:await r.text(),etag:r.headers.get('etag')}; };
    return { other: await read('/youtubei/v1/search'), plain: await read('/youtubei/v1/player?mode=plain'),
      invalid: await read('/youtubei/v1/player?mode=invalid'), error: await read('/youtubei/v1/player?mode=error'),
      xssi: await read('/youtubei/v1/player?mode=xssi') };
  });
  assert.ok(JSON.parse(result.other.text).adSlots);
  assert.equal(result.other.etag, 'old-body'); assert.equal(result.plain.etag, 'old-body');
  assert.equal(result.invalid.text, '<html>Not JSON</html>');
  assert.equal(result.error.status, 403); assert.ok(JSON.parse(result.error.text).adSlots);
  assert.match(result.error.text, /Sign in required/);
  assert.ok(result.xssi.text.startsWith(")]}'\n"));
  assert.equal('adSlots' in JSON.parse(result.xssi.text.slice(5)), false);
});
test('YouTube XHR text/json and synchronous paths retain native errors and ordinary requests', { skip: !chromium }, async t => {
  const page = await setup(t);
  const result = await page.evaluate(async () => {
    const run = (path, type) => new Promise((resolve,reject) => {
      const xhr = new XMLHttpRequest();xhr.open('GET', path);xhr.responseType=type;
      xhr.onload=()=>{let error;try{void xhr.responseText}catch(e){error=e.name}
        resolve({status:xhr.status, url:xhr.responseURL, value:xhr.response, repeated:xhr.response === xhr.response,error});};
      xhr.onerror=reject;xhr.send();
    });
    const sync = new XMLHttpRequest();sync.open('GET','/youtubei/v1/player',false);sync.send();
    return { text:await run('/youtubei/v1/player',''), json:await run('/youtubei/v1/player','json'),
      other:await run('/youtubei/v1/search','json'), failure:await run('/youtubei/v1/player?mode=error','json'),sync:sync.responseText };
  });
  assert.equal('adSlots' in JSON.parse(result.text.value), false);
  assert.equal('adSlots' in result.json.value, false);
  assert.equal(result.json.error, 'InvalidStateError'); assert.equal(result.json.repeated, true);
  assert.ok(result.other.value.adSlots); assert.ok(result.failure.value.adSlots);
  assert.equal('adSlots' in JSON.parse(result.sync), false);
  assert.equal(result.text.url, 'https://www.youtube.com/youtubei/v1/player');
});
test('YouTube Shorts removes only explicit ad entries and preserves ordinary/unknown entries', { skip: !chromium }, async t => {
  const page = await setup(t);
  const data = await page.evaluate(async () => (await fetch('/youtubei/v1/reel/reel_watch_sequence?mode=shorts')).json());
  assert.equal(data.entries.length, 2);
  assert.deepEqual(data.entries.map(e => e.command.reelWatchEndpoint.videoId), ['main', 'another']);
  assert.equal('adPlacements' in data.entries[0].command.reelWatchEndpoint.playerResponse, false);
});

test('YouTube SABR initial and Fetch/XHR responses preserve the complete media/ad contract', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.goto('https://www.youtube.com/watch?v=fixture-main&transport=sabr');
  const result = await page.evaluate(async () => {
    const read = async mode => { const r=await fetch('/youtubei/v1/player?mode='+mode);return {data:await r.json(),etag:r.headers.get('etag')}; };
    const xhr = await new Promise((resolve,reject)=>{
      const r=new XMLHttpRequest();r.open('GET','/youtubei/v1/player?mode=sabr');r.responseType='json';
      r.onload=()=>resolve(r.response);r.onerror=reject;r.send();
    });
    const text = await new Promise((resolve,reject)=>{
      const r=new XMLHttpRequest();r.open('GET','/youtubei/v1/player?mode=sabr');
      r.onload=()=>resolve(JSON.parse(r.responseText));r.onerror=reject;r.send();
    });
    return {boot:window.boot,fetch:await read('sabr'),nested:await read('sabr-nested'),xhr,text};
  });
  const expected = playerData();
  expected.streamingData.serverAbrStreamingUrl='https://media.test/serverabr?signature=preserved';
  expected.adBreakHeartbeatParams={marker:'contract'};
  assert.deepEqual(result.boot,expected);assert.deepEqual(result.fetch.data,expected);
  assert.equal(result.fetch.etag,'old-body');assert.equal(result.nested.etag,'old-body');
  assert.deepEqual(result.xhr,expected);assert.deepEqual(result.text,expected);
  assert.deepEqual(result.nested.data.adSlots,[{marker:'outer contract'}]);
  assert.deepEqual(result.nested.data.response[0].playerResponse,expected);
  await page.evaluate(()=>document.querySelector('#movie_player').classList.add('ad-showing'));
  await page.waitForFunction(()=>window.skips===1);
});
test('YouTube only clicks enabled visible skip controls during explicit ad state, including dynamic Shorts', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.skips), 0);
  await page.evaluate(() => { const p=document.querySelector('#movie_player');p.classList.add('ad-showing');p.querySelector('button').disabled=true; });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.skips), 0);
  await page.evaluate(() => document.querySelector('button').disabled=false);
  await page.waitForFunction(() => window.skips===1);
  await page.evaluate(() => {
    const p=document.querySelector('#movie_player');p.id='shorts-player';p.classList.add('ad-interrupting');
    p.querySelector('button').style.display='none';document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.skips), 1);
  await page.evaluate(() => document.querySelector('button').style.display='');
  await page.waitForFunction(() => window.skips===2);
  assert.equal(await page.locator('main').isVisible(), true);
  assert.equal(await page.locator('video').isVisible(), true);
  assert.equal(await page.evaluate(() => window.timeEvents), 0);
});
test('YouTube normal HTML5 video remains playable and media properties match the native control', { skip: !chromium }, async t => {
  const page = await setup(t);
  const result = await page.evaluate(async () => {
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);
    const video=document.querySelector('video'), control=document.createElement('video');control.muted=true;
    const stream=canvas.captureStream(5);
    const read=v=>({volume:v.volume,rate:v.playbackRate});
    for(const v of [video,control]){v.volume=0.4;v.playbackRate=1.25;v.currentTime=12;}
    const before=read(video), baselineBefore=read(control), seek=video.currentTime;
    for(const v of [video,control]){v.srcObject=stream;await v.play();}
    return {playing:!video.paused && video.readyState>=2,before,baselineBefore,after:read(video),baselineAfter:read(control),seek,skips:window.skips};
  });
  assert.equal(result.playing,true);assert.equal(result.seek,12);assert.equal(result.skips,0);
  assert.deepEqual(result.before,{volume:0.4,rate:1.25});assert.deepEqual(result.before,result.baselineBefore);
  // Chromium forces playbackRate=1 for a live MediaStream; compare its native
  // control rather than misattributing that browser behavior to the extension.
  assert.deepEqual(result.after,result.baselineAfter);
});

test('YouTube skip resumes when a hidden player becomes visible without a DOM mutation', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.setViewportSize({ width: 400, height: 720 });
  await page.evaluate(() => {
    const sheet = document.createElement('style');
    sheet.textContent = '@media(max-width:500px){#movie_player{display:none}}';
    document.head.append(sheet);
    document.querySelector('#movie_player').classList.add('ad-showing');
  });
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.skips), 0);
  // Responsive CSS changes visibility without touching class/style attributes.
  await page.setViewportSize({ width: 900, height: 720 });
  await page.waitForFunction(() => window.skips === 1, null, { timeout: 2000 });
  await page.evaluate(() => {
    document.head.querySelector('style').sheet.insertRule('#movie_player{display:none}', 0);
    document.querySelector('#movie_player').classList.add('ad-showing');
  });
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.skips), 1);
  await page.evaluate(() => {
    document.head.querySelector('style').sheet.deleteRule(0);
    document.querySelector('video').dispatchEvent(new Event('timeupdate'));
  });
  await page.waitForFunction(() => window.skips === 2, null, { timeout: 2000 });
  assert.equal(await page.evaluate(() => window.timeEvents), 0);
});

test('YouTube modern skip avoids rejected synthetic clicks and finishes only distinct ad media', { skip: !chromium }, async t => {
  const page = await setup(t);
  const sample = await readFile(new URL('../fixtures/youtube-ad-sample.mp4', import.meta.url));
  await page.route('https://www.youtube.com/skip-fixture.mp4', route => {
    const match = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), sample.length - 1) : sample.length - 1;
    return route.fulfill({ status: match ? 206 : 200, contentType: 'video/mp4', body: sample.subarray(start, end + 1),
      headers: { 'accept-ranges': 'bytes', ...(match ? { 'content-range': `bytes ${start}-${end}/${sample.length}` } : {}) } });
  });
  await page.evaluate(async () => {
    const player = document.querySelector('#movie_player'), button = player.querySelector('button'), video = player.querySelector('video');
    button.className = 'ytp-skip-ad-button';
    window.rejectedClicks = 0;
    button.onclick = event => { if (!event.isTrusted) window.rejectedClicks++; };
    // Real logged-in player returned -1 even during an explicit visible ad.
    player.getAdState = () => -1;
    player.getProgressState = () => ({ allowSeeking: !player.matches('.ad-showing,.ad-interrupting'), duration: video.duration });
    video.addEventListener('ended', () => { window.skips++;player.classList.remove('ad-showing','ad-interrupting'); });
    video.src = '/skip-fixture.mp4';video.volume = 0.4;video.playbackRate = 1.25;
    await video.play();
    button.disabled = true;player.classList.add('ad-showing');
  });
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.skips), 0);
  await page.evaluate(() => document.querySelector('button').disabled = false);
  await page.waitForFunction(() => window.skips === 1, null, { timeout: 3000 }).catch(async error => {
    t.diagnostic(JSON.stringify(await page.evaluate(() => {
      const video = document.querySelector('video'), player = document.querySelector('#movie_player');
      return { details: window.ytInitialPlayerResponse?.videoDetails, state: player.getAdState(), progress: player.getProgressState(),
        time: video.currentTime, duration: video.duration, paused: video.paused, seeking: video.seeking, ended: video.ended, ready: video.readyState, skips: window.skips, clicks: window.rejectedClicks,
        href:location.href, seekable:video.seekable.length?video.seekable.end(video.seekable.length-1):null,
        connected: player.isConnected, rect: {width: player.getBoundingClientRect().width, height: player.getBoundingClientRect().height},
        button: {visible: player.querySelector('button').checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),disabled:player.querySelector('button').disabled} };
    })));
    throw error;
  });
  assert.deepEqual(await page.evaluate(() => ({ clicks: window.rejectedClicks, volume: document.querySelector('video').volume,
    rate: document.querySelector('video').playbackRate })), { clicks: 0, volume: 0.4, rate: 1.25 });
  // Lingering classes, stale SPA metadata and conflicting APIs must not advance
  // the main/combined stream. Keep real native media playing through each case.
  await page.evaluate(async () => {
    const video = document.querySelector('video');
    video.currentTime = 0;await video.play();
  });
  for (const condition of ['combined', 'stale', 'normal-progress', 'unknown-progress', 'duration-mismatch']) {
    await page.evaluate(condition => {
      const video = document.querySelector('video'), player = document.querySelector('#movie_player');
      window.ytInitialPlayerResponse.videoDetails.videoId = condition === 'stale' ? 'previous-video' : 'fixture-main';
      window.ytInitialPlayerResponse.videoDetails.lengthSeconds = condition === 'combined' ? String(video.duration) : '120';
      player.getProgressState = () => condition === 'unknown-progress' ? undefined : ({ allowSeeking: condition === 'normal-progress',
        duration: condition === 'duration-mismatch' ? 120 : video.duration });
      player.classList.add('ad-showing');
    }, condition);
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => window.skips), 1, condition);
    assert.ok(await page.evaluate(() => document.querySelector('video').currentTime < 10), condition);
    assert.equal(await page.evaluate(() => window.rejectedClicks), 0, condition);
  }
});

test('YouTube fetch keeps AbortError and iframe documents retain their unpatched initial data', { skip: !chromium }, async t => {
  const page=await setup(t);
  const result=await page.evaluate(async()=>{
    const controller=new AbortController();controller.abort();let error;
    try{await fetch('/youtubei/v1/player',{signal:controller.signal})}catch(e){error=e.name}
    const frame=document.createElement('iframe');frame.srcdoc='<script>window.ytInitialPlayerResponse={adSlots:[{}],videoDetails:{title:"Frame video"}}</script>';
    const loaded=new Promise(resolve=>frame.onload=resolve);document.body.append(frame);await loaded;
    return {error,frameData:frame.contentWindow.ytInitialPlayerResponse};
  });
  assert.equal(result.error,'AbortError');assert.ok(result.frameData.adSlots);
  assert.equal(result.frameData.videoDetails.title,'Frame video');
});
