from __future__ import annotations

import io
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

from stream_host.job_registry import process_exists
from stream_host.protocol import encode_frame, read_frame


REPOSITORY = Path(__file__).parents[2]
FIXTURES = REPOSITORY / "fixtures"
FFMPEG = Path(os.environ.get("PSD_TEST_FFMPEG", r"C:\Program Files\DownloadHelper CoApp\ffmpeg.exe"))
FFPROBE = FFMPEG.with_name("ffprobe.exe")


class HostHarness:
    def __init__(self, download_root: Path, state_root: Path, log_path: Path) -> None:
        env = os.environ.copy()
        env.update({
            "PYTHONPATH": str(REPOSITORY / "native-host" / "src"),
            "PSD_FFMPEG_PATH": str(FFMPEG),
            "PSD_DOWNLOAD_ROOT": str(download_root),
            "PSD_STATE_ROOT": str(state_root),
            "PSD_LOG_PATH": str(log_path),
        })
        host_executable=os.environ.get("PSD_TEST_HOST_EXE");command=[host_executable] if host_executable else [sys.executable,"-m","stream_host"]
        self.process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=env,
        )
        self.messages: queue.Queue[dict[str, Any]] = queue.Queue()
        self.seen: list[dict[str, Any]] = []
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self) -> None:
        assert self.process.stdout is not None
        while True:
            message = read_frame(self.process.stdout)
            if message is None:
                return
            self.seen.append(message)
            self.messages.put(message)

    def request(self, type_: str, payload: dict[str, Any], timeout: float = 30) -> dict[str, Any]:
        message_id = str(uuid.uuid4())
        assert self.process.stdin is not None
        self.process.stdin.write(encode_frame({"protocolVersion": 1, "messageId": message_id, "type": type_, "payload": payload}))
        self.process.stdin.flush()
        deadline = time.monotonic() + timeout
        deferred: list[dict[str, Any]] = []
        try:
            while time.monotonic() < deadline:
                message = self.messages.get(timeout=max(0.01, deadline - time.monotonic()))
                if message.get("messageId") == message_id:
                    return message
                deferred.append(message)
        finally:
            for message in deferred:
                self.messages.put(message)
        raise TimeoutError(f"No response for {type_}")

    def wait_for_job(self, job_id: str, timeout: float = 45) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            message = self.messages.get(timeout=max(0.01, deadline - time.monotonic()))
            if message.get("payload", {}).get("jobId") == job_id and message.get("type") in {"job_completed", "job_failed", "job_cancelled"}:
                return message
        raise TimeoutError(f"Job {job_id} did not finish")

    def disconnect(self) -> None:
        if self.process.stdin:
            self.process.stdin.close()

    def close(self) -> None:
        if self.process.poll() is None:
            try:
                self.request("shutdown_when_idle", {}, 5)
            except (BrokenPipeError, TimeoutError):
                pass
        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        stderr_data=self.process.stderr.read() if self.process.stderr and not self.process.stderr.closed else b""
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream and not stream.closed:
                stream.close()
        if stderr_data:
            raise AssertionError(f"Native Host stderr was not empty: {stderr_data.decode('utf-8','replace')}")


class QuietFixtureServer(ThreadingHTTPServer):
    def handle_error(self, request: object, client_address: object) -> None:
        return


