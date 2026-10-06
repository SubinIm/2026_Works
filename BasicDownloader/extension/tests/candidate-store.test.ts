import test from "node:test";
import assert from "node:assert/strict";
import { CandidateStore } from "../src/background/candidate-store.ts";
import { detectCandidate } from "../src/background/candidate-detector.ts";

function mockStorage() {
  const original = globalThis.chrome;
  let saved: Record<string, unknown> = {};
  let failWrite = false;
  const delay = () => new Promise(resolve => setTimeout(resolve, 1));
  globalThis.chrome = {
    storage: {
      local: { get: async () => ({}) },
      session: {
        get: async (key: string) => {
          // Capture before yielding, as independent Chrome storage calls can do.
          const snapshot = structuredClone({ [key]: saved[key] });
          await delay();
          return snapshot;
        },
        set: async (value: Record<string, unknown>) => {
          await delay();
          if (failWrite) { failWrite = false; throw new Error("storage failure"); }
          saved = { ...saved, ...structuredClone(value) };
        },
      },
    },
  } as typeof chrome;
  return {
    snapshot: () => structuredClone(saved),
    failNextWrite: () => { failWrite = true; },
    restore: () => { globalThis.chrome = original; },
  };
}

test("MIME-only network candidates receive page title and thumbnail before or after detection", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore();
    const first = detectCandidate({ url: "https://media.test/api/manifest/hls/id/1", contentType: "application/vnd.apple.mpegurl", tabId: 1 })!;
    await store.upsert(first);
    await store.updatePageMetadata(1, "https://page.test/watch?v=one", "Current video", { mediaTitle: "Real title", thumbnailUrl: "https://images.test/poster.jpg", thumbnailSource: "page-image" });
    const enriched = (await store.list(1))[0];
    assert.equal(enriched.mediaTitle, "Real title");
    assert.equal(enriched.pageTitle, "Current video");
    assert.equal(enriched.thumbnailUrl, "https://images.test/poster.jpg");
    assert.equal(enriched.pageUrl, "https://page.test/watch?v=one");
    await store.upsert(detectCandidate({ url: "https://media.test/second.mpd", tabId: 1 })!);
    assert.ok((await store.list(1)).every(c => c.mediaTitle === "Real title"));
    await store.updatePageMetadata(1, "https://page.test/watch?v=two", "Other video", { mediaTitle: "Other title" });
    assert.ok((await store.list(1)).every(c => c.mediaTitle === "Real title"), "SPA navigation must not relabel old candidates");
    await store.upsert(detectCandidate({ url: "https://media.test/third.mp4", tabId: 1 })!);
    assert.equal((await store.list(1)).find(c => c.url.endsWith("third.mp4"))?.mediaTitle, "Other title");
    assert.equal((await store.list(2)).length, 0);
  } finally { storage.restore(); }
});

test("page enrichment preserves video-specific metadata and rejects signed thumbnails", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore();
    await store.upsert(detectCandidate({url:"https://media.test/v.mp4",tabId:1,mediaTitle:"Specific",metadataSource:"video",thumbnailUrl:"https://images.test/video.jpg",thumbnailSource:"video-poster"})!);
    await store.updatePageMetadata(1,"https://page.test/watch","Page",{mediaTitle:"Page",thumbnailUrl:"https://images.test/private.jpg?token=SECRET",thumbnailSource:"page-image"});
    const item=(await store.list(1))[0];
    assert.equal(item.mediaTitle,"Specific");
    assert.equal(item.thumbnailUrl,"https://images.test/video.jpg");
    assert.doesNotMatch(JSON.stringify(storage.snapshot()),/SECRET/);
  } finally { storage.restore(); }
});

