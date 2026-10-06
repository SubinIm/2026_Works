from __future__ import annotations
import io,json,struct
from typing import Any,BinaryIO
MAX_MESSAGE_BYTES=1024*1024
class ProtocolError(ValueError): pass
def encode_frame(message:dict[str,Any])->bytes:
    body=json.dumps(message,ensure_ascii=False,separators=(",",":")).encode("utf-8")
    if len(body)>MAX_MESSAGE_BYTES: raise ProtocolError("message exceeds size limit")
    return struct.pack("<I",len(body))+body
def read_frame(stream:BinaryIO)->dict[str,Any]|None:
    prefix=stream.read(4)
    if not prefix:return None
    if len(prefix)!=4:raise ProtocolError("invalid length prefix")
    length=struct.unpack("<I",prefix)[0]
    if length==0 or length>MAX_MESSAGE_BYTES:raise ProtocolError("invalid message length")
    body=stream.read(length)
    if len(body)!=length:raise ProtocolError("truncated message")
    try:value=json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError,json.JSONDecodeError) as exc:raise ProtocolError("invalid JSON payload") from exc
    if not isinstance(value,dict):raise ProtocolError("message must be an object")
    return value
def write_frame(stream:BinaryIO,message:dict[str,Any])->None:
    stream.write(encode_frame(message));stream.flush()

