import test from "node:test";import assert from "node:assert/strict";import {detectCandidate} from "../src/background/candidate-detector.ts";import {scoreCandidate} from "../src/background/candidate-scorer.ts";import {validEnvelope} from "../src/shared/messages.ts";
import {mergeCandidateList,prepareCandidateForStorage} from "../src/background/candidate-store.ts";
test("segments are not candidates",()=>assert.equal(detectCandidate({url:"https://x/1.ts",tabId:1}),null));
test("manifest candidates score and ads are demoted",()=>{const good=detectCandidate({url:"https://x/master.m3u8",contentType:"application/vnd.apple.mpegurl",tabId:1,pageUrl:"https://x/"})!;const ad=detectCandidate({url:"https://x/ads/master.m3u8",tabId:1})!;assert.ok(scoreCandidate(good)>scoreCandidate(ad));});
test("message schema",()=>{assert.equal(validEnvelope({protocolVersion:1,messageId:"x",type:"health_result",payload:{}}),true);assert.equal(validEnvelope({protocolVersion:2,messageId:"x",type:"health_result",payload:{}}),false);assert.equal(validEnvelope({protocolVersion:1,messageId:"x",type:"mystery",payload:{}}),false);});
test("canonical duplicate is merged",()=>{const first=detectCandidate({url:"https://x/a.m3u8?quality=hd",tabId:1,timestamp:1})!,second=detectCandidate({url:"https://x/a.m3u8?quality=hd",tabId:1,timestamp:2})!;const merged=mergeCandidateList([first],second);assert.equal(merged.items.length,1);assert.equal(merged.candidate.requestCount,2);});
test("signed URL token is absent from persisted and UI candidate",()=>{const raw="https://x/a.m3u8?token=plain-secret&quality=hd",candidate=detectCandidate({url:raw,tabId:1})!,prepared=prepareCandidateForStorage(candidate);assert.equal(prepared.sensitiveUrl,raw);assert.ok(!JSON.stringify(prepared.candidate).includes("plain-secret"));assert.match(prepared.candidate.canonicalUrl,/^signed:/);});

test("repeated DOM and performance sightings do not count as network requests", () => {
  const url = "https://x/master.m3u8";
  let items = [detectCandidate({ url, tabId: 1, timestamp: 1 })!];
  for (let i = 0; i < 20; i++) {
    const sighting = detectCandidate({ url, tabId: 1, source: i % 2 ? "video-element" : "performance-entry", timestamp: i + 2 })!;
    assert.equal(sighting.requestCount, 0);
    items = mergeCandidateList(items, sighting).items;
  }
  assert.equal(items.length, 1);
  assert.equal(items[0]!.requestCount, 1);
  assert.equal(items[0]!.lastSeenAt, 21);
});

test("DOM metadata enriches a network candidate without weakening MIME evidence", () => {
  const url = "https://cdn.example/playlist.m3u8";
  const network = detectCandidate({ url, tabId: 1, contentType: "application/vnd.apple.mpegurl", timestamp: 1 })!;
  const dom = detectCandidate({ url, tabId: 1, source: "video-element", pageUrl: "https://example/watch", pageTitle: "Fixture player", timestamp: 2 })!;
  const merged = mergeCandidateList([network], dom).candidate;
  assert.equal(merged.pageUrl, "https://example/watch");
  assert.equal(merged.pageTitle, "Fixture player");
  assert.equal(merged.source, "webRequest-mime");
  assert.equal(merged.contentType, "application/vnd.apple.mpegurl");
  const freshNetwork = detectCandidate({ url, tabId: 1, timestamp: 3 })!;
  mergeCandidateList([merged], freshNetwork);
  assert.equal(merged.pageTitle, "Fixture player");
  assert.equal(merged.pageUrl, "https://example/watch");
  assert.equal(merged.requestCount, 2);
});

