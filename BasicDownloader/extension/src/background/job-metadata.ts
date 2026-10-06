import { canonicalizeUrl } from "../shared/url-utils.ts";
import type { MediaCandidate } from "../shared/models.ts";
export async function sourceIdentity(url: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalizeUrl(url)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function summarizeProbe(value: any): MediaCandidate["probeSummary"] {
  if (value?.type !== "probe_result") return undefined;
  const payload = value.payload;
  if (!Array.isArray(payload?.videoStreams) || !Array.isArray(payload?.audioStreams)) return undefined;
  const selected = Array.isArray(payload.selectedStreamIndices) ? payload.selectedStreamIndices : [];
  const video = payload.videoStreams.find((s: any) => selected.includes(s.index)) ?? payload.videoStreams[0];
  const videos=selected.length?payload.videoStreams.filter((s:any)=>selected.includes(s.index)):payload.videoStreams;
  const audios=selected.length?payload.audioStreams.filter((s:any)=>selected.includes(s.index)):payload.audioStreams;
  const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  return { duration: positive(payload.duration), videoCount: videos.length, audioCount: audios.length,
    width: positive(video?.width), height: positive(video?.height) };
}
