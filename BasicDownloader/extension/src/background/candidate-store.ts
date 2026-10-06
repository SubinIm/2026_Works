import type { CandidateSource, MediaCandidate } from "../shared/models.ts";
import { scoreCandidate } from "./candidate-scorer.ts";
import { redactUrl } from "../shared/url-utils.ts";
import { cleanMediaTitle, sanitizeMediaMetadata, type MediaMetadata } from "../shared/media-metadata.ts";
const KEY = "mediaCandidatesByTab";
type State = Record<string, MediaCandidate[]>;
const SOURCE_STRENGTH: Record<CandidateSource, number> = {
  "webRequest-mime": 4, "webRequest-url": 3, "video-element": 2, "performance-entry": 1,
};
export class CandidateStore {
  onCandidate?: (candidate: MediaCandidate) => void;
  private pages = new Map<number, { url: string; title: string; metadata: MediaMetadata }>();
  private readonly maxPerTab: number;
  private readonly sensitiveUrls = new Map<string, string>();
  private mutations: Promise<void> = Promise.resolve();

  constructor(maxPerTab = 100) { this.maxPerTab = maxPerTab; }

  async list(tabId: number): Promise<MediaCandidate[]> {
    await this.mutations;
    const state = await this.read();
    return (state[String(tabId)] ?? []).sort((a, b) => b.confidenceScore - a.confidenceScore || b.lastSeenAt - a.lastSeenAt);
  }

  async upsert(candidate: MediaCandidate): Promise<MediaCandidate> {
    const result = await this.mutate(async () => {
      const page = this.pages.get(candidate.tabId);
      if (page && (!candidate.pageUrl || candidate.pageUrl === page.url)) this.enrich(candidate, page);
      const prepared = prepareCandidateForStorage(candidate);
      const state = await this.read(), key = String(candidate.tabId);
      const local = await chrome.storage.local.get("settings");
      const configured = (local.settings as { maxCandidatesPerTab?: number } | undefined)?.maxCandidatesPerTab;
      const limit = Number.isFinite(configured) ? Math.max(10, Math.min(500, configured!)) : this.maxPerTab;
      const merged = mergeCandidateList(state[key] ?? [], prepared.candidate, limit);
      state[key] = merged.items;
      await this.write(state);
      if (prepared.sensitiveUrl) this.sensitiveUrls.set(candidate.id, prepared.sensitiveUrl);
      this.pruneSensitiveUrls(state);
      return merged.candidate;
    });
    this.onCandidate?.(result);
    return result;
  }

