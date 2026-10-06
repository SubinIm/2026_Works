from __future__ import annotations
import collections,math,os,signal,subprocess,threading,time,uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any,Callable
from .ffmpeg_commands import download_command
from .ffprobe import probe,with_manifest_timing
from .files import cleanup_partial,finalize_partial,numbered_path
from .logging_config import redact_text
from .validation import safe_output_path,validate_job_id,validate_job_ids,validate_display_title,validate_source_key
from .models import Job,JobState,RequestContext
from .progress import ProgressParser
from .job_registry import ACTIVE_STATES,TERMINAL_STATES,JobRegistry,process_exists
EventCallback=Callable[[str,dict[str,Any]],None]
ALLOWED={JobState.QUEUED:{JobState.PROBING,JobState.CANCELLING,JobState.FAILED},JobState.PROBING:{JobState.RUNNING,JobState.CANCELLING,JobState.FAILED,JobState.UNSUPPORTED_DRM},JobState.RUNNING:{JobState.FINALIZING,JobState.CANCELLING,JobState.FAILED},JobState.FINALIZING:{JobState.COMPLETED,JobState.CANCELLING,JobState.FAILED},JobState.CANCELLING:{JobState.CANCELLED,JobState.FAILED}}
class DownloadJobManager:
    def __init__(self,ffmpeg:Path,root:Path,event:EventCallback,registry:JobRegistry,max_workers:int=2,ffprobe:Path|None=None)->None:
        self.ffmpeg=ffmpeg;self.ffprobe=ffprobe or ffmpeg.with_name("ffprobe.exe" if ffmpeg.suffix.lower()==".exe" else "ffprobe");self.root=root.resolve();self.root.mkdir(parents=True,exist_ok=True);self.event=event;self.registry=registry;self.jobs:dict[str,Job]={};self.lock=threading.RLock();self.pool=ThreadPoolExecutor(max_workers=max_workers,thread_name_prefix="download")
    def start(self,url:str,filename:str,container:str,overwrite:str,context:RequestContext,duration:float|None=None,keep_partial:bool=False,allow_video_only:bool=False,preflight:Callable[[],str|dict[str,Any]|None]|None=None,verified_duration_seconds:float|None=None,display_title:str|None=None,source_key:str|None=None,probe_before_download:bool=True,audio_only:bool=False,youtube_engine:Any=None,youtube_height:int|None=None)->Job:
        if not isinstance(audio_only,bool):raise ValueError("audioOnly must be a boolean")
        if audio_only and allow_video_only:raise ValueError("audioOnly and allowVideoOnly cannot both be enabled")
        if not isinstance(probe_before_download,bool):raise ValueError("probeBeforeDownload must be a boolean")
        if duration is not None and (not math.isfinite(duration) or duration<=0):raise ValueError("durationSeconds must be a positive finite number")
        verified_duration_seconds=validate_duration_hint(verified_duration_seconds)
        display_title=validate_display_title(display_title);source_key=validate_source_key(source_key)
        ext="mkv" if container=="mkv" else "mp4";final=safe_output_path(self.root,filename,ext)
        if final.exists() and overwrite=="cancel":raise FileExistsError("output file already exists")
        if overwrite=="number":final=numbered_path(final)
        partial=final.with_name(f"{final.stem}.partial{final.suffix}");job=Job(str(uuid.uuid4()),url,str(final),str(partial),created_at=time.time(),display_title=display_title,source_key=source_key,output_root=str(self.root),audio_only=audio_only,engine="youtube" if youtube_engine else "ffmpeg");self.jobs[job.id]=job;self._persist(job,keep_partial)
        if youtube_engine:self.pool.submit(self._run_youtube,job,youtube_engine,youtube_height,container,keep_partial,overwrite=="overwrite",probe_before_download)
        else:self.pool.submit(self._run,job,context,duration,keep_partial,overwrite=="overwrite",container,allow_video_only,preflight,verified_duration_seconds,probe_before_download)
        return job

    def _run_youtube(self,job:Job,engine:Any,height:int|None,container:str,keep:bool,overwrite:bool,probe_before:bool)->None:
        from .youtube import YoutubeProgress,cleanup_work,engine_failure
        root=Path(job.output_root);work=root/(".youtube-"+job.id);partial=Path(job.partial_path)
        try:
            self._set_phase(job,JobState.PROBING,"probing",keep)
            job.probe=engine.probe(job.url,height,job.audio_only,container,lambda p:self._attach_process(job,p,keep)) if probe_before else {"inputProbeSkipped":True,"engine":"yt-dlp"}
            self._checkpoint(job);job.process=None
            job.duration_seconds=job.probe.get("duration");job.duration_source="extractor" if job.duration_seconds else "unknown"
            work.mkdir(exist_ok=False)
            self._set_phase(job,JobState.RUNNING,"downloading",keep)
            process=subprocess.Popen(engine.command(job.url,work,self.ffmpeg,height,job.audio_only,container),stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8",errors="replace",shell=False,creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name=="nt" else 0,start_new_session=os.name!="nt")
            lines:collections.deque[str]=collections.deque(maxlen=20)
            stderr_thread=threading.Thread(target=_drain_stderr,args=(process.stderr,lines),daemon=True);stderr_thread.start()
            try:
                self._attach_process(job,process,keep)
                parser=YoutubeProgress(job.probe.get("selectedFormatIds",[]),1 if job.audio_only else 2)
                for line in process.stdout:
                    self._checkpoint(job);value=parser.feed(line)
                    if value:
                        job.progress={"phase":"downloading","engine":"youtube","durationSeconds":job.duration_seconds,"durationSource":job.duration_source,**value}
                        self._persist(job,keep,pid=process.pid);self.event("job_progress",{"jobId":job.id,"state":"running","probe":job.probe,**job.progress})
                code=process.wait();stderr_thread.join(timeout=2)
                self._checkpoint(job)
                if code:raise engine_failure("".join(lines))
            finally:
                if process.poll() is None:_terminate_tree(process.pid,process)
                for stream in (process.stdout,process.stderr):
                    if stream:stream.close()
                job.process=None
            produced=work/("media.partial."+container)
            if not produced.is_file() or produced.is_symlink():raise MediaValidationError("media_stream_missing","YouTube 엔진이 출력 파일을 만들지 못했습니다.")
            produced.replace(partial)
            self._set_phase(job,JobState.FINALIZING,"verifying",keep)
            output=probe(self.ffprobe,str(partial),RequestContext(""),process_started=lambda p:self._attach_process(job,p,keep))
            self._checkpoint(job)
            if not output["audioStreams"]:raise MediaValidationError("audio_stream_missing","저장 결과에 음성이 없습니다. 완료로 처리하지 않았습니다.")
            if job.audio_only and output["videoStreams"]:raise MediaValidationError("audio_only_output_invalid","음성 전용 출력에 영상이 포함되어 있습니다.")
            if not job.audio_only and not output["videoStreams"]:raise MediaValidationError("video_stream_missing","저장 결과에 영상이 없습니다.")
            if height and any(s.get("height",0)>height for s in output["videoStreams"]):raise MediaValidationError("youtube_quality_mismatch","출력 해상도가 선택한 최대 해상도를 초과했습니다.")
            if job.duration_seconds and (not output.get("duration") or abs(output["duration"]-job.duration_seconds)>max(2,job.duration_seconds*.01)):
                raise MediaValidationError("youtube_duration_mismatch","저장 길이가 원본과 일치하지 않습니다.")
            with self.lock:
                self._checkpoint(job);job.output_path=str(finalize_partial(partial,Path(job.output_path),overwrite));self._transition(job,JobState.COMPLETED);self._persist(job,keep,pid=None)
            self.event("job_completed",{"jobId":job.id,"outputPath":job.output_path,"probe":job.probe,"progress":job.progress})
        except Exception as exc:
            if self._cancel_requested(job) or isinstance(exc,JobCancelled):
                job.state=JobState.CANCELLED;cleanup_partial(partial,keep);self._persist(job,keep,pid=None);self.event("job_cancelled",{"jobId":job.id})
            else:
                job.error_code=getattr(exc,"code","youtube_engine_error");job.error=str(exc) if isinstance(exc,MediaValidationError) or hasattr(exc,"code") else "YouTube 다운로드 또는 출력 검증에 실패했습니다."
                job.state=JobState.UNSUPPORTED_DRM if job.error_code=="unsupported_drm" else JobState.FAILED;cleanup_partial(partial,keep);self._persist(job,keep,pid=None);self.event("job_failed",{"jobId":job.id,"state":str(job.state),"errorSummary":job.error,"errorCode":job.error_code})
        finally:
            job.process=None
            cleanup_work(work,root,job.id,keep and job.state!=JobState.COMPLETED)
    def _run(self,job:Job,context:RequestContext,duration:float|None,keep:bool,overwrite:bool,container:str,allow_video_only:bool,preflight:Callable[[],str|dict[str,Any]|None]|None,verified_duration_seconds:float|None=None,probe_before_download:bool=True)->None:
        partial=Path(job.partial_path)
        try:
            if not probe_before_download:job.probe={"inputProbeSkipped":True,"duration":None}
            self._set_phase(job,JobState.PROBING,"probing",keep)
            inspection=preflight() if preflight else None
            drm=inspection.get("drm") if isinstance(inspection,dict) else inspection
            is_live=inspection.get("isLive") if isinstance(inspection,dict) else None
            self._checkpoint(job)
            if drm:raise MediaValidationError("unsupported_drm",drm)
            job.probe=probe(self.ffprobe,job.url,context,process_started=lambda p:self._attach_process(job,p,keep)) if probe_before_download else {"inputProbeSkipped":True,"duration":None}
            job.probe=with_manifest_timing(job.probe,is_live)
            self._checkpoint(job)
            job.process=None
            selected=job.probe["selectedStreamIndices"] if probe_before_download else None
            if job.audio_only and probe_before_download:
                selected=[s["index"] for s in job.probe["audioStreams"] if s["index"] in selected][:1]
                if not selected:raise MediaValidationError("audio_stream_missing","이 후보에 함께 저장할 수 있는 음성 트랙이 없습니다. 다른 후보를 선택하세요.")
            has_video=not job.audio_only and bool(job.probe.get("videoStreams"))
            has_audio=any(s["index"] in (selected or []) for s in job.probe.get("audioStreams",[]))
            if probe_before_download and not selected:raise MediaValidationError("media_stream_missing","다운로드할 영상 또는 오디오 스트림을 찾지 못했습니다.")
            if has_video and not has_audio:
                if not allow_video_only:raise MediaValidationError("audio_stream_missing",AUDIO_MISSING_MESSAGE)
                job.warning="소리 없는 영상으로 저장했습니다. 사용자가 영상만 다운로드를 허용했습니다."
            # A successful manual Probe is progress metadata, never an FFmpeg -t limit.
            natural=job.probe.get("duration") if job.probe.get("isLive") is not True else None
            source=job.probe.get("durationSource","format") if natural else "unknown"
            if natural is None and job.probe.get("isLive") is not True and verified_duration_seconds is not None:
                natural=verified_duration_seconds;source="probe_hint"
            if duration is not None and (natural is None or duration<natural):
                job.duration_seconds=duration;job.duration_source="requested"
            else:
                job.duration_seconds=natural;job.duration_source=source
            self._set_phase(job,JobState.RUNNING,"downloading",keep)
            code,stderr=self._download(job,partial,context,duration,selected,keep)
            self._checkpoint(job)
            if code and container=="auto" and _is_mux_incompatibility(stderr):
                cleanup_partial(partial,False);mkv=Path(job.output_path).with_suffix(".mkv");partial=mkv.with_name(f"{mkv.stem}.partial{mkv.suffix}");job.output_path=str(mkv);job.partial_path=str(partial)
                code,stderr=self._download(job,partial,context,duration,selected,keep)
                self._checkpoint(job)
            if code:raise RuntimeError(stderr.strip().splitlines()[-1][:500] if stderr.strip() else f"FFmpeg exited with {code}")
            self._set_phase(job,JobState.FINALIZING,"verifying",keep)
            output=probe(self.ffprobe,str(partial),RequestContext(""),process_started=lambda p:self._attach_process(job,p,keep))
            self._checkpoint(job)
            if not output["videoStreams"] and not output["audioStreams"]:raise MediaValidationError("media_stream_missing","저장 결과에 미디어 스트림이 없습니다.")
            if job.audio_only and (not output["audioStreams"] or output["videoStreams"]):raise MediaValidationError("audio_only_output_invalid","음성 전용 출력 검증에 실패했습니다. 완료로 처리하지 않았습니다.")
            if not probe_before_download and output["videoStreams"] and not output["audioStreams"]:
                if not allow_video_only:raise MediaValidationError("audio_stream_missing",AUDIO_MISSING_MESSAGE)
                job.warning="소리 없는 영상으로 저장했습니다. 사용자가 영상만 다운로드를 허용했습니다."
            if has_audio and not output["audioStreams"]:raise MediaValidationError("audio_stream_missing","다운로드 결과에 예상한 오디오가 없습니다. 소리 없는 파일을 완료로 처리하지 않았습니다.")
            if has_video and not output["videoStreams"]:raise MediaValidationError("video_stream_missing","다운로드 결과에 예상한 영상이 없습니다.")
            with self.lock:
                self._checkpoint(job)
                job.output_path=str(finalize_partial(partial,Path(job.output_path),overwrite));self._transition(job,JobState.COMPLETED);self._persist(job,keep,pid=None)
            self.event("job_completed",{"jobId":job.id,"outputPath":job.output_path,"warning":job.warning,"probe":job.probe,"progress":job.progress})
        except Exception as exc:
            if self._cancel_requested(job) or isinstance(exc,JobCancelled):
                job.state=JobState.CANCELLED;cleanup_partial(partial,keep);self._persist(job,keep,pid=None);self.event("job_cancelled",{"jobId":job.id})
            else:
                job.error=_user_error(str(exc));job.error_code=getattr(exc,"code",None);job.state=JobState.UNSUPPORTED_DRM if job.error_code=="unsupported_drm" else JobState.FAILED;cleanup_partial(partial,keep);self._persist(job,keep,pid=None);self.event("job_failed",{"jobId":job.id,"state":str(job.state),"errorSummary":job.error,"errorCode":job.error_code,"probe":job.probe})
        finally:job.process=None
    def _download(self,job:Job,partial:Path,context:RequestContext,duration:float|None,selected:list[int]|None,keep:bool)->tuple[int,str]:
        self._checkpoint(job)
        process=subprocess.Popen(download_command(self.ffmpeg,job.url,partial,context,duration,selected,audio_only=job.audio_only),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8",errors="replace",shell=False,creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name=="nt" else 0,start_new_session=os.name!="nt")
        try:
            self._attach_process(job,process,keep)
            parser=ProgressParser(job.duration_seconds);last=0.0
            lines:collections.deque[str]=collections.deque(maxlen=100)
            stderr_thread=threading.Thread(target=_drain_stderr,args=(process.stderr,lines),daemon=True);stderr_thread.start()
            assert process.stdout is not None
            for line in process.stdout:
                value=parser.feed(line)
                if value and (time.monotonic()-last>=.3 or value.get("progress")=="end"):
                    self._checkpoint(job);job.progress={"phase":"downloading","durationSource":job.duration_source,**value};self._persist(job,keep,pid=process.pid);self.event("job_progress",{"jobId":job.id,"state":"running","probe":job.probe,"warning":job.warning,**job.progress});last=time.monotonic()
            code=process.wait();stderr_thread.join(timeout=2)
            return code,"".join(lines)
        finally:
            if process.poll() is None:_terminate_tree(process.pid,process)
            for stream in (process.stdout,process.stderr):
                if stream is not None:stream.close()
            job.process=None
    def _set_phase(self,job:Job,state:JobState,phase:str,keep:bool)->None:
        with self.lock:
            self._checkpoint(job);self._transition(job,state);job.progress={**job.progress,"phase":phase,"durationSource":job.duration_source}
            if job.duration_seconds:job.progress["durationSeconds"]=job.duration_seconds
            self._persist(job,keep)
        self.event("job_progress",{"jobId":job.id,"state":str(job.state),"probe":job.probe,"warning":job.warning,**job.progress})
    def _attach_process(self,job:Job,process:Any,keep:bool)->None:
        with self.lock:
            if self._cancel_requested(job):
                _terminate_tree(process.pid,process);raise JobCancelled()
            job.process=process;self._persist(job,keep,pid=process.pid)
    def _cancel_requested(self,job:Job)->bool:
        record=self.registry.get(job.id)
        return job.state in {JobState.CANCELLING,JobState.CANCELLED} or bool(record and record.get("state") in {"cancelling","cancelled"})
    def _checkpoint(self,job:Job)->None:
        if self._cancel_requested(job):raise JobCancelled()
    def cancel(self,job_id:str)->bool:
        with self.lock:
            job=self.jobs.get(job_id);record=self.registry.get(job_id)
            previous_state=job.state if job else record.get("state") if record else None
            if job and job.state not in {JobState.COMPLETED,JobState.CANCELLED,JobState.FAILED,JobState.UNSUPPORTED_DRM}:
                if job.state==JobState.CANCELLING:return True
                self._transition(job,JobState.CANCELLING);self._persist(job,bool(record and record.get("keepPartial")),pid=job.process.pid if job.process else None);p=job.process
            elif not job and record and record.get("state") in ACTIVE_STATES:
                self.registry.put(job_id,state="cancelling");p=None
            else:return False
        pid=p.pid if p and p.poll() is None else int(record.get("pid") or 0) if record else 0
        if pid and not _terminate_tree(pid,p):
            if record:self.registry.put(job_id,state=str(previous_state),error="Unable to terminate FFmpeg process tree")
            if job:job.state=previous_state;job.error="Unable to terminate FFmpeg process tree"
            return False
        if not job and record:
            cleanup_partial(Path(str(record.get("partialPath",""))),bool(record.get("keepPartial")));self.registry.put(job_id,state="cancelled",pid=None)
        return True
    def list(self)->list[dict[str,Any]]:
        result=[]
        for record in self.registry.list():
            if record.get("state") in ACTIVE_STATES and not process_exists(record.get("pid")) and not process_exists(record.get("ownerPid")) and record.get("state") not in {"queued","probing"}:
                final=Path(str(record.get("outputPath","")));partial=Path(str(record.get("partialPath","")))
                state="completed" if final.is_file() else "failed";error=None if state=="completed" else "Host/process ended before finalization"
                record=self.registry.put(str(record["jobId"]),state=state,pid=None,error=error,partialExists=partial.is_file())
            result.append({k:record.get(k) for k in ("jobId","state","outputPath","error","errorCode","progress","probe","durationSeconds","durationSource","warning","createdAt","updatedAt","pid","partialExists","displayTitle","sourceKey","engine")})
        return result
    def output_path(self,job_id:str,require_completed:bool=True)->Path:
        """Resolve a previously registered local output, never a caller supplied path."""
        validate_job_id(job_id)
        with self.lock:
            record=self.registry.get(job_id)
            if not record:raise ValueError("다운로드 작업을 찾을 수 없습니다.")
            if require_completed and record.get("state")!="completed":raise ValueError("완료된 다운로드만 열 수 있습니다.")
            raw=record.get("outputPath")
            if not isinstance(raw,str) or not raw or raw.startswith(("\\\\","//")):
                raise ValueError("유효한 로컬 출력 경로가 아닙니다.")
            path=Path(raw)
            if not path.is_absolute() or path.is_symlink():raise ValueError("유효한 로컬 출력 경로가 아닙니다.")
            resolved=path.resolve()
            original_root=record.get("outputRoot")
            # Legacy records predate outputRoot; their Host-generated absolute path
            # remains authoritative, including after the download folder changes.
            if original_root and resolved.parent!=Path(original_root).resolve():raise ValueError("출력 경로가 다운로드 폴더 밖에 있습니다.")
            if resolved.suffix.lower() not in {".mp4",".mkv"}:raise ValueError("지원되는 영상 파일이 아닙니다.")
            if require_completed and not resolved.is_file():raise ValueError("저장된 영상 파일을 찾을 수 없습니다. 이동 또는 삭제되었는지 확인하세요.")
            if not require_completed and not resolved.parent.is_dir():raise ValueError("저장 폴더를 찾을 수 없습니다.")
            return resolved
    def remove(self,job_ids:Any)->dict[str,list[str]]:
        job_ids=validate_job_ids(job_ids);removed=[];rejected=[]
        with self.lock:
            for job_id in job_ids:
                job=self.jobs.get(job_id)
                if job and str(job.state) not in TERMINAL_STATES:
                    rejected.append(job_id);continue
                if self.registry.remove(job_id):
                    self.jobs.pop(job_id,None);removed.append(job_id)
                else:rejected.append(job_id)
        return {"removedJobIds":removed,"rejectedJobIds":rejected}
    def shutdown(self,cancel_active:bool=True)->None:
        if cancel_active:
            for j in list(self.jobs.values()):self.cancel(j.id)
            self.pool.shutdown(wait=True,cancel_futures=False)
        else:self.pool.shutdown(wait=False,cancel_futures=False)
    def _persist(self,job:Job,keep:bool,pid:int|None=None)->None:
        self.registry.put(job.id,state=str(job.state),outputPath=job.output_path,partialPath=job.partial_path,error=job.error,errorCode=job.error_code,progress=job.progress,probe=job.probe,durationSeconds=job.duration_seconds,durationSource=job.duration_source,warning=job.warning,pid=pid,ownerPid=os.getpid(),keepPartial=keep,displayTitle=job.display_title,sourceKey=job.source_key,outputRoot=job.output_root,engine=job.engine)
    @staticmethod
    def _transition(job:Job,state:JobState)->None:
        if state not in ALLOWED.get(job.state,set()):raise RuntimeError(f"invalid job transition: {job.state} -> {state}")
        job.state=state

AUDIO_MISSING_MESSAGE="이 주소에는 영상과 함께 저장할 오디오 스트림이 없습니다. 오디오가 포함된 HLS 마스터 또는 DASH 후보를 선택하세요. 영상만 저장하려면 '소리 없는 영상 허용'을 직접 선택하세요."
class MediaValidationError(RuntimeError):
    def __init__(self,code:str,message:str)->None:super().__init__(message);self.code=code
class JobCancelled(RuntimeError):pass
def validate_duration_hint(value:Any)->float|None:
    if value is None:return None
    if isinstance(value,bool) or not isinstance(value,(int,float)):
        raise ValueError("verifiedDurationSeconds must be a positive finite number")
    try:
        number=float(value)
    except OverflowError:
        raise ValueError("verifiedDurationSeconds must be a positive finite number") from None
    if not math.isfinite(number) or number<=0:
        raise ValueError("verifiedDurationSeconds must be a positive finite number")
    return number

def _is_mux_incompatibility(stderr:str)->bool:
    lower=stderr.lower()
    return any(x in lower for x in ("could not find tag for codec","not currently supported in container","codec not supported","incorrect codec parameters"))
def _user_error(value:str)->str:
    safe=redact_text(value)[:500]
    if "401" in safe or "403" in safe:return f"{safe} — URL 만료, Referer, 세션 Cookie, DRM 또는 서버의 FFmpeg 요청 거부를 확인하세요."
    return safe
def _drain_stderr(stream:Any,lines:collections.deque[str])->None:
    if stream is None:return
    for line in stream:lines.append(line)
def _terminate_tree(pid:int,process:Any=None)->bool:
    try:
        if os.name=="nt":
            done=subprocess.run(["taskkill","/PID",str(pid),"/T","/F"],capture_output=True,timeout=5,shell=False)
            if done.returncode!=0 and process is not None:process.kill()
        else:os.killpg(os.getpgid(pid),signal.SIGTERM)
    except (OSError,subprocess.SubprocessError):
        try:
            if process is not None:process.kill()
        except OSError:pass
    if process is not None:
        try:
            process.wait(timeout=5)
            return process.poll() is not None
        except subprocess.TimeoutExpired:
            return False
    deadline=time.monotonic()+5
    while process_exists(pid) and time.monotonic()<deadline:time.sleep(.05)
    return not process_exists(pid)
