from __future__ import annotations
import json, math, os, re, subprocess
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable
from .ffmpeg_commands import probe_command
from .models import RequestContext
from .logging_config import redact_text


def probe(ffprobe: Path, url: str, context: RequestContext, timeout: float = 20,
          process_started: Callable[[Any], None] | None = None) -> dict[str, Any]:
    """Track ffprobe so a slow input probe can be cancelled with its job."""
    process = subprocess.Popen(
        probe_command(ffprobe, url, context), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace", shell=False,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        start_new_session=os.name != "nt",
    )
    try:
        if process_started:
            process_started(process)
        stdout, stderr = process.communicate(timeout=timeout)
        if process.returncode:
            raise RuntimeError(_summary(stderr))
        return summarize(json.loads(stdout))
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("FFprobe 미디어 분석 시간이 초과되었습니다. 연결 및 스트림 상태를 확인하세요.") from exc
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        for stream in (process.stdout, process.stderr):
            if stream is not None:
                stream.close()


def summarize(data: dict[str, Any]) -> dict[str, Any]:
    fmt = data.get("format", {})
    duration = _positive_float(fmt.get("duration"))
    streams = data.get("streams", [])
    # Arbitrary metadata tags can contain signed URLs; do not return/persist them.
    result = {
        "format": fmt.get("format_name"), "duration": duration,
        "durationUnknown": duration is None, "durationSource": "format" if duration else "unknown",
        "isLive": False if duration else None, "liveConfirmed": False,
        "bitrate": _int(fmt.get("bit_rate")),
        "videoStreams": [_stream(s) for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")],
        "audioStreams": [_stream(s) for s in streams if s.get("codec_type") == "audio"],
        "subtitleStreams": [_stream(s) for s in streams if s.get("codec_type") == "subtitle"],
        "programs": [
            {"programId": _int(p.get("program_id")),
             "streamIndices": [s["index"] for s in p.get("streams", []) if isinstance(s.get("index"), int)]}
            for p in data.get("programs", [])
        ],
    }
    result["selectedStreamIndices"] = select_streams(result)
    if duration is None:
        selected = set(result["selectedStreamIndices"])
        known = [s["duration"] for s in result["videoStreams"] + result["audioStreams"]
                 if s["index"] in selected and s.get("duration") is not None]
        if known:
            result.update(duration=max(known), durationUnknown=False, durationSource="stream", isLive=False)
    return result


def with_manifest_timing(summary: dict[str, Any], is_live: bool | None) -> dict[str, Any]:
    """A live playlist's window length is not the total download duration."""
    if is_live is True:
        return {**summary, "duration": None, "durationUnknown": True, "durationSource": "unknown",
                "isLive": True, "liveConfirmed": True}
    if is_live is False:
        return {**summary, "isLive": False, "liveConfirmed": False}
    return summary


def select_streams(summary: dict[str, Any]) -> list[int]:
    """Choose one rendition, preserving HLS program linkage when provided."""
    videos = summary.get("videoStreams", [])
    audios = summary.get("audioStreams", [])
    if not videos:
        return [audios[0]["index"]] if audios else []
    programs = summary.get("programs", [])
    complete = []
    for program in programs:
        indices = program["streamIndices"]
        pv = [v for v in videos if v["index"] in indices]
        pa = [a for a in audios if a["index"] in indices]
        if pv and pa:
            complete.append((max(pv, key=_video_rank), pa[0]))
    if complete:
        video, audio = max(complete, key=lambda pair: _video_rank(pair[0]))
        return [video["index"], audio["index"]]
    video = max(videos, key=_video_rank)
    selected = [video["index"]]
    # DASH/MP4 have no programs; do not join explicitly unrelated HLS programs.
    if audios and not programs:
        selected.append(audios[0]["index"])
    return selected


def _video_rank(stream: dict[str, Any]) -> tuple[int, int]:
    return (int(stream.get("width", 0)) * int(stream.get("height", 0)), -int(stream["index"]))


def _stream(s: dict[str, Any]) -> dict[str, Any]:
    result = {k: s.get(k) for k in ("index", "codec_name", "width", "height", "r_frame_rate", "sample_rate", "channels", "channel_layout") if s.get(k) is not None}
    duration = _positive_float(s.get("duration"))
    if duration is None:
        ticks = _positive_float(s.get("duration_ts"))
        base = s.get("time_base")
        if ticks is not None and isinstance(base, str) and len(base) <= 64:
            try:
                duration = _positive_float(ticks * float(Fraction(base)))
            except (ValueError, ZeroDivisionError, OverflowError):
                pass
    if duration is None:
        # Matroska commonly provides DURATION rather than stream.duration.
        # Parse only this whitelisted value; never return arbitrary metadata.
        tags = s.get("tags", {})
        if isinstance(tags, dict):
            for key in ("DURATION", "duration"):
                value = tags.get(key)
                if isinstance(value, str) and re.fullmatch(r"\d{1,8}:[0-5]\d:[0-5]\d(?:\.\d{1,12})?", value):
                    hours, minutes, seconds = value.split(":")
                    duration = _positive_float(int(hours) * 3600 + int(minutes) * 60 + float(seconds))
                    if duration is not None:
                        break
    if duration is not None:
        result["duration"] = duration
    return result

def _positive_float(v: Any) -> float | None:
    value = _float(v)
    return value if value is not None and value > 0 else None

def _float(v:Any)->float|None:
    if isinstance(v, bool):return None
    try:
        value=float(v)
        return value if math.isfinite(value) else None
    except (TypeError,ValueError):return None
def _int(v:Any)->int|None:
    try:return int(v)
    except (TypeError,ValueError):return None
def _summary(stderr:str)->str:return redact_text(stderr.strip().splitlines()[-1])[:500] if stderr.strip() else "ffprobe failed"

