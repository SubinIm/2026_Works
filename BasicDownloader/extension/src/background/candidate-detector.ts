import type { CandidateSource, MediaCandidate } from "../shared/models.ts";
import { canonicalizeUrl, isSegment, isSignedUrl, mediaKind } from "../shared/url-utils.ts";
import { sanitizeMediaMetadata, type MediaMetadata } from "../shared/media-metadata.ts";
export interface DetectionInput extends MediaMetadata { url: string; contentType?: string; tabId: number; pageUrl?: string; pageTitle?: string; initiator?: string; documentUrl?: string; source?: CandidateSource; timestamp?: number }
export function detectCandidate(input: DetectionInput): MediaCandidate | null {
  if (input.url.startsWith("blob:")) return make(input, "unknown", true);
  if (!/^https?:\/\//i.test(input.url) || isSegment(input.url, input.contentType)) return null;
  const kind = mediaKind(input.url, input.contentType);
  if (kind === "unknown") return null;
  return make(input, kind, false);
}
function make(input: DetectionInput, kind: MediaCandidate["mediaKind"], blob: boolean): MediaCandidate {
  const now = input.timestamp ?? Date.now(); const canonical = blob ? input.url : canonicalizeUrl(input.url);
  const source = input.source ?? (input.contentType ? "webRequest-mime" : "webRequest-url");
  return { id: hash(`${input.tabId}:${canonical}`), tabId: input.tabId, pageUrl: input.pageUrl ?? input.documentUrl ?? "", pageTitle: input.pageTitle ?? "", ...sanitizeMediaMetadata(input, input.pageUrl ?? input.documentUrl), mediaKind: kind, url: input.url, canonicalUrl: canonical, contentType: input.contentType, initiator: input.initiator, documentUrl: input.documentUrl, detectedAt: now, lastSeenAt: now, requestCount: source.startsWith("webRequest-") ? 1 : 0, segmentEvidenceCount: 0, confidenceScore: 0, source, flags: { likelyMasterManifest: /master|manifest|playlist/i.test(input.url), likelyAdvertisement: /(?:^|[\/_\-.?=&])(ads?|advert|promo|preroll)(?:[\/_\-.?=&]|$)/i.test(input.url), signedUrl: isSignedUrl(input.url), blobUrl: blob } };
}
function hash(value: string): string { let h=2166136261; for (let i=0;i<value.length;i++) h=Math.imul(h^value.charCodeAt(i),16777619); return `c${(h>>>0).toString(16)}`; }

