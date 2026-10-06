import type { MediaCandidate } from "../shared/models.ts";
import { isAllowedHostUrl } from "../shared/host-url-policy.ts";

export const BLOB_NOTICE = "이 주소는 브라우저 내부 MediaSource URL입니다.\n실제 HTTP(S) MP4, HLS 또는 DASH 주소가 탐지되어야 다운로드할 수 있습니다.";

export interface CandidateControlState {
  probeDisabled: boolean;
  downloadDisabled: boolean;
  sessionDisabled: boolean;
  underlyingStreamRequired: boolean;
  reason?: string;
}

export interface PresentedResponse {
  message: string;
  technical: string;
  isError: boolean;
  isWarning?: boolean;
}

export const NO_AUDIO_WARNING = "음성 트랙이 없는 영상입니다. 음성이 포함된 후보나 상위(master) manifest를 선택하고 Probe로 음성 트랙을 확인하세요. 무음 영상이 필요할 때만 ‘영상만 저장(무음 허용)’을 선택하세요.";

export interface PresentedProgress {
  label: string;
  percent: number | null;
  metrics: string;
  note: string;
}

const JOB_LABELS: Record<string, string> = { queued: "대기 중", probing: "미디어 확인 중", running: "다운로드 중", finalizing: "파일 검증·마무리 중", cancelling: "취소 중", cancelled: "취소됨", completed: "완료", failed: "실패", unsupported_drm: "DRM 미지원" };

export function presentJobProgress(job: Record<string, any>): PresentedProgress {
  const progress = job.progress && typeof job.progress === "object" ? job.progress as Record<string, unknown> : {};
  let state = String(job.state ?? "running");
  const phase = job.phase ?? progress.phase;
  if (["queued", "probing", "running", "finalizing"].includes(state)) {
    if (phase === "probing") state = "probing";
    if (phase === "verifying") state = "finalizing";
  }
  const probe = record(job.probe);
  const progressProbe = record(progress.probe);
  const metadata = [progress, job, progressProbe, probe];
  // Older Hosts called every unknown duration "live". Only explicit manifest
  // confirmation may override a known Probe result; a requested live cap is valid.
  const live = metadata.some(item => item.liveConfirmed === true && item.isLive === true);
  const durationCandidates = [
    { value: job.durationSeconds, source: job.durationSource },
    { value: progress.durationSeconds, source: progress.durationSource },
    { value: probe.duration, source: probe.durationSource ?? "probe" },
    { value: progressProbe.duration, source: progressProbe.durationSource ?? "probe" },
  ];
  const known = durationCandidates.find(item => positiveNumber(item.value) !== null && (!live || item.source === "requested"));
  const duration = known ? positiveNumber(known.value) : null;
  const mediaSeconds = nonnegativeNumber(progress.mediaSeconds);
  const speed = playbackSpeed(progress.speed);
  const rawPercent = live && duration === null ? null : nonnegativeNumber(progress.percent) ?? (duration !== null && mediaSeconds !== null ? mediaSeconds / duration * 100 : null);
  // FFmpeg's progress=end is not completion: verification and atomic rename still follow.
  const percent = state === "completed" ? 100 : rawPercent === null ? null : Math.min(99.9, Math.max(0, rawPercent));
  const pieces: string[] = [];
  if (percent !== null) pieces.push(`${percent.toFixed(1)}%`);
  const bytes = nonnegativeNumber(progress.totalBytes);
  const computedEta = duration !== null && mediaSeconds !== null && speed !== null ? nonnegativeNumber(Math.max(0, duration - mediaSeconds) / speed) : null;
  const eta = live && duration === null ? null : nonnegativeNumber(progress.etaSeconds) ?? computedEta;
  if (bytes !== null) pieces.push(`저장 ${formatBytes(bytes)}`);
  const byteSpeed=positiveNumber(progress.speedBytesPerSecond);
  if(byteSpeed!==null)pieces.push(`속도 ${formatBytes(byteSpeed)}/s`);
  if (mediaSeconds !== null) pieces.push(`처리된 영상 ${formatDuration(mediaSeconds)}`);
  if (duration !== null) pieces.push(`전체 길이 ${formatDuration(duration)} (${durationSourceLabel(known?.source)})`);
  if (speed !== null) pieces.push(`속도 ${typeof progress.speed === "string" ? progress.speed.trim() : `${speed}x`}`);
  if (state === "running" && percent !== null && eta !== null) pieces.push(`예상 남은 시간 ${formatDuration(Math.ceil(eta))}`);
  const durationChecked = metadata.some(item => item.durationUnknown === true || item.durationSource === "unknown");
  const skippedInputProbe = metadata.some(item => item.inputProbeSkipped === true);
  const note = state === "probing" ? (skippedInputProbe ? "입력 Probe 생략 선택됨 · DRM 및 다운로드 요청을 확인하는 중입니다…" : "전체 길이와 영상·음성 트랙을 확인하는 중입니다…")
    : state === "finalizing" ? "출력 파일의 영상·음성 트랙을 검증하고 파일을 마무리하는 중입니다…"
    : state === "running" && (job.engine==='youtube'||progress.engine==='youtube') ? "영상·음성 트랙 기준 진행률입니다. 합치기와 출력 검증 후 완료됩니다. 남은 시간은 마지막 트랙에서만 표시합니다."
    : state === "running" && live && duration === null ? "라이브 스트림으로 확인되었습니다. 종료 시점이 정해지지 않아 진행률과 남은 시간 대신 처리된 시간과 저장량을 표시합니다."
    : state === "running" && percent === null && duration === null && skippedInputProbe ? "입력 Probe를 생략하여 전체 길이를 알 수 없습니다. 처리된 시간과 저장량을 표시합니다."
    : state === "running" && percent === null && duration === null ? durationChecked
      ? "Probe와 스트림에서 전체 길이를 확인하지 못했습니다. 처리된 시간과 저장량을 표시합니다."
      : "아직 전체 길이 정보를 받지 못했습니다. Probe 결과 또는 스트림 메타데이터가 도착하면 진행률을 표시합니다."
    : state === "running" && mediaSeconds === null && duration !== null ? "전체 길이를 확인했습니다. 첫 진행 정보를 기다리는 중입니다…"
    : state === "running" && eta === null ? "다운로드 속도를 측정하면 예상 남은 시간이 표시됩니다."
    : "";
  return { label: JOB_LABELS[state] ?? "상태 확인 중", percent, metrics: pieces.join(" · "), note };
}

