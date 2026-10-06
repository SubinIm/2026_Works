from __future__ import annotations
import shutil,subprocess,sys
from dataclasses import dataclass
from pathlib import Path
@dataclass(frozen=True,slots=True)
class FFmpegTools: ffmpeg:Path;ffprobe:Path;version:str
_cache:dict[str,FFmpegTools]={}
def locate(configured:str|None=None)->FFmpegTools|None:
    key=configured or "auto"
    if key in _cache:return _cache[key]
    pairs:list[tuple[Path,Path]]=[]
    if configured:
        p=Path(configured);base=p.parent if p.suffix else p;pairs.append((p if p.suffix else base/"ffmpeg.exe",base/"ffprobe.exe"))
    base=Path(sys.executable).resolve().parent/"tools"/"ffmpeg"/"bin";pairs.append((base/"ffmpeg.exe",base/"ffprobe.exe"))
    ff=shutil.which("ffmpeg.exe") or shutil.which("ffmpeg");fp=shutil.which("ffprobe.exe") or shutil.which("ffprobe")
    if ff and fp:pairs.append((Path(ff),Path(fp)))
    for a,b in pairs:
        if a.is_file() and b.is_file():
            try:version=subprocess.run([str(a),"-version"],capture_output=True,text=True,timeout=5,check=True).stdout.splitlines()[0]
            except (OSError,subprocess.SubprocessError):continue
            value=FFmpegTools(a.resolve(),b.resolve(),version);_cache[key]=value;return value
    return None