test("later network evidence upgrades a DOM candidate while retaining its title", () => {
  const url = "https://x/manifest.mpd";
  const dom = detectCandidate({ url, tabId: 1, source: "performance-entry", pageTitle: "DASH player", timestamp: 3 })!;
  const network = detectCandidate({ url, tabId: 1, contentType: "application/dash+xml", timestamp: 2 })!;
  const merged = mergeCandidateList([dom], network).candidate;
  assert.equal(merged.source, "webRequest-mime");
  assert.equal(merged.contentType, "application/dash+xml");
  assert.equal(merged.pageTitle, "DASH player");
  assert.equal(merged.detectedAt, 2);
  assert.equal(merged.lastSeenAt, 3);
  assert.equal(merged.requestCount, 1);
});

test("video-specific metadata survives page metadata and stronger network evidence", () => {
  const url = "https://cdn.test/master.m3u8";
  const page = detectCandidate({ url, tabId: 1, pageUrl: "https://player.test/watch", mediaTitle: "Collection", metadataSource: "page", thumbnailUrl: "/collection.jpg", thumbnailSource: "page-image" })!;
  const video = detectCandidate({ url, tabId: 1, source: "video-element", mediaTitle: "Individual video", metadataSource: "video", thumbnailUrl: "https://images.test/video.jpg", thumbnailSource: "video-poster" })!;
  const merged = mergeCandidateList([page], video).candidate;
  mergeCandidateList([merged], detectCandidate({ url, tabId: 1, pageUrl: "https://player.test/watch", mediaTitle: "Updated collection", metadataSource: "page", thumbnailUrl: "/collection-new.jpg", thumbnailSource: "page-image" })!);
  mergeCandidateList([merged], detectCandidate({ url, tabId: 1, contentType: "application/vnd.apple.mpegurl" })!);
  assert.equal(merged.mediaTitle, "Individual video");
  assert.equal(merged.metadataSource, "video");
  assert.equal(merged.thumbnailUrl, "https://images.test/video.jpg");
  assert.equal(merged.thumbnailSource, "video-poster");
  assert.equal(merged.source, "webRequest-mime");
});

test("unsafe thumbnail URLs are rejected without stripping authentication parameters", () => {
  for (const thumbnailUrl of ["https://images.test/poster.jpg?secret=plain-token", "https://images.test/poster.jpg#plain-token", "https://plain-token@images.test/poster.jpg", "data:image/jpeg,plain-token", "blob:https://images.test/plain-token", "file:///plain-token.jpg", "https://images.test/poster.jpg?", "https://images.test/poster.jpg#"]) {
    const candidate = detectCandidate({ url: "https://cdn.test/a.mp4", tabId: 1, thumbnailUrl, thumbnailSource: "video-poster" })!;
    assert.equal(candidate.thumbnailUrl, undefined);
    assert.equal(candidate.thumbnailSource, undefined);
    assert.ok(!JSON.stringify(candidate).includes("plain-token"));
  }
});

test("metadata normalization retains only bounded title and numeric Probe summary", () => {
  const candidate = detectCandidate({
    url: "https://cdn.test/a.mp4", tabId: 1, pageUrl: "https://player.test/watch",
    mediaTitle: ` \u0000 Video\n title ${"x".repeat(400)}`, metadataSource: "video",
    thumbnailUrl: "/poster.jpg", thumbnailSource: "page-image",
    probeSummary: { duration: 10.5, videoCount: 1, audioCount: 1, width: 1920, height: 1080 },
  })!;
  assert.equal(candidate.mediaTitle?.length, 300);
  assert.ok(candidate.mediaTitle?.startsWith("Video title"));
  assert.equal(candidate.thumbnailUrl, "https://player.test/poster.jpg");
  assert.deepEqual(candidate.probeSummary, { duration: 10.5, videoCount: 1, audioCount: 1, width: 1920, height: 1080 });
  const invalid = prepareCandidateForStorage({ ...candidate, probeSummary: { duration: Infinity, videoCount: -1, audioCount: 0 } });
  assert.equal(invalid.candidate.probeSummary, undefined);
});
