import type { MediaCandidate } from "../shared/models.ts";
import { isAllowedHostUrl } from "../shared/host-url-policy.ts";
import { summarizeProbe } from "./job-metadata.ts";
import { orderCandidates } from "../popup/presentation.ts";

export async function findAudioVideo(items: MediaCandidate[], probe: (candidate: MediaCandidate) => Promise<unknown>, all = false) {
  const eligible = orderCandidates(items).filter(c => !c.flags.blobUrl && (all || !c.flags.likelyAdvertisement) && isAllowedHostUrl(c.url));
  let checked = 0, failed = 0;
  let videoOnly=0,audioOnly=0,withAudioVideo=0;
  const matches: MediaCandidate[] = [];
  for (const candidate of (all ? eligible : eligible.slice(0, 20))) {
    // Explicit full scans recheck stale positive AND negative audio information.
    let summary = all ? undefined : candidate.probeSummary;
    if (!summary) {
      checked++;
      try { summary = summarizeProbe(await probe(candidate)); } catch { /* Continue to the next candidate. */ }
      if (!summary) { failed++; continue; }
    }
    if(summary.videoCount>0&&summary.audioCount===0)videoOnly++;
    if(summary.audioCount>0&&summary.videoCount===0)audioOnly++;
    if(summary.videoCount>0&&summary.audioCount>0)withAudioVideo++;
    if (summary.videoCount > 0 && summary.audioCount > 0 && !candidate.flags.likelyAdvertisement) {
      if(!all)return { ok: true, candidateId: candidate.id, checked, failed,videoOnly,audioOnly,withAudioVideo };
      matches.push({...candidate,probeSummary:summary});
    }
  }
  return { ok: true, candidateId: orderCandidates(matches)[0]?.id ?? null, checked, failed, videoOnly,audioOnly,withAudioVideo, limited: !all && eligible.length > 20 };
}
