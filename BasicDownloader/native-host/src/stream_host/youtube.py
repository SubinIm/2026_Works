"""Opt-in, anonymous YouTube engine. Never forward browser cookies or raw metadata."""
from __future__ import annotations
import json, math, os, re, shutil, subprocess
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit


class YoutubeError(RuntimeError):
    def __init__(self, message: str, code: str = "youtube_engine_error"):
        super().__init__(message); self.code = code


def page_url(raw: Any) -> str:
    if not isinstance(raw, str) or len(raw) > 2048:
        raise ValueError("YouTube 영상 페이지 주소가 필요합니다.")
    u = urlsplit(raw)
    if u.scheme != "https" or u.username or u.password or u.port not in (None, 443):
        raise ValueError("안전한 HTTPS YouTube 페이지 주소만 허용합니다.")
    if u.hostname == "youtu.be":
        ident = u.path.removeprefix("/")
    elif u.hostname in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        ident = parse_qs(u.query).get("v", [""])[0] if u.path == "/watch" else u.path.removeprefix("/shorts/") if u.path.startswith("/shorts/") else ""
    else:
        raise ValueError("YouTube 영상 페이지 주소만 허용합니다.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", ident):
        raise ValueError("유효한 YouTube 영상 ID가 필요합니다.")
    return "https://www.youtube.com/watch?v=" + ident


def height_limit(value: Any) -> int | None:
    if value is None: return None
    if isinstance(value, bool) or not isinstance(value,int) or value not in {144, 240, 360, 480, 720, 1080, 1440, 2160, 4320}:
        raise ValueError("지원되는 최대 해상도를 선택하세요.")
    return int(value)


def format_selector(height: int | None, audio_only: bool, container: str) -> str:
    height = height_limit(height)
    if not isinstance(audio_only, bool) or container not in {"mkv", "mp4"}:
        raise ValueError("잘못된 YouTube 저장 옵션입니다.")
    cap = f"[height<={height}]" if height else ""
    if container == "mp4":
        return "ba[ext=m4a]" if audio_only else f"bv[ext=mp4][vcodec^=avc1]{cap}+ba[ext=m4a]/b[ext=mp4]{cap}"
    return "ba" if audio_only else f"bv{cap}+ba/b{cap}"


def executable(raw: str, label: str) -> Path:
    found = Path(raw) if raw else Path(shutil.which("yt-dlp" if label == "yt-dlp" else "node") or "")
    if not found.is_absolute() or not found.is_file() or found.suffix.lower() != ".exe":
        raise YoutubeError(f"설정에서 {label} 실행 파일의 전체 경로를 지정하세요.", "youtube_engine_missing")
    return found.resolve()


class YoutubeEngine:
    def __init__(self, path: str, runtime: str):
        self.path = executable(path, "yt-dlp"); self.runtime = executable(runtime, "Node.js")

    def base(self) -> list[str]:
        return [str(self.path), "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-cache-dir",
                "--no-js-runtimes", "--js-runtimes", "node:" + str(self.runtime),
                "--socket-timeout", "15", "--retries", "1", "--fragment-retries", "1", "--no-warnings"]

    def probe(self, url: str, height: int | None = None, audio_only: bool = False, container: str = "mkv",
              process_started: Callable[[Any], None] | None = None) -> dict[str, Any]:
        url = page_url(url)
        command = self.base() + ["--skip-download", "--dump-single-json", "-f", format_selector(height, audio_only, container), url]
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
                                   shell=False, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0, start_new_session=os.name != "nt")
        try:
            if process_started: process_started(process)
            stdout, stderr = process.communicate(timeout=60)
            if process.returncode: raise engine_failure(stderr)
            if len(stdout) > 20_000_000: raise YoutubeError("YouTube 형식 정보가 너무 큽니다.")
            return summarize(json.loads(stdout), url, audio_only)
        except subprocess.TimeoutExpired:
            raise YoutubeError("YouTube 형식 조회 시간이 초과되었습니다.") from None
        finally:
            if process.poll() is None:
                from .jobs import _terminate_tree
                _terminate_tree(process.pid, process)
            for stream in (process.stdout, process.stderr):
                if stream: stream.close()

    def command(self, url: str, work: Path, ffmpeg: Path, height: int | None, audio_only: bool, container: str) -> list[str]:
        # Only a fixed output template is passed to yt-dlp; user filenames cannot inject template fields.
        template = 'PSD_PROGRESS:{"downloaded":%(progress.downloaded_bytes)j,"total":%(progress.total_bytes)j,"estimated":%(progress.total_bytes_estimate)j,"eta":%(progress.eta)j,"speed":%(progress.speed)j,"formatId":%(info.format_id)j}'
        return self.base() + ["--newline", "--no-simulate", "--progress", "--progress-delta", "0.3", "--output-na-placeholder", "null", "--progress-template", "download:" + template,
                              "--ffmpeg-location", str(ffmpeg), "-f", format_selector(height, audio_only, container),
                              "--merge-output-format", container, "--remux-video", container, "--no-overwrites",
                              "-o", str(work / "media.partial.%(ext)s"), page_url(url)]


def number(raw: Any) -> float | None:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)): return None
    return float(raw) if math.isfinite(raw) and raw >= 0 else None


