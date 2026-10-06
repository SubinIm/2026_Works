from __future__ import annotations
from pathlib import Path
from .models import RequestContext
def http_options(context:RequestContext)->list[str]:
    args:list[str]=[]
    if context.user_agent:args.extend(["-user_agent",context.user_agent])
    headers=[]
    if context.referer:headers.append(f"Referer: {context.referer}")
    if context.origin:headers.append(f"Origin: {context.origin}")
    if context.cookie_header:headers.append(f"Cookie: {context.cookie_header}")
    if headers:args.extend(["-headers","\r\n".join(headers)+"\r\n"])
    return args
def probe_command(ffprobe:Path,url:str,context:RequestContext)->list[str]:
    return [str(ffprobe),"-v","error",*http_options(context),"-show_format","-show_streams","-show_programs","-of","json",url]
def download_command(ffmpeg:Path,url:str,output:Path,context:RequestContext,duration_seconds:float|None=None,stream_indices:list[int]|None=None,audio_only:bool=False)->list[str]:
    args=[str(ffmpeg),"-hide_banner","-loglevel","error","-nostdin","-y",*http_options(context),"-i",url]
    if duration_seconds is not None:args.extend(["-t",str(duration_seconds)])
    if stream_indices is not None:
        for index in stream_indices:args.extend(["-map",f"0:{index}"])
    elif audio_only:
        args.extend(["-map","0:a:0"])
    else:
        # Explicitly pick one video/audio stream rather than every adaptive rendition.
        args.extend(["-map","0:v:0?","-map","0:a:0?"])
    if audio_only:args.append("-vn")
    args.extend(["-c","copy","-progress","pipe:1","-nostats",str(output)])
    return args
