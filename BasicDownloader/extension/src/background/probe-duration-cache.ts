const KEY = "verifiedProbeDurations";
const TTL_MS = 10 * 60 * 1000;
interface Entry { durationSeconds: number; checkedAt: number }
interface Storage { get(key: string): Promise<Record<string, any>>; set(values: Record<string, unknown>): Promise<void> }

export function positiveDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

// Only a digest and numeric metadata are persisted, never the signed URL or headers.
export async function probeIdentity(input: {
  candidateId: string; url: string; includeSession: boolean; pageUrl: string; userAgent?: string; cookieHeader?: string; origin?: string;
}): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([
    input.candidateId, input.url, input.includeSession, input.pageUrl, input.userAgent ?? "", input.cookieHeader ?? "", input.origin ?? "",
  ]));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export class ProbeDurationCache {
  private mutations: Promise<void> = Promise.resolve();
  private storage: Storage;
  private now: () => number;
  constructor(storage: Storage = chrome.storage.session, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
  }
  async get(key: string): Promise<Entry | undefined> {
    await this.mutations;
    const entry = (await this.storage.get(KEY))[KEY]?.[key] as Entry | undefined;
    return entry && positiveDuration(entry.durationSeconds) && Number.isFinite(entry.checkedAt)
      && this.now() >= entry.checkedAt && this.now() - entry.checkedAt <= TTL_MS ? entry : undefined;
  }
  remember(key: string, response: any): Promise<void> {
    const mutation = this.mutations.then(async () => {
      const all = (await this.storage.get(KEY))[KEY] ?? {};
      const now = this.now();
      const recent = Object.entries(all).filter(([, value]) => {
        const entry = value as Entry;
        return entry && positiveDuration(entry.durationSeconds) && Number.isFinite(entry.checkedAt)
          && now >= entry.checkedAt && now - entry.checkedAt <= TTL_MS;
      });
      const kept = Object.fromEntries(recent.sort((a, b) => (b[1] as Entry).checkedAt - (a[1] as Entry).checkedAt).slice(0, 99));
      delete kept[key];
      const duration = positiveDuration(response?.payload?.duration);
      if (response?.type === "probe_result" && duration && response.payload.isLive !== true) {
        kept[key] = { durationSeconds: duration, checkedAt: now };
      }
      await this.storage.set({ [KEY]: kept });
    });
    this.mutations = mutation.catch(() => {});
    return mutation;
  }
}

export function enrichJobDuration(job: Record<string, any>): Record<string, any> {
  const progress = { ...(job.progress && typeof job.progress === "object" ? job.progress : {}) };
  const probe = progress.probe ?? job.probe;
  const live = [progress.probe, job.probe].some(value => value?.isLive === true && value?.liveConfirmed === true);
  const requested = progress.durationSource === "requested" || job.durationSource === "requested";
  if (live && !requested) {
    delete progress.percent;
    delete progress.etaSeconds;
    delete progress.durationSeconds;
    return { ...job, durationSeconds: null, durationSource: "unknown", progress };
  }
  const choices = [
    { value: progress.durationSource === "requested" ? progress.durationSeconds : undefined, source: "requested" },
    { value: job.durationSource === "requested" ? job.durationSeconds : undefined, source: "requested" },
    { value: progress.durationSource !== "probe_hint" ? progress.durationSeconds : undefined, source: progress.durationSource ?? "format" },
    { value: probe?.duration, source: probe?.durationSource ?? "format" },
    { value: job.durationSource !== "probe_hint" ? job.durationSeconds : undefined, source: job.durationSource ?? "format" },
    { value: job.verifiedProbeDurationSeconds, source: "probe_hint" },
    { value: job.durationSeconds, source: job.durationSource ?? "probe_hint" },
  ];
  const known = choices.find(choice => positiveDuration(choice.value));
  if (!known) return job;
  return { ...job, durationSeconds: known.value, durationSource: known.source,
    progress: { ...progress, durationSeconds: known.value, durationSource: known.source } };
}
