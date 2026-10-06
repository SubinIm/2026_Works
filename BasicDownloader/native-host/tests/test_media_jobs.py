from __future__ import annotations

import json
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from stream_host.ffmpeg_commands import download_command
from stream_host.ffprobe import probe, summarize
from stream_host.__main__ import Host, _manifest_is_live
from stream_host.ffmpeg_locator import FFmpegTools
from stream_host.job_registry import JobRegistry
from stream_host.jobs import DownloadJobManager, validate_duration_hint
from stream_host.models import Envelope, Job, JobState, RequestContext
from stream_host.progress import ProgressParser


def media(video: bool = True, audio: bool = True, duration: float | None = 8) -> dict:
    streams = []
    if video:
        streams.append({"index": 0, "codec_type": "video", "codec_name": "h264", "width": 640, "height": 360})
    if audio:
        streams.append({"index": 1, "codec_type": "audio", "codec_name": "aac", "sample_rate": "48000", "channels": 2})
    return summarize({"format": {"duration": duration}, "streams": streams})


class ProbeSelectionTests(unittest.TestCase):
    def test_master_selects_one_highest_video_and_linked_audio(self):
        summary = summarize({
            "format": {"duration": "8", "tags": {"url": "https://x/?token=secret"}},
            "streams": [
                {"index": 0, "codec_type": "video", "width": 640, "height": 360, "tags": {"comment": "Cookie: secret"}},
                {"index": 1, "codec_type": "video", "width": 1920, "height": 1080},
                {"index": 2, "codec_type": "audio"}, {"index": 3, "codec_type": "audio"},
            ],
            "programs": [
                {"program_id": 0, "streams": [{"index": 0}, {"index": 2}]},
                {"program_id": 1, "streams": [{"index": 1}, {"index": 3}]},
            ],
        })
        self.assertEqual(summary["selectedStreamIndices"], [1, 3])
        self.assertNotIn("secret", json.dumps(summary))
        command = download_command(Path("ffmpeg"), "https://x/master.m3u8", Path("out.mp4"), RequestContext(""), None, [1, 3])
        self.assertEqual([command[i + 1] for i, item in enumerate(command) if item == "-map"], ["0:1", "0:3"])
        self.assertNotIn("-t", command)

    def test_unrelated_program_audio_is_not_paired(self):
        summary = media()
        summary["programs"] = [{"streamIndices": [0]}, {"streamIndices": [1]}]
        from stream_host.ffprobe import select_streams
        self.assertEqual(select_streams(summary), [0])

    def test_unknown_invalid_duration_and_attached_cover(self):
        summary = summarize({"format": {"duration": "NaN"}, "streams": [
            {"index": 0, "codec_type": "video", "disposition": {"attached_pic": 1}},
            {"index": 1, "codec_type": "audio"},
        ]})
        self.assertIsNone(summary["duration"])
        self.assertEqual(summary["selectedStreamIndices"], [1])
        self.assertFalse(summary["videoStreams"])
        self.assertIsNone(summary["isLive"])
        self.assertFalse(summary["liveConfirmed"])
        self.assertEqual(summary["durationSource"], "unknown")

    def test_missing_format_duration_uses_only_selected_streams(self):
        summary = summarize({"format": {}, "streams": [
            {"index": 0, "codec_type": "video", "width": 640, "height": 360, "duration": "9999"},
            {"index": 1, "codec_type": "video", "width": 1920, "height": 1080, "duration": "120.25"},
            {"index": 2, "codec_type": "audio", "duration": "120.5"},
            {"index": 3, "codec_type": "video", "disposition": {"attached_pic": 1}, "duration": "99999"},
            {"index": 4, "codec_type": "subtitle", "duration": "99999"},
        ]})
        self.assertEqual(summary["selectedStreamIndices"], [1, 2])
        self.assertEqual(summary["duration"], 120.5)
        self.assertEqual(summary["durationSource"], "stream")
        self.assertFalse(summary["durationUnknown"])
        self.assertFalse(summary["isLive"])

    def test_stream_timestamp_time_base_fallback(self):
        summary = summarize({"format": {"duration": "N/A"}, "streams": [
            {"index": 0, "codec_type": "video", "duration_ts": 10800000, "time_base": "1/90000"},
        ]})
        self.assertEqual(summary["duration"], 120)
        self.assertEqual(summary["durationSource"], "stream")

    def test_whitelisted_duration_tag_only_parses_timing_and_does_not_leak_tags(self):
        summary = summarize({"streams": [{"index": 0, "codec_type": "audio", "tags": {
            "DURATION": "01:02:03.250000000", "url": "https://x/?token=secret", "COMMENT": "Cookie: secret",
        }}]})
        self.assertEqual(summary["duration"], 3723.25)
        self.assertNotIn("secret", json.dumps(summary))
        self.assertNotIn("tags", summary["audioStreams"][0])

    def test_format_duration_precedes_stream_estimate(self):
        summary = summarize({"format": {"duration": "121"}, "streams": [
            {"index": 0, "codec_type": "audio", "duration": "120"},
        ]})
        self.assertEqual(summary["duration"], 121)
        self.assertEqual(summary["durationSource"], "format")

    def test_invalid_duration_representations_are_not_live_or_fabricated(self):
        for value in (None, True, False, "NaN", "Infinity", "-1", "0", "N/A"):
            with self.subTest(value=value):
                summary = summarize({"format": {"duration": value}, "streams": [
                    {"index": 0, "codec_type": "audio", "duration": value,
                     "duration_ts": value, "time_base": "1/0", "tags": {"DURATION": "00:99:00 Cookie: secret"}},
                ]})
                self.assertIsNone(summary["duration"])
                self.assertIsNone(summary["isLive"])
                self.assertFalse(summary["liveConfirmed"])
                json.dumps(summary, allow_nan=False)

    def test_manifest_live_detection_does_not_guess_from_master_or_missing_duration(self):
        self.assertTrue(_manifest_is_live("#EXTM3U\n#EXTINF:2,\na.ts\n", "hls"))
        self.assertFalse(_manifest_is_live("#EXTM3U\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST\n", "hls"))
        self.assertIsNone(_manifest_is_live('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\na.m3u8', "hls"))
        self.assertIsNone(_manifest_is_live('<html>Forbidden</html>', "hls"))
        self.assertTrue(_manifest_is_live('<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic"/>', "dash"))
        self.assertFalse(_manifest_is_live('<MPD type="static"/>', "dash"))
        self.assertIsNone(_manifest_is_live('<Error/>', "dash"))
        self.assertIsNone(_manifest_is_live('<MPD', "dash"))

    def test_probe_timeout_is_safe_runtime_error_and_kills_process(self):
        process = Mock()
        process.communicate.side_effect = subprocess.TimeoutExpired(["ffprobe", "Cookie: secret"], 1)
        process.poll.return_value = None
        with patch("stream_host.ffprobe.subprocess.Popen", return_value=process):
            with self.assertRaisesRegex(RuntimeError, "분석 시간이 초과") as error:
                probe(Path("ffprobe"), "https://x/?token=secret", RequestContext(""), timeout=1)
        self.assertNotIn("secret", str(error.exception))
        process.kill.assert_called_once()
        process.wait.assert_called_once()


class JobMediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.events = []
        self.manager = DownloadJobManager(Path("ffmpeg"), self.root / "out", lambda kind, data: self.events.append((kind, data)), JobRegistry(self.root / "state"))

    def tearDown(self):
        self.manager.shutdown()
        self.temp.cleanup()

    def run_job(self, source=None, output=None, allow=False, duration=None, keep=False, hint=None, inspection=None, input_probe=True, audio_only=False):
        job = Job("media-test", "https://x/media?token=secret", str(self.manager.root / "test.mp4"), str(self.manager.root / "test.partial.mp4"))
        self.manager.jobs[job.id] = job
        job.audio_only=audio_only
        self.manager._persist(job, keep)
        source = source if source is not None else media()
        output = output if output is not None else source
        def download(job, partial, context, limit, selected, keep):
            partial.write_bytes(b"test-media")
            return 0, ""
        with patch("stream_host.jobs.probe", side_effect=[source, output] if input_probe else [output]) as probes, patch.object(self.manager, "_download", side_effect=download) as downloads:
            self.manager._run(job, RequestContext(""), duration, keep, True, "auto", allow, lambda: inspection, hint, input_probe)
        return job, probes, downloads

    def test_audio_only_maps_selected_audio_and_verifies_no_video(self):
        job,_,downloads=self.run_job(audio_only=True,output=media(video=False))
        self.assertEqual(job.state,JobState.COMPLETED)
        self.assertEqual(downloads.call_args.args[4],[1])
        command=download_command(Path("ffmpeg"),"https://x/v",Path("a.mp4"),RequestContext(""),audio_only=True)
        self.assertIn("-vn",command)
        self.assertEqual(command[command.index("-map")+1],"0:a:0")
        job,_,_=self.run_job(audio_only=True,output=media())
        self.assertEqual(job.error_code,"audio_only_output_invalid")

    def test_audio_only_rejects_missing_audio_and_supports_input_probe_skip(self):
        job,_,downloads=self.run_job(audio_only=True,source=media(audio=False))
        self.assertEqual(job.error_code,"audio_stream_missing")
        downloads.assert_not_called()
        job,probes,_=self.run_job(audio_only=True,input_probe=False,output=media(video=False))
        self.assertEqual(job.state,JobState.COMPLETED)
        self.assertEqual(probes.call_count,1)

    def test_optional_probe_skips_input_only_and_retains_output_verification(self):
        job, probes, downloads = self.run_job(input_probe=False, hint=8)
        self.assertEqual(job.state, JobState.COMPLETED)
        self.assertEqual(probes.call_count, 1)
        self.assertEqual(probes.call_args.args[1], job.partial_path)
        self.assertIsNone(downloads.call_args.args[4])
        self.assertTrue(job.probe["inputProbeSkipped"])
        self.assertEqual(job.duration_seconds, 8)

    def test_optional_probe_still_rejects_silent_output_unless_explicitly_allowed(self):
        job, probes, downloads = self.run_job(input_probe=False, output=media(audio=False))
        self.assertEqual(job.state, JobState.FAILED)
        self.assertEqual(job.error_code, "audio_stream_missing")
        self.assertEqual(downloads.call_count, 1)
        self.assertEqual(probes.call_count, 1)
        self.assertFalse(Path(job.partial_path).exists())
        job, _, _ = self.run_job(input_probe=False, output=media(audio=False), allow=True)
        self.assertEqual(job.state, JobState.COMPLETED)
        self.assertTrue(job.warning)

    def test_optional_probe_cannot_skip_drm_and_ignores_live_duration_hint(self):
        job, probes, downloads = self.run_job(input_probe=False, inspection={"drm":"Widevine"})
        self.assertEqual(job.state, JobState.UNSUPPORTED_DRM)
        probes.assert_not_called()
        downloads.assert_not_called()
        job, _, _ = self.run_job(input_probe=False, hint=999, inspection={"isLive":True})
        self.assertIsNone(job.duration_seconds)

    def test_video_only_blocked_before_download_by_default(self):
        job, probes, downloads = self.run_job(source=media(audio=False))
        self.assertEqual(job.state, JobState.FAILED)
        self.assertEqual(job.error_code, "audio_stream_missing")
        self.assertIn("오디오", job.error)
        downloads.assert_not_called()
        self.assertEqual(probes.call_count, 1)
        self.assertFalse(Path(job.output_path).exists())

    def test_explicit_video_only_has_warning(self):
        job, _, _ = self.run_job(source=media(audio=False), allow=True)
        self.assertEqual(job.state, JobState.COMPLETED)
        self.assertTrue(job.warning)
        self.assertTrue(self.events[-1][1]["warning"])

    def test_audio_only_is_supported_without_opt_in(self):
        job, _, _ = self.run_job(source=media(video=False))
        self.assertEqual(job.state, JobState.COMPLETED)
        self.assertIsNone(job.warning)

    def test_output_audio_check_happens_before_rename_and_applies_partial_policy(self):
        for keep in (False, True):
            with self.subTest(keep=keep):
                job, probes, _ = self.run_job(output=media(audio=False), keep=keep)
                self.assertEqual(job.state, JobState.FAILED)
                self.assertEqual(job.error_code, "audio_stream_missing")
                self.assertEqual(probes.call_count, 2)
                self.assertFalse(Path(job.output_path).exists())
                self.assertEqual(Path(job.partial_path).exists(), keep)

    def test_natural_duration_and_clip_cap_are_separate(self):
        for cap, expected in ((None, 8), (3, 3), (30, 8)):
            with self.subTest(cap=cap):
                job, _, downloads = self.run_job(duration=cap)
                self.assertEqual(job.duration_seconds, expected)
                self.assertEqual(downloads.call_args.args[3], cap)
                record = self.manager.list()[0]
                self.assertEqual(record["probe"]["duration"], 8)
                self.assertEqual(record["durationSeconds"], expected)
                self.assertNotIn("secret", json.dumps(record))

    def test_unknown_duration_remains_unknown_until_explicit_cap(self):
        job, _, _ = self.run_job(source=media(duration=None))
        self.assertIsNone(job.duration_seconds)
        self.assertNotIn("durationSeconds", job.progress)
        job, _, _ = self.run_job(source=media(duration=None), duration=5)
        self.assertEqual(job.duration_seconds, 5)

    def test_verified_probe_hint_restores_progress_without_trimming(self):
        job, probes, downloads = self.run_job(source=media(duration=None), hint=120)
        self.assertEqual(job.state, JobState.COMPLETED)
        self.assertEqual(probes.call_count, 2)
        self.assertEqual(job.duration_seconds, 120)
        self.assertEqual(job.duration_source, "probe_hint")
        self.assertIsNone(downloads.call_args.args[3])
        command = download_command(Path("ffmpeg"), "https://x/vod.m3u8", Path("out.mp4"), RequestContext(""), downloads.call_args.args[3], [0, 1])
        self.assertNotIn("-t", command)
        record = self.manager.list()[0]
        self.assertEqual(record["durationSeconds"], 120)
        self.assertEqual(record["durationSource"], "probe_hint")
        self.assertEqual(record["progress"]["durationSeconds"], 120)
        self.assertEqual(record["progress"]["durationSource"], "probe_hint")
        parser = ProgressParser(job.duration_seconds)
        parser.feed("out_time_us=30000000")
        parser.feed("speed=2x")
        value = parser.feed("progress=continue")
        self.assertEqual(value["percent"], 25)
        self.assertEqual(value["etaSeconds"], 45)

    def test_fresh_probe_duration_wins_over_cached_hint(self):
        job, _, _ = self.run_job(source=media(duration=90), hint=120)
        self.assertEqual(job.duration_seconds, 90)
        self.assertEqual(job.duration_source, "format")

    def test_fresh_stream_duration_wins_over_cached_hint(self):
        summary = summarize({"streams": [
            {"index": 0, "codec_type": "video", "duration": "90"},
            {"index": 1, "codec_type": "audio", "duration": "90.5"},
        ]})
        job, _, _ = self.run_job(source=summary, hint=120)
        self.assertEqual(job.duration_seconds, 90.5)
        self.assertEqual(job.duration_source, "stream")

    def test_confirmed_live_ignores_rolling_window_duration_and_cached_hint(self):
        job, _, downloads = self.run_job(source=media(duration=8), hint=120, inspection={"isLive": True})
        self.assertEqual(job.state, JobState.COMPLETED)
        self.assertIsNone(job.duration_seconds)
        self.assertEqual(job.duration_source, "unknown")
        self.assertIsNone(job.probe["duration"])
        self.assertTrue(job.probe["isLive"])
        self.assertTrue(job.probe["liveConfirmed"])
        self.assertIsNone(downloads.call_args.args[3])

    def test_confirmed_live_accepts_explicit_recording_target(self):
        job, _, downloads = self.run_job(source=media(duration=8), hint=120, duration=60, inspection={"isLive": True})
        self.assertEqual(job.duration_seconds, 60)
        self.assertEqual(job.duration_source, "requested")
        self.assertEqual(downloads.call_args.args[3], 60)

    def test_hint_does_not_bypass_audio_or_drm_preflight(self):
        job, probes, downloads = self.run_job(source=media(audio=False, duration=None), hint=120)
        self.assertEqual(job.error_code, "audio_stream_missing")
        self.assertEqual(probes.call_count, 1)
        downloads.assert_not_called()
        job, probes, downloads = self.run_job(hint=120, inspection={"drm": "Unsupported Widevine", "isLive": False})
        self.assertEqual(job.state, JobState.UNSUPPORTED_DRM)
        probes.assert_not_called()
        downloads.assert_not_called()

    def test_invalid_hints_rejected_before_job_creation(self):
        for hint in (True, False, "120", 0, -1, float("nan"), float("inf"), {}, [], 10**400):
            with self.subTest(hint=hint):
                with self.assertRaisesRegex(ValueError, "verifiedDurationSeconds"):
                    self.manager.start("https://x/vod", "invalid", "auto", "number", RequestContext(""), verified_duration_seconds=hint)
        self.assertFalse(self.manager.jobs)
        self.assertEqual(validate_duration_hint(120), 120.0)
        self.assertIsNone(validate_duration_hint(None))

    def test_slow_preflight_does_not_block_start_and_can_be_cancelled(self):
        entered = threading.Event()
        release = threading.Event()
        def slow_check():
            entered.set()
            release.wait(3)
        try:
            before = time.monotonic()
            job = self.manager.start("https://x/media", "slow", "auto", "number", RequestContext(""), preflight=slow_check)
            self.assertLess(time.monotonic() - before, 1)
            self.assertTrue(entered.wait(1))
            self.assertTrue(self.manager.cancel(job.id))
        finally:
            release.set()
        self.manager.pool.shutdown(wait=True)
        self.assertEqual(job.state, JobState.CANCELLED)
        self.assertFalse(Path(job.output_path).exists())

    def test_cancellation_after_mux_failure_does_not_start_fallback(self):
        job = Job("cancel-test", "https://x/media", str(self.manager.root / "test.mp4"), str(self.manager.root / "test.partial.mp4"))
        self.manager.jobs[job.id] = job
        self.manager._persist(job, False)
        def cancelled_download(*args):
            self.manager.registry.put(job.id, state="cancelling")
            return 1, "Could not find tag for codec"
        with patch("stream_host.jobs.probe", return_value=media()), patch.object(self.manager, "_download", side_effect=cancelled_download) as downloads:
            self.manager._run(job, RequestContext(""), None, False, True, "auto", False, None)
        self.assertEqual(downloads.call_count, 1)
        self.assertEqual(job.state, JobState.CANCELLED)