@unittest.skipUnless(FFMPEG.is_file() and FFPROBE.is_file(), "FFmpeg/FFprobe executable not found")
class MediaAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        sys.path.insert(0, str(FIXTURES))
        from server import FixtureHandler
        class SilentFixtureHandler(FixtureHandler):
            def log_message(self, format: str, *args: object) -> None:
                return
        handler = partial(SilentFixtureHandler, directory=str(FIXTURES))
        cls.server = QuietFixtureServer(("127.0.0.1", 0), handler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.downloads, self.state, self.log = root / "downloads", root / "state", root / "host.log"
        self.host = HostHarness(self.downloads, self.state, self.log)

    def tearDown(self) -> None:
        self.host.close()
        self.temp.cleanup()

    def test_audio_only_output_with_and_without_input_probe(self) -> None:
        for kind,path in [("mp4","direct.mp4"),("hls","stream.m3u8"),("dash","separate-av.mpd")]:
            for do_probe in (True,False):
                with self.subTest(kind=kind,probe=do_probe):
                    started=self.host.request("start_download",{"url":self.base+"/generated/"+path,"mediaKind":kind,"filename":f"audio-{kind}-{do_probe}","container":"auto" if do_probe else "mkv","audioOnly":True,"probeBeforeDownload":do_probe})
                    self.assertEqual(started["type"],"job_started",started)
                    result=self.host.wait_for_job(started["payload"]["jobId"])
                    self.assertEqual(result["type"],"job_completed",result)
                    output=Path(result["payload"]["outputPath"])
                    checked=subprocess.run([str(FFPROBE),"-v","error","-show_streams","-show_format","-of","json",str(output)],capture_output=True,text=True,timeout=15)
                    self.assertEqual(checked.returncode,0,checked.stderr)
                    info=json.loads(checked.stdout)
                    self.assertEqual({s["codec_type"] for s in info["streams"]},{"audio"})
                    self.assertLessEqual(abs(float(info["format"]["duration"])-8),1)
                    decoded=subprocess.run([str(FFMPEG),"-v","error","-i",str(output),"-f","null","-"],capture_output=True,timeout=30)
                    self.assertEqual(decoded.returncode,0,decoded.stderr)
                    self.assertEqual(decoded.stderr,b"")
                    self.assertFalse(list(output.parent.glob("*.partial.*")))

    def test_download_without_input_probe(self) -> None:
        for name,path,kind in [("direct","direct.mp4","mp4"),("hls","stream.m3u8","hls"),("dash","separate-av.mpd","dash")]:
            with self.subTest(kind=kind):
                started=self.host.request("start_download",{"url":self.base+"/generated/"+path,"mediaKind":kind,"filename":"no-probe-"+name,"probeBeforeDownload":False})
                self.assertEqual(started["type"],"job_started",started)
                result=self.host.wait_for_job(started["payload"]["jobId"])
                self.assertEqual(result["type"],"job_completed",result)
                self.assertTrue(result["payload"]["probe"]["inputProbeSkipped"])
                output=Path(result["payload"]["outputPath"])
                inspected=subprocess.run([str(FFPROBE),"-v","error","-show_streams","-show_format","-of","json",str(output)],capture_output=True,text=True,timeout=15)
                self.assertEqual(inspected.returncode,0,inspected.stderr)
                metadata=json.loads(inspected.stdout)
                self.assertTrue({"video","audio"}.issubset({s["codec_type"] for s in metadata["streams"]}))
                self.assertLessEqual(abs(float(metadata["format"]["duration"])-8),1)
                decoded=subprocess.run([str(FFMPEG),"-v","error","-i",str(output),"-f","null","-"],capture_output=True,timeout=30)
                self.assertEqual(decoded.returncode,0,decoded.stderr)
                self.assertEqual(decoded.stderr,b"")
                self.assertFalse(list(output.parent.glob("*.partial.*")))

    def test_probe_download_streams_duration_and_decode(self) -> None:
        fixtures = [
            ("direct", "/generated/direct.mp4", "mp4", None),
            ("hls-ts", "/generated/stream.m3u8", "hls", None),
            ("hls-fmp4", "/generated/fmp4.m3u8", "hls", None),
            ("hls-separate", "/generated/separate-av.m3u8", "hls", None),
            ("dash", "/generated/stream.mpd", "dash", None),
            ("dash-separate", "/generated/separate-av.mpd", "dash", None),
            ("hls-live", "/generated/live.m3u8", "hls", 3),
        ]
        for name, path, kind, duration_limit in fixtures:
            with self.subTest(fixture=name):
                url = self.base + path
                context = {"pageUrl": self.base + "/player/", "referer": self.base + "/player/", "userAgent": "PSD-Acceptance/1"}
                probe = self.host.request("probe_media", {"url": url, "mediaKind": kind, "requestContext": context})
                self.assertEqual(probe["type"], "probe_result", probe)
                self.assertTrue(probe["payload"]["videoStreams"], probe)
                self.assertTrue(probe["payload"]["audioStreams"], probe)
                payload: dict[str, Any] = {"url": url, "mediaKind": kind, "filename": name, "container": "auto", "overwrite": "overwrite", "liveMode": "duration" if duration_limit else "until_stopped", "requestContext": context}
                if duration_limit:
                    self.assertIsNone(probe["payload"]["duration"], probe)
                    self.assertTrue(probe["payload"]["isLive"], probe)
                    self.assertTrue(probe["payload"]["liveConfirmed"], probe)
                    payload["durationSeconds"] = duration_limit
                    expected_source = "requested"
                else:
                    self.assertLessEqual(abs(probe["payload"]["duration"] - 8), 1.0, probe)
                    self.assertFalse(probe["payload"]["isLive"], probe)
                    self.assertFalse(probe["payload"]["liveConfirmed"], probe)
                    payload["verifiedDurationSeconds"] = probe["payload"]["duration"]
                    expected_source = probe["payload"]["durationSource"]
                    self.assertIn(expected_source, {"format", "stream"})
                started = self.host.request("start_download", payload)
                self.assertEqual(started["type"], "job_started", started)
                completed = self.host.wait_for_job(started["payload"]["jobId"])
                self.assertEqual(completed["type"], "job_completed", completed)
                progress = [message["payload"] for message in self.host.seen if message.get("type") == "job_progress" and message.get("payload", {}).get("jobId") == started["payload"]["jobId"]]
                self.assertTrue(progress, f"no progress event for {name}")
                downloading = [item for item in progress if item.get("phase") == "downloading"]
                self.assertTrue(downloading, f"no downloading progress for {name}: {progress}")
                expected_duration = duration_limit or 8
                for item in downloading:
                    self.assertLessEqual(abs(item["durationSeconds"] - expected_duration), 1.0, item)
                    self.assertEqual(item["durationSource"], expected_source, item)
                estimates = [item for item in downloading if isinstance(item.get("percent"), (int, float))]
                self.assertTrue(estimates, f"known VOD/capped live must have percentage: {progress}")
                self.assertTrue(any(isinstance(item.get("etaSeconds"), (int, float)) for item in estimates), f"known VOD/capped live must have ETA once speed is available: {progress}")
                for item in estimates:
                    self.assertGreaterEqual(item["percent"], 0, item)
                    self.assertLessEqual(item["percent"], 100, item)
                    if item.get("etaSeconds") is not None:
                        self.assertGreaterEqual(item["etaSeconds"], 0, item)
                output = Path(completed["payload"]["outputPath"])
                metadata = _probe_file(output)
                types = {stream.get("codec_type") for stream in metadata["streams"]}
                self.assertIn("video", types)
                self.assertIn("audio", types)
                actual_duration = float(metadata["format"]["duration"])
                expected = duration_limit or 8
                self.assertLessEqual(abs(actual_duration - expected), 1.0, (actual_duration, expected))
                decoded = subprocess.run([str(FFMPEG), "-v", "error", "-i", str(output), "-f", "null", "-"], capture_output=True, timeout=30)
                self.assertEqual(decoded.returncode, 0, decoded.stderr.decode("utf-8", "replace"))
                self.assertEqual(decoded.stderr, b"")
                self.assertFalse(any(output.parent.glob(f"{output.stem}.partial{output.suffix}")))
                jobs = self.host.request("list_jobs", {})["payload"]["jobs"]
                listed = next(job for job in jobs if job["jobId"] == started["payload"]["jobId"])
                persisted = json.loads((self.state / f'{listed["jobId"]}.json').read_text(encoding="utf-8"))
                for record in (listed, persisted):
                    self.assertEqual(record["state"], "completed", record)
                    self.assertLessEqual(abs(record["durationSeconds"] - expected_duration), 1.0, record)
                    self.assertEqual(record["durationSource"], expected_source, record)
                    self.assertEqual(record["progress"]["durationSource"], expected_source, record)
                    self.assertLessEqual(abs(record["progress"]["durationSeconds"] - expected_duration), 1.0, record)

    def test_short_probe_hint_does_not_trim_natural_duration(self) -> None:
        url = self.base + "/generated/direct.mp4"
        context = {"pageUrl": self.base + "/player/", "referer": self.base + "/player/"}
        manual_probe = self.host.request("probe_media", {"url": url, "mediaKind": "mp4", "requestContext": context})
        self.assertEqual(manual_probe["type"], "probe_result", manual_probe)
        self.assertLessEqual(abs(manual_probe["payload"]["duration"] - 8), 1.0, manual_probe)
        # A stale short estimate must never become an implicit FFmpeg -t limit.
        started = self.host.request("start_download", {
            "url": url, "mediaKind": "mp4", "filename": "short-hint-full-vod",
            "container": "auto", "overwrite": "overwrite", "liveMode": "until_stopped",
            "verifiedDurationSeconds": 3, "requestContext": context,
        })
        self.assertEqual(started["type"], "job_started", started)
        job_id = started["payload"]["jobId"]
        completed = self.host.wait_for_job(job_id)
        self.assertEqual(completed["type"], "job_completed", completed)
        output = Path(completed["payload"]["outputPath"])
        metadata = _probe_file(output)
        self.assertLessEqual(abs(float(metadata["format"]["duration"]) - 8), 1.0, metadata)
        self.assertEqual({stream["codec_type"] for stream in metadata["streams"]}, {"video", "audio"})
        progress = [message["payload"] for message in self.host.seen
                    if message.get("type") == "job_progress"
                    and message.get("payload", {}).get("jobId") == job_id
                    and message["payload"].get("phase") == "downloading"]
        self.assertTrue(progress)
        for item in progress:
            self.assertLessEqual(abs(item["durationSeconds"] - 8), 1.0, item)
            self.assertEqual(item["durationSource"], "format", item)
        decoded = subprocess.run([str(FFMPEG), "-v", "error", "-i", str(output), "-f", "null", "-"], capture_output=True, timeout=30)
        self.assertEqual(decoded.returncode, 0, decoded.stderr.decode("utf-8", "replace"))
        self.assertEqual(decoded.stderr, b"")
        self.assertFalse(list(self.downloads.glob("*.partial.*")))

    def test_history_metadata_restart_and_removal_preserves_media(self) -> None:
        context = {"pageUrl": self.base + "/player/", "referer": self.base + "/player/"}
        source_key = "ab" * 32
        started = self.host.request("start_download", {
            "url": self.base + "/generated/direct.mp4", "mediaKind": "mp4",
            "filename": "history-retained", "container": "auto", "overwrite": "number",
            "requestContext": context, "displayTitle": "Fixture https://example.test/watch?token=history-secret",
            "sourceKey": source_key,
        })
        self.assertEqual(started["type"], "job_started", started)
        job_id = started["payload"]["jobId"]
        self.assertEqual(started["payload"]["sourceKey"], source_key)
        self.assertIn("Fixture", started["payload"]["displayTitle"])
        self.assertIn("REDACTED", started["payload"]["displayTitle"])
        self.assertLessEqual(len(started["payload"]["displayTitle"]), 300)
        self.assertNotIn("history-secret", json.dumps(started))
        completed = self.host.wait_for_job(job_id)
        self.assertEqual(completed["type"], "job_completed", completed)
        output = Path(completed["payload"]["outputPath"])
        before = output.read_bytes()
        self.host.close()
        self.host = HostHarness(self.downloads, self.state, self.log)
        rows = self.host.request("list_jobs", {})["payload"]["jobs"]
        restored = next(row for row in rows if row["jobId"] == job_id)
        self.assertEqual(restored["state"], "completed")
        self.assertEqual(restored["sourceKey"], source_key)
        self.assertIn("Fixture", restored["displayTitle"])
        self.assertNotIn("history-secret", json.dumps(restored))

        # Exercise restart path lookup without launching an actual media player:
        # a registered-but-moved output must have the specific missing-file error.
        moved = output.with_name("temporarily-moved.mp4")
        output.replace(moved)
        try:
            for action in ("open_output_file", "reveal_output_file"):
                response = self.host.request(action, {"jobId": job_id, "path": str(moved)})
                self.assertEqual(response["type"], "protocol_error", response)
                self.assertIn("이동 또는 삭제", response["payload"]["errorSummary"])
        finally:
            moved.replace(output)

        invalid = self.host.request("remove_jobs", {"jobIds": [job_id, "../escape"]})
        self.assertEqual(invalid["type"], "protocol_error", invalid)
        self.assertTrue((self.state / f"{job_id}.json").is_file())
        active = self.host.request("start_download", {
            "url": self.base + "/slow/stream.m3u8", "mediaKind": "hls", "filename": "active-history",
            "requestContext": context,
        })
        self.assertEqual(active["type"], "job_started", active)
        active_id = active["payload"]["jobId"]
        removed = self.host.request("remove_jobs", {"jobIds": [job_id, active_id]})
        self.assertEqual(removed["type"], "health_result", removed)
        self.assertEqual(removed["payload"], {"removedJobIds": [job_id], "rejectedJobIds": [active_id]})
        self.assertEqual(output.read_bytes(), before)
        self.assertFalse((self.state / f"{job_id}.json").exists())
        self.assertNotIn(job_id, [row["jobId"] for row in self.host.request("list_jobs", {})["payload"]["jobs"]])
        cancelled = self.host.request("cancel_job", {"jobId": active_id})
        self.assertTrue(cancelled["payload"]["accepted"], cancelled)
        self.assertEqual(self.host.wait_for_job(active_id)["type"], "job_cancelled")
        self.host.close()
        self.host = HostHarness(self.downloads, self.state, self.log)
        self.assertNotIn(job_id, [row["jobId"] for row in self.host.request("list_jobs", {})["payload"]["jobs"]])
        self.assertEqual(output.read_bytes(), before)

    def test_video_only_hls_requires_explicit_opt_in(self) -> None:
        manifest = (FIXTURES / "generated" / "separate-av.m3u8").read_text(encoding="utf-8")
        self.assertIn('#EXT-X-MEDIA:TYPE=AUDIO', manifest)
        self.assertIn('URI="separate-audio.m3u8"', manifest)
        self.assertIn('AUDIO="group_audio"', manifest)
        url = self.base + "/generated/separate-video.m3u8"
        context = {"pageUrl": self.base + "/player/", "referer": self.base + "/player/"}
        probe = self.host.request("probe_media", {"url": url, "mediaKind": "hls", "requestContext": context})
        self.assertEqual(probe["type"], "probe_result", probe)
        self.assertTrue(probe["payload"]["videoStreams"], probe)
        self.assertFalse(probe["payload"]["audioStreams"], probe)
        payload = {"url": url, "mediaKind": "hls", "filename": "video-only-blocked", "container": "auto", "overwrite": "overwrite", "liveMode": "until_stopped", "requestContext": context}
        started = self.host.request("start_download", payload)
        self.assertEqual(started["type"], "job_started", started)
        failed = self.host.wait_for_job(started["payload"]["jobId"])
        self.assertEqual(failed["type"], "job_failed", failed)
        self.assertEqual(failed["payload"].get("errorCode"), "audio_stream_missing", failed)
        self.assertTrue(failed["payload"].get("errorSummary"), failed)
        self.assertFalse(list(self.downloads.glob("video-only-blocked.*")), "Default download silently produced video-only output")

        started = self.host.request("start_download", {**payload, "filename": "video-only-allowed", "allowVideoOnly": True})
        self.assertEqual(started["type"], "job_started", started)
        completed = self.host.wait_for_job(started["payload"]["jobId"])
        self.assertEqual(completed["type"], "job_completed", completed)
        self.assertTrue(completed["payload"].get("warning"), "Intentional silent output must be explicitly identified")
        output = Path(completed["payload"]["outputPath"])
        metadata = _probe_file(output)
        self.assertEqual({stream.get("codec_type") for stream in metadata["streams"]}, {"video"})
        self.assertLessEqual(abs(float(metadata["format"]["duration"]) - 8), 1.0)
        decoded = subprocess.run([str(FFMPEG), "-v", "error", "-i", str(output), "-f", "null", "-"], capture_output=True, timeout=30)
        self.assertEqual(decoded.returncode, 0, decoded.stderr.decode("utf-8", "replace"))
        self.assertEqual(decoded.stderr, b"")
        self.assertFalse(list(self.downloads.glob("*.partial.*")))

    def test_uncapped_live_has_no_invented_percent_or_eta(self) -> None:
        started = self.host.request("start_download", {"url": self.base + "/generated/live.m3u8", "mediaKind": "hls", "filename": "unknown-duration", "container": "auto", "overwrite": "overwrite", "liveMode": "until_stopped", "verifiedDurationSeconds": 8, "requestContext": {"pageUrl": self.base + "/player/", "referer": self.base + "/player/"}})
        self.assertEqual(started["type"], "job_started", started)
        job_id = started["payload"]["jobId"]
        deadline = time.monotonic() + 45
        downloading = []
        try:
            while time.monotonic() < deadline:
                message = self.host.messages.get(timeout=max(0.01, deadline - time.monotonic()))
                if message.get("payload", {}).get("jobId") != job_id:
                    continue
                self.assertNotIn(message.get("type"), {"job_failed", "job_completed", "job_cancelled"}, message)
                if message.get("type") == "job_progress" and message["payload"].get("phase") == "downloading" and message["payload"].get("mediaSeconds") is not None:
                    downloading.append(message["payload"])
                    break
            self.assertTrue(downloading, "uncapped live must still report actual media progress")
            for item in downloading:
                self.assertIsNone(item.get("durationSeconds"), item)
                self.assertEqual(item["durationSource"], "unknown", item)
                self.assertIsNone(item["probe"]["duration"], item)
                self.assertTrue(item["probe"]["isLive"], item)
                self.assertTrue(item["probe"]["liveConfirmed"], item)
                self.assertNotIn("percent", item)
                self.assertNotIn("etaSeconds", item)
        finally:
            cancelled = self.host.request("cancel_job", {"jobId": job_id})
            self.assertTrue(cancelled["payload"]["accepted"], cancelled)
            event = self.host.wait_for_job(job_id)
            self.assertEqual(event["type"], "job_cancelled", event)
        self.assertFalse(list(self.downloads.glob("*.partial.*")))

    def test_auth_context_and_redaction(self) -> None:
        page = self.base + "/player/"
        referer = self.host.request("probe_media", {"url": self.base + "/auth/referer.m3u8", "mediaKind": "hls", "requestContext": {"pageUrl": page, "referer": page}})
        self.assertEqual(referer["type"], "probe_result", referer)
        no_cookie = self.host.request("probe_media", {"url": self.base + "/auth/cookie.m3u8", "mediaKind": "hls", "requestContext": {"pageUrl": page, "referer": page}})
        self.assertEqual(no_cookie["type"], "protocol_error", no_cookie)
        with_cookie = self.host.request("probe_media", {"url": self.base + "/auth/cookie.m3u8", "mediaKind": "hls", "requestContext": {"pageUrl": page, "referer": page, "cookieHeader": "session=fixture-ok"}})
        self.assertEqual(with_cookie["type"], "probe_result", with_cookie)
        valid_token = "valid-fixture-token"
        valid = self.host.request("probe_media", {"url": self.base + f"/auth/signed.m3u8?token={valid_token}", "mediaKind": "hls", "requestContext": {"pageUrl": page, "referer": page}})
        self.assertEqual(valid["type"], "probe_result", valid)
        expired_token = "expired-fixture-token"
        expired = self.host.request("probe_media", {"url": self.base + f"/auth/signed.m3u8?token={expired_token}", "mediaKind": "hls", "requestContext": {"pageUrl": page, "referer": page}})
        self.assertEqual(expired["type"], "protocol_error", expired)
        detail = json.dumps(expired, ensure_ascii=False)
        self.assertNotIn(expired_token, detail)
        self.assertRegex(detail, "403|만료|expired")
        failed = self.host.request("start_download", {"url": self.base + f"/auth/signed.m3u8?token={expired_token}", "mediaKind": "hls", "filename": "expired", "container": "auto", "overwrite": "overwrite", "liveMode": "until_stopped", "requestContext": {"pageUrl": page, "referer": page}})
        self.assertEqual(failed["type"], "job_started", failed)
        failed_event = self.host.wait_for_job(failed["payload"]["jobId"])
        self.assertEqual(failed_event["type"], "job_failed", failed_event)
        self.assertFalse((self.downloads / "expired.mkv").exists(), "network/auth failure incorrectly triggered MKV fallback")
        self.assertNotIn(expired_token, json.dumps(failed_event, ensure_ascii=False))
        persisted = "".join(path.read_text(encoding="utf-8") for path in self.state.glob("*.json"))
        log = self.log.read_text(encoding="utf-8") if self.log.exists() else ""
        for secret in ("fixture-ok", valid_token, expired_token):
            self.assertNotIn(secret, persisted)
            self.assertNotIn(secret, log)

    def test_drm_preflight_matrix(self) -> None:
        page=self.base+"/player/";context={"pageUrl":page,"referer":page}
        cases=[("hls-clear.m3u8","hls",False,None),("hls-aes128.m3u8","hls",False,None),("hls-sample-aes.m3u8","hls",True,"SAMPLE-AES"),("dash-clear.mpd","dash",False,None),("dash-mp4protection.mpd","dash",True,"unspecified"),("dash-widevine.mpd","dash",True,"Widevine"),("dash-playready.mpd","dash",True,"PlayReady")]
        for filename,kind,unsupported,reason in cases:
            with self.subTest(fixture=filename):
                response=self.host.request("probe_media",{"url":self.base+"/drm/"+filename,"mediaKind":kind,"requestContext":context})
                if unsupported:
                    self.assertEqual(response["type"],"job_failed",response);self.assertEqual(response["payload"].get("state"),"unsupported_drm",response);self.assertIn(reason,response["payload"].get("errorSummary",""))
                else:self.assertNotEqual(response["payload"].get("state"),"unsupported_drm",response)

    def test_port_disconnect_recovery_cancel_and_partial_policy(self) -> None:
        context = {"pageUrl": self.base + "/player/", "referer": self.base + "/player/"}
        started = self.host.request("start_download", {"url": self.base + "/slow/stream.m3u8", "mediaKind": "hls", "filename": "recover", "container": "auto", "overwrite": "overwrite", "liveMode": "until_stopped", "requestContext": context, "keepPartial": False})
        job_id = started["payload"]["jobId"]
        deadline = time.monotonic() + 45
        record = None
        while time.monotonic() < deadline:
            path = self.state / f"{job_id}.json"
            if path.exists():
                record = json.loads(path.read_text(encoding="utf-8"))
                if record.get("state") == "running" and record.get("pid"):
                    break
            time.sleep(0.05)
        self.assertIsNotNone(record)
        self.assertEqual(record["state"], "running", record)
        pid = int(record["pid"])
        self.assertTrue(process_exists(pid))
        self.host.disconnect()
        recovered = HostHarness(self.downloads, self.state, self.log)
        try:
            jobs = recovered.request("list_jobs", {})["payload"]["jobs"]
            restored = next(job for job in jobs if job["jobId"] == job_id)
            self.assertIn(restored["state"], {"running", "probing"}, restored)
            cancelled = recovered.request("cancel_job", {"jobId": job_id})
            self.assertTrue(cancelled["payload"]["accepted"], cancelled)
            deadline = time.monotonic() + 10
            while process_exists(pid) and time.monotonic() < deadline:
                time.sleep(0.1)
            self.assertFalse(process_exists(pid), f"orphan ffmpeg PID {pid}")
            time.sleep(0.5)
            final_record = json.loads((self.state / f"{job_id}.json").read_text(encoding="utf-8"))
            self.assertEqual(final_record["state"], "cancelled", final_record)
            self.assertFalse(Path(final_record["partialPath"]).exists())
            kept = recovered.request("start_download", {"url": self.base + "/slow/stream.m3u8", "mediaKind": "hls", "filename": "recover-keep", "container": "auto", "overwrite": "overwrite", "liveMode": "until_stopped", "requestContext": context, "keepPartial": True})
            self.assertEqual(kept["type"], "job_started", kept)
            kept_id = kept["payload"]["jobId"]
            kept_path = self.state / f"{kept_id}.json"
            deadline = time.monotonic() + 45
            kept_record = None
            ready_to_cancel = False
            while time.monotonic() < deadline:
                if kept_path.exists():
                    kept_record = json.loads(kept_path.read_text(encoding="utf-8"))
                    partial_path = Path(kept_record["partialPath"])
                    if (kept_record.get("state") == "running"
                            and process_exists(kept_record.get("pid"))
                            and partial_path.is_file() and partial_path.stat().st_size > 0):
                        ready_to_cancel = True
                        break
                    if kept_record.get("state") in {"completed", "failed", "cancelled", "unsupported_drm"}:
                        self.fail(f"Test job ended before active cancellation could be tested: {kept_record}")
                time.sleep(.05)
            self.assertTrue(ready_to_cancel, kept_record)
            assert kept_record is not None
            kept_pid = int(kept_record["pid"])
            # Cancel at the observed active/nonempty-partial condition. A fixed delay
            # here lets this short VOD finish and makes the saved record stale.
            cancelled = recovered.request("cancel_job", {"jobId": kept_id})
            self.assertTrue(cancelled["payload"]["accepted"], {
                "cancelResponse": cancelled, "stateBeforeCancel": kept_record,
                "stateAfterCancel": json.loads(kept_path.read_text(encoding="utf-8")),
            })
            deadline = time.monotonic() + 10
            while process_exists(kept_pid) and time.monotonic() < deadline:
                time.sleep(.1)
            self.assertFalse(process_exists(kept_pid), f"orphan ffmpeg PID {kept_pid}")
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                kept_record = json.loads(kept_path.read_text(encoding="utf-8"))
                if kept_record["state"] == "cancelled":
                    break
                time.sleep(.05)
            self.assertEqual(kept_record["state"], "cancelled", kept_record)
            self.assertTrue(Path(kept_record["partialPath"]).is_file(), kept_record)
            self.assertGreater(Path(kept_record["partialPath"]).stat().st_size, 0, kept_record)
        finally:
            recovered.close()
            self.host.process.wait(timeout=15)


def _probe_file(path: Path) -> dict[str, Any]:
    done = subprocess.run([str(FFPROBE), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)], capture_output=True, text=True, timeout=30)
    if done.returncode:
        raise AssertionError(done.stderr)
    return json.loads(done.stdout)
