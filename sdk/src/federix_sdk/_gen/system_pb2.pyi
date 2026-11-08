from . import common_pb2 as _common_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class HealthResponse(_message.Message):
    __slots__ = ("status", "db", "redis", "fl_server", "queue_depth", "uptime_ms")
    STATUS_FIELD_NUMBER: _ClassVar[int]
    DB_FIELD_NUMBER: _ClassVar[int]
    REDIS_FIELD_NUMBER: _ClassVar[int]
    FL_SERVER_FIELD_NUMBER: _ClassVar[int]
    QUEUE_DEPTH_FIELD_NUMBER: _ClassVar[int]
    UPTIME_MS_FIELD_NUMBER: _ClassVar[int]
    status: str
    db: str
    redis: str
    fl_server: str
    queue_depth: int
    uptime_ms: int
    def __init__(self, status: _Optional[str] = ..., db: _Optional[str] = ..., redis: _Optional[str] = ..., fl_server: _Optional[str] = ..., queue_depth: _Optional[int] = ..., uptime_ms: _Optional[int] = ...) -> None: ...

class VersionResponse(_message.Message):
    __slots__ = ("api_version", "build", "node_version", "environment")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    BUILD_FIELD_NUMBER: _ClassVar[int]
    NODE_VERSION_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    build: str
    node_version: str
    environment: str
    def __init__(self, api_version: _Optional[str] = ..., build: _Optional[str] = ..., node_version: _Optional[str] = ..., environment: _Optional[str] = ...) -> None: ...

class PublicConfigResponse(_message.Message):
    __slots__ = ("supported_sdk_versions", "server_timezone", "max_update_size_mb")
    SUPPORTED_SDK_VERSIONS_FIELD_NUMBER: _ClassVar[int]
    SERVER_TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    MAX_UPDATE_SIZE_MB_FIELD_NUMBER: _ClassVar[int]
    supported_sdk_versions: _containers.RepeatedScalarFieldContainer[str]
    server_timezone: str
    max_update_size_mb: int
    def __init__(self, supported_sdk_versions: _Optional[_Iterable[str]] = ..., server_timezone: _Optional[str] = ..., max_update_size_mb: _Optional[int] = ...) -> None: ...

class StatsResponse(_message.Message):
    __slots__ = ("active_connections", "memory_mb", "req_per_min", "queue_depth", "cache_hit_rate")
    ACTIVE_CONNECTIONS_FIELD_NUMBER: _ClassVar[int]
    MEMORY_MB_FIELD_NUMBER: _ClassVar[int]
    REQ_PER_MIN_FIELD_NUMBER: _ClassVar[int]
    QUEUE_DEPTH_FIELD_NUMBER: _ClassVar[int]
    CACHE_HIT_RATE_FIELD_NUMBER: _ClassVar[int]
    active_connections: int
    memory_mb: float
    req_per_min: int
    queue_depth: int
    cache_hit_rate: float
    def __init__(self, active_connections: _Optional[int] = ..., memory_mb: _Optional[float] = ..., req_per_min: _Optional[int] = ..., queue_depth: _Optional[int] = ..., cache_hit_rate: _Optional[float] = ...) -> None: ...

class MaintenanceRequest(_message.Message):
    __slots__ = ("enabled", "message", "estimated_duration_minutes")
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_DURATION_MINUTES_FIELD_NUMBER: _ClassVar[int]
    enabled: bool
    message: str
    estimated_duration_minutes: int
    def __init__(self, enabled: _Optional[bool] = ..., message: _Optional[str] = ..., estimated_duration_minutes: _Optional[int] = ...) -> None: ...

class MaintenanceResponse(_message.Message):
    __slots__ = ("maintenance_mode", "message")
    MAINTENANCE_MODE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    maintenance_mode: bool
    message: str
    def __init__(self, maintenance_mode: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class FlushResponse(_message.Message):
    __slots__ = ("flushed_keys", "warning")
    FLUSHED_KEYS_FIELD_NUMBER: _ClassVar[int]
    WARNING_FIELD_NUMBER: _ClassVar[int]
    flushed_keys: int
    warning: str
    def __init__(self, flushed_keys: _Optional[int] = ..., warning: _Optional[str] = ...) -> None: ...
