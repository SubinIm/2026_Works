from __future__ import annotations
import json,os,sys,threading,urllib.request,subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from . import __version__
from .drm_detection import detect_dash,detect_hls
from .ffmpeg_locator import locate
from .ffprobe import probe,with_manifest_timing
from .jobs import DownloadJobManager
from .job_registry import JobRegistry
from .logging_config import configure_logging,redact_text
from .models import Envelope,PROTOCOL_VERSION,RequestContext
from .protocol import ProtocolError,read_frame,write_frame
from .validation import sanitize_filename,validate_envelope,validate_url,validate_job_id
from .youtube import YoutubeEngine,YoutubeError,page_url,height_limit
class Host:
    def __init__(self)->None:
        self.youtube=None;self.youtube_error="YouTube 보조 엔진을 설정에서 활성화하세요."
        self.tools=locate(os.environ.get("PSD_FFMPEG_PATH"));self.out=sys.stdout.buffer;self.write_lock=threading.Lock();self.connected=True;self.explicit_shutdown=False;root=Path(os.environ.get("PSD_DOWNLOAD_ROOT",str(Path.home()/"Downloads"/"PersonalStreamDownloader")));state_root=Path(os.environ.get("PSD_STATE_ROOT",str(Path(os.environ.get("LOCALAPPDATA",str(Path.home())))/"PersonalStreamDownloader"/"jobs")));self.jobs=DownloadJobManager(self.tools.ffmpeg if self.tools else Path("ffmpeg"),root,self.event,JobRegistry(state_root),ffprobe=self.tools.ffprobe if self.tools else None)
    def send(self,message_id:str,type_:str,payload:dict[str,Any])->None:
        if not self.connected:return
        try:
            with self.write_lock:write_frame(self.out,Envelope(PROTOCOL_VERSION,message_id,type_,payload).to_dict())
        except (BrokenPipeError,OSError):self.connected=False
    def event(self,type_:str,payload:dict[str,Any])->None:self.send(payload.get("jobId","event"),type_,payload)
    def dispatch(self,env:Envelope)->None:
        p=env.payload
        if env.type in {"health_check","probe_media","start_download","youtube_probe","youtube_download"}:self._apply_settings(p.get("settings"))
        if env.type=="hello":self.send(env.message_id,"hello_result",{"hostVersion":__version__,"protocolVersion":PROTOCOL_VERSION});return
        if env.type=="health_check":self.send(env.message_id,"health_result",{"hostVersion":__version__,"capabilities":{"optionalInputProbe":True,"audioOnly":True,"youtube":True},"youtubeAvailable":bool(self.youtube),"youtubeError":self.youtube_error,"ffmpegAvailable":bool(self.tools),"ffmpegVersion":self.tools.version if self.tools else None,"error":None if self.tools else "FFmpeg와 FFprobe를 찾을 수 없습니다."});return
        if env.type=="list_jobs":self.send(env.message_id,"health_result",{"jobs":self.jobs.list()});return
        if env.type=="cancel_job":self.send(env.message_id,"job_cancelled",{"jobId":validate_job_id(p.get("jobId")),"accepted":self.jobs.cancel(validate_job_id(p.get("jobId")))});return
        if env.type=="remove_jobs":self.send(env.message_id,"health_result",self.jobs.remove(p.get("jobIds")));return
        if env.type=="shutdown_when_idle":self.explicit_shutdown=True;self.send(env.message_id,"health_result",{"shuttingDown":True});raise SystemExit
        if env.type in {"open_output_folder","open_output_file","reveal_output_file"}:self._open_output(validate_job_id(p.get("jobId")),env.type);self.send(env.message_id,"health_result",{"opened":True});return
        if env.type in {"youtube_probe","youtube_download"}:
            if not self.youtube:raise YoutubeError(self.youtube_error,"youtube_engine_missing")
            if not self.tools:raise RuntimeError("FFmpeg와 FFprobe를 찾을 수 없습니다.")
            if p.get("includeSession") or p.get("requestContext"):raise ValueError("YouTube 보조 엔진은 현재 쿠키 미전송 모드만 지원합니다.")
            url=page_url(p.get("url"));height=height_limit(p.get("maxHeight"));container=p.get("container","mkv");audio_only=p.get("audioOnly",False)
            if container not in {"mkv","mp4"} or not isinstance(audio_only,bool):raise ValueError("invalid YouTube download options")
            if env.type=="youtube_probe":
                try:self.send(env.message_id,"probe_result",self.youtube.probe(url,height,audio_only,container))
                except YoutubeError as exc:self.send(env.message_id,"job_failed",{"state":"unsupported_drm" if exc.code=="unsupported_drm" else "failed","errorCode":exc.code,"errorSummary":str(exc)})
                return
            overwrite=p.get("overwrite","number");probe_before=p.get("probeBeforeDownload",True)
            if overwrite not in {"number","overwrite","cancel"} or not isinstance(probe_before,bool):raise ValueError("invalid YouTube download options")
            job=self.jobs.start(url,sanitize_filename(p.get("filename","YouTube video")),container,overwrite,RequestContext(url),keep_partial=bool(p.get("keepPartial")),display_title=p.get("displayTitle"),source_key=p.get("sourceKey"),probe_before_download=probe_before,audio_only=audio_only,youtube_engine=self.youtube,youtube_height=height)
            self.send(env.message_id,"job_started",{"jobId":job.id,"state":str(job.state),"outputPath":job.output_path,"engine":"youtube","displayTitle":job.display_title,"sourceKey":job.source_key});return
        if env.type in {"probe_media","start_download"}:
            if not self.tools:raise RuntimeError("FFmpeg와 FFprobe를 찾을 수 없습니다.")
            url=validate_url(p.get("url"));context=RequestContext.from_dict(p.get("requestContext",{}))
            if env.type=="probe_media":
                inspection=self._preflight(url,context,p.get("mediaKind"))
                drm=inspection.get("drm") if inspection else None
                if drm:self.send(env.message_id,"job_failed",{"state":"unsupported_drm","errorSummary":drm});return
                summary=probe(self.tools.ffprobe,url,context)
                self.send(env.message_id,"probe_result",with_manifest_timing(summary,inspection.get("isLive") if inspection else None));return
            filename=sanitize_filename(p.get("filename","download"));container=p.get("container","auto");overwrite=p.get("overwrite","number")
            if container not in {"auto","mp4","mkv"} or overwrite not in {"number","overwrite","cancel"}:raise ValueError("invalid download options")
            duration=float(p["durationSeconds"]) if p.get("liveMode")=="duration" and p.get("durationSeconds") else None
            allow_video_only=p.get("allowVideoOnly",False)
            if not isinstance(allow_video_only,bool):raise ValueError("allowVideoOnly must be a boolean")
            probe_before=p.get("probeBeforeDownload",True)
            if not isinstance(probe_before,bool):raise ValueError("probeBeforeDownload must be a boolean")
            # Manifest checks and input probing run in the job worker, not the Port reader.
            audio_only=p.get("audioOnly",False)
            if not isinstance(audio_only,bool):raise ValueError("audioOnly must be a boolean")
            if audio_only and allow_video_only:raise ValueError("audioOnly and allowVideoOnly cannot both be enabled")
            job=self.jobs.start(url,filename,container,overwrite,context,duration,bool(p.get("keepPartial")),allow_video_only,lambda:self._preflight(url,context,p.get("mediaKind")),verified_duration_seconds=p.get("verifiedDurationSeconds"),display_title=p.get("displayTitle"),source_key=p.get("sourceKey"),probe_before_download=probe_before,audio_only=audio_only);self.send(env.message_id,"job_started",{"jobId":job.id,"state":job.state,"outputPath":job.output_path,"displayTitle":job.display_title,"sourceKey":job.source_key});return
        raise ValueError("unknown message type")
    def _apply_settings(self,value:Any)->None:
        if not isinstance(value,dict):return
        active=any(j.state in {"queued","probing","running","finalizing","cancelling"} for j in self.jobs.jobs.values())
        if active:return
        if value.get("youtubeEnabled") is True:
            try:
                self.youtube=YoutubeEngine(value.get("ytDlpPath","") if isinstance(value.get("ytDlpPath",""),str) else "",value.get("jsRuntimePath","") if isinstance(value.get("jsRuntimePath",""),str) else "");self.youtube_error=None
            except YoutubeError as exc:self.youtube=None;self.youtube_error=str(exc)
        else:self.youtube=None;self.youtube_error="YouTube 보조 엔진을 설정에서 활성화하세요."
        configured=value.get("ffmpegPath")
        if isinstance(configured,str) and configured:
            found=locate(configured)
            if found:self.tools=found;self.jobs.ffmpeg=found.ffmpeg;self.jobs.ffprobe=found.ffprobe
        root=value.get("downloadRoot")
        if isinstance(root,str) and root:
            target=Path(root).expanduser().resolve();target.mkdir(parents=True,exist_ok=True);self.jobs.root=target
    def _preflight(self,url:str,context:RequestContext,media_kind:Any=None)->dict[str,Any]|None:
        path=url.split("?",1)[0].lower()
        is_hls=path.endswith(".m3u8") or media_kind=="hls";is_dash=path.endswith(".mpd") or media_kind=="dash"
        if not (is_hls or is_dash):return None
        headers={"User-Agent":context.user_agent or "PersonalStreamDownloader/0.1"}
        if context.referer:headers["Referer"]=context.referer
        if context.origin:headers["Origin"]=context.origin
        if context.cookie_header:headers["Cookie"]=context.cookie_header
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=10) as response:text=response.read(1024*1024).decode("utf-8","replace")
        except Exception:return None
        result=detect_hls(text) if is_hls else detect_dash(text)
        return {"drm":result.reason if result.unsupported else None,"isLive":_manifest_is_live(text,"hls" if is_hls else "dash")}
    def _open_folder(self,job_id:str)->None:
        self._open_output(job_id,"open_output_folder")
    def _open_output(self,job_id:str,action:str)->None:
        try:
            path=self.jobs.output_path(job_id,require_completed=action!="open_output_folder")
            if os.name!="nt":raise RuntimeError("파일 열기는 Windows에서만 지원됩니다.")
            if action=="reveal_output_file":subprocess.Popen(["explorer.exe","/select,",str(path)],shell=False)
            else:os.startfile(str(path.parent if action=="open_output_folder" else path)) # type: ignore[attr-defined]
        except OSError as exc:
            raise RuntimeError("파일 또는 폴더를 열지 못했습니다. 기본 재생 앱과 저장 경로를 확인하세요.") from exc
