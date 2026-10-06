import type { MediaCandidate } from "../shared/models.ts";
export function scoreCandidate(c: MediaCandidate): number {
  let score = 0;
  if (["hls","dash"].includes(c.mediaKind)) score += 45;
  else if (["mp4","webm"].includes(c.mediaKind)) score += 30;
  if (c.source === "webRequest-mime") score += 20;
  if (c.flags.likelyMasterManifest) score += 15;
  score += Math.min(c.segmentEvidenceCount * 2, 20);
  if (c.pageUrl && (c.initiator === c.pageUrl || c.documentUrl === c.pageUrl)) score += 10;
  if (c.source === "video-element") score += 12;
  if (c.flags.likelyAdvertisement) score -= 40;
  if (c.requestCount === 1 && c.segmentEvidenceCount === 0 && c.mediaKind === "unknown") score -= 20;
  return Math.max(0, Math.min(100, score));
}

