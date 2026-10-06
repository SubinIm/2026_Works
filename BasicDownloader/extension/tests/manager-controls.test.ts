import test from "node:test";
import assert from "node:assert/strict";
import { candidateBadges, candidateGroupKey, completedJobActions, isRemovableJob, jobDisplayName, matchesJobFilter, safeThumbnail, suggestedFilename } from "../src/popup/manager-controls.ts";
import type { MediaCandidate } from "../src/shared/models.ts";

const candidate = { mediaTitle: "My Video", pageTitle: "Page", pageUrl: "https://example.test/watch", tabId: 1, probeSummary: { videoCount: 1, audioCount: 1, height: 1080, duration: 8 } } as MediaCandidate;

test("filename templates support title quality date and sanitize Windows names", () => {
  assert.equal(suggestedFilename(candidate, "{title} [{quality}] {date}", new Date(2026, 9, 5)), "My Video [1080p] 2026-10-05");
  assert.equal(suggestedFilename({ ...candidate, mediaTitle: "CON" }), "_CON");
  assert.equal(suggestedFilename({ ...candidate, mediaTitle: "bad:/name?..." }), "bad__name_");
  assert.equal(suggestedFilename(candidate, "{unsupported}"), "download");
  assert.ok(suggestedFilename({ ...candidate, mediaTitle: "x".repeat(300) }).length <= 120);
});

test("thumbnail policy excludes local opaque credential and signed URLs", () => {
  for (const input of ["blob:https://example.test/a", "data:image/png;base64,a", "file:///C:/a.jpg", "javascript:alert(1)", "https://u:p@example.test/a.jpg", "https://example.test/a.jpg?token=x", "https://example.test/a.jpg#x", null]) assert.equal(safeThumbnail(input), undefined);
  assert.equal(safeThumbnail("https://example.test/a.jpg"), "https://example.test/a.jpg");
});

test("badges distinguish verified audio from missing metadata", () => {
  assert.deepEqual(candidateBadges(candidate), ["1080p", "영상 + 음성", "0:08"]);
  assert.ok(candidateBadges({ ...candidate, probeSummary: undefined }).join().includes("미확인"));
  assert.ok(candidateBadges({ ...candidate, probeSummary: { videoCount: 1, audioCount: 0 } }).join().includes("무음"));
});

test("terminal removal includes DRM failure and never includes active states", () => {
  for (const state of ["completed", "failed", "cancelled", "unsupported_drm"]) assert.equal(isRemovableJob({ state }), true);
  for (const state of ["queued", "running", "probing", "finalizing", "cancelling", "unknown"]) assert.equal(isRemovableJob({ state }), false);
  assert.equal(matchesJobFilter({ state: "unsupported_drm" }, "failed"), true);
  assert.equal(completedJobActions({ state: "failed", outputPath: "C:\\x.mp4" }), false);
  assert.equal(completedJobActions({ state: "completed", outputPath: "C:\\x.mp4" }), true);
});

test("group identity is page-scoped while history uses stored display title", () => {
  assert.equal(candidateGroupKey(candidate), candidate.pageUrl);
  assert.notEqual(candidateGroupKey(candidate), candidateGroupKey({ ...candidate, pageUrl: "https://example.test/another" }));
  assert.equal(jobDisplayName({ displayTitle: "Video", outputPath: "C:\\x.mp4" }), "Video");
  assert.equal(jobDisplayName({ outputPath: "C:\\x.mp4" }), "x.mp4");
});
