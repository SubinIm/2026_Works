import unittest
from pathlib import Path
from stream_host.ffmpeg_commands import download_command
from stream_host.models import RequestContext
from stream_host.progress import ProgressParser
from stream_host.logging_config import redact_text,redact_url
class CommandTests(unittest.TestCase):
    def test_argument_array_and_header_position(self):
        cmd=download_command(Path("ffmpeg.exe"),"https://x/a.m3u8",Path("out.mp4"),RequestContext("https://x/",referer="https://x/",cookie_header="sid=secret"))
        self.assertIsInstance(cmd,list);self.assertLess(cmd.index("-headers"),cmd.index("-i"));self.assertNotIn("shell=True"," ".join(cmd))
    def test_progress(self):
        p=ProgressParser(10);p.feed("out_time_us=5000000");p.feed("speed=2x");result=p.feed("progress=continue");self.assertAlmostEqual(result["percent"],50);self.assertAlmostEqual(result["etaSeconds"],2.5)
    def test_redaction(self):
        self.assertNotIn("secret",redact_url("https://x/a?token=secret&q=ok"));self.assertNotIn("abc",redact_text("Cookie: sid=abc"))

