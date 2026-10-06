import test from "node:test";
import assert from "node:assert/strict";
import { detectCandidate } from "../src/background/candidate-detector.ts";
import { BLOB_NOTICE, NO_AUDIO_WARNING, candidateControlState, hostHealthLabel, isHostReady, orderCandidates, presentHostResponse, presentJobProgress } from "../src/popup/presentation.ts";
import { assertAllowedHostUrl, isAllowedHostUrl } from "../src/shared/host-url-policy.ts";

const blob = detectCandidate({ url: "blob:https://fixture.test/id", tabId: 1 })!;

test("skipped input Probe progress does not claim input tracks were inspected", () => {
  assert.match(presentJobProgress({state:"probing",probe:{inputProbeSkipped:true}}).note, /입력 Probe 생략/);
  assert.match(presentJobProgress({state:"running",probe:{inputProbeSkipped:true}}).note, /입력 Probe를 생략/);
});

test("blob candidate Probe is disabled", () => assert.equal(candidateControlState(blob, true).probeDisabled, true));
test("blob candidate Download and session controls are disabled", () => {
  const state = candidateControlState(blob, true);
  assert.equal(state.downloadDisabled, true);
  assert.equal(state.sessionDisabled, true);
});
test("blob candidate shows the required MediaSource guidance", () => {
  assert.equal(BLOB_NOTICE, "이 주소는 브라우저 내부 MediaSource URL입니다.\n실제 HTTP(S) MP4, HLS 또는 DASH 주소가 탐지되어야 다운로드할 수 있습니다.");
});
test("blob, data and file URLs cannot be delivered to Native Host", () => {
  for (const url of ["blob:https://fixture.test/id", "data:video/mp4;base64,AA==", "file:///C:/video.mp4"]) {
    assert.equal(isAllowedHostUrl(url), false);
    assert.throws(() => assertAllowedHostUrl(url), /underlying_stream_required/);
  }
  assert.equal(isAllowedHostUrl("https://fixture.test/stream.m3u8"), true);
  assert.doesNotThrow(() => assertAllowedHostUrl("https://fixture.test/stream.m3u8"));
});
test("HTTP(S) HLS and DASH candidates are enabled when Host is ready", () => {
  for (const url of ["https://fixture.test/stream.m3u8", "http://fixture.test/stream.mpd"]) {
    const candidate = detectCandidate({ url, tabId: 1 })!;
    const state = candidateControlState(candidate, true);
    assert.equal(state.probeDisabled, false);
    assert.equal(state.downloadDisabled, false);
  }
});
test("protocol_error is converted to user-facing summary", () => {
  const raw = { protocolVersion: 1, messageId: "x", type: "protocol_error", payload: { errorSummary: "Only HTTP(S) URLs are allowed: blob:https://fixture.test/id" } };
  const shown = presentHostResponse(raw);
  assert.equal(shown.isError, true);
  assert.match(shown.message, /실제 HTTP\(S\) 미디어 주소/);
  assert.ok(shown.technical.includes("protocol_error"));
  assert.ok(!shown.message.includes("protocol_error"));
});
test("local fixture MP4, HLS and DASH candidates retain enabled controls", () => {
  for (const url of ["http://127.0.0.1:8765/generated/direct.mp4", "http://127.0.0.1:8765/generated/stream.m3u8", "http://127.0.0.1:8765/generated/stream.mpd"]) {
    const candidate = detectCandidate({ url, tabId: 1 })!;
    assert.ok(candidate);
    assert.equal(candidateControlState(candidate, true).downloadDisabled, false);
  }
});

test("actionable candidates precede browser-internal URLs even with lower scores", () => {
  const mp4 = detectCandidate({ url: "https://fixture.test/ads/clip.mp4", tabId: 1 })!;
  const highScoreBlob = { ...blob, confidenceScore: 100 };
  const original = [highScoreBlob, mp4];
  assert.deepEqual(orderCandidates(original).map(c => c.id), [mp4.id, blob.id]);
  assert.equal(original[0], highScoreBlob);
});

test("Host ready requires a successful FFmpeg health response", () => {
  assert.equal(isHostReady({ type: "health_result", payload: { ffmpegAvailable: true } }), true);
  for (const response of [null, {}, { ok: false }, { type: "protocol_error", payload: { ffmpegAvailable: true } }, { type: "health_result", payload: { ffmpegAvailable: false } }]) {
    assert.equal(isHostReady(response), false);
  }
});

test("unknown protocol errors never expose raw JSON as the user summary", () => {
  const detail = '{"internalError":"sensitive implementation detail"}';
  const shown = presentHostResponse({ type: "protocol_error", payload: { errorSummary: detail } });
  assert.ok(!shown.message.includes("internalError"));
  assert.ok(shown.technical.includes("internalError"));
  assert.equal(shown.isError, true);
});