export function isHostReady(value: unknown): boolean {
  const response = value as { type?: string; payload?: { ffmpegAvailable?: boolean } } | null;
  return response?.type === "health_result" && response.payload?.ffmpegAvailable === true;
}

export function hostHealthLabel(value: unknown): string {
  const payload = record(record(value).payload);
  const version = typeof payload.hostVersion === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(payload.hostVersion) ? payload.hostVersion : null;
  const status = isHostReady(value) ? "FFmpeg 정상" : "Host 연결 또는 FFmpeg 확인 필요 — 새로고침으로 재확인";
  if (!version) return `Host 버전 확인 안 됨 · ${status}`;
  const [major = 0, minor = 0, patch = 0] = version.split(/[.+-]/).map(Number);
  const older = major === 0 && (minor === 0 || (minor === 1 && patch < 2));
  return `Host v${version} · ${status}${older ? " — 구버전 Host: 진행률·음성 검증 기능을 사용하려면 설치된 Host를 갱신하세요." : ""}`;
}

export function orderCandidates(items: MediaCandidate[]): MediaCandidate[] {
  return [...items].sort((a, b) => {
    const aBlocked = candidateControlState(a, true).underlyingStreamRequired;
    const bBlocked = candidateControlState(b, true).underlyingStreamRequired;
    const quality = (candidate: MediaCandidate) => {
      const p = candidate.probeSummary;
      return !p ? 1 : p.videoCount > 0 && p.audioCount > 0 ? 3 : p.videoCount > 0 ? 0 : -1;
    };
    return Number(aBlocked) - Number(bBlocked)
      || Number(a.flags.likelyAdvertisement) - Number(b.flags.likelyAdvertisement)
      || quality(b) - quality(a)
      || (b.probeSummary?.height ?? 0) - (a.probeSummary?.height ?? 0)
      || b.confidenceScore - a.confidenceScore || b.lastSeenAt - a.lastSeenAt;
  });
}

export function candidateControlState(candidate: MediaCandidate, hostReady: boolean): CandidateControlState {
  const underlyingStreamRequired = candidate.flags.blobUrl || candidate.url.toLowerCase().startsWith("blob:") || !isAllowedHostUrl(candidate.url);
  const disabled = underlyingStreamRequired || !hostReady;
  return {
    probeDisabled: disabled,
    downloadDisabled: disabled,
    sessionDisabled: underlyingStreamRequired,
    underlyingStreamRequired,
    reason: underlyingStreamRequired ? "실제 HTTP(S) 미디어 주소가 필요합니다." : !hostReady ? "Native Host와 FFmpeg 연결을 확인하세요." : undefined,
  };
}

