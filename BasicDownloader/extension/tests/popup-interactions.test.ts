import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import type { MediaCandidate } from "../src/shared/models.ts";

// Exercise the actual popup entry point with a deliberately small synthetic DOM.
// No browser, network, Native Host, or fixture server is involved in these tests.
const popupCode = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/popup/popup.ts", import.meta.url))],
  bundle: true, write: false, platform: "browser", format: "iife",
}).outputFiles[0].text;
const popupHtml = readFileSync(new URL("../src/popup/popup.html", import.meta.url), "utf8");

class SyntheticNode {
  tagName: string;
  children: SyntheticNode[] = [];
  parent: SyntheticNode | null = null;
  id = "";
  className = "";
  value: string | number = "";
  checked = false;
  disabled = false;
  open = false;
  title = "";
  max = 0;
  type = "";
  src = "";
  crossOrigin = "";
  referrerPolicy = "";
  indeterminate = false;
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  ownText = "";
  content?: SyntheticNode;
  onclick?: () => unknown;
  listeners = new Map<string, ((event: any) => unknown)[]>();

  constructor(tagName: string) {
    this.tagName = tagName;
    if (tagName === "template") this.content = new SyntheticNode("#fragment");
  }

  get classList() {
    const node = this;
    return {
      contains(token: string) { return node.className.split(/\s+/).includes(token); },
      toggle(token: string, force?: boolean) {
        const classes = new Set(node.className.split(/\s+/).filter(Boolean));
        const enabled = force ?? !classes.has(token);
        if (enabled) classes.add(token); else classes.delete(token);
        node.className = [...classes].join(" ");
        return enabled;
      },
      add(token: string) { this.toggle(token, true); },
      remove(token: string) { this.toggle(token, false); },
    };
  }

  get textContent(): string { return this.ownText + this.children.map(node => node.textContent).join(""); }
  set textContent(value: string) { this.replaceChildren(); this.ownText = value; }

  append(...nodes: SyntheticNode[]) {
    for (const node of nodes) {
      // Essential DOM behavior: mounting a fragment empties it, moving its children.
      if (node.tagName === "#fragment") { this.append(...[...node.children]); continue; }
      node.remove();
      node.parent = this;
      this.children.push(node);
      if (this.tagName === "select" && this.children.length === 1) this.value = node.value;
    }
  }

  insertBefore(node: SyntheticNode, reference: SyntheticNode | null) {
    if (node === reference) return node;
    node.remove();
    const index = reference === null ? this.children.length : this.children.indexOf(reference);
    assert.ok(index >= 0, "insertBefore reference must belong to this parent");
    node.parent = this;
    this.children.splice(index, 0, node);
    return node;
  }

  replaceChildren(...nodes: SyntheticNode[]) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.ownText = "";
    this.append(...nodes);
  }

  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }

  matches(selector: string) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    return this.tagName === selector;
  }

  querySelector(selector: string): SyntheticNode | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): SyntheticNode[] {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }

  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); if (name === "value") this.value = ""; if (name === "src") this.src = ""; }
  getBoundingClientRect() { return { left: 10, top: 10, bottom: 30 }; }
  contains(node: SyntheticNode): boolean { return node === this || this.children.some(child => child.contains(node)); }
  focus() { (globalThis as any).__syntheticFocused = this; }

  cloneNode(deep: boolean): SyntheticNode {
    const clone = new SyntheticNode(this.tagName);
    for (const key of ["id", "className", "value", "checked", "disabled", "open", "title", "max", "ownText"] as const) {
      (clone as any)[key] = this[key];
    }
    if (deep) {
      clone.append(...this.children.map(child => child.cloneNode(true)));
      if (this.content) clone.content = this.content.cloneNode(true);
    }
    return clone;
  }

  addEventListener(name: string, listener: (event: any) => unknown) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  async click() {
    if (this.disabled) return;
    await this.onclick?.();
    await this.dispatch("click");
  }

  async dispatch(name: string, properties: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(name) ?? []) await listener({ target: this, preventDefault() {}, ...properties });
  }
}

function createDocument(html: string) {
  const document = new SyntheticNode("#document") as SyntheticNode & { createElement: (name: string) => SyntheticNode };
  document.createElement = name => new SyntheticNode(name);
  const stack = [document];
  const voidTags = new Set(["meta", "link", "input", "br", "hr", "img"]);
  for (const token of html.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith("<!")) continue;
    if (token.startsWith("</")) { stack.pop(); continue; }
    if (token.startsWith("<")) {
      const name = token.match(/^<([\w-]+)/)![1];
      const node = new SyntheticNode(name);
      for (const attribute of token.matchAll(/([\w-]+)="([^"]*)"/g)) {
        const [, key, value] = attribute;
        if (key === "class") node.className = value;
        if (key === "id") node.id = value;
        if (key === "value") node.value = value;
      }
      stack.at(-1)!.append(node);
      if (!voidTags.has(name)) stack.push(node.content ?? node);
    } else {
      const text = new SyntheticNode("#text");
      text.ownText = token;
      stack.at(-1)!.append(text);
    }
  }
  return document;
}

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
type Handler = (message: any) => unknown;

function candidate(id: string, url = `https://fixture.test/${id}.m3u8`): MediaCandidate {
  return {
    id, tabId: 7, pageUrl: "https://fixture.test/player/", pageTitle: "Fixture video", url,
    canonicalUrl: url, mediaKind: url.endsWith(".mpd") ? "dash" : url.endsWith(".mp4") ? "mp4" : "hls",
    detectedAt: 1, lastSeenAt: 2, requestCount: 1, segmentEvidenceCount: 0, confidenceScore: 80,
    source: "webRequest-url",
    flags: { likelyMasterManifest: false, likelyAdvertisement: false, signedUrl: false, blobUrl: url.startsWith("blob:") },
  };
}

