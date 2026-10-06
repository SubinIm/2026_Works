import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";

// Run the real content entry point, with deterministic DOM and scheduler inputs.
const observerCode = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/content/media-observer.ts", import.meta.url))],
  bundle: true, write: false, platform: "browser", format: "iife",
}).outputFiles[0].text;

type SendMode = "ok" | "sync-invalid" | "async-invalid" | "transient";
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };

function mount(options: {
  valid?: boolean;
  idThrows?: boolean;
  mode?: SendMode;
  runtimeMissing?: boolean;
  chromeMissing?: boolean;
  runtimeDisappearsAfterGuard?: boolean;
  media?: { url: string; attributes?: Record<string, string> }[];
  metadata?: Record<string, string>;
  resources?: string[];
} = {}) {
  let valid = options.valid ?? true;
  let mode = options.mode ?? "ok";
  const sent: any[] = [];
  const timers = new Map<number, () => void>();
  const observers: { callback: () => void; connected: boolean }[] = [];
  let intervalCalls = 0;
  let clearCalls = 0;
  let disconnectCalls = 0;
  const runtime = {
    get id() {
      if (options.idThrows) throw new Error("Extension context invalidated.");
      if (options.runtimeDisappearsAfterGuard) chromeApi.runtime = undefined;
      return valid ? "fixture-extension-id" : undefined;
    },
    sendMessage(message: unknown) {
      sent.push(message);
      if (mode === "sync-invalid") throw new Error("Extension context invalidated.");
      if (mode === "async-invalid") return Promise.reject(new Error("Extension context invalidated."));
      if (mode === "transient") return Promise.reject(new Error("Could not establish connection. Receiving end does not exist."));
      return Promise.resolve();
    },
  };
  const chromeApi: { runtime: typeof runtime | undefined } = {
    runtime: options.runtimeMissing ? undefined : runtime,
  };
  class FakeMutationObserver {
    record: { callback: () => void; connected: boolean };
    constructor(callback: () => void) {
      this.record = { callback, connected: false };
      observers.push(this.record);
    }
    observe() { this.record.connected = true; }
    disconnect() { this.record.connected = false; disconnectCalls++; }
  }
  runInNewContext(observerCode, {
    ...(options.chromeMissing ? {} : { chrome: chromeApi }),
    document: {
      title: "Fixture player", referrer: "", documentElement: {},
      querySelector: (selector: string) => options.metadata?.[selector] ? { content: options.metadata[selector] } : null,
      querySelectorAll: () => (options.media ?? [{ url: "http://127.0.0.1:8765/generated/direct.mp4" }]).map(item => ({
        currentSrc: item.url, src: "", getAttribute: (name: string) => item.attributes?.[name] ?? null,
      })),
    },
    performance: {
      getEntriesByType: () => (options.resources ?? [
        "http://127.0.0.1:8765/generated/stream.m3u8",
        "http://127.0.0.1:8765/generated/stream.mpd",
        "http://127.0.0.1:8765/generated/hls-000.ts",
        "http://127.0.0.1:8765/generated/dash-chunk-0-00001.m4s",
      ]).map(name => ({ name })),
    },
    URL,
    location: { href: "http://127.0.0.1:8765/player/" },
    navigator: { userAgent: "Fixture browser" },
    MutationObserver: FakeMutationObserver,
    setInterval: (callback: () => void, milliseconds: number) => {
      assert.equal(milliseconds, 5000);
      const id = ++intervalCalls;
      timers.set(id, callback);
      return id;
    },
    clearInterval: (id: number) => { clearCalls++; timers.delete(id); },
  });
  return {
    sent, timers, observers,
    setMode(next: SendMode) { mode = next; },
    invalidate() { valid = false; },
    removeRuntime() { chromeApi.runtime = undefined; },
    tick() { for (const callback of [...timers.values()]) callback(); },
    mutate() { for (const observer of observers) if (observer.connected) observer.callback(); },
    counts: () => ({ intervalCalls, clearCalls, disconnectCalls }),
  };
}

