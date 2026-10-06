from __future__ import annotations

import json
import os
import time
import threading
import re
from pathlib import Path
from typing import Any


ACTIVE_STATES = {"queued", "probing", "running", "finalizing", "cancelling"}
TERMINAL_STATES = {"completed", "failed", "cancelled", "unsupported_drm"}


class JobRegistry:
    """Per-job, non-sensitive state shared by successive Native Host processes."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, job_id: str, **values: Any) -> dict[str, Any]:
        if not isinstance(job_id,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}",job_id):
            raise ValueError("invalid registry job ID")
        current = self.get(job_id) or {"jobId": job_id, "createdAt": time.time()}
        current.update(values)
        current["updatedAt"] = time.time()
        target = self.root / f"{job_id}.json"
        temporary = target.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        temporary.write_text(json.dumps(current, ensure_ascii=False), encoding="utf-8")
        try:
            for attempt in range(10):
                try:
                    os.replace(temporary, target)
                    break
                except PermissionError as exc:
                    # Windows readers/scanners may briefly hold a non-delete-sharing
                    # handle. Never replace this with a non-atomic truncate/write.
                    if getattr(exc,"winerror",None) not in {5,32} or attempt==9:raise
                    time.sleep(.01*(attempt+1))
        finally:
            temporary.unlink(missing_ok=True)
        return current

    def get(self, job_id: str) -> dict[str, Any] | None:
        if not isinstance(job_id,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}",job_id):return None
        path = self.root / f"{job_id}.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else None
        except (OSError, json.JSONDecodeError):
            return None

    def remove(self, job_id: str) -> bool:
        record=self.get(job_id)
        if not record or record.get("state") not in TERMINAL_STATES:return False
        try:
            (self.root / f"{job_id}.json").unlink()
            return True
        except OSError:return False

    def list(self) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        for path in self.root.glob("*.json"):
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(value, dict) and value.get("jobId")==path.stem:
                    values.append(value)
            except (OSError, json.JSONDecodeError):
                continue
        return sorted(values, key=lambda item: float(item.get("createdAt", 0)), reverse=True)


def process_exists(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        process_query_limited_information = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False
