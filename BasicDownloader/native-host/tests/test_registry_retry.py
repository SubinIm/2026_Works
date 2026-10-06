import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from stream_host.job_registry import JobRegistry

class RegistryRetryTests(unittest.TestCase):
    def test_transient_windows_sharing_error_retries_atomic_replace(self):
        with tempfile.TemporaryDirectory() as directory:
            registry=JobRegistry(Path(directory))
            import os
            original=os.replace
            calls=[]
            def transient(source,target):
                calls.append(1)
                if len(calls)<3:
                    error=PermissionError("busy");error.winerror=32;raise error
                original(source,target)
            with patch("stream_host.job_registry.os.replace",side_effect=transient),patch("stream_host.job_registry.time.sleep"):
                registry.put("job",state="completed")
            self.assertEqual(len(calls),3)
            self.assertEqual(registry.get("job")["state"],"completed")
            self.assertFalse(list(Path(directory).glob("*.tmp")))

    def test_persistent_error_raises_and_preserves_previous_record(self):
        with tempfile.TemporaryDirectory() as directory:
            registry=JobRegistry(Path(directory));registry.put("job",state="running")
            error=PermissionError("busy");error.winerror=5
            with patch("stream_host.job_registry.os.replace",side_effect=error) as replace,patch("stream_host.job_registry.time.sleep"):
                with self.assertRaises(PermissionError):registry.put("job",state="completed")
                self.assertEqual(replace.call_count,10)
            self.assertEqual(registry.get("job")["state"],"running")
            self.assertFalse(list(Path(directory).glob("*.tmp")))
