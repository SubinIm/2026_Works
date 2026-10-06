import type { MediaCandidate } from "../shared/models.ts";
export { DEFAULT_PREFERENCES as MANAGER_DEFAULTS, type ManagerPreferences } from "../shared/preferences.ts";
export const ACTIVE_STATES = new Set(["queued", "probing", "running", "finalizing", "cancelling"]);
export type JobFilter = "all" | "active" | "completed" | "failed";

export function hostSupportsManager(response: any): boolean {
  const version = response?.type === "health_result" ? response.payload?.hostVersion : undefined;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) return false;
  const [major = 0, minor = 0] = version.split(/[.+-]/).map(Number);
  return major > 0 || minor >= 2;
}

export function candidateTitle(candidate: MediaCandidate): string {
  return candidate.mediaTitle?.trim() || candidate.pageTitle?.trim() || "download";
}

export function candidateBadges(candidate: MediaCandidate): string[] {
  const probe = candidate.probeSummary;
  if (!probe) return ["음성·화질 미확인 — Probe로 확인"];
  const result: string[] = [];
  if (typeof probe.height === "number" && probe.height > 0) result.push(`${Math.round(probe.height)}p`);
  if (probe.videoCount > 0 && probe.audioCount > 0) result.push("영상 + 음성");
  else if (probe.videoCount > 0 && probe.audioCount === 0) result.push("영상만 · 무음");
  else if (probe.audioCount > 0) result.push("음성만");
  if (typeof probe.duration === "number" && Number.isFinite(probe.duration) && probe.duration > 0) {
    const total = Math.floor(probe.duration);
    result.push(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`);
  }
  return result.length ? result : ["미디어 정보 미확인"];
}

export function suggestedFilename(candidate: MediaCandidate, template = "{title}", now = new Date(), fallback = "download"): string {
  const height = candidate.probeSummary?.height;
  const values: Record<string, string> = {
    title: candidate.mediaTitle?.trim() || candidate.pageTitle?.trim() || fallback, quality: typeof height === "number" && height > 0 ? `${Math.round(height)}p` : "화질미확인",
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
  };
  let result = (template || "{title}").replace(/\{([^{}]+)\}/g, (_all, key: string) => values[key] ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  if (!result) result = "download";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `_${result}`;
  return result.slice(0, 120).replace(/[. ]+$/g, "") || "download";
}

export function safeThumbnail(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function candidateGroupKey(candidate: MediaCandidate): string {
  // This groups pages, not an unverified assertion that two streams are one video.
  return candidate.pageUrl || `tab:${candidate.tabId}`;
}

export function isRemovableJob(job: Record<string, any>): boolean {
  return ["completed", "failed", "cancelled", "unsupported_drm"].includes(job.state);
}

export function matchesJobFilter(job: Record<string, any>, filter: JobFilter): boolean {
  return filter === "all" || (filter === "active" ? ACTIVE_STATES.has(job.state)
    : filter === "failed" ? ["failed", "cancelled", "unsupported_drm"].includes(job.state) : job.state === filter);
}

export function completedJobActions(job: Record<string, any>): boolean {
  return job.state === "completed" && typeof job.outputPath === "string" && !!job.outputPath;
}

export function jobDisplayName(job: Record<string, any>): string {
  return typeof job.displayTitle === "string" && job.displayTitle.trim() ? job.displayTitle
    : typeof job.outputPath === "string" ? job.outputPath.split(/[\\/]/).pop() || "다운로드"
    : typeof job.filename === "string" ? job.filename : "다운로드";
}
