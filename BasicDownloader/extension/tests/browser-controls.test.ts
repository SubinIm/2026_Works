import test from "node:test";
import assert from "node:assert/strict";
import { normalizePreferences, DEFAULT_PREFERENCES } from "../src/shared/preferences.ts";
import { configureView, getPreferences, savePreferences, openSidePanel, openPopup, initializeBrowserControls, notifyJob } from "../src/background/browser-controls.ts";
import { sourceIdentity, summarizeProbe } from "../src/background/job-metadata.ts";

test("preferences only accept typed fields and safe filename templates", () => {
  assert.deepEqual(normalizePreferences(null), DEFAULT_PREFERENCES);
  const p = normalizePreferences({ autoTitle: "no", viewMode: "bad", filenameTemplate: "../{title}", notifyOnComplete: true, secret: "hidden" });
  assert.equal(p.autoTitle, true);
  assert.equal(p.filenameTemplate, "{title}");
  assert.equal(p.viewMode, "popup");
  assert.equal(p.notifyOnComplete, true);
  assert.ok(!("secret" in p));
  assert.equal(normalizePreferences({ filenameTemplate: "{title} [{quality}] {date}" }).filenameTemplate, "{title} [{quality}] {date}");
  assert.equal(normalizePreferences({ filenameTemplate: "{cookie}" }).filenameTemplate, "{title}");
  assert.equal(normalizePreferences({ defaultFilename: "My clip", autoProbe: true }).defaultFilename, "My clip");
  assert.equal(normalizePreferences({ autoProbe: true }).autoProbe, true);
  assert.equal(normalizePreferences({ autoProbe: "true" }).autoProbe, false);
  for (const name of ["", "CON", "../bad", "a/b", "a?b", "x".repeat(121)]) {
    assert.equal(normalizePreferences({ defaultFilename: name }).defaultFilename, "download");
  }
});

test("source identity stores only a digest and summaries never preserve probe tags/URLs", async () => {
  const a = await sourceIdentity("https://x/v.m3u8?token=SECRET&v=1");
  assert.equal(a, await sourceIdentity("https://x/v.m3u8?v=1&token=SECRET"));
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, await sourceIdentity("https://x/v.m3u8?v=1&token=NEW"));
  const summary = summarizeProbe({ type: "probe_result", payload: { duration: 20, selectedStreamIndices: [2, 3], videoStreams: [{ index: 1, width: 320, height: 240 }, { index: 2, width: 1920, height: 1080, tags: { token: "SECRET" } }], audioStreams: [{ index: 3 }], url: "https://secret" } });
  assert.deepEqual(summary, { duration: 20, videoCount: 1, audioCount: 1, width: 1920, height: 1080 });
  assert.doesNotMatch(JSON.stringify(summary), /SECRET|https|token/);
  assert.equal(summarizeProbe({ type: "protocol_error" }), undefined);
  assert.equal(summarizeProbe({type:"probe_result",payload:{selectedStreamIndices:[0],videoStreams:[{index:0}],audioStreams:[{index:1}]}})?.audioCount,0,"unlinked HLS audio must not claim sound in the selected rendition");
});

test("browser controls serialize preferences, configure both modes and do not auto-download", async () => {
  const original = globalThis.chrome;
  const data: Record<string, any> = {}, calls: any[] = [], menuListeners: Function[] = [], menus: any[] = [];
  globalThis.chrome = {
    storage: { local: { get: async (key: string) => ({ [key]: structuredClone(data[key]) }), set: async (values: any) => { Object.assign(data, structuredClone(values)); } } },
    action: { setPopup: async (value: any) => { calls.push(["popup", value]); }, openPopup: async () => { calls.push(["open-popup"]); } },
    sidePanel: { setPanelBehavior: async (value: any) => { calls.push(["behavior", value]); }, open: async (value: any) => { calls.push(["open-side", value]); } },
    contextMenus: { onClicked: { addListener: (callback: Function) => menuListeners.push(callback) }, removeAll: async () => {}, create: (value: any) => menus.push(value) },
    runtime: { getURL: (value: string) => `chrome-extension://id/${value}` },
    notifications: { create: async (...values: any[]) => { calls.push(["notify", ...values]); } },
  } as unknown as typeof chrome;
  try {
    await Promise.all([savePreferences({ viewMode: "sidepanel" }), savePreferences({ autoTitle: false })]);
    assert.equal((await getPreferences()).viewMode, "sidepanel");
    assert.equal((await getPreferences()).autoTitle, false);
    assert.ok(calls.some(c => c[0] === "popup" && c[1].popup === ""));
    assert.ok(calls.some(c => c[0] === "behavior" && c[1].openPanelOnActionClick === true));
    const open = openSidePanel(7);
    assert.deepEqual(calls.at(-1), ["open-side", { tabId: 7 }], "open invoked without awaiting storage/query first");
    await open;
    await assert.rejects(openSidePanel(-1));
    await openPopup();
    assert.equal((await getPreferences()).viewMode, "popup");
    assert.equal(calls.at(-1)[0], "open-popup");
    initializeBrowserControls();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(menus.length, 2);
    assert.ok(menus.every(menu => menu.documentUrlPatterns.includes("https://*/*")));
    menuListeners[0]({ menuItemId: "stream-candidates", srcUrl: "blob:https://x/internal" }, { id: 12 });
    assert.deepEqual(calls.at(-1), ["open-side", { tabId: 12 }]);
    await notifyJob({ jobId: "x", state: "completed", displayTitle: "SECRET" }, "running");
    assert.ok(!calls.some(c => c[0] === "notify"), "notifications default off");
    await savePreferences({ notifyOnComplete: true });
    await notifyJob({ jobId: "x", state: "completed", displayTitle: "SECRET" }, "running");
    await notifyJob({ jobId: "x", state: "completed" }, "completed");
    assert.equal(calls.filter(c => c[0] === "notify").length, 1);
    assert.doesNotMatch(JSON.stringify(calls.filter(c => c[0] === "notify")), /SECRET/);
    await configureView(DEFAULT_PREFERENCES);
  } finally { globalThis.chrome = original; }
});