def _manifest_is_live(text:str,media_kind:str)->bool|None:
    if media_kind=="hls":
        lines=[line.strip() for line in text.splitlines()]
        if not lines or lines[0]!="#EXTM3U":return None
        if "#EXT-X-ENDLIST" in lines:return False
        if any(line.startswith("#EXTINF:") for line in lines):return True
        # A master playlist says nothing about whether its media playlist is live.
        return None
    try:
        root=ET.fromstring(text)
        if root.tag.rsplit("}",1)[-1]!="MPD":return None
        kind=root.get("type","static")
        return True if kind=="dynamic" else False if kind=="static" else None
    except ET.ParseError:return None

def main()->None:
    if os.name=="nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY);msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
    default_log=Path(os.environ.get("LOCALAPPDATA",str(Path.home())))/"PersonalStreamDownloader"/"host.log"
    configure_logging(Path(os.environ.get("PSD_LOG_PATH",str(default_log))));host=Host()
    try:
        while True:
            try:
                raw=read_frame(sys.stdin.buffer)
                if raw is None:break
                env=validate_envelope(raw);host.dispatch(env)
            except (ProtocolError,ValueError,RuntimeError) as exc:
                message_id=raw.get("messageId","unknown") if isinstance(locals().get("raw"),dict) else "unknown";host.send(str(message_id),"protocol_error",{"errorSummary":redact_text(str(exc))})
    finally:host.jobs.shutdown(cancel_active=host.explicit_shutdown)
if __name__=="__main__":main()