async function mount(items: MediaCandidate[], overrides: Record<string, Handler> = {}, jobs: any[] = [], view = "popup", tabUrl = "https://fixture.test/player/") {
  const document = createDocument(popupHtml);
  const sent: any[] = [];
  const storageListeners: ((changes: any, area: string) => void)[] = [];
  const runtimeListeners: ((event: any) => void)[] = [];
  const chrome = {
    tabs: { query: async () => [{ id: 7, title: "Fixture player",url:tabUrl }] },
    runtime: {
      sendMessage: async (message: any) => {
        sent.push(message);
        if (overrides[message.type]) return overrides[message.type](message);
        if (message.type === "health") return { type: "health_result", payload: { ffmpegAvailable: true, hostVersion: "0.2.0" } };
        if (message.type === "list_candidates") return { candidates: items };
        if (message.type === "list_jobs") return { jobs };
        if (message.type === "probe") return { type: "probe_result", payload: { duration: 6 } };
        if (message.type === "download") return { type: "job_started", payload: { jobId: "job-new" } };
        return { ok: true };
      },
      onMessage: { addListener: (listener: (event: any) => void) => runtimeListeners.push(listener) },
    },
    storage: { onChanged: { addListener: (listener: (changes: any, area: string) => void) => storageListeners.push(listener) } },
  };
  const copied: string[] = [];
  runInNewContext(popupCode, { document, chrome, URL, location: { href: `https://extension.test/popup.html?view=${view}` }, Node: SyntheticNode, Element: SyntheticNode, window: { innerWidth: 720, innerHeight: 600 }, navigator: { userAgent: "Synthetic test", clipboard: { writeText: async (text: string) => { copied.push(text); } } }, console });
  await settle();
  const get = (selector: string, parent = document) => {
    const element = parent.querySelector(selector);
    assert.ok(element, `Expected rendered element ${selector}`);
    return element;
  };
  return {
    document, get, sent, copied,
    cards: () => get("#candidates").children.filter(node => node.tagName === "article"),
    change: async (changes: any, area = "session") => {
      for (const listener of storageListeners) listener(changes, area);
      await settle();
    },
    hostEvent: async (message: any) => {
      for (const listener of runtimeListeners) listener({ type: "host_event", message });
      await settle();
    },
  };
}

test("popup and side panel set sizing mode on both document root and body", async () => {
  for (const view of ["popup", "sidepanel"]) {
    const ui = await mount([], {}, [], view);
    for (const selector of ["html", "body"]) {
      assert.equal(ui.get(selector).classList.contains("sidepanel"), view === "sidepanel");
    }
  }
});

test('YouTube auxiliary engine controls require an opt-in ready Host and a supported page',async()=>{
  const ready=()=>({type:'health_result',payload:{ffmpegAvailable:true,hostVersion:'0.3.0',youtubeAvailable:true}});
  const normal=await mount([],{health:ready});
  assert.equal(normal.get('#youtube-panel').classList.contains('hidden'),true);
  assert.equal(normal.get('#youtube-download').disabled,true);
  const missing=await mount([],{health:()=>({type:'health_result',payload:{ffmpegAvailable:true,youtubeAvailable:false}})},[],'popup','https://www.youtube.com/watch?v=D2cUkF-MPJU');
  assert.equal(missing.get('#youtube-download').disabled,true);
  const enabled=await mount([],{health:ready},[],'popup','https://www.youtube.com/watch?v=D2cUkF-MPJU');
  assert.equal(enabled.get('#youtube-probe').disabled,false);
  assert.equal(enabled.get('#youtube-download').disabled,false);
  assert.match(enabled.get('#youtube-status').textContent,/쿠키 미전송/);
  assert.ok(!enabled.get('#youtube-status').textContent.includes('설정이 필요'));
});

test('YouTube Download starts once without a prior user Probe and preserves optional input Probe',async()=>{
  for(const preProbe of [true,false]){
    const ui=await mount([],{health:()=>({type:'health_result',payload:{ffmpegAvailable:true,hostVersion:'0.3.0',youtubeAvailable:true}}),
      youtube_download:()=>({type:'job_started',payload:{jobId:'youtube-test'}})},[],'popup','https://www.youtube.com/watch?v=D2cUkF-MPJU');
    ui.get('#youtube-input-probe').checked=preProbe;
    ui.get('#youtube-height').value='720';ui.get('#youtube-container').value='mkv';
    await ui.get('#youtube-download').click();await settle();
    const requests=ui.sent.filter(m=>m.type==='youtube_download');
    assert.equal(requests.length,1);
    assert.equal(requests[0].options.probeBeforeDownload,preProbe);
    assert.equal(requests[0].options.maxHeight,720);
    assert.equal(requests[0].includeSession,undefined);
    assert.ok(!ui.sent.some(m=>m.type==='youtube_probe'||m.type==='download'));
  }
});

test('YouTube format Probe reports AV metadata without changing disabled blob card controls',async()=>{
  const blob={...candidate('blob'),url:'blob:https://www.youtube.com/internal',flags:{...candidate('blob').flags,blobUrl:true}};
  const ui=await mount([blob],{health:()=>({type:'health_result',payload:{ffmpegAvailable:true,hostVersion:'0.3.0',youtubeAvailable:true}}),
    youtube_probe:()=>({type:'probe_result',payload:{title:'Guest video',duration:671,videoStreams:[{}],audioStreams:[{}],heights:[360,720]}})
    },[],'popup','https://www.youtube.com/watch?v=D2cUkF-MPJU');
  await ui.get('#youtube-probe').click();await settle();
  assert.match(ui.get('#youtube-status').textContent,/영상 1개 · 음성 1개 · 길이 671초/);
  assert.equal(ui.get('.probe',ui.cards()[0]).disabled,true);
  assert.equal(ui.get('.download',ui.cards()[0]).disabled,true);
});

test('refresh requests page recovery and explains SABR without enabling blob downloads',async()=>{
  const blob={...candidate('blob'),url:'blob:https://www.youtube.com/internal',flags:{...candidate('blob').flags,blobUrl:true}};
  const ui=await mount([blob],{list_candidates:()=>({candidates:[blob],diagnostic:{sabrDetected:true,unavailableDirectFormats:20}})});
  assert.equal(ui.sent.find(m=>m.type==='list_candidates').refresh,true);
  assert.match(ui.get('#refresh-note').textContent,/SABR/);
  await ui.change({mediaCandidatesByTab:{newValue:{'7':[blob]}}});
  assert.match(ui.get('#refresh-note').textContent,/SABR/,'storage rerenders must retain the current page diagnostic');
  assert.equal(ui.get('.download',ui.cards()[0]).disabled,true);
  const http=await mount([candidate('hls')],{list_candidates:()=>({candidates:[candidate('hls')],diagnostic:{sabrDetected:true}})});
  assert.ok(!http.get('#refresh-note').textContent.includes('주소는 제공되지 않았습니다'),'available HTTP candidates remain usable');
});

