import test from "node:test";
import assert from "node:assert/strict";
import { AutoProbeQueue } from "../src/background/auto-probe.ts";
import { detectCandidate } from "../src/background/candidate-detector.ts";

const candidate = (id: string) => detectCandidate({ url: `https://fixture.test/${id}.m3u8`, tabId: 1 })!;
const tick = () => new Promise(resolve => setImmediate(resolve));

test("auto Probe is opt-in, sequential, deduplicated and skips opaque/ad/verified candidates", async () => {
  let enabled = false, active = 0, maxActive = 0;
  const seen: string[] = [];
  const queue = new AutoProbeQueue(async () => enabled, async c => {
    active++; maxActive = Math.max(maxActive, active); seen.push(c.id);
    await tick(); active--;
  });
  await queue.consider(candidate("a")); assert.equal(seen.length, 0);
  enabled = true;
  await Promise.all([queue.consider(candidate("a")), queue.consider(candidate("a")), queue.consider(candidate("b"))]);
  assert.equal(maxActive, 1); assert.equal(seen.length, 2);
  const blob = candidate("blob"); blob.url = "blob:https://fixture.test/a";
  const ad = candidate("ad"); ad.flags.likelyAdvertisement = true;
  const verified = candidate("verified"); verified.probeSummary = { videoCount: 1, audioCount: 1 };
  await Promise.all([queue.consider(blob), queue.consider(ad), queue.consider(verified)]);
  assert.equal(seen.length, 2);
});

test("auto Probe failure does not retry-loop or prevent later candidates; disabling stops queued requests", async () => {
  let enabled = true, calls = 0;
  const queue = new AutoProbeQueue(async () => enabled, async () => { calls++; throw new Error("Host unavailable"); });
  await queue.consider(candidate("failure")); await queue.consider(candidate("failure"));
  await queue.consider(candidate("next")); assert.equal(calls, 2);
  let release!: () => void;
  const blocked = new AutoProbeQueue(async () => enabled, async () => { calls++; await new Promise<void>(r => { release = r; }); });
  const first = blocked.consider(candidate("one")); await tick();
  const second = blocked.consider(candidate("two")); await tick();
  enabled = false; release(); await Promise.all([first, second]);
  assert.equal(calls, 3);
});
