from . import common_pb2 as _common_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class SubscribeRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class Event(_message.Message):
    __slots__ = ("type", "payload_json", "timestamp")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_JSON_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    type: str
    payload_json: str
    timestamp: str
    def __init__(self, type: _Optional[str] = ..., payload_json: _Optional[str] = ..., timestamp: _Optional[str] = ...) -> None: ...