test("individual Probe can run all candidates and optionally download exactly one", async () => {
  for(const auto of [false,true]){
    const ui=await mount([candidate("one"),candidate("two")],{
      get_preferences:()=>({preferences:{batchProbe:true,downloadAfterProbe:auto}}),
      find_av:()=>({ok:true,candidateId:candidate("two").id,checked:2,failed:0}),
    });
    await ui.get(".probe",ui.cards()[0]).click();await settle();
    assert.equal(ui.sent.find(m=>m.type==="find_av").all,true);
    assert.ok(!ui.sent.some(m=>m.type==="probe"));
    const downloads=ui.sent.filter(m=>m.type==="download");
    assert.equal(downloads.length,auto?1:0);
    if(auto){assert.equal(downloads[0].candidateId,candidate("two").id);assert.equal(downloads[0].includeSession,false);}
  }
});

test('Download and Start select the verified candidate on the first attempt when automatic download is enabled',async()=>{
  for(const control of ['.download','.start']){
    const silent=candidate('silent'),audible=candidate('audible');
    const ui=await mount([silent,audible],{
      get_preferences:()=>({preferences:{batchProbe:true,downloadAfterProbe:true}}),
      find_av:()=>({ok:true,candidateId:audible.id,checked:2,videoOnly:1,withAudioVideo:1})
    });
    const source=ui.cards().find(card=>ui.get('.url',card).textContent===silent.url)!;
    ui.get('.auto-title',source).checked=false;ui.get('.filename',source).value='my-output';
    ui.get('.container',source).value='mkv';
    await ui.get(control,source).click();await settle();
    const requests=ui.sent.filter(m=>m.type==='download');
    assert.equal(requests.length,1,'no failed first download or second user click');
    assert.equal(requests[0].candidateId,audible.id);
    assert.equal(requests[0].options.filename,'my-output');
    assert.equal(requests[0].options.container,'mkv');
    assert.equal(ui.sent.find(m=>m.type==='find_av').all,true);
  }
});
test('automatic download with no eligible candidate sends no failing first download',async()=>{
  const ui=await mount([candidate('silent')],{get_preferences:()=>({preferences:{batchProbe:true,downloadAfterProbe:true}}),find_av:()=>({ok:true,candidateId:null,videoOnly:1,checked:1})});
  await ui.get('.download').click();await settle();
  assert.ok(!ui.sent.some(m=>m.type==='download'));
  assert.match(ui.get('#find-av-status').textContent,/찾지 못했습니다/);
});
test('optional input Probe can still be skipped with automatic selection preference enabled',async()=>{
  const ui=await mount([candidate('direct')],{get_preferences:()=>({preferences:{batchProbe:true,downloadAfterProbe:true}}),health:()=>({type:'health_result',payload:{ffmpegAvailable:true,hostVersion:'0.2.2',capabilities:{optionalInputProbe:true,audioOnly:true}}})});
  ui.get('.probe-before-download').checked=false;
  await ui.get('.start').click();await settle();
  assert.ok(!ui.sent.some(m=>m.type==='find_av'||m.type==='probe'));
  assert.equal(ui.sent.find(m=>m.type==='download').options.probeBeforeDownload,false);
});
test('option help supports pinned click and Escape without changing the checkbox',async()=>{
  const ui=await mount([candidate('help')]);
  const wrap=ui.get('.help-wrap',ui.cards()[0]);const button=ui.get('.help-trigger',wrap);
  const checkbox=ui.get('.session');
  await button.click();
  assert.equal(wrap.classList.contains('help-pinned'),true);
  assert.equal(button.attributes.get('aria-expanded'),'true');
  assert.equal(checkbox.checked,false);
  await button.dispatch('keydown',{key:'Escape'});
  assert.equal(wrap.classList.contains('help-pinned'),false);
  assert.equal(wrap.classList.contains('help-dismissed'),true);
  assert.equal(checkbox.checked,false);
  await button.click();
  await ui.document.dispatch('keydown',{key:'Escape'});
  assert.equal(wrap.classList.contains('help-pinned'),false);
  assert.equal(button.attributes.get('aria-expanded'),'false');
});

test("auto download never starts without a match or after candidates are cleared",async()=>{
  const none=await mount([candidate("one")],{get_preferences:()=>({preferences:{batchProbe:true,downloadAfterProbe:true}}),find_av:()=>({ok:true,candidateId:null,failed:1})});
  await none.get("#find-av").click();assert.ok(!none.sent.some(m=>m.type==="download"));
  let release!: (value:any)=>void;
  const ui=await mount([candidate("one")],{get_preferences:()=>({preferences:{batchProbe:true,downloadAfterProbe:true}}),find_av:()=>new Promise(r=>{release=r;})});
  const pending=ui.get("#find-av").click();await settle();await ui.get("#clear").click();
  release({ok:true,candidateId:candidate("one").id});await pending;await settle();
  assert.ok(!ui.sent.some(m=>m.type==="download"));
});

test("popup refresh preserves HTTP candidates and explains blob-only snapshots",async()=>{
  const ui=await mount([candidate("http"),candidate("blob","blob:https://fixture.test/id")]);
  await ui.get("#refresh").click();await settle();
  assert.equal(ui.cards().length,2);assert.ok(!ui.sent.some(m=>m.type==="clear_candidates"));
  const blob=await mount([candidate("blob","blob:https://fixture.test/id")]);
  await blob.get("#refresh").click();await settle();
  assert.match(blob.get("#refresh-note").textContent,/네트워크 요청을 재실행하지 않습니다/);
});

test("automatic selected download still requires confirmation for an existing file",async()=>{
  const ui=await mount([candidate("one")],{
    get_preferences:()=>({preferences:{batchProbe:true,downloadAfterProbe:true}}),
    find_av:()=>({ok:true,candidateId:candidate("one").id}),
    check_duplicate:()=>({ok:true,jobs:[{jobId:"existing",state:"completed",outputPath:"C:\\existing.mp4"}]}),
  });
  await ui.get("#find-av").click();await settle();
  assert.ok(!ui.sent.some(m=>m.type==="download"));
  assert.equal(ui.get(".duplicate-warning").classList.contains("hidden"),false);
});

