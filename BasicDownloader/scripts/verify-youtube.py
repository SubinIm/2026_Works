"""Real, anonymous YouTube acceptance through the framed Native Host protocol.

Requires explicit URL and executable paths. Never prints extractor metadata/URLs.
Leaves successful media and a sanitized report in the supplied workspace folder.
"""
from __future__ import annotations
import argparse, json, os, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "native-host" / "src"))
sys.path.insert(0, str(REPO / "native-host" / "tests"))
from test_acceptance_e2e import HostHarness
from stream_host.job_registry import process_exists


def main() -> None:
    parser = argparse.ArgumentParser()
    for name in ("host", "engine", "node", "ffmpeg", "root", "url"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    os.environ["PSD_TEST_HOST_EXE"] = str(Path(args.host).resolve())
    # HostHarness normally uses the fixture FFmpeg location; keep this configurable.
    import test_acceptance_e2e
    test_acceptance_e2e.FFMPEG = Path(args.ffmpeg).resolve()
    ffmpeg = test_acceptance_e2e.FFMPEG
    host = HostHarness(root / "downloads", root / "state", root / "host.log")
    settings = {"youtubeEnabled": True, "ytDlpPath": str(Path(args.engine).resolve()),
                "jsRuntimePath": str(Path(args.node).resolve()), "ffmpegPath": str(ffmpeg)}
    report: dict = {"cookieMode": "anonymous", "tests": []}

    def passed(name: str, **details) -> None:
        report["tests"].append({"name": name, "status": "PASS", **details})
        print(json.dumps(report["tests"][-1], ensure_ascii=False), flush=True)

    try:
        health = host.request("health_check", {"settings": settings})
        assert health["payload"].get("youtubeAvailable") is True, health
        assert health["payload"].get("ffmpegAvailable") is True, health
        passed("compiled Host health", version=health["payload"]["hostVersion"])
        probe = host.request("youtube_probe", {"url": args.url, "maxHeight": 720, "container": "mkv"}, 75)
        assert probe["type"] == "probe_result", probe
        info = probe["payload"]
        assert info["videoStreams"] and info["audioStreams"], info
        assert max(s["height"] for s in info["videoStreams"]) <= 720
        passed("anonymous page Probe", duration=info["duration"], heights=info["heights"],
               selectedFormatIds=info["selectedFormatIds"])
        for do_probe in (True, False):
            started = host.request("youtube_download", {"url": args.url, "filename": f"native-guest-{do_probe}",
                "maxHeight": 720, "container": "mkv", "probeBeforeDownload": do_probe})
            assert started["type"] == "job_started", started
            job_id = started["payload"]["jobId"]
            result = host.wait_for_job(job_id, 300)
            assert result["type"] == "job_completed", result
            progress = [m["payload"] for m in host.seen if m.get("type") == "job_progress"
                        and m.get("payload", {}).get("jobId") == job_id and m["payload"].get("engine") == "youtube"]
            assert progress, "No parsed extractor progress"
            assert all(0 <= p["percent"] <= 98 for p in progress)
            assert all(a["percent"] <= b["percent"] for a, b in zip(progress, progress[1:]))
            output = Path(result["payload"]["outputPath"])
            metadata = subprocess.run([str(ffmpeg.with_name("ffprobe.exe")), "-v", "error", "-show_streams", "-show_format",
                                       "-of", "json", str(output)], capture_output=True, text=True, timeout=30)
            assert metadata.returncode == 0 and not metadata.stderr, metadata.stderr
            media = json.loads(metadata.stdout)
            assert {s["codec_type"] for s in media["streams"]} >= {"video", "audio"}
            duration = float(media["format"]["duration"])
            assert abs(duration - info["duration"]) <= max(2, info["duration"] * .01)
            decoded = subprocess.run([str(ffmpeg), "-v", "error", "-i", str(output), "-f", "null", "-"],
                                     capture_output=True, timeout=180)
            assert decoded.returncode == 0 and not decoded.stderr, "FFmpeg decode errors"
            assert not list(output.parent.glob("*.partial.*"))
            # The completion event precedes finally cleanup by a few milliseconds.
            deadline = time.monotonic() + 5
            work = output.parent / (".youtube-" + job_id)
            while work.exists() and time.monotonic() < deadline: time.sleep(.05)
            assert not work.exists(), "Engine partial folder left after success"
            if not do_probe: assert result["payload"]["probe"]["inputProbeSkipped"] is True
            passed("download + AV + duration + decode + partial cleanup", inputProbe=do_probe,
                   outputPath=str(output), duration=duration, progressEvents=len(progress))
        # Cancellation while the actual extractor subprocess is alive, not a queued-only test.
        started = host.request("youtube_download", {"url": args.url, "filename": "cancel-test", "container": "mkv", "maxHeight": 720})
        assert started["type"] == "job_started", started
        job_id = started["payload"]["jobId"]
        deadline = time.monotonic() + 20
        record = None
        while time.monotonic() < deadline:
            record = host.request("list_jobs", {})["payload"]["jobs"]
            record = next(r for r in record if r["jobId"] == job_id)
            persisted = json.loads((root / "state" / (job_id + ".json")).read_text(encoding="utf-8"))
            if persisted.get("pid") and process_exists(persisted["pid"]): break
            time.sleep(.1)
        else: raise AssertionError("No live extractor PID for cancellation")
        pid = persisted["pid"]
        cancelled = host.request("cancel_job", {"jobId": job_id})
        assert cancelled["payload"]["accepted"] is True, cancelled
        assert host.wait_for_job(job_id, 30)["type"] == "job_cancelled"
        assert not process_exists(pid), f"Extractor PID {pid} survived cancel"
        passed("cancel real extractor process tree", pid=pid)
        serialized = json.dumps(host.seen)
        persisted_text = "".join(p.read_text(encoding="utf-8") for p in (root / "state").glob("*.json"))
        logs = (root / "host.log").read_text(encoding="utf-8") if (root / "host.log").exists() else ""
        for forbidden in ("googlevideo.com", "Cookie:", "Authorization:", "http_headers", '"formats":'):
            assert forbidden not in serialized + persisted_text + logs, forbidden
        passed("no raw signed URLs / cookies / extractor metadata in protocol, state, log")
    except Exception as exc:
        report["tests"].append({"name": "acceptance run", "status": "FAIL", "errorType": type(exc).__name__})
        raise
    finally:
        host.close()
        (root / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__": main()