def summarize(info: dict[str, Any], url: str, audio_only: bool = False) -> dict[str, Any]:
    if info.get("id") != parse_qs(urlsplit(page_url(url)).query)["v"][0]:
        raise YoutubeError("요청한 영상과 조회 결과가 일치하지 않습니다.")
    if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
        raise YoutubeError("YouTube 보조 엔진은 현재 완료된 일반 영상만 지원합니다.")
    formats = [f for f in info.get("formats", []) if isinstance(f, dict) and f.get("has_drm") is not True]
    selected = info.get("requested_formats") or [info]
    if any(f.get("has_drm") is True for f in selected):
        raise YoutubeError("DRM 영상은 지원하지 않습니다.", "unsupported_drm")
    def stream(f: dict[str, Any], codec: str, index: int) -> dict[str, Any] | None:
        value = f.get(codec)
        if not isinstance(value, str) or value in {"none", "unknown", ""}: return None
        result = {"index": index, "codec_name": value[:60]}
        for key in ("width", "height"):
            if number(f.get(key)) is not None: result[key] = int(f[key])
        return result
    video = [s for i, f in enumerate(selected) if (s := stream(f, "vcodec", i)) and not audio_only]
    audio = [s for i, f in enumerate(selected) if (s := stream(f, "acodec", i))]
    if not audio or (not audio_only and not video):
        raise YoutubeError("음성이 포함된 저장 형식을 찾지 못했습니다.", "audio_stream_missing")
    heights = sorted({int(f["height"]) for f in formats if number(f.get("height")) and f.get("vcodec") not in {None, "none"}})
    duration = number(info.get("duration"))
    # Never return URLs, cookies, HTTP headers, raw formats, or arbitrary metadata tags.
    title = re.sub(r"[\x00-\x1f\x7f]", " ", str(info.get("title") or "YouTube video"))[:300]
    from .logging_config import redact_text
    title = redact_text(title)
    return {"format": "youtube", "engine": "yt-dlp", "videoId": info["id"], "title": title, "duration": duration,
            "durationUnknown": duration is None, "durationSource": "extractor" if duration else "unknown", "isLive": False,
            "videoStreams": video, "audioStreams": audio, "subtitleStreams": [], "selectedStreamIndices": list(range(len(selected))),
            "heights": heights, "selectedFormatIds": [str(f.get("format_id", "")) for f in selected if re.fullmatch(r"[A-Za-z0-9_.+-]{1,80}",str(f.get("format_id","")))]}


def engine_failure(stderr: str) -> YoutubeError:
    # Raw extractor errors may contain signed URLs or session data; keep only a classification.
    value = stderr.lower()
    if "drm" in value: return YoutubeError("DRM 영상은 지원하지 않습니다.", "unsupported_drm")
    if "sign in" in value or "403" in value or "po token" in value:
        return YoutubeError("YouTube가 게스트 요청을 거부했습니다. 인증 또는 PO Token이 필요할 수 있습니다. 쿠키는 자동으로 보내지 않습니다.", "youtube_auth_required")
    if "requested format" in value: return YoutubeError("선택한 해상도·컨테이너에 맞는 형식이 없습니다.", "youtube_format_unavailable")
    return YoutubeError("YouTube 엔진 요청에 실패했습니다. 네트워크와 엔진 버전을 확인하세요.")


class YoutubeProgress:
    def __init__(self, ids: list[str], expected: int = 2):
        self.ids = list(ids); self.expected = len(ids) or expected; self.dynamic = not ids
        self.downloaded: dict[str, float] = {}; self.fractions: dict[str, float] = {}
    def feed(self, line: str) -> dict[str, Any] | None:
        if not line.startswith("PSD_PROGRESS:"): return None
        try: value = json.loads(line.removeprefix("PSD_PROGRESS:"))
        except (ValueError, TypeError): return None
        ident = str(value.get("formatId", ""))
        if self.dynamic and ident not in self.ids and len(self.ids)<self.expected and re.fullmatch(r"[A-Za-z0-9_.+-]{1,80}",ident):self.ids.append(ident)
        if ident not in self.ids: return None
        downloaded = number(value.get("downloaded")); total = number(value.get("total")) or number(value.get("estimated"))
        if downloaded is None: return None
        self.downloaded[ident] = max(self.downloaded.get(ident, 0), downloaded)
        if total: self.fractions[ident] = max(self.fractions.get(ident, 0), min(1, downloaded / total))
        return {"percent": min(98, sum(self.fractions.values()) / max(1, self.expected) * 98),
                "totalBytes": sum(self.downloaded.values()), "speedBytesPerSecond": number(value.get("speed")),
                "etaSeconds": number(value.get("eta")) if sum(f >= 1 for f in self.fractions.values()) >= self.expected - 1 else None}


def cleanup_work(work: Path, root: Path, job_id: str, keep: bool) -> None:
    from .validation import validate_job_id
    validate_job_id(job_id)
    if keep or not work.exists(): return
    if work.is_symlink() or work.resolve().parent != root.resolve() or work.name != ".youtube-" + job_id:
        raise ValueError("임시 YouTube 폴더 경계 검증 실패")
    # Only direct engine-created files, never recursive deletion or followed symlinks.
    for item in work.iterdir():
        if item.is_file() or item.is_symlink(): item.unlink()
    work.rmdir()
