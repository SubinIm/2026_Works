import unittest
from pathlib import Path
from stream_host.drm_detection import detect_dash,detect_hls
from stream_host.jobs import DownloadJobManager,_is_mux_incompatibility
from stream_host.models import Job,JobState
class DrmAndStateTests(unittest.TestCase):
    def test_drm_detection_and_aes128_allowed(self):
        self.assertTrue(detect_hls('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="x"').unsupported)
        self.assertFalse(detect_hls('#EXT-X-KEY:METHOD=AES-128,URI="key"').unsupported)
        self.assertTrue(detect_dash('<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>').unsupported)
        unknown=detect_dash('<ContentProtection schemeIdUri="urn:example:metadata"/>');self.assertFalse(unknown.unsupported)
        generic=detect_dash('<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>');self.assertTrue(generic.unsupported);self.assertNotIn("Widevine",generic.reason)
    def test_job_transitions(self):
        j=Job("1","https://x","o","p");DownloadJobManager._transition(j,JobState.PROBING);DownloadJobManager._transition(j,JobState.RUNNING);self.assertEqual(j.state,JobState.RUNNING)
        with self.assertRaises(RuntimeError):DownloadJobManager._transition(j,JobState.COMPLETED)
    def test_only_mux_errors_trigger_auto_fallback(self):
        self.assertTrue(_is_mux_incompatibility("Could not find tag for codec pcm_s16le in stream #1"))
        self.assertFalse(_is_mux_incompatibility("HTTP error 403 Forbidden"))
    def test_drm_fixture_matrix(self):
        root=Path(__file__).parents[2]/"fixtures"/"drm"
        self.assertFalse(detect_hls((root/"hls-clear.m3u8").read_text()).unsupported)
        self.assertFalse(detect_hls((root/"hls-aes128.m3u8").read_text()).unsupported)
        self.assertTrue(detect_hls((root/"hls-sample-aes.m3u8").read_text()).unsupported)
        self.assertFalse(detect_dash((root/"dash-clear.mpd").read_text()).unsupported)
        generic=detect_dash((root/"dash-mp4protection.mpd").read_text());self.assertTrue(generic.unsupported);self.assertNotIn("Widevine",generic.reason)
        self.assertIn("Widevine",detect_dash((root/"dash-widevine.mpd").read_text()).reason)
        self.assertIn("PlayReady",detect_dash((root/"dash-playready.mpd").read_text()).reason)
