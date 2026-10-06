from __future__ import annotations
import logging,re
from pathlib import Path
from urllib.parse import parse_qsl,urlsplit,urlunsplit,urlencode
SECRET=re.compile(r"^(token|access_token|auth|authorization|sig|signature|expires|expiry|policy|key)$",re.I)
def redact_url(raw:str)->str:
    try:u=urlsplit(raw);query=urlencode([(k,"[REDACTED]" if SECRET.match(k) else v) for k,v in parse_qsl(u.query,keep_blank_values=True)]);return urlunsplit((u.scheme,u.netloc,u.path,query,""))
    except Exception:return "[INVALID_URL]"
def redact_text(text:str)->str:
    text=re.sub(r"(?i)(cookie|authorization)\s*:\s*[^\r\n]+",r"\1: [REDACTED]",text)
    return re.sub(r"https?://[^\s'\"]+",lambda m:redact_url(m.group()),text)
def configure_logging(log_file:Path)->None:
    log_file.parent.mkdir(parents=True,exist_ok=True);logging.basicConfig(filename=log_file,level=logging.INFO,format="%(asctime)s %(levelname)s %(message)s",encoding="utf-8")

