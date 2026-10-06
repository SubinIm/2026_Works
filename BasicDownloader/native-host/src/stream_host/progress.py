from __future__ import annotations
from dataclasses import dataclass,field
import math
from typing import Any
@dataclass(slots=True)
class ProgressParser:
    duration_seconds:float|None=None;values:dict[str,str]=field(default_factory=dict)
    def feed(self,line:str)->dict[str,Any]|None:
        if "=" not in line:return None
        key,value=line.strip().split("=",1);self.values[key]=value
        if key!="progress":return None
        out_us=_number(self.values.get("out_time_us"));out_seconds=(out_us/1_000_000) if out_us is not None else _time(self.values.get("out_time"))
        result:dict[str,Any]={"frame":_number(self.values.get("frame")),"fps":_number(self.values.get("fps")),"totalBytes":_number(self.values.get("total_size")),"mediaSeconds":out_seconds,"speed":self.values.get("speed"),"progress":value}
        if self.duration_seconds and math.isfinite(self.duration_seconds) and self.duration_seconds>0:
            result["durationSeconds"]=self.duration_seconds
            if out_seconds is not None:
                result["percent"]=min(100,max(0,out_seconds/self.duration_seconds*100));speed=_speed(self.values.get("speed"));result["etaSeconds"]=max(0,self.duration_seconds-out_seconds)/speed if speed and speed>0 else None
        self.values={};return result
def _number(v:str|None)->float|None:
    try:
        number=float(v) if v not in {None,"N/A"} else None
        return number if number is not None and math.isfinite(number) else None
    except ValueError:return None
def _time(v:str|None)->float|None:
    try:
        h,m,s=(float(x) for x in v.split(":"));value=h*3600+m*60+s
        return value if math.isfinite(value) else None
    except (AttributeError,ValueError):return None
def _speed(v:str|None)->float|None:
    try:return _number(v.rstrip("x"))
    except (AttributeError,ValueError):return None

