from __future__ import annotations
import re
from pathlib import Path
from urllib.parse import urlsplit
from typing import Any
from .models import Envelope,PROTOCOL_VERSION
from .logging_config import redact_text
MAX_URL_LENGTH=8192;MAX_FILENAME_LENGTH=180
RESERVED={"CON","PRN","AUX","NUL",*(f"COM{i}" for i in range(1,10)),*(f"LPT{i}" for i in range(1,10))}
MESSAGE_TYPES={"hello","health_check","probe_media","start_download","cancel_job","list_jobs","open_output_folder","open_output_file","reveal_output_file","remove_jobs","shutdown_when_idle","youtube_probe","youtube_download"}
def validate_envelope(raw:dict[str,Any])->Envelope:
    env=Envelope.from_dict(raw)
    if env.protocol_version!=PROTOCOL_VERSION:raise ValueError("unsupported protocol version")
    if not isinstance(env.message_id,str) or not env.message_id:raise ValueError("messageId is required")
    if env.type not in MESSAGE_TYPES:raise ValueError("unknown message type")
    if not isinstance(env.payload,dict):raise ValueError("payload must be an object")
    return env
def validate_url(raw:Any)->str:
    if not isinstance(raw,str) or not raw or len(raw)>MAX_URL_LENGTH:raise ValueError("invalid URL length")
    u=urlsplit(raw)
    if u.scheme not in {"http","https"} or not u.netloc:raise ValueError("only HTTP(S) URLs are allowed")
    if u.username or u.password:raise ValueError("credentials in URLs are not allowed")
    return raw
def sanitize_filename(raw:Any)->str:
    if not isinstance(raw,str):raise ValueError("filename must be text")
    name=re.sub(r'[<>:"/\\|?*\x00-\x1f]',"_",raw).strip(" .")[:MAX_FILENAME_LENGTH]
    if not name or name.upper().split(".")[0] in RESERVED:raise ValueError("invalid or reserved filename")
    return name
def safe_output_path(root:Path,filename:str,extension:str)->Path:
    root=root.resolve();name=sanitize_filename(filename);suffix=f".{extension.lstrip('.')}"
    if not name.lower().endswith(suffix.lower()):name+=suffix
    result=(root/name).resolve()
    if root not in result.parents:raise ValueError("output path escapes download root")
    return result

def validate_job_id(value:Any)->str:
    if not isinstance(value,str) or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",value):
        raise ValueError("jobId must be a canonical UUID")
    return value

def validate_job_ids(value:Any)->list[str]:
    if not isinstance(value,list) or not 1<=len(value)<=100:
        raise ValueError("jobIds must contain between 1 and 100 job IDs")
    return list(dict.fromkeys(validate_job_id(item) for item in value))

def validate_display_title(value:Any)->str|None:
    if value is None:return None
    if not isinstance(value,str) or len(value)>4096:raise ValueError("displayTitle must be text with at most 4096 characters")
    return re.sub(r"[\x00-\x1f\x7f]"," ",redact_text(value)).strip()[:300] or None

def validate_source_key(value:Any)->str|None:
    if value is None:return None
    if not isinstance(value,str) or not re.fullmatch(r"[0-9a-fA-F]{64}",value):raise ValueError("sourceKey must be a SHA-256 digest")
    return value.lower()