test("content observer continues collecting MP4, HLS and DASH without segment candidates", async () => {
  const fixture = mount();
  await settle();
  assert.equal(fixture.sent.length, 1);
  const message = fixture.sent[0];
  assert.equal(message.type, "content_candidates");
  assert.equal(message.pageUrl, "http://127.0.0.1:8765/player/");
  assert.equal(message.pageTitle, "Fixture player");
  assert.deepEqual(Array.from(message.items, (item: any) => item.url), [
    "http://127.0.0.1:8765/generated/direct.mp4",
    "http://127.0.0.1:8765/generated/stream.m3u8",
    "http://127.0.0.1:8765/generated/stream.mpd",
  ]);
  fixture.tick();
  fixture.mutate();
  await settle();
  assert.equal(fixture.sent.length, 3);
  assert.equal(fixture.timers.size, 1);
  assert.equal(fixture.observers[0].connected, true);
});

test("synchronous invalidation stops the timer and observer without an uncaught exception", async () => {
  const fixture = mount();
  const queuedTimer = [...fixture.timers.values()][0];
  const queuedMutation = fixture.observers[0].callback;
  fixture.setMode("sync-invalid");
  assert.doesNotThrow(() => fixture.tick());
  assert.equal(fixture.sent.length, 2);
  assert.deepEqual(fixture.counts(), { intervalCalls: 1, clearCalls: 1, disconnectCalls: 1 });
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.observers[0].connected, false);
  // Already queued callbacks must not send again after cleanup.
  queuedTimer();
  queuedMutation();
  await settle();
  assert.equal(fixture.sent.length, 2);
});

test("asynchronous invalidation also tears down observation and the recurring scan", async () => {
  const fixture = mount({ mode: "async-invalid" });
  await settle();
  assert.deepEqual(fixture.counts(), { intervalCalls: 1, clearCalls: 1, disconnectCalls: 1 });
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.observers[0].connected, false);
  fixture.tick();
  fixture.mutate();
  assert.equal(fixture.sent.length, 1);
});

test("an initially missing or throwing runtime never starts a timer or observer", () => {
  for (const options of [{ valid: false }, { idThrows: true }]) {
    const fixture = mount(options);
    assert.equal(fixture.sent.length, 0);
    assert.equal(fixture.observers.length, 0);
    assert.deepEqual(fixture.counts(), { intervalCalls: 0, clearCalls: 0, disconnectCalls: 0 });
  }
});

test("an undefined runtime object never sends or starts observation", () => {
  const fixture = mount({ runtimeMissing: true });
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.observers.length, 0);
  assert.deepEqual(fixture.counts(), { intervalCalls: 0, clearCalls: 0, disconnectCalls: 0 });
});

test("an unavailable chrome global never sends or starts observation", () => {
  const fixture = mount({ chromeMissing: true });
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.observers.length, 0);
  assert.deepEqual(fixture.counts(), { intervalCalls: 0, clearCalls: 0, disconnectCalls: 0 });
});

test("runtime loss after mounting stops both callbacks before another send", async () => {
  const fixture = mount();
  const queuedTimer = [...fixture.timers.values()][0];
  const queuedMutation = fixture.observers[0].callback;
  fixture.removeRuntime();
  assert.doesNotThrow(() => fixture.mutate());
  assert.deepEqual(fixture.counts(), { intervalCalls: 1, clearCalls: 1, disconnectCalls: 1 });
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.observers[0].connected, false);
  assert.doesNotThrow(queuedTimer);
  assert.doesNotThrow(queuedMutation);
  await settle();
  assert.equal(fixture.sent.length, 1);
});

test("runtime disappearance between its guard and send is caught without starting observation", () => {
  const fixture = mount({ runtimeDisappearsAfterGuard: true });
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.observers.length, 0);
  assert.deepEqual(fixture.counts(), { intervalCalls: 0, clearCalls: 0, disconnectCalls: 0 });
});

test("synchronous invalidation on the initial send never starts observation", () => {
  const fixture = mount({ mode: "sync-invalid" });
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.observers.length, 0);
  assert.deepEqual(fixture.counts(), { intervalCalls: 0, clearCalls: 0, disconnectCalls: 0 });
});

test("loss of runtime id stops scanning before another send", async () => {
  const fixture = mount();
  fixture.invalidate();
  fixture.tick();
  await settle();
  assert.equal(fixture.sent.length, 1);
  assert.deepEqual(fixture.counts(), { intervalCalls: 1, clearCalls: 1, disconnectCalls: 1 });
});

