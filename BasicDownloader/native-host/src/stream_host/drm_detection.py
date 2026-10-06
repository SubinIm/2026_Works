from __future__ import annotations
import re
from dataclasses import dataclass
@dataclass(frozen=True,slots=True)
class DrmResult: unsupported:bool;reason:str|None=None
WIDEVINE="edef8ba9-79d6-4ace-a3c8-27dcd51d21ed";PLAYREADY="9a04f079-9840-4286-ab92-e65be0885f95"
def detect_hls(text:str)->DrmResult:
    upper=text.upper()
    if "METHOD=SAMPLE-AES" in upper:return DrmResult(True,"HLS SAMPLE-AES encryption is DRM-protected")
    for line in upper.splitlines():
        if line.startswith("#EXT-X-KEY") and "KEYFORMAT=" in line and not re.search(r'KEYFORMAT="?IDENTITY"?',line):return DrmResult(True,"HLS DRM key format detected")
    return DrmResult(False)
def detect_dash(text:str)->DrmResult:
    lower=text.lower()
    if WIDEVINE in lower:return DrmResult(True,"DASH Widevine ContentProtection detected")
    if PLAYREADY in lower:return DrmResult(True,"DASH PlayReady ContentProtection detected")
    if "cenc:default_kid" in lower or "<cenc:pssh" in lower:return DrmResult(True,"DASH Common Encryption metadata detected")
    if "contentprotection" in lower and "urn:mpeg:dash:mp4protection" in lower:return DrmResult(True,"DASH Common Encryption indicated; DRM system unspecified")
    return DrmResult(False)