class ProgressSafetyTests(unittest.TestCase):
    def test_unknown_duration_has_no_fabricated_percent_or_eta(self):
        parser = ProgressParser()
        parser.feed("out_time_us=5000000")
        parser.feed("speed=2x")
        result = parser.feed("progress=continue")
        self.assertNotIn("percent", result)
        self.assertNotIn("etaSeconds", result)
        self.assertNotIn("durationSeconds", result)

    def test_eta_is_nonnegative_and_nonfinite_values_not_serialized(self):
        parser = ProgressParser(8)
        parser.feed("out_time_us=10000000")
        parser.feed("speed=2x")
        result = parser.feed("progress=end")
        self.assertEqual(result["percent"], 100)
        self.assertEqual(result["etaSeconds"], 0)
        for timing in ("NaN:0:0", "Infinity:0:0"):
            parser.feed("out_time_us=NaN")
            parser.feed("out_time=" + timing)
            parser.feed("speed=Infinityx")
            result = parser.feed("progress=continue")
            self.assertIsNone(result["mediaSeconds"])
            json.dumps(result, allow_nan=False)


class DurationProtocolTests(unittest.TestCase):
    def test_audio_only_protocol_rejects_nonboolean_and_conflicting_modes(self):
        self.host.dispatch(Envelope(1,"start","start_download",{"url":"https://x/a.mp4","audioOnly":True}))
        self.assertTrue(self.host.jobs.start.call_args.kwargs["audio_only"])
        for value in (None,0,1,"true"):
            with self.assertRaisesRegex(ValueError,"audioOnly"):
                self.host.dispatch(Envelope(1,"start","start_download",{"url":"https://x/a.mp4","audioOnly":value}))
        with self.assertRaisesRegex(ValueError,"cannot both"):
            self.host.dispatch(Envelope(1,"start","start_download",{"url":"https://x/a.mp4","audioOnly":True,"allowVideoOnly":True}))
    def test_optional_probe_protocol_is_strict_boolean_and_default_on(self):
        for value in (True, False):
            self.host.dispatch(Envelope(1,"start","start_download",{"url":"https://x/a.mp4","probeBeforeDownload":value}))
            self.assertEqual(self.host.jobs.start.call_args.kwargs["probe_before_download"],value)
        for value in (None,0,1,"false"):
            with self.assertRaisesRegex(ValueError,"probeBeforeDownload"):
                self.host.dispatch(Envelope(1,"start","start_download",{"url":"https://x/a.mp4","probeBeforeDownload":value}))
        self.host.dispatch(Envelope(1,"start","start_download",{"url":"https://x/a.mp4"}))
        self.assertTrue(self.host.jobs.start.call_args.kwargs["probe_before_download"])
    def setUp(self):
        self.host = Host.__new__(Host)
        self.host.tools = FFmpegTools(Path("ffmpeg"), Path("ffprobe"), "test")
        self.host.jobs = Mock()
        self.host.jobs.start.return_value = Job("test", "https://x/stream.m3u8", "out.mp4", "out.partial.mp4")
        self.host.send = Mock()

    def test_start_download_passes_verified_hint_separately_from_recording_duration(self):
        self.host.dispatch(Envelope(1, "start", "start_download", {
            "url": "https://x/stream.m3u8", "verifiedDurationSeconds": 120,
        }))
        args = self.host.jobs.start.call_args
        self.assertIsNone(args.args[5])
        self.assertEqual(args.kwargs["verified_duration_seconds"], 120)
        self.assertTrue(callable(args.args[8]))

    def test_probe_result_rejects_live_window_as_whole_media_duration(self):
        with patch.object(self.host, "_preflight", return_value={"drm": None, "isLive": True}), patch("stream_host.__main__.probe", return_value=media()):
            self.host.dispatch(Envelope(1, "probe", "probe_media", {"url": "https://x/live.m3u8"}))
        result = self.host.send.call_args.args[2]
        self.assertIsNone(result["duration"])
        self.assertTrue(result["liveConfirmed"])
        self.assertTrue(result["isLive"])
        self.assertTrue(result["durationUnknown"])

    def test_probe_result_retains_known_vod_stream_duration(self):
        source = summarize({"streams": [{"index": 0, "codec_type": "audio", "duration": "120"}]})
        with patch.object(self.host, "_preflight", return_value={"drm": None, "isLive": False}), patch("stream_host.__main__.probe", return_value=source):
            self.host.dispatch(Envelope(1, "probe", "probe_media", {"url": "https://x/vod.m3u8"}))
        result = self.host.send.call_args.args[2]
        self.assertEqual(result["duration"], 120)
        self.assertEqual(result["durationSource"], "stream")
        self.assertFalse(result["isLive"])

    def test_manifest_fetch_only_returns_timing_and_drm_classification(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'#EXTM3U\n#EXTINF:8,\nsegment.ts?token=secret\n#EXT-X-ENDLIST\n'
        with patch("stream_host.__main__.urllib.request.urlopen", return_value=response):
            info = self.host._preflight("https://x/vod.m3u8?token=secret", RequestContext("", cookie_header="session=secret"))
        self.assertEqual(info, {"drm": None, "isLive": False})
        self.assertNotIn("secret", json.dumps(info))
