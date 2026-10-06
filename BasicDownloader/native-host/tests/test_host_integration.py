import io,json,os,shutil,struct,subprocess,sys,tempfile,unittest
from pathlib import Path
from stream_host.protocol import encode_frame,read_frame
FFMPEG=Path(os.environ.get("PSD_TEST_FFMPEG",shutil.which("ffmpeg") or r"C:\Program Files\DownloadHelper CoApp\ffmpeg.exe"));FFPROBE=FFMPEG.with_name("ffprobe.exe")
class HostIntegrationTests(unittest.TestCase):
    def test_native_messaging_health_round_trip(self):
        request={"protocolVersion":1,"messageId":"health-1","type":"health_check","payload":{}}
        env=os.environ.copy();env["PYTHONPATH"]=str(Path(__file__).parents[1]/"src")
        with tempfile.TemporaryDirectory() as d:
            env["PSD_DOWNLOAD_ROOT"]=d;env["PSD_LOG_PATH"]=str(Path(d)/"host.log");env["PSD_STATE_ROOT"]=str(Path(d)/"jobs")
            done=subprocess.run([sys.executable,"-m","stream_host"],input=encode_frame(request),capture_output=True,env=env,timeout=10)
        self.assertEqual(done.returncode,0,done.stderr.decode("utf-8","replace"));response=read_frame(io.BytesIO(done.stdout));self.assertEqual(response["messageId"],"health-1");self.assertEqual(response["type"],"health_result");self.assertIn("ffmpegAvailable",response["payload"])
    @unittest.skipUnless(FFMPEG.is_file() and FFPROBE.is_file(),"FFmpeg/FFprobe 실행 파일을 찾지 못했습니다.")
    def test_ffmpeg_environment_available(self):
        self.assertTrue(FFMPEG.is_file());self.assertTrue(FFPROBE.is_file())