test("one-click AV search selects the returned candidate without downloading", async () => {
  const ui=await mount([candidate("one"),candidate("two")],{find_av:()=>({ok:true,candidateId:candidate("two").id,checked:2,failed:0})});
  await ui.get("#find-av").click();
  assert.match(ui.get("#find-av-status").textContent,/선택했습니다/);
  assert.match(ui.get(".url",ui.cards()[0]).textContent,/two/);
  assert.equal(ui.get(".options",ui.cards()[0]).classList.contains("hidden"),false);
  assert.ok(!ui.sent.some(m=>m.type==="download"));
});

test("automatic audio-missing failure continues with a different candidate exactly once",async()=>{
  const first=candidate("silent"),second=candidate("audible");
  let searches=0,downloads=0;
  const ui=await mount([first,second],{
    get_preferences:()=>({preferences:{batchProbe:true,downloadAfterProbe:true}}),
    find_av:(request:any)=>{searches++;return {ok:true,candidateId:request.excludeIds?.includes(first.id)?second.id:first.id};},
    download:()=>({type:"job_started",payload:{jobId:`automatic-${++downloads}`}}),
  });
  await ui.get("#find-av").click();await settle();
  assert.equal(downloads,1);
  await ui.hostEvent({type:"job_failed",payload:{jobId:"automatic-1",errorCode:"audio_stream_missing",errorSummary:"No audio",probe:{videoStreams:[{index:0}],audioStreams:[]}}});
  await settle();
  assert.equal(downloads,2);assert.equal(searches,2);
  const searchesSent=ui.sent.filter(m=>m.type==="find_av");
  assert.equal(searchesSent[1].all,true);assert.deepEqual(Array.from(searchesSent[1].excludeIds),[first.id]);
  assert.equal(ui.sent.filter(m=>m.type==="download")[1].candidateId,second.id);
  await ui.hostEvent({type:"job_failed",payload:{jobId:"automatic-1",errorCode:"audio_stream_missing"}});
  assert.equal(downloads,2,"duplicate native event cannot start another retry");
  await ui.hostEvent({type:"job_failed",payload:{jobId:"automatic-2",errorCode:"network_error"}});
  assert.equal(downloads,2,"network failures do not trigger media-selection retries");
});

test("manual audio-missing download does not silently start other downloads",async()=>{
  const ui=await mount([candidate("manual")]);
  await ui.get(".start").click();await settle();
  await ui.hostEvent({type:"job_failed",payload:{jobId:"job-new",errorCode:"audio_stream_missing"}});
  assert.ok(!ui.sent.some(m=>m.type==="find_av"));
  assert.equal(ui.get(".retry-candidates").classList.contains("hidden"),false);
});

test("audio-only option excludes silent-video opt-in and is forwarded", async () => {
  const ui=await mount([candidate("sound")],{health:()=>({type:"health_result",payload:{ffmpegAvailable:true,hostVersion:"0.2.2",capabilities:{audioOnly:true,optionalInputProbe:true}}})});
  ui.get(".allow-video-only").checked=true;
  const audio=ui.get(".audio-only");audio.checked=true;await audio.dispatch("change");
  assert.equal(ui.get(".allow-video-only").checked,false);
  assert.equal(ui.get(".allow-video-only").disabled,true);
  await ui.get(".start").click();
  assert.equal(ui.sent.find(m=>m.type==="download").options.audioOnly,true);
  const legacy=await mount([candidate("old")]);
  assert.equal(legacy.get(".audio-only").disabled,true);
});

test("download input Probe is a separate optional choice on capable Hosts", async () => {
  const ui = await mount([candidate("optional")], { health: () => ({ type: "health_result", payload: { ffmpegAvailable: true, hostVersion: "0.2.1", capabilities: { optionalInputProbe: true } } }) });
  const checkbox = ui.get(".probe-before-download");
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.checked, true);
  checkbox.checked = false;
  await ui.get(".start").click();
  assert.equal(ui.sent.find(m => m.type === "download").options.probeBeforeDownload, false);
  assert.ok(!ui.sent.some(m => m.type === "probe"));
  const legacy = await mount([candidate("legacy")]);
  assert.equal(legacy.get(".probe-before-download").disabled, true);
  assert.match(legacy.get(".probe-option-note").textContent, /0.2.1/);
});

test("mounted Download card opens options and Start forwards edited filename and choices", async () => {
  const ui = await mount([candidate("hls")]);
  const card = ui.cards()[0];
  assert.equal(ui.get(".download", card).disabled, false);
  assert.equal(ui.get(".options", card).classList.contains("hidden"), true);
  await ui.get(".download", card).click();
  assert.equal(ui.get(".options", card).classList.contains("hidden"), false);
  ui.get(".filename", card).value = "Edited output";
  ui.get(".container", card).value = "mkv";
  ui.get(".overwrite", card).value = "cancel";
  ui.get(".session", card).checked = true;
  await ui.get(".start", card).click();
  const request = ui.sent.find(message => message.type === "download");
  assert.ok(request);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    type: "download", tabId: 7, candidateId: "hls", includeSession: true, userAgent: "Synthetic test",
    options: { filename: "Edited output", container: "mkv", overwrite: "cancel", liveMode: "until_stopped", allowVideoOnly: false, audioOnly: false, probeBeforeDownload: true },
  });
  assert.equal(ui.get(".message", card).textContent, "다운로드를 시작했습니다.");
});

test("Host storage disconnect and reconnect update HTTP controls while blob stays blocked", async () => {
  const items = [candidate("mp4", "https://fixture.test/direct.mp4"), candidate("hls"), candidate("dash", "https://fixture.test/stream.mpd"), candidate("blob", "blob:https://fixture.test/id")];
  const ui = await mount(items);
  const assertControls = (httpDisabled: boolean) => {
    for (const card of ui.cards()) {
      const isBlob = ui.get(".url", card).textContent.startsWith("blob:");
      for (const selector of [".probe", ".download", ".start"]) assert.equal(ui.get(selector, card).disabled, isBlob || httpDisabled);
      if (isBlob) assert.equal(ui.get(".session", card).disabled, true);
    }
  };
  assertControls(false);
  await ui.change({ nativeHostStatus: { newValue: { connected: false } } });
  assertControls(true);
  await ui.change({ nativeHostStatus: { newValue: { connected: true } } });
  assertControls(false);
  assert.equal(ui.sent.filter(message => message.type === "health").length, 2);
});