test("overlapping network and DOM updates retain every entry and exact request count", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore();
    const updates: Promise<unknown>[] = [];
    for (let i = 0; i < 12; i++) {
      updates.push(store.upsert(detectCandidate({ url: "https://x/master.m3u8", tabId: 1, timestamp: i })!));
      updates.push(store.upsert(detectCandidate({ url: "https://x/master.m3u8", tabId: 1, source: "video-element", pageTitle: "Player", timestamp: i })!));
      updates.push(store.upsert(detectCandidate({ url: `https://x/${i}.mp4`, tabId: 2, timestamp: i })!));
    }
    await Promise.all(updates);
    const manifest = (await store.list(1))[0]!;
    assert.equal(manifest.requestCount, 12);
    assert.equal(manifest.pageTitle, "Player");
    assert.equal((await store.list(2)).length, 12);
    await Promise.all(Array.from({ length: 8 }, () => store.addSegmentEvidence(1)));
    assert.equal((await store.list(1))[0]!.segmentEvidenceCount, 8);
  } finally { storage.restore(); }
});

test("list and clear wait for already queued mutations", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore();
    const candidate = detectCandidate({ url: "https://x/a.mpd", tabId: 1 })!;
    const inserting = store.upsert(candidate);
    assert.equal((await store.list(1)).length, 1);
    await inserting;
    const pending = store.upsert(detectCandidate({ url: "https://x/b.mp4", tabId: 1 })!);
    const clearing = store.clear(1);
    await Promise.all([pending, clearing]);
    assert.deepEqual(await store.list(1), []);
  } finally { storage.restore(); }
});

test("signed originals remain exact in memory and are removed on eviction or clear", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore(1);
    const raw = "https://x/a.m3u8?token=keep%2Bexact%2fbytes&quality=hd";
    const first = await store.upsert(detectCandidate({ url: raw, tabId: 1, timestamp: 1 })!);
    assert.equal(store.resolveUrl(first), raw);
    assert.ok(!JSON.stringify(storage.snapshot()).includes("keep"));
    assert.match(first.url, /REDACTED/);
    const secondRaw = "https://x/b.mpd?token=second-secret";
    const second = await store.upsert(detectCandidate({ url: secondRaw, tabId: 1, timestamp: 2 })!);
    assert.equal(store.resolveUrl(first), undefined);
    assert.equal(store.resolveUrl(second), secondRaw);
    await store.clear(1);
    assert.equal(store.resolveUrl(second), undefined);
  } finally { storage.restore(); }
});

test("a failed storage mutation rejects its caller without poisoning later updates", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore();
    storage.failNextWrite();
    const first = detectCandidate({ url: "https://x/a.m3u8?token=failed-secret", tabId: 1 })!;
    await assert.rejects(store.upsert(first), /storage failure/);
    assert.equal(store.resolveUrl(first), undefined);
    await store.upsert(detectCandidate({ url: "https://x/b.mp4", tabId: 1 })!);
    assert.equal((await store.list(1)).length, 1);
  } finally { storage.restore(); }
});

test("storage sanitizes untrusted thumbnail metadata and keeps video-specific enrichment", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore();
    const candidate = detectCandidate({ url: "https://cdn.test/video.mp4", tabId: 1 })!;
    await store.upsert({ ...candidate, thumbnailUrl: "https://cdn.test/cover.jpg?unknown-key=plain-secret", thumbnailSource: "video-poster", mediaTitle: " Video\nTitle ", metadataSource: "video" });
    assert.ok(!JSON.stringify(storage.snapshot()).includes("plain-secret"));
    assert.equal((await store.list(1))[0].thumbnailUrl, undefined);
    await store.upsert({ ...candidate, thumbnailUrl: "https://cdn.test/video.jpg", thumbnailSource: "video-poster" });
    await store.upsert({ ...candidate, mediaTitle: "Page title", metadataSource: "page", thumbnailUrl: "https://cdn.test/page.jpg", thumbnailSource: "page-image" });
    const stored = (await store.list(1))[0];
    assert.equal(stored.mediaTitle, "Video Title");
    assert.equal(stored.thumbnailSource, "video-poster");
    assert.equal(stored.thumbnailUrl, "https://cdn.test/video.jpg");
  } finally { storage.restore(); }
});