test("a temporary missing receiver keeps observation alive and can recover", async () => {
  const fixture = mount({ mode: "transient" });
  await settle();
  assert.equal(fixture.timers.size, 1);
  assert.equal(fixture.observers[0].connected, true);
  assert.deepEqual(fixture.counts(), { intervalCalls: 1, clearCalls: 0, disconnectCalls: 0 });
  fixture.setMode("ok");
  fixture.tick();
  fixture.mutate();
  await settle();
  assert.equal(fixture.sent.length, 3);
});

test("multiple video elements retain their own labels and posters above page metadata", () => {
  const fixture = mount({
    media: [
      { url: "https://media.test/first.mp4", attributes: { "aria-label": " First clip ", title: "Less specific", poster: "/images/first.jpg" } },
      { url: "https://media.test/second.mp4", attributes: { title: "Second clip", poster: "https://media.test/second.jpg" } },
    ],
    metadata: { 'meta[property="og:title"]': "Page collection", 'meta[property="og:image"]': "/images/page.jpg" },
    resources: ["https://media.test/first.mp4", "https://media.test/stream.m3u8"],
  });
  const [first, second, manifest] = fixture.sent[0].items;
  assert.equal(first.mediaTitle, "First clip");
  assert.equal(first.metadataSource, "video");
  assert.equal(first.thumbnailUrl, "http://127.0.0.1:8765/images/first.jpg");
  assert.equal(first.thumbnailSource, "video-poster");
  assert.equal(first.source, "video-element", "a resource duplicate must not replace element metadata");
  assert.equal(second.mediaTitle, "Second clip");
  assert.equal(second.thumbnailUrl, "https://media.test/second.jpg");
  assert.equal(manifest.mediaTitle, "Page collection");
  assert.equal(manifest.metadataSource, "page");
  assert.equal(manifest.thumbnailSource, "page-image");
});

test("page image fallback is labeled and unsafe posters or image queries are never sent", () => {
  for (const poster of ["blob:https://media.test/id", "data:image/png;base64,secret", "file:///C:/private.jpg", "https://media.test/poster.jpg?token=secret", "https://media.test/poster.jpg#secret", "https://user:secret@media.test/poster.jpg"]) {
    const fixture = mount({
      media: [{ url: "https://media.test/video.mp4", attributes: { poster } }],
      metadata: { 'meta[property="og:image"]': "https://media.test/page.jpg?signature=secret", 'meta[name="twitter:image"]': "../images/safe.jpg" },
      resources: [],
    });
    const item = fixture.sent[0].items[0];
    assert.equal(item.mediaTitle, "Fixture player");
    assert.equal(item.metadataSource, "page");
    assert.equal(item.thumbnailUrl, "http://127.0.0.1:8765/images/safe.jpg");
    assert.equal(item.thumbnailSource, "page-image");
    assert.ok(!JSON.stringify(fixture.sent).includes("secret"));
  }
});

test("unlabeled duplicate elements do not erase specific media metadata", () => {
  const fixture = mount({
    media: [
      { url: "https://media.test/video.mp4", attributes: { title: "Video title", poster: "/poster.jpg" } },
      { url: "https://media.test/video.mp4" },
    ], resources: [],
  });
  assert.equal(fixture.sent[0].items.length, 1);
  assert.equal(fixture.sent[0].items[0].mediaTitle, "Video title");
  assert.equal(fixture.sent[0].items[0].thumbnailSource, "video-poster");
});

test("metadata collection still stops cleanly after runtime invalidation", async () => {
  const fixture = mount({ metadata: { 'meta[property="og:image"]': "/poster.jpg" } });
  assert.equal(fixture.sent[0].items[0].thumbnailSource, "page-image");
  fixture.invalidate();
  fixture.mutate();
  fixture.tick();
  await settle();
  assert.equal(fixture.sent.length, 1);
  assert.deepEqual(fixture.counts(), { intervalCalls: 1, clearCalls: 1, disconnectCalls: 1 });
});

test("page metadata is sent even when MIME-only manifests are absent from DOM resource detection", () => {
  const fixture = mount({ media: [], resources: ["https://media.test/api/manifest/hls/id/1"], metadata: {
    'meta[property="og:title"]': "Actual music title",
    'meta[itemprop="thumbnailUrl"]': "https://images.test/poster.jpg",
  } });
  assert.equal(fixture.sent[0].items.length, 0);
  assert.equal(fixture.sent[0].pageMetadata.mediaTitle, "Actual music title");
  assert.equal(fixture.sent[0].pageMetadata.thumbnailUrl, "https://images.test/poster.jpg");
});