test("candidate storage updates preserve card identity, edited filename, session and disclosure", async () => {
  const initial = candidate("hls");
  const ui = await mount([initial]);
  const card = ui.cards()[0];
  await ui.get(".download", card).click();
  ui.get(".filename", card).value = "Keep this filename";
  ui.get(".session", card).checked = true;
  ui.get(".allow-video-only", card).checked = true;
  await ui.get(".probe", card).click();
  ui.get(".technical", card).open = true;
  const updated = { ...initial, pageTitle: "New title must not overwrite filename", requestCount: 4, lastSeenAt: 10 };
  await ui.change({ mediaCandidatesByTab: { newValue: { "7": [updated] } } });
  assert.equal(ui.cards()[0], card);
  assert.equal(ui.get(".filename", card).value, "Keep this filename");
  assert.equal(ui.get(".session", card).checked, true);
  assert.equal(ui.get(".allow-video-only", card).checked, true);
  assert.equal(ui.get(".technical", card).open, true);
  assert.equal(ui.get(".options", card).classList.contains("hidden"), false);
  assert.match(ui.get(".seen", card).textContent, /네트워크 요청 4회/);
});

test("reopened popup renders persisted running job then completed storage update without local job view", async () => {
  const ui = await mount([], {}, [{ jobId: "existing-job", state: "running", progress: { percent: 20 } }]);
  let job = ui.get(".job");
  assert.equal(ui.get("b", job).textContent, "다운로드 중");
  assert.equal(ui.get("progress", job).value, 20);
  assert.ok(job.querySelector("button"));
  assert.equal(ui.sent.some(message => message.type === "download"), false);
  await ui.change({ downloadJobs: { newValue: [{ jobId: "existing-job", state: "completed", outputPath: "C:\\Downloads\\fixture.mp4" }] } });
  job = ui.get(".job");
  assert.equal(ui.get("b", job).textContent, "완료");
  assert.equal(ui.get("small", job).textContent, "C:\\Downloads\\fixture.mp4");
  assert.equal(ui.get(".job-play_file", job).classList.contains("hidden"), false);
  assert.equal(ui.get(".job-cancel", job).classList.contains("hidden"), true);
});

test("late refresh snapshots cannot overwrite newer storage candidates or completed jobs", async () => {
  let resolveJobs!: (response: unknown) => void;
  let resolveCandidates!: (response: unknown) => void;
  const ui = await mount([], {
    list_jobs: () => new Promise(resolve => { resolveJobs = resolve; }),
    list_candidates: () => new Promise(resolve => { resolveCandidates = resolve; }),
  });
  await ui.change({
    downloadJobs: { newValue: [{ jobId: "existing-job", state: "completed", outputPath: "C:\\Downloads\\finished.mp4" }] },
    mediaCandidatesByTab: { newValue: { "7": [candidate("newer-dash", "https://fixture.test/newer.mpd")] } },
  });
  const freshCard = ui.cards()[0];
  assert.equal(ui.get("b", ui.get(".job")).textContent, "완료");
  assert.equal(ui.get(".url", freshCard).textContent, "https://fixture.test/newer.mpd");
  resolveJobs({ jobs: [{ jobId: "existing-job", state: "running", progress: { percent: 10 } }] });
  resolveCandidates({ candidates: [candidate("older-hls")] });
  await settle();
  const job = ui.get(".job");
  assert.equal(ui.get("b", job).textContent, "완료");
  assert.equal(ui.get("small", job).textContent, "C:\\Downloads\\finished.mp4");
  assert.equal(ui.get(".job-play_file", job).classList.contains("hidden"), false);
  assert.equal(ui.get(".job-cancel", job).classList.contains("hidden"), true);
  assert.equal(ui.cards().length, 1);
  assert.equal(ui.cards()[0], freshCard);
  assert.equal(ui.get(".url", freshCard).textContent, "https://fixture.test/newer.mpd");
});

test("rejected runtime Probe shows friendly error and releases busy controls", async () => {
  let rejectProbe!: (error: Error) => void;
  const ui = await mount([candidate("hls")], {
    probe: () => new Promise((_resolve, reject) => { rejectProbe = reject; }),
  });
  const card = ui.cards()[0];
  const click = ui.get(".probe", card).click();
  assert.equal(ui.get(".probe", card).disabled, true);
  assert.equal(ui.get(".download", card).disabled, true);
  assert.equal(ui.get(".session", card).disabled, true);
  assert.equal(ui.get(".allow-video-only", card).disabled, true);
  rejectProbe(new Error("Could not establish connection. Receiving end does not exist."));
  await click;
  assert.equal(ui.get(".message", card).textContent, "Native Host 연결을 확인하세요.");
  assert.equal(ui.get(".message", card).classList.contains("error"), true);
  assert.equal(ui.get(".technical", card).open, false);
  assert.equal(ui.get(".probe", card).disabled, false);
  assert.equal(ui.get(".download", card).disabled, false);
  assert.equal(ui.get(".session", card).disabled, false);
  assert.equal(ui.get(".allow-video-only", card).disabled, false);
});

test("video-only opt-in is unchecked by default and only forwarded after explicit selection", async () => {
  const ui = await mount([candidate("hls")]);
  const card = ui.cards()[0];
  assert.equal(ui.get(".allow-video-only", card).checked, false);
  await ui.get(".download", card).click();
  ui.get(".allow-video-only", card).checked = true;
  await ui.get(".start", card).click();
  assert.equal(ui.sent.find(message => message.type === "download").options.allowVideoOnly, true);
});

