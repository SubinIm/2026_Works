from __future__ import annotations
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

PROTOCOL_VERSION = 1
class JobState(StrEnum):
    QUEUED="queued"; PROBING="probing"; RUNNING="running"; FINALIZING="finalizing"; CANCELLING="cancelling"; COMPLETED="completed"; CANCELLED="cancelled"; FAILED="failed"; UNSUPPORTED_DRM="unsupported_drm"
@dataclass(slots=True)
class Envelope:
    protocol_version:int; message_id:str; type:str; payload:dict[str,Any]
    @classmethod
    def from_dict(cls,value:dict[str,Any])->Envelope:
        return cls(value.get("protocolVersion"),value.get("messageId"),value.get("type"),value.get("payload"))
    def to_dict(self)->dict[str,Any]: return {"protocolVersion":self.protocol_version,"messageId":self.message_id,"type":self.type,"payload":self.payload}
@dataclass(slots=True)
class RequestContext:
    page_url:str; referer:str|None=None; origin:str|None=None; user_agent:str|None=None; cookie_header:str|None=None
    @classmethod
    def from_dict(cls,v:dict[str,Any])->RequestContext: return cls(v.get("pageUrl",""),v.get("referer"),v.get("origin"),v.get("userAgent"),v.get("cookieHeader"))
@dataclass(slots=True)
class Job:
    id:str; url:str; output_path:str; partial_path:str; state:JobState=JobState.QUEUED; created_at:float=0; process:Any=None; error:str|None=None; progress:dict[str,Any]=field(default_factory=dict)
    probe:dict[str,Any]=field(default_factory=dict);duration_seconds:float|None=None;duration_source:str="unknown";warning:str|None=None;error_code:str|None=None
    display_title:str|None=None;source_key:str|None=None;output_root:str|None=None
    audio_only:bool=False
    engine:str="ffmpeg"