  updatePageMetadata(tabId: number, url: string, title: string, metadata: MediaMetadata): Promise<void> {
    return this.mutate(async () => {
      if (!/^https?:\/\//i.test(url)) return;
      const safe = sanitizeMediaMetadata(metadata, url);
      // Page metadata must never pretend to describe a specific video element.
      delete safe.probeSummary;
      if (safe.mediaTitle) safe.metadataSource = "page";
      if (safe.thumbnailUrl) safe.thumbnailSource = "page-image";
      const page = { url, title: cleanMediaTitle(title) ?? "", metadata: safe };
      this.pages.set(tabId, page);
      const state = await this.read();
      let changed = false;
      for (const candidate of state[String(tabId)] ?? []) {
        if (candidate.pageUrl && candidate.pageUrl !== url) continue;
        const before = JSON.stringify(candidate);
        this.enrich(candidate, page);
        changed ||= before !== JSON.stringify(candidate);
      }
      if (changed) await this.write(state);
    });
  }

  private enrich(candidate: MediaCandidate, page: { url: string; title: string; metadata: MediaMetadata }): void {
    candidate.pageUrl ||= page.url;
    candidate.pageTitle = page.title || candidate.pageTitle;
    if (candidate.metadataSource !== "video" && page.metadata.mediaTitle) {
      candidate.mediaTitle = page.metadata.mediaTitle;
      candidate.metadataSource = "page";
    }
    if (candidate.thumbnailSource !== "video-poster" && page.metadata.thumbnailUrl) {
      candidate.thumbnailUrl = page.metadata.thumbnailUrl;
      candidate.thumbnailSource = "page-image";
    }
  }

  updateProbeSummary(tabId: number, id: string, summary: MediaCandidate["probeSummary"]): Promise<boolean> {
    return this.mutate(async () => {
      const safe = sanitizeMediaMetadata({ probeSummary: summary }).probeSummary;
      if (!safe) return false;
      const state = await this.read();
      const current = state[String(tabId)]?.find(candidate => candidate.id === id);
      // A Probe response is metadata, not a new media sighting. An in-flight
      // response must not restore a cleared/evicted candidate or its signed URL.
      if (!current) return false;
      current.probeSummary = safe;
      await this.write(state);
      return true;
    });
  }

  addSegmentEvidence(tabId: number): Promise<void> {
    return this.mutate(async () => {
      const state = await this.read(), items = state[String(tabId)] ?? [];
      const newest = items.filter(x => x.mediaKind === "hls" || x.mediaKind === "dash")
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
      if (newest) {
        newest.segmentEvidenceCount++;
        newest.confidenceScore = scoreCandidate(newest);
        await this.write(state);
      }
    });
  }

  clear(tabId: number): Promise<void> {
    return this.mutate(async () => {
      this.pages.delete(tabId);
      const state = await this.read();
      delete state[String(tabId)];
      await this.write(state);
      this.pruneSensitiveUrls(state);
    });
  }

  resolveUrl(candidate: MediaCandidate): string | undefined {
    return candidate.flags.signedUrl ? this.sensitiveUrls.get(candidate.id) : candidate.url;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    // webRequest events and content-script messages can overlap across await points.
    const result = this.mutations.then(operation);
    this.mutations = result.then(() => undefined, () => undefined);
    return result;
  }

  private pruneSensitiveUrls(state: State): void {
    const retained = new Set(Object.values(state).flat().map(candidate => candidate.id));
    for (const id of this.sensitiveUrls.keys()) if (!retained.has(id)) this.sensitiveUrls.delete(id);
  }

  private async read(): Promise<State> {
    return ((await chrome.storage.session.get(KEY))[KEY] as State | undefined) ?? {};
  }

  private async write(state: State): Promise<void> {
    await chrome.storage.session.set({ [KEY]: state });
  }
}
export function prepareCandidateForStorage(candidate:MediaCandidate):{candidate:MediaCandidate;sensitiveUrl?:string}{
  const {mediaTitle,thumbnailUrl,thumbnailSource,metadataSource,probeSummary,...rest}=candidate;
  const safe={...rest,...sanitizeMediaMetadata(candidate,candidate.pageUrl),flags:{...candidate.flags}};
  if(!candidate.flags.signedUrl)return {candidate:safe};
  return {sensitiveUrl:candidate.url,candidate:{...safe,url:redactUrl(candidate.url),canonicalUrl:`signed:${candidate.id}`}};
}
export function mergeCandidateList(items:MediaCandidate[],candidate:MediaCandidate,maxItems=100):{items:MediaCandidate[];candidate:MediaCandidate}{
  const old=items.find(x=>x.canonicalUrl===candidate.canonicalUrl);
  if(old){
    const strongerSource = SOURCE_STRENGTH[candidate.source] > SOURCE_STRENGTH[old.source];
    old.url = candidate.url;
    old.detectedAt = Math.min(old.detectedAt, candidate.detectedAt);
    old.lastSeenAt = Math.max(old.lastSeenAt, candidate.lastSeenAt);
    old.requestCount += candidate.requestCount;
    old.segmentEvidenceCount += candidate.segmentEvidenceCount;
    old.pageUrl = candidate.pageUrl || old.pageUrl;
    old.pageTitle = candidate.pageTitle || old.pageTitle;
    if (candidate.mediaTitle && (candidate.metadataSource === "video" || old.metadataSource !== "video" || !old.mediaTitle)) {
      old.mediaTitle = candidate.mediaTitle;
      old.metadataSource = candidate.metadataSource;
    }
    if (candidate.thumbnailUrl && (candidate.thumbnailSource === "video-poster" || old.thumbnailSource !== "video-poster" || !old.thumbnailUrl)) {
      old.thumbnailUrl = candidate.thumbnailUrl;
      old.thumbnailSource = candidate.thumbnailSource;
    }
    if (candidate.probeSummary) old.probeSummary = candidate.probeSummary;
    old.initiator = candidate.initiator || old.initiator;
    old.documentUrl = candidate.documentUrl || old.documentUrl;
    if (candidate.contentType && (strongerSource || !old.contentType)) old.contentType = candidate.contentType;
    if (strongerSource || old.mediaKind === "unknown") old.mediaKind = candidate.mediaKind;
    if (strongerSource) old.source = candidate.source;
    for (const key of Object.keys(old.flags) as (keyof MediaCandidate["flags"])[]) old.flags[key] ||= candidate.flags[key];
    old.confidenceScore=scoreCandidate(old);return {items,candidate:old};
  }
  candidate.confidenceScore=scoreCandidate(candidate);items.push(candidate);return {items:items.sort((a,b)=>b.lastSeenAt-a.lastSeenAt).slice(0,maxItems),candidate};
}