test("Probe shows audio counts and silent video warning outside collapsed technical detail", async () => {
  const ui = await mount([candidate("hls")], {
    probe: () => ({ type: "probe_result", payload: { duration: 8, videoStreams: [{ codec_name: "h264" }], audioStreams: [] } }),
  });
  const card = ui.cards()[0];
  await ui.get(".probe", card).click();
  assert.match(ui.get(".message", card).textContent, /영상 1개 · 음성 0개/);
  assert.match(ui.get(".message", card).textContent, /음성 트랙이 없는 영상/);
  assert.equal(ui.get(".message", card).classList.contains("warning"), true);
  assert.equal(ui.get(".technical", card).open, false);
  assert.equal(ui.get(".allow-video-only", card).checked, false);
});

test("persisted progress renders measurements, phases and validated completion on storage updates", async () => {
  const ui = await mount([], {}, [{ jobId: "active", state: "probing", progress: {} }]);
  let job = ui.get(".job");
  assert.equal(ui.get("b", job).textContent, "미디어 확인 중");
  assert.match(ui.get(".progress-note", job).textContent, /영상·음성 트랙/);
  await ui.change({ downloadJobs: { newValue: [{ jobId: "active", state: "running", progress: { percent: 50, mediaSeconds: 4, totalBytes: 2048, speed: "2x", etaSeconds: 2 } }] } });
  job = ui.get(".job");
  assert.equal(ui.get("progress", job).value, 50);
  assert.match(ui.get(".progress-metrics", job).textContent, /50.0%.*2.0 KiB.*0:04.*2x.*예상 남은 시간 0:02/);
  await ui.change({ downloadJobs: { newValue: [{ jobId: "active", state: "finalizing", progress: { percent: 100, progress: "end" } }] } });
  job = ui.get(".job");
  assert.equal(ui.get("progress", job).value, 99.9);
  assert.match(ui.get("b", job).textContent, /파일 검증/);
  await ui.change({ downloadJobs: { newValue: [{ jobId: "active", state: "completed" }] } });
  job = ui.get(".job");
  assert.equal(ui.get("progress", job).value, 100);
  assert.equal(ui.get("b", job).textContent, "완료");
});

test("unknown duration renders an indeterminate progress bar and honest explanation", async () => {
  const ui = await mount([], {}, [{ jobId: "live", state: "running", progress: { mediaSeconds: 30, totalBytes: 4096 } }]);
  const job = ui.get(".job");
  assert.equal(ui.get("progress", job).value, "", "value must be omitted for indeterminate progress");
  assert.match(ui.get(".progress-note", job).textContent, /아직 전체 길이 정보를 받지 못했습니다/);
  assert.ok(!job.textContent.includes("%"));
});

test("reopened popup derives percentage and ETA from persisted Probe when Host progress omits them", async () => {
  const ui = await mount([], {}, [{ jobId: "probed", state: "running", probe: { duration: 120 }, progress: { mediaSeconds: 30, speed: "2x" } }]);
  const job = ui.get(".job");
  assert.equal(ui.get("progress", job).value, 25);
  assert.match(ui.get(".progress-metrics", job).textContent, /전체 길이 2:00 \(Probe로 확인\).*예상 남은 시간 0:45/);
  assert.equal(job.querySelector(".progress-note"), null);
});

test("popup displays installed Host version warning without disabling FFmpeg-ready HTTP controls", async () => {
  const ui = await mount([candidate("hls")], { health: () => ({ type: "health_result", payload: { ffmpegAvailable: true, hostVersion: "0.1.0" } }) });
  assert.match(ui.get("#health").textContent, /Host v0.1.0.*구버전 Host/);
  assert.equal(ui.get(".download", ui.cards()[0]).disabled, false);
});

test("active card retains worker-verified Probe duration across legacy Host progress events", async () => {
  const ui = await mount([candidate("hls")]);
  const card = ui.cards()[0];
  await ui.get(".start", card).click();
  await ui.change({ downloadJobs: { newValue: [{ jobId: "job-new", state: "running", durationSeconds: 120, durationSource: "probe_hint", progress: { mediaSeconds: 30, speed: "2x" } }] } });
  assert.match(ui.get(".message", card).textContent, /25.0%.*\n?/);
  assert.match(ui.get(".message", card).textContent, /전체 길이 2:00.*예상 남은 시간 0:45/);
  await ui.hostEvent({ type: "job_progress", payload: { jobId: "job-new", mediaSeconds: 60, speed: "2x" } });
  assert.match(ui.get(".message", card).textContent, /50.0%/);
  assert.match(ui.get(".message", card).textContent, /예상 남은 시간 0:30/);
  await ui.hostEvent({ type: "job_progress", payload: { jobId: "job-new", isLive: true, liveConfirmed: true, mediaSeconds: 61, speed: "2x" } });
  assert.match(ui.get(".message", card).textContent, /라이브 스트림으로 확인/);
  assert.ok(!ui.get(".message", card).textContent.includes("%"));
});

test("fresh Host duration and Probe replace cached hint on the active card before storage updates", async () => {
  const ui = await mount([candidate("hls")]);
  const card = ui.cards()[0];
  await ui.get(".start", card).click();
  for (const fresh of [
    { durationSeconds: 90, durationSource: "stream" },
    { probe: { duration: 90, durationSource: "stream", isLive: false } },
  ]) {
    await ui.change({ downloadJobs: { newValue: [{ jobId: "job-new", state: "running", durationSeconds: 120, durationSource: "probe_hint", verifiedProbeDurationSeconds: 120, progress: { durationSeconds: 120, durationSource: "probe_hint", mediaSeconds: 30, percent: 25, etaSeconds: 45, speed: "2x" } }] } });
    await ui.hostEvent({ type: "job_progress", payload: { jobId: "job-new", mediaSeconds: 45, speed: "2x", ...fresh } });
    const message = ui.get(".message", card).textContent;
    assert.match(message, /50.0%/);
    assert.match(message, /전체 길이 1:30 \(스트림 정보로 확인\)/);
    assert.match(message, /예상 남은 시간 0:23/);
    assert.ok(!message.includes("2:00"));
    assert.ok(!message.includes("25.0%"));
    assert.ok(!message.includes("예상 남은 시간 0:45"), "stale ETA must not survive a fresh progress sample");
  }
  await ui.hostEvent({ type: "job_progress", payload: { jobId: "job-new", mediaSeconds: 60, speed: "2x" } });
  assert.match(ui.get(".message", card).textContent, /전체 길이 1:30.*예상 남은 시간 0:15/);
});

