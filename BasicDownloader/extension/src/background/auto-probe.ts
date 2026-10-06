import type { MediaCandidate } from "../shared/models.ts";
import { isAllowedHostUrl } from "../shared/host-url-policy.ts";

// One request at a time; bounded memory/queue and no automatic retry storm.
// Worker restart resets attempts; successful persisted summaries remain skipped.
export class AutoProbeQueue {
  private attempted = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private enabled: () => Promise<boolean>;
  private probe: (candidate: MediaCandidate) => Promise<unknown>;
  constructor(enabled: () => Promise<boolean>, probe: (candidate: MediaCandidate) => Promise<unknown>) {
    this.enabled = enabled;
    this.probe = probe;
  }

  async consider(candidate: MediaCandidate): Promise<void> {
    if (candidate.probeSummary || candidate.flags.blobUrl || candidate.flags.likelyAdvertisement || !isAllowedHostUrl(candidate.url)) return;
    if (!await this.enabled()) return;
    const key = `${candidate.tabId}:${candidate.id}`;
    if (this.attempted.has(key) || this.pending >= 100) return;
    this.attempted.add(key);
    if (this.attempted.size > 1000) this.attempted.delete(this.attempted.values().next().value!);
    this.pending++;
    this.tail = this.tail.then(async () => {
      if (await this.enabled()) await this.probe(candidate);
    }).catch(() => { /* Manual Probe remains available, without leaking URL/errors to logs. */ })
      .finally(() => { this.pending--; });
    await this.tail;
  }
}
