import type { MediaCandidate } from "./models.ts";

export type MediaMetadata = Pick<MediaCandidate, "mediaTitle" | "thumbnailUrl" | "thumbnailSource" | "metadataSource" | "probeSummary">;

export function cleanMediaTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || undefined;
}

// Do not save signed image URLs or mutate their query strings into broken URLs.
// Refuse every query/fragment, including unknown token parameter names.
export function safeThumbnailUrl(value: unknown, base?: string): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 8192) return undefined;
  try {
    const url = new URL(value, base || undefined);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || /[?#]/.test(url.href)) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function sanitizeMediaMetadata(value: Partial<MediaMetadata>, base?: string): MediaMetadata {
  const result: MediaMetadata = {};
  const title = cleanMediaTitle(value.mediaTitle);
  if (title) {
    result.mediaTitle = title;
    result.metadataSource = value.metadataSource === "video" ? "video" : "page";
  }
  const thumbnail = safeThumbnailUrl(value.thumbnailUrl, base);
  if (thumbnail && (value.thumbnailSource === "video-poster" || value.thumbnailSource === "page-image")) {
    result.thumbnailUrl = thumbnail;
    result.thumbnailSource = value.thumbnailSource;
  }
  const probe = value.probeSummary;
  if (probe && typeof probe === "object" && validCount(probe.videoCount) && validCount(probe.audioCount)) {
    result.probeSummary = { videoCount: probe.videoCount, audioCount: probe.audioCount };
    if (positive(probe.duration)) result.probeSummary.duration = probe.duration;
    if (positive(probe.width) && Number.isInteger(probe.width)) result.probeSummary.width = probe.width;
    if (positive(probe.height) && Number.isInteger(probe.height)) result.probeSummary.height = probe.height;
  }
  return result;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