test("persisted audio failure is visible even when a destination path was allocated", async () => {
  const ui = await mount([], {}, [{ jobId: "silent", state: "failed", outputPath: "C:\\Downloads\\silent.mp4", errorCode: "audio_stream_missing", errorSummary: "Probe found video only" }]);
  const job = ui.get(".job");
  assert.match(ui.get("small", job).textContent, /음성 트랙이 없는 영상/);
  assert.ok(!ui.get("small", job).textContent.includes("Probe found video only"));
  assert.equal(ui.get(".job-details", job).open, false, "raw details must only appear in a collapsed disclosure");
});

test("auto-title checkbox prefers media title, preserves manual edits and explicitly reenables suggestions", async () => {
  const item = { ...candidate("title"), mediaTitle: "Actual video title" };
  const ui = await mount([item]);
  const card = ui.cards()[0];
  const filename = ui.get(".filename", card);
  const autoTitle = ui.get(".auto-title", card);
  assert.equal(autoTitle.checked, true);
  assert.equal(filename.value, "Actual video title");
  filename.value = "My filename";
  await filename.dispatch("input");
  assert.equal(autoTitle.checked, false);
  await ui.change({ mediaCandidatesByTab: { newValue: { "7": [{ ...item, mediaTitle: "New actual title" }] } } });
  assert.equal(filename.value, "My filename");
  autoTitle.checked = true;
  await autoTitle.dispatch("change");
  assert.equal(filename.value, "New actual title");
  assert.ok(ui.sent.some(message => message.type === "save_preferences" && message.preferences.autoTitle === false));
});

test("late page title fixes download fallback and title checkbox switches custom default", async () => {
  const item = { ...candidate("untitled"), pageTitle: "" };
  const ui = await mount([item], { get_preferences: () => ({ preferences: { defaultFilename: "My recording" } }) });
  const card = ui.cards()[0], filename = ui.get(".filename", card), title = ui.get(".auto-title", card);
  assert.equal(filename.value, "My recording");
  title.checked = true; await title.dispatch("change");
  assert.match(ui.get(".message", card).textContent, /제목을 아직 찾지 못해/);
  await ui.change({ mediaCandidatesByTab: { newValue: { "7": [{ ...item, mediaTitle: "Actual title", pageTitle: "Page title" }] } } });
  assert.equal(filename.value, "Actual title");
  title.checked = false; await title.dispatch("change");
  assert.equal(filename.value, "My recording");
  title.checked = true; await title.dispatch("change");
  assert.equal(filename.value, "Actual title");
  await ui.get(".start", card).click();
  assert.equal(ui.sent.find(m => m.type === "download").options.filename, "Actual title");
});

test("verified audio-video candidate becomes the visible head and other candidates remain selectable", async () => {
  const one = candidate("silent"), two = candidate("sound");
  one.confidenceScore = 99;
  one.probeSummary = { videoCount: 1, audioCount: 0, height: 2160 };
  two.probeSummary = { videoCount: 1, audioCount: 1, height: 1080 };
  const ui = await mount([one, two]);
  const visible = ui.cards().filter(c => !c.classList.contains("hidden"));
  assert.equal(visible.length, 1);
  assert.match(ui.get(".url", visible[0]).textContent, /sound/);
  await ui.get(".candidate-group").click();
  assert.equal(ui.cards().filter(c => !c.classList.contains("hidden")).length, 2);
});

test("candidate thumbnail omits cross-origin credentials and unsafe thumbnails retain fallback", async () => {
  const item = { ...candidate("poster"), thumbnailUrl: "https://fixture.test/poster.jpg", thumbnailSource: "video-poster" as const, probeSummary: { videoCount: 1, audioCount: 1, height: 1080, duration: 8 } };
  const ui = await mount([item]);
  const card = ui.cards()[0];
  const thumbnail = ui.get(".thumbnail", card);
  assert.equal(thumbnail.src, item.thumbnailUrl);
  assert.equal(thumbnail.crossOrigin, "anonymous");
  assert.equal(thumbnail.referrerPolicy, "no-referrer");
  assert.match(ui.get(".media-badges", card).textContent, /1080p.*영상 \+ 음성.*0:08/);
  await ui.change({ mediaCandidatesByTab: { newValue: { "7": [{ ...item, thumbnailUrl: "https://fixture.test/poster.jpg?token=secret" }] } } });
  assert.equal(thumbnail.src, "");
  assert.equal(ui.get(".thumbnail-fallback", card).classList.contains("hidden"), false);
});

test("completed jobs expose playback, file selection and copy without redownloading", async () => {
  const ui = await mount([], {}, [{ jobId: "done", state: "completed", displayTitle: "My video", outputPath: "C:\\Downloads\\my.mp4" }]);
  const row = ui.get(".job");
  assert.equal(ui.get(".job-title", row).textContent, "My video");
  await ui.get(".job-play_file", row).click();
  await ui.get(".job-reveal_file", row).click();
  await ui.get(".job-copy_path", row).click();
  assert.ok(ui.sent.some(message => message.type === "play_file" && message.jobId === "done"));
  assert.ok(ui.sent.some(message => message.type === "reveal_file" && message.jobId === "done"));
  assert.deepEqual(ui.copied, ["C:\\Downloads\\my.mp4"]);
  assert.ok(!ui.sent.some(message => message.type === "download"));
});

test("job rows retain selection and disclosure across progress while active removal is protected", async () => {
  const done = { jobId: "done", state: "completed", outputPath: "C:\\done.mp4" };
  const active = { jobId: "active", state: "running", progress: { percent: 20 } };
  const ui = await mount([], {}, [done, active]);
  const rows = ui.get("#jobs").children.filter(node => node.className === "job");
  const selection = ui.get(".job-select", rows[0]);
  selection.checked = true;
  await selection.dispatch("change");
  ui.get(".job-details", rows[0]).open = true;
  assert.equal(ui.get(".job-select", rows[1]).disabled, true);
  assert.equal(ui.get(".job-remove", rows[1]).classList.contains("hidden"), true);
  await ui.change({ downloadJobs: { newValue: [done, { ...active, progress: { percent: 50 } }] } });
  assert.equal(ui.get("#jobs").children[0], rows[0]);
  assert.equal(ui.get("#jobs").children[1], rows[1]);
  assert.equal(selection.checked, true);
  assert.equal(ui.get(".job-details", rows[0]).open, true);
  assert.equal(ui.get("progress", rows[1]).attributes.get("aria-label"), "다운로드 진행률 (읽기 전용)");
});

