import tempfile,unittest
from pathlib import Path
from stream_host.validation import safe_output_path,sanitize_filename,validate_url
class ValidationTests(unittest.TestCase):
    def test_url(self):
        self.assertEqual(validate_url("https://example.com/a.m3u8"),"https://example.com/a.m3u8")
        for bad in ("file:///x","javascript:x","https://u:p@example.com/x"):
            with self.assertRaises(ValueError):validate_url(bad)
    def test_filename_and_reserved_names(self):
        self.assertEqual(sanitize_filename('a<b>:c?.mp4'),"a_b__c_.mp4")
        with self.assertRaises(ValueError):sanitize_filename("CON")
    def test_output_stays_below_root(self):
        with tempfile.TemporaryDirectory() as d:
            p=safe_output_path(Path(d),"../escape","mp4");self.assertEqual(p.parent,Path(d).resolve());self.assertNotIn("..",p.name)

