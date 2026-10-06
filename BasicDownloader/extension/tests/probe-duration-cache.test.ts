import test from "node:test";
import assert from "node:assert/strict";
import { ProbeDurationCache, probeIdentity, enrichJobDuration } from "../src/background/probe-duration-cache.ts";

function fixture() {
  const data: Record<string, any> = {};
  let now = 1000;
  const storage = {
    async get(key: string) { return structuredClone({ [key]: data[key] }); },
    async set(value: Record<string, unknown>) { Object.assign(data, structuredClone(value)); },
  };
  return { data, storage, cache: new ProbeDurationCache(storage, () => now), advance: (ms: number) => { now += ms; } };
}
const probe = (duration: unknown, extra = {}) => ({ type: "probe_result", payload: { duration, ...extra } });

test("Probe identity is scoped to exact URL and session mode, with no secrets persisted", async () => {
  const input = { candidateId: "id", url: "https://x/v.m3u8?token=SECRET", includeSession: false, pageUrl: "https://x/watch" };
  const key = await probeIdentity(input);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, await probeIdentity(input));
  for (const change of [{ includeSession: true }, { url: "https://x/v.m3u8?token=NEW" }, { pageUrl: "https://x/other" }, { candidateId: "other" }, { userAgent: "other" }, { cookieHeader: "SESSION_SECRET" }, { origin: "https://other" }]) {
    assert.notEqual(key, await probeIdentity({ ...input, ...change }));
  }
  const f = fixture();
  await f.cache.remember(key, probe(120, { url: input.url, cookieHeader: "SESSION_SECRET" }));
  assert.equal((await f.cache.get(key))?.durationSeconds, 120);
  assert.doesNotMatch(JSON.stringify(f.data), /SECRET|https|cookieHeader/);
  assert.equal((await new ProbeDurationCache(f.storage, () => 1000).get(key))?.durationSeconds, 120, "worker restart retains numeric metadata");
});

test("duration cache rejects invalid, failed, and live results and expires after ten minutes", async () => {
  const f = fixture();
  for (const value of [0, -1, NaN, Infinity, "120", true, null]) {
    await f.cache.remember("key", probe(120));
    await f.cache.remember("key", probe(value));
    assert.equal(await f.cache.get("key"), undefined);
  }
  for (const response of [probe(10, { isLive: true }), { type: "protocol_error", payload: { duration: 10 } }]) {
    await f.cache.remember("key", probe(120));
    await f.cache.remember("key", response);
    assert.equal(await f.cache.get("key"), undefined);
  }
  await f.cache.remember("key", probe(120));
  f.advance(600001);
  assert.equal(await f.cache.get("key"), undefined);
});

test("concurrent Probe results retain separate durations and bound cache size", async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 110 }, (_, i) => f.cache.remember(`key-${i}`, probe(i + 1))));
  assert.equal(Object.keys(f.data.verifiedProbeDurations).length, 100);
  assert.equal((await f.cache.get("key-109"))?.durationSeconds, 110);
});

test("legacy Host progress and list snapshots are enriched from verified Probe", () => {
  const job = enrichJobDuration({ jobId: "x", verifiedProbeDurationSeconds: 120, progress: { mediaSeconds: 30, speed: "2x" } });
  assert.equal(job.durationSeconds, 120);
  assert.equal(job.durationSource, "probe_hint");
  assert.equal(job.progress.durationSeconds, 120);
  assert.equal(job.progress.mediaSeconds, 30);
});

test("fresh duration wins over cached hints and requested cap wins over natural duration", () => {
  const hinted = { durationSeconds: 120, durationSource: "probe_hint", verifiedProbeDurationSeconds: 120 };
  const job = enrichJobDuration({ ...hinted, probe: { duration: 90, durationSource: "stream" }, progress: {} });
  assert.equal(job.durationSeconds, 90);
  assert.equal(job.durationSource, "stream");
  const capped = enrichJobDuration({ ...hinted, durationSeconds: 20, durationSource: "requested", probe: { duration: 90 }, progress: {} });
  assert.equal(capped.durationSeconds, 20);
  assert.equal(capped.durationSource, "requested");
  assert.equal(enrichJobDuration({ durationSeconds: 0, probe: { duration: 45 } }).durationSeconds, 45);
});

test("confirmed live removes stale length and ETA but retains explicit recording cap", () => {
  const probe = { isLive: true, liveConfirmed: true, duration: null };
  const job = enrichJobDuration({ probe, durationSeconds: 120, verifiedProbeDurationSeconds: 120, progress: { percent: 50, etaSeconds: 30 } });
  assert.equal(job.durationSeconds, null);
  assert.equal(job.progress.percent, undefined);
  assert.equal(job.progress.etaSeconds, undefined);
  const capped = enrichJobDuration({ probe, durationSeconds: 30, durationSource: "requested", progress: {} });
  assert.equal(capped.durationSeconds, 30);
});