test("selected history removal sends terminal IDs only and retains files and active rows", async () => {
  const ui = await mount([], {
    remove_jobs: () => ({ type: "health_result", payload: { removedJobIds: ["done"], rejectedJobIds: [] } }),
  }, [{ jobId: "done", state: "completed", outputPath: "C:\\done.mp4" }, { jobId: "active", state: "running" }]);
  const selectAll = ui.get("#select-jobs"); selectAll.checked = true; await selectAll.dispatch("change");
  await ui.get("#remove-selected").click(); await settle();
  const request = ui.sent.find(message => message.type === "remove_jobs");
  assert.deepEqual(JSON.parse(JSON.stringify(request.jobIds)), ["done"]);
  assert.match(ui.get("#manager-message").textContent, /1개.*영상 파일은 유지/);
  assert.equal(ui.get("#jobs").children.filter(node => node.className === "job").length, 1);
  assert.equal(ui.get("b", ui.get(".job")).textContent, "다운로드 중");
});

test("job filter, list toggle and same-page candidate grouping remain selectable", async () => {
  const ui = await mount([candidate("one"), candidate("two")], {}, [{ jobId: "done", state: "completed", outputPath: "C:\\done.mp4" }, { jobId: "active", state: "running" }]);
  const header = ui.get(".candidate-group"); assert.match(header.textContent, /다른 후보 1개/);
  assert.equal(ui.cards().filter(card => !card.classList.contains("hidden")).length, 1);
  await header.click(); assert.ok(ui.cards().every(card => !card.classList.contains("hidden")));
  await header.click(); assert.equal(ui.cards().filter(card => !card.classList.contains("hidden")).length, 1);
  const filter = ui.get("#job-filter"); filter.value = "active"; await filter.dispatch("change");
  assert.equal(ui.get("#jobs").children[0].classList.contains("hidden"), true);
  assert.equal(ui.get("#jobs").children[1].classList.contains("hidden"), false);
  await ui.get("#jobs-toggle").click();
  assert.equal(ui.get("#jobs-content").classList.contains("hidden"), true);
  assert.equal(ui.get("#jobs-toggle").attributes.get("aria-expanded"), "false");
});

test("duplicate warning requires an explicit new-download choice and offers existing playback", async () => {
  const ui = await mount([candidate("duplicate")], {
    check_duplicate: () => ({ ok: true, jobs: [{ jobId: "done", state: "completed", outputPath: "C:\\existing.mp4" }] }),
  });
  const card = ui.cards()[0];
  await ui.get(".start", card).click();
  assert.ok(!ui.sent.some(message => message.type === "download"));
  assert.equal(ui.get(".duplicate-warning", card).classList.contains("hidden"), false);
  await ui.get(".duplicate-play", card).click();
  assert.ok(ui.sent.some(message => message.type === "play_file" && message.jobId === "done"));
  await ui.get(".duplicate-continue", card).click(); await settle();
  assert.equal(ui.sent.filter(message => message.type === "download").length, 1);
});

test("job right-click and keyboard-accessible command button use the same actions", async () => {
  const ui = await mount([], {}, [{ jobId: "done", state: "completed", outputPath: "C:\\done.mp4" }]);
  const row = ui.get(".job");
  await row.dispatch("contextmenu", { clientX: 30, clientY: 40 });
  const menu = ui.get("#job-menu");
  assert.equal(menu.classList.contains("hidden"), false);
  assert.match(menu.textContent, /재생.*폴더에서 선택.*경로 복사.*목록에서 제거/);
  await menu.children[0].click();
  assert.ok(ui.sent.some(message => message.type === "play_file"));
  await ui.get(".job-menu-button", row).click();
  assert.equal(menu.classList.contains("hidden"), false);
  await ui.document.dispatch("keydown", { key: "Escape" });
  assert.equal(menu.classList.contains("hidden"), true);
});

test("switch view forwards tab ID and persists sidebar preference", async () => {
  const ui = await mount([]);
  await ui.get("#switch-view").click();
  assert.ok(ui.sent.some(message => message.type === "open_sidepanel" && message.tabId === 7));
  assert.ok(ui.sent.some(message => message.type === "save_preferences" && message.preferences.viewMode === "sidepanel"));
});

test("legacy Host keeps baseline downloads but disables unsupported file manager commands", async () => {
  const ui = await mount([candidate("hls")], { health: () => ({ type: "health_result", payload: { ffmpegAvailable: true, hostVersion: "0.1.2" } }) }, [{ jobId: "done", state: "completed", outputPath: "C:\\done.mp4" }]);
  assert.equal(ui.get(".download", ui.cards()[0]).disabled, false);
  assert.equal(ui.get(".job-play_file").disabled, true);
  assert.equal(ui.get(".job-remove").disabled, true);
  assert.equal(ui.get(".job-copy_path").disabled, false);
  assert.match(ui.get("#health").textContent, /파일 관리 기능에는 Host v0.2.0/);
});

test("saved history thumbnail keeps anonymous policy and missing images use a placeholder", async () => {
  const ui = await mount([], {}, [{ jobId: "done", state: "completed", outputPath: "C:\\done.mp4", thumbnailUrl: "https://fixture.test/poster.jpg" }]);
  const thumbnail = ui.get(".job-thumb");
  assert.equal(thumbnail.src, "https://fixture.test/poster.jpg");
  assert.equal(thumbnail.crossOrigin, "anonymous");
  assert.equal(thumbnail.referrerPolicy, "no-referrer");
  await ui.change({ downloadJobs: { newValue: [{ jobId: "done", state: "completed", outputPath: "C:\\done.mp4" }] } });
  assert.equal(thumbnail.classList.contains("hidden"), true);
  assert.equal(ui.get(".job-thumb-placeholder").classList.contains("hidden"), false);
});
