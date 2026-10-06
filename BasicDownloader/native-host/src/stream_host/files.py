from __future__ import annotations
from pathlib import Path
def numbered_path(path:Path)->Path:
    if not path.exists():return path
    for i in range(1,10000):
        candidate=path.with_name(f"{path.stem} ({i}){path.suffix}")
        if not candidate.exists():return candidate
    raise FileExistsError("could not allocate a unique filename")
def finalize_partial(partial:Path,final:Path,overwrite:bool=False)->Path:
    final.parent.mkdir(parents=True,exist_ok=True)
    if final.exists() and not overwrite:final=numbered_path(final)
    partial.replace(final);return final
def cleanup_partial(path:Path,keep:bool)->None:
    if not keep:path.unlink(missing_ok=True)