test("known duration progress includes percentage, bytes, processed media, speed and ETA", () => {
  const shown = presentJobProgress({ state: "running", progress: { percent: 25, mediaSeconds: 90, totalBytes: 1048576, speed: "2.0x", etaSeconds: 135 } });
  assert.equal(shown.percent, 25);
  assert.equal(shown.label, "다운로드 중");
  for (const text of ["25.0%", "1.0 MiB", "1:30", "2.0x", "예상 남은 시간 2:15"]) assert.ok(shown.metrics.includes(text), shown.metrics);
  assert.equal(shown.note, "");
});

test("unknown duration progress is indeterminate and never invents an ETA", () => {
  const shown = presentJobProgress({ state: "running", progress: { mediaSeconds: 90, totalBytes: 512, speed: "2x", etaSeconds: 30 } });
  assert.equal(shown.percent, null);
  assert.match(shown.note, /아직 전체 길이 정보를 받지 못했습니다/);
  assert.ok(!shown.metrics.includes("%"));
  assert.ok(!shown.metrics.includes("예상 남은 시간"));
});

test("known job duration is retained before the first progress percentage arrives", () => {
  const waiting = presentJobProgress({ state: "running", durationSeconds: 60, progress: {} });
  assert.equal(waiting.percent, null);
  assert.ok(!waiting.note.includes("전체 길이를 알 수 없어"));
  const processing = presentJobProgress({ state: "running", durationSeconds: 60, progress: { mediaSeconds: 30 } });
  assert.equal(processing.percent, 50);
});

test("Probe duration survives missing Host percentage and ETA and computes both", () => {
  for (const job of [
    { probe: { duration: 120 }, progress: { mediaSeconds: 30, speed: "2x" } },
    { progress: { probe: { duration: 120 }, mediaSeconds: 30, speed: "2x" } },
  ]) {
    const shown = presentJobProgress({ state: "running", ...job });
    assert.equal(shown.percent, 25);
    assert.match(shown.metrics, /전체 길이 2:00 \(Probe로 확인\)/);
    assert.match(shown.metrics, /예상 남은 시간 0:45/);
    assert.equal(shown.note, "");
  }
});

test("invalid primary duration and ETA fields cannot mask valid fallback metadata", () => {
  for (const invalid of [0, -1, NaN, Infinity, "120", null]) {
    const shown = presentJobProgress({ state: "running", durationSeconds: invalid, probe: { duration: 120 }, progress: { durationSeconds: invalid, mediaSeconds: 30, percent: -20, etaSeconds: -1, speed: "2x" } });
    assert.equal(shown.percent, 25);
    assert.match(shown.metrics, /예상 남은 시간 0:45/);
    assert.ok(!/NaN|Infinity|-20/.test(shown.metrics));
  }
  const fromProgress = presentJobProgress({ state: "running", durationSeconds: 0, progress: { durationSeconds: 60, durationSource: "stream", mediaSeconds: 30 } });
  assert.equal(fromProgress.percent, 50);
  assert.match(fromProgress.metrics, /스트림 정보로 확인/);
});

test("zero media time is valid while missing media time waits for first progress", () => {
  const zero = presentJobProgress({ state: "running", probe: { duration: 120 }, progress: { mediaSeconds: 0, speed: "2x" } });
  assert.equal(zero.percent, 0);
  assert.match(zero.metrics, /예상 남은 시간 1:00/);
  const missing = presentJobProgress({ state: "running", probe: { duration: 120 }, progress: { speed: "2x" } });
  assert.equal(missing.percent, null);
  assert.match(missing.metrics, /전체 길이 2:00/);
  assert.match(missing.note, /첫 진행 정보를 기다리는 중/);
});

test("confirmed live metadata overrides stale Probe duration but legacy guessed live does not", () => {
  const base = { state: "running", durationSeconds: 120, probe: { duration: 120 }, progress: { mediaSeconds: 30, percent: 25, speed: "2x", etaSeconds: 45 } };
  const live = presentJobProgress({ ...base, progress: { ...base.progress, probe: { isLive: true, liveConfirmed: true } } });
  assert.equal(live.percent, null);
  assert.match(live.note, /라이브 스트림으로 확인/);
  assert.ok(!live.metrics.includes("전체 길이"));
  assert.ok(!live.metrics.includes("예상 남은 시간"));
  assert.equal(presentJobProgress({ ...base, isLive: true }).percent, 25);
  const bounded = presentJobProgress({ ...base, isLive: true, liveConfirmed: true, durationSource: "requested" });
  assert.equal(bounded.percent, 25);
  assert.match(bounded.metrics, /지정한 녹화 길이/);
});

test("missing metadata, known unknown duration and confirmed live have distinct explanations", () => {
  assert.match(presentJobProgress({ state: "running", progress: {} }).note, /아직 전체 길이 정보를 받지 못했습니다/);
  assert.match(presentJobProgress({ state: "running", probe: { durationUnknown: true, isLive: null } }).note, /Probe와 스트림에서 전체 길이를 확인하지 못했습니다/);
  assert.match(presentJobProgress({ state: "running", probe: { isLive: true, liveConfirmed: true } }).note, /라이브 스트림으로 확인/);
});

