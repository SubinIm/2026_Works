from __future__ import annotations

import json
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from stream_host.__main__ import Host
from stream_host.job_registry import ACTIVE_STATES, TERMINAL_STATES, JobRegistry
from stream_host.jobs import DownloadJobManager
from stream_host.models import Envelope, Job, JobState, RequestContext
from stream_host.validation import validate_display_title, validate_envelope, validate_job_id, validate_source_key


class ConvenienceActionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manager = DownloadJobManager(Path("ffmpeg"), self.root / "out", Mock(), JobRegistry(self.root / "state"))
        self.host = Host.__new__(Host)
        self.host.jobs = self.manager
        self.host.send = Mock()

    def tearDown(self):
        self.manager.shutdown(cancel_active=False)
        self.temp.cleanup()

    def record(self, state="completed", filename="video name, 한국어.mp4", legacy=False, memory=False):
        job_id = str(uuid.uuid4())
        output = self.manager.root / filename
        output.write_bytes(b"test media")
        partial = output.with_name(output.stem + ".partial" + output.suffix)
        self.manager.registry.put(job_id, state=state, outputPath=str(output), partialPath=str(partial),
                                  outputRoot=None if legacy else str(self.manager.root))
        if memory:
            self.manager.jobs[job_id] = Job(job_id, "https://example.test/media", str(output), str(partial), state=JobState(state))
        return job_id, output, partial

    def test_registered_actions_validate_protocol(self):
        for action in ("open_output_file", "reveal_output_file", "remove_jobs"):
            with self.subTest(action=action):
                self.assertEqual(validate_envelope({"protocolVersion": 1, "messageId": "test", "type": action, "payload": {}}).type, action)

    def test_actions_resolve_persisted_job_after_restart_and_folder_change(self):
        for legacy in (False, True):
            with self.subTest(legacy=legacy):
                job_id, output, _ = self.record(legacy=legacy)
                self.manager.root = self.root / "new-download-folder"
                self.manager.root.mkdir(exist_ok=True)
                self.assertFalse(self.manager.jobs)
                self.assertEqual(self.manager.output_path(job_id), output)
                opened = Mock()
                with patch("stream_host.__main__.os", SimpleNamespace(name="nt", startfile=opened)), patch("stream_host.__main__.subprocess.Popen") as explorer:
                    self.host.dispatch(Envelope(1, "play", "open_output_file", {"jobId": job_id, "path": "C:/untrusted.exe"}))
                    opened.assert_called_with(str(output))
                    self.host.dispatch(Envelope(1, "folder", "open_output_folder", {"jobId": job_id}))
                    opened.assert_called_with(str(output.parent))
                    self.host.dispatch(Envelope(1, "reveal", "reveal_output_file", {"jobId": job_id}))
                    explorer.assert_called_once_with(["explorer.exe", "/select,", str(output)], shell=False)
                self.assertEqual(self.host.send.call_args.args, ("reveal", "health_result", {"opened": True}))

    def test_unknown_or_malformed_job_never_opens_default_folder_or_supplied_path(self):
        for job_id in (str(uuid.uuid4()), "../outside", "..\\outside", "C:/outside", "", None, "test", "{" + str(uuid.uuid4()) + "}"):
            for action in ("open_output_file", "reveal_output_file", "open_output_folder"):
                with self.subTest(job_id=job_id, action=action), patch("stream_host.__main__.os", SimpleNamespace(name="nt", startfile=Mock())) as fake_os:
                    with self.assertRaises(ValueError):
                        self.host.dispatch(Envelope(1, "open", action, {"jobId": job_id, "path": str(self.manager.root)}))
                    fake_os.startfile.assert_not_called()

    def test_play_and_reveal_require_completed_existing_media_file(self):
        for state in ACTIVE_STATES | {"failed", "cancelled", "unsupported_drm"}:
            with self.subTest(state=state):
                job_id, _, _ = self.record(state=state)
                with self.assertRaisesRegex(ValueError, "완료"):
                    self.manager.output_path(job_id)
        for filename in ("script.exe", "page.html", "command.bat", "shortcut.lnk"):
            with self.subTest(filename=filename):
                job_id, _, _ = self.record(filename=filename)
                with self.assertRaisesRegex(ValueError, "영상"):
                    self.manager.output_path(job_id)
        job_id, output, _ = self.record()
        output.unlink()
        with self.assertRaisesRegex(ValueError, "이동 또는 삭제"):
            self.manager.output_path(job_id)
        self.assertEqual(self.manager.output_path(job_id, require_completed=False).parent, self.manager.root)
        output.mkdir()
        with self.assertRaises(ValueError):
            self.manager.output_path(job_id)

    def test_paths_cannot_escape_original_root_or_open_remote_locations(self):
        job_id, output, _ = self.record()
        outside = self.root / "outside.mp4"
        outside.write_bytes(b"unrelated media")
        for unsafe in (str(outside), "../outside.mp4", "\\\\server\\share\\movie.mp4", "//server/share/movie.mp4"):
            with self.subTest(path=unsafe):
                self.manager.registry.put(job_id, outputPath=unsafe)
                with self.assertRaises(ValueError):
                    self.manager.output_path(job_id)
        self.assertTrue(output.is_file())

    def test_os_open_failure_becomes_safe_user_summary(self):
        job_id, _, _ = self.record()
        with patch("stream_host.__main__.os", SimpleNamespace(name="nt", startfile=Mock(side_effect=OSError("private detail")))):
            with self.assertRaisesRegex(RuntimeError, "기본 재생 앱") as failure:
                self.host.dispatch(Envelope(1, "play", "open_output_file", {"jobId": job_id}))
        self.assertNotIn("private detail", str(failure.exception))
        with patch.object(self.manager, "output_path", side_effect=PermissionError("private directory")):
            with self.assertRaisesRegex(RuntimeError, "기본 재생 앱") as failure:
                self.host.dispatch(Envelope(1, "play", "open_output_file", {"jobId": job_id}))
        self.assertNotIn("private directory", str(failure.exception))

    def test_remove_terminal_records_only_and_preserve_output_and_partial_files(self):
        removable, protected, paths = [], [], []
        for state in TERMINAL_STATES:
            job_id, output, partial = self.record(state=state, filename=f"{state}.mp4", memory=True)
            partial.write_bytes(b"retained partial")
            removable.append(job_id)
            paths.extend((output, partial))
        for state in ACTIVE_STATES:
            job_id, _, _ = self.record(state=state, filename=f"{state}.mp4", memory=True)
            protected.append(job_id)
        missing = str(uuid.uuid4())
        self.host.dispatch(Envelope(1, "remove", "remove_jobs", {"jobIds": [*removable, *protected, missing, removable[0]]}))
        response = self.host.send.call_args.args[2]
        self.assertEqual(response["removedJobIds"], removable)
        self.assertEqual(response["rejectedJobIds"], [*protected, missing])
        for job_id in removable:
            self.assertIsNone(self.manager.registry.get(job_id))
            self.assertNotIn(job_id, self.manager.jobs)
        for path in paths:
            self.assertTrue(path.is_file(), path)
        self.assertEqual({job["jobId"] for job in self.manager.list()}, set(protected))

    def test_remove_validates_entire_bounded_batch_before_mutation(self):
        job_id, _, _ = self.record()
        for bad in (None, {}, job_id, [], [job_id] * 101, [job_id, "../escape"], [job_id, 7]):
            with self.subTest(value=bad):
                with self.assertRaises(ValueError):
                    self.manager.remove(bad)
                self.assertIsNotNone(self.manager.registry.get(job_id))

    def test_remove_rejects_disagreement_between_running_memory_and_terminal_registry(self):
        job_id, _, _ = self.record(memory=True)
        self.manager.jobs[job_id].state = JobState.RUNNING
        self.assertEqual(self.manager.remove([job_id]), {"removedJobIds": [], "rejectedJobIds": [job_id]})
        self.assertIsNotNone(self.manager.registry.get(job_id))

    def test_registry_lookup_cannot_traverse_directories(self):
        sentinel = self.root / "outside.json"
        sentinel.write_text('{"state":"completed"}', encoding="utf-8")
        self.assertIsNone(self.manager.registry.get("../outside"))
        self.assertFalse(self.manager.registry.remove("../outside"))
        with self.assertRaises(ValueError):
            self.manager.registry.put("../outside", state="failed")
        self.assertEqual(sentinel.read_text(encoding="utf-8"), '{"state":"completed"}')

    def test_metadata_is_bounded_redacted_and_survives_registry_reopen(self):
        title = "한국어 영상 https://example.test/video?token=private-token\nAuthorization: Bearer private-bearer\nCookie: session=private-cookie"
        source_key = "AB" * 32
        with patch.object(self.manager.pool, "submit"):
            job = self.manager.start("https://example.test/media?token=not-stored", "title", "auto", "number", RequestContext(""), display_title=title, source_key=source_key)
        record = JobRegistry(self.manager.registry.root).get(job.id)
        for secret in ("private-token", "private-bearer", "private-cookie", "not-stored"):
            self.assertNotIn(secret, json.dumps(record))
        self.assertIn("한국어 영상", record["displayTitle"])
        self.assertEqual(record["sourceKey"], source_key.lower())
        self.assertEqual(record["outputRoot"], str(self.manager.root))
        listed = self.manager.list()[0]
        self.assertEqual(listed["displayTitle"], job.display_title)
        self.assertEqual(listed["sourceKey"], source_key.lower())
        self.assertEqual(len(validate_display_title("x" * 400)), 300)
        self.assertIsNone(validate_display_title("\n  "))
        for bad in (True, 7, {}, "x" * 4097):
            with self.assertRaises(ValueError):
                validate_display_title(bad)
        for bad in (True, 7, {}, "not-a-digest", "a" * 63, "g" * 64):
            with self.assertRaises(ValueError):
                validate_source_key(bad)
        self.assertEqual(validate_job_id(job.id), job.id)
