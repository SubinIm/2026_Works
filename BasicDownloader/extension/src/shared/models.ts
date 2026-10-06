export type MediaKind = "hls" | "dash" | "mp4" | "webm" | "unknown";
export type CandidateSource = "webRequest-url" | "webRequest-mime" | "video-element" | "performance-entry";
export interface MediaCandidate {
  id: string; tabId: number; pageUrl: string; pageTitle: string; mediaKind: MediaKind;
  mediaTitle?: string; thumbnailUrl?: string; thumbnailSource?: "video-poster" | "page-image";
  metadataSource?: "video" | "page";
  probeSummary?: { duration?: number; videoCount: number; audioCount: number; width?: number; height?: number };
  url: string; canonicalUrl: string; contentType?: string; initiator?: string;
  documentUrl?: string; detectedAt: number; lastSeenAt: number; requestCount: number;
  segmentEvidenceCount: number; confidenceScore: number; source: CandidateSource;
  flags: { likelyMasterManifest: boolean; likelyAdvertisement: boolean; signedUrl: boolean; blobUrl: boolean };
}
export interface RequestContext { pageUrl: string; referer?: string; origin?: string; userAgent?: string; cookieHeader?: string }
export interface ExtensionSettings { maxCandidatesPerTab: number; downloadRoot: string; ffmpegPath: string; keepPartialFiles: boolean; youtubeEnabled?:boolean; ytDlpPath?:string; jsRuntimePath?:string }
export const DEFAULT_SETTINGS: ExtensionSettings = { maxCandidatesPerTab: 100, downloadRoot: "", ffmpegPath: "", keepPartialFiles: false, youtubeEnabled:false, ytDlpPath:"", jsRuntimePath:"" };