test("direct progress responses retain Probe duration metadata", () => {
  const shown = presentHostResponse({ type: "job_progress", payload: { probe: { duration: 120 }, mediaSeconds: 30, speed: "2x" } });
  assert.match(shown.message, /25.0%/);
  assert.match(shown.message, /전체 길이 2:00/);
  assert.match(shown.message, /예상 남은 시간 0:45/);
  const nested = presentHostResponse({ type: "job_progress", payload: { durationSeconds: 120, progress: { durationSeconds: 0, mediaSeconds: 30, speed: "2x" } } });
  assert.match(nested.message, /25.0%/);
  assert.match(nested.message, /예상 남은 시간 0:45/);
});

test("health label exposes installed Host version and warns when progress features are outdated", () => {
  const old = { type: "health_result", payload: { ffmpegAvailable: true, hostVersion: "0.1.0" } };
  assert.equal(isHostReady(old), true, "old FFmpeg-ready Hosts retain baseline controls");
  assert.match(hostHealthLabel(old), /Host v0.1.0.*구버전 Host/);
  assert.match(hostHealthLabel({ type: "health_result", payload: { ffmpegAvailable: true, hostVersion: "0.1.1" } }), /구버전 Host/, "0.1.2 adds reliable Probe duration transfer");
  for (const version of ["0.1.2", "0.2.0", "1.0.0"]) {
    const label = hostHealthLabel({ type: "health_result", payload: { ffmpegAvailable: true, hostVersion: version } });
    assert.ok(label.includes(`Host v${version}`));
    assert.ok(!label.includes("구버전"));
  }
  assert.match(hostHealthLabel({ type: "health_result", payload: { ffmpegAvailable: true } }), /Host 버전 확인 안 됨/);
});

test("FFmpeg end does not become completed and 100 percent waits for verified completion", () => {
  const processing = presentJobProgress({ state: "running", progress: { percent: 100, progress: "end" } });
  assert.equal(processing.percent, 99.9);
  assert.equal(processing.label, "다운로드 중");
  const verifying = presentJobProgress({ state: "finalizing", progress: { percent: 100, phase: "verifying" } });
  assert.equal(verifying.percent, 99.9);
  assert.match(verifying.label, /검증/);
  assert.equal(presentJobProgress({ state: "completed" }).percent, 100);
  assert.match(presentJobProgress({ state: "running", phase: "probing" }).note, /영상·음성 트랙/);
});

test("invalid progress values never render NaN or infinity", () => {
  const shown = presentJobProgress({ state: "running", progress: { percent: NaN, etaSeconds: Infinity, mediaSeconds: -1, totalBytes: -12, speed: "NaNx" } });
  assert.equal(shown.percent, null);
  assert.equal(shown.metrics, "");
  const overflow = presentJobProgress({ state: "running", durationSeconds: 1e308, progress: { mediaSeconds: 0, speed: 1e-308 } });
  assert.ok(!/NaN|Infinity/.test(overflow.metrics));
  assert.ok(!overflow.metrics.includes("예상 남은 시간"));
});

test("Probe visibly summarizes streams and warns on video without audio", () => {
  const silent = presentHostResponse({ type: "probe_result", payload: { duration: 1563.8, videoStreams: [{ codec_name: "vp9" }], audioStreams: [] } });
  assert.match(silent.message, /길이 26:03 · 영상 1개 · 음성 0개/);
  assert.ok(silent.message.includes(NO_AUDIO_WARNING));
  assert.equal(silent.isWarning, true);
  assert.equal(silent.isError, false);
  const normal = presentHostResponse({ type: "probe_result", payload: { duration: 8, videoStreams: [{}], audioStreams: [{}] } });
  assert.equal(normal.message, "길이 0:08 · 영상 1개 · 음성 1개");
  assert.equal(normal.isWarning, false);
  assert.ok(!presentHostResponse({ type: "probe_result", payload: {} }).message.includes("음성 0개"));
});

test("audio missing error codes produce actionable safe guidance", () => {
  for (const errorCode of ["audio_stream_missing", "output_audio_missing"]) {
    const shown = presentHostResponse({ type: "job_failed", payload: { errorCode, errorSummary: "Internal details" } });
    assert.equal(shown.message, NO_AUDIO_WARNING);
    assert.equal(shown.isError, true);
    assert.ok(!shown.message.includes("Internal details"));
  }
});

test("technical detail redacts probe tags, request headers and signed query values without changing input", () => {
  const raw = { type: "probe_result", payload: { url: "https://fixture.test/v.m3u8?token=secret-token&odd=opaque", cookieHeader: "session=secret-cookie", authorization: "Bearer secret-auth", videoStreams: [{ tags: { comment: "Cookie: hidden-header" } }], audioStreams: [] } };
  const shown = presentHostResponse(raw);
  for (const secret of ["secret-token", "opaque", "secret-cookie", "secret-auth", "hidden-header"]) assert.ok(!shown.technical.includes(secret));
  assert.ok(raw.payload.url.includes("secret-token"));
  assert.equal(raw.payload.cookieHeader, "session=secret-cookie");
});