test("an in-flight Probe cannot resurrect a cleared candidate or its signed original", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore();
    const raw = "https://cdn.test/master.m3u8?token=original-secret";
    const candidate = await store.upsert(detectCandidate({ url: raw, tabId: 1 })!);
    let finishProbe!: (value: { duration: number; videoCount: number; audioCount: number }) => void;
    const inFlight = new Promise<{ duration: number; videoCount: number; audioCount: number }>(resolve => { finishProbe = resolve; })
      .then(summary => store.updateProbeSummary(1, candidate.id, summary));
    const clearing = store.clear(1);
    finishProbe({ duration: 120, videoCount: 1, audioCount: 1 });
    assert.equal(await inFlight, false);
    await clearing;
    assert.deepEqual(await store.list(1), []);
    assert.equal(store.resolveUrl(candidate), undefined);
    assert.ok(!JSON.stringify(storage.snapshot()).includes("original-secret"));
  } finally { storage.restore(); }
});

test("Probe summary updates preserve newer metadata, sightings, and exact signed URL bytes", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore();
    const raw = "https://cdn.test/master.m3u8?token=exact%2Bsecret%2fbytes&quality=hd";
    const candidate = await store.upsert(detectCandidate({ url: raw, tabId: 1, timestamp: 1, mediaTitle: "Earlier title", metadataSource: "video" })!);
    const refreshed = store.upsert(detectCandidate({ url: raw, tabId: 1, timestamp: 20, pageTitle: "Newer page", mediaTitle: "Newer title", metadataSource: "video", thumbnailUrl: "https://images.test/new.jpg", thumbnailSource: "video-poster" })!);
    const summary = { duration: 120, videoCount: 1, audioCount: 1, width: 1920, height: 1080 };
    const updated = store.updateProbeSummary(1, candidate.id, summary);
    const before = await refreshed;
    assert.equal(await updated, true);
    const actual = (await store.list(1))[0];
    assert.deepEqual(actual, { ...before, probeSummary: summary });
    assert.equal(actual.mediaTitle, "Newer title");
    assert.equal(actual.thumbnailUrl, "https://images.test/new.jpg");
    assert.equal(actual.lastSeenAt, 20);
    assert.equal(actual.requestCount, 2);
    assert.equal(store.resolveUrl(actual), raw);
    assert.ok(!JSON.stringify(storage.snapshot()).includes("exact"));
  } finally { storage.restore(); }
});

test("Probe updates are existing-row-only and cannot reinsert evicted or wrong-tab candidates", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore(1);
    const evicted = await store.upsert(detectCandidate({ url: "https://cdn.test/old.mp4", tabId: 1, timestamp: 1 })!);
    const retained = await store.upsert(detectCandidate({ url: "https://cdn.test/new.mp4", tabId: 1, timestamp: 2 })!);
    const before = storage.snapshot();
    assert.equal(await store.updateProbeSummary(1, evicted.id, { videoCount: 1, audioCount: 0 }), false);
    assert.equal(await store.updateProbeSummary(2, retained.id, { videoCount: 1, audioCount: 1 }), false);
    assert.deepEqual(storage.snapshot(), before);
  } finally { storage.restore(); }
});

test("invalid Probe summaries do not replace valid metadata and numeric extras are sanitized", async () => {
  const storage = mockStorage();
  try {
    const store = new CandidateStore();
    const candidate = await store.upsert(detectCandidate({ url: "https://cdn.test/video.mp4", tabId: 1 })!);
    const summary = { duration: 120, videoCount: 1, audioCount: 1 };
    assert.equal(await store.updateProbeSummary(1, candidate.id, summary), true);
    assert.equal(await store.updateProbeSummary(1, candidate.id, { videoCount: -1, audioCount: 0 }), false);
    assert.deepEqual((await store.list(1))[0].probeSummary, summary);
    assert.equal(await store.updateProbeSummary(1, candidate.id, { duration: Infinity, videoCount: 1, audioCount: 1, width: NaN, height: -10 }), true);
    assert.deepEqual((await store.list(1))[0].probeSummary, { videoCount: 1, audioCount: 1 });
  } finally { storage.restore(); }
});