export function presentHostResponse(value: unknown): PresentedResponse {
  const technical = safeJson(value);
  if (!value || typeof value !== "object") return { message: "요청 결과를 확인할 수 없습니다.", technical, isError: true };
  const response = value as Record<string, any>;
  if (response.ok === false) return { message: friendlyError(`${response.errorCode ?? ""} ${String(response.error ?? "요청에 실패했습니다.")}`), technical, isError: true };
  const payload = response.payload && typeof response.payload === "object" ? response.payload as Record<string, unknown> : {};
  if (response.type === "protocol_error" || response.type === "job_failed") return { message: friendlyError(`${payload.errorCode ?? ""} ${String(payload.errorSummary ?? "요청에 실패했습니다.")}`), technical, isError: true };
  if (response.type === "probe_result") {
    const duration = finiteNumber(payload.duration);
    const videos = Array.isArray(payload.videoStreams) ? payload.videoStreams.length : null;
    const audios = Array.isArray(payload.audioStreams) ? payload.audioStreams.length : null;
    const silent = videos !== null && videos > 0 && audios === 0;
    const message = `길이 ${duration !== null && duration >= 0 ? formatDuration(duration) : "알 수 없음"} · 영상 ${videos === null ? "확인 못함" : `${videos}개`} · 음성 ${audios === null ? "확인 못함" : `${audios}개`}`;
    return { message: message + (silent ? `\n주의: ${NO_AUDIO_WARNING}` : ""), technical, isError: false, isWarning: silent };
  }
  if (response.type === "job_started") return { message: "다운로드를 시작했습니다.", technical, isError: false };
  if (response.type === "job_completed") return { message: "다운로드가 완료되었습니다.", technical, isError: false };
  if (response.type === "job_cancelled") return { message: "다운로드가 취소되었습니다.", technical, isError: false };
  if (response.type === "job_progress") {
    const progress = presentJobProgress({ ...payload, state: typeof payload.state === "string" ? payload.state : "running", progress: payload.progress && typeof payload.progress === "object" ? payload.progress : payload });
    return { message: [progress.label, progress.metrics, progress.note].filter(Boolean).join("\n"), technical, isError: false };
  }
  return { message: "요청이 완료되었습니다.", technical, isError: false };
}

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (raw.includes("저장된 영상 파일을 찾을 수 없습니다") || raw.includes("저장 폴더를 찾을 수 없습니다")) return "저장된 파일 또는 폴더를 찾을 수 없습니다. 이동하거나 삭제했는지 확인하세요.";
  if (raw.includes("파일 또는 폴더를 열지 못했습니다")) return "파일을 열지 못했습니다. Windows 기본 재생 앱과 저장 경로를 확인하세요.";
  if (raw.includes("완료된 다운로드만")) return "다운로드가 완료된 후 재생하거나 파일을 선택할 수 있습니다.";
  if (lower.includes("audio_stream_missing") || lower.includes("output_audio_missing") || lower.includes("no audio stream")) return NO_AUDIO_WARNING;
  if (lower.includes("underlying_stream_required") || lower.includes("only http(s)") || lower.includes("only http")) return "브라우저 내부 주소는 직접 처리할 수 없습니다. 실제 HTTP(S) 미디어 주소를 선택하세요.";
  if (lower.includes("unsupported_drm") || lower.includes("drm-protected") || lower.includes("contentprotection")) return "DRM으로 보호된 미디어는 지원하지 않습니다.";
  if (lower.includes("403") || lower.includes("401")) return "서버가 요청을 거부했습니다. URL 만료, Referer 또는 사이트 세션이 필요한지 확인하세요.";
  if (lower.includes("disconnected") || lower.includes("native host")) return "Native Host 연결을 확인하세요.";
  return "요청을 처리하지 못했습니다. 기술 상세를 확인하고 다시 시도하세요.";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function nonnegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function playbackSpeed(value: unknown): number | null {
  if (typeof value === "number") return positiveNumber(value);
  return typeof value === "string" && /^\s*\d+(?:\.\d+)?x\s*$/.test(value) ? positiveNumber(Number(value.trim().slice(0, -1))) : null;
}

function durationSourceLabel(source: unknown): string {
  if (source === "extractor") return "보조 엔진으로 확인";
  if (source === "stream") return "스트림 정보로 확인";
  if (source === "requested") return "지정한 녹화 길이";
  if (["format", "probe", "probe_hint"].includes(String(source))) return "Probe로 확인";
  return "Host에서 확인";
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const rest = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (key, item: unknown) => {
      if (/^(?:cookie(?:header)?|set-cookie|authorization|proxy-authorization|access[_-]?token|token|signature|sig|key)$/i.test(key)) return "[REDACTED]";
      if (typeof item !== "string") return item;
      // Display-only redaction never touches the URL used by the Host.
      return item.replace(/https?:\/\/[^\s"<>]+/gi, raw => {
        try {
          const url = new URL(raw);
          url.username = "";
          url.password = "";
          for (const name of [...url.searchParams.keys()]) url.searchParams.set(name, "[REDACTED]");
          return url.toString();
        } catch { return "[REDACTED_URL]"; }
      }).replace(/\b(?:Cookie|Authorization|Set-Cookie)\s*:[^\r\n]+/gi, "[REDACTED_HEADER]");
    }, 2) ?? "";
  } catch { return "기술 상세를 표시할 수 없습니다."; }
}
